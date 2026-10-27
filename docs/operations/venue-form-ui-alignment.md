# 團練場出席管理：場地資料輸入表單對齊與無障礙 UI 重構交接

> 整合狀態：本地 worktree `feature/venue-form-alignment` 基於 `origin/main@407f2f9` 獨立交付。
> 本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
> Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

---

## 1. 任務範疇與邊界保證

- **變更檔案限制**：嚴格控制於 3 檔（<= 5 檔上限）：
  1. `apps/public-api/src/venue-management-page.ts`（表單 renderer、結構標記與 CSS 表格化排版）
  2. `apps/public-api/tests/venue-management.test.ts`（表單排版契約、欄位成對佈局、無障礙 label 關聯與響應式斷言測試）
  3. `docs/operations/venue-form-ui-alignment.md`（本交接紀錄與視覺驗證文件）
- **完全不修改**：
  - 資料庫 / migration（0001–0055 保持原樣）
  - 後端 API 路由與 Controller（`apps/public-api/src/venue-management-routes.ts`、`venue-management.ts`）
  - 權限契約（`venue_attendance.field.manage` / `capabilities`）
  - CSRF 檢查與 Origin 驗證
  - LINE / Telegram / WhatsApp 各平台入口與 RichMenu
  - `package.json` / `pnpm-lock.yaml`（未安裝新依賴、無 lockfile 修改）
- **完整保留現有前端介面元素契約**：
  - 全部 29 個既有 DOM 元素 ID 100% 相同：`vm-root`, `vm-region`, `vm-load`, `vm-add`, `vm-status`, `vm-search`, `vm-filter`, `vm-list`, `vm-form`, `vm-editor`, `vm-version`, `vm-code`, `vm-name_zh_tw`, `vm-name_en`, `vm-address`, `vm-region_id`, `vm-latitude`, `vm-longitude`, `vm-radius_meters`, `vm-timezone`, `vm-day-0`～`vm-day-6`, `vm-start`, `vm-end`, `vm-active`, `vm-reason`, `vm-save`, `vm-links`, `vm-print`, `vm-sign`。
  - 所有唯讀控制（`vm-code` 編輯既有場地時 readonly）、必填屬性（`required`）、數字精度（`step="any"`）、時段格式正規表達式（`pattern="([01][0-9]|2[0-3]):[0-5][0-9]"` 與 `pattern="(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)"`）、異動原因長度（`maxlength="500"`）完全保留。
  - 前端 controller 邏輯不變，完全無 unescaped `innerHTML` XSS 風險，嚴格採用 safe DOM `textContent` 與 `value` 操作。

---

## 2. 前後設計差異比較（Before vs. After）

| 設計維度             | 原始實作（Before）                                                                                          | 重構後實作（After）                                                                                                                                                               |
| :------------------- | :---------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **輸入框對齊**       | 每個欄位僅以 `<label>文字<input></label>` 包覆，標籤字數長短不一，導致所有 textbox 水平起點與寬度參差不齊。 | 導入結構化表單表格 `.vm-form-table` 與 `.vm-form-row`，桌面端統一標籤欄寬（180px）與輸入控制欄（`minmax(0, 1fr)`），左右邊界精準對齊。                                            |
| **座標呈現**         | 中心緯度與經度分成上下兩列各自獨立，佔用空間且不符合地理座標填寫習慣。                                      | 採用子網格 `.vm-pair-grid`，中心緯度（-90～90）與中心經度（-180～180）左右成對並排，每項具備明確子標籤與驗證提示。                                                                |
| **半徑與時區**       | 半徑與 IANA 時區各佔一整行，缺乏視覺關聯。                                                                  | 採用子網格 `.vm-pair-grid`，將打卡半徑（1～5000 公尺）與 IANA 時區（如 `Asia/Taipei`）左右並排整齊呈現。                                                                          |
| **每週開放時段**     | 7 個 checkbox 與文字混雜無邊框；開始與結束時間各佔一列。                                                    | 開放日轉為按鈕化膠囊群組 `.vm-days-group`（週日～週六，具備 `:has(input:checked)` 視覺反饋）；開放時段（開始 HH:mm 與結束 HH:mm）左右並排成對呈現。                               |
| **唯讀資訊與 UUID**  | `#vm-version` 僅為普通 `<p>` 文字；代碼唯讀無專屬視覺回饋。                                                 | `#vm-version` 轉為突出的卡片識別橫幅 `.vm-version-banner`（支援 `tabindex="-1"` 焦點鎖定）；代碼在編輯模式提供 `.vm-input[readonly]` 淺灰底色與明確不可改說明。                   |
| **必填／提示／錯誤** | 必填無星號標記，提示文字與錯誤缺乏統一欄位對應。                                                            | 每列左側標籤標註紅色星號 `<span class="vm-req">*</span>` 或 `（選填）`，下方附上輔助提示 `.vm-field-hint`；狀態訊息列 `#vm-status` 具備 `role="status"` 及 `aria-live="polite"`。 |
| **區塊視覺層次**     | 清單與編輯表單垂直連續堆疊，缺少工作區卡片分割。                                                            | 採兩欄 Master-Detail 工作區 `.vm-workspace`：左側為「場地清單」過濾與卡片流；右側為「場地資料編輯」完整表單；底部獨立「NFC／QR URL 管理」與列印牌牌區。                           |
| **動作按鈕**         | 按鈕散落在表單與輸入框旁，尺寸與風格不一。                                                                  | 統一為 `.vm-btn` 系統（主要按鈕 `.vm-btn-primary` 為深藍 `#082850`、次要按鈕 `.vm-btn-secondary`），表單右下角固定儲存按鈕位置，最小高度 44px（行動端 48px）。                    |

---

## 3. 桌面與手機端排版策略（Desktop & Mobile Strategy）

### 3.1 桌面端策略（Viewport > 1024px）

- **雙欄 Master-Detail 工作區**：
  - 左側固定寬度面板（`minmax(280px, 340px)`）：包含「場地清單」標題、搜尋關鍵字輸入框、狀態篩選下拉選單，以及可捲動的場地卡片清單（`max-height: 680px`）。
  - 右側主編輯卡片（`minmax(0, 1fr)`）：承載 `<fieldset id="vm-editor">`，以純 CSS Grid 打造無障礙表單表格：
    - `grid-template-columns: 180px minmax(0, 1fr)`：左欄固定 180px 供標題與提示，右欄彈性伸展輸入控制項。
    - 座標、半徑/時區、時段時窗採用 `grid-template-columns: 1fr 1fr` 兩兩並排。
- **邊框與視覺韻律**：每行以細線分隔（`border-bottom: 1px solid var(--surface-muted)`），提供表格般的整齊讀取感，但保留標準 HTML5 表單語意。

### 3.2 平板端策略（769px ~ 1024px）

- Master-detail 自動降級為單欄堆疊（`grid-template-columns: 1fr`），場地清單置頂、場地編輯表單緊隨其後，表單內部仍維持 180px 標籤寬度的表格化對齊。

### 3.3 手機窄屏端策略（<= 768px）

- **無水平爆版（Zero Horizontal Blowout）**：
  - 表單行自動轉為單欄（`grid-template-columns: 1fr`），標籤文字自然浮於輸入框上方，絕不橫向捲動爆版。
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

## 4. 驗證與測試結果

### 4.1 本地 Node 24 靜態檢查與測試

本工作區環境已設定 `/opt/homebrew/opt/node@24/bin`：

- `pnpm format:check`：**PASS**（All matched files use Prettier code style）
- `pnpm lint`：**PASS**（ESLint 通過無警告）
- `pnpm typecheck`：**PASS**（4 個 workspace packages TypeScript 編譯無錯誤）
- `pnpm build`：**PASS**（`packages/config`, `identity`, `database`, `apps/public-api` 全數 build 成功）
- `pnpm --filter @qigong/public-api test tests/venue-management.test.ts`：**25 passed (25)**
- 全倉 `pnpm test`：**81 test files passed, 2243 tests passed (0 failed)**

### 4.2 真實本機瀏覽器視口截圖比對

本機安裝有 Google Chrome 156（`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`），透過 headless 模式自本地渲染 HTML 產出真實視口截圖（無須登入正式環境、無外網 API 呼叫、無第三方依賴）：

- **桌面端預覽截圖**（1280x1800）：`/tmp/venue-management-desktop-full.png`（261KB）
  - 驗證標籤 180px 統寬、Textbox 邊界完美切齊。
  - 驗證中心緯度／經度並排、半徑／時區並排、開放開始／結束時段並排。
  - 驗證左側場地清單與右側編輯表單清晰區分。
- **手機端預覽截圖**（390x2000）：`/tmp/venue-management-mobile-full.png`（139KB）
  - 驗證窄屏無水平捲動爆版。
  - 驗證所有表單項目轉為單欄並維持 48px 觸控高度。
  - 驗證字級維持 1rem，無 iOS 縮放問題。
- **預覽 HTML 原始檔**：`/tmp/venue-management-preview.html`（57KB）

---

Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
