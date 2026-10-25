# 團練場出席管理：場地設定 UI 交接

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 範圍與實際可達性

基於 `8d46dc143c108da5e2399d78f1bdb9c68300367b`，獨立 worktree
`feature/venue-admin-fields-v1`；只修改／新增以下五檔：

1. `apps/public-api/src/admin-field-routes.ts`
2. `apps/public-api/src/admin-dashboard.ts`（只改團練導覽／頁名文字）
3. `apps/public-api/src/admin-venue-fields-page.ts`
4. `apps/public-api/tests/venue-fields-ui.test.ts`
5. 本文件

**交付的是可測試的 UI／route 拒絕邊界，不是可用後端或部署核准。**
未改 `admin-auth.ts`、`app.ts`、`admin-attendance-routes.ts`、migration、package 或 lockfile。
NFC default-off、feature readiness 拒絕、0048 quarantine 均原樣保留。
既有 `admin-auth.ts` 仍在 `registerNfcFeature` 裡註冊場地頁與 API，因此正式
`buildApp` 的 default-off `/admin/fields` 與場地 API **仍為 404**；明確 opt-in
也因 readiness 拒絕而無法啟動。直接註冊 route 的測試不是正式 app 可達證據。

即使直接註冊本批 route，有 session 也只能看到 disabled 表單，capability 固定 false。
程式沒有實作 production 成功 mock、privileged fallback、任意 region 存取或虛構 SQL 函式。

## UI 與既有 transport 契約

- `GET /admin/api/fields/capabilities`：UI 僅在 `canManage === true` 才繼續載入。
- `GET /admin/api/fields`：成功 DTO 須為 `{ fields: PracticeFieldRow[] }`。
  依代碼／名稱搜尋、region UUID 與啟停篩選僅作用於已取得的列表，不擴大查詢範圍。
- `POST /admin/api/fields`：新增；`PATCH /admin/api/fields/:id`：編輯。
  沿用 `region_id/code/name_zh_tw/name_en/latitude/longitude/radius_meters/
active_time_rules/is_active`；沒有新增後端路由或依賴。
- 儲存只接受 HTTP 成功且 `{ ok: true, field: PracticeFieldRow }`，再重新讀 capability 與列表。
  HTTP 失敗、非 JSON、畸形 DTO 都不顯示成功；若寫入回應／網路不確定，需重新載入確認。
- 每週勾選 0–6（週日–週六）、HH:mm 起訖、不支援跨夜；半徑 5–5000 公尺。
  時區仍為待後端明訂的既有契約，不根據瀏覽器時區推定可簽到時段。
- Region 選項沒有可重用且已授權的 API，暫用 UUID 輸入，明示不能靠輸入 UUID 取得授權。
- 舊代碼可保留編輯設定；入口預覽另要求小寫連字號格式，如 `tw-tpe-daan`。
  不擅自將舊 uppercase／underscore 代碼轉成另一場地。改代碼後需更新 NFC／QR／連結。
- 初始、載入中、capability 拒絕及 401／403／404／503 後停用編輯。
  送出中停用表單／新增／重載與列表編輯，防止重複寫入。
  一般失敗保留嘗試輸入；重新載入／選擇新增會重新填表，不提供草稿持久化。
- 400／401／403／404／409／503／其他 HTTP、網路、JSON 錯誤均為固定本地提示，
  不渲染上游 error/details/diagnostic。讀取失敗不假裝成空列表。
- 新功能內容明確以 `lang="zh-Hant"` 標記繁中；shell 繼續既有三語導覽。
  新表單全文的英語／簡中翻譯尚未製作，不是假稱已全面本地化。

## Fail-closed 與安全邊界

- 本批移除舊場地 `canManageFields` 的 `.catch(() => true)` 及未授權直接表 SQL，
  不把 `admin.can_manage_admin_access()`／`checkin.read` 當成場地寫入權限。
- 目前 `GET capabilities` 對已登入者回
  `{ canManage: false, reason: 'field_authorization_unavailable' }`；
  列表、detail、新增、PUT、PATCH 對已登入者回 503／`field_authorization_unavailable`。
  寫入仍先檢查既有 CSRF（失敗 403）；無 session／session lookup 失敗回 401。
  這些拒絕路徑不 connect／query DB。Pool 參數僅保留既有組裝簽名。
- 所有場地 route 保留 no-store、no-cache、no-referrer、nosniff；頁面用既有 admin CSP。
  瀏覽器 fetch 只走 same-origin、no-store；寫入帶既有 `x-csrf-token` cookie 值。
  動態場地資料只用 textContent／value，LIFF 設定用 script-safe JSON。
- 新內容為 1.25rem，大字 label／控制項；最小 48px 觸控，允許 viewport 縮放。
  場地頁自己的 style 也將 sidebar 控制項提高到 48px，不改全域 layout 檔。
  保留公司 footer、live status、表單 label 與 focus outline。
- 無日課、功法、心得、原始學員 GPS 的讀寫或新記錄／日誌。

**仍有禁改檔的安全阻擋：** `admin-attendance-routes.ts` 的
`canReadAttendance` 目前仍含 `.catch(() => true)`，且報表／CSV 的逐操作 scoped
授權未完成。依本任務明令禁止，沒有越界修改；不能宣稱「全部管理端點已安全」。
目前正式 app 的 default-off／readiness 與 DB quarantine 仍阻擋這些入口。
父代理必須在其他批次移除該 fail-open 並完成授權，才能考慮啟用團練管理功能。

## NFC／QR／Link

可複製網址格式：

```text
https://liff.line.me/{liffId}/venue-checkin?venue=tw-tpe-daan&source=nfc
https://liff.line.me/{liffId}/venue-checkin?venue=tw-tpe-daan&source=qr
https://liff.line.me/{liffId}/venue-checkin?venue=tw-tpe-daan&source=link
```

沒有 LIFF ID、ID 不安全或 venue 格式不符時不產生網址，UI 提示原因。
這些網址對齊現有 `line-venue-checkin-page.ts` 的 preview entry 契約；
不提供簽到成功、可信場地查詢或防轉傳保證。source 僅為來源標記。
沒有發送請求、外部 QR API、外部 QR 圖片或新增 QR 依賴；UI 明示「未生成 QR 圖片」。
Clipboard 失敗會選取網址供手動複製。

`generateFieldNfcUrl`／`generateFieldQrCodeUrl`／`buildFieldUrls` 保留匯出名稱，
但改為上述入口預覽。legacy `qrcode_url` **是目標網址而非圖片**，`target_url` 為 source=link。
legacy `baseUrl`／`qrCodeSize` 不再生效；不允許藉此外送場地資料。
目前除舊測試外沒有其他 helper caller；父代理整合時須同步舊斷言／任何新增 caller。

## 本地驗證與限制

只用 mock fetch／mock DB 邊界、實際 render 輸出的腳本及靜態 migration 契約。
DOM harness 會拒絕 innerHTML；測試 capability、HTTP／JSON／network 失敗、清除 stale
列表、disabled、表單填值／payload／啟停、CSRF、重複送出、escaping、clipboard、URL parser
相容性與普通導覽。原生表單 validity 只模擬 reportValidity 結果與檢查實際 markup，
不是完整真實瀏覽器／觸控／視覺測試，也不證明 PostgreSQL ACL、LINE LIFF 或端到端可用。

實際命令：

```sh
pnpm install --frozen-lockfile --offline

# 320 passed、2 DB-dependent skipped（skipped 不是通過）
env -u TEST_DATABASE_URL pnpm --filter @qigong/public-api exec vitest run tests/venue-fields-ui.test.ts tests/admin-navigation.test.ts tests/admin-dashboard.test.ts tests/admin-auth.test.ts tests/admin-branding.test.ts tests/field-checkin.test.ts tests/health.test.ts tests/line-venue-checkin.test.ts tests/line-checkin-nfc.test.ts tests/line-learner-identity.test.ts tests/line-profile.test.ts tests/request-log-privacy.test.ts

# 54 passed；僅靜態讀取 migration，未執行 SQL
# 配合上述 public API 測試，共 374 passed、2 skipped
 env -u TEST_DATABASE_URL pnpm --filter @qigong/database exec vitest run tests/nfc-security-quarantine.test.ts tests/field-attendance-schema.test.ts

pnpm typecheck
pnpm build
pnpm exec eslint apps/public-api/src/admin-field-routes.ts apps/public-api/src/admin-dashboard.ts apps/public-api/src/admin-venue-fields-page.ts apps/public-api/tests/venue-fields-ui.test.ts
pnpm exec tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck apps/public-api/tests/venue-fields-ui.test.ts
pnpm exec prettier --check apps/public-api/src/admin-field-routes.ts apps/public-api/src/admin-dashboard.ts apps/public-api/src/admin-venue-fields-page.ts apps/public-api/tests/venue-fields-ui.test.ts docs/operations/venue-fields-ui.md
 git diff --check
```

- 專用 UI 測試 33 passed；每次 TS 修改後執行相關本地測試。
- 本批修復兩輪：async DOM listener 的 ESLint 限制；隨之讓 harness 在 void listener
  後 drain 非同步工作，並修正測試 lint。未超過三輪預算。
- `pnpm typecheck`／`pnpm build` 四個 workspace package 通過；修改的四個 TS 檔
  ESLint 及專用測試 strict tsc 通過。
- 全專案 `pnpm lint` 仍有既有 9 errors：禁改的 `admin-attendance-routes.ts`（1）及
  未修改的 `line-checkin-nfc.test.ts`（8）。沒有擴大批次修復。
- 另外執行既有 `admin-attendance.test.ts`：14 passed、**9 failed**。
  失敗為 6 個舊 URL／外部 QR 斷言、3 個舊導覽／頁名斷言，與本任務新規格衝突。
  不恢復第三方 QR 或舊標題來讓過時測試通過；該測試檔不在允許五檔內，交父代理更新。
  本批新增測試涵蓋新 URL／名稱契約；不能把全套測試描述為全綠。
- Node 為 v26.10.0，非專案要求的 Node 24；pnpm 有 engine warning，仍需 Node 24 重驗。
- 未讀 .env／secrets、連任何 DB／外部 API、執行 migration、deploy、push、merge 或開子代理。
  依賴使用本地離線 cache frozen install，沒有修改 lockfile。
- 介面沒有可呼叫的 `allow_tool: false` hook；commit 不代替結構安全審核。

## 父代理待接線（不得靠開 gate 跳過）

1. 先修補獨立 attendance／CSV 邊界的 fail-open、action／有效 grant／region scope。
2. 設計並審核場地 read/manage 的 DB 受控函式與逐操作／region 授權；`field.manage`
   不能靠舊 probe 字串或登入推定存在。受控函式、RLS／ACL、quarantine 替換及真實隔離
   PostgreSQL 證據須另批核准；本批沒有寫出虛構 production SQL。
3. 若要先展示 disabled UI，另審僅頁面與能力拒絕路由的獨立註冊，保留 session／CSP；
   本批未動 `admin-auth.ts`，不得把 UI 工作當成允許移除 feature readiness／0048。
4. 後端接通時保留現有 DTO、CSRF／no-store，所有 route 都在 DB 層重查 scope；
   決定 region 選項與時區契約、錯誤代碼及 list 規模／分頁，再擴展 UI，不可塞 production mock。
5. 確認 LIFF ID 的 endpoint／appended `/venue-checkin` 設定；做真實 LINE 與手機檢查。
   現有 learner preview 仍不是可信身份＋privacy＋場地／attendance 驗證。
6. 經檔案所有者同意後同步 `admin-attendance.test.ts` 的 9 個過時斷言，並於 Node 24 重跑回歸。
