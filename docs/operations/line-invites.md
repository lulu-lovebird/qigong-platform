# LINE持有者邀請與自動核准（已部署schema29，真人驗收待完成）

## 本機接續修正，尚未發布

使用者另核准修正加好友後被一般申請分流的問題；schema33本機完成，**正式仍schema32／8eaaa9b，以下schema29舊行為目前仍適用**。新接續會綁定verified LINE subject、固定15分鐘、hash-only；follow不再把有邀請者帶入一般表單，已pending本人可持有效invite重新填確認資料後原子核准，rejected／suspended等不恢復，不自動回填或批核既有資料。一般無邀請「加入」仍人工審核。詳見[LINE邀請接續與本人確認](line-invite-continuation.md)，commit/push/deploy與正式migration須另核准。

使用者已在LINE Developers確認openid/profile並補上Login channel連結小幫手OA，回報好友驗證成功；尚不等於新接續修正已做真人發布驗收。

## 核准與狀態

使用者核准開始本機實作：加好友後填基本資料，以邀請token自動核准；既有已核准、有效LINE身份再次開同入口直接進打卡、不耗額度。已經使用者另外核准commit／push／部署`0410e5f`／schema29，2026-10-13 05:43 UTC切換，CI38351901085／570 tests成功；正式邀請尚未建立，未改LINE Console／憑證／政策。Telegram提醒開關保持true；WhatsApp未配置。見[部署／實際恢復證據](line-invite-deployment.md)。

這是**bearer invitation**，不是指定名冊驗證。任何取得連結的人都可能加入；轉傳不能保證是原指定學員。姓名／Email／電話都是自述資料，不用來查找或合併已有LINE／Telegram／WhatsApp身份。

## 管理與學員操作

- Super Admin在`/admin/line-invites`建立，預設台灣`tw-general`、7天、100位；可選活躍的既有五地區，期限1–30天、額度1–10000，需原因。
- 連結格式`https://liff.line.me/<configured-liff-id>/invite#<random-token>`。只在建立回覆／當前畫面出現一次，列表不回raw token，DB只存SHA256。須立即保存、僅分享給預期學員，勿公開貼文。
- 列表顯示期限、使用數／上限、版本、撤銷及建立者權限狀態；Super可帶revision／reason撤銷。建立者不再具有有效Super資格，邀請對新加入者失效。
- 学员開啟連結：先經LIFF／伺服器驗證ID token，不能由網址userId或姓名／Email／電話決定身份。
- 既有有效且已核准者，必要隱私同意完成後直接導至configured LIFF `/checkin`，不查邀請期限／額度／撤銷／issuer，也不改原地區、資料或角色。
- 新加入者需有效邀請、確認加好友、必要同意，再填姓名／Email／國際格式電話。地區由邀請決定，不能提交任意地區。成功同一交易建立新person、LINE identity、primary assignment與active interaction channel，核准application、記錄redeem並耗一次額度。沿用既有核准通知outbox。
- 原pending／rejected／linked-but-ineligible／suspended不被邀請覆蓋；已核准但必要同意待完成先完成同意。沒有批量核准舊申請，沒有自動恢復停用資格。
- 一般「加入」申請仍走30分鐘本人證明／基本資料／地區管理員審核，不以邀請改寫此規則。

## LINE好友驗證與Console前提

新加入者的browser friendship flag不可授權。伺服器以本次access token：

1. LINE OAuth verify檢查client_id等於configured Login channel且未到期。
2. `/v2/profile`檢查userId精確等於已驗證ID token sub。
3. `/friendship/v1/status`確認friendFlag是boolean true。

LINE Login channel必須**連結正確的氣功小幫手官方帳號**，與Messaging channel使用同一Provider；LIFF需有openid與profile scope。Console缺少profile／帳號關聯或API故障時fail closed，不能跳過加好友檢查。本次沒有修改Console；部署前由負責人確認，scope調整也需依發布流程核准。已核准者不需要透過此新好友驗證重建資格。

好友引導沿用`https://line.me/R/ti/p/%40556fjenc`；使用者回頁點「我已加好友」後重新以伺服器確認，不把「我已加入」當作事實。

## 隱私與安全邊界

- `0029_line_invites.sql`新增兩表forced RLS、無runtime表權限，歷史0001–0028不改。只有active Super可管理，不授予任何admin role。
- 所有API嚴格body與本站Origin；管理写入另須既有admin session／CSRF。學生API每次驗證ID token，拒絕userId、friendFlag、region等冒名欄位。
- 全局grant鎖、subject鎖、invite row lock與quota counter同交易；到期／撤銷／限額／issuer權限及privacy在鎖後重查，並行最後一名只有一人成功。普通申請也沿用subject鎖，避免交錯覆蓋。
- 重試或其他邀請對已核准者回alreadyMember，不重複建立資料、不重複耗額度／通知，不更新自述資料。
- 必要同意使用server HMAC生成、每個verified subject／5分鐘區間獨立的15分鐘privacy proof，不把共享invite token作為privacy proof。重复載入同區間不無限新增證明；證明只在JS記憶體與body，不放進網址／儲存API。
- 先閱讀正式政策與補充告知，checkbox預設未勾；接受目前version/hash，reflectionConsentfalse，不自動開啟心得／外部分享、不發布draft政策。
- LIFF primary state交官方SDK；init／secondary完成後才清URL，保留login回跳與loop stop；分享token在記憶體，不存localStorage/sessionStorage。API既有req.url redaction保留，但不保證LINE／代理永不記錄primary liff.state中的private參數。
- Access-token verify的provider GET query依LINE API要求，Authorization供profile／friendship；provider錯誤泛化，不記錄token、sub或供應商URL／response。app只記request UUID與一般錯誤名稱。

## 本機驗證與發布

DB／HTTP／VM包含Super／runtime權限、secret hash與列表遮蔽、預設7/100、嚴格body／Origin／CSRF、LINE access token client／sub／期限／friendFlag、好友未完成拒絕、新加入核准、重试、跨人相同個資不合併、quota並行、撤銷／到期、issuer權限等待後失效、舊身份資格不覆蓋、獨立privacy證明與explicit consent、既有manual申請不變、雙語admin branding与前端導向／失败保留輸入。

28→29合成升級／重跑保留所有非metadata表指紋（含LINE shortlink、identity、principal及啟用的reminder setting），新邀請／兌換表空、零自動核准回填；舊API／worker gate拒絕29，新gate通過。API exact29／worker `ops.line_invite_schema_ready()`、architecture `phase-14-line-invites`。

Mock friendship／LIFF與VM不是真人LINE身份或加好友驗收。本次commit／push／部署已另核准，正式28快照clone／最終加密備份實際還原與matching API-worker已完成；仍須確認Console與真人手機測試。29不能binary-only回28；流量後回復須對帳新申請／身份／邀請額度／通知，不能直接覆寫新資料。
