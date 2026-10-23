# 三渠道初學者Help Pages與入口（已部署96e0c13／同schema46）

## LINE圖片發布候選（後另獲提交／推送／部署核准）

- 使用者已回報自行將Help成功加入LINE正式圖文選單；這是部署後使用者的操作，不代表agent修改Console，也不將TG／Meta設定視為一併完成。使用者提供七張本人截圖，確認同意其中修練紀錄作為公開Help示例，另核准**僅本機**確定性裁切／壓縮／metadata移除，不用AI重繪、不改日期／數字／勾選／告知，**未核准commit/push/deploy**。
- 原圖在專案外。七個衍生PNG共2,548,079 bytes（原5,162,773），RGB逐像素等於原圖對應區域；保留sRGB色彩宣告，除IHDR/sRGB/IDAT/IEND之外無metadata。01只留六格、02去聊天背景、03群組複選、04完整分享告知與完成按鈕、05只最新回條、07月曆／單日紀錄；06放native details預設收合，不把七圖全部當首頁任務。首次加入仍文字，不偽稱已拍到新申請流程。來源、座標與封裝要求見[圖片說明](../../assets/learner-help/README.md)。
- `learner-help-images.ts`固定七檔／完整SHA256／尺寸／section，字面路由`/line/help/images/<sha256>/<file>`，不提供任意filesystem path。hash不合／缺檔為sanitized503/no-store，成功PNG/nosniff/no-referrer/CORP same-origin/嚴格CSP/public max-age3600。Help HTML仍no-store，只對LINE加入img-src self，其他渠道CSP與六份HTML byte-identical；沒有外站圖片／SDK／script／form／storage／DB查詢。圖片採lazy/async、固定尺寸、三語圖說/alt與明示繁中／示例紀錄；點原生連結另開原尺寸，圖片本身未翻譯、未改個人紀錄。
- Node24兩strict gates、format/lint/source typecheck/build與靜態字表1756phrases/1379mappings通過。新圖片15tests與Help33tests共48；獨立完整API **1113tests**／identity6／config2通過。**整體verify尚未全綠**：DB285項中284過、既有`telegram-workspace.test.ts`的`awards streak, cumulative, method, time and yearly combo badges idempotently`在讀achievements時回`practice identity unavailable`。DB套件／migrations未改，未查明根因，不宣稱只是clock也不把重跑當修復；保留failure，不擅改身份SQL／fixture／權限、不重跑該案例洗綠。未達發布門檻，不稱1406全部過。
- 初次verify被測試mock的import() type lint規則擋住，已改精確readFile結構型別，沒關lint或放寬型別。Chrome harness先因把檔案順序誤當DOM順序漏載history，再因把圖片border-box當content比例斷言失敗；原log保留，分別改用固定src定位與扣除實際border後驗內容比例，未改產品圖像或放寬閾值。
- 真本機Chrome **18組／22張預覽**（三渠道×三語×390/1280，另三張成就展開及一張原生首屏）通過：六張主流程圖片實際decode、原尺寸native popup、FAQ與成就收合/展開、44px、anchor、無橫向溢出、零scripts/forms/storage、**DB attempts0／外站資源0／正式連線0／provider sends0**。這是本機瀏覽器，不是真LINE手機驗收；預覽檔存在不等於已送到Telegram。`/tmp/qigong-help-images-browser/results.json`及22PNG；最後目視檢查發現captureBeyondViewport產物的offscreen lazy圖雖已載入但未繪製，保留prepaint產物，改相同寬度展開完整viewport、await decode與paint後重拍，未改產品lazy/CSP，也未把空白圖片當完成預覽。原失敗log、complete／painted log與`/tmp/qigong-help-images-{verify,verify-complete,api-verify}.log`保留。
- 本輪沒有SSH／正式寫入／正式訊息／DB或migration／dependencies／通知／授獎／憑證／provider設定變更，兩份無關文件保留。正式仍以下96e0c13文字版Help。使用者在本機失敗披露後另明確核准本次commit/push/deploy；須精確SHA原CI完整測試、fresh46 clone／七圖片路由與停寫final實際還原保存通過才可切換，CI失敗則停，不重跑洗綠或更改身份檢查。這是新原run的獨立完整驗證，不刪除本機失敗或宣稱根因已修；clock／時效診斷仍開放。未來發布須含root assets衍生檔、測全部七圖成功／未知path拒絕／sanitized缺圖，不只看readiness；不打包原圖或工具私有state，保留目前LINE選單、WA配置／schema46與所有正式寫入。

## 核准與交付界線

使用者確認功能大致完備但學習負擔過多，核准本機製作LINE／Telegram／WhatsApp獨立指引與三語、公開唯讀路由、Bot選單及help入口；首次使用／每日打卡／看紀錄置前、進階FAQ預設收合，保留簽章／去重／時效／身份／同意邊界，Help不建立同意或資格。**未commit/push/deploy、不連正式寫入／發訊息、不改DB/migrations/provider Console/正式menu/通知/授獎/憑證**。兩份既有無關文件保留。依先前部署紀錄正式仍a24f14e／46，使用者在1386測試／18組Chrome驗證完成、預覽附件未能交付後，另明確核准本次commit/push/deploy；限同schema46的Help頁及程式內入口，待精確SHA CI、fresh46 clone相容／保存及停寫final加密DB／roles／runtime actual restore/preservation過才切換，不執行migration。LINE正式六格、provider正式menu、WA env／通知／授獎／Meta設定保留，不把部署當正式選單發布；已完成96e0c13175d5cf661347f8299e7d7c440079b4c8／同46部署，CI39793684155原run1386tests、fresh clone與final actual restore/preservation通過，268 Node HTTPS／healthy。三URL及程式內入口已發布；正式provider menu／LINE六格未修改，真人Help流程驗收尚待。

| 渠道     | 已部署公開路徑   | 特別內容                                                                                |
| -------- | ---------------- | --------------------------------------------------------------------------------------- |
| LINE     | `/line/help`     | 有邀請回原邀請、一般申請待審；LIFF打卡／回條；新心得依告知進入學員流                    |
| Telegram | `/telegram/help` | /start／Mini App／/checkin；私人回條；自選提醒與/remind off                             |
| WhatsApp | `/whatsapp/help` | join／checkin、個人30天／共用15分鐘裝置登入、固定書籤、完成卡／關閉fallback、無聊天摘要 |

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

TG setMyCommands/setChatMenuButton等正式設定及WA Meta Console同樣未改；程式內選單／指令接入已另經核准部署，但provider正式menu設定仍未改。既有bot username／私連結未硬編進Help，不移除現有功能。

## 本機驗證與失敗留證

- 公開Help unit28：3渠道×3語未登入／無DB200，CSP/headers、三主區先於FAQ、native details預設閉、無SDK/script/form/storage/API；query/token/returnTo不反射、POST404、channel文案差異及可信public URL／命令全等匹配。Guard unit5涵蓋並行／completed重播、subject/command衝突、失敗retry、capacity／TTL／pending不evict及非法limits。
- Signed native PG16 routes5，在**隔離的active policy**前提：TG/LINE未核准也可Help，錯secret/HMAC、group、sender mismatch、stale及重播/衝突／provider失敗保護；TG真transport mock為普通URL、WA list help與durable replay／重啟／stale24h保護。完整86表hash排除僅必要WA inbox前後相同，包括people/applications/consent/service windows/links/reminders/awards/audit等；沒有新同意或資格。
- WA transport新增三語3個case：原5rows加help，六row IDs順序與title長度≤24精確、無私人URL資料。原TG reminder/opt-in／native驗證與LINE五LIFF入口仍回歸。
- 初guard optional pending設undefined被exactOptionalPropertyTypes拒，改delete；TG edit定位重複未套，後字串newline語法錯誤由prettier拒，修為literal escape；未忽略type/lint。Native WA fixture最初缺Meta interactive.type而400，補正真格式並固定重啟重播的原payload/timestamp，未放寬schema或去重。完整verify原2個舊期待（TG start5而非6、LINE所有HTTPS都拒）失敗保留，改為**5native+1public Help**及**精確只允許該Help HTTPS**，原防token／fragment／configured LIFF斷言保留。strict test再抓可能undefined message，補型別前置不加assertion繞過。
- 最終Node24 build／兩strict TS gates／format/lint/typecheck與完整verify **1386tests＝API1093／DB285／config2／identity6，無skip**；map1719phrases/1347mappings。本輪沒有CI／重跑CI／正式變更。
- 真本機Chrome **18組／18圖**＝3渠道×3語×390/1280，用真正本機buildApp路由、無adapter config及DB（databaseAttempts0），主區順序、FAQ預設閉／原生展開、daily anchor、無水平overflow、44px觸控、script/form0、storage keys0與JS exception0；無真OAuth／手機／Richmenu／Meta驗收，不假稱已發送圖片到Telegram。

證據：`/tmp/qigong-help-{routes,routes-fixed,routes-policy,reminders,line-regression,line-regression-fixed,tg-regression,verify,verify-complete,build,browser}.log`，verify保留舊menu斷言失敗，complete為1386成功。`/tmp/qigong-help-browser/results.json`與18PNG；runner `/tmp/qigong-help-browser.mjs`。測試PG16/55526、HTTP55532/CDP55533完成後停止。

## 正式部署／final actual restore／復原

- 功能 **96e0c13175d5cf661347f8299e7d7c440079b4c8**，19檔feature提交，精確SHA CI **39793684155**原run **1386tests**及兩strict gates成功；CI原先queued再in_progress，當時正式仍服務未停機，建置／clone先行但直到同run成功才維護，無重跑或繞過。API min42/max46／phase27、全0001–0046及dependencies不改，**無migration applier／DDL／grant/backfill**。
- Manifest差異16既有編譯檔（7個runtime模組及map＋TG feature/onboarding兩宣告）、9新增Help三模組JS/map/declaration，319其他檔相同；worker及CSV runtime JS/map byte-identical。原compiled LINE/TG/grant/Authgear/journal／mock worker與systemd14mock receipts、雙lane新鮮heartbeat／graceful stop過，無外部發送。
- fresh46 clone restore原86表／20people／74checkins/source/privacy/audit/jobs／函式及attrs/RLS/ACL/roles保存，新舊API均ready。三渠道×三語公開Help9頁／無script-form，讀取前後86表exact；三渠道簽章Help各實際mock回覆1次、duplicate皆不重送。只允許1個synthetic WA inbox marker新增，既有inbox row hash與其餘85表及state exact，沒有申請/資格/consent/service-window寫入。最初scope verifier以postgres讀root-private證據EACCES，在維護前被guard擋住；保留failure，改root controller讀JSON、postgres僅做只讀SQL，未擴檔權／DB grant或放寬比對，未重送signed fixture掩蓋重播差異。
- 維護 **2026-10-22 14:36:34–14:37:40 UTC（台北22:36:34–22:37:40）／65.432monotonic秒**。入口封鎖、停寫／drain API及雙worker後，final DB／global roles／runtime分離key站外AES-GCM、decrypt/hash後fresh PG16**實際還原DB/roles與extract runtime**，86表／20people／74checkins／原1draft/0preview exact。比對包含所有現WA事件/links、目前env/token、name snapshots與metadata；正式DB沒有restore/migrate。
- Matching artifact及version override切換，private API startup前後86表exact；**14:37:03 resume marker先於workers**，新epoch health合格才恢復入口。env640／6protected檔／3enabled links及通知/授獎flag保留，normal Caddy全檔byte-identical、其他站台不變；六項WA loaded值與目前api.env逐一相符，不回灌舊未配置WA或舊token。兩份無關文件持續排除。
- 正式 **268 Node HTTPS**含三渠道三語Help/header/CSP/無script-form、POST404/query不反射及原功能邊界過；API/realtime active、restart0/exit0、minute success/timer active、receipt health healthy、兩lane各queue0，epoch samples0/p95null，不是假稱手機延遲或exactly-once。兩真guest TCP ports/reqId log probes證明incoming URL [REDACTED]及completion200/401、marker與三WA secrets未出現在current-invocation API journal。
- Post-release runtime再站外encrypt/decrypt/hash後實際extract驗env/current/override/normal ingress，不說成post-release DB另還原；clone/probe停、worker/community fixture憑證檔刪。沒有agent正式申請/checkin/心得/審核/個資CSV/provider test sends（guest OAuth smoke僅暫存login challenge）。
- **正式LINE richmenu六格、Telegram setMyCommands/setChatMenuButton、Meta Console均未修改**；程式內回覆菜單與help指令已上線不等於provider設定已發布。三公開網址現在可開，但六格替換／BotFather/menu正式發布及真人各client點擊仍另核准。閱讀Help不建立同意/資格；沒有啟用通知或新授獎，operator FALSE。
- 恢復後保留46／全部新寫入／現WA env，優先fix forward。不退42、不回灌舊DB/runtime或token；必要binary recovery也須另確認且只能已驗same46的a24 matching artifact，保留DB/queues/audit/env與provider設定。
- 私有證據`/tmp/qigong-help-release-96e0c13/`及`/tmp/qigong-help-release-{prepare,compiled,scope-fixed,realtime,activate,public,post-backup}.log`；compiled保留scope原失敗，scope-fixed為不改權限的比對成功。正式`/root/qigong-deploy-96e0c13`與deployment-tools/96e0c13。站外backup `~/.local/share/qigong-platform/backups/deployment-96e0c13`，分離key在backup-keys/deployment-96e0c13.key，不入Git/log/對話。

## 真人驗收／正式選單發布待辦

commit/push與同schema46發布已依後續核准完成，精確SHA CI、final actual restore/preservation過才切換。發布需保留現WA env及token／notifications／operator FALSE、不跑migration；之後才逐一確認各平台新Help入口及正式menu發布。無需為讀Help送出申請、打卡、同意、啟用提醒或產生任何正式個資CSV。
