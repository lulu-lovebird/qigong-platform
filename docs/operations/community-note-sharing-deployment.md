# LINE／Telegram明示心得分享：schema34部署

使用者另核准commit/push/deploy。正式程式 `9d00120484f0ef46ba83ed65166c1ac176a60e4d`，CI [38719995438](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38719995438)成功／675tests。2026-10-15 **10:32:13–10:32:30 UTC**維護17秒，33→34／重跑零新增；matching API-worker，exact `0034_community_note_sharing.sql`／phase-19-community-notes。

## 功能與範圍

LINE、Telegram新版打卡表單顯示「打卡心得供所有學員閱讀」，Telegram英文對應，無分享checkbox、移除私密標題。寫新心得且提交新版notice才同交易刊登到已核准學員的心得流；不寫／空白不刊登，外部分享FALSE。舊私人文字不自動公開，舊client不升級分享，撤回及手動分享選擇保留；原有只有練功而沒心得的記錄可由本人首次寫新心得後分享。未回填網站／小幫手法律同意，政策仍draft；WA寫作預設不變。

## 發布驗證與回歸背景

- 原共用測試叢集出現身份／時間戳間歇失敗後曾按重試上限停止；使用者後續核准發布，改用全新獨立PostgreSQL16／loopback55454叢集，**完整pnpm verify 675項**（API488／DB179／config2／identity6）、format/lint/source TS/build成功，exact SHA CI亦成功。沒有放寬斷言或改正式授權條件，**不宣稱已找到／修復原共用叢集flakiness根因**。該專用本機容器已停止，原55440叢集未動；額外all-test tsc仍10既有錯誤。
- exact git archive不含env／macOS metadata，主機Node24與frozen lockfile建置、source/dist/歷史migration/lockfile manifest SHA256保留；未修改0001–0033、依賴或Console／憑證。
- 正式33 DB＋roles快照在隔離Unix socket55442實際還原，完整fingerprint相同、原4aa38f1 API ready，34 migration/reapply0；舊gate拒絕34、新API ready。
- compiled受限API保留原Authgear／admin scopes／grant revision／LINE-TG workspace／journal/sourceHash／sharing/external revoke／brand／privacy驗收。reviewer頁整HTML/script透過真API中英雙勾save仍正常。
- 專用community34合成fixture只進clone。兩渠道真compiled API測試空白不刊登、notice後跨地區／渠道可讀、UUID retry不重複、清空／重寫、手動撤回後save不重發、舊client私人記錄／加notice修改不公開、400拒絕錯notice/external注入、runtime private table／helper拒絕。
- matching worker真入口配mock transport通過，日期／功法等摘要仍不包含新公開或私人心得；不把公開在學員流等同可發到chat。沒有正式合成申請／心得／分享、測試訊息或實際provider傳輸。
- 本機actual Chrome390／1280、LINE繁中/TG中英、打卡＋feed共12頁，真DOM save攜notice與成功訊息、feed顯示、note卡沒有checkbox／私密標題，zero overflow／exception；SDK/backend為synthetic，不是正式手機交付驗收。

## 最終備份與切換證據

- 暫停API／drain worker後，最終DB／roles／env-systemd站外AES-256-GCM備份逐一decrypt及SHA256核對；解密roles設定實際重套、DB實際restore回clone，完整fingerprint一致、原33 API ready才正式migration。
- 升級前後**原74 application tables、16people、21checkins**（維護快照）及所有非metadata完整指紋相同；metadata僅architecture／updated_at改，新community origin表空。包括原私人心得、已有分享／withdrawal、invites/quotas、roles、sessions、bindings/prefs/notifications、privacy acceptances均保留，不是只比資料筆數。
- 139主站HTTPS＋1公開PNG共**140checks**通過；LINE/TG中英寫作告知及notice版號上線、既有invite/stream/登入權限不變。synthetic LIFF query對應實際req.url日誌為[REDACTED]；沒有輸出private URL／token／cookie／確認碼或PII。
- APIactive/NRestarts0/ExecMainStatus0、timeractive、matching worker Resultsuccess/status0。API.env與worker.env byte hash均不變，REVIEW_NOTIFICATIONS_ENABLED=true與TELEGRAM_REMINDERS_ENABLED=true保持，WA未配置／政策draft；未改訂閱、綁定或後台政策。

## 恢復材料與限制

- `/root/qigong-deploy-9d00120`、`/opt/qigong-platform/deployment-tools/9d00120`。
- 已停止`/var/lib/postgresql/qigong-rehearsal-9d00120`；臨時worker.env及合成community-fixture.json已刪。
- 工作站受限`backups/deployment-9d00120`與分開存放`backup-keys/deployment-9d00120.key`；不得加入Git／對話。durable crypto helper事前roundtrip通過。
- `/tmp/qigong-community34-release-9d00120`及release prepare/CI/activate logs、`/tmp/qigong-community-release-verify.log`；畫面／VM見`/tmp/qigong-community-notes-*`，preview/Chrome已停。
- **34不可只切binary回33**。回復須matching33 DB＋4aa38f1 API-worker與old-release.conf；流量後另核准對帳新心得／publication／withdrawal／origin與其他寫入，不可覆蓋新資料。不是完整OS/Caddy災復，不保證召回provider已接受的in-flight。

## 真人待驗收

關閉舊LINE/TG頁，重新開打卡，在新日期或原本未填心得的紀錄寫一則新心得，送出後由另一位已核准學員開心得流確認；空白不應新增卡片。既有私人心得不因改版公開，如要分享需本人到「我的心得」明確發布。沒有代學員寫測試或批量刊登。既有邀請流程已由使用者回報成功，本次心得手機端仍待驗收。
