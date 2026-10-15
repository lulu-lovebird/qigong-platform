# LINE邀請核准後聊天交接部署（同schema34）

使用者另核准commit/push/deploy。正式程式 `d8d4e6679993a018819b790fe608197934045f46`，CI [38737168221](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38737168221)成功／696tests。

**2026-10-15 12:54:02–12:54:21 UTC，維護19秒。**same-schema34／phase-19-community-notes，只切matching API-worker／API drop-in；沒有migration applier、資格／quota／政策／通知或Console變更。

## 行為

既有核准重訪與首次核准成功，都不再由邀請頁直接開checkin。SDK初始化與server資格驗證後，mobile LIFF嘗試以external:true開固定 `https://line.me/R/oaMessage/%40556fjenc` 小幫手聊天；由本人在小幫手按練功打卡，建立正確來源情境。

- 主按鈕手勢重試bridge，另保留不經bridge的普通anchor；unsupported desktop/external／缺API／throws提供手動提示。void不視為成功，仍顯示「已嘗試」。
- 不立刻close原LIFF、不自動送「打卡」或預填訊息、不補推回條；原正常核准與打卡回條發送不變。聊天URL沒有invite、resume、ID/access token、UID或任何query/hash。
- completed guard清本頁invite/privacy參照、reset表單，返回／retry／重複submit不再查詢或redeem；資格／必要同意仍由原backend確認。這不是新的授權方式。

## 驗證及恢復

- 發布前獨立PG16／55458再次完整pnpm verify：696（API509／DB179／config2／identity6）、format/lint/source TS/build成功，exact SHA CI亦成功。額外all-test tsc原10錯及既有共用叢集flakiness未宣稱修復。
- exact archive排除env/macOS metadata，主機Node24／frozen build，source/dist/lockfile/全部歷史migration SHA256 manifest保留；0001–0034、dependencies與API/worker gates未變。
- 正式34 DB＋roles clone實際restore，完整指紋相同、原592 API ready／新舊34都ready。最終停API並drain worker後，站外AES-256-GCM DB/roles/env-systemd逐一decrypt/hash，解密roles設定重套、DB實際restore、完整指紋相同／原592 ready後才切換。
- contract僅SELECT ledger/checksum/readiness，沒有DDL；**75 application tables／17people／23checkins**的最終停寫快照及全部資料、metadata前後完全相同，沒有代學員核准、扣額、身份／同意回填或正式測試訊息。
- Messaging API只讀bot/info確認目前Basic ID確為%40556fjenc所指的小幫手，避免fixed chat target與實例憑證不符；未改任何Console／token。

## 新發布包隔離驗收

- 在受限qigong-api＋實際還原clone執行完整compiled HTML/scripts，fetch bridge打真compiled API，LINE signed webhook使用合成subject／provider mock、不對LINE發送。
- early follow／加好友／subject-bound resume／清fragment reload與新資料確認後：server approved後只有固定chat openWindow參數，無checkin redirect／close/send；history API仍200，表示改的是落點、不是練功資格。
- 一般pending本人有效invite確認也同樣開chat，原UUID核准、沒有新invite review event，manual downgrade409；兩次新核准quota精確2。
- revoke合成invite後，原已核准者再次點原cap仍依本身資格通過，不填表／耗額；iOS/Android native、desktop/external、throws均驗證primary/plain fallback、無憑證URL、返回與retry不重做server操作、無close/send。
- 舊smoke原本預期checkin location.destination，已按新需求更新；Node vm跨realm物件的strict prototype comparison改成JSON DTO精確值比對（url/external），未修改產品來迎合測試。
- 原scoped admin/Authgear/grant revision、LINE-TG workspace、journal/sourceHash/withdraw/external revoke/brand、明示心得跨渠道與legacy private、通知頁整HTML中英雙勾真API save、matching worker(mock)皆過。
- Chrome390/1280共20合成布局涵蓋首次／重訪／privacy／fallback／不合格，真DOM操作／URI參數／no secret／no auto send/close、zero overflow/exception。**不等於真人LINE切換聊天或close來源驗收**；不把SDK void或mock通過說成真機成功。

## 上線檢查與保護

- 143主站HTTPS＋1公開PNG共**144checks**通過，固定helper-chat兩個入口／新label／無direct checkin/close/send、既有badge icons與community notice仍上線，guest gates不變。
- synthetic private query probe對應真實req.url日誌[REDACTED]；不讀出／輸出私人token、cookies、codes或個資。
- APIactive/NRestarts0/status0、timeractive、matching worker Resultsuccess/status0。兩份env bytehash不變，review/learner reminder true、WA未配置、privacy draft、個人訂閱／綁定保持。

## 恢復與真人驗收待辦

- `/root/qigong-deploy-d8d4e66`、`/opt/qigong-platform/deployment-tools/d8d4e66`；`/var/lib/postgresql/qigong-rehearsal-d8d4e66`已停，臨時worker.env／合成community fixture已刪。
- 工作站受限`backups/deployment-d8d4e66`與分開`backup-keys/deployment-d8d4e66.key`，durable crypto helper事前roundtrip通過，不可進Git／對話。
- `/tmp/qigong-invite-chat-release-d8d4e66`與release verify/CI/prepare/activate logs；本機`/tmp/qigong-invite-chat-*`保留20截圖與driver。preview/Chrome與專用PG16 invite-chat container皆停，原共享cluster未動。
- same-schema可matching59241f4 API-worker＋old-release.conf回退，**不還原DB/env或覆蓋新寫入**；會恢復原從邀請直入checkin行為。另有DB事故才另核准backup還原及流量對帳，不是OS/Caddy完整災復，不保證in-flight召回。

請關舊頁，iPhone、Android都從**白雁官方帳號**點原邀請，驗收首次核准／既有學員重訪是否進小幫手，再**從小幫手點練功打卡**，保存關頁後確認回條在同一聊天。另驗自動被擋時主按鈕及普通連結；PC不支援scheme，封鎖者需解封。當前只部署程式，真機結果待使用者回報。

untracked web-admin-permissions-review.md與舊bot dirty資料保持排除，沒有批量測試任何正式學員。
