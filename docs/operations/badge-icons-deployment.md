# 三渠道badge圖示部署（同schema34）

使用者明確核准commit/push/deploy。正式程式 `59241f4a389ae58a42812e19481ec0d42f41ed0a`，CI [38730275543](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38730275543)成功／684tests。

**2026-10-15 12:00:28–12:00:46 UTC，維護18秒。**同schema34／phase-19-community-notes，只切matching API-worker release及API drop-in；**沒有呼叫migration applier**，僅SELECT ledger/checksum/readiness contract，不重新計算或匯入正式badge資料。

## 發布驗證

- 發布前完整pnpm verify再次成功：API497／DB179／config2／identity6共684項，format/lint/source TS/build通過。實際成就API回覆49個code皆在共用圖示表，原combo revoked/version/sourceHash測試保持。
- 圖示對照原LINE bot schema及005/008 migration共49種，code aliases對齊而不搬回舊規則；三渠道共用renderer。五種渠道／語言的整份compiled HTML/scripts在Node24 runtime執行，逐一檢查49個glyph、名稱、非撤銷award狀態及獨立鎖；不注入renderer局部變數。
- Node VM測試stub一開始未模擬HTML中預設hidden的monthly history panel，誤走月曆而沒有badge；補上原HTML狀態後五組全部通過。這是測試stub修正，沒有改產品、獎章規則或API資料。
- actual Chrome390/1280、LINE繁中／TG-WA雙語10layouts，每頁49枚：正常／灰階opacity、獨立鎖、zero overflow/runtime exceptions。SDK/backend皆synthetic，WA正式仍未配置，不是三個provider真機交付驗收。
- exact git archive不含env/macOS metadata；主機frozen lockfile建置，source archive／compiled dist／全部歷史migration及lockfile SHA256 manifest保留。package、0001–0034與舊bot均未修改。

## 資料、備份與恢復證據

- 正式34 DB＋roles snapshot在隔離Unix socket55442實際還原，整體fingerprint相同、原9d00120 API ready；新舊API在相同34都ready，contract只讀、不跑DDL。
- 最終停API並drain worker後，DB/roles/env-systemd站外AES-256-GCM逐一decrypt/hash，解密roles設定實際重套、DB實際restore，完整fingerprint相同、原9d00120 API ready後才切換。
- 最終快照**75 application tables、16people、22checkins**，前後所有資料及metadata指紋**完全相同**（包含core metadata，不是忽略它）。badge definitions/awards/audit、community publications/origins、privacy、roles/sessions、invites/quotas、notifications/preferences皆保留。準備快照為21checkins，正式流量增加後以最終22快照重做還原，沒有恢復成較舊的21。
- 隔離compiled Authgear/scoped admin/grant revision、LINE-TG workspace、journal/sourceHash/external revoke/brand回歸正常；LINE/TG明示心得跨渠道、舊私人／撤回、empty/retry/external off與通知頁整HTML中英雙勾save也通過。matching worker只有mock transport，沒有真人測試訊息、正式合成學員／心得／獎章或偏好寫入。
- 正常worker排程與既有reconciliation邏輯不變；「未重算」指沒有因圖示修正發起批量重建／匯入或改awards，非關閉正常打卡後的既有reconciliation。

## 上線檢查

- **143HTTPS checks**（142主站＋1公開PNG）通過，包含LINE/TG中英成就頁圖示map／glyph／CSS已上線、舊通用trophy判斷已移除；現有功能與guest auth gates保留。
- synthetic私有query probe實際日誌req.url [REDACTED]；不輸出私人網址、token、cookies、確認碼或個資。
- APIactive/NRestarts0/ExecMainStatus0、timeractive、workerResultsuccess/status0。兩份env bytehash不變，REVIEW_NOTIFICATIONS_ENABLED=true／TELEGRAM_REMINDERS_ENABLED=true保留，WA未配置、privacy draft、不改個人綁定／訂閱。

## 恢復材料與回退

- `/root/qigong-deploy-59241f4`、`/opt/qigong-platform/deployment-tools/59241f4`。
- `/var/lib/postgresql/qigong-rehearsal-59241f4`已停；臨時worker.env與合成community fixture已刪。
- 站外受限`backups/deployment-59241f4`及獨立`backup-keys/deployment-59241f4.key`，durable crypto helper preflight通過，不可進Git／對話。
- 工作站`/tmp/qigong-badge-release-59241f4`及release verify/CI/prepare/activate logs，本機`/tmp/qigong-badge-icons-*`含10張截圖；專用PG16 badge測試容器／preview/Chrome均已停，原共用測試叢集未動。
- 同schema34可切回matching9d00120 API-worker與old-release.conf，**不還原DB/env、不覆蓋新寫入／不重算獎章**；會恢復舊通用trophy/lock顯示，按發布流程核准。只有另有DB損害及另行核准／對帳才用backup，不是完整OS/Caddy恢復，不保證in-flight召回。

請關閉舊成就頁後重開，由本人LINE/TG驗收圖示；WA程式已共用但provider尚未配置。個別OS字形可不同，原emoji本來有重複，不宣稱49個獨特圖片。既有共用叢集flakiness與額外all-test tsc10個既有錯誤未宣稱修復；untracked web-admin-permissions-review.md及舊bot dirty檔保持排除。
