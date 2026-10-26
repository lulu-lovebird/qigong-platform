# 團練場出席管理：四分支本地整合紀錄

> 未部署 venue 原 0047／0048／0049／0050 已順延為 0048／0049／0050／0051；已發布 invitation 0047 不動。
> 本文件下方舊檔名、SHA 與測試數字是重編號前歷史，保留不改寫；現行版本見 [本地整合紀錄](venue-renumber-integration.md)。
> 本文件下方是先前批次的歷史紀錄。最新授權及交付見 [QR 完整流程／隔離演練](venue-qr-checkin.md)：
> 已移除未核准的 k5／姓名額外權限／跨區拒絕提案，新增現行 0051 與獨立 QR／後台成功路徑。
> 舊 NFC 路由及管理寫入仍未啟用；不再以本文件舊的 deny-only 狀態描述整個目前程式。
> Node24／10 項隔離真 PG 已通過；真 LINE／手機及本輪獨立安全審查未完成，沒有部署或 push。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 範圍與版本

本批為使用者明確核准的本地整合，不是功能啟用、migration 執行或部署核准。
唯一寫入代理在父 checkout 順序操作；沒有開子代理或更動任何保留 worktree。
開始時工作樹乾淨，base 為 `8d46dc143c108da5e2399d78f1bdb9c68300367b`。
先讀 AGENTS、四份交付文件與各分支 against base 的完整 diff，再依序 `--no-ff` merge。

| 分支                               | 已核對交付 head | 本地 merge SHA                             | 批次檔數 |
| ---------------------------------- | --------------- | ------------------------------------------ | -------- |
| `feature/venue-admin-security-v1`  | `5ffbcdf`       | `a8fe269d20ed23cc021f4d2a9ee05bd7b455447a` | 5        |
| `feature/venue-admin-fields-v1`    | `33715c4`       | `9b58771984dd71514f028775a32fcbe7f43299ee` | 5        |
| `feature/venue-admin-reports-v1`   | `81e47c5`       | `a5d26773a3ecaec7c27ed384a795087bc2cf2c14` | 5        |
| `feature/venue-admin-manual-ui-v1` | `98ae326`       | `194e543db564c0d576f897aeca7e0c656bf85ef1` | 4        |

四次 merge 無衝突，保留所有 merge commits。reports 後先提交單檔測試修補
`8dc129e2cee0916579ddce9c600514edc3359355`，再合併 manual-ui。
最後小批僅兩個 readiness 測試檔與本文件（3 檔）；最終 HEAD 為包含本文件的提交，
以 `git rev-parse HEAD` 取得，不在文件內自我引用 SHA。

## 審閱與變更摘要

- Security：整合已交付的 0049、最小 LINE identity snapshot resolver、四個獨立 permission、
  session-bound runtime transaction 與 deny-only 場地／出席操作。沒有額外 migration。
  0049 **不是全部函式皆拒絕**：identity mapper 可回最小 snapshot，authorization predicate
  可回 RBAC 前置判定；但場地 read/write、attendance read/export 均無資料成功分支。
- Fields：移除舊 fail-open permission probe 與直接場地 SQL；已登入也只能取得 false
  capability／503。UI 大字、disabled、CSRF、固定錯誤提示；入口使用
  `/venue-checkin?venue=…&source=nfc|qr|link`。不再呼叫第三方 QR 服務；QR helper 僅回目標網址。
- Reports：移除出席查詢／CSV 的 fail-open 與直接表 SQL；保留明確 503，沒有假空列表／CSV。
  新增獨立 renderer、台北日期半開區間、去重月份統計與最小投影／公式防護 CSV 純函式。
- Manual：只整合 strict contracts、獨立 renderer/controller 與測試；無 route、bootstrap、
  預設 transport 或 production 成功 adapter。缺 server model／adapter 時 disabled。
- `admin-attendance.test.ts`：確認交付規格演進後，更新原有六項 URL／QR 及三項頁名／導覽
  測試，保留所有既有資料驗證／CSV 負向測試；新增不安全 LIFF 配置拒絕案例，並加強
  legacy code 拒絕、無 LIFF 不 fallback、第三方 QR 禁止與 capability-hidden 導覽斷言。
  原 23 tests 成為 24 tests，沒有改 production 行為讓測試過關。
- `health.test.ts`／`field-checkin.test.ts`：把精確的
  `0049_venue_attendance_security_contract.sql` 加入拒絕矩陣。確認 default-off 的
  startup／health 仍拒絕此 ledger，explicit opt-in 亦無法註冊 NFC routes；不放寬版本範圍。

`app.ts`、`admin-auth.ts`、既有 LIFF 日課／venue preview、0047／0048、依賴與 lockfile、
ESLint config 均無相對 base 差異。新報表不輸出心得、原始 GPS、電話或內部去重 IDs；
沒有建立／修改日課或連結 checkin。名稱保留「團練場出席管理」。

## 逐批驗證（全部本地、無 DB）

所有 Vitest 命令均 `env -u TEST_DATABASE_URL`；未載入 .env／secrets。
現成 node_modules 可用，未安裝或更新依賴。Node `v26.10.0`、pnpm `10.15.1`、
Vitest `3.2.7`；Node **不是**專案要求的 24，engine warning 已保留，仍需 Node 24 重驗。

### 批次 1：security merge

```sh
env -u TEST_DATABASE_URL pnpm --filter @qigong/database exec vitest run tests/venue-attendance-security.test.ts tests/nfc-security-quarantine.test.ts tests/field-attendance-schema.test.ts
```

結果：exit 0，170 passed、10 skipped。十項 skip 是尚未實作的 PostgreSQL 驗證矩陣，
不是可直接開環境變數執行的完整 DB tests。

### 批次 2：fields merge

```sh
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/venue-fields-ui.test.ts tests/admin-navigation.test.ts tests/admin-dashboard.test.ts tests/admin-auth.test.ts tests/admin-branding.test.ts tests/field-checkin.test.ts tests/health.test.ts tests/line-venue-checkin.test.ts tests/line-checkin-nfc.test.ts tests/line-learner-identity.test.ts tests/line-profile.test.ts tests/request-log-privacy.test.ts
```

結果：exit 0，320 passed、2 DB-dependent skipped。

### 批次 3：reports merge，與單檔相容修補

```sh
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/venue-attendance-report.test.ts tests/admin-attendance.test.ts tests/admin-navigation.test.ts tests/admin-reporting.test.ts tests/field-checkin.test.ts tests/health.test.ts
```

首次 exit 1：195 passed、16 skipped、9 failed。九項均為已交付 fields 規格淘汰的
舊 URL／外部 QR／導覽文字，並非 DB 或授權失敗；未修改安全邏輯。

```sh
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/venue-attendance-report.test.ts tests/admin-attendance.test.ts tests/venue-fields-ui.test.ts tests/admin-navigation.test.ts tests/admin-reporting.test.ts tests/field-checkin.test.ts tests/health.test.ts
pnpm exec prettier --write apps/public-api/tests/admin-attendance.test.ts
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/admin-attendance.test.ts
```

一輪修補即通過：238 passed、16 skipped；格式化後單檔 24 passed。未耗盡三輪修復預算。

### 批次 4：manual-ui merge

```sh
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/venue-manual-ui.test.ts tests/admin-branding.test.ts tests/venue-fields-ui.test.ts tests/venue-attendance-report.test.ts tests/admin-attendance.test.ts
```

結果：exit 0，192 passed，無 skip。

### 最後 readiness 負向案例批次

每檔修改後即測試；兩檔使用既有 Prettier，沒有手動格式化。

```sh
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/health.test.ts
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/health.test.ts tests/field-checkin.test.ts
pnpm exec prettier --write apps/public-api/tests/health.test.ts apps/public-api/tests/field-checkin.test.ts
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/health.test.ts tests/field-checkin.test.ts
```

依序 21 passed、79 passed、79 passed，全部 exit 0。`field-checkin` 多兩項參數化測試，
分別覆蓋 buildApp 與直接 registerAdminRoutes。

## 最終回歸與靜態檢查

```sh
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api test
env -u TEST_DATABASE_URL pnpm --filter @qigong/database test
env -u TEST_DATABASE_URL pnpm typecheck
env -u TEST_DATABASE_URL pnpm build
env -u TEST_DATABASE_URL pnpm lint
```

| 命令                                         | 結果                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| public-api 全套（最終 readiness 修改後重跑） | exit 0；58 files passed、20 skipped；1253 tests passed、233 DB-dependent skipped                                                                      |
| database 全套                                | exit 0；4 files passed、43 skipped；173 tests passed、292 skipped（含上述 10 項待實作 PostgreSQL tests）                                              |
| typecheck／build                             | 各 exit 0，四個 workspace package 通過；最後測試修改後亦重跑                                                                                          |
| 全倉 lint                                    | exit 1，既有 `apps/public-api/tests/line-checkin-nfc.test.ts` 8 errors（7 unused-vars、1 no-base-to-string）；該檔及 ESLint config 相對 base 均無差異 |

reports 分支已消除原 attendance routes 的一項 unused-vars，因此原文件所記 baseline 9 errors
在整合後為 8；沒有擴大修改舊 NFC 測試，也不宣稱全倉全綠。

所有變更 TS 檔（含既有 export index）已單獨跑 ESLint，exit 0。新增／修改測試亦執行：

```sh
pnpm exec tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop apps/public-api/tests/admin-attendance.test.ts apps/public-api/tests/venue-attendance-report.test.ts apps/public-api/tests/venue-fields-ui.test.ts apps/public-api/tests/venue-manual-ui.test.ts packages/database/tests/venue-attendance-security.test.ts
pnpm exec eslint apps/public-api/tests/health.test.ts apps/public-api/tests/field-checkin.test.ts
pnpm exec tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop apps/public-api/tests/health.test.ts apps/public-api/tests/field-checkin.test.ts
```

全部 exit 0。變更 TS／Markdown 的 Prettier check、`git diff --check` 通過；
未執行全倉 format:check，不宣稱既有全部文件已格式化。SQL 沒有適用的既有 Prettier parser，
亦未以 PostgreSQL parser／真 DB 驗證。測試是 mock、純函式、靜態 SQL 契約及最小 DOM harness，
不等同 RLS／ACL、實際瀏覽器、LINE 或端到端成功證據。

## NO-GO 與未完成接線

- 0048 ENABLE／FORCE RLS、restrictive deny-all、ACL 撤銷未變；NFC default-off 未變。
  0049 沒有解除隔離，且**一般服務 readiness 目前也不接受 0049**；不得執行 migration
  後假設可直接發布。新增負向測試鎖定這項限制。
- 正式 app 的場地／報表 routes 仍受 NFC registration gate 阻擋（default-off 404），
  explicit opt-in 無支援的 ready 版本。隔離直接註冊測試不代表正式 app 可用。
  已登入直接 route 的 503 不是成功後端；人工 UI 保持未掛載／預設 disabled。
- LINE resolver 尚未組裝進可信 credential adapter；privacy 同意／撤銷、每次寫入資格重查、
  manual actor mapping、逐操作／歷史 region scope、CSV 稽核與小群體隱匿均待獨立審核。
- 四包是隔離契約，不可直接互接成功路徑：場地 UI 保留舊 create／廣泛 metadata DTO，
  0049 僅 update-only 最小 metadata；報表文件提議的舊 checkin／stats permissions 不是
  security 包四個新 permission 的已核准 mapping；人工模型可表達多時區，現行 attendance
  權威日期仍固定 Taipei。這些未啟用邊界需先統一設計，不可用 fallback 或 capability 放行。
- 人工流程還缺 server 同源 transport／browser bundle、獨立搜尋／查詢授權、原子唯一性、
  version／持久 idempotency、audit、未知提交結果對帳與作廢儲存模型。本批沒有新增 schema
  支援這些功能，也不允許把 UI 成功測試 adapter 當成 production adapter。
- 真實隔離 PostgreSQL、upgrade／rollback／default ACL／owner FORCE／跨區／撤權／並行驗證，
  Node 24、手機／鍵盤／reader、真實 LINE LIFF 與外部 API 驗收均未執行。
  DB tests 明確 skip；不為驗證連 DB／LINE／外網，不執行 migration。
- 沒有讀 .env／機密、push、deploy、更動 global config、依賴檔或刪除 worktree。
  介面沒有可呼叫的 `allow_tool: false` veto hook；此本地審閱不替代結構安全審核與發布核准。

## 後續批次：session-bound service（base `837a9da`）

本節是上述整合完成後的獨立、已核准本地批次；不改寫前節的歷史驗證紀錄。
開始時 HEAD 為 `837a9da`、工作樹乾淨；唯一代理順序修改以下 **4 檔**，沒有開代理：

- `apps/public-api/src/venue-admin-service.ts`（新增）：只有嚴格 operation parser、
  server-owned execute dependency 與固定錯誤映射；無 cookie、pool、principal 或成功資料分支。
- `apps/public-api/tests/venue-admin-service.test.ts`（新增）：58 項純／mock 測試，包含真正
  `registerAdminRoutes` → service → 既有 runner → mock Pool 的接線，沒有 mock 掉 runner。
- `apps/public-api/src/admin-auth.ts`：保留原有 routes／gate，新增 server-only 回傳值
  `{ venueAdminServiceFor(request) }`；在私有 cookie 邊界建立 request-bound execute closure。
- 本文件：接線程度、驗證證據、NO-GO 與下一批依賴。

### 已接線範圍與 credential 邊界

```text
registerAdminRoutes(app, pool, provider) 的 server-only 回傳值
  → venueAdminServiceFor(目前的 FastifyRequest)
  → service.execute(不含身份的 operation DTO)
  → admin-auth 私有 execute closure（讀取目前 request 的 session cookie；write 檢查 CSRF）
  → runVenueAttendanceAdminOperation(pool, request.id, 真實 session token, operation)
  → runtime transaction / 清空 person、principal / session_principal(token)
  → DB 驗出的 principal → 0049 專用 action + region 拒絕契約
```

不是把 `principalFor(request)` 的 UUID 當 session token，也沒有新增 browser token accessor。
服務的輸入無 principal／person／volunteer／subject／sessionToken／idToken 欄位；
body 自稱身份會在 parser 被拒絕，query／authorization／自填身份 header 不參與認證。
唯一 credential 來源仍是 `admin-auth.ts` 私有 `__Host-qigong-admin` cookie。
新增邊界只接受現行 `token()` 產生的 32-byte、43 字元 base64url 形狀，拒絕 UUID、access
session cookie、重複 session cookie 與畸形輸入；形狀檢查不是認證，仍須 DB 驗 session。

每次 `execute` 都重新走 runner，不快取 principal、permission、capability 或 region 判定。
四個 action 使用獨立專用函式／export boolean；`field.write` 只接受既有場地 metadata 的
`fieldId, regionId, change: { nameZhTw, isActive }`，不是建立／移區／座標／排程 API。
寫入另外要求 POST／PUT／PATCH 及既有雙重 cookie CSRF header 比對；重複 CSRF cookie、
缺漏／錯誤 header、GET 寫入均拒絕，不能以有 session 取代 CSRF。

service 與回傳值 immutable；傳給 dependency 的 DTO 是 parser 產生的新 immutable object。
服務只重建固定錯誤 body，絕不透傳 DB output、診斷、session token 或私密輸入，也無新增 log。
資料規則維持：出席獨立日課、不選功法／連結心得；同人同場同日一次、跨場可；原始 GPS
與私密心得不保存／不記 log；出席日數採 Taipei 日期去重、不混用日課 streak。
本批只有 metadata／read／export 拒絕契約，沒有新增任何 attendance writer。

| runner／closure 結果                               | service status | 固定 body                      |
| -------------------------------------------------- | -------------- | ------------------------------ |
| invalid input                                      | 400            | `{ error: 'invalid_request' }` |
| 無 credential／session 失效或撤銷                  | 401            | `{ error: 'unauthenticated' }` |
| action／region 拒絕                                | 403            | `{ error: 'forbidden' }`       |
| 寫入 CSRF／method 拒絕                             | 403            | `{ error: 'invalid_csrf' }`    |
| 0049 quarantine                                    | 503            | `{ error: 'quarantined' }`     |
| DB／連線／cleanup 失敗、未知 output、意外 SQL 成功 | 503            | `{ error: 'unavailable' }`     |

交易生命週期完全沿用既有 runner／`withRequestContext`：操作 SQL 拒絕或意外成功都
ROLLBACK、release；ROLLBACK 失敗丟棄 client 並映射 503，不輸出 AggregateError。
DB 回 null session 的路徑沒有執行操作 SQL，既有 runner 以唯讀 COMMIT 結束並回 401；
不宣稱該路徑會 rollback。COMMIT 失敗仍 rollback／release 並回 503。
mock 測試鎖定上述順序、每次清空 context、撤銷後同一 service 再執行變 401、不同 action／
region 重新傳入及 export 無 read fallback。這不是 PostgreSQL 真實撤權／並行／RLS 證據。

### 本批實際驗證（全程無 DB）

所有命令均移除 `TEST_DATABASE_URL`，未載入 .env、未讀 secrets，沒有任何 DB／外網 API
連線、migration、push、deploy、merge、依賴／lockfile／global config 修改或 worktree 刪除。
Node `v26.10.0`、pnpm `10.15.1`、Vitest `3.2.7`；仍非要求的 Node 24，須在 Node 24 重驗。

每檔修改後即跑對應本地測試：service 新增後先跑 database 契約 170 passed／10 skipped；
admin-auth 修改後跑 auth／field／health／fields UI 112 passed／2 skipped；新 suite 首跑及
格式化後均 58 passed。新測試的第一次 strict tsc／lint 發現 fixture 的 Error.code 型別與
一個 unused parameter，一輪修正後兩者均通過，沒有更動 production 安全邏輯來配合測試。

```sh
env -u TEST_DATABASE_URL pnpm --filter @qigong/database exec vitest run tests/venue-attendance-security.test.ts tests/nfc-security-quarantine.test.ts tests/field-attendance-schema.test.ts
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/admin-auth.test.ts tests/field-checkin.test.ts tests/health.test.ts tests/venue-fields-ui.test.ts
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/venue-admin-service.test.ts
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api test
env -u TEST_DATABASE_URL pnpm --filter @qigong/database test
env -u TEST_DATABASE_URL pnpm typecheck
env -u TEST_DATABASE_URL pnpm build
env -u TEST_DATABASE_URL pnpm lint
env -u TEST_DATABASE_URL pnpm exec eslint apps/public-api/src/admin-auth.ts apps/public-api/src/venue-admin-service.ts apps/public-api/tests/venue-admin-service.test.ts
env -u TEST_DATABASE_URL pnpm exec tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop apps/public-api/tests/venue-admin-service.test.ts
env -u TEST_DATABASE_URL pnpm exec prettier --check apps/public-api/src/admin-auth.ts apps/public-api/src/venue-admin-service.ts apps/public-api/tests/venue-admin-service.test.ts docs/operations/venue-admin-integration.md
git diff --check
```

| 驗證                                                | 結果                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 新 service suite                                    | 58 passed、0 skipped；包含 cookie→runner 與 test-only HTTP adapter                              |
| public-api 全套                                     | exit 0；59 files passed、20 skipped；1311 passed、233 DB-dependent skipped                      |
| database 全套                                       | exit 0；4 files passed、43 skipped；173 passed、292 skipped（含 10 項待實作 DB 驗證）           |
| typecheck／build                                    | 各 exit 0，四個 workspace package 通過                                                          |
| 變更 TS lint、測試 strict tsc、四檔格式、diff check | exit 0                                                                                          |
| 全倉 lint                                           | exit 1，仍是未變更的 `apps/public-api/tests/line-checkin-nfc.test.ts` 原有 8 errors；不宣稱全綠 |

### 仍未啟用與下一批精確邊界

**已交付 server-only service 接線，不是成功資料面、production route 接線或 UI 啟用。**
`app.ts` 目前仍忽略 `registerAdminRoutes` 的回傳值；現有 fields／attendance routes 仍保留
原本拒絕，沒有改 consume service。測試中的 `/__test/*` transport 只存在測試檔，未加入
production。沒有回傳空列表、假 CSV 或假更新成功。NFC default-off、0049 readiness 拒絕、
0048 restrictive deny-all／FORCE RLS／ACL、0049、LIFF 日課與人工 UI 未掛載均未變。

下一個 **route-only 接線批次，最多 5 檔**，僅能消費上述拒絕結果，不能因接線而啟用：

1. `apps/public-api/src/admin-auth.ts`：將 server-only factory 移至 gated route 組裝前，
   在既有 gate 內注入 field／attendance adapter；token 不離開私有 closure。
2. `apps/public-api/src/admin-field-routes.ts`：消費 service，明確 region selector 與
   update-only metadata DTO；不能把舊 create／廣泛 metadata DTO 靜默轉成 0049 write。
3. `apps/public-api/src/admin-attendance-routes.ts`：read／export 分開 operation，明確
   operational region、Taipei 半開日期；無 scope、quarantine 均不得生成資料／CSV。
4. `apps/public-api/tests/venue-fields-ui.test.ts`：鎖定 field route transport／DTO／CSRF、
   401／403／503 與 default-off，不啟用能力 UI。
5. `apps/public-api/tests/admin-attendance.test.ts`：鎖定 region／read-export 分權與拒絕，
   不以登入／舊 checkin、stats permission 當場地權限。

前置依賴是 review 同意嚴格 DTO／region／permission mapping 與回應契約；上述 route-only
接線本身仍無資料成功分支。本文件的後續驗證紀錄另小批更新，不能把第六檔塞進同批。
成功資料面的 forward scoped policy 必須先獨立設計與安全審查：從真實 field row 取得／鎖定
region、防移區 TOCTOU、歷史 scope、最小投影、分頁、export 稽核／隱匿、權限配置與失效競爭。
本輪禁止修改 0049、新 migration、解除 0048 或加廣泛 GRANT；不能用 readiness 接受 0049
來開 NFC。後續成功實作與任何啟用還依賴明確可拋棄隔離 PostgreSQL 的 ACL／RLS／撤權／
並行驗證、Node 24 重驗、結構安全審查及獨立啟用核准；目前 DB 驗證仍未實作／未執行。
介面仍無可呼叫的 `allow_tool: false` hook，此交付不替代該結構安全 veto 或發布核准。

## 後續批次：forward scoped read/export 設計及 DTO（base `5bca01b`）

本節更新目前狀態，前節為當時的歷史紀錄。base `5bca01b829cc2c7ef1525e678d83cc85d27fb156`
已完成 gated routes → request-bound deny-only service 的接線；不再是前節所述「尚未 consume service」。
接線不是啟用：runner 意外成功仍 rollback／503，0048／0049、default-off gate 及 readiness 限制未變。

本次用戶已授權自主完成的單代理批次限 **4 檔**，沒有開代理：

- `docs/architecture/venue-attendance-read-export-v1.md`：forward RLS 拆分、scope 證據、最小角色／ACL、
  私有 session permit、privacy／audit／撤權釋出順序及一次性隔離 PostgreSQL 驗證方案。
- `apps/public-api/src/venue-admin-read-contract.ts`：未接線的嚴格 request parser／success decoder。
- `apps/public-api/tests/venue-admin-read-contract.test.ts`：84 項純函式／負向 dependency mock。
- 本文件：具體契約、驗證證據與 parent／產品審核點。

### 實作契約與模型缺口

新契約分離 field.read、attendance.read、attendance.export；明確單一 operational region、
Taipei 半開日期（最多 366 日），allowlist field／method filters。read page 1–10000、limit 1–100；
export 無分頁且最多完整 1000 列，超量／部分結果一律 unavailable。total 是完整授權集合，
不是本頁；attendanceCount／attendanceDays／learnerCount 分別依人場日／日期／人去重。

available DTO 只回最小場地 metadata，以及必要出席日期／姓名（預設 null）／場地／方法／
儲存距離；無 GPS、心得、電話、volunteer／person／checkin ID、session 或任意 DB JSON。
所有層級 strict、深 clone／freeze、request 與 rows 綁定驗證、未知欄位不靜默剝除；
suppressed／unavailable 無 rows／count／原因。已有 deny-only service 不引用新 decoder，
新增負向 mock 證明即使 dependency 回未來成功 DTO 仍 503，不把成功 fixture 當 production adapter。

0047 attendance 無 historical assignment／event field region，field 也沒有歷史 region。
不能以目前 region、can_access_person 的 CURRENT_DATE、或舊 checkin link 假造歷史 scope。
方案要求另經核准的不可變 provenance ledger／完整覆蓋證據，不能盲回填；未知時不產生假空集合。
跨區出席未核准，一律不進 rows／totals／export，包含 global grant；場地／person 歷史區必須一致。

未來 migration 只可將 0048 FOR ALL restrictive policy 拆成永久三項 write deny 與 scoped SELECT
fence，另配專用非 owner／NOBYPASSRLS／無 membership reader 的 permissive SELECT；FORCE RLS 保留。
精確 column grants／function EXECUTE allowlist、PUBLIC／defaultACL／columnACL 清理與 catalog
assertions 需同一交易驗證，不能僅刪 quarantine 或盲 GRANT。0049 write 繼續拒絕。
本輪沒有建立／修改／執行任何 migration 或連接 PostgreSQL。

### 本輪實際驗證（本地、無 DB）

未載入 .env／secrets；所有測試與 typecheck／build／lint 命令均移除 TEST_DATABASE_URL、
DATABASE_URL，沒有 DB／API／外網操作、安裝工具／依賴、deploy／push／merge 或 global config 修改。
使用既有 Node `v26.10.0`、pnpm `10.15.1`、Vitest `3.2.7`，engine warning 保留；**未在 Node 24 驗證**。

每檔修改後立即跑相關本地測試，formatter 也由現有 Prettier 執行。新 suite 首跑 83 passed；
自審再加完整 export distinct-date 總計一致性檢查，最終 84 passed。
未出現需修復的測試失敗，未使用三輪失敗修復預算。最終相關命令：

```sh
env -u TEST_DATABASE_URL -u DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/venue-admin-read-contract.test.ts tests/venue-admin-service.test.ts tests/venue-attendance-report.test.ts tests/venue-fields-ui.test.ts tests/admin-attendance.test.ts tests/health.test.ts tests/field-checkin.test.ts
env -u TEST_DATABASE_URL -u DATABASE_URL pnpm --filter @qigong/database exec vitest run tests/venue-attendance-security.test.ts tests/nfc-security-quarantine.test.ts tests/field-attendance-schema.test.ts
env -u TEST_DATABASE_URL -u DATABASE_URL pnpm exec eslint apps/public-api/src/venue-admin-read-contract.ts apps/public-api/tests/venue-admin-read-contract.test.ts
env -u TEST_DATABASE_URL -u DATABASE_URL pnpm exec tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop apps/public-api/tests/venue-admin-read-contract.test.ts
env -u TEST_DATABASE_URL -u DATABASE_URL pnpm typecheck
env -u TEST_DATABASE_URL -u DATABASE_URL pnpm build
env -u TEST_DATABASE_URL -u DATABASE_URL pnpm lint
pnpm exec prettier --check apps/public-api/src/venue-admin-read-contract.ts apps/public-api/tests/venue-admin-read-contract.test.ts docs/architecture/venue-attendance-read-export-v1.md docs/operations/venue-admin-integration.md
git diff --check
```

| 檢查                            | 結果                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 七個相關 API suites             | exit 0，412 passed（含新 84 項），0 skipped                                                                         |
| 三個 database 靜態／mock suites | exit 0，170 passed、10 skipped；skip 是未實作 PG 驗證，不是已通過                                                   |
| 新 TS lint／測試 strict tsc     | exit 0                                                                                                              |
| 全 workspace typecheck／build   | 各 exit 0                                                                                                           |
| 四檔 Prettier／diff check       | exit 0                                                                                                              |
| 全倉 lint                       | exit 1，未變更 `apps/public-api/tests/line-checkin-nfc.test.ts` 既有 8 errors（7 unused-vars、1 no-base-to-string） |

未跑全倉 tests／全倉 format:check，不宣稱全綠。純函式只能驗 DTO 與拒絕，不證明資料真實性、
RLS、distinct-person k、scope、撤權、並行或 PostgreSQL 編譯／ACL。

### Parent 獨立審查與用戶確認（成功資料面仍 NO-GO）

1. parent 獨立檢查 forward policy 拆分、FORCE／role／ACL／definer／permit／audit 與歷史證據可行性；
   本輪不開代理，沒有宣稱已完成獨立 review；也沒有可呼叫的 allow_tool:false hook。
2. 產品／privacy owner 確認跨區可見性（預設拒絕）、legacy 歸屬證據與 field 移區規則、獨立 names
   permission、姓名／逐列日期距離揭露、k=5、空集合是否也抑制、無小群體例外、差分 ledger、
   scope-wide 跨帳號協作防護、20 次／24h budget、retention／audit 存取與 export／byte 上限。
   這些是具體建議而非已核准／已實作政策。
3. 另批實作 provenance、privacy／audit storage、所有 revoker 共用的 lock／wall-clock release 協定；
   0049 STABLE session 驗證本身不足以聲稱沒有撤權 TOCTOU。
4. 授權後才以 Node24、一次性無 TCP／外網／真資料／憑證的 local cluster，補 migration 鏈、
   role／ACL、historical scope、並行／撤權／rollback tests。本輪不連 DB、不安裝系統工具。
5. 真 PG 證據及政策核准先於新成功 runner／route／CSV adapter；readiness／gate／migration／
   deploy 各另取核准。不得因本次交付 success decoder 就去掉任何既有拒絕。
