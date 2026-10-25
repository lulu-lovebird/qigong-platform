# 團練場出席管理 v1：介面與待整合安全契約

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 交付邊界

本批基於 `8d46dc143c108da5e2399d78f1bdb9c68300367b`，只修改五檔：

- `apps/public-api/src/admin-attendance-routes.ts`
- `apps/public-api/src/venue-attendance-report-page.ts`
- `apps/public-api/src/venue-attendance-report.ts`
- `apps/public-api/tests/venue-attendance-report.test.ts`
- 本文件

這是可測試的查詢／月份統計／CSV **介面與純函式**，不是已開放的出席查詢服務。
`0048` deny-all／ACL、NFC default-off 與 feature-readiness 拒絕原樣保留。
目前沒有已審核、可呼叫的 scoped attendance read/export DB 函式；本批不創造函式名稱、
不探測表可讀性、不借用既有日課 reporting SQL，也不以 mock 成功冒充 production 接線。

直接註冊 routes 的隔離測試可驗證以下行為；正式 app 仍受既有 NFC gate 阻擋，通常為 404：

| 路徑                                 | 匿名     | 已登入、合法參數                       | 無效參數         |
| ------------------------------------ | -------- | -------------------------------------- | ---------------- |
| `/admin/attendance`                  | 302 登入 | 503 真實介面，明確待接線               | 400 錯誤介面     |
| `/admin/api/attendance`              | 401      | 503 `attendance_reporting_unavailable` | 400              |
| `/admin/attendance/export.csv`       | 401      | 503 JSON，沒有附件或假空 CSV           | 400              |
| `/admin/api/attendance/capabilities` | 401      | 503，`canRead=false, canExport=false`  | 不接受參數作授權 |

身份解析失敗回 503 `admin_authentication_unavailable`，不回顯 diagnostic、不 fail-open。
登入／super admin 名稱／自稱 header／cookie／principalId 都不建立 operation 或 region 授權。
這不是已實作完整 RBAC 的宣稱：目前所有實際 attendance read/export 均拒絕，完全不碰 pool。
父代理在獨立安全批次接線前，不應改成 200、建立假空結果或開啟 NFC gate。

## 查詢與統計語意

`attendanceExportQuerySchema` 嚴格 allowlist：

- `month=YYYY-MM`，或 `startDate`／`endDate` 真實日曆日期（含起訖日）。
- 相容 `start_date`／`end_date`／`field_id`；與 camelCase 不同值時拒絕。
- `fieldId`、`regionId` 為 UUID，只是縮小篩選，不是授權聲明。
- `method` 僅 `nfc_gps`／`volunteer_manual`；`page` 為 1–10000、`limit` 為 1–100。
- `lang` 保留既有三種 locale；新頁面主文案為繁中，名稱統一「團練場出席管理」。
- 未提供日期時採 server clock 的台北當月；單邊日期的另一端採當月邊界，反向區間回 400。
- month 和日期混用時 API 回 400；實際 browser controller 在日期存在時移除 month。
- 日期允許 0001–9998 年，以確保次日可表示；不接受 client timezone。

`attendanceRange` 輸出 `startInclusive`／`endExclusive`／timezone；DB 必須使用
`timestamp >= startInclusive AND timestamp < endExclusive`，不能用 `23:59:59` 截斷微秒。
UI 日期以 Asia/Taipei 顯示，查詢邊界為 `+08:00`。若需要早於現代台北時制的歷史資料，
須另行決定歷史時區政策；目前不要把古代日曆輸入測試解讀成歷史時區正確性證據。

純統計只接受**完整、已授權的篩選資料**：

- 團練次數（學員人次）：唯一 `(person_id, field_id, 台北日期)` 個數。
  一人同日跨場為兩次；多人同場各算一人次；舊重複列不重複計數。
- 不重複出席日數：篩選集合中的唯一台北日期，不是各學員日數相加。
- 不重複學員數：唯一 person ID，不能以同名 display name 合併。
- 月份依台北日期分組；月總人數不可相加當成整段不重複人數。
- 不從本頁 rows 算全域統計，不依賴日課／streak／功法心得。
- 沒有應到名單，不計算或顯示出席率、全勤。

`attendancePage` 是小型完整集合的純分頁工具，不是 DB loader。production 應由受控查詢
在同一授權 snapshot 計算完整 totals／months，再以穩定 `checkin_at DESC, id DESC` 分頁。
不得載入無上限全庫資料再在 JS 篩選授權。

## 父代理待接的受控 DB／route 契約（未實作）

後續安全批次需先審核實際資料模型、最小 EXECUTE 與真實隔離 PostgreSQL 證據。
目前不提供可注入 callback 的 production bypass。建議將來接線邊界如下：

1. **可信身份與 transaction**：只用 server admin session 取得 principal；
   `withRequestContext(pool, 'qigong_api_runtime', { principalId, requestId }, ...)`。
   所有 scope 查核、資料讀取、統計與 export audit 在此受控 transaction 完成，
   COMMIT／audit 失敗不可回傳成功。不得使用 privileged pool 或偽造 person context。
2. **逐操作權限**：列表至少 `checkin.read` 與必要姓名存取的 `learner.read`；
   統計另外要求 `stats.read`；列明細 CSV 另外要求 `stats.export`，不能以可讀推導可匯出。
   不使用 `admin.can_manage_admin_access() OR ...` 或 `can_access_person` self-read 替代。
   最終 action mapping 須由父代理對照 permission-model 與受控函式審核。
3. **範圍**：對每個操作的有效 grant 逐一驗證場地 operational region；同時定義並檢查
   出席時間點的學員歷史 region visibility。目的區不可看到轉區前資料，來源區不可看到轉區後資料。
   現有 attendance 沒有安全歷史 region snapshot；不可只套學員現在地區。
   偽造 field／region ID 不得擴大範圍；選取未授權範圍應拒絕，而不是回假空清單。
   場地 filter 選單亦只能來自受控範圍，不能直接呼叫未受控的 field routes。
4. **最小輸出**：受控內部資料可用 `person_id`／`field_id`／`id` 做去重及穩定排序。
   畫面／CSV 只列必要姓名、場地代碼／名稱、時間、方式、已保存距離、必要核實志工名稱。
   明確投影，不能 `SELECT *` 或直接將 DB row spread 到 JSON；內部 stable IDs 不列 CSV。
   不讀取／輸出 student_note、電話、原始 GPS、舊 checkin link 或其他 profile。
   現有 schema **沒有 verification_result**，故本批不顯示或推導驗證結果；沒有距離則顯示「—」。
5. **回傳 shape**：對照 `VenueAttendancePageState` 的 `ready` 分支，返回 page rows、
   完整 total、完整 summary、依月份統計與獨立 `canExport`。這個 view model 是 renderer 輸入，
   不代表任何身份或授權憑證。API 須將 DB 未就緒 503、明確拒絕 403、無效參數 400 分開。
   必須驗證 DB 回傳的日期／方式／有限非負距離／整數 count 型別；JS helper 不是 DB decoder。
6. **隱私／預算**：沿用 permission-model 的群體門檻、anti-differencing、export audit 及查詢預算。
   suppressed 與 unavailable 要用獨立狀態表達，不假裝為零。父代理需新增受控 suppression view model
   才能接線；目前 `ready` 不表達 suppression，不能直接用於需隱匿的小群體結果。
7. **CSV**：只匯出同一篩選的完整授權集合（忽略分頁），使用 `encodeVenueAttendanceCsv`
   與 `attendanceCsvFilename(now, locale, true)`。UTF-8 BOM、CRLF、雙引號 escaping，
   公式及空白／control／format 字元前綴都加 apostrophe，場地代碼強制文字。
   既有 `encodeAttendanceCsv` 六欄與預設舊檔名僅為 helper import 相容保留，並未暴露下載。
   不得沿用舊 `LIMIT 10000` 靜默截斷；超出已審核匯出上限時明確拒絕或另建受控 streaming。
8. **寫入仍停用**：人工補簽／作廢需另設 action、地域、原因、稽核及並行防重。
   本批沒有 POST／PUT／DELETE，也沒有解除 0048、修改 schema、日課、NFC 寫入或 privacy 同意。

## UI 與驗證

獨立真 renderer 有月份／日期／地區／場地 ID／方式篩選、手機卡片列表、分頁與 CSV 控制。
場地友善選單仍待受控 scope loader；目前明確標註為 ID 輸入／待接線。
既有 `admin-dashboard.ts` 的 navigation 舊名稱依本批禁止修改規則保留，待父代理另批統一。
既有 CSP 完全沿用（包含 `form-action 'none'`），以 submit preventDefault + 同源 GET 導航，
不放寬政策。沒有新增寫入，因此不建立新 CSRF 豁免；既有管理 shell／logout CSRF 沒有改動。
所有動態 HTML 值 escaping，沒有把 records 插入 script，保留公司 footer。

測試只使用純函式、真 renderer、VM browser-controller、Fastify inject 與故意不可使用的 pool。
所有執行移除 `TEST_DATABASE_URL`，不讀 `.env`、不連 DB／外部 API、不執行 migration。
負向測試證明的是目前未接線時的拒絕行為，**不是實際 DB grant／RLS／跨區授權已驗證**。
後續須補真實隔離 DB 的跨區、轉區、missing／forged context、撤權、export-only/read-only、
小群體隱匿、search_path、ACL 及 pool context cleanup 測試，並保持 quarantine 直到獲准。

### 本機驗證紀錄

- `env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/venue-attendance-report.test.ts tests/admin-attendance.test.ts tests/admin-navigation.test.ts tests/admin-reporting.test.ts tests/field-checkin.test.ts tests/health.test.ts`：204 passed、16 DB-dependent skipped；新檔 76 tests 通過。
- `env -u TEST_DATABASE_URL pnpm --filter @qigong/database exec vitest run tests/nfc-security-quarantine.test.ts tests/field-attendance-schema.test.ts`：54 passed，為純函式／靜態 quarantine 契約，沒有執行 SQL。
- 本批四個 TS 的 `pnpm exec eslint`、五檔 `pnpm exec prettier --check`、`git diff --check` 通過。
- `pnpm typecheck`：四個 workspace package 通過；新測試另以 `tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck` 通過。
- `pnpm lint`：未通過，僅未修改的 `apps/public-api/tests/line-checkin-nfc.test.ts` 有既有 8 errors；本批順便消除原 attendance routes 的 unused-vars。
- 一輪修復：新測試初版將「不推定…驗證成功」提示也判成虛構驗證，改成明確驗證此提示；同輪修正測試 regex 的 lint escape。沒有修改其他人的檔案。
- 執行環境 Node `v26.10.0`，不是專案要求的 Node 24，仍須 Node 24 重驗。
  此 worktree 沒有依賴，僅暫時 symlink 既有主 checkout 的已安裝依賴執行驗證，沒有安裝套件、修改 package／lock 或讀取機密。

上述測試不能替代實際 DB 權限、外部 API、瀏覽器或部署驗證。
驗證後只本機 commit 五檔；不 push／merge／deploy。
本介面沒有可呼叫的 `allow_tool: false` hook，本機驗證與 commit 不代替結構安全審核。
