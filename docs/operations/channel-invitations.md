# Telegram／WhatsApp邀請加入（提交推送已核准／尚未部署）

## 核准與使用流程

本機1461tests與42組Chrome完成後，使用者另明確核准提交推送本次25個預期檔案並等待精確SHA原始CI，**不部署、不套migration47、不改正式env／provider／憑證、不發行邀請或訊息**。兩份既有無關文件排除，0001–0046保持原hash。

使用者暫緩WordPress/OIDC整合，核准本機補齊TG/WA與LINE對等的預核准邀請；單一URL、自動帶入邀請資訊、不要求學員輸入或貼邀請碼。保留基本資料、必要同意與非邀請一般待審流程，新增邀請預設7天/1人，可設1–30天/1–10000人；不順帶全面關閉普通申請。管理員只將邀請給已確認學員；任何持有共享連結的人都可能使用，**這不是WordPress學籍驗證或指定自然人證明**。

- 後台新增`/admin/channel-invites`，LINE原管理API、權限、預設7天100人及歷史不改；共用側欄僅追加TG/WA入口與獨立capability檢查。
- 建立後只顯示一次`https://checkin.baiyinqigong.org/{telegram|whatsapp}/join#<shared-token>`，raw token不存DB/list/audit/log。GET不查DB或耗額，fragment只在瀏覽器RAM讀取後清除，不放storage/cookie。
- Telegram點連結後按Start：轉到固定Bot的`?start=inv_<43chars>`（payload47chars），不手填。
- WhatsApp連結預填`join inv_<43chars>`，仍須本人按送出；不假稱網頁可以替人傳訊。必須是實際對話電話，不是Meta Phone Number ID。
- 驗簽與私人發訊者檢查後，Bot傳`/{platform}/invite?lang=...#<private-resume>`。此capability與平台、已驗證subject、nonce綁定，DB只存hash，最多15分鐘且不超過共享邀請期限，重訪不滑動續期。
- 本人表單先按當前政策處理必要同意，再確認姓名/網站註冊Email/國際格式電話與固定邀請地區。WA申請結果通知同意維持既有明示checkbox，不由邀請推論；心得分享不勾選、不轉移提醒或其他同意。
- 成功才在同一transaction建立person/verified identity/地區/唯一常用渠道/approval及正常既有decision outbox，記redemption、用途稽核並扣一次額；沒有待審審核通知新事件。已存在pending只由同一subject重新確認後升級，取消尚未發送的舊review deliveries，不保證召回in-flight。
- 已核准者開未知/過期/撤銷/額滿邀請仍回原功能，不重填、不耗額、不改資料；rejected、suspended、revoked identity或其他已綁定狀態不恢復、不合併，姓名/Email/電話不是identity lookup。

## Metadata設定（未修改正式env或provider）

兩個新增值都是非secret，讀取後會驗格式；每渠道獨立可選，未設定或對應Bot未配置時後台不得產生不可用URL：

- `TELEGRAM_INVITE_BOT_USERNAME`：使用者已確認為`qigong_checkin_bot`，不含`@`。發布前須以已配置Bot的getMe／Console核對，不把使用者nickname當Bot帳號。
- `WHATSAPP_INVITE_CHAT_NUMBER`：小幫手對外國際電話，可含開頭`+`、不可空格；不是WABA ID/Phone Number ID。發布前核對同一已配置WABA/phone asset。Meta測試號碼的收件限制仍存在，不能宣稱本機測試等於正式號碼可全面使用。

WhatsApp對外電話尚未決定，因此先不設定此metadata、不建立WA新邀請URL；既有WA打卡／登入／token／phone asset保持不變，不將整個WA服務停用。本輪沒有填正式值、轉動token、發真人訊息或改Console/圖文選單/通知/授獎flags，WordPress與Bitwarden整合都未執行。

## DB與API邊界

新`0047_channel_invitations.sql`新增3個private forced-RLS表：`channel_invites`、`channel_invite_continuations`、`channel_invite_redemptions`。不回填任何舊資料，不改0001–0046，不改原phase27 worker gate、既有49badge或operator FALSE。

- Super global角色／wall-clock權限及實際session在create/list/revoke及鎖/稽核後重驗；不授權master、一般管理員或worker。需要Origin、CSRF、strict DTO、reason、revision；列表不回token/hash/subject/session。
- 固定平台用途，TG與WA shared/private token不能互換；raw shared token不能當私人表單credential。
- global grant/revoke lock、subject lock、邀請及申請row locks；期限、額滿、地區、issuer、context、隱私在等待後及audit後重驗。失敗全部rollback，不能有半套person/通知或扣額。
- public頁`no-store/no-referrer/nosniff`、嚴格CSP、無外部script/SDK；只有native handoff明確帶邀請到t.me/wa.me。私有資料POST同源JSON，不接受browser提交的subject/region/issuer等授權欄位。
- 兩個ordinary submit入口用新wrapper防止有效邀請被舊表單降為pending；原privacy wrapper保留但不給runtime直接EXECUTE。舊表單409明示回Bot接續，不讓它暗中另開一般申請。
- TG只在已驗簽、private/sender匹配後處理，顯式邀請需要fresh date（24h內、future60s）；process-local5000/15min reply guard只減少同process重送，**不是跨restart或provider timeout exactly-once**。Quota/approval另由DB保證不重複。
- WA保留原signature/WABA/phone/inbox/24h freshness及STOP行為，使用實際message.from，不信任表單phone；明確join是使用者主動訊息，原服務window記錄保持。Help仍不延長window。
- 新路徑失敗只回泛化code，新native helper不把PG detail/parameters/token傳給舊logger；既有全站日誌補強仍是另一工作，不把本次當整站安全修復。

## 相容與發布

候選API min42/max47，42–46探測新函式不存在時不呼叫缺少的SQL，capability=false、新流程不可用，原加入/LINE流程保持；47才開新能力。現行正式仍是b5731b9/schema46，本輪已另獲提交推送核准；尚未apply47或部署。

發布必須另核准：精確feature-SHA原CI、old46/candidate46/47與worker相容及保存演練、目前env/LINE選單/WA資產核對、停寫final加密站外DB/roles/runtime及實際還原保存。舊b573最高46，不可在線直接apply47；須先部署支援46的相容先行版，或另審API/雙worker協調停機升級方案。不可沿用前次same46窗口或舊rollback假設。

47恢復寫入後保留新schema及全部新寫入，優先fix forward；不得為回復舊binary把DB退46或回灌舊DB/env/token。正式邀請發行、真人Start/Send/WebView流程及實際訊息驗收另核准，不以mock代表交付。

## 驗證證據

- DB：17項涵蓋用途hash/RLS/session、兩平台quota並行/同人retry、pending、ordinary guard、consent、revocation/blocked、audit rollback及audit後fresh context/issuer/session；新增46→47保存測試，原86表/安全metadata與非目標函式不變，worker ready/operator FALSE。
- HTTP：11項以真restricted PG/實際admin session及驗簽webhook＋mock provider驗證完整流程，含同意前拒絕、WA通知明示、跨平台/subject/region偽造、TTL/revision、ordinary pending保持、TG bounded guard與WA durable replay。重放使用相同timestamp/payload，不靠改payload洗綠。
- Unit：20項涵蓋三語兩模式script語法、無手填碼/storage、固定native targets、Origin/DTO與惡意metadata不注入。候選schema42–47矩陣及既有LINE/WA成功卡回歸另跑。
- Browser：`/tmp/qigong-channel-invites-browser.mjs`、results.json及40PNG；42組（三語×390/1280×兩平台×landing/form/admin，加6種無效入口）使用合成auth/transport，驗draft/checkbox語言切換保持、失敗/未確認不顯成功、成功才清表單、單次預設、prefilled URI、不執行native handoff、無overflow/外站/正式連線/provider sends。不是實際手機/provider驗收。
- 第一次DB fixture漏admin display_name，精確補synthetic欄位，未改NOT NULL。UUID型別/DTO narrowing、control regex與無await lint依既有規則修正，不關型別/lint。新renderer先紅測惡意target後加allowlist；checkbox測試精確檢查HTML預勾及`.checked=true`，不把合法`.checked=false`誤判。原verify只因導航新增第4條路由三語期望未更新而失敗，保留`/tmp/qigong-channel-invites-verify.log`，精確追加路由與獨立capability拒絕測試；不重寫原授權期望。
- 本輪未連正式VPS/DB、未取用正式憑證，只讀repository SQL並使用隔離PG容器loopback55526。最終Node24兩strict gates／format/lint/typecheck/build與完整verify **1461tests（API1151/DB302/config2/identity6）**通過，靜態map1811phrases/1431mappings；`/tmp/qigong-channel-invites-verify-complete.log`。原失敗不刪，沒有重跑CI或放寬security/assertion。
- Browser最後改為截圖前明確切回檔名所示locale並核對h1，避免先前測語言切換後將英文表單誤標成繁中截圖；原產物保留before-locale-capture，新完整42組/40PNG與`/tmp/qigong-channel-invites-browser-complete.log`過，未改產品行為。
- 本機原始失敗、修正log與baseline hash保留，兩份無關文件持續排除；後續提交推送已另獲核准；部署仍未核准，不把CI成功當成部署授權。
