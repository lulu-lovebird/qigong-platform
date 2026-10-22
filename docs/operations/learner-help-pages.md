# 三渠道初學者Help Pages與入口（發布候選／待部署）

## 核准與交付界線

使用者確認功能大致完備但學習負擔過多，核准本機製作LINE／Telegram／WhatsApp獨立指引與三語、公開唯讀路由、Bot選單及help入口；首次使用／每日打卡／看紀錄置前、進階FAQ預設收合，保留簽章／去重／時效／身份／同意邊界，Help不建立同意或資格。**未commit/push/deploy、不連正式寫入／發訊息、不改DB/migrations/provider Console/正式menu/通知/授獎/憑證**。兩份既有無關文件保留。依先前部署紀錄正式仍a24f14e／46，使用者在1386測試／18組Chrome驗證完成、預覽附件未能交付後，另明確核准本次commit/push/deploy；限同schema46的Help頁及程式內入口，待精確SHA CI、fresh46 clone相容／保存及停寫final加密DB／roles／runtime actual restore/preservation過才切換，不執行migration。LINE正式六格、provider正式menu、WA env／通知／授獎／Meta設定保留，不把部署當正式選單發布；尚未切換，本檔URL仍未正式發布。

| 渠道     | 本機實作的正式路徑（待另核准部署） | 特別內容                                                                                |
| -------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| LINE     | `/line/help`                       | 有邀請回原邀請、一般申請待審；LIFF打卡／回條；新心得依告知進入學員流                    |
| Telegram | `/telegram/help`                   | /start／Mini App／/checkin；私人回條；自選提醒與/remind off                             |
| WhatsApp | `/whatsapp/help`                   | join／checkin、個人30天／共用15分鐘裝置登入、固定書籤、完成卡／關閉fallback、無聊天摘要 |

每頁zh_TW/zh_CN/en，共用安全排版模板但渠道內容獨立。服務品牌白雁氣功／氣功打卡小幫手；不將開發者推定為所有部署營運者，不改正式政策。

## 初學者資訊層次

- 開頭只說每天「開啟、勾功法、完成」，三個主區為第一次使用／每天打卡／查看紀錄；今天打卡按鈕只跳本頁步驟，不替使用者打卡或取得私人連結。
- 補登／更正期限、過期連結、心得可見範圍、語言與跨渠道身份、草稿／徽章延遲、WA共用裝置或TG提醒等置於native details/summary，預設收合。
- 清楚說明昨天依已確認practice timezone中午前補登／更正，不教切時區繞期限；普通申請30分鐘、私人打卡連結15分鐘，不把TG永久按鈕說成永久資格，也不把邀請一律當30分鐘。
- 不宣稱所有心得私密：LINE/TG新的心得依頁面告知進學員心得流、舊私密紀錄不因新頁自動公開；WA不自動進社群／發聊天摘要，明確分享是另一操作。心得／感受可留白，不要填敏感個資。
- 不把三渠道或舊bot紀錄按姓名／Email／電話自動合併，不保證關頁／聊天送達／勳章精確即時。支援只請提供時間、裝置與錯誤，不索取私人連結、憑證、聯絡資料或心得截圖。
- 這是產品使用指引，不是政策／同意表、管理員審核、醫療建議或營運啟用；閱讀不會加入、核准、開提醒或更改分享。

## 路由與認證

- `learner-help-content.ts`為source-owned三語文案；`learner-help-page.ts`為無script／form／SDK的renderer及三個GET路由，app無渠道config／無資料庫也能閱讀。Help可用不代表各渠道已配置或已核准；原功能路由仍沿原config與身份資格。
- no-store/no-referrer/nosniff，CSP default-src none／僅inline style／base/form/frame none。僅使用合法locale與固定channel，未知lang/query不反射，無redirect／任意returnTo，連結只含合法lang與公開anchor，不放身份或token。
- 語言選項是同一Help頁的普通連結。共用onSend對明示lang只維持既有presentation cookie，非身份cookie／同意紀錄；沒有storage／API寫入、沒有個資或追蹤圖。

## Bot入口與去重／時效

- LINE：保留原5個configured LIFF功能URL，只加1條public `/line/help`，不把功能或申請改成無token HTTPS頁；私訊help／/help／說明／使用說明／幫助及簡中別名，在HMAC與private source檢查後、邀請／政策／加入判定前回靜態Help。提供timestamp時對help拒過舊24h／未來60秒訊息，不改其他指令期限。
- TG：原5個native feature按鈕保留，/start已核准回6個（第6為Help）；/checkin仍單一native按鈕。Help用**普通URL按鈕而非web_app**，不帶initData或私人payload。/help（含@bot）及中文別名，在secret/private/matching sender檢查後、profile refresh／政策／資格／申請前處理；有date時拒過舊24h／未來60秒，不變更原其他指令。
- LINE/TG Help新增process-local bounded guard：每adapter最多5000個SHA256(eventId)／subject+command fingerprint，15分鐘completed TTL、monotonic performance clock；同時重播共用pending、衝突拒絕、provider失敗清除可重試、pending不被淘汰。只存hash／promise／到期值，不存姓名/手機/私人內容；**不是durable outbox，重啟或provider接受後timeout仍可能重覆，不宣稱exactly-once**。原渠道已有的其他去重流程不改。
- WA：保留原5個interactive list rows，加workspace:help第6格（Meta row title≤24字）。文字help／中文別名與互動列共用同一分支。保持raw-body HMAC／WABA+phone匹配／現有durable inbox與payload衝突／fresh入站24h窗口；Help只在這些檢查後、privacy/eligibility/link建立前回公開URL。**不建立新服務窗口**（Help分支在record_service_window前），不發範本／practice摘要，不偷偷同意或登入。durable重播在重啟後仍不重送；既有provider acceptance/commit不確定性不被這個功能消除。
- 未核准者可閱讀Help，但沒有任何新checkin／分享／個資讀權；Help URL本身不是資格證明。

## LINE rich menu草稿（不發布、不取代現行六格）

下表依repo既有line-rich-menu.md操作稿，不是本輪讀取／確認Console即時狀態。原正式六格及圖片／menu ID／綁定保留。

| 格位 | 保留動作                           | 本輪狀態              |
| ---- | ---------------------------------- | --------------------- |
| 上左 | configured LIFF `/checkin`         | 保留                  |
| 上中 | configured LIFF `/leaderboard`     | 保留                  |
| 上右 | configured LIFF `/method-analysis` | 保留                  |
| 下左 | configured LIFF `/achievements`    | 保留                  |
| 下中 | configured LIFF `/journal`         | 保留                  |
| 下右 | 文字「加入」                       | 保留，不改直接申請URL |

未來若要六格內直接露出Help，建議另核准第二版：將下右改「使用說明」，URI=`https://checkin.baiyinqigong.org/line/help`，Help第一次使用教回聊天傳「加入」，原文字加入指令仍保留。這只是操作稿，**本輪不更換六格、不產生或發布provider圖片／richmenu API**。部署Help後先驗公開URL／三語，再由負責人備份當前menu/image/動作與綁定、確認格位、另核准Console或API發布與真人LINE點擊；不可把未部署URL先放正式選單。

TG setMyCommands/setChatMenuButton等正式設定及WA Meta Console同樣未改；本輪只是未部署的程式內選單／指令接入。既有bot username／私連結未硬編進Help，不移除現有功能。

## 本機驗證與失敗留證

- 公開Help unit28：3渠道×3語未登入／無DB200，CSP/headers、三主區先於FAQ、native details預設閉、無SDK/script/form/storage/API；query/token/returnTo不反射、POST404、channel文案差異及可信public URL／命令全等匹配。Guard unit5涵蓋並行／completed重播、subject/command衝突、失敗retry、capacity／TTL／pending不evict及非法limits。
- Signed native PG16 routes5，在**隔離的active policy**前提：TG/LINE未核准也可Help，錯secret/HMAC、group、sender mismatch、stale及重播/衝突／provider失敗保護；TG真transport mock為普通URL、WA list help與durable replay／重啟／stale24h保護。完整86表hash排除僅必要WA inbox前後相同，包括people/applications/consent/service windows/links/reminders/awards/audit等；沒有新同意或資格。
- WA transport新增三語3個case：原5rows加help，六row IDs順序與title長度≤24精確、無私人URL資料。原TG reminder/opt-in／native驗證與LINE五LIFF入口仍回歸。
- 初guard optional pending設undefined被exactOptionalPropertyTypes拒，改delete；TG edit定位重複未套，後字串newline語法錯誤由prettier拒，修為literal escape；未忽略type/lint。Native WA fixture最初缺Meta interactive.type而400，補正真格式並固定重啟重播的原payload/timestamp，未放寬schema或去重。完整verify原2個舊期待（TG start5而非6、LINE所有HTTPS都拒）失敗保留，改為**5native+1public Help**及**精確只允許該Help HTTPS**，原防token／fragment／configured LIFF斷言保留。strict test再抓可能undefined message，補型別前置不加assertion繞過。
- 最終Node24 build／兩strict TS gates／format/lint/typecheck與完整verify **1386tests＝API1093／DB285／config2／identity6，無skip**；map1719phrases/1347mappings。本輪沒有CI／重跑CI／正式變更。
- 真本機Chrome **18組／18圖**＝3渠道×3語×390/1280，用真正本機buildApp路由、無adapter config及DB（databaseAttempts0），主區順序、FAQ預設閉／原生展開、daily anchor、無水平overflow、44px觸控、script/form0、storage keys0與JS exception0；無真OAuth／手機／Richmenu／Meta驗收，不假稱已發送圖片到Telegram。

證據：`/tmp/qigong-help-{routes,routes-fixed,routes-policy,reminders,line-regression,line-regression-fixed,tg-regression,verify,verify-complete,build,browser}.log`，verify保留舊menu斷言失敗，complete為1386成功。`/tmp/qigong-help-browser/results.json`與18PNG；runner `/tmp/qigong-help-browser.mjs`。測試PG16/55526、HTTP55532/CDP55533完成後停止。

## 待辦／部署邊界

commit/push與同schema46發布已獲後續明確核准；仍須精確SHA CI、正式final actual restore/preservation通過才切換。發布需保留現WA env及token／notifications／operator FALSE、不跑migration；之後才逐一確認各平台新Help入口及正式menu發布。無需為讀Help送出申請、打卡、同意、啟用提醒或產生任何正式個資CSV。
