# 成就得獎名單個資 CSV 匯出（schema39已發布）

## 狀態與授權邊界

使用者核准本機實作，初版供 `super_admin` 與 `master_admin` 使用；2026-10-18又明確核准本次提交／推送、精確SHA CI、演練與38→39協調維護例外。**正式已發布 `afd90b57febd03e05a7c59d0c5e1b81ac6c25bc6`／schema39，精確SHA CI39123945084／891 tests與209項公開HTTPS檢查通過。** 實際維護63.232秒，最終加密備份實際還原／保存與恢復界線見[發布紀錄](achievement-personal-export-deployment.md)。 本次功能互動測試僅使用合成資料；正式資料僅作已核准的加密備份／隔離還原與彙總保存檢查，未產生正式學員個資CSV、變更其他營運開關或發布政策；既有人工驗收與無關permissions-review不納入提交。

新增 `achievement.export_personal`，只授予上述兩種角色；不沿用 `stats.export`，不開放一般報表／區域管理角色。下載需有效 global grant，而且同一角色具備匯出、`stats.read`、`learner.read`、`checkin.read` 四項權限。名單再與既有 `_achievement_people` 三項個人範圍檢查相交。權限與 principal 狀態使用 `clock_timestamp()`，等待鎖後再次檢查，不將 transaction 起始時間誤當目前時間。

一般 `/admin/api/achievements` 與 `/:code/recipients` 不增加平台 IDs、電話、Email，也不寫入稽核／冷卻紀錄。`/capabilities` 僅新增 `canExportAchievements` 布林值。瀏覽仍唯讀；只有主動、經確認的 CSV 準備操作會寫入以下最小紀錄。

## 管理介面

有匯出能力者，在選定徽章名單上方看見用途選單與「匯出 CSV」連結。用途限：

- `award_contact`：得獎行政／聯絡。
- `internal_review`：內部授權核對。

先預覽授權人數，再確認用途與個資保管警告。匯出為**目前已套用篩選的全部可匯出得獎者，不是目前分頁**；篩選尚未套用時仍使用原已套用值。預覽不是凍結名單，確認文案明示產生時會重查，人數可能變動。最多5,000人；超限需縮小篩選，不能悄悄截斷。超限預覽的 `count=5001` 是偵測哨兵，不代表全體精確人數。

三語介面／CSV欄名與系統徽章名稱支援 `zh_TW`、`zh_CN`、`en`；學員姓名、Email、電話與 IDs 不翻譯。

## 資料來源與一人一列

只讀目前定義 rule version 對應的未撤銷既有成就；不執行 evaluator、不補發徽章、不建立通知工作。跨季期間去重、排序並合併在同一列；同名或同 Email／電話的人不合併。

| CSV資料                                    | 明確來源／缺值處理                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LINE userId、Telegram user_id、WhatsApp ID | 同一 `person_id` 明確綁定、未撤銷且已驗證時間不在未來的 `platform_identities.external_subject_id`；多個同平台 IDs 用 `;` 排序串接，無資料留白。不是使用者名稱、暱稱或 chat invitation URL。 |
| 基本姓名                                   | `identity.people.legal_name` → `preferred_name` → 目前管道已核准申請的 `learner_name`；空值才依序退回，無資料留白。不讀 provider display cache。                                            |
| 電話／Email                                | 目前有效互動管道的 identity，與同一 person、相同 platform、相同 provider subject 的 approved application 精確相交。缺少目前申請即留白，不猜測／不從其他舊申請拼湊。                         |
| 聯絡資料狀態                               | `matched_current_application` 或 `missing_current_application`；缺資料不以虛構內容補齊。                                                                                                    |
| 成就資料                                   | 代碼、本地化系統名稱、rule version、全部符合目前年份篩選的既有 award periods。                                                                                                              |

跨平台身份綁定是既有資料權威；匯出不建立、推測或修正綁定，不依姓名／電話／Email 配對，也不改寫任何學員資料、私人心得、歷史快照或同意紀錄。

## HTTP／交易邊界

- `POST /admin/api/achievements/:code/export/preview`：只回 metadata／人數，無 roster、聯絡資料、稽核或冷卻副作用。
- `POST /admin/api/achievements/:code/export`：strict JSON，要求 `confirmed: true`、固定用途及篩選；不接受 page／limit／任意未知欄位。
- 兩者均要求已驗證 admin session、精確正式 Origin、JSON content type 與 CSRF header／cookie 比對；body上限8KiB。匿名401、權限／CSRF403、輸入400、未知徽章404、名單／檔案超限413、冷卻429、未知準備錯誤503。429提供 `Retry-After: 30`，不自動重試。
- 準備函式與 `(1919,1)` 隱私鎖協調，再取得每 principal transaction advisory lock，序列化同操作者準備。每次成功準備後30秒冷卻，預覽／失敗不消耗成功額度。
- 最多5,000人、資料 JSON 5MiB、最終 CSV 10MiB。SQL或編碼超限整筆拒絕，無部分檔案。
- CSV在 request transaction 內編碼；編碼後同一連線再次確認權限、實際 session 的 principal／撤銷狀態與 wall-clock 到期。最後檢查、CSV準備或稽核任一失敗，回滾準備稽核與冷卻；commit成功前不傳任何 CSV bytes。不在持有 export 連線時另借一條 pool 連線重查 session。
- 回應 `no-store`、`no-cache`、`nosniff`、`no-referrer`；無公開下載URL、伺服器暫存檔、Email附件或 provider 發送。瀏覽器只建立短暫 Blob URL，下載連結立即移除、URL隨後撤銷；不寫 local/sessionStorage。篩選、選擇或授權改變會取消／忽略過期回應，避免儲存舊 scope Blob。
- 已授權且完成準備／交付的檔案無法追回；撤權、取消 fetch 或 logout 不保證召回已離開服務的檔案。下載後保管、轉傳與刪除須依實際營運政策辦理，不能將功能權限當成學員對外發布同意。

## 稽核與檔案格式

`audit.events.action='achievement.export_prepared'` 記錄操作者、request、徽章／版本、用途、實際筆數、系統區域／平台／年份及是否有姓名篩選。不記錄搜尋字串、學員名單、姓名、平台 IDs、電話、Email、心得或完整CSV。`delivery='prepared_not_confirmed_saved'` 只表示準備完成，**不證明瀏覽器收到全部 bytes、使用者已儲存或檔案已妥善保管**。

CSV採UTF-8 BOM、CRLF及完整引號 escaping。ID／電話固定加單引號文字前綴；其他欄位偵測公式字元、前置空白／控制字元／格式字元以避免試算表公式執行。原始資料不變更。CSV實際欄位會包含呈現用前綴；程式處理時只在確認為 ID／電話的欄位按需求去除此文字保護，不要盲目移除不可信姓名的安全前綴，也不要把長 ID 轉數值。

檔名例：`成就_連續練功3天_streak_3_20261018T093000Z.csv`，包含徽章名稱、代碼與UTC時間；同時提供安全ASCII fallback及UTF-8 `Content-Disposition`，不含個人姓名或篩選字串。

## Migration39／本次已核准的協調維護發布

`0039_achievement_personal_export.sql` 新增一張空的 forced-RLS 私有冷卻表、六個固定 `pg_catalog` search path函式，以及一項權限／兩筆角色映射。PUBLIC無新函式execute；worker僅取得新 ops readiness，沒有聯絡匯出 facade／冷卻表權限。API只取得必要 facade執行權，無新 raw table read。既有0001–0038完全不修改。

API min/max39；minute與realtime worker同時改為 `ops.achievement_export_schema_ready()`／`phase-24-achievement-personal-export`。**38 binary不接受39，新候選也不接受38；這不是 rolling expand release。** 上次schema38方案A不自動沿用；本次使用者已另行明確核准協調維護／停寫例外。必須先通過精確SHA CI及演練，再封鎖打卡入口、停止API與雙worker，取得最終加密備份並實際還原驗證，檢查全部既有資料／權限保存後，才可正式升級並啟動 matching API／雙worker；不得直接在線 migrate39。

本次39已核准並完成發布；恢復寫入後須保留39並修前進版，不能以38 binary或舊快照丟失新資料、隊列、稽核與冷卻紀錄；目前沒有39相容的舊功能緊急 build。本次提交／推送及上述維護發布已獲明確核准，但不授權正式個資下載、其他個別角色grant／政策調整或營運開關變更；新權限的兩種固定角色映射以本次migration為限。

## 合成驗證

- DB10：角色隔離、同名分開、多平台申請精確來源、撤銷／未來驗證 IDs 排除、跨年去重、預覽無副作用、冷卻、稽核回滾、等待後 grant expiry、PUBLIC／worker拒絕、5,001人拒絕。
- 編碼16：BOM、CRLF、引號／換行、三語系統文字、公式注入、長ID／電話文字保護、缺值、strict輸入／筆數與大小拒絕、安全檔名。
- HTTP7：真實合成session、Origin／CSRF／確認／用途、一般viewer拒絕、25人全量而非20人分頁、最小稽核、冷卻、最後撤權及稽核儲存失敗回滾、等待後session自然到期。
- View controller13：既有7項加6項匯出測試；包括 capability隱藏、預覽／確認、取消、超限、撤權清空、Blob／連結清理與scope變更後忽略延遲Blob。
- 38→39升級：所有既有table/source/security指紋不變，僅排除預期metadata version/time與精確新增權限／映射；新表RLS／ACL另驗。首次apply1、重複0，舊gate false／新gate true。37→38歷史測試固定到38，未放鬆歷史保護。

### 2026-10-18 本機完成紀錄

- Node24下預先build、兩個CI同款strict gate、`pnpm verify`全套通過：**891 tests**（API678／DB205／config2／identity6），含format、lint、typecheck與最後build。這是本機驗證，不是尚未觸發的GitHub CI結果。
- 首次完整驗證在DB階段因3處舊契約期待失敗：current worker gate、permission數28→29，以及migration清單／max38→39。保留初跑log，更新為實際新契約並逐檔通過後才完整重跑；沒有調寬安全斷言、停用規則或為碰運氣重跑。較早strict gate與lint另抓到測試mock的tuple型別及控制字元regex，均修正實作／型別，未使用`any`或rule suppression。
- 真實compiled HTML與隔離PG16／真實合成admin session的Chrome檢查：super／master／viewer × 3語 × 390／1280px，共**18組版面、36張截圖**。角色顯示、長／惡意標記姓名literal、無橫向溢出、手機44px觸控與16px輸入檢查通過，API／前端JS錯誤0。手機寬度模擬不代表實體手機驗收。
- 兩個授權角色各經native確認並實際儲存一份**合成CSV**；驗證安全Unicode檔名、BOM、2人完整列、長ID精度與公式前綴。聯絡資料未出現在頁面DOM。CDP攔截應用請求轉loopback，logo使用本機既有圖檔，其餘頁面外部請求封鎖；未連正式Qigong服務、未發provider訊息。測試adapter不等同正式OAuth／手機登入。
- 瀏覽器harness最初因Chrome尚未ready、既存空下載目錄而各中止一次；補上有界ready等待及目錄為空的明確斷言後通過。保留兩次失敗log，未放寬產品斷言。
- 瀏覽器結束後核對awards／jobs／badge-change audit指紋不變，只有預期2筆`achievement.export_prepared`。私有fixture檔案權限受限；兩個本次專用Docker cluster與preview／Chrome均已停止，無測試service留在正式環境。

本機證據：`/tmp/qigong-achievement-export-verify-initial.log`、`...-verify-final.log`、`...-browser-results.json`、`...-browser-preservation.json`；合成截圖為`/tmp/qigong-export-{role}-{locale}-{width}-{catalog|recipients}.png`，不納入Git。既有人工驗收文件與無關permissions-review變更保留，不自動納入任何未來提交。

以上不代表正式手機、真實provider或正式個資匯出驗收。既有主機／Docker時鐘回退與舊403診斷未因此結案。政策仍為draft、WhatsApp仍未配置，沒有新增營運同意或自動通知。
