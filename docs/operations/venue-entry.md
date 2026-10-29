# 多通路固定場地入口：第一批（僅 LINE 可用）

> 本文件保留第一批歷史結果；下文「沒有 QR 圖片／下載」及舊 admin helper 的描述不是現行 QR 功能契約。現行後台 PNG／A4 流程見 [場地設定操作文件](venue-management-settings.md)：編碼可信公開 `/venue-checkin` 入口，掃描後點 LINE 繼續；實際上線狀態另以發行驗證紀錄為準。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 範圍與狀態

以下為 `b65d142` 原交付紀錄；後續已本地合併 invitation／privacy 安全更新並重編號，未更新任何手機服務。現行 mapping 與驗證見 [本地整合紀錄](venue-renumber-integration.md)。

基底 `86eef8a6c4b052dc5568af8e897cc32df5ec167f`，開始時工作區乾淨。已核准固定平台 URL 方案，本批唯一 writer 為父 checkout，只修改四檔：

- `apps/public-api/src/venue-entry.ts`：公開入口、嚴格 parser、LINE chooser／redirect。
- `apps/public-api/src/app.ts`：使用既有 `line?.liffId` 註冊，不新增配置或 credential。
- `apps/public-api/tests/venue-entry.test.ts`：81 項實際 `buildApp`／mock SDK VM 測試。
- 本文件。

沒有部署、push／merge、啟停／重啟任何 runtime，現正跑的手機測試服務仍是舊版；本機 build 不代表服務已更新。本批沒有連 DB、LINE 或外部 API、讀取 `.env`／密鑰、開代理或更改 Tailscale，也沒有變更 package／lockfile／global config／migration／NFC gate。沒有可呼叫的 `allow_tool: false` hook；本機驗證及 commit 不是結構安全審核或部署核准。

## 長期 URL 契約

以下 host 是待核准部署的示意，不代表現已上線；`tw-location-test` 也不是已驗證或內建的場地資料。

```text
NFC 寫入：https://<平台主機>/venue-checkin?venue=tw-location-test&source=nfc
QR 內容：https://<平台主機>/venue-checkin?venue=tw-location-test&source=qr
一般連結：https://<平台主機>/venue-checkin?venue=tw-location-test&source=link
英文介面：https://<平台主機>/venue-checkin?venue=tw-location-test&source=qr&lang=en
```

貼紙／QR 固定使用平台 URL，**不印 LIFF ID 或 channel**。未來新增 Telegram／WhatsApp 時改 server chooser／adapter，無須換原貼紙。NFC 與 QR 分別保留 `source=nfc`、`source=qr`；同場同來源的多張貼紙使用同一 URL，不建立每貼紙 token／ID。source 只是可轉傳的分類，不是防偽、授權或在場證明。本批不送分析事件。

- `venue` 必填，唯一穩定 code，最多 64 字元，`^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$`；不 trim、不轉大小寫、不接受 DB UUID 或場地名稱替代。
- code 對應 `core.practice_fields.code`，**場地改名不改 code，停用後不重用 code**；重新配置營運場地必須維護永久綁定。這是營運／後續後台契約，本批未新增 DB immutable-code／tombstone 約束，不宣稱現有 DB 已禁止改碼或刪除後重用。
- `source` 可省略，入口 canonical 化為 `link`；其餘只接受 `nfc|qr|link`。
- `lang` 可省略，只接受 `zh_TW|zh_CN|en`；沿用有效 presentation cookie，否則 `zh_TW`。選擇 LINE 後明確保留語言，不呼叫偏好 API。
- `channel` 只供 chooser 內部點擊使用，省略即顯示入口；唯一允許值為 `line`。`telegram`／`whatsapp`／其他值一律 400，沒有假連結。
- URL 上限 512 字元。缺／空／重複（含 percent-encoded 同名 key）／未知參數、非法 code／source／lang／channel、無效 percent／UTF-8 編碼、fragment 都拒絕。錯誤頁不回顯輸入、不載 SDK、不跳轉。
- 不接受 token、idToken、person、GPS、日期、任意 redirect、`liff.state` 或 OAuth callback key；這些不是此公開平台入口的資料。

## LINE 路由與登入續接

```text
GET /venue-checkin?venue=...&source=qr&lang=en
  → 200 靜態 chooser，唯一可點連結為同源 channel=line
GET /venue-checkin?venue=...&source=qr&lang=en&channel=line
  → 303 https://liff.line.me/{server LIFF ID}/venue-checkin?venue=...&source=qr&lang=en
  → 既有 /line/?liff.state=<encoded appended path>
  → SDK init primary，SDK 負責 secondary
  → /line/venue-checkin?venue=...&source=qr&lang=en
  → 必要時外部 liff.login：canonical venue/source/lang + _line_login_attempt=1
  → 登入後清 callback，仍保留 venue/source/lang
```

LIFF ID 只取既有完整 server LINE 配置，沿用安全字元 `[A-Za-z0-9-]` 並限制最多 100 字元。不從 Host／forwarded headers、query 或 callback 決定目的地。目的 origin 固定 `https://liff.line.me`，沒有 open redirect、正式 ID 常數或新 credential。

未配置 LINE（或 ID 不安全）仍提供平台入口 200，明示暫不可用、不產生可點連結；直接要求 `channel=line` 回 503 且不跳轉。設定錯誤不 fallback 到其他通路。原 `/line/`、`/line/checkin`、LIFF preview renderer／登入 bootstrap 無修改。

本批沒有改 Console Endpoint；現有 repo 契約為 `/line/`，未向 LINE 核對。preview／真簽到仍由既有 server-only `venueQr` 決定，不因 `source=nfc` 開舊 NFC gate；詳見 [LIFF preview](line-venue-checkin-preview.md) 及 [QR backend](venue-qr-checkin.md)。

## 場地可信度與安全邊界

原實作已核對原編號 0047／0050 schema（現行未部署檔案更名為 0048／0051；歷史測試／SHA 不改寫），既有 admin read contract 與 `platform.venue_qr_checkin`：沒有已授權的匿名公開場地 lookup。本入口不接受 pool，不匿名 raw SELECT，不借用學員寫入函式查名稱，也不使用合成 fixture 或本地假 registry 當成可信資料。

因此合法語法但未知的 code 只安全顯示「場地代碼（未驗證）」；明示名稱、存在性及停用狀態均未確認。不冒稱可信名稱／啟用／簽到成功，也不因前端 code 合法就授權寫入。最終由既有簽到 backend 驗證 identity／privacy、venue 存在且 active、時間窗與半徑；未知／停用場地不可簽到。若 server 未開真簽到，後段仍只是 preview。

HTML 以 escape 處理 code 與 href，不反射原始 query／配置；頁面不含 script／外部資源、不要求定位或身份，不儲存資料。入口、錯誤頁及 303 都帶 no-store／no-referrer／noindex／nosniff、禁止 script／connect 的 CSP，及停用 geolocation／camera／microphone 的 Permissions-Policy。既有 req.url／body log redaction 保持；不宣稱可控制 LINE／代理或裝置自身記錄。

## 本地驗證

Node `24.22.1`，PATH 使用 `/opt/homebrew/opt/node@24/bin`。每檔修改後執行相關 mocktests；Prettier 後再測。只用 mock pool／verifier／fetch／SDK，沒有 DB／外部 API 連線。

```sh
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
unset TEST_DATABASE_URL DATABASE_URL VENUE_QR_ISOLATED_PG_DIR

pnpm --filter @qigong/public-api exec vitest run tests/venue-entry.test.ts tests/line-venue-checkin.test.ts
pnpm test
pnpm exec eslint apps/public-api/src/venue-entry.ts apps/public-api/src/app.ts apps/public-api/tests/venue-entry.test.ts
pnpm exec tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop apps/public-api/tests/venue-entry.test.ts
pnpm typecheck
pnpm build
pnpm exec prettier --check apps/public-api/src/venue-entry.ts apps/public-api/src/app.ts apps/public-api/tests/venue-entry.test.ts docs/operations/venue-entry.md
git diff --check
```

結果：新入口 **81 passed**；新入口＋原 LIFF preview **144 passed**。全 workspace：API **1580 passed / 243 skipped**、database **176 passed / 292 skipped**、config **2 passed**、identity **6 passed**，合計 **1764 passed / 535 skipped**。DB-dependent skips 不是通過或真 DB 授權證明。scoped lint、新測試 strict tsc、workspace typecheck／build 通過；沒有以 scoped lint 冒稱全倉 lint 通過。

lint 首次發現一個多餘 non-null assertion，第 1 輪移除後複驗通過；沒有用滿 3 輪修復預算。新 endpoint 測試覆蓋 3 source × 3 lang 完整 mock LIFF primary／secondary／外部 login／callback cleanup、無配置／不安全 ID、未知通路、未知 code 安全提示、重複及惡意輸入、固定轉址 origin、既有日課輸出不變。VM 不等於官方 SDK 或真人手機驗收。

## 下一批／未完成

1. **後台 URL／QR 生成尚未改為平台入口**：現有 admin helper 仍產生直接 LIFF URL。本批沒有 QR 圖片、下載／列印功能；不得宣稱後台已完成長期平台 QR。下一批需用可信已授權場地 code 產生平台 NFC／QR／link，並驗證停用及改名規則。
2. 若需要入口展示可信名稱／停用提示，先另審最小公開 lookup／授權契約；不可放寬現有匿名 DB 權限或復用寫入函式。
3. Telegram／WhatsApp 的 venue adapter、各通路驗證及跨 channel 共用簽到核心仍待實作／抽離；不能把目前 LINE-only backend 或其他通路日課當作已完成場地簽到，也沒有通路切換／身份合併。
4. 另行核准部署與 runtime 更新後，才做真實 LINE Console／SDK、手機掃 QR／NFC、外部登入回跳及真 backend／停用場地驗收；長期 host／URL 可達性也未在此驗證。
