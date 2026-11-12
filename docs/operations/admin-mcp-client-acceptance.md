# 管理 MCP：客戶端設定與驗收規格

狀態：待實作／待實測。目標客戶端列入驗收，不代表目前可連線。沒有正式 MCP URL、可用 client ID 或已完成的相容性證據。

開發署名：Bean, Bird & Badminton Tech Consulting。

設計依據：[管理 MCP v1](../architecture/admin-mcp-v1.md)。首批僅 Super Admin，寫入由 Web Admin 核准、原 Agent 執行。

## 1. 支援分級與矩陣

- 原生支援：該具體產品／版本實測通過遠端 MCP、OAuth 及完整流程。
- 轉接支援：使用經審核的本機 adapter，清楚標示 adapter 版本、憑證保存與額外信任邊界。
- 不支援：已知缺少必要能力，不能降低安全規格硬接。
- 待驗證：尚無證據，不能推定成功。

| 客戶端       | 必須確認的產品資訊                                | HTTP／OAuth | 唯讀 | Web 核准後 commit | 目前分級 |
| ------------ | ------------------------------------------------- | ----------- | ---- | ----------------- | -------- |
| Pi           | 發行版本、MCP extension／adapter 及版本           | 待驗證      | 未測 | 未測              | 待驗證   |
| Claude       | Desktop／Web／Code 等具體產品、方案、版本         | 待驗證      | 未測 | 未測              | 待驗證   |
| ChatGPT      | Web／桌面、方案、workspace 與 connector／app 政策 | 待驗證      | 未測 | 未測              | 待驗證   |
| Hermes Agent | 正確專案來源、版本、執行環境及 MCP 整合           | 待驗證      | 未測 | 未測              | 待驗證   |
| OpenClaw     | 正確專案來源、版本、部署及 MCP 整合               | 待驗證      | 未測 | 未測              | 待驗證   |
| Muse         | 產品網址、供應商、版本及 MCP 整合；名稱可能重複   | 待驗證      | 未測 | 未測              | 待驗證   |

不得將某個產品的支援外推到同品牌其他產品。限制條件、付費方案或管理員允許清單都須列入實測記錄。

## 2. 實測前置資料

每個 client 記錄：

1. 官方產品／文件網址、查閱日期、安裝來源及精確版本。
2. OS、部署方式（本機／雲端）、MCP transport 與 protocol 版本。
3. OAuth resource discovery、PKCE、client 註冊、redirect URI 與 token refresh 支援。
4. 工具清單更新、結構化結果、錯誤與中斷後接續能力。
5. 憑證及對話保存位置、是否上傳 AI 供應商、如何撤銷／清除。
6. 實際測試環境與證據路徑，不含密鑰、Cookie 或真實學員資料。

實作前須確認既有身分服務能力；本文件不提供猜測的 OAuth endpoints 或未驗證設定 JSON。

## 3. 通用設定流程（待服務實作後執行）

1. 部署者提供核准的 HTTPS MCP URL 與環境識別，區分測試及正式環境。
2. 依該 client 官方設定方式新增遠端 MCP；不將管理員密碼或 Web Cookie 貼進設定。
3. 由個人管理員登入，確認 client 名稱、資料用途及 scopes。
4. 完成 OAuth 後呼叫 `admin_get_capabilities`，確認本人及唯讀階段能力。
5. 先以合成資料測試查詢；不得為測試大量讀取正式個資。
6. 第二階段開放後才授權寫入 scopes，完成提案／Web 核准／commit。
7. 測試結束撤銷授權，清除受控測試產物，保留去識別驗收證據。

若 client 不支援遠端 OAuth：先標為未支援，另案評估本機 adapter。Adapter 必須使用個人 OAuth、安全 OS 憑證儲存及 loopback／IPC 保護，不得共用長效 Super Admin token。不得將 bearer token 放進命令列、shell history 或可同步設定檔。

## 4. 跨客戶端驗收案例

以下每一案例均需逐 client 記錄 pass／fail／blocked／not-run、版本、時間與證據。Not-run 不算通過。

| 編號 | 案例                  | 通過條件                                                 |
| ---- | --------------------- | -------------------------------------------------------- |
| A01  | 初次 OAuth 登入       | 正確顯示 client、scope 與環境，不需貼 token              |
| A02  | 非 Super Admin        | 即使登入成功仍不能執行工具                               |
| A03  | Token 過期／更新      | 按規格更新或重新登入，無靜默擴權                         |
| A04  | 撤銷授權／停用管理員  | 後續呼叫及待執行提案均被拒絕                             |
| A05  | 錯誤 audience／issuer | 不接受其他服務 token                                     |
| R01  | 能力探索              | 只顯示當前階段可用工具；直接呼叫未開放工具亦拒絕         |
| R02  | 分頁與統計            | 明示範圍、時區、截斷與下一頁；不將單頁當總數             |
| R03  | 個資最小化            | 一般搜尋不暴露完整電話、Email、心得或 token              |
| R04  | 錯誤呈現              | tool error 不被顯示為成功，無堆疊或 SQL 洩漏             |
| W01  | 建立指引提案          | 顯示精確內容、日期、狀態與影響，業務資料未變             |
| W02  | 核准連結              | 須登入 Web Admin；GET 不核准、不執行                     |
| W03  | 偽造核准              | Agent 宣稱已核准或傳 confirmed=true 仍不能 commit        |
| W04  | 真人核准              | 原 Super Admin 可核准；核准後尚未執行                    |
| W05  | 正常 commit           | 原 principal/client 執行，結果及稽核一致                 |
| W06  | 他人／其他 client     | 不能讀取敏感提案或冒用核准執行                           |
| W07  | 版本變更／過期／拒絕  | 不寫入，要求新提案及核准                                 |
| W08  | 重送與並行            | 相同操作只異動一次；不同內容同 key 拒絕                  |
| W09  | 逾時／斷線            | 以 operationId 查結果，不盲目重新建立                    |
| W10  | 跨對話接續            | 合法登入原 principal/client 後可查狀態；無需保存舊 token |
| W11  | 邀請建立              | Agent 不取得原始 token；可信一次性展示流程正常           |
| S01  | 提示注入／XSS         | 惡意姓名、CSV、內容不轉成操作指令或可執行腳本            |
| S02  | 日誌檢查              | 不含 token、Cookie、完整個資或邀請網址                   |
| S03  | 限流／超大輸入        | 有界拒絕及清楚錯誤，不造成無限重試                       |

W 系列只在第二階段執行。第一階段可標示「唯讀驗收通過」，不可標示完整寫入支援。

## 5. 建議真人驗收腳本

使用隔離環境的合成 Super Admin 與測試資料：

1. 「列出我目前可以使用的管理功能。」
2. 「查詢指定測試場地上週出席摘要，說明日期與時區。」
3. 「準備建立三天的測試練功指引，不要立即執行。」
4. 在 Web Admin 核對逐日內容並拒絕，確認 Agent 無法 commit。
5. 建立另一份提案，在 Web Admin 核准，確認尚無業務異動。
6. 請原 Agent 執行，確認只建立一次。
7. 模擬 client 中斷再接續，查詢已完成結果而非重做。
8. 撤銷 client 授權，確認不能查詢或執行剩餘提案。

真人核准不得以測試程式自動按同意冒充。自動化安全測試與真人體驗驗收分開記錄。

## 6. 故障排查與停止條件

- 無法登入：先查 metadata、client 註冊、redirect URI、時鐘與 token audience；不索取使用者密碼或 raw token。
- 看不到工具：查 scope、角色及功能開關；不擴權來消除錯誤。
- 提案已核准但 commit 失敗：查原 principal/client、到期、版本及即時權限。不要讓 Agent 新建同樣寫入繞過失敗。
- 結果不明：記錄 operationId，對帳前停止重試及對外宣稱成功。
- 個資／秘密進入模型或日誌、核准可繞過、重複異動、跨 client 執行：停止該能力發行並啟動安全處理。
- 不建議為相容性關閉 TLS、CSRF、Origin 驗證或 audience 檢查。

## 7. 驗收紀錄範本

```text
Client／產品網址：
Client／adapter／OS 版本：
測試環境與 server commit：
MCP protocol／SDK 版本：
OAuth 註冊模式與 scopes（不含秘密）：
測試日期／執行者：
案例結果與去識別證據：
已知限制／未測項目：
分級：待驗證／原生唯讀／原生完整／轉接唯讀／轉接完整／不支援
撤銷與測試資料清理結果：
審核人與放行範圍：
```

六種 client 全部是驗收目標；若需分批放行，明列已測產品／版本與未完成清單並另行核准，不能以一種 client 的成功取代其他五種。

## 8. 尚待確認

- Claude 的具體產品，以及 Muse、Hermes Agent、OpenClaw 的產品來源／版本。
- 各 client OAuth／Streamable HTTP 能力與是否需要 adapter。
- OAuth 授權伺服器選擇、註冊策略、token／提案期限。
- 一次性邀請展示、稽核保存與模型供應商資料處理政策。
- 實作計畫、共用業務層改動與獨立安全 review；本次僅新增文件。
