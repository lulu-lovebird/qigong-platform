# Telegram固定Mini App入口與儲存後返回聊天

**候選25程式已commit／push `75834f6`，CI 38055345937成功，本機隔離升級／還原通過；公開HTTPS與真人渠道測試尚待配置。正式仍852cd05／schema22。** 詳見[隔離試行](isolated-channel-pilot.md)。 正式部署、正式政策發布、BotFather及正式渠道設定未核准；隔離試行先LINE再WhatsApp專用測試帳號驗收。

## 已核對的差異

舊qigong-telegram-bot /start與/checkin使用固定inline WebApp URL，伺服器驗證簽章initData／auth_date；原始碼預設最多3600秒，不是無限期登入。舊打卡UI儲存成功呼叫tg.close。

正式852cd05用15分鐘平台capability作URL fragment，且每位TG user原有一筆link；新指令可取代先前link。正式UI有SDK ready／expand與closing guard，但沒有呼叫close。上述核對只讀取舊repo與正式程式／health，不讀Bot token或更動部署。

## 新入口

- 已核准且有效的學員 /start、/checkin及其他工作區指令提供5個固定WebApp按鈕，不放token或15分鐘訊息；未核准者仍走既有申請／審核流程。
- Mini App開啟後由POST /telegram/workspace/session驗證raw initData。嚴格Origin、JSON、欄位／長度；拒絕重複query key、錯bot、改user、無hash／auth_date、不安全ID、bot user、超過1小時或超過60秒未來的proof。
- 使用Bot token衍生WebAppData HMAC，再constant-time比較簽章；不相信initDataUnsafe、瀏覽器user ID、Email／姓名，不提供auth-disabled後門。不把proof／token寫入ordinary logs。
- verified subject仍需有效person／identity／核准／primary channel與policy。必要時回consent_required私鏈；簽章不是新註冊核准或管理權限。
- backend產生獨立15分鐘capability，browser在記憶體保留與提前更新；一次launch proof最多1小時，過期需重新由Telegram按鈕開啟。這是「入口URL不過期」，不是永久授權。
- initData的SDK參數完整保留，包括fragment首個tgWebAppData；只有真正的capability前綴會被移除。native參數可由官方SDK正常cache，平台token不寫URL／localStorage／sessionStorage。
- 多頁／裝置短session可以並存，不取代其他capability。舊私人URL保留作相容fallback，但仍15分鐘且每次重新核對資格。

## 資料庫

0025改telegram_checkin_links的primary key由user改成token hash，保留原始列及有效期；建立subject index及forced-RLS交換限流表，每subject每分鐘最多12次，過量429＋Retry-After60。

credential-boundfacade保留，pre-privacy begin實作依token upsert，不將別人的token重新綁定。停用依user使所有token到期；既有period／UUID／version／privacy／摘要outbox規則不變。沒有自動連結帳號、搬歷史或發行外部client。

## 返回聊天

- 只有Telegram native initData存在、SDK close可用，且server已確認儲存後才自動close；不等待profile刷新或摘要實際送達。
- 使用既有durable outbox，沒有額外sendData發摘要，避免重複聊天回覆。API成功不代表手機送達。
- 未存的另一日期／時區草稿會讓UI留開，提供「返回聊天」按鈕；手動返回有實際修改確認。普通browser不強制window.close，失敗儲存不close。
- close前解除writing／busy與native closing confirmation，再設leaving避免已確認後再彈beforeunload。close不適用LINE／WhatsApp；derived workspace仍用各自驗證，無TG session exchange。

## 驗證

- 經人員核准續查，最近連續兩次 `pnpm verify` 完整425項通過（無skip），含format／lint／source typecheck／build；這是驗證結果，不是間歇性故障已修復的證據。診斷期間重現WA更正409、onboarding review權限拒絕，以及journal coach能力誤判；根因仍未定位。保留僅含合成fixture布林狀態／錯誤分類的測試診斷，不放寬授權、不新增對外診斷欄位。另20輪完整admin suite及60輪WA單案例通過，不作為因果修復證明。額外全測試tsc仍為既有10項錯誤、無新增錯誤；不可宣稱可發布。
- HMAC／freshness／duplicate／錯ID／Origin、static start／checkin、政策／停用、並行session／expiry／limiting、本人與區域隔離、24→25列保留／重跑／舊契約拒絕、SDK首欄保留與提前renew、成功close／其他草稿不close／失敗保留涵蓋。
- Chrome官方Telegram SDK＋合成launch／mock backend四場景：390px繁中／英文、1280px英文、另一日期草稿與心得feed。零JS exception／overflow；signed params保留、fragment清除、SDK cache無平台capability、commit後close追蹤與dirty時留開通過。不是Telegram Android／iOS／Web真人驗收或正式快照演練。

## BotFather設定（待部署及核准後）

只操作新平台專用Bot，不改舊qigong-telegram-bot。webhook／secret／token維持既有保護設定，不在對話或Git貼憑證。

/setcommands可使用：

    start - 開始使用／功能選單
    checkin - 練功打卡
    leaderboard - 排行榜
    methods - 功法分析
    achievements - 成就與月曆
    journal - 心得分享
    privacy - 使用與分享補充說明
    language - 切換語言

若需要選單按鈕，使用新Bot的/setmenubutton，URL為https://checkin.baiyinqigong.org/telegram/checkin（不加token）。設定slash清單不會部署程式，現在正式22的/start仍是舊流程；先完成核准的matching25部署與驗收，再測試新入口。

API／worker exact25，正式22不能直接指向25；artifact含0001–0025，policy仍draft。commit／push、CI及隔離測試部署已核准；正式部署、正式22→25／站外備份實際還原與舊22匹配回復需另核准。正式LINE／WhatsApp維持未啟用；不自動發布正式政策或設定BotFather。
