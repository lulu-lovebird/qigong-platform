# Telegram私人審核通知schema32部署紀錄

使用者核准commit/push/deploy。程式`8f98da918b5b951a5360479ba4a56dce3bc1af7b`、CI [38610844698](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38610844698)成功／629 tests、format/lint/source typecheck/build；額外all-test tsc仍既有10錯誤。主站exact`0032_review_notifications.sql`／`phase-17-review-notifications`。

**部署不等於開啟發送：REVIEW_NOTIFICATIONS_ENABLED維持缺省false，沒有批量綁定或訂閱管理員。**原Telegram learner reminders true、WhatsApp unconfigured、policy draft保持，兩份正式env／webhook／Bot Console／憑證未改。

## 演練與最終恢復

- exact git archive排除env/macOS metadata，遠端Node24 frozen lockfile build與source/dist/lockfile/migration checksum manifest保留。
- 正式31 snapshot＋roles實際還原隔離Unix socket55442 cluster，完整fingerprint一致、舊fee82ba API ready；只套0032/reapply零新增，原69表／12people／16checkins與全部非metadata列指紋保留。
- 新preferences/challenges/events/deliveries四表空，无歷史pending events／binding／opt-in／角色／person／同意回填。
- compiled受限admin/Authgear verified profile與grant revision/LINE-TG/journal/source conflicts/share withdrawal/brand/scope通过；new reviewer normal-session/CSRF/private signed bind/group rejection/last4 masked/default opt-out/final web confirmation/test rate/complete pending learner event/non-PII state通过。
- 僅隔離worker用環境override reviewer flagtrue及mock fetch驗證test與merged learner通知2組、3 delivery rows sent；private bind確認回覆也是mock。無真人訊息、正式綁定／profile修改或合成申請。
- 最終站外AES-256-GCM DB/roles/env-systemd逐一decrypt SHA256核對，roles設定實際重套、DB由解密副本實際還原至clone，完整指紋相同／舊31 API ready後才正式遷移。

## 正式切換

**2026-10-14 18:04:21–18:04:39 UTC，維護18秒。**只套0032/reapply/data比對成功才切symlink與API drop-in，ready才恢復timer。

- 135主站＋1公開500×500 PNG共136HTTPS checks通過；正常通知設定路由已註冊，guest頁302/API401，guest綁定／confirm／prefs／test拒絕。
- APIactive/NRestarts0/ExecMainStatus0、timeractive、matching worker Resultsuccess/status0；newops.review_notification_schema_ready true／旧31gatefalse，exact32。
- 正式兩份env byte hash不變，learner reminder true、reviewer worker off、WhatsApp unconfigured／activepolicy0。
- 正式新四表全0，沒有自動替任何管理員綁定、建通知偏好／歷史事件／寄測試或批量alert。管理員自行開通知頁後才保存本人設定。
- actualsynthetic LIFF query request req.url `[REDACTED]`，未輸出私人日誌、code/token/recipient，不保證外部平台不記錄私人URL。

## 真人綁定與啟用

管理員可正常登入`https://checkin.baiyinqigong.org/admin/notifications`：產生token指令→新平台Bot本人私聊`/admin_notify <token>`→拿到6位碼→回原登入後台確認→勾選申請類型與保存。不得把token或碼交給他人；沒有姓名/Email/phone比對或身份合併，群組不能綁定。

此步可完成綁定，但實際alert與本人test由reviewer worker發送，目前global flag尚未啟用；如需試收通知，須另核准將`REVIEW_NOTIFICATIONS_ENABLED=true`。開啟後仍只發給已綁定、主動opt-in、當下仍有該申請審核權限者；沒有收件人保留unrouted warning，不自動挑人綁定。請依[review-notifications](review-notifications.md)測角色/跨區/已處理/改區取消，聊天只包含kind/region/count与正常需登入的審核URL。

policy仍draft、不因測試發布；LINE預核准完成不發待審通知。provider mock不是Telegram真人送達、手機通知設定或exactly-once證明。

## 恢復材料

- `/root/qigong-deploy-8f98da9`／`/opt/qigong-platform/deployment-tools/8f98da9`
- `/var/lib/postgresql/qigong-rehearsal-8f98da9`（已停止）
- 工作站`/tmp/qigong-review-release-8f98da9`及release verify/CI/prepare/activate logs。
- 受限站外`backups/deployment-8f98da9`與独立`backup-keys/deployment-8f98da9.key`，不得加入Git或輸出對話。

32→31需matching31DB＋fee82ba API-worker与old-release.conf，不可binary-only；開流量後需另核准並對帳新events/delivery/bindings/prefs及其他寫入。若已啟用alert後暫停，可另核准只關reviewer flag，不覆蓋整份env；不保證OS/Caddy災復或in-flight訊息召回。既有間歇性回歸診斷保留，不因CI/smoke通过稱根因已修復。
