# 候選25隔離渠道試行

## 已完成與邊界

- 使用者核准提交／推送、CI及隔離測試部署，先LINE再WhatsApp專用測試帳號驗收；不包含正式部署、正式政策發布、正式provider啟用或舊Bot變更。
- 程式commit：`75834f6ddbd5e484c9003890a265e1e5dc1609d0`。GitHub [CI 38055345937](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38055345937) 成功；提交前完整425項通過、無skip。間歇性權限／WA錯誤根因仍未定位，本試行不表示已修復或可正式發布。
- 正式仍為`852cd05`／schema22；本次沒有連線或修改正式DB／API／timer／env／DNS／Caddy／Bot設定。未納入另存的web-admin-permissions-review草稿，未修改0001–0022、依賴、lockfile或授權metadata。

## 本機隔離部署演練

- 從git archive取得上述精確commit，在repo外以frozen lockfile離線安裝及建置；舊22 artifact來自`852cd05`。沒有使用dirty worktree充當release。
- Docker `qigong-candidate25-stage`，PostgreSQL16，僅`127.0.0.1:55441`；與整合測試container及正式cluster獨立。資料庫`qigong_candidate_test`，API／worker各有NOINHERIT、非super／非bypassrls登入，僅分別隸屬runtime role。隨機密碼只放repo外受限檔案，未貼入對話／日誌／Git。
- 全新合成／catalog資料先完整套用0001–0022，再升級23–25；不是正式快照，也沒有真人學員資料、既有正式check-ins或正式憑證。
- 54張原表均保留，升級後63張（此口徑包括public ledger／extension表）。原表內容變更僅permissions、role_permissions、platform_metadata、schema_migrations；完整重跑零遷移。不是正式資料指紋保留證明。
- 舊22 API對22 ready、對25拒絕；候選25 API對22拒絕、對25 ready，皆用編譯後程式及受限登入。
- 22／25 synthetic custom dumps各實際還原到独立restore DB，逐表完整列排序雜湊／筆數與原snapshot相同；還原22配舊API、還原25配候選API的readiness均通過。這不是正式站外加密備份或正式rollback演練。
- 政策只有draft、active為零；沒有自動發布／同意／歷史分享。worker schema gate通過、LINE／WA／TG receipt queues均空，worker直接讀policy表遭42501拒絕。真實provider發送為零；未啟動排程或使用假TG token啟動正式worker entrypoint。

## 正在運行的本機API

- `http://127.0.0.1:3115/health/live`回精確release；`/health/ready`為schema25／受限qigong-stage-api ready；`/privacy`可閱讀draft文件。
- repo外runner使用compiled `buildApp`，**不配置adminAuth或任何provider**。管理／渠道路由404是此配置的預期封閉狀態，不是已完成Authgear／LIFF／WhatsApp真人驗收，也不是完整production `index.ts`的設定验收。
- 一次性artifact／runner／evidence／synthetic dumps位於`/tmp/qigong-release-75834f6/`；API PID位於該目錄`api.pid`，目前無systemd與自動重啟保障。tmp可能被清理，不能作為長期服務／災難復原保證。測試DB在Docker獨立volume，未修改正式掛載。
- 停止時核對PID／command後對该runner發TERM，再停止`qigong-candidate25-stage`；勿停止其他container。保留dump及evidence直到試行結束，未授權自動刪除測試內容。

## 真人測試前尚需確認

1. 公開測試HTTPS hostname、承載主機及TLS／網路入口；本機loopback不能作為LINE／Meta webhook callback。不得沿用正式hostname路由或自行增加付費主機。公開前需部署可持續運作的matching25 API與獨立DB／受限worker，核對callback Origin／秘密檔案／零正式sender。
2. 專用LINE Messaging Channel、LINE Login Channel及LIFF app。依[line-pilot](line-pilot.md)私下配置；Login Channel ID不是Messaging ID，LIFF endpoint使用測試origin下的`/line/`，webhook使用測試origin下的`/line/webhook`。不可改舊帳號或舊LIFF。
3. 專用Meta app／sandbox WABA及phone-number ID、明確Graph API版本、允許的測試收件人，webhook使用測試origin下的`/whatsapp/webhook`。依[whatsapp-pilot](whatsapp-pilot.md)配置；未核准模板不發送、24h窗口外不強送自由文字。
4. 測試Authgear client／精確callback URI與測試管理員身分核對，不能依Email／電話自動授權。沒有OIDC設定前不開mock admin登入供外網使用。
5. 憑證透過受限設定檔或秘密管理工具傳遞，不貼在對話／Git；先核對全套配置及Origin再啟動渠道。測試政策發布只由隔離Super審閱及明確操作，不變更正式policy。

## LINE→WhatsApp驗收順序

- LINE先核对官方帳號跳轉、LIFF真實ID token、未核准／核准與不同意流程，再五頁、日期草稿／時區、UUID重試／version衝突、摘要實際手機收件、分享／撤回／停用及跨區拒絕。
- LINE完成並記錄結果後，WA測試簽章／WABA／phone隔離、互動清單、五頁、本人及同意邊界、重試／更正、簽章入站24h窗口、窗口過期不發自由文字、STOP及摘要實際收件。
- 使用指定測試學員及無敏感示範內容；不搬正式學員或舊平台身份。API accepted不等於delivery，不宣稱exactly-once、回收在飛行訊息或已實作delivery/read callbacks。
- 每步記錄release／schema、裝置、通過／失敗及非敏感錯誤分類；間歇性授權錯誤出現即保留證據，不放寬檢查、不把重跑當修復。正式發布仍須另核准。
