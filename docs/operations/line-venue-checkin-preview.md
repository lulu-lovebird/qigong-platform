# LINE 團練入口：本地測試預覽規格

> 以下保留 preview 批次的歷史紀錄。最新 QR 成功路徑與 server-only 開關見
> [QR 隔離演練](venue-qr-checkin.md)。預設仍是本預覽；server 明確啟用後同一入口可真簽到，
> 不再以本文件舊的「沒有成功 adapter」描述目前全部實作。真 PG／LINE／手機仍未驗證。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 狀態與五檔範圍

基於 `6367de209e45881887b03e5498106cdc127f844f`，開始時工作區乾淨。
本批只修改以下五檔；沒有部署，公開網址範例不代表線上已提供此預覽。

- `apps/public-api/src/line-onboarding.ts`：既有 LINE 配置下的獨立預覽路由與 Endpoint 分流。
- `apps/public-api/src/line-venue-checkin-page.ts`：renderer、嚴格 URL parser、allowlisted 續接。
- `apps/public-api/src/application-page.ts`：共用 `lineLoginScript` 的可選公開續接參數。
- `apps/public-api/tests/line-venue-checkin.test.ts`：真正 `buildApp` HTTP 路由及 mock SDK／VM probe。
- 本文件。

已先讀 [NFC quarantine](nfc-security-quarantine.md)、`LineConfig`、`lineLoginScript`、
`registerChannelWorkspace` 與 [既有 Endpoint 規格](line-pilot.md)。
不接舊 `line-checkin-nfc` renderer、身份 adapter、attendance service 或 503 舊 API。
沒有修改日課、Telegram、WhatsApp、NFC gate、feature readiness、migration／0048、GRANT／RLS。
預覽公開與登入初始化不表示可信學員身份、privacy／eligibility、場地或出席已驗證。
本介面沒有可呼叫的 `allow_tool: false` hook；本機 commit 不代替結構安全審核／部署核准。

## URL 契約與實際 Endpoint 前提

設計入口（既有 configured LIFF ID，不新增 LIFF／OA）：

```text
https://liff.line.me/{LIFF_ID}/venue-checkin?venue=tw-tpe-daan&source=qr
https://liff.line.me/{LIFF_ID}/venue-checkin?venue=tw-tpe-daan&source=nfc&lang=en
```

- `venue` 必填，穩定且區分大小寫的 code：最多 64 字元，
  `^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$`。這只檢查語法，**不是可信場地存在性驗證**。
- `source` 可省略，只接受 `nfc`／`qr`／`link`；只是分析分類，不是防偽或授權。
  本預覽只保留該值，不發送任何分析事件。
- `lang` 可省略，只接受現有 `zh_TW`／`zh_CN`／`en`。
  省略時使用既有有效 presentation cookie，否則 `zh_TW`；不向伺服器讀寫語言偏好。
- 重複、空值、未知 key／來源／語言、HTML／script、非法 code 一律 400，顯示固定錯誤頁，
  不回顯輸入、不載入 SDK。拒絕應用參數中的 token／idToken／person／volunteer／GPS／日期／
  test／bypass／任意 redirect；沒有 URL 測試繞過。
- 直接 HTTPS 預覽路徑為 `/line/venue-checkin`，參數規則相同。
  只在既有完整 LINE 配置下註冊；未配置 LINE 為 404。

目前 repo 的既有 Console／部署文件指定 LIFF Endpoint 為
`https://checkin.baiyinqigong.org/line/`；本批沒有連 Console 或網路重新核對，亦沒有改 Endpoint。
不可假設點 LIFF 追加路徑就直接到 `/line/venue-checkin`。

```text
LIFF /{LIFF_ID}/venue-checkin?venue=...&source=...&lang=...
  → Endpoint /line/?liff.state=%2Fvenue-checkin%3Fvenue%3D...%26source%3D...%26lang%3D...
  → 官方 SDK liff.init（此時不清 URL、不送 API、不重啟外部 login）
  → SDK secondary /line/venue-checkin?venue=...&source=...&lang=...
  → 外部瀏覽器必要時 liff.login，redirectUri 僅保留 canonical venue/source/lang
  → secondary 登入完成後清除 SDK callback query/hash，仍保留 venue/source/lang
```

`/line/` 只對精確 `/venue-checkin?...` state 選取新 renderer，**不做 server redirect**。
內層只允許上述三個應用參數；primary state 最多 512 字元、請求 URL 最多 8192 字元。
可識別的預覽 state 若重複、帶 fragment、子路徑或惡意參數則 400。
其他 state、普通 `/line/`、既有 `/line/checkin` 仍走原 workspace。

為相容現有 SDK／OAuth callback，外層／secondary 可有單一
`code`、`state`、`error`、`error_description`、`liffClientId`、`liffRedirectUri`、
`_line_login_attempt`；它們不是應用資料，不反射、不導向其值、不保存到 canonical URL。
`_line_login_attempt=1` 是沿用登入防循環標記，**不放行登入／定位／授權**。
自製入口不得附帶任何 token／credential。SDK 自身的 primary credential/hash 交 SDK 處理；
不能在 init 前清理，也不把它們或原私人 fragment 複製進登入續接。
若實際 SDK 出現未支援參數，預覽會安全拒絕，須先取得不含機密的協定證據再另審。

既有 bootstrap 的省略第三參數分支維持相同輸出；預覽傳入由 allowlist 建成的 canonical URL，
以明確有效的介面語言跳過既有 preference API，避免身份驗證／DB 副作用。
外部登入只嘗試一次；native 未登入、登入回跳仍未登入、ID token 缺失或 init 失敗均停止並顯示提示。
此處只確認 SDK 登入初始化，不把未送往 verifier 的 ID token 當成已驗證資格。

## 預覽與隱私邊界

- 明示「測試預覽，尚未記錄出席」；三語 UI，大字可縮放、觸控目標至少 48px、
  `role=status`／`aria-live` 狀態、可見焦點，不依賴音效或震動，附企業 footer。
- 只展示 code；沒有可信 lookup，不聲稱場地名稱、時段、距離、在場或簽到成功。
- 登入初始化成功前，定位按鈕與語言選擇停用。
  只有本人按「確認位置並測試」才呼叫 `getCurrentPosition`。
- 定位使用 `timeout:10000`、`maximumAge:0`、`enableHighAccuracy:false`。
  處理拒絕、timeout、unavailable、unsupported 及同步例外；可重試並防重複點擊。
- 成功 callback 不讀取／序列化 coords，不存變數／storage／URL／log、不傳 API／analytics。
  只顯示「定位已取得，但未經後端場地驗證。這只是測試，尚未記錄出席。」
- 不寫 attendance、不建立／修改日課、不推播、不呼叫舊 `/api/v1`、不做 server verifier／lookup。
  權威日期、學員映射、privacy／逐操作授權、場地／時間窗、防重與真實出席寫入不在本批。
- 回既有「記錄今天功法與感受」連結固定 `/line/checkin?lang=<枚舉>`，
  不帶 venue/source、callback、token、fragment 或定位。
- 預覽與參數錯誤頁皆 `Cache-Control: no-store`、`X-Robots-Tag: noindex, nofollow`、
  `Referrer-Policy: no-referrer`、nosniff；HTML 另有 robots/referrer meta。
  CSP 只允許 inline UI／既有 LINE SDK，connect-src 只有 LINE API（SDK 所需），沒有 self API。
  無外部 QR、圖片、字型、分析服務；GPS 不影響任何網路 request。
- 既有 API logger 的完整 req.url redaction 保留；不宣稱 LINE／作業系統或外部代理不處理 URL。

## 本地驗證與限制

所有測試只有 mock SDK／verifier／fetch／pool、純函式、VM 或靜態 SQL 契約。
沒有讀 `.env`／secrets、連 DB／LINE／其他網路 API、執行 migration、部署、push／merge、
改 package／lockfile／全域設定或開子代理。`env -u TEST_DATABASE_URL` 只移除測試連線選項。

```sh
# 新路由 63 + 既有頁面 46 = 109 passed；每次 TS 批次修改／formatter 後執行
# 新測試 HTML 均經真正 buildApp inject，再執行產出的 inline script（外部 SDK 不載入）
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/line-venue-checkin.test.ts tests/learner-pages.test.ts tests/channel-workspace-pages.test.ts

# 完整本批相關回歸：451 passed，41 DB-dependent skipped（不是通過）
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/line-venue-checkin.test.ts tests/learner-pages.test.ts tests/channel-workspace-pages.test.ts tests/line-security.test.ts tests/field-checkin.test.ts tests/health.test.ts tests/admin-attendance.test.ts tests/admin-navigation.test.ts tests/line-checkin-nfc.test.ts tests/line-onboarding.test.ts tests/telegram-onboarding.test.ts tests/whatsapp-onboarding.test.ts tests/channel-workspace.test.ts tests/learner-privacy.test.ts tests/learner-privacy-pages.test.ts tests/whatsapp-checkin-completion.test.ts tests/telegram-miniapp-auth.test.ts tests/telegram-workspace-pages.test.ts tests/practice-notes.test.ts tests/request-log-privacy.test.ts tests/line-learner-identity.test.ts tests/line-profile.test.ts

# 54 passed；只讀 SQL 文字，沒有執行 SQL 或變更 0048
env -u TEST_DATABASE_URL pnpm --filter @qigong/database exec vitest run tests/nfc-security-quarantine.test.ts tests/field-attendance-schema.test.ts

# 四個 workspace package 均通過
pnpm typecheck
pnpm build

# 本批 TS 檔 lint 與新測試 strict typecheck 通過
pnpm exec eslint apps/public-api/src/line-venue-checkin-page.ts apps/public-api/src/application-page.ts apps/public-api/src/line-onboarding.ts apps/public-api/tests/line-venue-checkin.test.ts
pnpm exec tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck apps/public-api/tests/line-venue-checkin.test.ts

# 五檔以配置 Prettier 格式化，check 與 whitespace 檢查通過
pnpm exec prettier --check apps/public-api/src/line-venue-checkin-page.ts apps/public-api/src/application-page.ts apps/public-api/src/line-onboarding.ts apps/public-api/tests/line-venue-checkin.test.ts docs/operations/line-venue-checkin-preview.md
git diff --check
```

另以本地 TypeScript transpile／VM 比對基底 HEAD 與修改後的 `lineLoginScript`：
省略 continuation 的 3 locales × 2 LIFF ID（含 script 字元）共 6 組輸出 byte-identical。
本批測試／型別沒有失敗修復重試；未以全專案 lint 宣稱既有 lint 問題已修復。

**仍待驗證：** Node 目前 v26.10.0，非專案要求的 Node 24，須於 Node 24 重驗。
VM 不是完整瀏覽器／官方 SDK／真人登入證據；Android／iOS LINE、外部登入回跳、
真實 Console Endpoint／scopes、手機定位權限／timeout、文字縮放／觸控／讀屏仍須真人驗收。
沒有證明實際 DB 授權或任何真實出席流程；不得開啟 NFC gate 或解除 0048 來試此預覽。
