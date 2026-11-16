# WhatsApp 團練場打卡：部署準備與關卡

**目前結論：功能分支可交付審查，正式啟用／部署仍 BLOCK。** 使用者已核准 commit／push；此次只推預設關閉的功能分支，不合併 main、不操作正式 DB。SQL、本人紀錄、Bot 私人登入回程、可操作頁面與明確通路 NFC dispatch 已接通並有測試；後台自動國家→通路配置及最終跨家族審查仍未完成。下方舊批次段落保留當時狀態，最新實作見本節。

## 功能分支的最新啟用契約

- `WHATSAPP_VENUE_CHECKIN_ENABLED` 缺省／false 時，WhatsApp 場地頁面、API、Bot 團練指令與 public `channel=whatsapp` dispatch 不啟用，不新增權限 metadata probe。
- 僅 true 時讀取 `WHATSAPP_VENUE_PUBLIC_PHONE`：必須是營運者確認的官方 WhatsApp **公開業務電話號碼**，只填 7–15 位數字，不含 `+`；不得把 phoneNumberId 或學員電話填入。此號碼用於固定 `https://wa.me/` 的預填指令連結，不授予身份或出席權限。
- 仍需要原有完整 WhatsApp transport 配置。只讀啟動傳入的 source，不從其他 process env 偷開功能。缺 transport／非法電話／非 true、false 值均 fail closed。
- 第一版 publicOrigin 固定為既有 `https://checkin.baiyinqigong.org`，與現有 Session Origin 邊界一致；不信任 Host、Forwarded 或使用者 redirect。
- 啟用時 startup／onReady／health 另要求 schema65，三個 facade 的確切 owner／SECURITY DEFINER／固定 search_path／row_security／ACL、無 membership 的隔離 roles、八個 FORCE RLS relations、六個禁止實際 UPDATE 的 restrictive policies，以及原場地時段／公開 guidance 能力。真 PG 測試涵蓋 ACL、role LOGIN、RLS 和 WITH CHECK 被改壞時 fail closed。
- NFC 直達：`/venue-checkin?venue=<code>&source=nfc&channel=whatsapp&lang=<locale>`；關閉功能時維持拒絕。LINE 的 `channel=line` 不變；場地非開放時不啟動登入或定位。WhatsApp 可獨立使用，不以 LINE 配置存在作前提。
- Bot 指令：`團練 <code>`、`团练 <code>`、`venue <code>`；可加限定的第三欄 `en`／`zh_TW`／`zh_CN` 保留回程顯示語言，不修改已存語言偏好。必須是已驗簽的私聊 sender，沿用既有核准／同意及訊息去重。私人 token 只在固定 venue page 的 fragment，不在 query／NFC／QR／localStorage。回程 source=link 如實代表 Bot 私鏈，不假稱 NFC 在場證明。
- 打卡及 history 頁重用原裝置 Session 登入／登出，登入需人為按鈕、可取消記住；私鏈 fragment 立即移除。GPS 僅在已驗資格後按打卡取得。busy 防重送；回應／commit 不明保留 uncertain；只有正式、同場地／當地日期相符 receipt 才顯示印章。
- 單頁 pin 住初次登入的 CSRF proof；不同分頁更換帳號會清空／隱藏私人紀錄，不把舊頁面默默當新帳號送出。pagehide 清除私人紀錄、bfcache 恢復重新載入。顯示場地名稱與紀錄均用 textContent，不做 HTML 注入。
- 本人紀錄每頁20筆、月份／場地篩選；已停用場地仍可查，正式／測試與不同人分隔，日期以保存的場地時區為準。不主動發 WhatsApp 打卡收據。
- **尚未完成的區域自動配置：** `defaultVenueEntryChannel` 已有 TW→LINE／MY、SG、HK→WhatsApp 的純契約，但現有 regions 只有自由 code，沒有已核對的 ISO 國碼來源；後台場地／QR 輸出尚未自動帶預設通路。不得由語言、IP 或 venue code 猜測。現階段只有明確 `channel` 的 URL 可按通路直達，不可宣稱已自動完成所有國家配置。

## 本次功能分支交付驗證

- 最終以 Node24 對全部 TypeScript 原始碼／測試執行 `tsc -p tsconfig.eslint.json --noEmit`，通過。
- 帶專用 PostgreSQL16、明確 ephemeral role teardown opt-in 的 `pnpm verify` 通過：database 801 項、public-api 4484 項、config 2 項、identity 6 項。仍有 database 27／public-api 62 項專用 runner 測試跳過，不列為通過。
- 最後檢查先發現 URLSearchParams 轉字串與測試 Promise 的 lint 問題；改為明確 toString／型別分流及 await，重跑全部檢查通過，未改動依賴或 lockfile。
- `wa-final-review-1`／GPT-6 Astra 的同家族隔離上下文補充審查為 CONDITIONAL：限定 default-off feature-branch checkpoint、等待型別／完整 DB verify 通過。這些執行結果之後已由協調者取得；不把模型原結論改寫為正式發布 APPROVE。
- `wa-final-review-2`／Gemini 回報使用額度限制，沒有跨家族結論。
- 使用者核准 commit／push；目標為 `feat/whatsapp-venue-checkin`，不是 main。此次不開 PR、不合併、不部署；實際 SHA／遠端狀態以 Git／交付訊息為準。CI 由分支推送觸發，未完成前不得宣稱通過。
- 常見 private-key／API-token 形狀與變更路徑範圍的掃描通過；這不是完整秘密掃描或獨立安全審查的替代。

## 先前 HTTP 邊界批：已實作與核對

- `apps/public-api/src/whatsapp-venue-session.ts`：Session-only HTTP 邊界。精確服務端 Origin、POST、JSON、唯一 Session／CSRF Cookie、header 配對及拒絕 body 憑證；不接受既有日課私人 token 回退。
- 此 helper **只驗證傳輸資料**，回傳的 Session／CSRF 只留伺服器記憶體，不證明登入仍有效、可打卡、已同意或 DB 已保存；尚未接任何正式 route。
- `apps/public-api/tests/whatsapp-venue-session.test.ts`：37 項傳輸邊界測試通過。
- `apps/public-api/tests/whatsapp-browser-session.test.ts`：新增僅在測試 app 註冊的 probe，以真 PostgreSQL `whatsapp_browser_session_info` 驗證有效 Session、CSRF、撤銷及私人 link 不可替代 Session；12 項真 DB 測試通過。
- 本機專用 Docker PostgreSQL 16，隨機 loopback port、獨立 test database，只有測試資料；不是正式站或共用開發 DB。
- 初次 DB baseline 因未提供 fixture role teardown 的明確 opt-in 失敗；確認專用 container ID／label 後只重建該 container，以 `TEST_DATABASE_ALLOW_ROLE_TEARDOWN=true` 重跑成功。不修改 migration 安全 guard，也不放寬正式角色檢查。
- 先前嘗試的 `venue-qr-postgres.test.ts` 因缺該套件要求的專用 PG runner 而跳過，**不列入 DB 通過證據**。本批 49 項通過僅指 37 項新邊界與 12 項真 Session 測試。
- Node 24 `pnpm verify` 通過。該次全量 verify 未帶 TEST_DATABASE_URL，因此其餘被跳過的 DB 整合測試仍不算通過。
- `wa-session-review`／`cliproxyapi/gpt-6-astra` 靜態唯讀補充審查：helper APPROVE、月份 `.length(7)` 修正 APPROVE、後端部署 BLOCK。Reviewer 未自行執行測試，執行證據由協調者提供。這是同家族、獨立上下文審查，不構成跨家族驗證。
- 沒有新增 migration／RLS／DB grants，沒有變更正式入口、Bot、現有日課登入或正式服務。

## SQL 唯讀資格候選階段記錄（schema65 整合前）

- 已新增可執行的 Session-only 唯讀 DDL 候選與隔離 DB 測試；詳見 [Session SQL 權限圖與測試證據](whatsapp-venue-session-authority.md)。
- 新 isolated reader／RLS 僅在隔離 DB 套用實測，21 項通過；不含出席 writer、沒有正式 route，也未加入部署 migration 鏈，正式 schema 仍維持原版本。
- GPT-6 Astra 同家族補充審查對限定唯讀候選 APPROVE、後端部署 BLOCK；不取代跨家族最終審查。
- status 成功不能授權未來另一個交易寫出席；下列 writer／撤銷競態／完整整合關卡仍未完成。

## 出席 writer／API 候選階段記錄（schema65 整合前）

- 新增 `packages/database/sql-candidates/whatsapp-venue-checkin-writer.sql` 與 `apps/public-api/src/whatsapp-venue-routes.ts`。候選 SQL 仍不在 migration 鏈；API adapter 僅由測試 app 明確註冊，正式 composition root 未接線。
- `packages/database/tests/whatsapp-venue-writer.test.ts` 的 26 項真 PostgreSQL 16／HTTP 整合測試通過；`apps/public-api/tests/whatsapp-venue-routes.test.ts` 的 28 項 unit tests 通過。Node 24 `pnpm verify` 在修正測試未使用參數的 lint 錯誤後通過。
- writer 用持久化 Session／CSRF 雙 hash 限定 RLS；runtime 不可切換 owner、不接受 personId 或私人 link 回退。鎖順序為 channel → Session → identity → application → person，等待後重讀資格與 DB clock。
- 新 role 只有行鎖所需的欄位級 UPDATE(id)；專用 restrictive WITH CHECK(FALSE) 禁止實際更新身份資料。真 DB 測試證實可取鎖而不能 UPDATE id=id。
- 已知無效 Session 在 global policy/admin lock 前先拒絕；此預查不授權寫入。1919,1 lock 只在 DB 交易內持有，以配合既有 policy publication／admin suspension，沒有 GPS／provider／其他網路等待。
- writer 不取得 privacy-subject advisory lock；使用純 privacy_status 與 acceptance SHARE lock，並在同交易內檢查 consent。測試涵蓋 logout 先／後取得 Session 鎖、等待時 Session 失效、併發去重、同日 replay、跨場、馬新港當地日期、時段／半徑重驗證、無原始 GPS／聊天收據。
- API 在提交前驗證 receipt 正式形狀、當地日期與請求 venue 綁定，異常回滾；commit／transport 不明回傳 uncertain，不聲稱確定未寫入。status／checkin 設定 route rate limit；最終 composition root 仍須保留既有 rate-limit plugin。
- `wa-write-review-1` GPT 呼叫逾時，已確認沒有殘留匹配 reviewer process、未取得結論；`wa-write-review-2` Gemini 回報額度限制，未取得結論。
- `wa-write-review-3`／GPT-6 Astra 重試完成：限定 writer／API 候選 APPROVE，完整部署 BLOCK。此為同家族隔離上下文靜態審查，未由 reviewer 重跑測試，不替代跨家族審查。
- Reviewer 額外指出：場地設定 SELECT 沒有取 field row lock，因此不能聲稱已保證「管理員停用／修改半徑／時段提交後，所有尚未完成交易必須失敗」。現有候選只依 SQL 寫入時的規則／RLS 驗證，不宣稱更強的管理更新線性化保證；若產品要求此保證，需另作並行測試與序列化設計。

## Schema65 相容性整合（已核准並完成本機驗證，未部署）

使用者已核准超過五檔的整合批次。已加入 `0065_whatsapp_venue_authority.sql`，保留候選 SQL 的實際 DDL 本體不變；沒有改寫已發布的 0001–0064 migration。同步 schema64／65 的明確相容判斷、venue suite 精確 ACL 與安全 fixture teardown；不註冊正式 WhatsApp 場地路由。

本批原估至少十檔；全量回歸另發現既有 `venue-suite.test.ts` 固定三 grantees 的契約需同步，實際十一個程式／測試檔如下（另更新本發布紀錄）：

1. `migrations/0065_whatsapp_venue_authority.sql`：整合前已核對最新編號，保留既有已發布 SQL 不變。
2. `apps/public-api/src/app.ts`：maximum schema 及既有各功能的向後相容判斷。
3. `apps/public-api/src/venue-suite.ts`：明確 ledger count/version 相容性。
4. `apps/public-api/tests/health.test.ts`：新舊版本健康／功能 gate 回歸。
5. `packages/database/tests/repository-migrations.test.ts`：migration 鏈及最新版本契約。
6. `packages/database/tests/venue-renumber-integration.test.ts`：完整鏈期望。
7. `packages/database/tests/admin-mcp-read-facade.test.ts`：完整鏈最新版本，不修改已發布 admin MCP migration。
8. `packages/database/tests/isolated-venue-roles.setup.ts`：新永久 isolated roles 的安全 fixture teardown。
9. `packages/database/tests/whatsapp-venue-authority.test.ts`：正式鏈已有權限時不可重複套候選／錯誤清理既有角色。
10. `packages/database/tests/whatsapp-venue-writer.test.ts`：同上，保留非 superuser 和真 DB 競態驗收。
11. `apps/public-api/tests/venue-suite.test.ts`：保留歷史精確 2／3 授權，僅 schema65 精確允許第四個 isolated writer；仍排除 PUBLIC、runtime／worker 及 grant option。

### 本批驗證與審查

- 73 項 focused 測試通過，包括真 PostgreSQL64→65 升級、原 identities／Session credentials／LINE writer 定義與 ACL／既有 ledger checksums 保留、idempotency、新權限與出席 HTTP 整合、真實健康／LINE guidance 能力檢查，以及 WhatsApp 路由預設未啟用。
- 帶專用 Docker PostgreSQL16 與明確 fixture teardown opt-in 的 Node24 `pnpm verify` 通過：database 791 項、public-api 4412 項、config 2 項、identity 6 項。首次全量僅固定 SQL 契約斷言失敗；修正契約並保留更嚴格版本邊界後重跑通過，未刪除或放寬安全斷言。
- 仍有 27 項 database、62 項 public-api 的專用 local-PG runner 場景被跳過，不列為通過；TEST_DATABASE_URL 並不會啟用這些另有隔離 runner 邊界的測試。
- `wa-schema-review-1`／GPT-6 Astra 同家族、隔離上下文的靜態補充審查為 CONDITIONAL，未發現新增高／重大阻擋；其要求的全量 DB verify 之後已由協調者完成。Reviewer 未執行測試，不自動把其結論改記 APPROVE。
- Reviewer 提醒 61／62 的既有 startup allowlist 並非一概允許；協調者核對 HEAD diff，該限制不是本批新增。本批只宣稱保留既有明確邊界與 schema64，再明確加入65，不宣稱任意歷史版本皆可用。
- `wa-schema-review-2`／Gemini 仍回報額度限制，沒有跨家族結論。完整產品／發布仍 BLOCK。

### 正式發布前的 schema 回退限制

- 舊 max64 binary 在65資料庫會 fail closed；測試已確認。因此未來必須先在 schema64 部署經驗證、可相容64及65且新通路關閉的程式，同時準備同樣支援65的 fallback build，再套用65 migration。
- migration 失敗時由交易回滾，保持64 ledger／資料與相容程式；成功後若程式需回退，只能使用65相容且新功能關閉的 fallback，不可默默切回舊 max64 binary。
- 不靠 DOWN migration 或覆寫已接收新寫入的 DB 備份來回退。DB 備份、checksum、ACL 差異、健康檢查及功能 gate 仍須在真正發布時核對；本機驗證不是正式操作授權。

這只是 schema／相容性整合，不等於完整產品就緒。本人紀錄 SQL／API、Bot 團練指令與私人登入回程、可操作前端、後台國家／通路設定、公開 NFC WhatsApp 直達及統一 gate 仍須依規格實作。未完成前不可把唯讀 preview 或目前候選 API 當成已可部署的完整功能。

## 發布必要項目

- [ ] 定稿並審核 WhatsApp Session-only SQL facade、function owner、累積 ACL／membership／default ACL、RLS 與內部呼叫圖。
- [x] 本機實作 additive migration65 並完成完整鏈／64→65 升級驗證；不修改已發布 migration，不賦予 runtime 任意 person 出席權限，不借用 LINE 或 debug authority。尚未發布／套至正式 DB。
- [ ] 同一寫入交易內重新驗證 Session＋CSRF、身份、主通路、資格、同意、場地時段／半徑；驗證鎖順序與撤銷線性化點。
- [ ] 隔離 DB 測試新 facade 的直接 SQL／假 GUC／越權／併發／replay／response 遺失／跨日／DST／正式與測試隔離。
- [x] 本機實作受預設關閉 gate 控制的場地／本人紀錄 API；SQL 同交易授權，helper 不作 SQL 授權替代。未正式啟用。
- [x] 已新增可操作的登入／打卡／紀錄頁與合成 SDK／網路／GPS 狀態測試；舊 readonly preview 保留但不作正式頁面發布。
- [x] 私聊指令、私人回程、Session／跨分頁身份穩定性有實作與測試。不同瀏覽器不共享 Cookie，必須開新的私鏈登入；沒有假裝跨瀏覽器自動登入。
- [ ] 後台可信地區設定及通路 gate 完成後，才發布台灣 LINE／馬新港 WhatsApp 的 NFC／QR；未開功能不發失效網址。
- [ ] LINE 場地／日課、WhatsApp 日課／Session／隱私、無主動聊天收據回歸通過。
- [ ] 最終 diff 的跨家族或具 PostgreSQL RLS 經驗的人工安全審查完成；目前 Gemini 額度錯誤不能算通過。
- [ ] commit／push／CI／發布依使用者授權與專案關卡執行，發布前核對 SHA、migration 清單、checksum、部署包及服務設定。
- [ ] 正式資料備份及可驗證回退計畫；先備 DB，再套經審查 migration，最後切換程式與功能 gate。回退先關新功能，不刪除已記錄出席或倒退資料。
- [ ] 公開 HTTPS／健康檢查、唯讀場地狀態、服務日志的去識別驗證；不得用正式 learner 模擬出席／徽章或寫入真實測試紀錄。

## 下一個實作批次

以 API／授權契約的未決點為輸入，具體完成 SQL facade 與 RLS／鎖設計及可執行隔離測試，逐批至多五檔。完成新 writer 之前，不能把 Session probe 的 12 項 DB 通過擴大解讀為團練出席寫入已驗收。
