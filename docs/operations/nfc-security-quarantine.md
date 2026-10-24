# NFC 第二階段：資料庫與 API 隔離

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 第二批：API 信任入口 fail-closed（基於 986fa80）

本批單一代理在父 checkout 順序實作，共修改五檔：

- `apps/public-api/src/field-checkin-routes.ts`
- `apps/public-api/src/field-checkin-service.ts`
- `apps/public-api/src/app.ts`
- `apps/public-api/tests/field-checkin.test.ts`
- `docs/operations/nfc-security-quarantine.md`

### 實際防線與刻意停用

- NFC 仍 default-off；沒有修改 opt-in gate、0048、GRANT / RLS、migration readiness 或環境設定。
- POST 採 strict payload，拒絕 body 的 personId、volunteerPersonId、checkinId、subject、
  principalId、idToken 等未支援欄位（400），不再把客戶端身分直接交給 service。
  query / header / cookie 的自稱身分亦不能建立 context 或取得權限。
- 合法形狀的 GPS payload 也回傳 503 / nfc_authorization_unavailable；
  不含自選身分欄位的 volunteer_manual 回傳 403 / volunteer_authorization_unavailable。
  帶偽造志工 ID 的 payload 先被 strict schema 拒絕（400）。
  **匿名請求的 503 是功能尚未安全開放，不是已通過認證或已完成 401 認證流程。**
- GET active fields 同樣回傳 503，不回傳假空清單，也不以 privileged pool 繞過隔離。
- route 註冊與 service 均不再接受 pool / client；移除舊 SELECT / INSERT 實作與不安全的成功分支。
  service 只回傳失敗，不能透過直接呼叫 service 恢復寫入。
  未假造 request context；將來恢復 DB 存取必須另行審核並使用 withRequestContext。
- 回應保留 no-store / no-referrer / nosniff；POST bodyLimit 為 4096；
  validation error 不回顯 payload / credential / GPS / student note。
- 保留距離、geofence、時間窗純函式與既有測試；移除舊匿名成功及未授權志工成功 mock，
  改為正式 buildApp 的拒絕契約，沒有用 mock 成功冒充安全完成。
- 沒有自動新增、連結或更新日課，也沒有選擇功法或改動既有資料。

### 身分整合尚未完成

已檢查 line-profile.ts 的 verifyLineIdentity / verifiedLineIdentitySchema、
line-onboarding.ts 的伺服器端 verifier 介面、learner-privacy-routes.ts 的 privacy gate，
以及既有 identity.platform_identities、person_interaction_channels、approved application 模型。
LINE token 必須由伺服器驗證後取得 subject，再解析有效、未撤銷的 identity / channel 與學員資格；
不能把 UUID / subject / token-shaped string 當成授權。

本批**沒有接上 token verification、identity mapping、privacy 或志工 scoped authorization**。
因此不接受 credential payload，也不從任何請求資料導出學員，選擇全面暫拒讀寫，
而不是僅加入登入檢查後繼續舊 pool SQL。未呼叫 LINE 或其他外部 API。
志工仍需從可信 admin session 導出 principal，檢查 action、有效 grant、場地 region；
不能使用 self-read 的 can_access_person 代替寫入授權。

### 第二批本地驗證

所有測試均為隔離的 mock / 純函式 / 靜態檔案契約，沒有 DB 連線或 migration 執行。

- `pnpm --filter @qigong/public-api exec vitest run tests/field-checkin.test.ts tests/health.test.ts tests/admin-attendance.test.ts`：81 passed（45 / 13 / 23）。
  正式 buildApp 覆蓋 10 組匿名、任選 person / volunteer / checkin、偽造 subject / token / 志工、
  header / cookie 與 query 攻擊；只允許 mocked startup schema probe，請求階段 pool.query、
  pool.connect、client.query 與 fetch 均未被呼叫。另保留 default-off / 非精確 opt-in 的全部 NFC 路由
  404、既有 admin / health / navigation 相容性測試。
- `pnpm --filter @qigong/database exec vitest run tests/nfc-security-quarantine.test.ts tests/field-attendance-schema.test.ts`：54 passed（19 / 35）。
- `pnpm typecheck`、`pnpm build`：四個 workspace package 通過。
- 修改的 field-checkin.test.ts 額外使用 tsc --noEmit --strict --exactOptionalPropertyTypes
  --noUncheckedIndexedAccess --target ES2022 --module NodeNext --moduleResolution NodeNext
  --skipLibCheck 通過；四個修改的 TS 檔案 ESLint 通過，五個檔案由既有 Prettier 格式化／檢查。
- 初次 typecheck 發現 Zod optional 與 exactOptionalPropertyTypes 不相容；
  將拒絕 service 的輸入限為實際需要的 checkinMethod，沒有加 cast 放寬型別（1 輪修復）。
- Node 仍為 v26.10.0，非專案要求的 Node 24；仍須於 Node 24 再驗證。

### 上線限制與下一批

**這是拒絕存取的安全批次，不是可用 NFC 或完整安全認證完成。**
0048 deny-all 完整保留；現版 maximum migration / nfcMigrationVersion 仍為 0047。
新增測試確認 0048 在 gate 關閉時仍回傳 schema_version_mismatch，gate 開啟則拒絕啟動。
不得把本批直接當成 migration / 部署核准，也不得開啟 gate 讓端點工作。

下一批仍需可信 credential → 有效 identity / channel → eligibility / privacy → request context，
及逐操作 scoped authorization 的完整設計、0048-compatible readiness 與真實隔離 PostgreSQL 證據。
管理場地、出席查詢與 CSV 端點不在本批修補範圍，仍依 gate 與 0048 隔離，不能視為已安全完成。
沒有讀取 .env / 機密、連線正式或未知 DB、修改 package / lockfile、全域設定、開子代理、
執行 migration、部署、push 或 merge。此介面沒有可呼叫的 allow_tool: false hook；
本機 commit 不代替結構安全審核與部署核准。

## 第一批歷史紀錄（986fa80；以下描述該批時點）

### 狀態與邊界

基於 `6ced05a`，本批只有 forward migration `0048`、靜態契約測試與本文件。
**尚未執行 migration、連接資料庫、推送或部署；不是端到端完成。**
沒有修改 `0047`、API、身份驗證、日課、功法、依賴或環境設定；NFC gate 仍預設關閉。

`0047` 建立的 `core.practice_fields` / `core.field_attendance` 沒有 RLS。
既有 field check-in route 接受客戶端 `personId`、`volunteerPersonId`、`checkinId`，
service 直接使用 pool，不能當成可信身份或操作授權。
本批選擇封鎖資料庫入口，而不是給這些 API 增加 GRANT。

## 0048 安全策略（待隔離 PostgreSQL 驗證）

- 兩表均 ENABLE / FORCE RLS；非 superuser、非 BYPASSRLS 的普通 owner 也受 RLS 約束。
- 兩個 `AS RESTRICTIVE FOR ALL TO PUBLIC USING (FALSE) WITH CHECK (FALSE)` policy
  隔離全部讀寫；既有或意外新增的 permissive policy 不能放行。
- 撤銷 PUBLIC、API runtime、worker runtime、authorizer 的全部表權限。
- 掃描兩表現存 ACL，撤銷其他非 owner 的直接表權限及欄位權限，包含 session login、
  PUBLIC 欄位 grant、default ACL 已產生的授權及其 dependent grants（CASCADE）。
  不更動全域 default privileges 或其他資料表。
- 若兩表 owner 是受控 runtime / authorizer，整個 migration 失敗，由既有 runner rollback；
  不把資料表交給 runtime，也不變更角色 membership / BYPASSRLS。
- migration 使用 transaction-local `search_path = pg_catalog`；catalog、table 與函式引用
  schema-qualified，動態識別字以 `%I` / `quote_ident` 引用。
- 不新增 function、EXECUTE grant、session / owner 特例或 permissive policy。
  未來若要開放 controlled function，必須另審固定 search_path、schema qualification、
  非 runtime owner、明確 REVOKE PUBLIC / 最小 EXECUTE，以及 function 自身的身份與授權檢查。
- 無論 GUC 中的 person / principal、客戶端 volunteer ID、region scope 或 checkin ID 為何，
  都不構成放行條件。**目前是拒絕全部存取，不是已實作細分 region / ownership 授權。**
- 不新增 attendance 與日課的連結，不新增或改寫功法／日課；既有資料也不回填或清除。

RLS 不限制 superuser / BYPASSRLS，也不能阻止有 DDL 權限的管理者改掉 policy；
owner 固有的 DDL / TRUNCATE 權限並未消失。既有 FK referential actions 亦不是本批新增的存取路徑。
服務仍必須使用既有 NOINHERIT、無 ownership / direct ACL 的 session login，
通過 `checkApiRuntimePreflight` 後以 `withRequestContext` 切換非 owner runtime。
本批沒有證明任何實際環境符合上述角色條件。

## 不可直接部署的相容性阻擋

目前 `apps/public-api/src/admin-auth.ts` 的 `nfcMigrationVersion` 及 app 的 maximum migration
仍為 `0047_practice_fields_and_nfc_attendance.sql`。
**執行 0048 後，現版 `/health/ready` 會以 `schema_version_mismatch` 拒絕，即使 NFC gate 關閉。**
若 NFC gate 意外開啟，schema readiness 亦不能通過版本／SELECT 權限探測。

這是刻意保留、尚未解除的發布阻擋，不代表可直接把 migration 發到現有服務。
後續批次必須先完成安全 review、隔離 DB 證據及新版 readiness 的相容性處理；
不得刪除 quarantine、放寬 GRANT 或單純把 gate 開啟以修復 readiness。
本執行介面沒有可呼叫的 `allow_tool: false` hook；本機 commit 不代替結構安全審核或部署核准。

## 本地驗證結果

所有執行的測試均為純函式、mock 或靜態契約，沒有執行 PostgreSQL 測試或 migration。

| 命令                                                                                                                                                                                                                           | 結果                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @qigong/database exec vitest run tests/nfc-security-quarantine.test.ts tests/field-attendance-schema.test.ts`                                                                                                   | 54 passed（19 新契約、35 既有 schema）                                                                                                          |
| `pnpm --filter @qigong/public-api exec vitest run tests/field-checkin.test.ts tests/health.test.ts`                                                                                                                            | 58 passed；既有成功 mock 不代表舊 API 已可信                                                                                                    |
| `pnpm typecheck`                                                                                                                                                                                                               | 四個 workspace package 通過                                                                                                                     |
| `pnpm exec tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck packages/database/tests/nfc-security-quarantine.test.ts` | 新測試檔 strict typecheck 通過                                                                                                                  |
| `pnpm exec eslint packages/database/tests/nfc-security-quarantine.test.ts`                                                                                                                                                     | 通過                                                                                                                                            |
| `pnpm exec prettier --check packages/database/tests/nfc-security-quarantine.test.ts docs/operations/nfc-security-quarantine.md`                                                                                                | 通過；TS / Markdown 由既有 Prettier 格式化                                                                                                      |
| `pnpm exec tsc -p tsconfig.eslint.json --noEmit`                                                                                                                                                                               | 不通過；未修改的 `admin-branding.test.ts` 缺 fieldSchedule / attendance，`field-checkin.test.ts` 的 Fastify / pg mocks 型別不符；本批不擴大修復 |

曾在初始 REVOKE 增加 CASCADE 後，契約的舊精確字串失敗 1 項；同步契約後全部通過（1 輪修復）。
目前 Node 為 `v26.10.0`，專案要求 Node 24，pnpm 有 engine warning；須於 Node 24 再驗證。
既有 Prettier 對 SQL 的 `inferredParser` 為 null；未安裝 formatter 或假稱 SQL 已格式化／解析。
靜態契約包含移除 FORCE / ENABLE、偽造身份例外、跨區例外、未驗證 checkin link、
追加 GRANT / definer / 日課更新、移除表／欄位 ACL 清理及 owner 檢查的負向 mutation。
這些只保護 migration 文字形狀，**不證明 SQL 能執行或真實 RLS / ACL 行為**。

## 後續批次（仍需完成）

1. **可信身份與 privacy**：沿用 `line-profile.ts` 的 server-side LINE verification、既有
   credential / privacy gate 及有效 identity / interaction channel 模型，確認使用者資格、
   撤銷與政策同意。不得從 body / query / header 的 person ID 設定 request context。
   本次沒有呼叫 LINE 或其他外部 API。
2. **受控操作**：learner self-checkin 身份由已驗證 credential 導出；manual volunteer 身份
   由 authenticated admin session 導出，服務端檢查操作 permission、有效 grant 與場地 region。
   沿用 `admin.can_access_region` 等既有模型，不使用 `can_access_person` 的 self-read 分支當寫入授權。
   場地管理、出席讀取、CSV export 各自檢查 action / scope；不因登入或 self identity 自動取得權限。
3. **一致性與最小資料**：開放存取前驗證 field operational region、learner / volunteer scope、
   歷史 region 可見性與 checkin owner 一致性；GPS / student note / 匯出另處理最小揭露及 consent。
   目前 quarantine 禁止所有地區與 checkin link 存取，但沒有新增一致性 constraint，也沒有清查舊資料。
4. **產品決策**：團練 attendance 是否計入日課、使用何種功法尚未決定。
   維持 attendance 獨立／不影響日課；不得自行捏造功法。
   若未來決定開放日課連結，必須先加入同 person 的 ownership 防線及負向測試。
5. **真實隔離 DB 與發布**：只有明確證明可拋棄且隔離的本機 PostgreSQL 才可執行。
   測試 upgrade / rollback、原有資料保留、PUBLIC／direct session／role membership／column grants、
   普通 owner FORCE、missing / forged context、跨區、錯誤 volunteer / checkin owner、pool context cleanup
   與 SQL search_path shadowing；確認 pg_catalog 的 ACL 清理及 CASCADE 語意。
   再審核是否逐項替換 quarantine、增加最小 EXECUTE、更新 migration readiness。
   在此之前保持 gate 關閉，不宣稱端到端完成。
