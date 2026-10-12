# Telegram單功能入口與提醒（本機schema28候選）

## 狀態與核准

使用者核准本機實作單一功能入口／icon與提醒：預設關閉、21:00、已打卡仍提醒。尚未提交、推送、部署或啟用正式提醒。主站仍為`97de588`／schema26，Meta／LINE／Telegram憑證、webhook與既有資料不變；不匯入舊Bot設定，不發布隱私政策。

候選28接在未發布WhatsApp27後，目前工作區包含兩項本機修改。**Telegram發布核准不得視為WhatsApp27發布核准**；發布前須另外決定分離artifact或明確核准兩項範圍，不可直接將整個工作區部署到主站。

## Bot入口與icon

Telegram slash指令不能自動彈出Mini App，仍須點一下Bot回覆中的WebApp按鈕。新行為：

| 指令                                               | 唯一入口      |
| -------------------------------------------------- | ------------- |
| `/checkin`                                         | ✅ 開始打卡   |
| `/leaderboard`                                     | 🏆 排行榜     |
| `/methods`、`/methodanalysis`                      | 📈 功法分析   |
| `/achievements`、`/history`、`/mystats`、`/badges` | 🏮 開啟成就頁 |
| `/journal`、`/share`                               | 📝 練功心得   |

`/start`仍保留五個完整入口。英文同樣帶icon；固定HTTPS WebApp URL只帶locale，不帶私人token。身份、核准、active渠道與隱私檢查不變，不因設定command menu授權。

## 提醒指令

| 指令                        | 行為                               |
| --------------------------- | ---------------------------------- |
| `/remind`                   | 看本人設定；預設關閉、21:00        |
| `/remind on`、`/remind off` | 開啟／關閉                         |
| `/remind 21`                | 設為21:00並開啟；僅接受0–23整點    |
| `/remind tz Asia/Taipei`    | 設定有效IANA提醒時區，不改打卡時區 |
| `/remindtest`               | 排入本人預覽；每人至少間隔五分鐘   |

設定初次建立時使用本人的practice timezone，之後独立保存。只限已核准、active Telegram身份／interaction channel及符合必要隱私同意的學員。`off`在資格／同意失效時仍可用來停止自己的提醒，但不能開啟或發新提醒。

提醒僅一般練功文案與「✅ 開始打卡」原生WebApp按鈕，不含心得、感受、姓名、Email、排名、LLM、節氣或未核准的日曆內容。已打卡仍發送。`remindtest`回覆排隊不是送達證明，也不直接使用API進程發預覽。

## 排程、安全與負載

- 新增`0028_telegram_reminders.sql`，不改0001–0027；settings／update ledger／reminder outbox三表強制RLS，無runtime直接表權限，零自動設定或開啟回填。
- 設定更新只由已驗證的Telegram private webhook身份執行。update ID／subject hash／action fingerprint防重放與跨身份改寫；person鎖與後置資格重查。audit不存私人原文或憑證。
- 每個identity／當地日期最多一個daily job。改時間／時區／off使旧版本工作取消，不讓舊排程改送；同一天取消後不補發第二份daily job。
- scheduler每輪最多入列100位，排除已存在的當日job，避免前100位餓死後續學員；local due hour後一小時有效，不補發歷史漏跑日期。
- 以Postgres時區規則解讀當地日期與整點，包含半小時時區；DST不存在時刻移到對應下一有效時刻，重複時刻取標準時間，同日唯一鍵防重複入列。
- claim每輪最多25個，5個並行，每次HTTP timeout5秒，使用2分鐘lease；發送前再查資格、同意、設定版本／enabled、期限及lease。off／身份撤銷／關閉渠道／suspend會取消未送／leased jobs；政策失效於claim／pre-send重查取消。
- 最多5次嘗試、指數backoff不超過15分鐘，超過送達窗口停止；預覽5分鐘有效。錯誤日誌只有泛化原因與job UUID，不含recipient、token或訊息內容。
- 維持原通知／practice各lane；提醒平行執行的transport worst-case約25秒，既有最長lane約30秒，不把DB等待說成有固定上限。125位合成批次測試驗證100＋25入列、5輪各25、並行不超過5；不是正式負載／Meta送達驗收。
- 網路已被Telegram接受但ack遺失可能重送，無exactly-once保證；資格變動或off不能召回已接受的in-flight訊息。

### 正式開關

worker使用可選的`TELEGRAM_REMINDERS_ENABLED=true`；未提供或`false`不排程、不claim、不發提醒。其他字串拒絕啟動。**本次沒有修改正式env或啟用此開關**。當worker未啟用，設定可保存但不發送；過期預覽不補送。

API exact28，worker gate `ops.telegram_reminder_schema_ready()`，architecture `phase-13-telegram-reminders`。原WhatsApp practice停送、LINE／Telegram摘要及各渠道申請結果通知維持。

## 驗證與恢復

本機覆蓋：單功能／icon／別名／五個start入口、預設與開關、時區／非法輸入、signed webhook／群組拒絕、重放、當日去重、已打卡仍發、off後lease取消、資格／必要同意、預覽限制／期限、backoff、runtime權限、半小時／DST、125位分批並行。provider transport是mock，沒有真實測試訊息。

27→28合成升級與重跑保留全部非metadata表指紋（含WA session／身份／principal），新三表為空，舊API／worker gate拒絕、新gate通過。正式部署仍須另核准，正式快照clone演練、最終站外加密備份實際還原與matching API／worker，且先決定未發布27的發布範圍。

28不能binary-only回退；需matching先前schema資料庫／程式／worker設定，若開流量後回復須另核准並對帳新資料與通知狀態。停發提醒可先經核准將worker flag改false，不等於資料庫回退。

## BotFather清單（部署後才新增提醒）

用新Bot的`/setcommands`，不要變動舊Bot。不在部署前新增尚不支援的remind／remindtest：

```text
start - 🌱 開始使用／申請加入
checkin - ✅ 練功打卡
leaderboard - 🏆 地區排行榜
methods - 📈 功法分析
achievements - 🏮 成就與打卡紀錄
journal - 📝 練功心得與社群分享
privacy - 🔒 隱私說明與同意設定
language - 🌐 設定介面語言
remind - 🔔 打卡提醒設定
remindtest - 🧪 測試本人提醒
```
