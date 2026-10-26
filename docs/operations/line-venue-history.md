# LINE LIFF「我的團練紀錄」前端交付

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 狀態與範圍

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

- 沿用 `lineLoginScript(liffId, locale, canonical)`；history 傳入明確語系與 canonical，因此不會觸發會丟失篩選的共用 preference redirect，也不改動其他頁的 global login helper。
- 應用參數 allowlist：`month`、`venue`、`page`、`lang`；全為單值。月份嚴格 `0001–9999` / `01–12`；venue 沿用 lower-case hyphen code、最多 64 字元；page 為正的 safe integer；lang 只允許現有三種枚舉，未指定時沿用既有 presentation cookie。
- SDK callback allowlist：`_line_login_attempt`、`code`、`state`、`error`、`error_description`、`liffClientId`、`liffRedirectUri`，僅供 SDK init，看不到資料前不清 URL；登入後以 canonical 移除。**不使用 callback redirect URI 作目的地。** primary 只允許 `/line/` 上單一 `liff.state`，state 必須精確 `/venue-history` 與合法應用參數。
- 未知／重複參數、identity / token / GPS query、惡意 state、fragment、無效 percent encoding、超長輸入 fail closed，不 echo。外部登入保留 month / venue / page / lang；回跳仍未登入或 client 不可登入時停止循環。
- 不讀寫 localStorage / sessionStorage、不儲存或記錄 token / GPS、不要求位置、不讀 LINE profile / 硬造姓名。不依賴音效或震動。
- 動態 DOM 只使用 `textContent` / `replaceChildren`；伺服器插值 HTML escaping / 安全 script JSON。ID token 只留當次頁面記憶體與同源 POST，不放 URL。
- 手機頁維持縮放、20px 基本文字／至少 18px footer、48px 觸控目標、focus 樣式、label、status live region 與 busy 狀態，附企業 footer。
- 真正的官方 SDK、iOS / Android LINE、外部瀏覽器登入、字級縮放、讀屏與已核准環境的 self-read / consent / readiness 仍待父代理整合後驗收。

## 本地驗證

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
