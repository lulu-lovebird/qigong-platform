# Web Admin 權限與存取控制架構（供 Review 與維護）

**版本：正式環境 Schema 0064／程式 Commit `1ee1c71`，截至 2026-11-11。**

本文檔記錄 Qigong Platform Web Admin 與 Admin MCP 的各級角色權限模型、資料可見範圍與安全操作限制。
表格說明以「僅單獨持有該角色」為前提；多重角色授權採權限聯集且各依授權範圍限制。

---

## 一、 角色與資料可見範圍

| 角色代碼          | 角色名稱           | 授權範圍                | 一般打卡／統計報表 | 私密心得／感受         | 學員審核／註冊管理 | 實體場地管理／點名名冊 |
| :---------------- | :----------------- | :---------------------- | :----------------- | :--------------------- | :----------------- | :--------------------- |
| `super_admin`     | 最高系統管理員     | 全平台（Global）        | 全區               | 全區                   | 全區               | 全區                   |
| `master_admin`    | 老師               | 全平台（Global）        | 全區               | 全區                   | 不可               | 全區                   |
| `coach_admin`     | 氣功教練           | 全平台（Global）        | 全區               | 全區                   | 不可               | 全區                   |
| `global_viewer`   | 協會人員／全域唯讀 | 全平台（Global）        | 全區               | 不可                   | 不可               | 全區唯讀               |
| `regional_admin`  | 地區管理員         | 指定地區（Operational） | 授權地區           | 不可                   | 授權地區           | 授權地區               |
| `regional_viewer` | 地區心得檢視員     | 指定地區（Operational） | 授權地區           | 授權地區全部（含私密） | 不可               | 不可                   |
| _(未核准登入者)_  | 尚未指派角色       | 僅限本人申請            | 不可               | 不可                   | 不可               | 不可                   |

### 核心權限邊界要點：

1. **審核權與心得權分立**：`regional_admin` 負責學員報名與審核，但**無權閱讀學員私密心得**；`regional_viewer` 專責閱讀地區心得，但**無權審核學員**。兩者並非上下階層。
2. **老師 (Master) 與學員審核**：老師具有全區一般與私密心得檢視權、管理員授權管理權，但**不直接參與學員報名與審核流程**。
3. **私密心得可見性**：私密心得並非僅作者本人可見，持有全域私密權限（Super/Master/Coach）或該地區專屬檢視權（Regional Viewer）之管理員，基於關懷與輔導目的皆可閱讀。

---

## 二、 核心業務模組權限矩陣（包含新加入功能）

| 管理模組／操作項目                                         | Super Admin | 老師 Master | 地區管理員 Regional | 教練 Coach / 協會人員 Global | 備註與限制                                                |
| :--------------------------------------------------------- | :---------: | :---------: | :-----------------: | :--------------------------: | :-------------------------------------------------------- |
| **管理員申請／授權管理** (`/admin/administrators`)         |  完整管理   | 限一般角色  |         ❌          |              ❌              | 異動需版本鎖、不可自改權限、最後 Super Admin 保護         |
| **發行 LINE 具核准力邀請** (`/admin/line-invites`)         |     ✅      |     ❌      |         ❌          |              ❌              | 嚴格限定 `super_admin`，資料庫層級防禦（0029/0047）       |
| **練功指引活動管理** (`/admin/practice-guidance`)          |     ✅      |     ✅      |         ❌          |              ❌              | 建立、編輯、刪除特定期間指引與每日指引（0063）            |
| **成就系統發布／管理** (`/admin/achievements`)             |     ✅      |     ✅      |         ❌          |              ❌              | 成就規則草稿發布與版本推進（0040/0045）                   |
| **實體場地管理** (`/admin/venues`)                         |     ✅      |     ✅      |    僅限授權地區     |              ❌              | 場地新增、停用、更新經緯度與簽到半徑（0051/0054）         |
| **團練學員名冊／出席紀錄** (`/admin/venue/people`)         |     ✅      |     ✅      |    僅限授權地區     |             唯讀             | 出席明細查詢；志工代簽與作廢仍保留於受限契約              |
| **出席報表與 CSV 匯出** (`/admin/venue/attendance-report`) |     ✅      |     ✅      |    僅限授權地區     |         僅限全區唯讀         | 支援依日期、場地、簽到方式（NFC/QR）篩選                  |
| **快速感受標籤管理** (`/admin/practice-feeling-tags`)      |     ✅      |     ❌      |         ❌          |              ❌              | 需 `taxonomy.manage` 權限；改名／停用不洗歷史名稱         |
| **AI Agent 管理 MCP** (`/mcp/admin`)                       |     ✅      |     ❌      |         ❌          |              ❌              | **嚴格限定 Super Admin**；支援 Authgear OIDC 驗章（0064） |

---

## 三、 新功能權限設計專題目錄

### 1. 特定期間練功指引 (Practice Guidance Campaigns) — Schema 0063

- **適用角色**：`super_admin`、`master_admin`。
- **權限控制**：
  - 由 `admin.manage_guidance_campaign` 於資料庫層檢驗 `r.code IN ('super_admin', 'master_admin')`。
  - Web Admin 頁面由 CSRF 與 Session 雙重保護。
  - 地區管理員無權建立全域練功指引。

### 2. 實體場地管理與團練出席 (Venue Suite) — Schema 0051 ~ 0062

- **適用角色**：
  - `super_admin`、`master_admin`：全區所有場地之新增、編輯、停用與出席審閱。
  - `regional_admin`：僅可檢視與管理其所屬地區之場地與學員出席名單。
- **志工代簽與作廢保護**：
  - 既有 UI (`/admin/venue/people`) 預留 `volunteer_manual` 按鈕，但後端寫入通道預設關閉，未具獨立稽核契約前禁止擅自代簽。

### 3. AI Agent 管理 MCP (Admin MCP) — Schema 0064

- **適用角色**：**嚴格限 `super_admin`（首批）**。
- **身分驗證與授權機制**：
  - 採用 **OAuth 2.1 (Authgear OIDC Bearer Token + RS256 JWKS 驗章)**。
  - **資料庫即時雙重校驗**：不單信任 Token 內的 claim，後端每次處理請求必向 `admin.principals` 及 `admin.role_grants` 確認該人員當前仍處於 `status = 'active'` 且具備有效 `super_admin` 角色。
  - **二階段寫入防線**：任何未來的寫入操作必須遵循「Agent 準備提案 ➔ Super Admin 登入 Web 後台人工確認 ➔ Agent 執行」，禁止 AI 自行確認。
  - **只讀安全 Facade**：Migration 0064 提供的 `admin.mcp_read_*` 函式強迫檢查 `admin.is_super_admin()`，非 Super Admin 呼叫一律回傳 SQLSTATE `42501`。

---

## 四、 登入、身分判定與資安原則

1. **IdP 與平台身分分離**：
   - 透過 Authgear OIDC 登入成功，僅代表「通過第三方身分驗證」，**不自動代表取得任何管理權限**。
   - 系統依據 `oidc_issuer + oidc_subject` 作為唯一身分比對鍵，不以使用者輸入之 Email、名稱或 Authgear 角色進行自動提權或帳號合併。
2. **權限最小化原則**：
   - 地區性角色只能管理被指派的 operational region，無法跨區操作或探查其他地區學員個人資料。
   - 搜尋與報表查詢皆強制於 SQL 查詢層注入 `region_id` 篩選或 RLS 限制。
3. **不可變稽核日誌**：
   - 任何涉及管理員權限指派、邀請發行、指引異動、成就發布與場地設定等關鍵操作，皆寫入 `audit.events`，保留操作人員、時間戳記、前後版本與變更原因。

---

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
