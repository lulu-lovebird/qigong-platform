# 打卡小幫手管理 MCP v1 設計規格

狀態：設計草案；使用者已核准文件編寫及下列產品方向。**不是已實作、已部署或安全驗收通過的功能。**

開發署名：Bean, Bird & Badminton Tech Consulting。

## 1. 已確認決策與範圍

- 首批僅 Super Admin；不是所有已登入管理員都可使用。
- 目標客戶端：Pi、Claude、ChatGPT、Hermes Agent、OpenClaw、Muse。具體產品、版本、部署型態及相容性仍待驗證。
- HTTPS + MCP Streamable HTTP，採個人 OAuth 授權，不共用 Super Admin 金鑰。
- 寫入流程固定為「Agent 準備 → Web Admin 人員核准 → Agent 執行」。核准本身不寫入業務資料。
- 首版提案人與核准人為同一位 Super Admin；執行綁定原管理員及原 OAuth client。不是雙人覆核制度。
- 第一階段唯讀；第二階段加入邀請及練功指引受控寫入。後續學員審核、匯出、場地設定須另行核准。
- 本文件不授權實作、修改依賴、schema migration 或正式部署。

不提供任意 SQL、Shell、任意 HTTP 代理、管理員升權、密鑰管理、身分合併或無人值守寫入。人工補簽／作廢、成就發布及通知群發不在首版範圍。

## 2. 現有介面與整合界線

已定位的介面（實作前須重新核對版本）：

- `apps/public-api/src/admin-guidance-routes.ts`：`GuidanceRouteOptions`、`registerAdminGuidanceRoutes`；目前使用 session、CSRF，並呼叫 `admin.manage_guidance_campaign`。
- `apps/public-api/src/admin-line-invite-routes.ts`：`registerAdminLineInvites`；包含 principal、Origin／CSRF 與邀請建立邏輯。
- `apps/public-api/src/admin-access.ts`：管理員授權及審核輸入契約。
- `apps/public-api/src/admin-learner-routes.ts`、`venue-reporting-routes.ts`、`venue-management-routes.ts`：候選共用業務入口，尚未完成逐工具安全盤點。

```text
Agent → OAuth → MCP transport → 嚴格工具契約／授權／提案服務
                                      ↓
Web Admin → session + CSRF → 共用管理業務服務 → 受限 DB facade
                                      ↓
                               不可變稽核／操作結果
```

MCP 不是瀏覽器 API 的免 CSRF 後門。Web Admin 保留既有 session、Origin 與 CSRF 防護；Agent 不取得管理員 Cookie。共用服務接受由可信驗證器產生的操作身分，不信任工具參數中的 principal ID、角色或地區。

現有 SQL 若綁定 Web session，須設計受限的 MCP 身分轉接與資料庫授權契約；不得偽造 session 或退回資料庫擁有者角色。新資料結構採新增 migration，不重寫已套用的 migration 或 checksum。

## 3. 傳輸、OAuth 與身分

擬定端點 `/mcp/admin`；此路徑尚未註冊。

- 實作時固定 MCP protocol／authorization 規格版本與 SDK 版本，記錄支援的協定協商與 client 行為。
- OAuth Authorization Code + PKCE；確認既有身分服務能否提供所需功能，不能先假定 OIDC 登入等於完整 MCP OAuth 支援。
- 按所選規格提供 Protected Resource Metadata、授權伺服器 metadata／探索及 resource audience 綁定。
- 驗證 issuer、audience、expiry、scope、client 與目前管理員狀態。不得接受其他服務 token，或把上游 token 原樣交給下游。
- 嚴格 redirect URI、state 與 client 註冊政策；不預設接受任意動態註冊。
- Token 短效；如提供 refresh token，須安全保存、輪替、撤銷及偵測重用。
- 每次工具呼叫、核准及 commit 都重新驗證目前 Super Admin 資格；撤權或停用後不得繼續執行舊提案。
- 支援撤銷單一 client 授權、單一工作階段與全部授權；MCP transport session ID 不作為登入憑證。
- HTTP Origin 驗證、TLS、限流、請求大小及逾時限制；CORS 不作為授權機制。

Token 存活時間、重新驗證期限、註冊模式及撤銷生效機制須在實作前定案與測試。任何相容性轉接不得降低此邊界。

## 4. 權限與資料揭露

有效權限 = 目前 Super Admin 資格 ∩ OAuth scopes ∩ 工具階段開關 ∩ 業務資料限制。

建議 scope：`admin:summary:read`、`admin:learners:read`、`admin:invites:read`、`admin:invites:manage`、`admin:guidance:read`、`admin:guidance:manage`、`admin:venues:read`、`admin:audit:read`。

個資完整讀取、匯出、審核及場地寫入須另定 scope，不能由一般查詢隱含取得。即使是 Super Admin，仍預設回最少必要欄位，禁止自動帶回心得、同意紀錄或全部聯絡資料。

工具清單可按能力過濾，但每次呼叫仍須伺服器檢查；MCP read-only／destructive annotations 只是提示。

## 5. 工具契約

所有名稱均為擬定，尚未存在。輸入採 JSON Schema 與伺服器 strict validation，拒絕未知欄位及型別猜測。客戶端提供的識別碼只代表查詢目標，不代表授權。

### 第一階段：唯讀

| 工具                                           | 功能／限制                                     |
| ---------------------------------------------- | ---------------------------------------------- |
| `admin_get_capabilities`                       | 本人可用工具、scope、階段開關；不回憑證        |
| `dashboard_get_summary`                        | 明確日期範圍與時區的聚合統計                   |
| `learners_search`                              | 分頁搜尋，姓名與必要識別資訊；聯絡資料預設遮罩 |
| `learners_get`                                 | 單一學員的允許欄位，不預設回私密內容           |
| `applications_list`                            | 待審狀態唯讀，不核准                           |
| `invites_list`                                 | 管道、狀態、期限及使用量，不回原始 token       |
| `guidance_list` / `guidance_get`               | 活動及每日指引內容                             |
| `venues_list`                                  | 場地資料                                       |
| `attendance_search` / `attendance_get_summary` | 出席明細與摘要，不改日課                       |
| `audit_search`                                 | 受限稽核查詢，不回秘密或完整對話               |

### 第二階段：受控寫入

| 工具                      | 功能                                             |
| ------------------------- | ------------------------------------------------ |
| `invites_prepare_create`  | 明確管道、地區 ID、期限、額度、標籤與原因        |
| `invites_prepare_revoke`  | 明確邀請 ID、目前版本與撤銷原因                  |
| `guidance_prepare_create` | 日期範圍、時區政策、標題、狀態及內容預覽         |
| `guidance_prepare_update` | 指定版本的欄位差異，不能覆寫未指定欄位           |
| `guidance_prepare_import` | 驗證每日條目、重複日期及覆寫範圍；不抓任意 URL   |
| `guidance_prepare_delete` | 顯示刪除範圍及不可逆影響；依既有業務允許程度開放 |
| `operations_get`          | 查狀態、期限、核准連結及已保存結果               |
| `operations_commit`       | 僅執行已核准且版本有效的不可變提案               |

各寫入工具在共用服務完成相應契約前不公布。無法可靠做版本檢查的資料類型，必須先補齊，不以最後寫入覆蓋代替。

共同查詢欄位：明確篩選、cursor、limit、必要時區。回傳包含 `schemaVersion`、`requestId`、`data`、`asOf`、`nextCursor`、`truncated`、`warnings`；筆數與大小上限實作前固定。統計必須說明範圍與口徑，不將分頁資料假裝總計。

日期採 ISO 日期，時間採帶 offset 的 ISO timestamp；日界線依既有業務時區，不由 Agent 所在地推定。模糊日期、同名地區或學員須先澄清。

## 6. 提案、核准與執行狀態機

```text
pending_approval → approved → executing → succeeded
       │              │          ├→ failed
       ├→ rejected    ├→ stale   └→ outcome_unknown
       ├→ cancelled   ├→ expired
       └→ expired     └→ cancelled
```

- 提案保存正規化輸入、操作類型、精確目標、前後差異、版本、影響筆數、原因、建立人、client、內容雜湊及期限。
- 修改提案須建立新提案並使原提案失效；禁止核准後修改參數。
- Web Admin 擬定頁面 `/admin/mcp-operations`，沿用 `renderAdminShell`、既有登入及 CSRF。顯示明確日期、時區與副作用，不只顯示 AI 摘要。
- 審核者必須為原提案管理員且仍為 Super Admin。可信伺服器保存核准；Agent 傳 `confirmed: true`、文字「已核准」或偽造 callback 均無效。
- 核准頁 GET 及開啟連結沒有寫入副作用；核准／拒絕採受保護 POST。
- Agent 取得核准頁連結不等於取得核准權。連結不含 bearer secret，須正常登入。
- 核准不直接執行；Agent 查詢後 commit。不得以高頻輪詢等待，採受限重查／使用者回覆後接續。
- commit 綁定原 principal、client、內容 hash、版本、有效期限及單次操作；不綁死某個短效 access token，合法更新 token 後可接續。
- commit 原子認領操作，重新驗權及鎖定／比對資料版本。發現變更轉 stale，重新提案及核准。
- 提案期限不可由 Agent 任意延長；具體期限與核准後執行窗口待定。

## 7. 冪等、交易與未知結果

- prepare 與 commit 都有持久冪等契約：相同 principal/client/key 及相同內容回原結果；同 key 不同內容拒絕。
- 業務唯一限制與冪等鍵各自存在；不能用業務唯一鍵取代操作識別。
- 可在同一 DB 交易內完成的操作，業務異動、稽核及成功結果同時提交。
- 已成功操作重試只回原結果，不再建立邀請或修改資料。
- 網路逾時後先以 `operations_get` 查詢；不能以新 key 盲目重做。
- `outcome_unknown` 代表需要對帳，不可顯示失敗並鼓勵重送。復原後才轉成已確認結果。
- 首版不自動送訊息；未來外部副作用須經 transactional outbox、獨立冪等及對帳設計，不能宣稱跨系統 exactly-once。

業務錯誤採穩定代碼，例如 `permission_denied`、`approval_required`、`proposal_expired`、`version_conflict`、`idempotency_conflict`、`outcome_unknown`、`rate_limited`。MCP tool failure 與 transport／OAuth 錯誤分開；不得將失敗包成成功文字，或洩漏 SQL、堆疊與憑證。

## 8. 個資、邀請與匯出

- 授權前說明資料可能交由所選 AI 供應商處理；部署者確認資料保存與處理政策。不得將 BBB 自動視為服務營運者。
- 邀請原始 token 不回 Agent、不進普通 log。建立結果回 ID 及受保護的一次性展示入口。
- 一次性展示需設計短效加密保存、本人驗權、存取紀錄、到期刪除與遺失後撤銷重建流程；現有僅保存 token hash 的流程不能假設可事後還原網址。
- 若展示機制未完成，不開放 MCP 邀請建立；未核准敏感輸出前不以聊天直接返回 token 作替代。
- 後續匯出採登入保護與限時下載、下載時重新驗權、欄位白名單及 CSV 公式注入防護。不把整份個資檔送入模型，不接受任意外部上傳目的地。
- 日誌不含 Cookie、OAuth token、原始邀請 token、完整電話、私密心得或完整對話。

## 9. 稽核與 AI 安全

追加式稽核至少保存：server-resolved principal、client、tool、request/operation ID、目標、範圍、受限前後差異、版本、核准及執行時間、結果。敏感值遮罩或另置受限記錄；保留期限與清除政策待部署者確認。

學員姓名、CSV、心得及指引均為不可信資料，不是操作指令。伺服器不可依資料中的提示放寬權限；可信核准頁安全轉義內容，拒絕任意腳本及開放轉址。不得要求或保存模型隱藏推理。

設定呼叫速率、輸出大小、搜尋筆數、提案數與批次上限；首版不支援無範圍的全部核准／全部刪除。錯誤、計數、搜尋建議亦不可越權洩漏。

## 10. 驗收與發行閘門

- 非 Super Admin、過期／撤銷／錯誤 audience token 均拒絕。
- prepare 後撤權、核准後撤權及 commit 並行競爭測試。
- 原人不同 client、不同人、未核准、過期、內容被修改、版本 stale 均不能執行。
- prepare／commit 重送、交易 rollback、網路逾時與未知結果對帳。
- 提案 XSS、資料提示注入、錯誤與統計個資洩漏測試。
- Web Admin 與 MCP 對同業務操作結果一致，不弱化現有權限或 CSRF。
- 秘密不進模型回傳／日誌；邀請一次性展示與遺失恢復測試。
- 六種目標 client 分別完成版本化驗收；未測與轉接支援不可標成原生支援。
- 僅文件變更不代表上述測試完成。實作／review／正式部署需獨立計畫、核准及既有備份與回復閘門。

客戶端驗收見 [操作與相容性規格](../operations/admin-mcp-client-acceptance.md)。
