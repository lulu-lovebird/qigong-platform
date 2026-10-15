# LINE邀請完成後導向小幫手聊天（已部署，同schema34）

使用者確認兩種情況都調整：**已核准學員再次點邀請**、**新學員首次核准成功**。使用者另核准commit/push/deploy，正式d8d4e6679993a018819b790fe608197934045f46／schema34，2026-10-15 12:54:02–12:54:21 UTC完成；CI38737168221／696tests與144HTTPS checks成功。只改邀請頁及測試／文件，不變更DB／quota／通知／政策／Console。見[部署及實際還原證據](line-invite-chat-deployment.md)。

## 原因與流程

白雁官方帳號開的邀請LIFF，就算頁內轉到checkin，仍可能保留原來源聊天；關閉後回白雁，而回條實際已送到小幫手，並不是打卡資料遺失。不能藉頁內redirect保證改變來源聊天。

新流程：白雁圖文選單邀請 → LIFF初始化／伺服器身份及資格驗證 → 小幫手聊天 → **本人在小幫手按「練功打卡」** → 打卡LIFF／關閉後查看小幫手回條。開聊天後不再由原邀請頁自動啟動checkin，以免重現來源問題。

- 邀請頁改為中性「打卡小幫手入口」，已核准顯示不必再申請；新核准成功也隱藏表單、前往聊天。
- 使用固定公開URL `https://line.me/R/oaMessage/%40556fjenc`，與加好友介紹頁 `/R/ti/p/`不同；不加任何message query、invite／resume／ID/access token、UID或個資，不引入open redirect參數。
- 只有SDK初始化後、server回approved，且isInClient與getOS確認ios/android、openWindow存在時，嘗試`liff.openWindow({url,external:true})`。該API回void，不能當成聊天成功開啟；UI只說「已嘗試」，始終保留按鈕／說明。
- 主按鈕可由使用者手勢重試bridge；bridge缺少／throws或外部／桌面時允許普通anchor fallback。另有**不經bridge的普通聊天連結**，避免bridge靜默失敗後每次按鈕仍被攔住。
- 桌面／未知OS／外部瀏覽器不自動呼叫bridge，提供手動連結及手機LINE／自行切換聊天說明；封鎖小幫手須先解除封鎖。不承諾PC或所有版本都能自動切換。
- 不自動呼叫closeWindow／window.close，不在開聊天後關原LIFF，避免又回來源白雁；不呼叫sendMessages、不預填指令、不新增補推回條。原本正常核准結果與打卡摘要的既有發送流程不變。

## 安全與重試

- server API／SQL／資格／停用／identity／必要同意流程完全未改。既有核准仍獨立於邀請有效性、不扣額／重寫資料；pending有效invite仍本人確認才核准。此頁不根據瀏覽器姓名或friendFlag推定資格。
- 需要privacy時先完成原有explicit consent；未核准、blocked／invalid或API401/503不自動導航。聊天連結是公開入口，不是打卡授權；之後打卡仍每次驗資格。
- 成功後進入completed狀態、清除頁內invite/resume與privacy proof參照、reset本人填寫表單。visibilitychange／舊retry／重複submit不再重跑查詢、同意或redeem；只有手動聊天入口可再開，不重複核准或耗額。
- 兩個anchor固定URL、target=_blank／noopener noreferrer；頁面與route no-referrer/no-store保留，無localStorage/sessionStorage或cookie新增。

## 官方依據與限制

- [LINE URL scheme](https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/)：oaMessage＋percent-encoded LINE ID開官方帳號聊天；加message query只會預填，非自動發送。本次不附message。
- [LIFF openWindow](https://developers.line.biz/en/reference/liff/#open-window)：外部瀏覽器不保證、返回值None；Universal/App Links依LINE版本與external選項不同，15.20+應用外部模式才轉對應app。
- 官方URL scheme主要支援iOS/Android，不支援PC LINE。不能從bridge void返回或本機Chrome推論已切換聊天／確保close回哪個帳號。

## 驗證

- 完整pnpm verify成功**696項**（API509／DB179／config2／identity6），format/lint/source typecheck/build；額外all-test tsc仍10個既有錯誤，沒有新增。
- 邀請頁整HTML/script VM21項：既有核准／新核准／pending本人確認後handoff、SDK及server gate先後、iOS/Android、silent/throw/missing bridge、missing OS/context錯誤、桌面／外部、普通連結不被bridge攔截、privacy先完成、401/503/SDK失敗不開聊天、URL無憑證、不close/send、返回不重複查詢／redeem、失敗保留草稿。
- server HTTP／DB舊測試保留並通過：friendship／issuer／identity、alreadyMember不耗quota、required consent／revocation／並行／sourceHash等不改。
- actual Chrome390／1280共20布局：iOS/Android首次與重訪、privacy、external／desktop／throws、blocked／401；真DOM填基本資料／勾必要同意，SDK參數固定chat URL／external true，手動連結未被產品preventDefault，zero overflow／runtime exception。
- Chrome SDK/backend全synthetic；測試listener主動阻止普通anchor離開到LINE，未對provider發送。**沒有驗證真LINE會切換或關頁回聊天**，不能把這些當真人驗收。preview/Chrome及專用PG16 invite-chat測試容器／55458已停止，原共享叢集未動。
- 證據 `/tmp/qigong-invite-chat-{verify,all-types}.log`、preview/cdp scripts與20張截圖。

## 發布及驗收待辦

後續已核准並完成commit/push/deploy，same-schema34且沒有migration applier或資格／邀請改寫；最終加密備份已實際還原／原592 API ready，資料與metadata完整指紋不變。舊smoke中「加入並開始打卡」label／checkin redirect期待已更新為chat handoff、bridge/fallback與no close/send，避免把舊期待誤判產品失敗。真機聊天切換及來源驗收仍待使用者回報。

iPhone與Android都須真人驗收：從**白雁官方帳號**點原有效邀請，新學員核准／既有學員重訪都進小幫手聊天，再**從小幫手按練功打卡**，保存關頁後查看同一聊天的回條；另驗自動被擋時兩個手動入口、桌面提示、privacy／停用仍受限。不要用假的測試帳號去正式批量核准或代發訊息。

同schema可matching59241f4 API-worker切回、不還原DB/env／不覆蓋新資料；會恢復原直接checkin導向，仍按發布流程核准。untracked web-admin-permissions-review.md保持排除。
