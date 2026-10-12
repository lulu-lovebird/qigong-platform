# Authgear管理員Email取得與profile更新

**候選schema26已核准commit／push／部署，執行中。** 使用者核准修復及發布；主站仍5230f1e／schema25。本批不讀出正式個人Email或登入token、不改Authgear Console／環境設定，不建立角色／重新授權或以姓名／Email合併身份。

## 已核對的缺口

- 主站scopes已包含openid／profile／email，Authgear discovery有UserInfo endpoint及email／email_verified claims；不是漏設email scope。唯讀aggregate為4個principal的email全NULL，没有取得其完整Email或token。
- 旧provider只讀ID token，只有email且email_verified=true才返回verifiedEmail，未讀UserInfo；Authgear User Management有資料，不保證ID token帶同樣profile。
- admin.begin_access_login插入既有issuer＋subject時DO NOTHING，已核准登入亦未同步profile；即使後來取得Email，舊空值仍可能不補。未取得每位申請人真實token，不能宣稱已觀察每人的實際claim／驗證標記；仍須部署後真人重新登入驗收。

## 修復邊界

- PKCE／state／nonce／signature／issuer／audience／expiry由既有openid-client grant驗證，先validate ID token，再用該登入access token呼叫UserInfo，傳expectedSubject且再次檢查UserInfo.sub精確等於signed ID token.sub。
- identity固定用signed ID token的issuer＋subject；UserInfo名字／Email只是展示metadata，不授予任何scope或角色。UserInfo有Email時優先使用其值，但必須email_verified=true；未提供該欄時才回退到ID token已驗證值。
- UserInfo錯subject／格式或service失敗時登入安全失敗，不保存其他人的metadata；既有callback只記requestId＋固定警告，不打印token／claims／UserInfo原始錯誤。沒有UserInfo endpoint的provider仍以原已驗證ID token資料處理，沒有skipSubjectCheck。
- migration0026新增admin.refresh_verified_profile，僅API runtime可呼叫（server-verified OIDC facade），PUBLIC／worker不能執行。按issuer＋subject與active狀態鎖定既有principal，不新增principal、不更新status／grant version，不修改角色／地區／權限／已存在session／access application版本。
- 正常create_session及待審begin_access_login的callback同交易刷新profile，若刷新找不到active principal則交易失敗。既有DO NOTHING保留，補齊透過新函式完成；沒有把metadata變更當作權限異動。
- 只更新非NULL名稱／已驗證Email；後來沒取到值不清空已知資料。同值不重複audit；真正變更只audit欄位布林，不存原Email／姓名在audit before／after。顯示值是最後取得的已驗證值，不宣稱即時同步Authgear管理Portal。
- 缺資料UI改為「尚未取得已驗證 Email」／Verified email not available，涵蓋缺claim及未驗證情況。

## Schema與驗證

- 完整pnpm verify **486項通過、無skip**，format／lint／source typecheck／build通過；額外全測試tsc仍既有10錯誤、無新增。
- OIDC provider測試涵蓋UserInfo補Email、expected sub／PKCE／nonce／state、unverified／缺verify不提升、subject錯誤與service失敗、invalid ID issuer、不取舊verified Email掩蓋userinfo的新unverified Email、沒有endpoint及profile fallback。
- 受限DB及HTTP測試涵蓋待審／已核准重新登入補Email，審核API名單讀到Email、沒有角色／session／grant revision變更、相同Email不同subject仍不同帳號、NULL保留、malformed原子拒絕、suspended不重啟、unknown issuer／subject不創建、PUBLIC／worker／直接UPDATE拒絕。
- 25→26全表指紋（metadata架構欄位除外）保留、零Email回填、重跑零新增、旧25 API contract及worker gate拒絕26／新26ready驗證通過。歷史升級案例明確用0001–0025 fixture，完整最新chain另驗證0001–0026；沒有修改部署過的0001–0025。
- 新API exact0026_admin_oidc_profile.sql；worker改用ops.admin_oidc_profile_schema_ready／phase-11-admin-oidc-profile。舊ops.telegram_miniapp_schema_ready保持舊25含義，26時false，沒有放寬舊契約。
- 不是真實Authgear Gmail登入驗收或正式快照／站外還原演練。本機mock不等於Provider真人成功；正式還是原25程式。

## 發布與使用

使用者已核准commit／push／部署；需先驗證再切換，不能把核准當作已完成。部署需matching26 API／worker／完整migration artifact、CI、正式25快照及實際還原演練；不能將26 API直接指向25。回復需matching25 DB＋5230f1e API／worker及設定，開流量後另核准並對帳，不能binary-only rollback。

部署後請申請人重新登入Authgear一次，再於審核頁重新載入名單；刷新頁面本身不會再次向Authgear取得profile。已核准人員亦於下一次完整登入同步；不需要刪除／重建principal或重複授權。若仍缺Email，先核對userinfo可用性／email_verified狀態，不能僅因Google登入或Users Portal有Email就跳過驗證。
