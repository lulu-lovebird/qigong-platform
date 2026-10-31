# 場地入口指引：NFC 為主、QR 備援

## 發布檢查點：未部署／接線中

本頁是操作契約與驗收關卡，不是新功能已上線的證明。未完成下列關卡前，維持既有入口；不得向學員宣稱新指引已可使用。

- A：`3179e0fe3eadd5edd783e115bd5c2a7bf13b056a` 已提交、推送，對應已核對的 555 項來源樹；新增資料庫／API 函式與 capability gate，但仍是 legacy UI，新 guidance routes **尚未在 composition root 接線**。
- A 的 [GitHub CI 41121515700，attempt 1](https://github.com/lulu-lovebird/qigong-platform/actions/runs/41121515700) 成功：3852 pass、0 fail、89 skip。其中 79 項 native／歷史測試未配置於 CI，另在本機實際測試；10 項原有未實作 placeholders 仍未驗證，不是零 skip。
- Linux 本機紀錄為 3931 pass、0 fail，另有上述 10 項未驗證 placeholders。新增 104 項 DB guidance cases 已納入完整測試；PG 的 151 項 metadata tamper 與 4 項 healthy source namespace 修正案例通過。
- 原始完整 QA 的 journal cap 100／150 失敗及 NoExec 11 均保留。僅私有暫存環境修正執行問題及第 27 個來源檔的 deterministic journal 測試細化；沒有 SQL journal migration。journal PG 12／12 通過，含負例零／正例一斷言，但成功時沒有 raw trace；原始 clock／Node／auth incident 根因仍未解。
- B1：4 個 UI 來源檔、833 項 unit／VM 測試通過的分離工作樹回報；來源待審、尚無 app wiring。本工作樹沒有 B renderer 分支，以下 B 行為為規範，不是整合驗證。
- B2：legacy sentinel、single verify、request-mode guard 的組裝尚待實作與審查；不得虛構 B SHA、CI、部署時間或產物。
- 最後實際正式環境唯讀觀測：**2026-10-30T14:34:31Z**，API `f9cb2215…`／schema 59 健康，來源與 dist 的 max 為 59。這只是該時點觀測，不代表發文時狀態；每次切換前必須重查。
- 當時 realtime 使用 `407f2f9…`，核心 11 檔與 f9 相同，但 minute 59 review routing 有差異；各 worker 需獨立核驗，不能假設同版或盲退。

## 學員操作卡

1. 用手機碰觸現場 NFC 的**公開 NDEF URL**；無法感應時，掃描同一場地 QR。一般連結亦可進入，但三者都不證明人在現場。
2. 入口只依資料庫場地設定顯示是否開放、實際課程日期與時間。未開放時閱讀提示，等待正確時段再碰／掃；不要開啟定位來繞過時段。
3. 開放時，依畫面查詢 LINE 資格；只有已核准且必要隱私關卡已清除，才可按定位簽到。
4. 未申請：回原 LINE 私訊傳送「加入」，使用既有私人表單，等人工審核。核准後**重新碰 NFC／掃 QR**；不保證自動返回。
5. 待審核：等待，不重複申請。封鎖／停權：聯絡管理員；入口不解除限制。
6. 必要隱私待處理：回原 LINE 私訊傳送「隱私」，完成既有流程後重新碰／掃。不要在入口填寫心得同意或重新申請。
7. 符合資格後，每次按定位都要重新檢查開放時間、資格及隱私，再取得新定位送出。定位或驗證失敗可重試，不表示已簽到。

## 公開入口與 NFC／QR 管理

- 兩種載體只放相同結構的公開 HTTPS 入口；下列均為合成示例：
  - `https://deployment.example.invalid/venue-checkin?venue=example-venue&source=nfc&lang=zh_TW`
  - `https://deployment.example.invalid/venue-checkin?venue=example-venue&source=qr&lang=zh_TW`
  - 一般分享使用 `source=link`，不另造私人入口。
- `venue`、`source=nfc|qr|link`、`lang` 都是不可信輸入；source 不代表標籤真偽、身分、出席或邀請。
- point-source JSON 與入口 URL 必須嚴格驗證；不得夾帶 token、標籤／裝置 UID、座標或私人邀請。示例不得替換為真實私人邀請、裝置識別碼或學員資料後公開。
- 返回 LINE 使用伺服器固定配置的 LIFF ID／返回 URL，不將 `liff.state` 當 HTTP redirect 目的地；不接受呼叫者指定任意返回網址。
- 此功能不重啟舊 admin NFC writer，也不授權代理寫入實體標籤。標籤製作由受授權人員另行執行，核對 URL、場地與實機行為。

## 時段與唯讀關閉狀態

- 唯一權威是 DB 的場地啟用狀態、IANA timezone、活動日及實際 class start／end；以課程開始前 30 分鐘（含）開放，課程結束（不含）關閉。
- 保留 `0058` 既有 DST／24 小時制時間運算，不以瀏覽器時鐘、硬編碼 7–9 點或額外「午夜」UX 規則覆蓋。
- 顯示完整當地日期、時區、開始／結束／開放時間；`relevantSession` 為 null 表示此次沒有對應場次，`nextSession` 為 null 表示有限查找範圍內未取得可用下一場次，不捏造時段。
- `not_activity_day`、`before_open`、`ended`、`disabled`、`not_found`、`unavailable` 均是**場地入口唯讀**：無可點擊登入、申請、定位、語言切換、每日練習或歷史控制。
- 關閉入口不影響原 LINE「加入」、線上練習及既有個人／歷史入口；這些獨立流程仍可照常使用。

## API 契約（A 已實作函式，尚未接線）

實作介面見 [`venue-entry-guidance.ts`](../../apps/public-api/src/venue-entry-guidance.ts)。下述 endpoints 不是 A 已註冊公開路由的聲明。

### 公開行事曆

`GET /api/venue-entry/availability?venue=example-venue`

- 只接受一個 `venue` 查詢參數；不接受身分或邀請。回應 no-store。
- version 1 的 DTO 僅含 `version`、`availability`、`venue`（code／name／timezone）、`observedAt`、`relevantSession`、`nextSession`。
- session 僅含 `startsAt`、`endsAt`、`opensAt`，使用含時區偏移的完整時間戳；沒有座標、地址、半徑或 region IDs。
- 開放及一般關閉狀態 200；找不到 404；停用 410；不可用 503。格式錯誤 400。
- 503 使用固定錯誤，不捏造 DTO／`observedAt`；沒有下一堂資訊時不自行排程。

### 本人資格／必要隱私

`POST /api/line/venue-entry-status`

- 僅接受精確配置的 HTTPS Origin、`x-venue-entry: 1`、JSON body `{ "idToken": "…" }`，body limit 6144 bytes；不接受額外欄位、query 或 fragment。
- 每次請求只做一次純 provider identity verify，以已驗證 LINE UID 查本人；不採信 caller person ID、姓名、email、source 或 HTTP 身分旗標。
- `needs_application`／`pending`／`blocked` 的 `privacy` 必須為 null；`approved` 才是 `clear|required`。
- 只在 approved 查 `platform.privacy_usage`；不回傳 reflection choice、policy hash 或其他私人資料。
- `clear` 表示目前無必要關卡，不是歷史同意已存在的證明，更不是出席證明。
- 不寫 nickname／profile、申請、privacy_gate、session、consent 或 attendance；不可借用 onboarding 的 nickname-refresh verifier。
- provider／網路／token 驗證失敗是身分錯誤，DB／必要隱私不可用則失敗關閉；任何錯誤都不轉成「新申請者」。
- 新學員只依 verified LINE UID 走既有「加入」私人表單與人工審核；既有有效**私人邀請**自動核准行為不變，場地本身不是邀請。
- 不新增私人表單 token 發放、自動返回、email／姓名帳號合併或新同意寫入。

## B 的瀏覽器與組裝驗收契約（待實作／待審）

- 新指引僅在 QR＋LINE 配置有效且 schema 60 entry capability 通過時啟用；不是部署後無條件取代 legacy。
- B2 必須保留 server-only legacy sentinel、單次純 verify 及 request-mode guard；精確型別仍待實作審查，不能將 sentinel 當成客戶端 HTTP 身分旗標。
- Guided primary 僅呼叫 `liff.init({ liffId, withLoginOnExternalBrowser: false })`，不再執行登入、讀取 Token 或定位；官方導向由 SDK 負責。`false` 是初始化選項，不是 init 的回傳值。
- closed secondary 不載入／啟動 SDK，不登入、不改偏好、不查私人資格、不定位。
- open UI 在定位之前先查資格及必要隱私；pending 不再申請，blocked 導向管理員，required 指示回私訊「隱私」。
- **每一次 GPS 按鈕嘗試**，都要重新讀取 DB calendar 確認 open、重新取得 approved＋clear；資格查詢與定位／寫入流程使用同一份 credential。
- 若資格或時間在重試間改變，立即停止，不以先前 UI snapshot 授權；後端既有 write API 仍獨立重新驗證所有條件。
- 原始 GPS 與 token 僅存記憶體，不寫 storage、URL、console 或診斷紀錄；公開文件不包含原始聯絡資料、心得或正式 rows。
- 三種 UI locale 不代表地理資格；不得順便翻譯／改動既有 personal／history 頁面。
- unit／VM／合成 browser 測試不等於實際 LIFF、手機、provider 或 NFC 驗收。需獨立人工實機檢查與受授權實體標籤製作。

## Schema 與預設關閉行為

詳見 [版本契約](../architecture/schema-compatibility.md)；可執行判定以 [`app.ts`](../../apps/public-api/src/app.ts) 與 [`venue-suite.ts`](../../apps/public-api/src/venue-suite.ts) 的完整檔名及 capability 為準。

- A min `0042_activity_consecutive_drafts.sql`、max `0060_venue_entry_guidance.sql`。不是任意數字 42–60 都相容。
- 預設關閉只允許已知完整檔名；52／53、未知未來版本或 partial ledger 不得回退成 legacy ready。
- QR legacy 只在 51、54、55、56、57、58、59 精確版本就緒且相應 capability 有效時使用；60 另須通過 entry gate。
- 58／59 的 pure window helper 必須恰為 writer／debug 兩個 nonowner grantees；60 恰為三個，新增 public-metadata reader **角色**，不是 SQL PUBLIC grant。
- 60 分離公開／身分 reader owners，禁止 role membership、DML、額外讀取；私有 subject GUC 有作用域且返回／錯誤還原。五張既有輸入表保持 FORCE RLS；`core.regions` 原有 RLS OFF 不改，只授必要四欄與指定 reader policy。
- 來源 migrations 0001–0059 不可變；0060 SHA-256：`310728037e0aee5333a84800c5a5d2f7766f35524fdb9d3867e6b1ebcbc88621`。不得更改既有 ledger 或借此建立新 journal migration。
- QR 預設 OFF 且未配置 management 時，純 preview／liveness 不查 DB；management-only 保留舊 lookup。預設值不代表正式環境實際值。

## 安全發布與回復：全部為尚待完成的關卡

### 1. 先備妥相容回復版本

- 保留經測試、不可變的 A `3179e0f…`、上述 exact-SHA CI 證據及同源 frozen artifact；A 必須支援 59 與 60，才可進 B。
- A／B 各自記錄 exact SHA、artifact／source／dependencies manifest、CI 與 native 測試；B 尚無最終版本，不能補寫推測值。
- 目前觀測的 f9 max59 **不能在 60 後回退**；更舊 `190…` max58 亦不可用。A 未接線是刻意保留的舊功能回復面，不是新 UI 驗收通過。
- API、realtime、minute worker 與 timer 分別核對 artifact／readiness／routing；保留觀測到的 minute59 review routing，不可一律換成較舊 worker。

### 2. 新鮮 preflight 與停止所有寫入

- 重查實際正式 SHA、schema59、所有 migration checksums、0060 預期來源及新 entry roles 尚不存在；重新盤點全表、安全 metadata、global roles 與所有 writer。
- 記錄目前 flags／provider 設定的受保護比對證據，包含六個 WA 值；不公開值或 hashes，也不從程式 default false 推定實際 false。
- 建立 maintenance fence；drain／停止 API、realtime、minute worker／timer 及盤點出的其他 writer，確認不能自動重啟或繼續寫入。
- 不重用舊 47／89-table helper 假設；以此次實際 schema／表／安全清單做完整檢查。

### 3. FINAL backup 必須實際還原

- 在停止寫入後取得全新 **FINAL DB＋GLOBAL roles＋runtime／units／env／config** 備份；authenticated AES-GCM 加密、offhost 保存，金鑰另行受保護保存。
- 驗證解密與 hash，將此次 FINAL DB／roles **實際還原至私有 PG16** 並核對 runtime；只列備份檔、解壓清單或使用較早 clone 都不算。
- 比對完整現有 table／security／ledger／business hashes；保留所有 rows、consents、events、leases、時間設定與 flags。此文件不含備份私有路徑、金鑰路徑或 credentials。
- 一旦恢復過寫入，每次新 cutover 都要新 FINAL backup＋actual restore。僅在證明無任何中間 business writes 的**單一連續停寫窗**，才可讓 A59→60→A60 validation→B60 共用同一份 FINAL backup。

### 4. 先 A，再 60，再 B；失敗立即停

- 先在 59 驗證 A 的 matching artifacts 與回復能力；以新鮮備份 clone 驗證 60 升級、保留性、安全與 A／B 相容性。
- 所有關卡全綠後，才在持續停寫窗套用 0060 一次，預期 apply1／repeat0；核對完整 invariants，再驗 A60，最後才啟用經審查 B60。
- 健康、source integrity、資料與安全 invariants、matching workers、路由與既有設定全部通過，才恢復流量／writers。
- 不以代理建立正式學員、申請、簽到或 provider 測試發送作驗收；任何驗證失敗保存第一原因並停止，不把來源修復次數當正式操作豁免。
- 未執行新功能正式環境操作、FINAL backup／restore 或切換；本頁不提供假造日期／產物／備份／實體 NFC 驗收紀錄。實際執行者在關卡完成後補入證據。

### 5. 回復不丟棄新資料

- 60 後 B 故障只能 code-only 回到已測試的 A，保留 schema60、目前 credentials／config、所有新 writes、jobs、audit；不退 f9／190、不 downmigration。
- 不盲還原舊 env 或把舊 DB snapshot 蓋在已恢復寫入的資料庫；狀態不符時停止並另行審查。
- 真實災難的 RPO0 需 PITR／WAL 或經驗證的後續寫入保存策略；本頁沒有完成或保證 RPO0。

## 不變範圍與人工責任

- 所有現有 flags、audit、必要隱私、provider／WA 設定保持原合法現值；缺少 WA invitation phone 不能用來停用既有 WA。
- 原 49 項成就維持 background legacy 行為；部署程式不等於開啟 achievement operator、TG learner review 或舊 NFC writer，亦無新增啟用授權。
- 不宣稱 WordPress／OIDC、法定營運者、資料保留政策或 AI privilege 功能完成。實際資料安全負責人須由營運方填列真實法律角色，不把開發公司自動指定為服務營運者。
- 保留既有公司署名；不授權 MIT 換證、LICENSE 或 `UNLICENSED` metadata 變更。

## 驗收清單（不得混寫為全部完成）

- [x] A 來源提交／推送、完整 QA 與 exact-SHA CI，限制與原始失敗如上保留。
- [ ] B1 來源審查；B2 實際 wiring／mode guard／single verify 審查。
- [ ] 最終 B SHA、完整 B QA／native／CI，並核對 A／B frozen artifacts 與 source integrity。
- [ ] 新鮮正式唯讀 preflight、全 writer 停寫、加密 FINAL backup 與 PG16 actual restore。
- [ ] A59／A60／B60、完整資料／security／worker invariants、部署與回復證據。
- [ ] 真實 LINE／LIFF／手機／provider 驗收；受授權人員製作並驗收實體 NFC／QR。
- [ ] 操作者填入實際時間、各 runtime SHA、備份還原與驗收結果；確認既有 flags／設定未變。
