# Telegram／WhatsApp schema28部署紀錄

## 核准與實際狀態

使用者明確核准一起commit、push、部署Telegram入口／reminder與WhatsApp更新，WhatsApp待Meta Business Portfolio完成後另設定。程式release為`79825b9b78802aff58667bf7fcd168a7a9a4a8bf`，CI [38277517503](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38277517503)成功，543項測試／格式／lint／source typecheck／build通過。額外all-test tsc仍為既有10錯誤。

正式schema為`0028_telegram_reminders.sql`，architecture `phase-13-telegram-reminders`。Telegram新訊息的功能指令回單一帶icon的WebApp按鈕，`/start`保留五個入口；slash本身不能自動彈Mini App。

**WhatsApp仍未啟用；Telegram reminder worker開關仍關閉；隱私政策仍draft。**既有LINE／Telegram摘要及申請通知排程正常。沒有改正式env、webhook、Meta assets或憑證，未發送真人測試訊息。`/remind`設定可使用，但每日提醒／本人預覽需另行核准啟用worker flag；設定on不等於目前已在發送。

## 演練与備份

- 精確git archive過濾env／macOS metadata；遠端Node24／frozen lockfile建置，manifest含source／compiled dist／歷史migration／lockfile SHA256，無憑證檔案。
- 正式26快照及roles在僅Unix socket55442的隔離cluster實際還原；全部表指紋相同、matching舊`97de588` API ready。
- 26→28只新增0027、0028，重跑零新增；原62 application tables／6 people／10 check-ins及全部非metadata列指紋保留。新增4表為空、零session／reminder設定／同意／origin回填，政策狀態相同。
- compiled受限API測試保留Authgear verified email／issuer＋subject／授權revision、admin／LINE／Telegram／journal／brand／scope／外部分享撤銷。新入口icon／reminder opt-in与replay／WA cookie-CSRF-logout-save-retry在合成身份通過，WA零summary。
- compiled worker以mock fetch驗證新gate、LINE／TG與reminder lane；僅隔離worker暫時開啟reminder，合成本人preview送達狀態1、WA receipt0；所有transport是mock，非真人送達。
- 最終DB／roles／env-systemd備份在站外AES-256-GCM加密、分離600 key，逐一解密SHA256核對。解密的roles設定實際重套於隔離cluster（已有角色的CREATE排除），DB解密後實際還原，完整指紋一致、舊26 API ready，再遷移正式資料庫。

## 維護及上線驗證

第一次停站發現舊`/tmp`加密工具不存在，**未套遷移**，立即恢復26：2026-10-12 16:38:13–16:38:37 UTC約24秒。找到持久備份目錄內原工具，先做工具syntax／加解密round-trip，再重取新的最終快照，不沿用第一次dump。

成功切換維護為**2026-10-12 16:40:30–16:40:47 UTC，17秒**。只套27＋28并重跑，before-switch資料比對通过才切symlink／API release drop-in，ready後恢復原timer。兩次維護都記錄，不將總中斷描述成僅17秒。

- 主站113檢查＋1個公開500×500 PNG驗證共114項通過。
- API active、NRestarts0、ExecMainStatus0；notification timer active，matching新worker Resultsuccess／ExecMainStatus0。
- 新reminder gate true，舊27與26 worker gate false；API exact28。
- 兩份protected env byte hash不變；WA routes404，WA session0、reminder settings0、jobs0、active policy0。
- 合成public LIFF query probe的實際API日誌req.url为`[REDACTED]`；未輸出私人日誌／憑證，不保證外部平台不記錄私人網址。
- 正式沒有合成learner／principal／admin session／partner client或真人測試訊息。隔離cluster已停止，相關證據保留。

## 恢復材料

- `/root/qigong-deploy-79825b9`
- `/opt/qigong-platform/deployment-tools/79825b9`
- `/var/lib/postgresql/qigong-rehearsal-79825b9`（已停止）
- 工作站`/tmp/qigong-telegram-release-79825b9`及prepare／activate／CI logs。
- 受限站外`~/.local/share/qigong-platform/backups/deployment-79825b9`，獨立`backup-keys/deployment-79825b9.key`；不得加入Git或對話輸出。

28→26回復必須matching26 DB＋`97de588` API／worker及原`old-release.conf`，不能binary-only。已開流量後回復需另核准、對帳新寫入與通知狀態；不把舊snapshot直接覆寫新學員資料。此證據不是完整OS／Caddy災復。

後續：由學員測試新Telegram單入口，另核准開啟Telegram reminder worker才能驗收真實預覽／每日提醒；Meta權限／App／WABA／電話／範本完成後，另核准WA配置與啟用，做手機cookie／書籤／無summary驗收。不需再次開啟舊Bot。
