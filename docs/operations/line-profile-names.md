# LINE驗證暱稱（已部署schema31，真人name claim驗收待完成）

使用者回報LINE排行榜顯示「學員＋number」，確認為既有同地區匿名遮罩，要求LINE作者在心得流直接用LINE暱稱。本次本機同時修正LINE同地區排行榜與LINE journal10筆stream：不以申請表姓名／Email／電話當作LINE名稱，也不以暱稱匹配／合併或授予資格。已另經使用者核准commit/push/deploy；實際主站fee82ba／schema31，2026-10-14 07:28 UTC切換。初版SSR遮罩說明已修正、CI38527337097／609tests成功。見[部署與實際恢复證據](line-profile-deployment.md)。

## 取得與顯示

- 使用既有LINE ID token verify endpoint，僅從伺服器驗證回覆取得name；驗證sub、aud等於configured Login channel、exp及返回的iss（若提供）等於LINE issuer。Token與provider錯誤不輸出日誌，不相信browser displayName。
- 原本每請求就驗證ID token，現在同一次回覆可補verified display metadata，不增加額外LINE取名請求、不要求操作Console。LIFF若缺profile scope或provider未給name，維持匿名；原已有verified名稱不因此次缺值清空。
- 新`platform.line_verified_profiles`forced RLS table，以既有identity UUID作FK，僅保存已驗證暱稱及時間。API-only refresh facade精確subject綁定既有active person／未撤銷LINE identity，未連結者回false，不創建身份。僅名稱改變時audit boolean，無name或token metadata。
- 每次完成LINE頁面的身份驗證可更新本人名稱。新邀請首次验证時身份尚未建立，名稱會於核准後導向打卡頁再取；舊學員需再開LINE頁面，**不會批量讀LINE profiles或把資料庫申請姓名回填成暱稱**。
- LINE排行榜保持same-region eligibility／期限／排名／天數／30人上限；self顯示`暱稱（你）`，peer顯示已驗證暱稱。未取得或作者缺当前必要同意時`匿名學員`，不回raw ID／hash number或申請姓名。
- LINE心得流仅LINE identity作者顯示LINE暱稱；TG／WA作者保留原share alias。原share aliases仍保存在publication、供其他渠道／外部分享；不重寫原snapshot／published_at／revision／私密內容。my-sharing label説明alias適用其他分享渠道，LINE stream用LINE暱稱。
- 新public-name getter只供owner facade使用，不給API／worker直接讀表或跨身份查名。作者inactive／identity revoked／必要政策required時不回verified name。讀取仍依既有身份／資格與必要同意；不因使用者認為都同意而代接受、發布draft政策或回填同意。

## 契約與驗證

`0031_line_verified_profile_names.sql`新增1個cache表、profile refresh／private getter、LINE-only report及stream wrappers。保留TG／WA report及舊community／staff／external feed形狀。API exact31、worker `ops.line_profile_schema_ready()`、architecture `phase-16-line-profile-names`，不得改歷史0001–0030。

Mock verifier12項、DB／HTTP7項涵蓋channel/sub/exp/issuer/name格式、provider故障泛化、own／peer anonymous／nicknames、name更新與缺值不清空、原person/identity/application/grants不变、audit不重复、TG alias與旧community feed保留、worker/table denied／inactive及author必要consent缺失不公开name。upgrade30→31/reapply保持所有非metadata舊表指紋，cache空，無自述姓名或權限回填，旧API／worker gate拒絕。

這不是LINE真人／实际name claim驗收。本次commit/push/deploy已另核准，正式30clone与最終加密備份實際還原／matching API-worker完成；仍由學員重開LINE排行榜与心得流做真人暱稱更新、匿名fallback、重名不合併與文字呈現驗收。31→30回復需matching30DB＋e2e9a4b，不能binary-only；流量後另核准並對帳寫入。正式env／提醒flag／WA配置與政策不改。
