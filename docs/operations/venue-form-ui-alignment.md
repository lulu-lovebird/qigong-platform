# 團練場出席管理：場地資料輸入表單對齊與行動端無障礙 UI 重構交接

> 整合狀態：本地 worktree `feature/venue-form-alignment` 基於 `origin/main@407f2f9` 獨立交付。
> 本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
> Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

---

## 1. 任務範疇與邊界保證

- **變更檔案限制**：嚴格控制於 3 檔（<= 5 檔上限）：
  1. `apps/public-api/src/venue-management-page.ts`（表單 renderer、結構標記與 CSS 表格化排版、行動端約束修正）
  2. `apps/public-api/tests/venue-management.test.ts`（表單排版契約、欄位成對佈局、無障礙 label 關聯、標籤星號相鄰及響應式斷言測試）
  3. `docs/operations/venue-form-ui-alignment.md`（本交接紀錄、根因分析與 Chrome 裝置模擬驗證文件）
- **完全不修改**：
  - 資料庫 / migration（0001–0055 保持原樣）
  - 後端 API 路由與 Controller（`apps/public-api/src/venue-management-routes.ts`、`venue-management.ts`）
  - 權限契約（`venue_attendance.field.manage` / `capabilities`）
  - CSRF 檢查與 Origin 驗證
  - LINE / Telegram / WhatsApp 各平台入口與 RichMenu
  - `package.json` / `pnpm-lock.yaml`（未安裝新依賴、無 lockfile 修改）
- **完整保留現有前端介面元素契約**：
  - 全部 35 個既有 DOM 元素 ID 保留，另新增 2 個標題 ID（共 37 個唯一 ID）；既有清單為：`vm-root`, `vm-region`, `vm-load`, `vm-add`, `vm-status`, `vm-search`, `vm-filter`, `vm-list`, `vm-form`, `vm-editor`, `vm-version`, `vm-code`, `vm-name_zh_tw`, `vm-name_en`, `vm-address`, `vm-region_id`, `vm-latitude`, `vm-longitude`, `vm-radius_meters`, `vm-timezone`, `vm-day-0`～`vm-day-6`, `vm-start`, `vm-end`, `vm-active`, `vm-reason`, `vm-save`, `vm-links`, `vm-print`, `vm-sign`。
  - 所有唯讀控制（`vm-code` 編輯既有場地時 readonly）、必填屬性（`required`）、數字精度（`step="any"`）、時段格式正規表達式（`pattern="([01][0-9]|2[0-3]):[0-5][0-9]"` 與 `pattern="(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)"`）、異動原因長度（`maxlength="500"`）完全保留。
  - 前端 controller 邏輯不變，完全無 unescaped `innerHTML` XSS 風險，嚴格採用 safe DOM `textContent` 與 `value` 操作。

---

## 2. Chrome 行動裝置模擬問題根因分析（Root Cause Analysis）

在檢視原始截圖 `/tmp/venue-management-mobile-full.png`（390x2000）時發現的三大問題，經由真實 Chrome DOM 幾何與 CSS 計算分析，定位出精確根因：

### 2.1 截圖右側裁切（390px 視口爆版現象）根因

1. **macOS Headless Chrome CLI 視窗最小寬度限制**：
   - 使用 macOS 原生 Chrome CLI 搭配 `--window-size=390,2000` 執行 headless 截圖時，作業系統視窗元件存在 500px 最低寬度約束。
   - Chrome 在未開啟 CDP Device Emulation（裝置模擬）的情況下，將 `window.innerWidth` 渲染為 500px，因此頁面元素（Header 下拉選單、導覽區塊、各 Card 容器）依 500px 寬度展開佈局。
   - 但 `--screenshot` 參數硬性以 (0,0) 裁切出 390px 寬度，導致圖片右側 110px 內容被裁切。
2. **HTML 標籤未成對提早閉合（Unclosed Tag Early Closure）**：
   - 經由語法分析發現，先前提交中開放時段的 HTML 標記存在一段重複的 `vm-start`/`vm-end` 片段與多餘的 `</div>` 閉合標籤，導致 `<form id="vm-form">`、`<section id="vm-root">` 及 `.shell` 在開放時段後提早閉合。
   - 此錯誤將後續的 `.vm-form-actions`、`#vm-save`、`.vm-links-panel` 擠出 `#vm-root` 外部直接掛載至 `<body>`，脫離了 `#vm-root` 的 scoped CSS 保護。
3. **修正策略**：
   - 剔除 HTML 重複片段，修正表單與根容器提早閉合。
   - 為 `#vm-root` 內的所有 fieldset、input、select、card、panel 全面施加 `min-width: 0; min-inline-size: 0; box-sizing: border-box; overflow-wrap: anywhere; word-break: break-word;`。
   - 絕不使用 `overflow-x: hidden` 掩飾問題，在真實 Chrome CDP 裝置模擬下於 320/390/768/1280 視口全面達成 `document.documentElement.scrollWidth <= window.innerWidth` 且 `overflowCount: 0`。

### 2.2 查詢區域 UUID 輸入框到按鈕間約 250px 空白根因

1. **Flex 方向由 Row 轉 Column 導致 Flex-basis 軸向轉變**：
   - 桌面端 `.vm-toolbar-row` 採用 `display: flex; flex-direction: row;`，其中 `.vm-region-group` 設定了 `flex: 1 1 20rem;`（20rem = 320px 寬度）。
   - 在 768px 以下行動端時，`.vm-toolbar-row` 被設定為 `flex-direction: column; align-items: stretch;`。
   - 在 Flex column 容器中，主軸（Main Axis）變為**垂直方向**，原本預期為寬度的 `flex-basis: 20rem` 被瀏覽器解讀為**高度基準 320px**！
   - 因 Label 與 Input 實際高度合計僅約 67px，剩餘約 253px 空間被撐開為巨大的垂直空白。
2. **修正策略**：
   - 將 `.vm-toolbar-row` 改以結構化 CSS Grid 實作：
     - 桌面端：`grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 0.75rem;`（左側輸入框填滿，右側按鈕底部對齊）。
     - 768px 以下行動端：`grid-template-columns: 1fr; grid-auto-rows: min-content; align-items: stretch; gap: 0.75rem;`。
   - 設定 `grid-auto-rows: min-content` 徹底消除空白伸展，輸入框到底部按鈕垂直間距縮減至精確 12px（0.75rem），完全消弭 250px 異常空白。

### 2.3 必填星號（*）獨占多行根因

1. **Admin Layout 全域 `label { display: grid; gap: .25rem; }` 繼承**：
   - 全域 Admin Layout 設定了 `label { display: grid; gap: .25rem; }`。
   - 子欄位標籤 `<label for="vm-latitude" class="vm-sublabel">中心緯度（-90～90）<span class="vm-req">*</span></label>` 也是一個 `<label>`。
   - 在 CSS Grid 下，匿名文字節點變成第一列 Grid Item，而 `<span class="vm-req">*</span>` 變成第二列 Grid Item，造成星號被強制獨立換行。
2. **修正策略**：
   - 將 `#vm-root .vm-field-label` 與 `#vm-root .vm-sublabel` 顯式定義為：
     ```css
     #vm-root .vm-field-label,
     #vm-root .vm-sublabel {
       display: inline-flex;
       flex-direction: row;
       align-items: baseline;
       flex-wrap: wrap;
       column-gap: 0.2rem;
       row-gap: 0;
       font-weight: 600;
       min-width: 0;
     }
     #vm-root .vm-req {
       color: #c02020;
       font-weight: 700;
       margin-left: 0.15rem;
       white-space: nowrap;
       display: inline-block;
     }
     ```
   - 藉由 `inline-flex` 搭配 `flex-direction: row` 與 `align-items: baseline`，在下列已測視口中文字與紅色星號保持同列；`white-space: nowrap` 僅作用於星號本身，不保證所有字型與極窄視口皆不換行。

---

## 3. 前後設計差異比較（Before vs. After）

| 設計維度             | 原始實作（Before）                                                                                          | 重構後實作（After）                                                                                                                                                               |
| :------------------- | :---------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **輸入框對齊**       | 每個欄位僅以 `<label>文字<input></label>` 包覆，標籤字數長短不一，導致所有 textbox 水平起點與寬度參差不齊。 | 導入結構化表單表格 `.vm-form-table` 與 `.vm-form-row`，桌面端統一標籤欄寬（180px）與輸入控制欄（`minmax(0, 1fr)`），左右邊界精準對齊。                                            |
| **座標呈現**         | 中心緯度與經度分成上下兩列各自獨立，佔用空間且不符合地理座標填寫習慣。                                      | 採用子網格 `.vm-pair-grid`，中心緯度（-90～90）與中心經度（-180～180）左右成對並排，每項具備明確子標籤與驗證提示，星號不獨占行。                                                  |
| **半徑與時區**       | 半徑與 IANA 時區各佔一整行，缺乏視覺關聯。                                                                  | 採用子網格 `.vm-pair-grid`，將打卡半徑（1～5000 公尺）與 IANA 時區（如 `Asia/Taipei`）左右並排整齊呈現。                                                                          |
| **每週開放時段**     | 7 個 checkbox 與文字混雜無邊框；開始與結束時間各佔一列。                                                    | 開放日轉為按鈕化膠囊群組 `.vm-days-group`（週日～週六，具備 `:has(input:checked)` 視覺反饋）；開放時段（開始 HH:mm 與結束 HH:mm）左右並排成對呈現。                               |
| **唯讀資訊與 UUID**  | `#vm-version` 僅為普通 `<p>` 文字；代碼唯讀無專屬視覺回饋。                                                 | `#vm-version` 轉為突出的卡片識別橫幅 `.vm-version-banner`（支援 `tabindex="-1"` 焦點鎖定）；代碼在編輯模式提供 `.vm-input[readonly]` 淺灰底色與明確不可改說明。                   |
| **必填／提示／錯誤** | 必填無星號標記，提示文字與錯誤缺乏統一欄位對應。                                                            | 每列左側標籤標註紅色星號 `<span class="vm-req">*</span>` 或 `（選填）`，下方附上輔助提示 `.vm-field-hint`；狀態訊息列 `#vm-status` 具備 `role="status"` 及 `aria-live="polite"`。 |
| **查詢工具列**       | 區域查詢在手機端因 flex-basis 撐出約 250px 異常空白。                                                       | 改採 `grid-auto-rows: min-content`，手機端垂直間距精準控制為 12px，輸入框與按鈕緊湊可讀。                                                                                         |
| **動作按鈕**         | 按鈕散落在表單與輸入框旁，尺寸與風格不一。                                                                  | 統一為 `.vm-btn` 系統（主要按鈕 `.vm-btn-primary` 為深藍 `#082850`、次要按鈕 `.vm-btn-secondary`），行動端觸控尺寸嚴格保證 48px。                                                 |

---

## 4. 桌面、平板與手機端排版策略（Desktop, Tablet & Mobile Strategy）

### 4.1 桌面端策略（Viewport > 1024px）

- **雙欄 Master-Detail 工作區**：
  - 左側固定寬度面板（`minmax(280px, 340px)`）：包含「場地清單」標題、搜尋關鍵字輸入框、狀態篩選下拉選單，以及可捲動的場地卡片清單（`max-height: 680px`）。
  - 右側主編輯卡片（`minmax(0, 1fr)`）：承載 `<fieldset id="vm-editor">`，以純 CSS Grid 打造無障礙表單表格：
    - `grid-template-columns: 180px minmax(0, 1fr)`：左欄固定 180px 供標題與提示，右欄彈性伸展輸入控制項。
    - 座標、半徑/時區、時段時窗採用 `grid-template-columns: 1fr 1fr` 兩兩並排。
- **邊框與視覺韻律**：每行以細線分隔（`border-bottom: 1px solid var(--surface-muted)`），提供表格般的整齊讀取感，保留標準 HTML5 表單語意。

### 4.2 平板端策略（769px ~ 1024px）

- Master-detail 自動降級為單欄堆疊（`grid-template-columns: 1fr`），場地清單置頂、場地編輯表單緊隨其後，表單內部仍維持 180px 標籤寬度的表格化對齊。

### 4.3 手機窄屏端策略（<= 768px）

- **零水平捲動（Zero Horizontal Blowout）**：
  - 表單行自動轉為單欄（`grid-template-columns: 1fr`），標籤文字自然浮於輸入框上方。
  - 成對網格（`.vm-pair-grid`）自動轉為垂直單欄，輸入框全寬（`width: 100%`）。
- **觸控無障礙（48px Touch Targets）**：
  - 所有輸入框、按鈕、星期膠囊（`.vm-day-pill`）、狀態開關（`.vm-toggle-label`）最小高度強制提升至 `min-height: 48px`。
- **防止 iOS 自動放大（Anti-Zoom）**：
  - 手機端所有文字輸入項（`.vm-input`、`#vm-filter`）字級強制設定為 `font-size: 1rem`（16px），徹底避免 iOS Safari 在聚焦時自動觸發頁面放大。
- **無障礙標記**：
  - 每個輸入框皆具備 `<label for="vm-...">` 顯式關聯。
  - 星期選擇具備 `role="group"` 與 `aria-label="每週開放日選擇"`。
  - 狀態列具備 `role="status"` 與 `aria-live="polite"`。
  - 焦點以 3px 品牌次要色（`#305888`）外框與 2px offset 提供清晰鍵盤焦點提示。

---

## 5. Chrome CDP 裝置模擬與本地驗證結果（非實體手機）

### 5.1 本地 Node 24 靜態檢查與單元測試

- `pnpm format:check`：**PASS**（All matched files use Prettier code style）
- `pnpm lint`：**PASS**（ESLint 通過無警告）
- `pnpm typecheck`：**PASS**（4 個 workspace packages TypeScript 編譯無錯誤）
- `pnpm build`：**PASS**（`packages/config`, `identity`, `database`, `apps/public-api` 全數 build 成功）
- `pnpm --filter @qigong/public-api exec vitest run tests/venue-management.test.ts`：**25 passed (25)**。
- 2026-10-27 發布前重跑：Node **24.22.1**、pnpm **10.15.1**；frozen install、build、`tsc -p tsconfig.eslint.json --noEmit`、`tsc -p tsconfig.receipt-health.json` 及完整 `pnpm verify` 通過。
- 完整 verify 使用全新 Unix-socket-only PG17 合成測試庫（非正式 DB）：**157 test files passed、4 skipped；3057 tests passed、54 skipped、0 failed**（config 2、identity 6、database 561、API 2488）。Skipped 不計為通過。
- 額外 fresh PG17 focused runner：工具 25、history 17、management 14、people 11、QR 10，共 **77 passed、0 skipped**。
- 首次完整驗證因 PG 工具探索將 `/opt/homebrew/bin` 放到 PATH 首位，子程序誤用 Node26，使 3 個既有 Node24 CLI 測試失敗。明確指定 PG17 專用工具目錄後重跑成功；未改產品或刪減斷言。
- 發布前 source/compiled render 比對：controller source 與 inline scripts byte-identical；35 個舊 ID 全保留、37 個新 ID 唯一；既有 type/required/step/pattern/maxlength/disabled/readonly 屬性相同。

### 5.2 真實 Chrome 瀏覽器 CDP DOM 幾何與佈局指標（Layout Metrics）

透過 Google Chrome 156 經由 Chrome DevTools Protocol（CDP）於純本地無外網環境注入 Mock 資料並模擬不同設備視口驗證：

| 視口規格                | 設備類型       | `innerWidth` | `document.scrollWidth` | `body.scrollWidth` | 水平溢出元素數 | 查詢框至按鈕間距 |       星號同列對齊        | 輸入框高度 |
| :---------------------- | :------------- | :----------: | :--------------------: | :----------------: | :------------: | :--------------: | :-----------------------: | :--------: |
| **1280x900**            | 桌面端 Desktop |    1280px    |         1280px         |       1280px       |     **0**      |   並排底部切齊   | **同列** (`top: 845.7px`) |    44px    |
| **768x1024**            | 平板端 Tablet  |    768px     |         768px          |       768px        |     **0**      |     **12px**     |         **同列**          |    48px    |
| **390x844**             | 手機端 Mobile  |    390px     |         390px          |       390px        |     **0**      |     **12px**     |         **同列**          |    48px    |
| **320x640**             | 窄屏端 Narrow  |    320px     |         320px          |       320px        |     **0**      |     **12px**     |         **同列**          |    48px    |
| **390x844 @ 200% Zoom** | 無障礙放大     |    390px     |         390px          |       390px        |     **0**      |     **12px**     |         **同列**          |    48px    |

- **結論**：所有測試解析度均嚴格滿足 `document.documentElement.scrollWidth <= window.innerWidth`，無任何水平爆版或邊界裁切（`overflowCount: 0`）。查詢工具列垂直空白由 250px 大幅修復為標準的 12px 間距。

### 5.3 本機裝置模擬截圖檔案清單

所有截圖均產自本機 Chrome headless 搭配 Device Emulation，並非實體手機／iOS Safari 或正式登入頁驗收：

- **桌面端修復截圖**（1280x900 Viewport）：`/tmp/venue-management-desktop-fixed.png`
- **行動端修復截圖**（390x844 Viewport）：`/tmp/venue-management-mobile-fixed.png`
- **窄屏端修復截圖**（320x640 Viewport）：`/tmp/venue-management-320-fixed.png`
- **預覽 HTML 原始檔**：`/tmp/venue-management-preview.html`

---

Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
