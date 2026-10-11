# LINE加入申請LIFF入口與登入回跳

**使用者核准修復、提交／推送及部署；本機驗證通過，待部署。** 主站切換前仍3bdc7c9／schema25；本批不新增migration、改環境、變更Console／Login發布狀態或舊Bot。

## 原因與修復

- 舊加入申請連結是一般HTTPS `/line/apply#token`，開啟環境可能是普通LINE內建／外部瀏覽器。新Bot以configured LIFF ID回覆`https://liff.line.me/{liffId}/apply#token`；token仍30分鐘、本人綁定、一次使用及後台審核，ID token仍由LINE API驗證audience／expiry／subject。好友／Login／審核不是同一個授權步驟。
- 工作區及心得衍生頁原先在`liff.init()`完成前清除fragment，可能破壞SDK認證／轉址。新LINE頁只由共用login bootstrap在SDK初始化成功、取得ID token且已在secondary URL後清URL；primary `liff.state`不清理、不呼叫API或再觸發外部login，交給SDK處理redirect。
- 第一次外部login仍保留初始化前的申請fragment，redirect URI只增加非敏感`_line_login_attempt=1`標記；不在瀏覽器儲存token、idToken或完整URL。未登入的native client或帶回跳標記／code／error／liffClientId的失敗callback停止重導，提示回LINE取得新連結，不無限開帳密頁。
- 正常已登入的secondary callback仍接受，清URL後body送原token＋已驗證idToken；標記不授予身份，不忽略驗證或資格／同意／審核。舊普通HTTPS私人連結仍可用，但外部SSO不能保證在不同瀏覽器間保留狀態。
- 發布Login channel不是此loop的直接修復；Developing仍須測試角色，首次新channel的允許授權可能正常存在。根因未宣稱只剩一種裝置／設定可能性，需真人重測。

## LIFF協定與日誌安全

- LINE官方說明：https://developers.line.biz/en/docs/liff/opening-liff-app/ 、https://developers.line.biz/en/docs/liff/developing-liff-apps/ 。附加path／query／fragment會進primary的liff.state，secondary由SDK組成；不得在init Promise完成前改URL。SDK primary可能含認證資料。
- API預設logger新增完整req.url遮蔽，原authorization／cookie／provider header／set-cookie遮蔽保留；requestId／method／時間仍可診斷。不讀出憑證，不打印私人連結或query。真實Fastify logger測試確認合成liff.state、SDK credential、cookie不出現在輸出。
- 唯讀核對主站Caddy未啟用access log，未改Caddy。這不代表LINE／Cloudflare或其他供應商不處理URL，亦不宣稱整條鏈路從未產生過URL紀錄；未讀取／公開既有私人日誌。
- 沒有新增信任liff.state的server redirect、query token或瀏覽器user ID。API Origin／JSON／ID token／短效申請狀態檢查維持。沒有自動合併舊平台身份或發布政策。

## 驗證與重測

- 完整pnpm verify **464項通過、無skip**，format／lint／source typecheck／build通過；額外全測試tsc仍既有10錯誤、无新增。
- 針對性案例含init前hash不變、primary不清URL／不送API、token保留、secondary callback成功、外部一次login、失敗回跳停止、native未登入不呼叫外部login、ID token及跨本人拒絕、configured LIFF申請URL、Pino日誌遮蔽；TG／WA／Admin既有測試保留。
- Chrome390px／1280px共10個合成情境：primary→secondary、外部首次login、失敗回跳、native未登入、成功secondary callback。mock LIFF SDK橋接與mock backend確認4次提交的原token／idToken保留、無loop／JS exception／整頁overflow。不是LINE官方SDK真實認證、手機或實際授權證明。
- 部署後從LINE聊天重新輸入「加入」，點最新LIFF申請連結；不要點舊普通HTTPS訊息。正常情況以LINE App登入狀態開啟，首次授權仍可能需要「允許」。未登入若停止於錯誤提示，記錄装置／LINE版本／操作時間及是否native／一般browser，不貼完整URL、fragment、idToken、cookie或個人內容。
- 申請送出後仍須後台核准；同schema25回退只切回matching舊25API／worker，不還原DB，以保留部署後申請／打卡。
