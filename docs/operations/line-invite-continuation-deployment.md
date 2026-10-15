# LINE邀請接續與本人待審確認：schema33部署

使用者明確核准commit、push及部署。程式 `4aa38f1709222e2f38b72f51c97bb8923f7f8d64`，CI [38677398987](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38677398987)成功。主站2026-10-15 **03:47:26–03:47:44 UTC**維護18秒，32→33成功；API-worker同版，exact `0033_line_invite_continuation.sql`／phase-18-line-invite-continuation。

## 驗證與資料保護

- 發布前本機再跑完整pnpm verify成功：651tests（API481／DB162／config2／identity6）、format/lint/source typecheck/build。額外all-test tsc原10錯與既有間歇測試問題未宣稱修復。
- exact git archive排除env／macOS metadata，主機Node24／frozen lockfile建置；release manifest保留archive、compiled dist、依賴metadata／lockfile及全部migration SHA256。沒有修改0001–0032、依賴、Console或憑證。
- 正式32 DB與roles快照實際restore到獨立Unix socket55442 clone，完整fingerprint相同、原8eaaa9b API ready，33 migration／重跑零新增、舊API gate拒絕／新API ready。
- 最終暫停API、drain worker後，DB／roles／env-systemd站外AES-256-GCM備份逐一decrypt並SHA256核對；解密roles設定實際重套、DB實際restore，同完整fingerprint及原32 API ready才正式升級。
- 正式migration前後，原**73 application tables、12people、17checkins**與所有非metadata表完整指紋相同，metadata僅architecture／updated_at改變，新continuation表空；沒有批量核准、移動地區、建立身份／綁定／偏好、隱私接受／事件回填或邀請扣額。

## 新發布包隔離驗收

- 受限qigong-api使用正式還原clone，沿用Authgear／scoped admin／grant revision、LINE-TG workspace、journal／sharing／brand／privacy驗收，matching worker實際入口配mock transport成功，沒有真人provider發送。
- 專用invite33 smoke執行**完整compiled HTML/script**，fetch bridge打實際compiled API、signed LINE webhook；early-follow不給一般申請URL，friend頁先保存本人短期接續，Bot導invite#resume，不回apply。不同subject不能用該resume。
- 清fragment後新VM重開，以驗證ID token取本人context；填資料explicit submit才核准，history API200，可打卡；新邀請不新增review event。
- 第二個合成subject先走一般申請產生pending，再開有效invite；確認前仍pending，舊manual API409不能降級；本人重新填資料後原申請approved、pending中心移除、history200。兩次新核准quota精確2，原已核准者無效invite重試不扣額。
- reviewer通知頁亦執行整compiled HTML／真API中英雙勾save，local locale／scoped checkbox正常；全部合成session／invite／申請／偏好／訊息僅在clone，最終restore後不進正式DB。
- actual Chrome390／1280 synthetic DOM submit、清URL後reload／visibility返回、pending提示／checkin redirect、零overflow／exception的本機證據保留；不是LINE手機真人驗收。

## 正式上線檢查

- 136主站HTTPS＋1公開PNG共137checks：exact release／schema33 ready、invite continuation marker上線、原登入／權限與既有功能不變。public probes沒有建立正式session／邀請或代核准。
- synthetic LIFF query probe對應req.url實際日誌為[REDACTED]，沒有將private URL、token、cookie、確認碼或PII寫入證據輸出。
- APIactive／NRestarts0／ExecMainStatus0，timeractive、matching worker Resultsuccess／ExecMainStatus0。
- API.env與notification-worker.env兩份byte hash均相同；REVIEW_NOTIFICATIONS_ENABLED=true與TELEGRAM_REMINDERS_ENABLED=true不變，WA未配置／draft政策保持。沒有新增測試訊息；已啟用worker仍依原個人偏好及scope正常運作。

## 恢復材料與限制

- `/root/qigong-deploy-4aa38f1`、`/opt/qigong-platform/deployment-tools/4aa38f1`保存source manifest／before-after指紋／old-release.conf／還原證據及部署工具。
- `/var/lib/postgresql/qigong-rehearsal-4aa38f1`已停止；clone臨時worker.env已刪。
- 工作站受限`backups/deployment-4aa38f1`及分開保存的`backup-keys/deployment-4aa38f1.key`；不可進Git／對話。durable crypto helper事前encrypt/decrypt roundtrip通過。
- `/tmp/qigong-invite33-release-4aa38f1`與`/tmp/qigong-invite33-release-{verify,ci,prepare,activate}.log`；本機Chrome／VM證據見line-invite-continuation設計文件。
- 33不能只切binary回32；降級須matching32DB＋8eaaa9b API-worker／old-release.conf。流量後要另核准並對帳新核准／身份／quota／context／通知等寫入，不能直接覆蓋掉新資料。不是完整OS/Caddy恢復，也不保證召回provider已接受的in-flight訊息。

## 真人待驗收

原pending學員重新開**原有效邀請**，完成必要同意（若適用）、填／確認本人資料與邀請地區，按「加入並開始打卡」，應直接進打卡。加好友後若原頁關閉，點小幫手的接續邀請；OAuth早期還沒保存context時，提示重新開原邀請，不會自動發一般表單。resume固定15分鐘，逾時重開原邀請。既有待審不因部署自動批核，已發出的舊提醒保留。
