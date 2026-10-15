# Qigong Platform — 交接摘要

## 最新本機：繁中／簡中／英文三語化（尚未提交／部署）

- 使用者確認三渠道學員端＋管理後台一併完成。新增zh_CN共用schema／六字典、三向選單與cookie、LINE verified-subject偏好、SDK私密fragment接續、三語bot／回條／提醒／審核通知。語系不推定國家、資格或身份，不回填既有偏好。
- source-owned靜態文案及明確live catalog DTO呈現簡中；姓名／心得／理由／歷史出版快照保留原文。OpenCC僅開發時產生靜態對照，無runtime converter或新依賴；未知自訂名稱保留原名。正式中文條款仍繁中原文並明示，version/hash、同意文件語系與draft狀態不變。
- 新0035／phase-20-simplified-chinese，candidate API exact35、worker ops.locale_schema_ready；歷史0001–0034、package/lockfile及正式環境未動。schema34→35整表原資料指紋保留／repeat0；新binding locale nullable不回填。35不可binary-only退34，後續部署與流量後對帳另核准。
- 獨立PG16完整pnpm verify **721 tests**（API533／DB180／config2／identity6）＋format/lint/source TS/build成功；額外all-test TS仍10既有錯。三渠道簡中整HTML／draft取消、LINE身份／Origin防偽與私人原文、signed TG/WA語系、回條／提醒preview不訂閱、三語review binding／mock OIDC均過。
- 完整重跑曾於55462再現既有learner-privacy停用/channel timestamp constraint間歇失敗；isolated11項過，再以全新PG16／55465完整721過，未改該fixture／constraint／授權斷言，不稱根因已修。最終log為/tmp/qigong-locale-verify-final.log，失敗及isolated證據另留；OpenCC靜態對照可用scripts/generate-ui-zh-cn.mjs --check重現。
- Chrome390/1280×30頁×3語共180布局無overflow／uncaught exception；learner資料/SDK為合成、admin為API失敗shell，不能當真人provider／正常報表載入驗收。簡中靜態文案reference比對僅正式原文條款及語言自名保留繁字。證據/tmp/qigong-locale-*，詳見[三語化與發布界線](docs/operations/trilingual-locales.md)。
- 正式仍d8d4e6679993a018819b790fe608197934045f46／34，TG reminders及review flags既有true，WA未設定／政策draft不變。未commit/push/deploy，未碰Console或傳真人訊息；web-admin-permissions-review.md仍排除。
- **真人驗收更新：**使用者已確認原LINE邀請→小幫手聊天→本人打卡→關頁→同聊天回條完整流程「測試 okay！」；下方舊部署紀錄的待真人驗收文字為當時狀態，新三語介面仍需另驗收。

## 最新部署：LINE邀請核准後聊天交接d8d4e66（同schema34）

- 使用者另核准commit/push/deploy，d8d4e6679993a018819b790fe608197934045f46、CI38737168221／696tests成功；2026-10-15 12:54:02–12:54:21 UTC維護19秒，同34/phase19，只切matching API-worker／drop-in，沒有migration applier。
- 首次核准及原已核准重訪，server驗證後都改固定oaMessage/%40556fjenc小幫手聊天，再本人點練功打卡；mobile SDK external:true只稱已嘗試，保留主按鈕及不經bridge普通link，desktop/external/throws有提示。無direct checkin、auto close/send／message query／任何憑證URL；completed guard返回／retry不重做核准。
- 正式34 snapshot＋roles clone實際還原完整指紋／原592 ready、新舊34都ready；最終站外AESGCM DB/roles/env-systemd decrypt-hash、roles重套／DB實際restore相同／舊ready後切換。contract只有SELECT，75表／17people／23checkins與所有資料及metadata完全一致，quota／身份／同意／通知不回填。
- 新compiled整HTML＋真API/signed mock webhook通過：新加入／pending本人確認／revoked invite原核准重訪、resume／privacy gates／quota2、iOS-Android native參數／desktop-external-throws fallback、plain link、無close/send/secret／return不重寫。Node vm跨realm DTO改用JSON精確值比較，不改產品；舊smoke checkin期待已更新。
- 既有Authgear/admin scopes/grants、LINE/TG/private journal/sourceHash/brand/external revoke、明示心得與legacy private／通知頁雙語save／matching worker(mock)通過，沒有真人測試msg或正式合成資料。只讀bot/info確認fixed chat target Basic ID與憑證相符，Console不動。
- 143主站＋1PNG共144HTTPS checks過、synthetic req.url REDACTED；APIactive/NRestarts0/status0、timeractive、workerResultsuccess/status0，env bytehash及review/learner true、WA unconfigured／policy draft保持。
- 本機Chrome20布局與API SDK皆synthetic，不是真LINE手機切chat／close回條證明。請使用者關舊頁，iPhone/Android從白雁原邀請驗收首次／重訪→小幫手→本人按打卡→關頁查看同聊天回條；自動沒切可用按鈕／plain link，PC不支援、封鎖需解封。
- /root/qigong-deploy-d8d4e66、deployment-tools/d8d4e66、已停rehearsal-d8d4e66與站外分離backup/key保留；臨時env／合成fixture刪，local專用container停。same34可matching592 binary/drop-in退回，不還原DB/env／不覆蓋新寫入。見[部署／恢復／真人待驗收](docs/operations/line-invite-chat-deployment.md)。all-test TS仍10既有錯、flakiness不稱已修；web-admin-permissions-review.md仍排除。

## LINE邀請核准後導小幫手聊天（本機紀錄，後續已部署d8d4e66）

- 使用者確認「已核准重訪」與「首次核准完成」都改：邀請只驗身／資格，固定oaMessage/%40556fjenc開小幫手聊天，再由本人按練功打卡；不再從原白雁邀請頁自動開checkin，避免close回白雁看不到已送小幫手的回條。
- line-invite-page中性入口標題／成功後隱藏表單；SDK初始化且server approved後，僅mobile in-client ios/android openWindow external:true嘗試，void不當成成功。主按鈕重試＋不經bridge普通link，desktop/external/缺bridge/throws提示手動，固定公開URL不帶任何invite/auth/個資、不預填或send指令、不呼叫closeWindow。
- completed guard阻擋返回／retry／重複submit再查詢或redeem，清頁內invite/privacy參照並reset表單；required privacy／資格／alreadyMember/quota等backend未動。無migration／env/Console/通知開關變更，正式仍59241f4／34，未commit/push/deploy。
- 完整pnpm verify成功696（API509／DB179／config2／identity6）＋format/lint/source TS/build，all-test TS原10錯不增。整HTML VM21項涵蓋所有gate/native/fallback/no close/send/no secret URL／重試；Chrome390/1280×10情境共20布局真DOM提交／同意與bridge參數、普通anchor不攔截、zero overflow／exception。
- 全synthetic SDK/backend，測試主動擋普通anchor外連；不是真iOS/Android LINE切chat／關頁來源驗收。/tmp/qigong-invite-chat-*證據，preview/Chrome與獨立PG16 qigong-invite-chat-test／55458完成後停止，原共享cluster未動／既有flakiness不稱已修。
- [設計／官方依據／真人驗收](docs/operations/line-invite-chat-handoff.md)。LINE URL scheme手機支援、不支援PC；openWindow版本差異需fallback，勿立刻close原LIFF。正式發布另核准same34＋matching API-worker；舊smoke預期checkin redirect/「加入並開始打卡」label要調整，別假判失敗；回退可matching592 binary，不還原DB。web-admin-permissions-review.md仍排除。

## 最新部署：共用badge圖示59241f4（同schema34）

- 使用者核准commit/push/deploy，59241f4a389ae58a42812e19481ec0d42f41ed0a，CI38730275543／684tests成功；2026-10-15 12:00:28–12:00:46 UTC維護18秒，同schema34／phase19，只切matching API-worker／drop-in，零migration applier／award批量重算。
- LINE/TG/WA共用49個原LINE bot emoji；原圖示＋非撤銷award正常色彩，無有效award灰階／獨立鎖，未知碼🏅，名稱／規則／年份及撤銷資料不動。Node24整compiled HTML/scripts五種語言渠道各49圖示與狀態通過；VM stub補原HTML monthly hidden狀態後通過，非產品修改。
- 正式34snapshot/roles clone實際還原指紋相同、原9d API ready／新舊皆34 ready；最終站外AESGCM DB/roles/env-systemd decrypt-hash、roles重套／DB實際還原相同後切換。contract只有SELECT ledger/checksum/readiness，無DDL。
- 最終75 application tables／16people／22checkins與**所有資料及metadata完全同指紋**，badge definitions/awards/audit與既有內容／授權／偏好皆未變。準備時21checkins、最終22，未還原成舊快照。env bytehash與review/learner true、WA unconfigured／policy draft保持。
- 受限Authgear/admin scopes/grants、LINE-TG/private journal/sourceHash/brand/external revoke回歸，明示心得跨渠道與legacy private/withdraw／通知頁雙語save／matching worker(mock)通過，全部合成只clone，無真人測試訊息。
- 142主站＋1PNG共143HTTPS checks通過，synthetic req.url REDACTED；APIactive/NRestarts0/status0、timeractive、workerResultsuccess/status0。本機10Chrome layouts×49圖示通過但不是provider真人驗收；請關舊成就頁再開，WA程式共用但未配置。
- /root/qigong-deploy-59241f4、deployment-tools/59241f4、已停rehearsal-59241f4／站外backup/key保留；臨時env／合成fixture已刪。same-schema可matching9d API-worker＋old-release.conf回退，不還原DB/env／不覆蓋新寫入、不重算獎章。見[部署／還原證據](docs/operations/badge-icons-deployment.md)。額外all-test TS仍10既有錯、原共用叢集flakiness不稱已修。web-admin-permissions-review.md仍排除，舊bot dirty檔未動。

## 三渠道badge圖示移植（本機紀錄，後續已部署59241f4）

- 使用者核准本機修改：從qigong-line-bot/schema.sql／migrations005、008複製49種badge emoji至共享badge-icons.ts；季節去_27、combo補_7對齊平台code，舊repo只讀、原dirty docs/.DS_Store未動。
- telegram-workspace-pages共用renderer呈現原圖示＋獨立鎖，無有效award灰階淡化、有未撤銷award正常色彩；原名稱／規則／年度與撤銷文字保留，未知／prototype code🏅安全fallback，textContent／aria-hidden裝飾，不拿icon判斷解鎖或授權。LINE繁中／TG-WA雙語共用。
- 完整pnpm verify成功684tests（API497／DB179／config2／identity6）＋format/lint/source TS/build；新3個mapping tests、VM新6項（5種渠道語言各49卡＋未知碼/XSS），真DB/HTTP catalog49 code皆覆蓋。額外all-test tsc仍10既有錯，無新增。
- Chrome390/1280共10layouts×49卡逐一glyph／earned/grayscale／獨立鎖檢查、zero overflow／runtime exception。driver換頁先等about:blank，避免誤認舊頁ready的測試race，產品未因此改動。全部synthetic SDK/backend，不是真LINE/TG/WA手機交付；WA仍未配置。
- /tmp/qigong-badge-icons-* logs/scripts/10截圖；preview/Chrome已停，隔離PG16 qigong-badge-ui-test／55455完成後停止，原共享cluster未動／flakiness不稱已修。無migration、server schema gate或worker變更，歷史0001–0034／deps不動。
- 正式仍9d00120／34、env／通知開關／policy及獎章資料未動。未commit/push/deploy，另等發布核准；same-schema34 matching API-worker，可binary回9d不還原DB／不重算獎章。見[badge圖示說明](docs/operations/badge-icons.md)。untracked web-admin-permissions-review.md保留排除。

## 最新部署：LINE/TG明示心得分享9d00120／schema34

- 使用者另核准commit/push/deploy，9d00120484f0ef46ba83ed65166c1ac176a60e4d，CI38719995438成功／675tests；正式2026-10-15 10:32:13–10:32:30 UTC維護17秒，33→34／reapply0，matching API-worker exact34／phase19。
- 表單明示「打卡心得供所有學員閱讀」、無分享checkbox／私密標題，新版notice下新心得同TX刊登，空白不刊登；舊私人／撤回及手動設定保留，WA／external opt-in不變。沒有代寫正式心得、回填同意、發布draft政策或批量公開。
- 原共用叢集問題後先按上限停止，後續核准改全新隔離PG16／55454完整675（API488／DB179／config2／identity6）＋format/lint/source TS/build通過，未改斷言或正式授權；CI exact SHA亦過。原flakiness根因不稱已修；額外all-test TS仍原10錯。專用本機container已停，原55440未動。
- 正式33snapshot＋roles clone實際還原完整指紋／4aa API ready，34升級／舊gate拒絕；最終站外AESGCM DB/roles/env-systemd逐一decrypt-hash、roles重套／DB實際還原相同／舊33ready後才主站migration。
- 原74 application tables／16people／21checkins與全非metadata指紋保留，新origin表空；兩份env bytehash不變、review/learner flag true、WA unconfigured／policy draft。新release clone真API驗收LINE/TG跨地區互讀、空白／retry／清空／重寫、legacy private與withdraw不重發、external off／private helper拒絕，matching worker(mock)不發心得；通知頁整HTML雙語真API保存亦過。
- 139主站＋1PNG共140HTTPS checks成功，synthetic req.url REDACTED；APIactive/NRestarts0/status0、timeractive、workerResultsuccess/status0。本機Chrome12頁通過但非真人LINE/TG交付；請關舊頁，以新日期或原無心得記錄寫新心得，由另學員驗收。舊私人要本人另發布。
- /root/qigong-deploy-9d00120、deployment-tools/9d00120、已停rehearsal-9d00120與分開站外backup/key保留，clone臨時env/合成fixture已刪。34不能binary-only回33，需matching33DB＋4aa38f1 API-worker與流量後對帳；見[部署／還原證據](docs/operations/community-note-sharing-deployment.md)。untracked web-admin-permissions-review.md仍排除。

## LINE/TG明示心得分享（本機／候選紀錄，後續已部署9d00120）

- 使用者確認邀請已成功。新要求已核准本機：LINE與Telegram表單明示「打卡心得供所有學員閱讀」、無分享checkbox、不想分享留白。正式仍4aa38f1／33，沒有任何正式寫入／批量公開／env、Console或通知開關變更；private web-admin-permissions-review.md仍保留排除。
- 調查時6筆LINE非空心得（全渠道9）、publications0、active policy0／acceptances0；管理端私人紀錄不等於已刊登。新notice是當次內容分享，不回填／冒充LINE網站同意或發布draft政策。
- 新0034 forced-RLS core.community_note_origins＋transactional community_workspace_save：LINE/TG新版帶notice version後新心得同TX刊登，空白不刊登、external FALSE。只有練功的舊記錄可本人首次新寫心得；原有私人文字／加notice重試不會被公開。新自動心得可更新／清空；本人手動分享／撤回優先，不被save/replay重發，版本及當前note對上才刷新快照。
- 新API exact34／worker ops.community_notes_schema_ready／phase19；33→34保留舊私人note及全非metadata指紋，新表空／forced RLS、重跑0／舊gate拒絕。0001–0033／deps／lockfile不改。WA、legacy沒有notice的client與external opt-in保持，不繞過必要同意／reflection gates。
- 新DB16＋HTTP2＋VM5項均通過，source TS／format/lint/build通過，額外all-test TS仍10既有錯。Chrome390/1280 LINE繁中/TG雙語打卡＋feed12頁真DOM保存與心得顯示通過，note卡無checkbox／無私密標題、zero overflow／exceptions。SDK/backend synthetic，未實測provider；preview/Chrome已停。
- **歷史驗證阻礙（後續已有獨立乾淨叢集675通過）：**中間673曾過；增加privacy2項與修正畫面後完整回歸先後遇WA timezone400、TG miniapp channel valid_to時間戳constraint、journal source conflict測試先遇practice identity unavailable。WA/TG單獨重跑過，journal最後未再重跑，根因未確認；該輪3次上限後停止。使用者後續明確核准commit/push/deploy；改用全新獨立PostgreSQL16／55454，完整675（API488／DB179／config2／identity6）及format/lint/source TS/build成功，未改授權條件或測試斷言。此結果不證明原共用叢集flakiness根因已修復。新fixture曾TG身份setup失敗，已明示合成active channel一天前／assert ready，該suite現通過，但不當作其他問題根因修復。
- 證據/tmp/qigong-community-notes-*，詳見[設計／測試阻礙](docs/operations/community-note-sharing.md)。已獲後續發布核准，獨立乾淨叢集完整驗證成功，進行exact CI、正式33備份實際還原與matching34 API-worker；34不可binary-only回33，流量後對帳含新心得／分享／撤回狀態。

## 最新部署：LINE邀請接續4aa38f1／schema33

- 使用者核准commit/push/deploy，程式4aa38f1709222e2f38b72f51c97bb8923f7f8d64，CI38677398987成功／651tests。正式2026-10-15 03:47:26–03:47:44 UTC維護18秒，32→33/reapply0，API-worker matching exact0033／phase18。
- 原73 application tables／12people／17checkins與全部非metadata指紋保留、新context表空，無批核／同意回填／invite扣額；兩份env bytehash不變，review與learner flag true、WA unconfigured／policy draft。
- 正式32snapshot＋roles clone實際還原指紋相同／8e API ready，33升級／舊gate拒絕；最終站外AESGCM DB/roles/env-systemd逐一decrypt-hash、roles重套／DB實際還原相同與舊32ready後才主站migration。
- 新release受限compiled整HTML＋實API/signed follow通過：early-follow無manual link、本人resume／無fragment reload／資料confirm後approved／history200，第二synthetic pending本人有效invite確認approved／manual downgrade409、quota精確2、zero新invite review event；全部只clone，沒有正式合成申請或測試msg。通知頁中英雙勾真API保存與matching worker(mock)正常。
- 136主站＋1PNG共137HTTPS checks通過，synthetic req.url REDACTED，APIactive/NRestarts0/status0、timeractive、workerResultsuccess/status0。普通加入仍人工審核，拒絕／停用等不恢復；現有pending需本人再開原邀請確認資料，不因deploy批核。真人LINE圖文選單一路打卡驗收待完成。
- /root/qigong-deploy-4aa38f1、deployment-tools/4aa38f1、已停rehearsal-4aa38f1與分開站外backups/key保留。33不能binary-only回32，須matching32DB＋8eaaa9b API-worker與流量後寫入對帳核准；不保證in-flight召回或OS/Caddy災復。見[部署／恢復](docs/operations/line-invite-continuation-deployment.md)。原untracked web-admin-permissions-review.md仍排除。

## LINE邀請加好友接續／pending本人確認（本機紀錄，後續已部署4aa38f1）

- 使用者先修正、尚未核准commit/push/deploy。正式仍8eaaa9b／0032，root現有資料、邀請、三筆待審、env／通知flags完全未改；untracked web-admin-permissions-review.md保留排除。
- 已查正式invite uses/redemptions皆0，最近LINE申請為一般pending並產生合法review通知，但無真人click trace，不推定使用者點錯。缺口：follow曾直接回一般/apply，而且OAuth可在邀請頁驗證身份前follow；SDK清fragment後reload缺server接續。
- 新0033（歷史0001–0032不改）forced-RLS subject-bound15min hash-only continuation；signed follow/加入/打卡導原邀請，early-follow無context改提示回原邀請、不發普通申請URL。缺fragment先以verified ID token接續本人；明確錯token不降級。server friend驗證／privacy／issuer／quota／region照舊。
- 原pending本人持有效invite，重填確認資料＋邀請region後，鎖後原UUID原子轉approved、建person/identity/channel、耗額度一次／正常approval outbox；未操作不自動核准，rejected/suspended/revoked/已linked保護保留。未送pending/sending reviewer deliveries取消／歷史sent保留，不保證召回in-flight。
- 舊普通form/API/SQL防downgrade，有有效context回409導回invite確認；resume跨subject無效、期限不滑動，等待原pending row後再查resume expiry；成功清context，過期按index每次最多100 SKIP LOCKED清理。原共享invite可轉傳，resume僅本人，不混淆兩種capability。
- API exact0033／worker ops.line_invite_continuation_schema_ready()、phase-18-line-invite-continuation。32→33指紋／所有原資料不動、新表空、重跑0、舊gate拒絕；31→32歷史測試固定chain到32。
- pnpm verify2成功651tests（API481／DB162／config2／identity6）、format/lint/source tsc/build。額外all-test tsc仍原10錯（新測試optional型別已修，不新增）。第一輪既有onboarding.test兩項間歇permission denied，target及verify2重跑通過但未修根因，不宣稱已修既有flakiness。
- HTTP/signature/DB實際測試friend→resume→基本資料→approved→history200、zero新review event；VM整HTML／script與Chrome390/1280真DOM submit、清fragment reload、visibility返回、pending確認、checkin跳轉，zero overflow／exception，全部syntheticprovider，不是真LINE交付驗收。/tmp/qigong-line-invite-continuation-*證據，preview/Chrome已停。
- 見[接續設計與發布限制](docs/operations/line-invite-continuation.md)。未代學員批核、發測試訊息、動Console／政策／env；33發布需另核准exact CI、加密備份實際還原與matching API-worker，不能binary-only回32。待本人手機重開原邀請做端到端驗收。

## 最新部署：通知頁locale與checkbox修復8eaaa9b（同schema32）

- 使用者核准commit/push/deploy，程式8eaaa9b370addd45211fa7c848cf1e1d60d2e51e，CI38665560311成功／636tests。正式2026-10-15 01:34:07–01:34:23 UTC維護16秒；只切UI binary，schema32／phase17不變，未run migration applier，僅ledger/checksum/contract read驗證。
- 正式32snapshot＋roles實際clone還原、全部data/metadata/fingerprints相同，原8f98da9与新API皆ready；compiled受限admin/Authgear/scope/grants/LINE-TG/journal/brand/sharing與worker(mock)通過。新smoke執行真compiled HTML/script、fetch bridge打真实API，zh/en兩次save的兩項勾選与locale均正確、无global locale注入，scopedflex存在；real DB driver需等待IO completion後再提交，已補等待，不將未dispatch視產品失敗。
- 最終站外AESGCM DB/roles/env-systemd逐一decrypt-hash、roles實際重套/DB实际还原相同／原API ready才切主站；原73表／12people／16checkins、完整metadata與bindings/prefs/events/deliveries/grants/sessions全部原樣。無正式合成設定或真人測試msg。
- 135主站＋1PNG共136HTTPS checks通過，actualsynthetic req.url REDACTED；APIactive/NRestarts0/status0、timeractive、workerResultsuccess/status0，review与learner reminder true、WA unconfigured／policy不變、兩份env bytehash相同。
- 636本機/CI与390/1280雙語4Chrome layout及form save證據保留，現請管理員關舊頁重開/admin/notifications勾2項保存与本人測試作真人驗收；未代儲存任何正式偏好。
- 恢復/root/qigong-deploy-8eaaa9b、deployment-tools/8eaaa9b、已停止rehearsal-8eaaa9b、受限backups/deployment-8eaaa9b與独立key保留。同schema32可matching8f98da9 API-worker＋old-release.conf回退，不還原DB/env或覆寫新prefs，會恢復舊bug，仍需發布核准。見[review-notification-ui-fix-deployment](docs/operations/review-notification-ui-fix-deployment.md)。原untracked web-admin-permissions-review.md仍排除。

## 通知設定locale錯誤與checkbox排版（本機修復紀錄，後續已部署8eaaa9b）

- 使用者回報勾選2類保存出locale not defined與checkbox文字上下排列，確認本機修復。原因shell adminLocaleScript的locale在shell IIFE内，而page script附在外部；頁面独立IIFE＋source-controlled const locale，修正save/disconnect/events path；global label display:grid原繼承造成checkbox換行，新notify-option flex scoped至#notify-preferences、input固定不縮＋span可wrap、44px觸控行，不改共用label。
- 新tests/review-notification-page.test.ts7項執行實際完整HTML/script，不注入locale（以免mask bug）：zh/en渲染events與雙勾save含正確locale/CSRF、disconnect、失敗保留勾選、binding confirm與test、scoped markup。全636tests通過format/lint/sourceTS/build；額外all-test TS既有10錯誤。
- Chrome390/1280雙語4布局通過，實際form requestSubmit確認兩checkbox保存且locale正確、first-line上下差<=6px／checkbox與span左右同列、零水平溢出／runtime exception；synthetic backend無正式資料。screenshots與preview/cdp /tmp/qigong-review-page-fix-*保留，Chrome與preview已停止。
- 只改admin-review-notification-page.ts＋新增VM tests，無migration/role/binding/prefs/runtimeenv或發送開關變更，主站仍8f98da9/schema32、review/learner reminder flag true、WA unconfigured／policy draft。未commit/push/deploy，发布另核准；同schema UI回退可matching API-worker release切換，不需DB還原。原untracked web-admin-permissions-review.md仍排除。證據/tmp/qigong-review-page-fix-{verify,all-types}.log。

## 最新運維：待審通知發送已啟用（2026-10-15 01:04 UTC）

- 使用者另行明確核准啟用REVIEW_NOTIFICATIONS_ENABLED。只原子設worker.env此flag=true，其他bytes／640權限／owner-group保留，API.env hash不變、learner reminder true与WA unconfigured保持；未改角色、個人通知偏好或綁定。
- 停timer並drain worker後換env，compiled flag verifier true，matching32 worker Resultsuccess/status0、API/timer active、每分鐘下一觸發已排；actual review_notifications_processed0。當時1個pref／1個bound／0個opt-in、delivery0，所以沒有發出任何新通知。
- 管理員需在/admin/notifications勾選管理員申請／學員申請並保存，或主動按本人測試；即使globalon仍每批按current審核scope/pending/versions重查。不要替所有管理員批量訂閱，不把學員身份合併到principal。
- 受限原worker.env backup／change.json／API.env hash證據/root/qigong-review-enable-20261015T010410Z保留；停發另核准只改此flagfalse，不覆蓋後續其他env配置。部署程式仍8f98da9/schema32，下面「發送關閉」是18:04部署當時歷史紀錄。

## 最新部署：Telegram私人待審通知8f98da9／schema32（發送開關未啟用）

- 使用者核准commit/push/deploy。程式8f98da918b5b951a5360479ba4a56dce3bc1af7b、CI38610844698成功／629tests。正式2026-10-14 18:04:21–18:04:39 UTC維護18秒，只套0032/reapply零新增；原69表／12people／16checkins及所有非metadata指紋保留，新四表空，无historical events／binding／opt-in／role或consent回填。
- 正式31clone與roles實際還原、完整指紋一致、旧fee82baAPI ready／32upgrade/reapply通過；最終站外AES-GCM DB/roles/env-systemd逐一decrypt-hash、roles設定重套＋DB实际clone還原相同／旧31ready才正式migration切换。歷史migrations與deps不變。
- compiled受限admin/Authgear verified profile與grant revision/LINE-TG/journal/sharing/brand/scope、新雙向private binding/group deny/CSRF/revision/default opt-out/last4 mask/complete learner event/noPII-state/test rate通過；僅隔離worker override review=true且mock送2組/3 deliverysent，無真人msg、正式bind或合成申請。
- 135主站＋1PNG共136HTTPS checks通过，通知頁/admin/notifications/routes已註冊、guest302/API401寫入拒絕；actualsynthetic req.url REDACTED。APIactive/NRestarts0/status0、timeractive、workerResultsuccess/status0，exact32/ops.review_notification_schema_ready true／旧31gatefalse。
- **正式REVIEW_NOTIFICATIONS_ENABLED仍缺省false**；部署未開發送、未批量綁定或訂閱。learner reminders true保持、WA unconfigured／policy draft，env兩份bytehash、webhook/BotConsole/credentials未改。個人可登入通知頁自行產指令→Bot私聊取6位碼→後台確認→opt-in；要实际alert／test另核准开启review worker flag。
- 恢復/root/qigong-deploy-8f98da9、deployment-tools/8f98da9、已停止rehearsal-8f98da9、站外受限backups/deployment-8f98da9和独立key保留。32→31需matching31DB＋fee82baAPI-worker與old-release.conf，不可binary-only；流量後另核准对帳events/bindings/prefs/delivery與其他寫入，不保證OS/Caddy或in-flight recall。見[review-notification-deployment](docs/operations/review-notification-deployment.md)。
- 原untracked web-admin-permissions-review.md持續排除，既有間歇性回歸不稱已修復。下方candidate为發布前紀錄，以此部署段落為最新狀態。

## Telegram管理員私人待審通知（本機實作紀錄，後續已部署32、發送未啟用）

- 使用者核准先用Telegram私聊主動通知新管理員與完整新學員申請。新0032四forced-RLS tables(preferences／hashed link challenges／events／deliveries)，无runtime直接表權限、无历史pending回填／自動綁定／opt-in／授權或person合併。現有申請人核准/拒絕outbox保持，LINE invite直接approved不產待審事件。
- /admin/notifications由正常Authgear session、CSRF/Origin發起10min高熵指令；private signed Telegram /admin_notify token取得server HMAC6位碼，仅hash储存，仍需本人后台登录+正确码+revision最后确认。5錯失效、wrong-attempt commit不会rollback，subject不能綁多個principal，新begin撤舊challenge但不改原binding。通知type默认off；save opt-in、language、本人test5min limit／10minexpiry、disconnect cancel unsent，無姓名/email/phone推定綁定。綁定command在learner privacy gate前處理，仅验证private chat.id=from.id非Bot，不要求同時為learner；无group alert。
- 事件admin draft/rejected→pending version、student資料完整pending（骨架/登入/metadata刷新/重試不發），pending改region產新scope且旧event失效；role/grant期限、can_manage_access_target（Master request僅Super／self不審）、can_review_application依原授權動態算，private owner probe set principal後始終restore。queue/claim/pre-send重查pending/version/region/grants/binding/prefs revision，處理/撤權/停用/改區/解绑取消，explicit newprefs revision可重queue cancelled但sent不重复。
- 私聊僅kind/region/筆數與正常HTTPS admin登入入口，无name/email/phone/reason、token link或chat approval。個人state只masked last4、scope pending/unrouted/failed、最近20事件，無收件人不丟棄。worker REVIEW_NOTIFICATIONS_ENABLED可選defaultfalse，true才queue200／最多5 merged50-event leases並行、30sec merge wait／2minlease／5secHTTP／8 retry backoff<=15min；不能召回inflight或承諾exactly-once。mainenv未改／无真人訊息。
- 全套629tests（DB156/API465/config2/identity6）通过format/lint/sourceTS/build；extra alltest TS既有10错误，新檔無新增。DB11/API7/brand新頁覆蓋双向码/hashed secret/CSRF/body impersonation/private signed/group deny/opt-in off defaults/scope/Master/resolved-region move/invite-no-review/context restore/last grant expiry/lease/retry/sent dedup/101 burst50-50-1/test rate/noPII；31→32upgrade/reapply全部非metadata oldrow hash保留，四表空，旧API/worker拒絕、新ready。mock非真人送達。
- API exact0032_review_notifications.sql／worker ops.review_notification_schema_ready／phase-17-review-notifications，歷史0001–0031／依賴未改；主站仍fee82ba/31，learner reminder flag true／WA未配置／policy draft，未commit/push/deploy/正式通知開關或Bot Console修改。見[review-notifications](docs/operations/review-notifications.md)，證據/tmp/qigong-review-notifications-{verify-final,all-types-final}.log；发布/flag activation另核准、正式31clone／最终加密备份实际还原／matching API-worker及管理員真人綁定驗收。32回31需matching31DB＋fee82ba，不可binary-only；原untracked web-admin-permissions-review.md仍排除。

## 最新部署：LINE已驗證暱稱fee82ba／schema31

- 使用者核准commit/push/deploy并要求continue。初版5278dae未部署，隔離smoke抓到SSR仍留「代號遮罩」與新JSON說明不一致，修正＋新增測試後部署fee82bab37d84bb1d0a9cde259bdc797fc1460b5；CI38527337097成功／609tests。
- 正式2026-10-14 07:27:56–07:28:20 UTC維護24秒，只套0031／reapply零新增，原68表／11people／14checkins及所有非metadata列fingerprint保留，新line_verified_profiles cache空，无申請姓名／consent／角色回填。profile為provider verified metadata，不匹配／合併身份、改person/application/grants/sessions/publications或scope。
- 正式30clone＋roles實際隔離還原、舊e2e9a4b ready／31upgrade/reapply/data compare通過；corrected CI-watch＋prepare timeout只partial clone fixture，检查无process后从原30dump reset并全部重驗，未动主站。compiled admin/Authgear/grants/LINE-TG/journal/sharing/brand/scope、新own verified name／anonymous非法姓名fallback／更新与缺值保留／LINE feed name＆TG alias／client spoof拒絕及SSR修正通過，mock worker/reminder正常，零正式fixture/profile修改或真人測試發送。
- 最終站外AES-GCM DB/roles/env-systemd逐一decrypt-hash，roles實際重套与DB實際還原指紋相同、舊30API ready才正式migration切換。128主站＋1PNG共129HTTPS checks通过，实际synthetic req.url REDACTED；APIactive/NRestarts0/status0、timeractive、matching workerResultsuccess/status0，exact31/newops.line_profile_schema_ready true／旧30gatefalse。
- 两份env hash不變，Telegram reminder true／WA unconfigured／activepolicy0；LINE Console/LIFF/richmenu/憑證/政策未改。學員關舊頁重開LINE即可本人的可信name更新；尚未回訪或provider沒name仍匿名，不批量取profile、不用申請姓名補。真人name claim驗收待完成。
- 恢復/root/qigong-deploy-fee82ba、deployment-tools/fee82ba、已停止rehearsal-fee82ba、站外受限backups/deployment-fee82ba与独立key保留；未部署5278dae/clone故障證據保留。31→30需matching30DB＋e2e9a4b API-worker与old-release.conf，不能binary-only、開流量後另核准對帳；非完整OS/Caddy災復。見[line-profile-deployment](docs/operations/line-profile-deployment.md)。
- 原untracked web-admin-permissions-review.md仍排除，既有間歇性回歸不宣稱修復。以下candidate段落為發布前記錄，最新狀態以上方為準。

## LINE排行榜／心得流已驗證暱稱（本機實作紀錄，後續已部署31）

- 使用者確認實際排行榜顯示學員＋number（原同地區mask），要求LINE作者在心得流用LINE暱稱；本機同時改LINE leaderboard與LINE journal stream。只從LINE官方ID token verify回覆取name，sub/aud/exp/iss驗證後存verified metadata，不相信browser displayName、申請姓名或Email/phone，不做姓名matching／身份合併或權限變更。
- 新0031 line_verified_profiles forced-RLS／API-only refresh facade，identity UUID FK、name／verified_at；active person／未撤銷LINE identity才更新，unlinked false。只changed auditboolean不記name/token；current verified claims沒name不清空既有值、profile DB failure泛化warn不將metadata當認證。每次學員重開LINE頁面可刷新本人，舊學員未回訪前匿名，新加入導向checkin時再寫，不批量取profile／不回填自述姓名。
- LINE同地區原排名／days／30上限保持，label已驗證暱稱+self（你），缺名匿名學員，不用hash或raw ID；LINE stream只改LINE identity作者alias，TG/WA作者保留share alias。舊community/staff/external/user publication aliases不變。My-sharing label指出alias用於其他渠道／external；LINE UI說明已驗證LINE暱稱，不宣稱申請姓名等於LINE profile。
- private public-name getter未grant runtime，作者inactive／revoked／必要政策required不回nick；reader仍按必要consent／資格授權。使用者稱已同意不等於本機代接受所有人同意，沒有改policy文件／版本／發布draft／回填consent。
- 最終完整608tests無skip，format/lint/sourceTS/build通過；extra all-test TS既有10錯誤。verifier12+DB/HTTP7+30→31upgrade1包含scope/subject/exp/issuer／name malformed／provider泛化、server nickname與anonymous／變更＆缺值保留／oldperson-identity-application-grants不變／audit無重複／跨渠道alias＆oldfeed保留／runtime denied／inactive與author缺必要consent保護；30→31各old非metadatarow hash保留、cache空、无申請姓名或角色回填，新舊API-worker gate匹配。mock不是LINE真人name驗收。
- API exact0031_line_verified_profile_names.sql／worker ops.line_profile_schema_ready／phase-16-line-profile-names，歷史0001–0030／依賴未改。主站仍e2e9a4b／30，reminder true／WA unconfigured／policy draft；未commit/push/deploy／Console或env改動。見[line-profile-names](docs/operations/line-profile-names.md)，證據/tmp/qigong-line-profile-{verify-final,all-types-final}.log。發布另核准、正式30clone／最終加密備份實際還原／matching API-worker後，由學員再開LINE頁面驗收name；31回30需matching30DB＋e2e9a4b，不可binary-only。原untracked web-admin-permissions-review.md仍排除。

## 最新部署：LINE手機心得流e2e9a4b／schema30

- 使用者核准commit／push／部署。程式e2e9a4baaa6d4c109360bbe3bf1edc98ca7f39c4、CI38491423796成功／588 tests。正式2026-10-14 00:47:23–00:47:41 UTC維護18秒，只套0030／重跑零新增，原68表／11people／14checkins與全部非metadata列指紋保留，無新tables／資料回填。
- 正式29clone＋roles實際隔離還原、指紋相同、舊0410e5f API ready／30upgrade／repeat通過；最終站外AES-GCM DB/roles/env-systemd逐一decrypt-hash，roles設定重套與DB實際還原、完整相同／旧29ready才正式切換。
- compiled受限admin/Authgear verified profile與grant version/LINE-TG/journal/share撤銷/brand/scope與cursor10/keyset/asof25-26/historyRegionTime/noPrivateSource/old20/ownEditor保留通過，matching worker(mock)正常；只有隔離合成資料，無正式fixture、真人測試訊息。
- 126主站＋1PNG共127HTTPS checks通過，LINEjournal stream/sentinel/loadmore/stats/publish sourceHash已生效，malformed cursor rejected；實際synthetic LIFF query req.url REDACTED。APIactive/NRestarts0/status0、timeractive、workerResultsuccess/status0，exact30／ops.line_journal_stream_schema_ready true／舊29gatefalse。
- 两份正式env hash不變、Telegram reminder flag true保留、WA unconfigured／policy draft；richmenu/LIFF/Console/憑證未改。請從LINE richmenu重新開journal測首10＋lazy10／longtext／統計／我的心得草稿；只讀目前允許的share snapshot，真人手機／SDK驗收仍待完成。
- 恢復/root/qigong-deploy-e2e9a4b、deployment-tools/e2e9a4b、已停止rehearsal-e2e9a4b、站外受限backups/deployment-e2e9a4b與独立key保留。30→29需matching29DB＋0410e5f API-worker及old-release.conf，不可binary-only、開流量後另核准對帳；不是完整OS/Caddy災復。見[line-journal-stream-deployment](docs/operations/line-journal-stream-deployment.md)。
- 原untracked web-admin-permissions-review.md仍排除，既有間歇性回歸不稱已修復。以下候選段落為發布前實作紀錄，最新狀態以此部署段落為準。

## LINE手機心得流10筆cursor／lazyload／as-of統計（本機實作紀錄，後續已部署30）

- 使用者確認先只改LINE journal feed，保留我的心得20筆編輯／sourceHash-version／草稿與其他渠道／staff／external API。新0030新增platform.line_journal_stream(subject,cursor) facade，當前可見share作者alias＋歷史checkin地區／date／提交及分享時間與IANA timezone、截止practice_date的currentStreak／totalDays、published notes／methods／tags；不回person/identity IDs、原私密note或逐日history。聚合可包含未分享練功的日期數量，但不回日期／內容；LINE分享help／mine help／publish confirm明示新增公開aggregate，政策未發布／hash未改。
- first cursor:null→10rows，keyset published_at＋UUID（equal timestamp不重複）、server upper boundary、每輪候選11／計數最多10，nextCursor／hasMore；cursor strict／future拒絕／30min到期須refresh，每批viewer與author資格／consent／active-share再查。非MVCC snapshot，撤回作者與新publishes影響後續讀取，已讀不能立即召回；非cursor舊LINE page仍20。
- LINE限定手機單欄，統計兩格、功法／感受換行、160codepoints長文preview＋details原文、Intl按record timezone；memory-only cursor與ID deDup，IntersectionObserver300px、單request、15秒deadline、generation＋Abort，network保留cards同cursor retry／停止observer避免自动错误循环、auth清cards、expired顯示reload、empty/loading/done與手動fallback；reset回頂／render後補查sentinel避免loading時交叉事件漏掉，mine切換仍busy-dirty確認。
- 最終完整588 tests無skip／format-lint-sourceTS-build通過；額外all-test tsc既有10錯誤。API7（10/10/5、asof25/26、historyRegion、upper-bound／refresh、withdraw／suspended／reader consent、old20/worker denied）、VM10（single request／append dedup／render-after-intersection／stale abort／error／auth／longtext／mode preserve）、29→30fingerprints与旧facade functiondefs不變、新舊ready通過。
- Chrome合成SDK/API三布局390/430/1280通过：initial10＋lazy10＋last3、zero duplicate、long note不溢出、mine/feed切换；修正漏掉loading期間intersection的續載问题，刷新重設頂端。不是真人LINE或正式HTTPS验收，preview及Chrome停止，screenshots/scripts /tmp/qigong-line-stream-*。
- 仍碰到既有間歇性LINE403／TG badges response缺欄位／onboarding permission denied／reminder claim0；targeted与最終588verify通过，不稱rerun是修復。保留viewer lookup/status/channel-age/consent診斷，失败logs /tmp/qigong-line-journal-stream-verify{,-final,-latest}.log、成功最後verify-last.log与all-types-final.log。fixture date+unknown首次失敗造成的6個line-stream-test DB按deployed_by清理，已用resource cleaners防洩漏，不碰其他DB。
- API exact0030／worker ops.line_journal_stream_schema_ready／phase-15-line-journal-stream，無新增tables／old rows變更，歷史0001–0029與依賴未改；主站仍0410e5f／29、TG提醒flag true／WA unconfigured／policy draft，richmenu/Console/env未改，未commit/push/deploy。見[line-journal-stream](docs/operations/line-journal-stream.md)。发布另核准，正式29clone／最終加密備份實際還原／matching API-worker後真人測試；30回29需matching29 DB＋0410e5f，不可binary-only且流量後需對帳。原untracked web-admin-permissions-review.md保留。

## 最新部署：LINE邀請預核准0410e5f／schema29

- 使用者核准commit／push／部署。程式0410e5fee4ef2cf3964ab8ef4a196904a1f4e069、CI38351901085成功／570 tests；正式2026-10-13 05:42:59–05:43:16 UTC維護17秒，只套0029並重跑零新增。原66表／11people／13checkins及全部非metadata列指紋保留，新invite／redemption表空，無正式邀請或自動核准回填。
- 正式28clone及roles實際還原，28→29upgrade／reapply、舊79825b9 ready／新gate匹配通過；最終站外AES-GCM DB／roles／env-systemd逐一解密hash、roles設定實際重套＋DB實際還原，完整相同／舊API ready才切主站。原歷史migrations與依賴未變。
- compiled受限admin／Authgear profile／grant revision／LINE-TG／journal／sharing／brand／scope及邀請管理雙語／CSRF／one-time hash secret／server friend／quota並行最後一位／重試／撤銷與舊資格通過；mock worker驗證核准通知。僅隔離合成資料，沒有正式新learner／admin session／client或真人測試發送。
- 主站124＋1PNG共125HTTPS checks通過，/line/invite200、Super管理入口/admin/line-invites、guest管理302/API401、Origin/schema拒絕正常；real synthetic LIFF probe req.url REDACTED。API active/NRestarts0/status0、timeractive、workerResultsuccess/status0，exact29／ops.line_invite_schema_ready true、舊28gatefalse。
- 兩份env hash不變，Telegram reminders flag true保留、WA unconfigured／policy draft。LINE Console／openid-profile scope／correct linked OA未改，friendship是mock而非真人驗收，配置不足fail closed；學員可由Super建立1人邀請做真人測試。
- 恢復/root/qigong-deploy-0410e5f、deployment-tools/0410e5f、已停止rehearsal0410e5f、站外受限backups/deployment-0410e5f與獨立key保留。29→28需matching28DB＋79825b9 API-worker與old-release.conf，不可binary-only；流量後另核准對帳新身份／額度／通知／reminder寫入，不保證OS-Caddy災復。
- 詳見[line-invite-deployment](docs/operations/line-invite-deployment.md)。原untracked web-admin-permissions-review.md持續排除；既有間歇性回歸未宣稱修復。下列候選段落是部署前實作記錄，最新狀態以上方為準。

## LINE邀請網址＋token自動核准（本機實作紀錄，後續已部署29）

- 使用者確認本機實作：新學員先驗證LINE身份／加好友／必要同意再填基本資料，自動核准；已有有效approved LINE identity重開入口直接configured LIFF checkin，不查邀請expiry／quota／revocation／issuer、不耗額度。pending／rejected／suspended／linked-but-ineligible不覆蓋，不批量核准舊申請。一般加入仍人工審核，Name／Email／phone不查找或合併身份。
- 新0029新增hashed invitation與redemption forced-RLS兩表，Super-only建立／列出／帶revision與reason撤銷，預設tw-general／7天／100人，可配置1–30天／1–10000。raw256bit token只在建立時回LIFF/invite#token一次、列表與audit不含秘密；共享bearer转傳可讓非指定人加入，需期限／quota／撤銷，非指定名冊證明。issuer失去Super則新加入失效，舊學員自有資格不受影響。
- Global grant／subject／invite locks、post-lock expiry／issuer／region／privacy重查，atomic建立person／LINE identity／primary region／active interaction／approved application／redeem／counter與標準決策通知；無admin roles。普通LINE submit同subject lock防交錯。
- 新/line/invite/status與redeem嚴格body／Origin，每次ID token服務端驗證；新加入者access token client_id／exp、profile userId與verified sub精確匹配、server friendship boolean true。LIFF Console需openid＋profile、Login channel與正確Messaging bot同Provider且linked OA；缺配置或provider故障fail closed，未改Console。
- privacy proof用channelSecret HMAC per-subject／5min桶產生15min獨立證明，不用共享invite；URL只存邀請cap，SDK init完成後清URI，memory-only；必要同意預設unchecked／version-hash／reflectionfalse，不發布draft或開分享。新學生頁、Super雙語brand管理頁與capability nav／CSRF沿用原admin session。
- API exact29／worker ops.line_invite_schema_ready／phase-14-line-invites。28→29合成upgrade與reapply原表指紋完全相同，新2表空；零新邀請／自動核准／reminder變更，舊API／worker gate拒絕，新ready。歷史0001–0028未改，依賴／license／正式settings未改。
- 完整570 tests無skip、format／lint／source typecheck／build通過，額外all-test tsc仍既有10錯誤、新檔無新增。DB9／HTTP與friendship9／VM7、brand新增頁、quota並行／issuer等待／被撤销账户／独立同意／既有有效身份與manual path通過；mock／VM不是真人LIFF或加好友驗收。
- 本輪仍觀察到既有privacy practice-identity-unavailable、TG menu缺buttons與reminder batch0的間歇性回歸；targeted與最終verify通過，不宣稱rerun修復。保留無PII的ready／privacy-required／channel-age／job-count／expiry診斷供下次重現；一次fixture遺漏randomBytes造成cleanup失敗的6個invite-http測試DB已按deployed_by標記清理並加cleanup guard，不碰其他資料。
- 主站仍79825b9／28、Telegram提醒flag true、WA disabled／policy draft；未commit／push／部署、未建立正式邀請、未改LINE Console或憑證，原untracked web-admin-permissions-review.md保留。見[line-invites](docs/operations/line-invites.md)，證據/tmp/qigong-line-invites-{verify-final,all-types-final}.log；發布另核准、正式28clone／最終加密備份實際還原／matching API-worker与真人驗收。29回28需matching DB＋79825b9，流量後對帳新授權／額度／通知，不可binary-only。

## 最新運維：Telegram提醒排程已啟用（2026-10-12 17:59 UTC）

- 使用者另行明確核准啟用Telegram提醒。只將protected notification-worker.env的TELEGRAM_REMINDERS_ENABLED設true，其餘bytes／640權限／owner-group保留；API.env hash不變，WhatsApp仍未配置。未改學員提醒偏好、未發布政策、未改程式或schema。
- 暫停timer並等待worker結束，atomic換env後驗證compiled flag=true，執行matching28 worker成功並恢復每分鐘timer；API/timer active，worker Resultsuccess/status0，實際日誌telegram_reminders_processed0。當時setting0／enabled0／jobs0，沒有任何測試或批量提醒發送。
- 只有學員主動/remind on或/remind 21且資格／必要同意有效才排程；預設仍off。/remindtest可由學員主動驗收本人預覽，off停止待送。WhatsApp仍等Meta配置。部署程式仍79825b9／schema28。
- 原worker.env受限備份與change evidence保留/root/qigong-reminder-enable-20261012T175935Z；停發只需另核准將flag設false，不回復整份舊env以免覆寫後續其他配置。下方deployment關閉狀態是16:40部署當時的歷史紀錄。

## 最新部署：Telegram／WhatsApp一起發布79825b9／schema28

- 使用者明確核准commit、push、部署兩項更新。程式79825b9b78802aff58667bf7fcd168a7a9a4a8bf、CI38277517503成功／543 tests；正式26→28只新增27與28并重跑零新增，原62表／6 people／10 check-ins與所有非metadata列指紋保留，新4表空、無同意／origin／session／reminder回填。
- 正式切換2026-10-12 16:40:30–16:40:47 UTC，17秒；先前因/tmp加密工具遺失造成16:38:13–16:38:37約24秒停站，未遷移即恢復26。找到保留工具並驗證round-trip後重取最終備份，兩次維護均記錄。
- 最終站外AES-GCM DB／roles／env-systemd逐一解密hash核對，roles設定重套及DB實際隔離還原，完整相同、旧97de588 API ready才正式migration。所有歷史migrations未重寫。compiled admin／Authgear profile／LINE-TG／journal／scope／brand及新單入口icon／reminder replay／WA Cookie-CSRF-logout-save-retry通過；隔離worker暫時開提醒且mock transport驗證preview1、WA summary0，零真人測試訊息。
- 113主站＋1PNG共114HTTPS checks，實際synthetic LIFF probe req.url REDACTED；APIactive/NRestarts0/status0、timeractive、matching worker Resultsuccess/status0。API exact28，新ops.telegram_reminder_schema_ready true、舊27／26gate false。
- **兩份正式env未改；WhatsApp仍disabled，Telegram reminder worker仍disabled，policy仍draft。**單入口icon已上線；/remind可存本人設定，但真實預覽／每日發送待另核准啟用flag。Meta Business Portfolio與assets完成後才另配置／啟用WA。正式0WA session／0reminder設定／0jobs／0activepolicy；沒有合成主站learner、principal或partner client。
- 恢復/root/qigong-deploy-79825b9、deployment-tools/79825b9、停止的rehearsal79825b9、受限站外backups/deployment-79825b9與獨立key保留。28→26需matching26 DB＋97de588 API-worker／old-release.conf，不可binary-only；開流量後另核准對帳，不保證OS／Caddy災復。
- 詳見[telegram-whatsapp-deployment](docs/operations/telegram-whatsapp-deployment.md)。原untracked web-admin-permissions-review.md仍未提交。下列本機候選段落為先前實作紀錄，發布狀態以上方為準。

## Telegram單功能入口／icon與reminder（本機實作紀錄；後續已部署28，發送開關未啟用）

- 使用者確認：各slash功能回單一對應WebApp按鈕，/start保留五個入口；✅打卡、🏆排行榜、📈功法分析、🏮成就沿用舊Bot，📝心得新增。不是slash自動彈出Mini App，仍點一下按鈕；身份／審核／隱私檢查未放寬。
- 新0028 reminders預設關閉、21:00、已打卡仍提醒；/remind read/on/off/hour/tz、/remindtest本人預覽5分鐘限制，提醒時區與practice timezone獨立；不匯入舊Bot設定、不複製LLM／節氣／私人成果內容。signed private webhook update-ID／subject-hash／fingerprint重放防護，off在必要同意／資格失效仍可關閉本人的提醒。
- 新settings／update-ledger／outbox三表強制RLS、無runtime表權限；每日identity＋local date唯一job，100位入列分批不餓死后續、25位claim／5並行／5秒HTTPtimeout，2分鐘lease、最多5次重試／backoff、1小時daily window及5分鐘preview expiry，pre-send重查資格／同意／設定revision。off／suspend／渠道關閉／身份撤銷取消unsent與leased；不保證exactly-once或已接受in-flight召回。
- 可選worker TELEGRAM_REMINDERS_ENABLED，缺省／false停排程，僅true啟用，其餘字串拒絕；正式env未修改、無真實測試訊息。API exact28／worker ops.telegram_reminder_schema_ready／phase-13-telegram-reminders；既有WA停summary／LINE-TG摘要／申請结果維持。
- 完整543 tests無skip，格式／lint／source typecheck／build通過；額外tsc仍既有10錯誤、新檔無新增。單入口別名／icon、設定與replay／非法值／off、signed webhook、當日去重與已打卡仍发、預覽期限／rate／lease／backoff／權限／同意、半小時與DST通過；125位合成入列100＋25／5輪發送／並行<=5通過。27→28upgrade／重跑保留全部非metadata表指紋（含WA session及principal），零三表回填，新舊API／worker gate匹配。provider是mock，不是手機送達或正式負載驗收。
- 候選28接在尚未發布WA27之後，工作區保留兩項修改；不得把Telegram部署核准當作WA27部署核准。發布須先決定分離artifact或明確核准兩項範圍，再做正式快照clone／最終加密備份實際還原／matching API-worker與真人驗收，不能直接部署混合工作區。主站仍97de588／26，政策draft；未commit／push／部署／改正式憑證、webhook或排程開關。
- 見[telegram-reminders](docs/operations/telegram-reminders.md)，含部署後BotFather icon／remind清單；證據/tmp/qigong-telegram-reminders-{verify-final,all-types-final}.log。提醒停止可另核准關flag，schema回退仍需matching DB／程式與新寫入對帳；不是binary-only。原untracked web-admin-permissions-review.md仍排除。

## WhatsApp固定書籤／記住30天／停送打卡摘要（本機實作紀錄；後續隨28部署，渠道未啟用）

- 使用者核准開始本機實作；首次私人checkin連結一次交換裝置cookie，預設勾選「這是我的裝置，記住30天」，明示共用／公共裝置取消勾選，須點擊登入。固定720小時，取消為15分鐘；長憑證只在Secure／HttpOnly cookie，DB僅雜湊，Cookie寫入Origin＋CSRF，每請求重查核准／active渠道／資格／必要同意。單裝置登出與資格撤銷可失效；新連結不默默切換身份。
- 固定書籤https://checkin.baiyinqigong.org/whatsapp/checkin，五頁cookie認證／雙語／未存草稿離開確認；修正匿名既開書籤收到同頁新fragment不重載及手機長URL溢出。網站登入不是WhatsApp官方配對，不延長service window，跨瀏覽器cookie容器須分別登入。
- 新0027不改0001–0026，沒有session／同意／核准回填；停止WA practice enqueue、取消舊pending／sending、worker移除WA practice sender、保存／更正／舊request重試receiptQueuedfalse。LINE／TG摘要及WA申請結果通知保持；無法召回已外部接受的in-flight訊息。API exact27／worker ops.whatsapp_browser_schema_ready／phase-12-whatsapp-browser。
- 完整520 tests無skip，格式／lint／source typecheck／build通過；額外tsc仍既有10錯誤、新檔無新增。合成26→27所有非metadata／WA取消工作表指紋保留，LINE receipt保留、零session回填、重跑及新舊gate通過。20個390／1280雙語五頁Chrome布局與真cookie jar／期限／短link到期書籤／dirty logout／零summary通過；Meta transport mock、local adapter僅測試改Origin，不是Meta／正式HTTPS／手機驗收。
- preview與測試同時使用55440曾觸發受控角色依賴保護，停止preview後相關與完整verify通過；不稱為先前間歇性問題已修復。所有預覽／Chrome已停、合成DB／角色清理。證據/tmp/qigong-whatsapp-browser-{verify-final,all-types}.log、preview／cdp scripts及synthetic screenshots；見[whatsapp-browser](docs/operations/whatsapp-browser.md)。
- 未commit／push／部署、未啟用WA、未改憑證／Meta assets／政策draft，主站仍97de588／26。發布另核准、正式26clone／matching API-worker／最終加密備份實際還原與真人驗收；27回26須matching DB＋97de588，不可binary-only。原untracked web-admin-permissions-review.md繼續排除。

> 最新主站為 `d8d4e6679993a018819b790fe608197934045f46`／`0034_community_note_sharing.sql`，2026-10-15 12:54 UTC完成same-schema LINE邀請核准後聊天交接部署；首次／重訪都改helper chat，不直接開checkin、不auto close/send，真手機驗收待回報。徽章圖示、明示心得、review与learner reminder true／WA unconfigured／policy draft保留，資料及metadata不變。

## Authgear管理員Email修復（已部署97de588／schema26，使用者已確認Gmail重登可讀Email）

- 使用者回報Gmail登入申請人Email在Authgear Users存在但後台缺失；唯讀確認主站有email scope／UserInfo，4個principal email皆NULL，未輸出個資／token。找到只讀ID token未讀UserInfo及既有principal DO NOTHING／正常登入不刷新兩個缺口。
- 候選provider用本次access token讀UserInfo，expected sub與signed ID token sub精確核對，只存verified Email；身份／角色仍issuer＋subject。新增0026 metadata facade在pending及approved callback同交易補名稱／Email，不改角色／範圍／狀態／grant version／既有session，不以Email合併，不清空未取得資料。提示改「尚未取得已驗證 Email」。
- 完整486項驗證、無skip，格式／lint／source typecheck／build通過，額外tsc仍既有10錯誤。OIDC＋受限DB／HTTP補Email、審核名單讀取、同Email不合併、suspended／wrong sub／unverified拒絕及25→26資料保留／零回填／重跑／新舊contract測試通過；mock不是實際Gmail真人登入。
- 程式CI [38226240055](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38226240055)成功；精確artifact／frozen lockfile／Node24建置及manifest保留。正式25快照隔離還原、26升級／重跑零新增、舊25API拒絕26與新26ready、compiled待審／已核准profile補Email且grant revision不變、審核名單讀取、LINE／TG／brand／sharing／scope／角色交易及mock worker通過，零主站合成profile/session/client或真實測試訊息。
- 最終站外AES-256-GCM DB／roles／env／systemd副本逐一解密雜湊核對，DB實際還原後含metadata完全一致、舊5230f1eAPI ready；正式只套0026並重跑零新增，62表／6 people／10 check-ins及全部非metadata列指紋保留，角色／session／Email無遷移回填，兩份env雜湊不變。112 HTTPS檢查通過；API active／NRestarts0／ExecMainStatus0、timer active、worker Resultsuccess／ExecMainStatus0，新worker gate true／舊25gate false。
- 正式API／worker exact26，worker使用ops.admin_oidc_profile_schema_ready。恢復/root/qigong-deploy-97de588、/opt/qigong-platform/deployment-tools/97de588、工作站/tmp/qigong-admin-profile-97de588、repo外backups/deployment-97de588與獨立受限backup-keys保留。回復需matching25 DB＋5230f1eAPI／worker與old-release.conf，開流量後另核准與對帳，不可binary-only；非完整OS／Caddy災復。
- 使用者部署後重新登入已回報「可以讀到 email 了」，Gmail Email實際使用驗收完成；刷新列表不等於重新取得Authgear資料。其他申請人需完整重登一次，勿刪除／重建principal或重複授權。見[admin-oidc-profile](docs/operations/admin-oidc-profile.md)。

## LINE加入申請登入回跳修復（已部署5230f1e，手機重測待完成）

- 使用者回報加入申請開帳密頁、選LINE應用程式登入又返回，核准修復及部署。一般HTTPS申請入口改configured LIFF `/apply#token`，短效／本人token、ID token驗證及審核不變。
- LINE工作區／心得init前清fragment問題修正，primary liff.state交SDK轉址、不先清URL／送API；成功secondary才清URL。外部首次login保留fragment、加非敏感回跳標記，失敗callback／native未登入停止反覆登入；沒有跳過身份驗證、存token或放寬Origin。
- API logger遮蔽req.url以保護LIFF primary query內SDK／申請資料，原header遮蔽保留；Caddy access log唯讀確認未啟用，未修改proxy。完整464項驗證、10個Chrome合成native／external／callback情境通過；額外tsc仍既有10錯誤。不是LINE手機／真SDK認證證明，仍須從最新LIFF加入連結重測。
- 程式CI [38141973040](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38141973040)成功；正式快照同25完整62表／4 people／7 check-ins及metadata一致，新LIFF申請／token提交pending、無效ID token拒絕、branded pending／TG／sharing／角色交易／mock worker通過，clone fixtures不進主站。
- 最終站外AES-256-GCM DB／roles／env／systemd副本解密雜湊核對，DB實際還原後完整相同、舊3bdc7c9 ready；正式不執行migration、两份env未變。112 HTTPS檢查通過（111主站＋1PNG來源），合成查詢probe的主站request日誌只見[REDACTED]；未讀出私人日誌／token。API active／NRestarts0／ExecMainStatus0、timer active、worker Resultsuccess／ExecMainStatus0。
- 恢復/root/qigong-deploy-5230f1e、/opt/qigong-platform/deployment-tools/5230f1e、工作站/tmp/qigong-line-join-5230f1e、repo外backups/deployment-5230f1e與獨立受限key保留。同25回退只切回3bdc7c9API／worker／old-release.conf，不還原DB；不要因重測刪除／重建已核准學員。见[line-liff-onboarding](docs/operations/line-liff-onboarding.md)。

## 側欄logo與品牌標題同行（已部署3bdc7c9）

- 使用者要求logo位於「白雁氣功」左側、與標題等高且同一行；已核准本機修改及直接commit／push／部署。只調整兩個品牌／shell source與測試，不改palette、圖片來源／CSP、待審portal、DB、env或Bot。
- brand-title flex row垂直置中，圖片1em正方形、無margin且不縮小，品牌文字nowrap；副標保持下一行，移除sidebar 80px手機覆寫。完整454項驗證、Chrome44組合成雙語手機／桌機配置通過；測量圖片與標題皆20.796875px、top相同、imageRight小於textLeft，副標在下方。非正式Authgear真人驗收。
- 程式CI [38138259863](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38138259863)成功；正式快照同25演練、完整62表／4 people／7 check-ins及metadata一致，compiled branded/pending／LINE／TG／sharing／授權與mock worker smoke通過。
- 最終站外AES-256-GCM DB／roles／env／systemd解密雜湊核對，DB實際還原後完全一致、舊d531450 ready；正式不執行migration、兩份env雜湊不變。108主站HTTPS＋1logo來源檢查通過；API active／NRestarts0／ExecMainStatus0、timer active、worker Resultsuccess／ExecMainStatus0。
- 恢復位置/root/qigong-deploy-3bdc7c9、/opt/qigong-platform/deployment-tools/3bdc7c9、工作站/tmp/qigong-admin-logo-inline-3bdc7c9與repo外backups/deployment-3bdc7c9、key另置受限backup-keys。同25回退只切回d531450API／worker／old-release.conf，不還原DB以保留後續寫入；非完整OS／Caddy災復。

## Web Admin品牌樣式（已部署d531450，後台真人外觀驗收待完成）

- 使用者回報LINE返回聊天重測成功，自行完成圖文素材並指定#082850／#305888／#98C0D8／#002048後台新色系及e-qi.org提供的logo，先核准本機修改，另核准本批commit／push／同25部署；已切換至d531450。
- admin-branding.ts集中tokens／logo／image-only CSP，完整10個後台頁及獨立待審portal、SVG圖表／標籤採新色系。logo原圖色彩／比例保留，側欄上方與手機自適應、雙語alt／no-referrer。四組HTML routes只增加完整指定PNG img-src，不放寬script／connect／frame，不改授權／資料／學員頁。
- 完整454項驗證通過、無skip，新增品牌／對比／route CSP測試；Chrome44組雙語mobile／desktop合成配置、真實遠端logo載入及零整頁overflow／JS exception通過。補card min-width:0解決手機表格撐大layout，不裁切內容；最終回歸再次454項通過；額外全測試型別檢查仍既有10錯誤、無新增。最終44組Chrome也核對SVG文字新色碼，非正式Authgear／真人驗收。
- 程式CI [38128356558](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38128356558)成功，精確git artifact／frozen lockfile／Node24建置及manifest保留；正式快照同25完整62表／4 people／7 check-ins及metadata一致，compiled branded pages／pending／CSP與TG／LINE／sharing／授權交易／mock worker smoke通過，零正式合成session／client／訊息。
- 最終站外AES-256-GCM DB／roles／env／systemd副本逐一解密雜湊核對，DB實際還原後完整一致、舊83dce1e ready。正式不遷移DB，兩份env雜湊未變，108公開主站HTTPS＋1PNG來源檢查通過；API active／NRestarts0／ExecMainStatus0、timer active、worker Resultsuccess／ExecMainStatus0。
- 恢復位置/root/qigong-deploy-d531450、/opt/qigong-platform/deployment-tools/d531450、工作站/tmp/qigong-admin-brand-d531450與repo外backups/deployment-d531450、key另置受限backup-keys。同25回退只切回83dce1eAPI／worker／old-release.conf，不還原DB以保留後續寫入；非完整OS／Caddy災復。詳見[admin-branding](docs/operations/admin-branding.md)。

## LINE自動返回聊天修復（已部署83dce1e，使用者回報重測成功）

- 使用者回報LINE首輪測試成功，接著核准修復及部署，自行設定六格圖文選單。首輪成功不代表所有裝置／權限／摘要案例都已驗收。
- LINE衍生頁此前移除TG SDK卻沿用TG close guard，沒有LIFF closeWindow；修復為只有confirmed save＋LINE in-client bridge＋無其他日期／時區dirty才自動close。失敗／bridge缺少／throw保留頁面；手動返回有dirty確認，不額外發摘要，TG／WA不變。Bot五個工作區改用configured LIFF入口，加入／政策私人URL不變。
- 完整433項驗證通過、無skip，程式CI [38124308193](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38124308193)成功；額外全測試tsc仍既有10錯誤、無新增。包含新增close／fail／draft／manual guard及signed LIFF links tests；這不是真人SDK驗收。
- 正式快照同25演練、compiled LINE／TG／後台／sharing及worker mock smoke通過；最終站外AES-256-GCM DB／roles／env／systemd實際解密雜湊核對，DB實際還原後62表／4 people／7 check-ins及metadata完全一致、舊75834f6 ready。正式不執行migration，兩份env未变、108公開HTTPS檢查通過，API active／NRestarts0／ExecMainStatus0、timer active、worker Resultsuccess／ExecMainStatus0。
- /root/qigong-deploy-83dce1e、/opt/qigong-platform/deployment-tools/83dce1e、工作站/tmp/qigong-line-close-83dce1e與repo外backups/deployment-83dce1e保留、key另置受限backup-keys。仍exact25；同25回退只切回75834f6API／worker／old-release.conf，不還原DB。圖文網址及設定／真人重測見[line-rich-menu](docs/operations/line-rich-menu.md)。

## LINE主站試行（已部署，使用者回報首輪成功，進一步真人測試待完成）

- 使用者明確擴充先前隔離核准範圍，使用既有HTTPS主站部署／測試；不另建網域，不動舊Bot、LINE Console開關或正式政策發布。
- 程式CI 38055345937成功。正式22快照隔離還原／23–25升級與重跑零新增／舊binary拒絕／受限compiled OIDC、後台、TG、journal及LINE簽章smoke通過，worker含LINE配置為0 onboarding／0 LINE／1 badge／2 mock TG receipts，零真實測試訊息。Messaging token唯讀驗證有效，不代表Login／LIFF真人驗收通過。
- 最終DB／roles／env／systemd站外AES-256-GCM副本逐一解密核對雜湊，DB實際還原22、完整資料與metadata和停機基線完全相同、舊852cd05 ready，才遷移正式DB。53張原應用表／3 people／6 check-ins保留，升級後62表；僅新shared permission／7映射、metadata及新欄位為預期差異。零acceptance／origin／staff分享，policy active0／draft1。
- API env未變；worker只追加相同LINE access token，其他內容逐byte保留。API active／NRestarts0／ExecMainStatus0，timer active、worker Resultsuccess／ExecMainStatus0；106公開HTTPS檢查通過。LINE七頁200、空signed webhook200／錯簽章401，WA404。間歇性錯誤根因仍未定位，不放寬授權／不宣稱已修復。
- 接下來由使用者在新LINE Console Verify並啟用webhook、確認LIFF endpoint／openid及Developing測試角色，私訊「加入」→審核→「打卡」真人測試。詳見[main-site-pilot](docs/operations/main-site-pilot.md)。
- 恢復須matching22 DB＋852cd05 API／worker及old-release.conf，不可binary-only；開流量後另核准並對帳。/root/qigong-deploy-75834f6、/opt/qigong-platform/deployment-tools/75834f6、工作站/tmp/qigong-main-pilot-75834f6、repo外backups/deployment-75834f6保留，key另置受限backup-keys；非完整OS／Caddy災復。

## 候選25提交與隔離試行歷史（主站新狀態見上方）

- 使用者已核准commit／push、CI及隔離測試部署，使用專用測試帳號先LINE再WhatsApp真人驗收。這不是正式部署、新正式渠道啟用、正式政策發布或舊Bot設定變更的授權。
- 程式commit／push `75834f6ddbd5e484c9003890a265e1e5dc1609d0`，CI [38055345937](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38055345937) 成功；提交前完整425項通過、無skip。正式仍852cd05／schema22，未連線或修改正式服務。
- 本機獨立PostgreSQL16及精確git artifact完成全新合成22→25／重跑零新增／舊binary拒絕／受限API及worker空queue smoke；22與25 dumps各實際還原及完整表雜湊／matching readiness通過。非正式快照或真人資料，真實provider發送0，政策draft。
- loopback API `127.0.0.1:3115`運行compiled buildApp、schema25 ready，但adminAuth／providers皆未配置；不是公開／完整index.ts服務驗收。公開測試HTTPS、專用LINE／LIFF、WA sandbox及測試Authgear設定仍須確認；不得臆測網域／挪用舊渠道。詳見[isolated-channel-pilot](docs/operations/isolated-channel-pilot.md)。

## Telegram固定/start入口與commit後close實作歷史（已隨主站25部署）

- 使用者核准本機修正兩項問題，要求/start完成後再自行加入新Bot設定；不動BotFather／憑證／渠道或正式部署。正式仍852cd05／22，未提交／推送。
- 核對舊bot固定WebApp＋簽章initData（原始碼default1小時）與儲存成功tg.close；正式22則15分钟URLcapability／每user一筆link、沒有close呼叫。新/start與/checkin對有效核准user回5個static按鈕，申請／政策不繞過。
- 新telegram-miniapp-auth.ts、bootstrap及0025：HMAC constant-time驗證raw initData／auth_date／安全userID，Origin與JSON嚴格，不信unsafe／browser ID，不接受debug bypass。signed來源仍須approval／person／primary／policy，backend短cap在記憶體提前renew，不永久授權。
- 改links PK為token hash，保留舊列，獨立短session不互相取代；forced-RLS限流12/min。SDK首個tgWebAppData保留，平台cap不進SDKcache或持久存储；舊私鏈15分鐘fallback仍受控。
- server commit後且無其他實際草稿自動SDK close，不等refresh、不再sendData重發摘要；有別的日期／zone草稿則保留UI，返回聊天按鈕需discard確認；普通browser／failed save不強關，LINE／WA衍生頁不使用TG exchange。
- Mini App針對性測試、24→25原links保留／重跑／舊契約拒絕、HMAC／freshness／scope／limiting、renew／close／dirty與官方SDK合成4場景通過；非真人或正式快照。人員核准續查後，最近連續兩次完整 `pnpm verify` 425項通過、無skip，format／lint／source typecheck／build通過；額外全測試tsc仍為既有10錯誤、無新增。診斷期間另重現WA更正409／review權限拒絕、journal coach能力誤判；間歇性根因仍未定位，重跑通過不等於已修復。測試保留無憑證／個人內容的布林診斷；未放寬授權、未新增對外診斷欄位。不可宣稱可正式發布；提交／CI及本機隔離演練狀態見上方，未改Bot設定。見 [telegram-miniapp](docs/operations/telegram-miniapp.md)。
- 本機API／worker exact25；政策draft不自動發布。提交／推送／CI及隔離試行已核准；正式22→25matching artifact／備份還原另核准，再指引只對新Bot設定start／commands／menubutton；現在正式22尚未套用。

## LINE先行、接續WhatsApp工作區與私人摘要實作歷史（已隨主站25部署，WA未啟用）

- 使用者核准項目1完整學員工作區＋項目2選單及私人摘要，指定先LINE完成功能驗證後再WA；本機已依序實作。不含提醒、LLM、舊帳號／資料／勳章搬移，沒有真實發送、啟用渠道或正式部署。
- 新0024、channel-workspace*.ts及channel-practice-receipts.ts：兩渠道打卡、同區遮罩榜、30／90日分析、49勳章／等級／真正月格與逐日歷史、跨區共享與本人發布／撤回。共用21的person preference／revision及23政策／資格邊界，不隱含連結人。
- LINE維持單一LIFF endpoint與每次ID token驗證，繁中；WA簽章／帳號／短效capability，繁中／英文，互動list及文字fallback。UUID／version、日期獨立草稿、受控時區、dirty保護／失敗保留／刷新失败不重送；recipient不從browser取。
- 私人摘要只含日期／功法／連續與累計天數，無心得或感受。LINE push用stable retry key，重複accepted409不再當作新失敗；WA紀錄簽章入站的24h窗口，enqueue／claim／pre-send重驗，過期不強送自由文字，不用未核准模板。lease／backoff／8次上限及停用取消；API接受不等於實際送達。
- Worker最多onboarding3＋跨渠道practice3＝6次transport，三渠道均配置時各1，60秒預算不擴張。policy仍draft，部署不自動發布。工作區24整合本機API／worker exact25，正式仍852cd05／22；候選提交／CI與隔離演練見上方，正式發布與啟用各須核准。
- 完整pnpm verify **409項、無skip**，format／lint／source typecheck／build／diff check通過；全測試tsc仍10項既有錯誤、無新增。23→24／重跑／舊契約拒絕／所有既有表指紋保留通過，非正式快照。Chrome12配置兩渠道五頁手機及雙語桌機，零overflow／JS exception，stub LIFF、fragment、日期草稿及31天月格通過，非真人／真實LINE SDK登入。詳見 [channel-workspaces](docs/operations/channel-workspaces.md)。
- 後續：專用帳號與模板／真人裝置及真正provider送達驗收、LINE去重／非同步bot reply、WhatsApp送達追蹤及提醒／保留清理。正式22→25升級及matching22 DB＋852cd05回復需另核准與演練。

## 白雁補充說明、同意與資格停用（已完成本機23，整合候選25）

- 使用者核准本機實作及修復，現已核准commit／push與隔離試行；未核准正式部署。正式852cd05／22不變，不修改歷史0001–0022、package metadata／依賴／lockfile或保護設定，不動舊Bot或啟用LINE／WhatsApp。
- 新docs/legal/checkin-helper-supplement.zh-TW.md及.en.md，承接使用者提供的官網政策（頁面更新2025-05-16），品牌白雁氣功，聯絡邱伶婷／eqibaiyin@gmail.com。新紀錄預設給有效學員及工作人員分享，舊私密不回填；停課退學由地區管理員停用，其他學員看不到其歷史，管理端仍依scope可讀。
- 0023新增forced-RLS政策／capability／同意／資格版本／checkin origin；政策先draft，**部署不自動發布**。/privacy提供雙語全文，普通同意與選填reflection consent未預勾，平台identity由簽章後私鏈綁定，不接受瀏覽器user ID。一般功能及DB／worker報名facade拒絕缺同意／過期／錯版本；新舊學員生效後須確認，不自動授權或依姓名Email合併。
- 新日期／功法／心得／感受共享快照依origin自動建立／更正，撤回不因更正重公開；敏感同意撤回停止公開心得／感受。外部仍獨立同意，內容更正撤下外部資格需重確認，Chatbot摘要仍無心得／感受。
- /admin/learners提供範圍內資格停用，CSRF／理由／版本／鎖後實際clock授權檢查；先關互動管道後suspend，舊cap到期、對應同意撤銷，不刪原始紀錄或其他獨立person，不撤銷admin／Authgear。/admin/shared-journal讀共用歷史；舊私密及停用者原稿仍依原角色scope，不擴大私密權限。/admin/privacy-policy僅Super審閱後理由式發布。
- 完整pnpm verify **388項通過、無skip**，format／lint／source typecheck／build通過；額外全測試tsc仍10項既有錯誤、無新錯誤。22→23／重跑／舊契約拒絕／原始資料與舊撤回snapshot保留及draft零同意origin驗證通過，非正式快照。signed三管道mock驗證與Chrome八種雙語手機／桌機配置無溢出／JS exception，非真人驗收、零真實測試發送。
- 詳見 [learner-privacy-consent](docs/operations/learner-privacy-consent.md)。隱私功能migration23整合於本機candidate24；發布／正式快照／備份回復另核准，不能binary-only rollback22。復課／永久刪除自動化、保留清理、完整LINE／WhatsApp學員工作區及官網串接仍待做。

## 心得流／分享／外部 API／標籤（已部署852cd05／schema22）

- 使用者核准 commit／push／部署，程式852cd05；[CI37914571159](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37914571159) 成功。新0022，不改0001–0021、舊Bot、保護設定、依賴或 provider 開關。
- Master／Coach／Super 後台全域私密心得，regional_viewer 僅已授權地區全部私密內容，不擴張 regional_admin／global_viewer。regional_viewer 接入待審、核准、版本式授權管理，必選 active operational 地區；self／master／super、audit、鎖後再驗證與 session invalidation 保護保留。遷移撤銷持有此角色的舊普通 session，不自動發 grant。
- 新 /admin/journal、/admin/practice-feeling-tags，雙語、篩選／分頁、標籤增改／停用／排序／整批版本儲存；taxonomy.manage 不自動給 Coach／Master，歷史標籤不改寫。
- /telegram/journal、/journal／/share 第五個私聊入口，跨所有地區主動分享，既有心得私密。心得／感受／外部讀取分別同意，獨立快照；sourceHash／publication version 阻擋預覽後未見更動，撤回停止新讀取。實際修改保護／失敗保留／其他卡草稿保留，SDK cache 無 capability，聊天摘要不含心得／感受。
- /api/v1/shared-journal 只讀另同意外部分享的快照；backend SHA-256 credential、最長90天、每分鐘60次、可撤銷，無 CORS／no-store，不供瀏覽器密鑰。僅 Super＋CSRF 發行／撤銷，尚無正式 client。API認證合作系統，不驗證其終端使用者 session；官網登入／授權／清除契約仍待確認。
- 完整 isolated PostgreSQL16 pnpm verify **356項通過、無 skip**，格式／lint／source typecheck／build 通過。額外全測試 tsc 仍有10項既有錯誤（learner-pages／admin-sessions／onboarding／runtime-rls），沒有本批新錯誤。
- 本機 scope／RLS、快照、撤回、作者失效、token／限流、CSRF／標籤、授權保護、21→22針對性 session 撤銷測試通過。Chrome六種手機／桌機雙語合成配置無溢出／JS exception；不是正式快照、真人裝置或官網驗收。契約見 [journal-sharing](docs/operations/journal-sharing.md)。本批 API／worker正式 exact0022，不得 binary-only rollback。
- 正式快照21→22／重跑、舊21 binary拒絕22、compiled OIDC／後台／授權／分享來源衝突／撤回／外部憑證撤銷 smoke 通過；worker三lane演練為0 onboarding／1 badge／3 mock receipts，零真實provider發送，沒有在正式建立client或分享。最終站外AES-256-GCM DB／roles／env／systemd副本解密雜湊核對，DB副本實際還原21並與最終基線（含metadata）完全相同、舊0ed750d readiness通過。
- 保留51張既有表的授權變更排除後完整雜湊、3 people／5 check-ins及grants／sessions；新增2表，只有regional_viewer permission＋1 migration audit＋architecture metadata為預期變更。本次無需撤銷的viewer普通session，零分享／零外部client；82項公開HTTPS檢查通過。API active／NRestarts=0／ExecMainStatus=0、timer active、worker Result=success／ExecMainStatus=0，實際三lane均0。保護env雜湊不變，零真實測試訊息；真人裝置／官網串接驗收仍待完成。
- 回復位置：/root/qigong-deploy-852cd05、/opt/qigong-platform/deployment-tools/852cd05、/tmp/qigong-release-852cd05，以及 ~/.local/share/qigong-platform/backups/deployment-852cd05；key另置受限backup-keys。回復須21 DB＋0ed750d API／old-release.conf／matching worker，開流量後另核准並對帳後續寫入。備份不宣稱完整OS／Caddy災難復原。

## Telegram 四頁與聊天摘要（已部署 `0ed750d`／schema21）

- 使用者核准第一批與第二批一起實作；聊天回覆如舊版，不含心得／感受。參考舊 `qigong-telegram-bot` HEAD `3886b40121326cdbef90233ef0370d6913b02146`，保持舊 repo 唯讀，沒有搬帳號／舊勳章或啟用 LINE／WhatsApp／LLM。
- 新 `telegram-workspace*.ts`：繁中／英文打卡、同地區遮罩排行榜、30／90天本人功法分析與近期私密心得、成就／每月歷史；Bot 私聊 `/checkin`、`/leaderboard`、`/methodanalysis`、`/achievements` 等回覆四個 WebApp 按鈕。仍以已核准身份的15分鐘平台 capability 授權，並非信任未驗證 initData／瀏覽器 user ID。
- 今天／昨天獨立草稿、分類全選、受控時區確認／變更、只在實際修改時警告、失敗保留輸入、busy／UUID retry／grant-independent checkin versions。官方 SDK ready／expand／native closing guard；先清除平台 capability 再讓 SDK 快取其 Telegram initParams，最後清除 fragment；僅放行官方 script 與 Telegram Web iframe，其他管道與後台 CSP 不變。
- 新 `0021_telegram_learner_workspace.sql`：forced-RLS workspace／版本／request ledger／receipt outbox、固定 v1 49個 badge definitions、person awards／audit、核准季節設定與耐久 jobs。儲存功法／心得／感受／版本／摘要同交易；只回傳日期／功法／連續與累計天數，收件人從已授權 identity 決定。sender allow-list／sanitized errors，不把私密欄位／provider URL／token 混入訊息或日誌。
- 成就依 canonical practice_date 與結構化 code，不用心得文字猜功法；更正可標記資格 revoked、保留歷史，重新符合可 restored。job trigger＋daily reconciliation，沒有新的勳章通知。三伏／冬至沒有猜測或 seed 活動日期；未設定核准日曆時明確顯示尚未開放。管理端心得／tag／成就榜 UI 仍未完成。
- 通知 worker 三個獨立 lane：onboarding、Telegram receipts、badge reconciliation；兩個 transport lane 各3筆，遵守既有60秒預算，全部結束才關 pool。10分鐘 lease／8次重試／退避／撤銷取消／送出前重驗；Telegram API 接受不等於裝置送達，也不宣稱 exactly-once／可以撤回在飛行中的訊息。
- 隔離 PostgreSQL16／Node24 `pnpm verify` **319項、無 skip**；workspace DB15／生成頁26／API與sender18，另有0020升級新測試。20→21／重跑／舊契約拒絕及既有應用表雜湊保留（core metadata 架構標記除外）通過；不是正式快照演練。worker-only login 的 compiled worker 三 lane 零項實際通過，沒有 migration-table SELECT。額外全測試 tsc 仍為10項既有錯誤，沒有本批檔案錯誤。
- Chrome CDP 合成資料390px四頁／1280px英文打卡與截圖檢查：零橫向溢出／JS exception、官方 SDK、fragment 清除、SDK 快取無 capability、native guard、獨立草稿／儲存／月歷史通過。不是正式 Telegram Android／iOS／Web 真人驗收，零真實訊息。
- 使用者核准commit／push／部署，程式CI [37821306107](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37821306107) 成功。正式快照20→21、重跑零新增、42張既有表雜湊保留通過；metadata architecture_version／updated_at為核准變更且另檢查。停機最終AES-256-GCM站外DB／roles／env／systemd副本逐一解密核對雜湊，DB副本實際還原20、完整資料及metadata與基線一致，舊ccd06a9 readiness通過。正式保留2 people／停機時4 check-ins／grants／sessions，新增9表／49定義／零活動日曆。
- 正式快照compiled smoke驗證8個雙語Telegram頁／4種report／UUID冪等及stale409／既有後台OIDC與授權交易／私密心得；worker-only login三lane成功，2筆mock摘要不含心得／感受，零真實發送。公開HTTPS60項通過；API active／NRestarts=0／ExecMainStatus=0，timer active／worker Result=success／ExecMainStatus=0，實際三lane為0 onboarding／0 receipts／2 badge jobs。保護env雜湊不變。公開工具首輪有schema檔名assertion筆誤，修正工具後通過，未改正式程式／DB。
- 新API／worker exact0021，20 binary不能直接指向21。回復需配對最終20 DB＋ccd06a9 release／old-release.conf／同版worker；開流量後須另核准並對帳後續寫入。工具／回復位置見下；下一份migration接22，不改写0001–0021。

## 管理員卡片與具名操作表單（已部署 `ccd06a9`，同 schema20）

- 使用者核准新設計及 commit／push／部署，程式 `ccd06a9d43fd4c82534b4732f6bb516c4eecfa78`；CI [37803401344](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37803401344) 成功。繁中／英文帳號卡片先顯示姓名／Email／帳號與申請狀態、角色／範圍／授權狀態／期間；身份與申請資料收入 details。角色操作列不放常駐文字框，按「修改授權」「移除此筆授權」「新增角色」才展開具 legend、目標、可見標籤及多行理由的 fieldset；全部移除置於獨立警示區。
- 同時間只展開一個操作表單；切換操作／取消有實際修改才確認，取消重設基線並返回按鈕焦點。理由說明用途與稽核留存，依 Unicode 限制1–500字，禁止空白／NUL；role／scope／reason payload 及 server-side CSRF／version／授權規則未改。單筆及全部移除分別說明範圍與不刪帳號／學員資料。拒絕只送 reason／decision／申請版本，不帶 role。
- 寫入期間停用 fieldset，busy 防重送、取消、切換表單及名單／篩選／分頁；失敗／403／409 保留表單值，顯示就地錯誤。self／master／super、legacy／suspended／scheduled 的既有保護仍以 SQL 為防線。
- 完整 PostgreSQL16 `pnpm verify` **259項通過、無 skip**（生成頁47項），格式／lint／source typecheck／build／diff check 通過。額外全測試 typecheck 與前版覆蓋比較仍為10項既有錯誤、無新增。以本機 Chrome CDP 驗證合成示範資料的390px手機／1280px桌機，繁中修改、英文移除及預設清單截圖檢查完成，document/body scrollWidth 等於 viewport、表單展開數正確；不等同正式 Authgear／真人裝置驗收。
- 正式快照隔離還原、matching artifact migrations 兩次零新增、編譯後雙語頁／mock OIDC／受限 runtime／授權交易／私密練功紀錄演練通過。最終 DB／roles／平台 env／systemd 站外 AES-256-GCM 副本解密核對雜湊，DB 副本實際還原為20、完整資料與停機基線一致、fbdf7a1舊程式 readiness 通過。正式不跑 migration，42張表完整雜湊（含 grant revision）未變，2 people／3 check-ins、grants／sessions 保持原狀。
- 公開 HTTPS41項通過，無真實測試訊息；API active／NRestarts=0／ExecMainStatus=0，timer active／worker 最近 Result=success／ExecMainStatus=0，保護 env 雜湊不變，未動舊 Bot 或啟用新 provider。
- 恢復資料：`/root/qigong-deploy-ccd06a9`、工具 `/opt/qigong-platform/deployment-tools/ccd06a9`、一次性腳本 `/tmp/qigong-release-ccd06a9/`；站外 `~/.local/share/qigong-platform/backups/deployment-ccd06a9/`，key 另置受限 backup-keys。備份不宣稱完整 OS／Caddy 災難復原。可退回同20 `fbdf7a1` binary／symlink／原 API drop-in／matching worker，**不應還原 DB**，保留後續寫入。

## 管理員入口與未儲存提示（`fbdf7a1` 發佈歷史，同 schema20）

- 使用者核准文案調整及同時部署；提交／推送程式 `fbdf7a1c700f27da0ce8a1059aeb48225d69e9f1`，CI [37797685206](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37797685206) 成功。繁中／英文改為「審核管理員申請」與「管理現有授權」，各附用途說明與 aria-describedby；申請狀態及 API 篩選值未改，不混淆學員報名審核。
- 納入前輪本機修正：名單、篩選、分頁、重新載入只在角色／範圍／理由與載入基線不同時提示，使用對應文案，不再錯用語言提示；取消保留輸入／套用篩選／頁碼／URL。預填或僅展開編輯器不算修改、恢復原值不提示；讀取／切換不提交權限異動，成功儲存重設基線、失敗保留修改。共用管理側欄語言確認保持原樣；待審申請頁重新載入也改為檢查實際修改。
- 完整隔離 PostgreSQL16 `pnpm verify` **239項通過、無 skip**，含格式／lint／source typecheck／build／diff check。首輪既有 DB master-request 保護測試出現 admin access denied，完整重跑及 CI 通過，沒有改 SQL；原因未定位。額外全測試 typecheck 仍有10項既有錯誤，已用 HEAD source 覆蓋比較確認沒有新增，不能宣稱全測試 typecheck 乾淨。
- 正式快照還原、clone 遷移兩次均零新增、新舊程式對同20 readiness 均通過；受限 runtime／mock OIDC／雙語編譯畫面／授權交易／私密練功紀錄演練通過，無真實 provider sends。正式停機最終 DB／roles／平台 env／systemd 的 AES-256-GCM 站外副本驗證解密雜湊，DB 副本實際還原為20、與停機基線完全一致、舊4a0237e readiness 通過。
- 正式**不執行 migration**，42張表完整資料雜湊（包含 grant revision）均保持一致，2 people／3 check-ins、角色／grant／session 未變。API active／NRestarts=0／ExecMainStatus=0，timer active／worker 最近 Result=success／ExecMainStatus=0；保護 env 雜湊未變，公開 HTTPS41項通過，不啟用新 provider、不動舊 Bot。真人 Authgear／桌機／手機實際操作驗收仍待完成。
- 恢復資料：`/root/qigong-deploy-fbdf7a1`、工具 `/opt/qigong-platform/deployment-tools/fbdf7a1`、一次性腳本 `/tmp/qigong-release-fbdf7a1/`；站外 `~/.local/share/qigong-platform/backups/deployment-fbdf7a1/`，key 另置受限 backup-keys。備份不宣稱完整 OS／Caddy 災難復原。
- 本次同20 UI-only release 可退回 `4a0237e` symlink／原 API drop-in／matching worker，**不應還原 DB**，以保留後續寫入。若另外退回19，則必須依下段完整 DB＋binary 邊界，另核准並對帳。

## 已授權名單／編輯／全部移除（`0020` 首次部署歷史）

使用者另核准 commit／push／部署後，程式 `4a0237e96d9a6181fea0c1a98f0f475c4bc1acb1` 已上線；CI [37791615057](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37791615057) 成功。正式快照升級／重跑零新增／舊程式拒絕20／最終站外備份實際還原為19／公開 HTTPS41項通過，無真實測試訊息。全部42張既有表原始資料保留（principals 雜湊只排除新增版本欄），3 principals 的新版本均為1，2 people／3 check-ins 與既存 grants／sessions 未變更；未動保護 env、舊 Bot 或新 provider 設定。API active／NRestarts=0／ExecMainStatus=0；通知 timer active、worker 最近 Result=success。

恢復資料：`/root/qigong-deploy-4a0237e`、部署工具 `/opt/qigong-platform/deployment-tools/4a0237e`；站外 AES-256-GCM 備份 `~/.local/share/qigong-platform/backups/deployment-4a0237e/`，key 另置受限 backup-keys。最終 DB／roles／平台 env／systemd 副本均核對解密雜湊，DB 副本實際還原並與停機基線一致，19舊程式 readiness 通過。腳本 `/tmp/qigong-release-4a0237e/` 為一次性工具，未宣稱完整 OS／Caddy 災難復原。

回復必須恢復 `0019` DB＋`79f3e4c` release／API drop-in／matching worker，不可只換 binary。已開流量後 DB 還原會失去後續寫入，須另核准與對帳。

已完成 `0020_admin_grant_management.sql`。管理權限頁新增等待核准／已授權入口，涵蓋既有 provisioned 帳號、角色與範圍、Email 缺漏及 effective 狀態；可原子編輯既定角色／地區、單筆撤銷及全部撤銷，保留歷史與 audit，不刪除 Authgear／學員資料。授權 revision 由 trigger 維護，CSRF／scope／版本／並行交易／session 撤銷／master 與自我異動保護均測試。

完整 PostgreSQL16 `pnpm verify` **223項通過、無 skip**，包含格式／lint／source typecheck／build。未改歷史 migrations、依賴、正式 grants 或保護設定；正式 API 最小／最大均為 `0020`，匹配完整0001–0020 artifact／API／worker；19舊 binary 不相容20。受控 owner 的 future grants 網頁撤銷不支援、整批拒絕而非部分撤銷；舊角色不直接編輯。操作細節及部署／restore 待辦見 `docs/operations/admin-grant-management.md`；徽章 migration 改規劃接 `0021`。

另：使用者回報實際登入後，查到該次登入帳號已有有效 global super_admin 與正常 session，未重複授權或新增 grant；Authgear 記錄未提供 Email，所以不能依指定 Email 查詢結果推定沒有權限。帳號依 issuer＋subject 判斷，需本人核對已知 sub；正式的現存授權保持原狀。

## 新管理界面與分級權限審核（已部署 `0019`）

使用者已核准文案調整、提交／推送與部署；程式 `79f3e4ce5451a0c0732aca6784478deba4d15cdb`／schema `0019_admin_access_approval.sql` 已於 **2026-10-08 13:23:46–13:24:11 UTC** 部署，停機25秒。CI [37783413247](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37783413247) 成功。本機213項無 skip、正式快照升級／舊版 readiness 拒絕／最終站外備份實際還原通過；公開 HTTPS38項通過，無真實測試訊息。保留既有40張表的原始資料（核准新增的 roles／permission／mappings 另驗證），2 people／3 check-ins 與全部既存 grants 未變。

最終 DB／roles／平台設定的 AES-256-GCM 站外副本逐一核對解密雜湊並實際還原；API active、NRestarts=0／ExecMainStatus=0，通知 timer active、最近 worker Result=success。保護 env 雜湊未變，未動舊 Bot 或啟用新 LINE／WhatsApp。指定新 super admin 候選帳號尚無對應 Email 登入紀錄；等待本人完成真實 Authgear 登入／身分核對，不是假稱已授權。

- 使用者確認新規格：語言改為側欄緊湊下拉，登出移至主要選單下方；繁中／英文、篩選保留與未送出審核切換提醒均保留。
- 新候選 `0019_admin_access_approval.sql`、`admin-access*.ts`：Authgear 首次未授權登入建立獨立待審身份／session，僅能提交與讀取本人申請；待審 credential 永不變成普通管理 session，不能讀報表或授權資料。
- 有效 global super／master 可在 `/admin/administrators` 管理授權。地區管理員採 `regional_admin + region`；工作人員採 `global_viewer + global`；氣功教練採新 `coach_admin + global`（含私密心得及感受唯讀）；兩位老師採新 `master_admin + global`（相同讀取＋一般管理員授權）。Master 僅能管理三種一般角色，不能處理自己、其他 master／super 帳號或 master 申請；僅 super 可配置 master，瀏覽器不能配置 super。沒有任意 permissions 編輯／Authgear role claim 自動授權／姓名或 Email 合併帳號。
- 核准需重新登入；角色異動會撤銷受影響帳號普通 session。SQL 保護自我異動／最後 super admin，版本鎖／交易／audit 及並行操作後重新驗證角色／時鐘到期均有測試。原有歷史 migrations、依賴與正式設定未動；既有地區／全域唯讀／班級 coach 模板未擴張，未自動變更現存 grants。新增管理員授權 permission 配置給 master／super。
- 使用者已指定第一位 super admin 候選人（Email 私下核對、不寫死程式），但 **未建立 Authgear 帳號或配置正式 grant**；須完成 Authgear 登入／已驗證 Email、核對 issuer／subject／UID，再由受控 DB owner bootstrap。指定人選不是部署核准。操作流程與限制見 `docs/operations/admin-access.md`。
- 正式 API 最小／最大均為 `0019`，匹配完整0001–0019 artifact／API／worker。隔離 PostgreSQL16 的完整 `pnpm verify` **213項通過、無 skip**，含格式／lint／source typecheck／build。真人 Authgear／桌機／手機視覺驗收與指定帳號 bootstrap 尚待完成；`0018 → 0019` 發布／還原演練已通過。回復舊程式必須還原 `0018` DB＋`b271ede` release／API drop-in／worker，不能只換 binary；重新開放流量後還原會失去後續寫入，需另核准與對帳。
- 恢復資料：遠端 `/root/qigong-deploy-79f3e4c`、部署工具 `/opt/qigong-platform/deployment-tools/79f3e4c`；站外 `~/.local/share/qigong-platform/backups/deployment-79f3e4c/`，金鑰另置受限 backup-keys。一次性操作腳本 `/tmp/qigong-release-79f3e4c/`；不是通用部署工具。備份包含 DB／roles／平台 env／systemd，未聲稱完整 OS／Caddy 災難復原。
- 原第二批心得管理頁／tag 管理／成就 worker backlog 不變；徽章 migration 規劃須接續 `0021`，不能再使用已保留給管理員審核／授權異動的 `0019`／`0020`。

## 第二批部分功能（已部署；其餘功能未完成）

- 使用者已確認同卡片上方複選感受 tag、下方自由心得；兩者分開儲存，選取／取消不改寫文字，均維持私密權限。
- 已套用 migration `0018_private_practice_notes_and_tags.sql`：獨立 forced RLS 心得／tag 快照、版本鎖 tag 目錄、三平台身份綁定與心得查詢。Telegram／LINE／WhatsApp 提交、更正與歷史，以及共用學員卡片已接上；省略欄位保留既有資料。
- 修正權限三值邏輯：新心得函式以 `IS NOT TRUE` 拒絕未明確授權的個人篩選；`methodsVisible` 的 `NULL` 正規化為 `false`。跨區／一般報表讀者無法取得私密文字與 tag，私密心得讀者不因此取得功法權限。未改既有角色授權或歷史 migration。
- `admin-journal.ts` 僅為查詢 helper；管理端心得／tag 畫面及 HTTP 路由、成就模型、評估／reconciliation worker **尚未完成**。參見 `docs/operations/admin-phase-2-proposal.md`。
- 正式 API 的 schema 最小／最大均為 `0018`，不是正式 `0017` 的可直接替換版本。隔離 PostgreSQL16、Node24／pnpm10 的完整 `pnpm verify` **173項通過、無 skip**；format／lint／source typecheck／build 與 `git diff --check` 通過。
- 程式 commit／push `b271ede`，GitHub CI [37739536716](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37739536716) 成功。正式主機 frozen-lockfile／Node24 建置，保存完整 artifact checksums。側欄語言切換已正式移至品牌下方、主要選單上方。
- 隔離正式快照演練 `0017 → 0018`、重跑零遷移；既有36張表筆數／資料雜湊不變。受限 login／mock OIDC 驗證8個雙語管理頁、12個報表、CSRF、學員心得＋tag 寫入／讀回及錯誤交易回滾；無真實 provider sends。舊 binary 在 `0018` readiness 拒絕，還原 `0017` 後再次通過。
- 停機取得最終 DB／roles／平台 env／systemd 備份；站外 AES-256-GCM 副本逐一驗證解密雜湊，最終 DB 副本實際還原至隔離 cluster 並與停機基線完全一致，舊版 readiness 通過。正式僅新增 `0018`、重跑零新增，既有36張表不變（2 people／2 check-ins）。
- 維護15秒後 API／通知 timer active，`NRestarts=0`、`ExecMainStatus=0`；公開 HTTPS **23項檢查通過**：正確 release／schema、雙語學員卡片、未登入管理頁／API、OIDC 無效 callback、Origin 拒絕與 Unicode 長度驗證、新管道及未完成管理頁404。受限 env 雜湊不變，未改舊 Bot／角色授權、未送真實測試訊息。
- 正式 tag 目錄目前為空，未自行建立／猜測標籤；自由心得可使用，tag 管理 UI／路由仍須後續完成。此批不是完整第二批功能或真人驗收通過。

## 專案與 Tech Stack

白雁氣功跨 IM 學員審核與練功打卡平台：管理員以 Authgear 登入，依地區／班級權限審核及查看報表；核准學員使用獨立 Telegram Bot。LINE／Meta WhatsApp Cloud API adapter 程式已部署，但新管道設定尚未配置，路由未啟用；舊 Bot、舊登入、舊資料庫及 webhook 保持獨立。

Node.js 24、pnpm 10.15.1 workspace、strict TypeScript、Fastify 5、PostgreSQL 16（受限 runtime roles／SQL 函式／forced RLS）、Authgear OIDC Authorization Code + PKCE、Vitest／ESLint／Prettier。正式 HTTPS 入口為 Cloudflare → Caddy → loopback API。公司署名為 **Bean, Bird & Badminton Tech Consulting**。

## 目錄與功能

| 路徑                                                                       | 用途／狀態                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/public-api/src/index.ts`、`app.ts`                                   | 啟動、環境設定、路由、migration 相容性及 runtime readiness。                 |
| `admin-auth.ts`、`oidc-provider.ts`、`admin-pages.ts`                      | Authgear／session／CSRF、待審 API；審核頁為 `/admin/applications`。          |
| `admin-dashboard.ts`、`admin-reporting.ts`、`admin-locale.ts`              | 已部署：總覽／已未打卡名單、排行榜、功法與個人分析、四頁側欄繁中／英文切換。 |
| `telegram-onboarding.ts`、`application-page.ts`、`checkin-page.ts`         | 已部署：申請／打卡、歷史／補登／更正、語言偏好及共用頁面模板。               |
| `line-onboarding.ts`、LINE page wrappers                                   | 程式已部署、管道未啟用；簽章、LIFF ID token、申請／打卡／通知待真人驗收。    |
| `whatsapp-onboarding.ts`、`whatsapp-client.ts`                             | 程式已部署、管道未啟用；專用 WABA／電話、Cloud API／模板／手機待真人驗收。   |
| `onboarding-notifications.ts`、`notification-worker.ts`                    | 同版通知 worker 已部署；目前僅配置 Telegram sender。                         |
| `packages/database/src/`、`packages/config/src/`、`packages/identity/src/` | DB／migration／request context、設定驗證及身份契約。                         |
| `migrations/0001–0025`                                                     | 已完整套用；歷史 migration 不可改寫，API 最小／最大均為 `0025`。             |
| `apps/public-api/tests/`、`packages/database/tests/`                       | API／授權／報表／通知／整合與 migration 測試。                               |
| `docs/operations/`、`scripts/backup-remote-postgres.sh`                    | 管道試行、後台驗收、systemd、備份／還原文件。                                |
| `.github/workflows/ci.yml`、`docs/architecture/`、`docs/adr/`              | PostgreSQL 16 CI、架構契約及決策。                                           |

上述 source 短檔名均位於 `apps/public-api/src/`。

## 前次 `269555c`／`0017` 發佈與驗證（歷史）

- 程式 commit／push：`269555c`，GitHub CI [37662918158](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37662918158) 成功。本機 Node24／pnpm10／隔離 PostgreSQL16 的 `pnpm verify` **150項通過，無 skip**；格式、lint、source typecheck、build 通過。未改依賴或原有 migration。
- 升級前重新核對正式 schema 為 `0012`；LINE／WhatsApp API 及 sender 設定皆未配置。新 release 在正式主機使用 frozen lockfile 安裝、Node24 建置，排除環境檔及 AppleDouble archive metadata，留存 source archive SHA-256／compiled artifact／migration checksums 的 `release-manifest.json`。
- 專用 PostgreSQL16 隔離 cluster 不開 TCP listener，正式快照還原保留 ownership／ACL／roles。演練 `0013` 已提交、`0014` 故意失敗時，新舊 API 相容性皆拒絕；接續完整遷移至 `0017` 成功。既有31張資料表逐表筆數及 SHA-256 資料雜湊不變。
- 編譯後程式以真實受限 `qigong-api` login、隔離 mock OIDC session 驗證8個雙語後台頁面、12個報表、CSRF／未登入邊界與 Telegram 雙語；網路 sender 為 mock，未對真實帳號送測試訊息。另驗證實際 Authgear discovery 與正式 callback origin，不冒用管理員登入。
- 暫停平台 API／通知 timer，等待在途 worker 結束；取得最終 DB custom dump、完整 cluster roles、受限平台 env／systemd 設定備份。站外副本以 AES-256-GCM 加密保存，解密金鑰與副本位於工作站 repo 外的受限目錄，未輸出／提交憑證。
- 從最終站外加密 DB 副本實際還原至隔離 cluster，31張資料表及 schema 與停機快照完全一致；舊 binary 在還原的 `0012` 上 readiness 通過。解密完整性／archive catalog／篡改拒絕均驗證。
- 正式完整套用 `0013–0017`，重跑遷移零新增，既有31張表完全一致；凍結快照為2位 person、2筆 check-in，既有關聯／歷史未改寫。切換同版 API／worker 後，公開 readiness 為 `ready: true`、runtime login 為 `qigong-api`，API／通知 timer active。
- 維護窗口為 **18:39:24–18:39:39 UTC（15秒）**。公開 HTTPS 的19項煙霧測試涵蓋雙語未登入頁／cookie、API401、無效 callback400、Telegram 頁面與無效 webhook401、新 LINE／WhatsApp 路由404；未送真實測試訊息。這不等於真人登入、桌機／手機視覺或 provider 裝置驗收。

## 正式環境與回復邊界

- Singapore `sgp1`、Ubuntu24.04、`152.42.183.10`，1vCPU／2GiB RAM／無swap，單機試行，不宣稱高可用或容量保證。
- `/opt/qigong-platform/current` → `/opt/qigong-platform/releases/0ed750de5871fddb77acca09ad4d5ca367dbd8b1`，前版ccd06a9／schema20保留。API `qigong-platform-api.service`／qigong-api／127.0.0.1:3100；通知worker timer／service以qigong-notifier運行。僅更新90-release.conf的ExecStart／SERVICE_VERSION，保護api.env／notification-worker.env未變。
- root操作／最終備份 `/root/qigong-deploy-0ed750d`；工具 `/opt/qigong-platform/deployment-tools/0ed750d`，一次性腳本 `/tmp/qigong-release-0ed750d/`。站外加密副本 `~/.local/share/qigong-platform/backups/deployment-0ed750d/`，key另置受限 `backup-keys/deployment-0ed750d.key`；不輸出原文或放入repo。備份涵蓋DB／roles／env／systemd，並非完整OS／Caddy復原。
- exact0021的API／worker必須同版。21→20回復需停API／timer、等worker結束，配對還原最終20 DB＋ccd06a9 release／備份old-release.conf及同版worker。**重開流量後DB還原會失去後續寫入，須另核准與對帳，不能像同20 UI-only只切binary。** 最終站外DB已實際隔離還原、舊程式readiness及完整資料核對通過。
- 正式快照rehearsal cluster已停並清除；root備份／artifact保留。工具仍為一次性腳本，不宣稱通用自動部署；每日19:20UTC既有cron未重新核對，監控／保留與跨主機災復待完成。

## 已部署功能與限制

- `/admin/`、`/admin/leaderboard`、`/admin/method-analysis`、`/admin/applications`：原生 SVG／響應式 shell，無舊 Bootstrap／Chart.js CDN 或新依賴。保留 Authgear、單筆／批次核准拒絕及 CSRF；不搬舊登入／舊資料。
- 報表取 `learner.read`／`checkin.read`／`stats.read` scope 交集，遵守目前 person 授權／主要地區。班級僅額外可讀目前主要地區 metadata，歷史 assignment 原地區隔離不放寬。以 person／練習日期計算人日，多選功法不增加天數；不是歷史地區績效歸屬。
- 管理後台測試含地區／國家／全域／班級／唯讀／越權／停用／到期、日期／分頁／連續與個人分析、VM scripts／XSS／SVG／過期 request；未取代真人瀏覽器驗收。完整清單見 `docs/operations/admin-dashboard.md`。
- 管理介面優先合法 URL `lang`，其次安全 locale cookie，預設繁中。四頁側欄切換保留已套用 URL 條件／personId，重設分頁；待審切換須確認清除未送出勾選／理由，絕不自動提交。不翻譯姓名／自填理由，非跨裝置 DB 偏好；Authgear 外部登入畫面不在翻譯範圍。
- Telegram 私聊 `/language en`／`/language zh_TW`、申請／打卡頁、回覆、功法／歷史／通知跟隨管道偏好。偏好可在申請前建立，網頁更新須有效、身份綁定短效 token；舊語言 update 不覆寫較新設定。LINE 維持繁中。
- **Policy A 已正式套用**：每次新核准建立獨立 person，不依姓名／Email／電話自動關聯；既有關聯不拆分。合併／跨管道切換自助流程未實作，person／date 唯一不等於真人去重。
- 核准學員共用上架功法，功法可見不等於課程完成／AI 推薦資格；未來 AI 只取結構化允許清單，RAG 解釋官方內容。日期依學員練習時區，昨天中午前可補登／更正，資料庫再次驗證期限；父節點全選只提交葉節點。
- WhatsApp 專用 Cloud API adapter 已含 raw-body HMAC、WABA／電話隔離、inbox 去重、短效連結、雙語申請／狀態／審核／打卡／歷史／補登／更正與模板通知。明確勾選通知同意，`STOP` 撤回；缺同意不發模板，過期入站不回自由文字。模板／account／手機尚未驗收，未發真實 Meta API 請求。
- WhatsApp 去重不等於 exactly-once：外部發送在 domain transaction 內，上游接受後 timeout／commit 失敗仍可能重複。`delivered` 僅代表 API 接受，非裝置收件；status callbacks／耐久 reply outbox／保留清理／負載與 rate-limit／重新同意流程未實作，撤回不能取消已在途訊息。LINE webhook 仍缺耐久去重。

## 待辦與注意事項

1. 真人以 Authgear 完成後台繁中／英文桌機／手機驗收，確認導航／篩選／個人分析／單筆批次審核及不同地區／班級拒絕；不要拿正式學員當合成測試資料。
2. 完成管理端心得／tag／成就榜頁面與路由；Telegram學員成就模型／評估及reconciliation已部署。核准季節日曆及真人Telegram四頁／私人摘要驗收；AI評語另外審核。
3. 新 LINE／WhatsApp 官方帳號、專用電話及模板由管理者私下設定；依 `line-pilot.md`／`whatsapp-pilot.md` 驗證後另批准啟用。LINE Login Channel ID 不等於 Messaging Channel ID，LIFF fragment／手機行為待驗證；舊 Bot 不變。
4. 建置可重複、版本化且不含 env 的 release tooling、監控／備份保留與復原排程；維持 schema 相容性 gate，擴大使用前補容量／負載驗證。
5. 更新過時 README／pilot／ADR 階段描述。資料庫測試須隔離、名稱含 `test` 的 `TEST_DATABASE_URL`；無 URL 的 skip 不能算整合通過，受控共用 roles 的測試避免跨套件 DB 平行衝突。
6. 額外全測試檔型別檢查仍有既有 `QueryResultRow`／exact optional 等錯誤；標準 `pnpm verify` 的 source typecheck 通過，不含該額外檢查。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
