# LINE主站受控試行部署

## 核准與實際狀態

- 使用者確認小幫手尚未對學員上線，改用既有`https://checkin.baiyinqigong.org/`部署及測試，核准主站升級與worker補LINE token；不另建網域或付費主機。先前僅隔離部署的核准範圍由本次明確擴充，既有資料仍保留。
- **2026-10-11 07:18:03–07:18:19 UTC**部署，停機16秒；程式`75834f6ddbd5e484c9003890a265e1e5dc1609d0`、schema`0025_telegram_miniapp_sessions.sql`，API／worker exact25。程式[CI 38055345937](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38055345937)成功；來源為精確git archive、完整0001–0025、frozen lockfile與Node24建置，保存source archive／dist／migration checksums及manifest。
- LINE API與摘要worker已配置；WhatsApp API／worker均未配置、路由404。LINE Login channel可先保持Developing，由具該channel測試權限的人真人驗收。沒有修改LINE Console webhook開關、Login發布狀態或任何舊Bot／舊LIFF。
- 主站API active、NRestarts=0、ExecMainStatus=0；notification timer active，切換後worker Result=success、ExecMainStatus=0。Login／LIFF真人身份登入與實際聊天收件仍待使用者驗收，不把mock或Messaging token有效當作真人驗收完成。

## 正式資料快照與演練

- 升級前主站schema22快照在獨立PostgreSQL16 cluster實際還原，保留ownership／ACL／cluster roles，完整資料指紋含metadata与來源一致；舊852cd05 API對22 ready。cluster不開TCP，Unix socket／port55442與正式DB分離，操作guard核對database／data_directory／session_user。
- clone升級23–25，重跑零新增；舊22 API拒絕25、受限候選API ready。53張既有應用表、3 people及6 check-ins保留；升級後62張應用表。權限新增journal.read_shared及7個角色映射、platform metadata架構標記、新shared_with_staff欄位為預期變更，其他既有列完整排序雜湊不變；舊publication新欄位皆false，沒有回填origin／acceptance／staff分享。
- 編譯後LINE七頁／空signed webhook／錯簽章／Origin拒絕與WA404共14項smoke；Messaging token以LINE bot/info唯讀API確認有效，Authgear discovery與callback origin確認。沒有輸出token／LINE帳號ID／私人資料。Login channel audience與手機SDK仍待真人驗收。
- 編譯後mock OIDC＋受限runtime驗證後台、角色交易／CSRF／版本／自我保護、Telegram workspace及UUID重試、private note、journal來源衝突／撤回／合作憑證撤銷。僅clone新增合成fixture，未在主站新增合成帳號、check-in、publication或partner client。
- 同版worker在clone含LINE配置執行：onboarding0、LINE receipts0、badge1、Telegram receipts2；兩筆Telegram transport均mock，摘要allow-list確認沒有心得／感受。這是worker lanes／既有Telegram摘要演練，不是實際LINE手機收件。

## 最終備份與切換

- 暫停timer並等在途worker結束，停止API、確認無在途資料寫入後取得最終schema22 custom dump、cluster roles、API／worker env及systemd設定。API env備份含人員先前填入的新LINE設定，不重置它。
- 三份副本以AES-256-GCM送至工作站repo外受限backup目錄；每份實際解密、SHA256與主機原文比對。由站外加密DB副本解密串流實際還原到clone，含metadata的完整指紋與最終停機基線完全相同，舊22 API ready；完成後才遷移正式DB。
- 正式遷移23–25、重跑零新增及完整資料保留檢查通過，切換同版API／worker。`api.env`內容雜湊不變；worker env只追加同一個LINE_CHANNEL_ACCESS_TOKEN，原有全部內容逐byte保留，未改TG或WA設定。兩份檔案保持root及對應service group、mode640；憑證未寫入Git／ordinary logs／對話。
- 未發布政策：draft1／active0／acceptances0／new origins0／shared_with_staff0。未啟用提醒、LLM、成就通知或舊資料搬移。draft時既有加入／打卡行為維持，不要求新版同意，也不自動預設分享；政策／新分享行為須另由Super審閱發布。
- 公開Cloudflare→Caddy→API HTTPS **106項檢查通過**：精確release／schema、雙語TG與後台未登入拒絕、LINE七頁與無cache／referrer、空signed webhook200、錯signature401、Origin／schema拒絕、TG Mini App交換邊界、journal／partner／learner管理權限邊界、WA404。沒有真實測試訊息或新的主站partner client。

## LINE Console與真人測試

1. 新Messaging API Channel的Webhook URL：`https://checkin.baiyinqigong.org/line/webhook`。先按Verify，成功後由使用者開啟Use webhook；不要改舊官方帳號設定。伺服器signed empty驗證已通過，但Console帳號／設定核對仍由操作人完成。
2. 新Login Channel的LIFF Endpoint URL：`https://checkin.baiyinqigong.org/line/`，啟用openid；Login及Messaging Channel須使用正確Provider／官方帳號連結。Login Channel ID不是Messaging Channel ID。Developing時測試帳號要有該Login channel的Admin／Member／Tester權限，不因是Messaging channel管理員就推定可登入。
3. 用指定測試LINE帳號私訊「加入」，完成獨立申請；由既有授權管理員在`/admin/applications`審核，不依同名／Email／電話連結舊person。只有核准後才能使用打卡工作區。
4. 私訊「打卡」／功能選單，測LIFF手機登入、五頁、日期草稿／時區／版本衝突、更正／歷史、私人聊天摘要實際收件；摘要不含心得或感受。政策draft下不測新版同意／預設分享生效；發布政策須另確認。
5. 若未回覆／登入被拒絕／403／409，記錄操作時間、頁面與非敏感錯誤分類；不要貼idToken、私人fragment、cookie、電話或完整原始webhook。遇到間歇性權限誤判立即保留證據，不放寬授權。

## 恢復位置及限制

- 主站current指向`/opt/qigong-platform/releases/75834f6ddbd5e484c9003890a265e1e5dc1609d0`；旧`852cd05` artifact保留。備份與基線`/root/qigong-deploy-75834f6`，工具`/opt/qigong-platform/deployment-tools/75834f6`，工作站一次性腳本`/tmp/qigong-main-pilot-75834f6`；不是通用部署工具。
- 站外`~/.local/share/qigong-platform/backups/deployment-75834f6`，AES key另置受限backup-keys；不在repo／本文列值。clone已停，保留受限還原證據；不宣稱完整OS／Caddy災難復原或已重新驗證每日備份排程。
- 25→22回復須停API／timer並核對在途worker，配對還原最終22 DB＋852cd05 API／worker＋old-release.conf／受限設定；不能binary-only rollback。備份API env已含使用者新LINE值，旧binary重啟也會載入；是否停用LINE必須操作前確認，不宣稱自動回到先前LINE404狀態。
- 已重新開流量，還原會遺失之後的申請／打卡／同意／通知狀態，須另核准並對帳；不能召回已接受的外部訊息。優先保留失敗狀態與forward修正。
- 間歇性admin／WA／journal能力判斷錯誤根因尚未定位；本次經使用者核准為受控試行，不宣稱已修復。額外全測試tsc仍有既有10項錯誤；標準CI／source typecheck通過不代表該檢查乾淨。
