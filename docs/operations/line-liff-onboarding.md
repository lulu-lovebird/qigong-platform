# LINE加入申請LIFF入口與登入回跳

**已於2026-10-11 13:14:00–13:14:19 UTC部署，停機19秒。** 程式`5230f1efd469b54e2422f43292638d3c08a0272b`／schema25，[CI 38141973040](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38141973040)成功。使用者核准修復、提交／推送及部署；本批不新增migration、改環境、變更Console／Login發布狀態或舊Bot。

## 主站驗證及恢復

- 精確git artifact／frozen lockfile／Node24建置及manifest保留；正式快照同25完整62張應用表／4 people／7 check-ins及metadata一致、新舊API相容。compiled新LIFF申請URL及原token＋正確ID token提交pending、無效ID token拒絕、其他LINE／TG／後台brand/CSP／sharing／scope／角色交易／mock worker通過。
- 最終站外AES-256-GCM DB／roles／env／systemd副本逐一解密雜湊核對，DB實際還原後完整相同、舊3bdc7c9 ready。正式不執行migration、兩份env雜湊不變，沒有主站合成session／client／訊息／policy發布。
- 112 HTTPS檢查（111主站＋1PNG來源）通過；合成liff.state／SDK參數probe在主站API日誌的req.url為[REDACTED]，以requestId定位且只回覆布林，不輸出其他私人日誌。Caddy access log未啟用、未改proxy；不宣稱外部供應商完全不處理URL。
- API active／NRestarts0／ExecMainStatus0，timer active、worker Resultsuccess／ExecMainStatus0。LINE App真實授權／SSO仍須操作者從新收到的LIFF私人申請連結重測；不能將mock SDK或token有效當真人證明。
- 保留/root/qigong-deploy-5230f1e、/opt/qigong-platform/deployment-tools/5230f1e、工作站/tmp/qigong-line-join-5230f1e、repo外backups/deployment-5230f1e，key另置受限backup-keys；clone已停，非完整OS／Caddy災復。
- 同25回退可停API／timer、核對在途worker後切回3bdc7c9API／worker／old-release.conf，不還原DB以保留之後寫入；重測不刪除／重建已核准學員。若另退22，需matching22 DB＋852cd05及獨立核准／對帳。

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
