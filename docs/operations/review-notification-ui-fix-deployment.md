# 通知設定locale／checkbox修復部署（同schema32）

使用者核准commit/push/deploy。程式`8eaaa9b370addd45211fa7c848cf1e1d60d2e51e`，CI [38665560311](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38665560311)成功／636 tests、format/lint/source typecheck/build；額外all-test tsc仍既有10錯誤。

僅通知頁獨立IIFE定義render locale，修正save/disconnect/events引用shell局部locale的ReferenceError；#notify-preferences專用flex label、固定checkbox與可換行span同列，無全站label改動。沒有migration／SQL或provider／授權變更，API-worker仍exact`0032_review_notifications.sql`／`phase-17-review-notifications`。

## 驗證及恢復證據

- exact git archive排除env/macOS metadata、Node24 frozen build、source/dist/lockfile/歷史migration SHA256 manifest保留。
- 正式32 snapshot＋roles隔離Unix socket55442實際還原，完整fingerprint一致，原8f98da9與新API同schema32皆ready。**不執行migration applier**，僅讀ledger／checksum／schema contract。
- 原73 application tables／12 people／16 checkins與完整metadata、所有表指紋保留，不改bindings/preferences/events/deliveries/roles或session。切換前後exact compare，不只忽略metadata。
- compiled受限admin/Authgear/grant revision/LINE-TG/journal/sharing/brand/scope與matching worker(mock)正常。
- 隔離以合成admin session執行實際render出的完整HTML/script，fetch bridge打真实compiled API，驗證zh/en兩次真正保存兩種checked偏好与正確locale，global不注入locale；為測試自行做雙向綁定，只改clone合成帳號，无真人訊息或正式preferences寫入。
- VM7項包含events locale、save、disconnect、error保留、binding/test；合成Chrome390／1280雙語4布局、actual form submit保存、checkbox text左右同列／first-line top差<=6px／零overflow與JS exception。
- 最終站外AES-256-GCM DB/roles/env-systemd逐一decrypt SHA256核對，roles設定實際重套、DB解密後實際還原，完整fingerprint相同／原8f98da9 API ready才切主站。

## 正式切換

**2026-10-15 01:34:07–01:34:23 UTC，維護16秒。**只切same-schema release symlink／API drop-in、ready後恢復timer；沒有資料庫遷移。

- 135主站＋1公開500×500 PNG共136HTTPS checks通過，正常auth gates與原功能不變；設定真正操作／layout在隔離與synthetic browser驗證，未拿正式管理員cookie代儲存偏好。
- APIactive/NRestarts0/ExecMainStatus0、timeractive、matching worker Resultsuccess/status0，exact32 ready。
- API.env与worker.env bytehash不變，REVIEW_NOTIFICATIONS_ENABLED=true與TELEGRAM_REMINDERS_ENABLED=true保持，WhatsApp未配置、政策未發布。
- 真實synthetic LIFF request query probe日誌req.url `[REDACTED]`；沒有讀出私人日誌、recipient或綁定token/confirmation code。
- 無正式合成learner/principal/session/client/invite，無測試msg／批量訂閱或變更學員偏好。

請管理員關閉舊通知頁、重新進`/admin/notifications`，勾兩項並保存；若保存成功，再由本人點測試通知驗收Telegram。這是待真人確認，不將mock／隔離保存當作正式帳號已儲存。

## 恢復材料

- `/root/qigong-deploy-8eaaa9b`／`/opt/qigong-platform/deployment-tools/8eaaa9b`
- `/var/lib/postgresql/qigong-rehearsal-8eaaa9b`（已停止）
- 工作站`/tmp/qigong-review-page-release-8eaaa9b`與release verify/CI/prepare/activate、UI smoke logs，`/tmp/qigong-review-page-fix-*`synthetic browser證據。
- 受限站外`backups/deployment-8eaaa9b`與獨立`backup-keys/deployment-8eaaa9b.key`，不得加入Git或輸出對話。

同schema32 UI回退可切回matching8f98da9 API-worker與old-release.conf，**不還原DB／不覆蓋新prefs或env**；此會恢復已知locale與排版bug，須按發布流程核准。只有另有DB損害且明確核准／對帳才使用backup。此非完整OS/Caddy災復，已送in-flight訊息不可保證召回。
