# LINE手機心得流schema30部署紀錄

使用者明確核准commit／push／部署。程式release`e2e9a4baaa6d4c109360bbe3bf1edc98ca7f39c4`，CI [38491423796](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38491423796)成功／588 tests、格式／lint／source typecheck／build；額外all-test tsc仍為既有10錯誤。

主站exact`0030_line_journal_stream.sql`／`phase-15-line-journal-stream`；LINE rich menu `/journal`網址不變，重新開啟取得新HTML。新社群卡片為10筆keyset向下追加，含歷史地區、提交／分享時間及record timezone、截止該筆日期的streak／total；長文可展開。「我的心得」及TG／WA／staff／external既有分頁與分享保留。

## 演練及最終備份恢復

- exact git archive排除env／macOS metadata，Node24／frozen lockfile遠端建置；source／compiled dist／lockfile／歷史migration checksums及manifest保留。
- 正式29快照及roles在僅Unix socket55442的隔離cluster實際還原，完整fingerprint一致、舊0410e5f API ready；只套0030并重跑零新增。
- 原68 application tables／11people／14checkins、全部非metadata列指紋及privacy狀態保留，沒有新table、修改舊share／private notes、回填同意／session／invitation／reminder資料。
- compiled受限Authgear verified profile／issuer-subject／grant revision、admin／LINE-TG／journal／sharing撤銷／brand／scope通過；新cursor10／equal timestamp tie-break／25筆無重複／as-of25 streak和26 total／historical region-time／私密原文不回傳／舊20與own editor保留通過。合成資料只存在clone，mock transport無真人訊息。
- matching新worker仍啟用Telegram reminder，mock正常摘要／badge lane通過，WhatsApp未配置。
- 最終站外AES-256-GCM DB／roles／env-systemd逐一解密SHA256核對；角色設定實際重套於隔離cluster，DB由解密副本實際還原、完整fingerprint相同、舊29 API ready，才遷移正式DB。

## 正式上線

**2026-10-14 00:47:23–00:47:41 UTC，維護18秒。**只套0030／重跑／before-switch fingerprint比對成功後切symlink／API release drop-in，ready後恢復原timer。

- 126主站檢查＋1公開500×500 PNG共127 HTTPS checks通過；新LINE journal HTML有stream／sentinel／load-more／stats與原publish sourceHash，非法cursor在認證前拒絕，不建立任何正式測試資料。
- APIactive／NRestarts0／ExecMainStatus0、timeractive、matching worker Resultsuccess／ExecMainStatus0。
- 新`ops.line_journal_stream_schema_ready()`true，旧29 gatefalse；兩份protected env byte hash不變，Telegram reminder flag維持true，WhatsApp unconfigured，active policy0。
- 實際synthetic LIFF query probe日誌req.url为`[REDACTED]`，未輸出私人日誌／token，不保證外部平台不記錄private URL。
- LINE Console、LIFF、rich menu及憑證未修改。沒有正式合成learner／principal／admin session／partner client／invite，沒有真人測試發送。

## 真人驗收

請從LINE rich menu重新開journal，而不是沿用舊開啟頁面。檢查首10筆、滑到底追加10、最後不足10停止、日期／時間／地區／streak-total、長心得展開及我的心得未存草稿確認。只有目前允許公開的share snapshot，不公開所有私密打卡或原文；aggregates告知已加入LINE sharing help與發布確認，但政策仍draft，不為測試自動發布。

390／430／1280合成Chrome布局及scroll10→10→3、去重、long-text wrap／mine switch已通過；這不是實際LINE手機／SDK身份驗收。cursor有30分鐘期限需refresh，不是跨request MVCC歷史snapshot；撤回後新讀取停止但已讀畫面不保證即時召回。

## 恢復材料

- `/root/qigong-deploy-e2e9a4b`
- `/opt/qigong-platform/deployment-tools/e2e9a4b`
- `/var/lib/postgresql/qigong-rehearsal-e2e9a4b`（已停止）
- 工作站`/tmp/qigong-line-stream-release-e2e9a4b`与verify／CI／prepare／activate logs。
- 受限站外`backups/deployment-e2e9a4b`與獨立`backup-keys/deployment-e2e9a4b.key`，不得加入Git或輸出對話。

30→29需matching29DB＋0410e5f API／worker与old-release.conf，不可binary-only；流量後回復需另外核准并對帳新資料，不把舊snapshot直接覆寫新寫入。不保證完整OS／Caddy災復。既有間歇性回歸診斷仍保留，CI／演練通過不是其根因已修復。
