# WhatsApp 團練場 Session 唯讀 SQL 候選

狀態：本文件保留 Session 唯讀候選階段的設計與審查記錄。其 DDL 之後已整合進本機 migration65，相關頁面／API 現受預設關閉的功能 gate 控制，**未部署或正式啟用**。最新狀態見 [部署準備](whatsapp-venue-release-readiness.md)。此狀態查詢仍不是出席 writer，不能授權後續另一個交易的出席寫入。

## 檔案與部署邊界

- 可執行 DDL：`packages/database/sql-candidates/whatsapp-venue-session-authority.sql`。
- 真 DB 測試：`packages/database/tests/whatsapp-venue-authority.test.ts`。
- 因目前 schema64 的相容性邊界分布於 app、venue suite、health 與 migration 測試，候選檔不放進 `migrations/`。因此現有自動 migration 不會誤套用，健康檢查上限及正式資料庫不變。
- 只允許在經確認的隔離 DB，以交易包裹候選 DDL。不是正式 migration／可直接發布包；不得手動套到正式站。

## 實際權限圖

```text
非 superuser API 登入角色
  └─ SET LOCAL ROLE qigong_api_runtime
       └─ EXECUTE platform.whatsapp_venue_session_status(session, csrf)
            SECURITY DEFINER: qigong_whatsapp_venue_session_reader
            ├─ 有限欄位 SELECT + 專屬 RLS
            │    ├─ WhatsApp browser Sessions（兩個 hash + 有效／未撤銷）
            │    ├─ 該 Session 的 WhatsApp identity
            │    ├─ 該 Session 的 person
            │    ├─ 該 identity／person 的 interaction channel
            │    └─ 同 person／subject 的 WhatsApp application
            └─ EXECUTE 既有 platform.privacy_usage('whatsapp', session)
```

新 role：NOLOGIN、NOINHERIT、NOSUPERUSER、NOCREATEDB、NOCREATEROLE、NOREPLICATION、NOBYPASSRLS。沒有 runtime membership、出席 INSERT／UPDATE／DELETE、姓名等非必要欄位 SELECT。原有 API／LINE／debug grants 不變；此批沒有聲稱 DB 已強制整個系統的通路隔離。

新 facade owner 固定 search_path=pg_catalog、row_security=on，清除 PUBLIC 與其他非 owner 預設 ACL 殘留，只授予 API runtime EXECUTE；worker 不可執行。

## Session／GUC 邊界

- facade 要求有效 request ID、不得帶管理 principal／person context，Session／CSRF 必須是精確 43 字元 base64url。
- 函式將傳入 Session／CSRF 的 hash 覆寫到自己命名的 transaction-local GUC。RLS 同時要求持久化 Session 兩個 hash 相符、未撤銷、未過期。
- person GUC 不是 authority。呼叫者先塞入正確 GUC 也不能讓錯誤的實參通過；runtime 無法直接變成 owner role。
- 通過 Session-only 查詢後才呼叫既有 privacy helper；helper 的日課私人 link fallback 無法單獨繞過前後兩次 Session／WhatsApp eligibility JOIN。
- 成功時清空 hash；函式失敗由交易／savepoint 回滾恢復先前設定。回滾不保證空字串，但後續每次 facade 都重設並驗證實參。已測失敗回滾後再呼叫仍正確驗證與清理。
- 沒有 active 同意政策時，clear 表示既有政策引擎目前不要求 acceptance，不能解讀為學員已主動同意。啟用政策後，未同意／撤回會拒絕。
- 輸出只有 `{version:1,status:'approved',privacy:'clear'}`，不回 person、identity、Session、CSRF 或個資。

## 驗證證據

Node 24、專用 loopback Docker PostgreSQL 16，測試 DB 與 role 由本 suite 建立並清理，使用真實非 superuser LOGIN，只有 qigong_api_runtime membership。21 項真 DB 測試通過：

- 配對憑證、兩位學員混搭、未知／畸形／null／尾端換行。
- 私人 check-in link 不回退、Session 過期／撤銷、person／identity／channel 失效。
- 假 GUC、不能切換 owner、不能 runtime 直接讀 Session 表；reader RLS 僅見指定人，錯 CSRF hash 不見資料。
- role 屬性／membership、無 attendance INSERT／非必要姓名 SELECT，worker 無 execute。
- 無新增出席／聊天收據；有效／撤回的已發布同意政策。
- 缺 request context、汙染 person／principal context，以及 savepoint 失敗後重新驗證／清理。

執行方式：測試環境提供經驗證的 TEST_DATABASE_URL 及專用 ephemeral cluster 的 TEST_DATABASE_ALLOW_ROLE_TEARDOWN=true，再以 Node 24 執行該單一測試檔。不能對未知或共用 cluster 啟用 role teardown。

Node 24 全量 `pnpm verify` 亦通過。其未帶 TEST_DATABASE_URL 的跳過項目不得算 DB 驗收；本節 21 項是另行帶隔離 DB 實際執行的結果。

## 審查

`wa-db-review`／`cliproxyapi/gpt-6-astra` 的唯讀靜態補充審查：此限定候選 **APPROVE**，未發現可利用的 GUC／角色旁路；後端部署 **BLOCK**。

這是同模型家族、獨立上下文，不是跨家族最終審查。Reviewer 未執行測試，原審查當時讀取的是 17 項測試；協調者之後補上其建議的 request context 與 savepoint 四項，現為 21 項。SQL 候選未因補測而變更。

## 下一批與未解的發布關卡

- 此 facade 只是當下狀態讀取。兩次 recheck 不等於 Session／資格／同意撤銷的寫入鎖協議，不能在 HTTP 先查 status 後直接寫出席。
- 出席 writer 必須在自己的同一交易內重新驗證，定稿必要的鎖順序、撤銷線性化、RLS 上下文及最小 grants，再測併發／replay／跨日／DST／半徑等。
- 在 writer、HTTP、登入回程、本人紀錄、通路 gate、migration／readiness 整合及最終安全／CI 關卡完成前，WhatsApp 團練場打卡仍不可作為正式可用功能發布。
