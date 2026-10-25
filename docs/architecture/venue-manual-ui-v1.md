# 團練場出席管理：人工補簽／作廢獨立 UI v1

**狀態：未掛載、未接線、功能尚未開放。** 本批只有獨立 renderer、controller、嚴格契約與離線測試；沒有公開查詢／寫入 API、SQL、migration、production transport 或預設成功實作。fields／reports 工作包尚未合併，本批不匯入其檔案，也不修改其保留 worktree。

## 檔案與組合邊界

- `apps/public-api/src/venue-manual-contract.ts`：所有邊界以 `unknown` 接收，Zod strict object 驗證；不接受額外欄位或型別 coercion。
- `apps/public-api/src/admin-venue-manual-page.ts`：`createVenueManualController`、`renderAdminVenueManualPage`、`mountVenueManualPage`、專用 CSP 與靜態 CSS。
- `apps/public-api/tests/venue-manual-ui.test.ts`：只有這裡明確注入的測試 adapter 可演練成功。測試 CSRF token 在測試程序內隨機產生，不硬編測試金鑰，不是 production key、session 或授權憑證。
- 本文件：父代理後續接線前的必要契約，並非已實作的後端能力聲明。

初始 renderer 與 controller 預設全部停用；只有 server-owned model **以及**明確注入的 `TrustedVenueManualAdapter` 同時存在且模型驗證成功，才可能操作。單獨傳入 capability 或 transport 仍停用。

`kind: 'trusted-venue-manual-adapter'` 只是組合依賴標記，**不是不可偽造的憑證**。瀏覽器可修改 JS、DOM 與 capability；所有資料可視範圍及每次操作仍須由後端可信 session 重新授權。禁止從 query、localStorage、隱藏欄位或 volunteer 自報 identity 建立授權。

`renderAdminVenueManualPage` 產出完整 HTML，但刻意不載入 script、不註冊 route。`mountVenueManualPage(root, controller)` 為可測試的真實 delegated submit binding，返回 unmount function。父代理必須另行提供經審查的同源外部 bootstrap／瀏覽器 bundle（包含 Zod 相依的正確解析）；目前 TS module 的 bare imports 不能直接當成已可部署的瀏覽器資產。

掛載時由可信組合層提供 serverModel、transport，並以 `readCookie: () => document.cookie` 讀取當前 CSRF；未提供 cookie reader 預設無 token，不能送出。不得把後端 session 值或其他秘密序列化進頁面。

## UI 流程與失敗行為

```text
停用：缺模型／缺 adapter／模型無效

edit → 搜尋既有學員 → 明確選擇結果 ID、場地、當地日期 → 核對既有紀錄
     → 填寫原因 → review → confirmed → submitting → applied
                    ↓         作廢另需 secondConfirmed
                 返回修改                      ↓
                                     blocked：拒絕／衝突／結果不明
```

- 搜尋結果只顯示姓名、地區名稱與學員 ID。同名也不預選、不自動歸戶、不建立學員；姓名、搜尋文字都不是 identity。沒有電話欄位，也不回傳電話、原始 GPS 或私密心得。
- 補簽必須使用已搜尋、明確選擇並已核對紀錄的 tuple；修改日期／場地後須再核對。原因 trim 後 1–1000 字，確認頁重述姓名／ID、場地、日期、時區、原因及操作識別碼；尚未呼叫操作 adapter。
- 作廢只接受剛核對的 active record ID 與確切原版本，原因必填；確認頁有兩個各自必填的 checkbox 與明確「二次確認作廢」按鈕。不刪歷史、不修改日課。
- 操作識別碼在進入 review 時產生，送出使用同一 immutable request；本 controller 不重用已配置過的 key。返回修改不呼叫操作；之後重新 review 產生新 key。
- `submitting` 同步設 busy，阻止所有重入、再查詢、修改、返回或下一筆；不自動重試。`applied` 只在 strict 且可對應本次操作的後端 receipt 出現；一般 HTTP 2xx、空結果或任意 `success` 字樣都不是成功。
- 補簽 receipt 核對 operation、key、tuple、active 狀態與場地時區，並拒絕與其他已知紀錄 ID 碰撞。作廢 receipt 核對 operation、key、原 record ID、原版本 + 1、voided 狀態、tuple 與歷史時區。
- `unauthenticated`／`forbidden` 清空學員、紀錄與 pending，禁止繼續；其他明確拒絕保持 blocked，沒有靜默改版本或重送。
- 例外、網路逾時、格式錯誤或 receipt 不符都視為「結果不明」，**不表示後端未寫入**。保留 pending key 並停用操作。父代理須在可信後端依 key 對帳後，才決定如何建立新的 controller；不能用重新整理／新 key 盲目重試。此批沒有自動解除 blocked 或 reconciliation API。
- 同人同場同日只准一次，包含作廢歷史；不提供重新啟用／刪除後補回。允許同人同日跨不同場地。本地保留已看過的紀錄作保守去重，即使之後的查詢漏回該列也不忘記；這不是跨頁／跨分頁／跨程序的唯一性保證。

## 嚴格資料契約

所有 ID 都是 UUID；version 為正整數且不超過 `Number.MAX_SAFE_INTEGER`；日期必須真實存在且為 `YYYY-MM-DD`。不接受時間戳當日期、字串版本或寬鬆 parse。姓名／地區／場地名稱各 1–200 字。

### Server-owned model

| 欄位               | 規則                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------- |
| `capabilities`     | 明確 boolean：`canSearchLearners`、`canReadRecords`、`canManual`、`canVoid`；僅 UI 提示 |
| `venues`           | 最多 200 筆、ID 唯一；每筆只含 `id, displayName, timezone`                              |
| `minDate, maxDate` | 後端制定的可用日期範圍，min ≤ max；不得由瀏覽器決定補簽政策                             |

查詢只在 canSearchLearners 與 canReadRecords 均為 true 時可用；補簽／作廢各自另需對應 capability。停用 UI 不代替查詢端及操作端授權。

### Adapter（無預設端點）

| 方法             | 輸入                                   | 回應                                                                |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------- |
| `searchLearners` | `{query}`，trim 後 2–80 字             | `{learners: [{id, displayName, regionLabel}]}`，最多 50 筆、ID 唯一 |
| `readRecords`    | `{learnerId, venueId, attendanceDate}` | `{records: [record]}`，最多 100 筆、ID 唯一；每列必須屬於本次 tuple |
| `operate`        | 下列 discriminated union               | 下列 applied／rejected union                                        |

```ts
// 人工補簽
{ operation: 'manual', learnerId, venueId, attendanceDate, reason, idempotencyKey }

// 作廢；不接受前端自報原姓名、地區、場地或日期
{ operation: 'void', recordId, expectedVersion, reason, idempotencyKey }

// 最小 record，不含個人隱私或 actor identity
{ id, version, learnerId, venueId, attendanceDate, attendanceTimezone, status: 'active' | 'voided' }

// 後端交易已確認提交後才可回 applied
{ status: 'applied', operation: 'manual' | 'void', idempotencyKey, record }

// 必須保證未提交此次異動，才可明確回 rejected
{ status: 'rejected', code: 'unauthenticated' | 'forbidden' | 'conflict' | 'unavailable' | 'invalid' }
```

UI 的 `{confirmed: true, secondConfirmed: boolean}` 是本地確認狀態，作廢必須二者為 true。這不是 server 授權／人類同意的可驗證證明，不作為繞過 server checks 的依據。

request **不包含** `volunteerId`、`principalId`、`actorId`、`identity`、授權 region、GPS、日課內容或前端自行宣稱的 timezone。`learnerId` 是目標學員 ID，不是 actor ID。

`operate` 另外收到 `{credentials: 'same-origin', headers: {'x-csrf-token': token}}`。token 從既有 `__Host-qigong-admin-csrf` cookie 取得；缺少、重複、無效或讀取失敗都不呼叫操作。未來 HTTP adapter 必須保留同源 cookie credentials、header、JSON content-type 與 no-store，不可把 token 放在 URL 或 request body。server 必須沿用 `admin-auth.ts` 的 session 解讀與 timing-safe CSRF cookie/header 比對，另做 Origin／Fetch Metadata 等同源防護；前端的格式檢查不是 CSRF 驗證。

## 最小 server 安全門檻（全部待實作與審查）

1. **可信身份**：由既有 HttpOnly admin session 解析目前有效 principal，並解析其可信 volunteer／管理員對應；無對應或 session 過期／撤銷即拒絕。不得接受 request 指定操作人、角色、region 或 runtime DB role。登入成功不代表可補簽／作廢。
2. **每次重新授權**：查詢、搜尋、讀紀錄、補簽與作廢分開檢查最小必要權限／指派；model flags、目前舊 route、migration 版本或 NFC ready 檢查都不構成新流程可用的證明。不得繞過目前 NFC quarantine／未完成的 security gates。這份 spec 不宣稱任何現有 permission 名稱已足夠。
3. **Region scope**：server 查出可信場地所屬 region、學員在出席日期的有效 region membership、actor 當前有效指派／授權；三者依已審核的區域與歷史時間政策逐項匹配。跨區／跨層級需明確授權，不因同名、既有 record ID 或前端 venue list 放行。作廢先從 record 取得 learner／venue／日期，再做相同授權。查詢也要先限縮 scope，不能先回全量再由 UI 過濾。
4. **存在性與輸入**：strict schema 驗證後，仍要驗證 learner 是可用既有身份、venue 存在且允許該日期、日期在補簽窗口；拒絕未授權 learner／venue ID、過期指派及無法取得權威時區的資料。日期上限、未來日期及跨日政策由 server 時計與業務規則決定。
5. **並行唯一性與版本**：交易中強制 `(learnerId, venueId, attendanceDate)` 唯一，含作廢 tombstone；不能錯用 `(learnerId, attendanceDate)` 阻擋跨場。作廢以 record ID、active 狀態和 expectedVersion 做原子 compare-and-swap，版本恰好 +1；0 rows 更新視為 conflict，不刪 record／audit。若儲存層尚未支援，功能保持關閉；本批不新增 migration。
6. **持久 idempotency**：在同一原子交易保存可信 actor、operation、key、canonical payload digest、結果／record version；同 key 同 body 在重新授權後可回原 receipt，同 key 異 body 必須 conflict。撤權後不得透過 receipt replay 洩漏舊資料。server 去重須涵蓋跨分頁、程序及網路重送；controller 的 busy 不能替代它。
7. **稽核**：追加不可變 audit，記 server-resolved actor／volunteer、session 關聯、request/correlation ID、operation、目標 learner／venue／region、record ID、原與新版本、必填原因、idempotency key、來源 `volunteer_manual`、UTC server 時間與核准的歷史時間快照。作廢為追加事件與狀態轉換，不抹去原紀錄。業務異動與 audit 同交易提交；失敗則不可回 applied。原因屬受限 audit 資料，不寫一般存取 log；不記 cookie／token、電話、原始 GPS 或私密心得。
8. **資料隔離**：只改團練場出席，不新增／修改／刪除日課、簽到天數、勳章進度或私人心得。若未來要影響其他系統，須另立已審核契約，不由此 adapter 擴張副作用。
9. **回應與失敗**：登入失效／無權限對應 401／403、嚴格表單錯誤 400、重複／舊版本 409、依賴不可用 503，由審核後 adapter 映射到 union。timeout／傳輸中斷無法確定交易結果時必須丟出例外／進對帳，不能虛構 rejected 或成功。回應只投影白名單欄位，不能直接傳 DB row 或原始錯誤。

## UTC、當地日期與歷史時區

- 儲存與稽核的實際事件時間／建立時間／作廢時間以 UTC `timestamptz`，API 如需呈現應為明確 `Z` 的 ISO instant；用 server 時計，不相信瀏覽器時鐘。
- `attendanceDate` 是選定場地的當地曆日，不是 UTC 日期，也不是人工補簽送出時間。不得用 `new Date(date).toISOString()`、browser timezone 或 `UTC::date` 來推定出席日；契約中的 UTC 日期 round-trip 只用於檢查曆日合法性，沒有業務時區轉換。
- `venue.timezone` 是 server 提供的 IANA zone（或 UTC），供人工補簽確認；不是 request 可覆寫的欄位。server 須使用對該出席日期有效的權威 zone／設定版本，保留到 record 的 `attendanceTimezone`。
- 查詢 record 回傳其不可變 `attendanceTimezone` 快照。作廢確認頁使用該歷史 zone，不以現在的 venue 設定覆蓋；receipt 也必須保持相同值。
- 若從可信 instant 判定出席日，須以 server zone 取得 local date，日界使用 `[local day start, next local day start)`；DST 日可能是 23／25 小時，不加固定 24h，也不捏造一次午夜 instant 當人工到場時間。
- 不因場地後續換時區重算既有 attendanceDate／唯一鍵。最早日期、補簽天數、同日跨時區語義與歷史 region 判定須由後端明訂；沒有權威設定則 unavailable。

## 輸出安全與可用性

姓名、地區、場地與原因在所有 HTML context escape `& < > " '`；日期／ID／版本也先驗證。只將本 renderer 的結果放入 root，不插入 adapter 提供的 HTML。無 `eval`、`new Function`、inline script、inline event handler、外部 CDN 或預設 fetch。

父代理須對整頁設定匯出的 `venueManualContentSecurityPolicy`，不要套用既有允許 unsafe-inline 的 admin shell CSP。CSS 為固定內容的 SHA-256 hash 授權；測試核對實際 bytes。script 僅允許經審核同源外部模組；`form-action 'none'` 在 script 未載入時阻止原生表單誤送。另設 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`，不得公開快取搜尋／確認內容。

支援 viewport 縮放、48px controls、大按鈕、可換行長字串、label／fieldset／legend、skip link、鍵盤 focus-visible、aria-live status；review focus 到標題，其他轉移到 status。unbind 移除事件與訂閱。測試包含真正 binding 的最小 DOM harness，但未進行實體瀏覽器／螢幕閱讀器驗收；父代理仍須補行動版、200% 縮放、純鍵盤與 assistive technology 檢查。

## 父代理待掛載（本批未完成）

- [ ] 先審查並整合 fields／reports／security 工作包，不改其保留 worktree，不假設前批已合併。
- [ ] 完成可信 admin session／volunteer mapping、region 授權、資料層唯一性／version／idempotency／audit 及對帳流程；補真正後端負向與並行測試。
- [ ] 建立需登入且逐項授權的最小搜尋／紀錄查詢投影；避免 PII 洩漏、跨區存在性探測，加入 pagination／搜尋限制與 rate limiting。
- [ ] 另行審核寫入 route、同源 transport、CSRF／Origin、JSON union 回應與結果不明對帳；此批沒有可直接掛上的 HTTP endpoint。
- [ ] 建立同源 browser bundle／bootstrap，明確注入 model 與 adapter，不從 window 全域／capability 自動啟用，並帶入當前 CSRF cookie reader。
- [ ] 經審查後才掛載頁面、navigation、CSP／no-store headers；此批沒有修改 app.ts、admin-auth.ts、dashboard、既有 routes、index 或依賴。
- [ ] 補行動版／鍵盤／縮放／reader、跨分頁重送、過期 session、撤權、跨區、重複、舊版本、DST／日界及未知結果對帳驗收。全數安全門檻完成前保持 unavailable。

## 離線驗證

以下都不連 DB/API、不執行 migration；不要為了跑本批測試載入 `.env` 或 production secrets。

```sh
pnpm exec prettier --check apps/public-api/src/venue-manual-contract.ts apps/public-api/src/admin-venue-manual-page.ts apps/public-api/tests/venue-manual-ui.test.ts docs/architecture/venue-manual-ui-v1.md
pnpm exec eslint apps/public-api/src/venue-manual-contract.ts apps/public-api/src/admin-venue-manual-page.ts apps/public-api/tests/venue-manual-ui.test.ts
pnpm --filter @qigong/public-api typecheck
pnpm exec tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --esModuleInterop apps/public-api/src/venue-manual-contract.ts apps/public-api/src/admin-venue-manual-page.ts apps/public-api/tests/venue-manual-ui.test.ts
pnpm exec vitest run apps/public-api/tests/venue-manual-ui.test.ts apps/public-api/tests/admin-branding.test.ts
```

本次新增測試 35 項；既有 branding 回歸 24 項。額外嘗試的 `tsc -p tsconfig.eslint.json --noEmit` 包含全倉庫既有測試，因既有 `admin-branding.test.ts` 的 AdminPage map 缺項、`line-profile-integration.test.ts` implicit any，以及未連結的其他 package dependencies 等未通過；不在本批禁改範圍內修補。public-api source 與新增三個 TS 檔的獨立 strict typecheck 另行驗證。

執行環境為 Node v26.10.0／pnpm 10.15.1，專案要求 Node 24，pnpm 有 engine warning；需由父代理在受支援 Node 24 環境再驗證。依賴只暫時借用主 checkout 已安裝的 node_modules（本 worktree 的符號連結），不安裝套件、不修改 package／lockfile，驗證後移除連結。未執行全套可能涉及 DB 的 integration tests。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
