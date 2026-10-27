# LINE LIFF「我的團練紀錄」前端交付

> 整合狀態更新：已在本地 integration branch 接上主程式，**尚未上線**。最新 54-chain、路由／開關、驗證與限制見[整合交接](./venue-history-admin-integration.md)。以下保留原 standalone 分支的交付／驗證紀錄；「未接線」、52 檔 migration 或舊失敗數字均屬該歷史範圍，不是目前整合狀態。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 2026-10-27：無 lang 入口沿用既有 LINE 語言偏好

此節覆蓋下方歷史交付紀錄的語言行為描述；不是部署或真人驗收證明。

- worktree：`feature/venue-liff-preferences`；base `origin/main` / `5d98a045c8e6dae3ded163ceea5cf5d92d29a1f8`。
- source / tests commit：`b423812a5c0b311df3f68dc552134f37ebba9c59`。只修改 `application-page.ts`、`line-venue-history-page.ts`、`line-venue-history.test.ts`；第二批僅修改本文件。
- 根因：parser 將缺少 `lang` resolve 成 `zh_TW` 後，history continuation 把它當 explicit，跳過既有偏好讀取。
- parser 現在保留 `explicitLang`；沒有明確語言時，canonical、登入續接、callback cleanup、篩選與重新登入網址均不補上 implicit fallback。`venueHistoryUrl` 對手動建立且未提供此欄位的舊 caller 保持既有行為。
- 共用 `lineLoginScript` 新增可選第四參數 `{ explicitLocale: Locale | null }`；history 傳入真實 query 狀態。既有三參數／無 continuation callers 不改契約；偏好導頁使用 server-built allowlisted continuation，保留 `month` / `venue` / `page`，不採用 callback URL 或 `liffRedirectUri`。

### 語言權威與寫入界線

優先序維持既有 LINE helper／presentation cookie 契約：**明確合法 `lang` → 有效 `__Host-qigong-learner-locale` cookie → 登入後讀取已儲存偏好 → `zh_TW`**。

- 無 lang、無 cookie 的新裝置：先完成 SDK init / 登入，取得 ID token，才 POST `/line/preferences/language`，body **只有 `{ idToken }`**。既有 endpoint 驗證身份後讀取該 LINE subject 的偏好；本次未修改 endpoint、Origin / CSRF、DB 或 profile。
- 三語系僅允許 `zh_TW` / `zh_CN` / `en`。stored locale 不同時以保留 filters 的網址導頁；導頁帶有效 lang，因此下一次不重複查偏好或循環。讀取不寫 cookie、不寫 locale、不提交申請或日課。
- 有效 cookie 是既有裝置呈現選擇，**即使與另一裝置更新的 DB 偏好不同，也不在本次開頁偷偷改成 DB 值**。無／無效 cookie 的裝置才讀 DB；明確 lang 可蓋過 cookie，但單純帶 lang 開頁不持久化選擇。未新增另一套同步順序。
- 偏好讀取網路／HTTP／無效 payload 失敗時使用 fallback；仍須另行送出 ID token 至 history API 做身份／資格／同意驗證，不能因語系成功或失敗繞過認證。canonical 保持沒有 lang，重新開啟可重試偏好讀取。
- 手動切換語言：使用當下 SDK token POST 同一 endpoint `{ idToken, locale }`；成功後才設 Secure / SameSite=Lax / Path=/ cookie 並導頁，保留 active month / venue / page。失敗還原 selector、顯示三語系錯誤、允許重試，不寫 cookie 或假裝成功；SDK token 失效則清空資料並停用查詢。
- primary `liff.state` 頁只呼叫 SDK init，不讀偏好、不讀 history、不寫 API / cookie / URL；secondary 登入完成後才繼續。callback secrets 僅供 SDK，不反射到 continuation、偏好 body 或 history body。token 不進 storage / log / URL。

### 本次本地驗證與父代理交接

- Node 24.22.1；frozen install downloaded 0，未修改 manifest / lockfile，未新增依賴。
- Batch 1：history suite **111 passed**（新增 24 項語言契約 VM tests），history + application + invite + check-in regression **236 passed**。執行真正 renderer inline script / `lineReady`，SDK、DOM、fetch 為 mocks，不以字串包含取代初始化測試。
- VM 覆蓋 no-lang / no-cookie stored 三語系、explicit / stale cookie 優先序、無效 cookie、跨裝置、登入前不 fetch、primary SDK-only、callback secrets / filters / page、無 silent write、POST 成功／失敗與重試、當下 ID token、未知語系／XSS／循環；既有 application / invite / check-in helper callers 全測試無退步。
- `pnpm verify`（全庫 Prettier check、ESLint、workspace typecheck、全 tests、build）與 `tsc -p tsconfig.eslint.json --noEmit` 通過。全 workspace **2552 passed / 601 skipped**：API 2283 / 291、database 261 / 310、identity 6、config 2。skip 是未啟用的 DB / integration suites，**不是實際 DB、LINE 或手機驗收**。
- fresh worktree 首次完整驗證因 workspace config 尚未 build 而解析失敗；先 `pnpm build` 後完整重跑成功（環境恢復 1 次），沒有為此改 source / dependencies。
- 未修改 AGENTS、onboarding endpoint、check-in、venue-debug、app / index、其他 venue services 或 SQL；未連 DB / LINE 外部 API、讀 secrets、SSH、操作 Console / Rich Menu、push / merge / deploy、建立遠端 PR 或刪除 worktree。
- **待父代理與 CKS 分支順序整合**：`line-venue-checkin-page.ts` 仍將 resolved lang 當作 continuation 的 explicit 語言，且 selector 仍只 URL replace；本分支刻意不修改 debug / CKS-owned 檔案。父代理可沿用可選 helper 參數接續修正，不應把此 history 修正宣稱涵蓋 check-in。
- PR 由父代理檢視、整合後 push；本地 commits 不代表已上線。

## 歷史交付：狀態與範圍

- 獨立 worktree `feature/venue-history-frontend`，基底 `origin/main` / `56284208942acb182651c02983011f80b8921a47`。
- **只有本地前端交付，尚未掛載 history routes、串接 backend 或部署。** 不代表真人 LINE、手機或正式資料庫已驗收。
- 只有四個交付檔案：新 `apps/public-api/src/line-venue-history-page.ts`、新 `apps/public-api/tests/line-venue-history.test.ts`、修改 `apps/public-api/src/line-venue-checkin-page.ts`、本文件。
- 沒有修改 app / onboarding / index / application-page / backend / migrations / 依賴或 lockfile；沒有建立子代理、push、merge、LINE Console / Rich Menu / webhook 變更、讀取 `.env` 或連線外部 API / DB。
- 共用既有官方 LIFF ID 與 `/line/` Endpoint 模式，不申請新 LIFF、不更換正式 LINE ID。

## 匯出與父代理接線

`apps/public-api/src/line-venue-history-page.ts` 匯出：

```ts
interface VenueHistoryEntry {
  readonly lang: 'zh_TW' | 'zh_CN' | 'en';
  readonly explicitLang?: boolean; // parser always supplies true / false
  readonly month?: string;
  readonly venue?: string;
  readonly page?: number;
}
interface VenueHistoryPageConfig {
  readonly liffId: string;
  readonly entry: VenueHistoryEntry | null;
}
// VenueHistoryRequest = {kind:'none'} | {kind:'invalid'} | {kind:'history',entry}
venueHistoryRequest(rawUrl: string, cookie?: string): VenueHistoryRequest;
venueHistoryUrl(entry: VenueHistoryEntry): string;
renderLineVenueHistoryPage(serverconfig: VenueHistoryPageConfig): string;
```

父代理待完成（這些檔案本分支沒有修改）：

1. 在現有 `GET /line/` 的 venue preview / ordinary workspace 分支**之前**呼叫 `venueHistoryRequest(request.url, request.headers.cookie)`。`none` 保留原分支；`history` 使用 renderer；`invalid` 回 400 並以 `entry: null` 呈現，不反射輸入、不輸出 SDK / controller。
2. 新增 `GET /line/venue-history`，使用同一 parser 與 renderer。只接受 `history`；其餘回 400 / `entry: null`。不把 URL personId、token、GPS 或 redirect 加到 config。
3. renderer 呼叫範例：

   ```ts
   renderLineVenueHistoryPage({
     liffId: config.liffId,
     entry: parsed.kind === 'history' ? parsed.entry : null
   });
   ```

4. HTML route headers 應與現有隔離 LIFF 頁同等或更嚴：

   ```text
   Cache-Control: no-store
   Referrer-Policy: no-referrer
   X-Robots-Tag: noindex, nofollow
   X-Content-Type-Options: nosniff
   Permissions-Policy: geolocation=(), camera=(), microphone=()
   Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline' https://static.line-scdn.net; style-src 'unsafe-inline'; connect-src 'self' https://api.line.me; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
   Content-Type: text/html; charset=utf-8
   ```

5. 串接另一 backend 分支的 `POST /api/line/venue-history` 與適當的 server-only readiness / feature gate。由父代理核對 migration、identity / consent、self-read 權限與 startup readiness；**不能用 renderer 通過或 check-in readiness 代替 history backend readiness**。
6. 以實際 `buildApp` 加 integration tests：direct / primary history 命中、400 安全頁、headers、原 `/line/` / check-in 不變、backend disabled / 未配置時不可假成功。此分支的 VM 測試不聲稱已完成 route integration。
7. 接線與 readiness 通過之前不要單獨發布新增的簽到成功連結，避免指向尚未存在的 route。

## Rich Menu 交付（未直接套用）

按鈕文字：**我的團練紀錄**

```text
https://liff.line.me/{既有LIFF_ID}/venue-history
https://liff.line.me/{既有LIFF_ID}/venue-history?lang=zh_TW
```

不帶學員 ID、token 或位置。既有 LIFF Endpoint 保留 `/line/`：

```text
Rich Menu LIFF /venue-history
  → /line/?liff.state=<encoded /venue-history?...>
  → SDK init（primary URL 保持原樣，不提前讀資料、不自行 redirect state）
  → SDK secondary /line/venue-history?...
  → 必要時 LINE login（只保留 canonical allowlist）
  → 本人 history API
```

同源直達模式為 `/line/venue-history?lang=zh_TW`。簽到 API 經既有成功驗證後才顯示「查看我的團練紀錄」，連到同一官方 LIFF `/venue-history?lang=…`；無安全 LIFF ID 時使用同源 fallback。既有「記錄今天功法與感受」連結保留，不自動建立日課。

## 固定 API 契約與 UI 語意

```http
POST /api/line/venue-history
Content-Type: application/json
x-venue-history: 1
```

strict JSON body 只含 `{idToken, month?: 'YYYY-MM', venue?: code, page?: positiveInteger}`。前端每次從 SDK 取得當下 ID token，實際送出 `page`（預設 1）；沒有 month / venue 時省略，不傳空字串、學員 ID 或 GPS。fetch 使用 `cache: 'no-store'`、`credentials: 'omit'`、`redirect: 'error'`、15 秒 timeout。後端仍須真實驗證 token、身份、有效資格與必要同意，格式驗證不是認證。

```ts
{
  ok: true,
  timezone: 'Asia/Taipei',
  totals: { attendanceCount, attendanceDays, monthCount },
  page,
  pageSize: 20,
  hasMore,
  entries: [{
    id, venueCode, venueName, checkedInAt, venueLocalDate, venueTimezone
  }]
}
```

- `attendanceCount` / `attendanceDays` 是本人 lifetime 統計，不受列表篩選影響；日數按場地當地日期去重，不把兩場同日灌成兩日。
- `monthCount` 為指定月或 `Asia/Taipei` 本月，亦不受場地篩選影響。UI 明示統計語意及實際月份；沒有指定月份時列表仍包含所有月份。月份分桶由 backend 契約決定，UI 不使用裝置時區重新計算統計。
- entries 由 backend 依 month / venue / page 篩選；畫面按 `checkedInAt` 新到舊排列，每列顯示回傳的 `venueLocalDate`、以 `venueTimezone` 格式化的時間、明確時區與可信場地名稱／代碼，不把海外紀錄改為裝置當地日期。
- 不虛構姓名、出席或場地選單。沒有可信完整場地清單，因此使用有說明的完整 code 輸入，可查尚未載入頁面的場地；沒有任選場地的遠端簽到按鈕。
- 穩定 400 / 401 / 403 / 503：400 引導修正查詢；401 清空資料、停用查詢並提供重新開啟登入；403 引導回 LINE 聊天完成加入／最新同意、確認資格；503 / 404 / 網路錯誤 / 不符契約的成功 payload 明示服務尚未就緒或暫不可用，不顯示假空資料或假成功。錯誤 body / exception 一律不反射。
- loading、失敗、token 失效時清空上一批明細與統計；只有成功回應才顯示真實零值。busy 時鎖住篩選、分頁與語言切換；失敗後可重試，不以同時多次請求覆蓋狀態。

## 登入、參數與隱私

- 使用 `lineLoginScript(liffId, locale, canonical, { explicitLocale })`，區分 query 指定與 presentation fallback；詳見上方最新語言契約。偏好 redirect 保留 canonical filters，既有 helper callers 相容。
- 應用參數 allowlist：`month`、`venue`、`page`、`lang`；全為單值。月份嚴格 `0001–9999` / `01–12`；venue 沿用 lower-case hyphen code、最多 64 字元；page 為正的 safe integer；lang 只允許現有三種枚舉，未指定時依既有 cookie / authenticated stored preference / fallback 順序呈現。
- SDK callback allowlist：`_line_login_attempt`、`code`、`state`、`error`、`error_description`、`liffClientId`、`liffRedirectUri`，僅供 SDK init，看不到資料前不清 URL；登入後以 canonical 移除。**不使用 callback redirect URI 作目的地。** primary 只允許 `/line/` 上單一 `liff.state`，state 必須精確 `/venue-history` 與合法應用參數。
- 未知／重複參數、identity / token / GPS query、惡意 state、fragment、無效 percent encoding、超長輸入 fail closed，不 echo。外部登入保留 month / venue / page / lang；回跳仍未登入或 client 不可登入時停止循環。
- 不讀寫 localStorage / sessionStorage、不儲存或記錄 token / GPS、不要求位置、不讀 LINE profile / 硬造姓名。不依賴音效或震動。
- 動態 DOM 只使用 `textContent` / `replaceChildren`；伺服器插值 HTML escaping / 安全 script JSON。ID token 只留當次頁面記憶體與同源 POST，不放 URL。
- 手機頁維持縮放、20px 基本文字／至少 18px footer、48px 觸控目標、focus 樣式、label、status live region 與 busy 狀態，附企業 footer。
- 真正的官方 SDK、iOS / Android LINE、外部瀏覽器登入、字級縮放、讀屏與已核准環境的 self-read / consent / readiness 仍待父代理整合後驗收。

## 歷史交付：本地驗證

使用既有 Node 24 路徑，`pnpm install --offline --frozen-lockfile --ignore-scripts` 僅重用本機 store（downloaded 0）；沒有改 dependency / lockfile。所有測試移除 DB URL 與 PG harness opt-in，沒有連資料庫。

- 新 history suite：**86 passed**，真實 renderer inline controller 於 `node:vm` 執行；SDK / fetch / DOM 為 mocks，storage / logging / HTML sink / GPS 為禁止呼叫的 traps。
- history + existing check-in + QR scoped suites：**187 passed**。
- 全 workspace：**2261 passed / 565 skipped**（API 2034 / 255、database 219 / 310、identity 6、config 2）；skips 為未啟用的整合／資料庫測試，並非通過的 DB 證據。
- workspace typecheck、含 tests 的 strict tsc、workspace build、變更 TS scoped ESLint 均通過。scoped lint 首輪發現測試 helper 型別／unused parameters，單輪修復後通過；沒有放寬 lint 規則。

重現命令：

```sh
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
env -u TEST_DATABASE_URL -u DATABASE_URL -u VENUE_QR_ISOLATED_PG_DIR \
  pnpm exec vitest run --config apps/public-api/vitest.config.ts \
  apps/public-api/tests/line-venue-history.test.ts \
  apps/public-api/tests/line-venue-checkin.test.ts \
  apps/public-api/tests/venue-qr.test.ts
env -u TEST_DATABASE_URL -u DATABASE_URL -u VENUE_QR_ISOLATED_PG_DIR pnpm test
env -u TEST_DATABASE_URL -u DATABASE_URL pnpm typecheck
env -u TEST_DATABASE_URL -u DATABASE_URL pnpm exec tsc -p tsconfig.eslint.json --noEmit
env -u TEST_DATABASE_URL -u DATABASE_URL pnpm build
pnpm exec eslint apps/public-api/src/line-venue-history-page.ts \
  apps/public-api/src/line-venue-checkin-page.ts apps/public-api/tests/line-venue-history.test.ts
pnpm exec prettier --check apps/public-api/src/line-venue-history-page.ts \
  apps/public-api/src/line-venue-checkin-page.ts apps/public-api/tests/line-venue-history.test.ts \
  docs/operations/line-venue-history.md
git diff --check
```

沒有聲稱已部署、修改正式 LINE / Rich Menu、完成 DB 或真人手機驗收。本分支只供父代理本地順序整合與覆核。
