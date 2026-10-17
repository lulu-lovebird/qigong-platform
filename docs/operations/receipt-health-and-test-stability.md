# 回條健康監測與測試穩定性（已部署362c4ef／schema37，正式告警未啟用）

## 範圍與狀態

使用者先核准第 2、3 項的本機實作／驗證，後續另核准 **commit、push、deploy**；**不包含啟用正式告警**。已於2026-10-17部署 **362c4ef**，維持schema37；見[部署、實際回復驗證與驗收界線](receipt-health-deployment.md)。本輪不改 migration 0001–0037、schema gate、資料庫權限、套件／lockfile、API 路由、派送資格、重試／租約或既有旗標。不修改 `docs/operations/web-admin-permissions-review.md` 與 legacy repositories。

監測程式、只讀收集工具與告警判斷已隨版本提供；收件對象、通知管道、監控排程安裝與啟用仍須另核准。工具不發 Telegram／LINE 訊息，也不復用學員提醒或審核通知綁定。

10 個額外測試 TypeScript 錯誤已清零。已修正兩個已知失敗 suite 中「原本應已生效」的 fixture 起始時間，並補確定性的時間窗測試。**第3項的環境時鐘問題尚未結案**：最後整輪曾再次遇到既有心得流空清單間歇，之後在專用叢集直接量到資料庫時間負差。沒有修正共享主機／VM clock，不能宣稱 PostgreSQL 間歇已根治。詳見下方證據與界線。

## Worker 進度與隱私

`practice-receipt-dispatcher.ts` 每次完成派送查詢都回報內部事件：有 claim 是 `batch`、空佇列是 `poll`。空佇列也代表成功完成輪詢，不等於已送出訊息。

`practice-receipt-worker.ts` 使用 monotonic `performance.now()` 計算 uptime／age。每 30 秒既有 heartbeat 附加每渠道：最後完成輪詢、最後無失敗輪詢、最後錯誤的 age、連續失敗輪數、累積失敗訊號、schema mismatch。失敗批次不更新成功時間；schema mismatch 保留於本 invocation。成功 idle poll 不逐秒寫 log。每渠道獨立，LINE 未設定時其進度為 null；操作端目前明確預期 LINE 和 TG 都可用，不能把意外停用 LINE 當健康。

日誌／健康報告只有 allowlisted 渠道、數量、時間與狀態；沒有 recipient、identity/person ID、token、provider diagnostics、payload、心得或感受。告警狀態同樣不含個資。

## 只讀收集工具

`scripts/check-receipt-health.mjs` 須由 **Node24、完整 source checkout／既有 dependencies** 執行（使用原生 TS type stripping；沒有新增依賴）。有三種模式：

- `--local --since <UTC ISO>`：Linux root 操作端，只讀本機固定 systemd unit、當次 invocation／當次 boot 的最後 heartbeat，並透過固定 local Unix socket／postgres peer 執行常數彙總 SQL。
- `--input <JSON file>`：離線重播合成 observation，不呼叫 systemd／PostgreSQL／provider。
- `--print-sql --since <UTC ISO>`：只印出彙總 SQL，不執行；不需要 state file。

前兩種必須有 `--state-file <absolute private path>`。狀態目錄必須由執行者持有、不可 group/world writable，狀態檔必須為本人持有的私人普通檔。拒絕 symlink、損壞狀態、倒退的 observation time；不默默重設告警紀錄。以 exclusive lock 防同時檢查，以 0600 temporary file＋rename 原子更新。程序 crash 遺留 lock 時，須由操作端先確認沒有執行中檢查才手動處理；工具不偷鎖。

未來經另行核准的手動操作範例，**本輪未在正式執行**：

```sh
sudo /usr/bin/node scripts/check-receipt-health.mjs \
  --local --since 2026-10-16T01:52:30Z \
  --state-file /var/lib/qigong-receipt-health/state.json
```

固定使用 `qigong-practice-receipts.service`、`qigong_platform`、`/var/run/postgresql:5432`；不接受外部 DB URL、任意 SQL、shell command 或收件對象。不讀 API／worker env 檔，不把原環境傳給子程序。SQL 為 `BEGIN READ ONLY`、5 秒 statement timeout，子程序另有 timeout／輸出大小上限。服務 invocation／狀態在收集前後不一致會回報 unknown，避免重啟時拼接不同 invocation。heartbeat age 用 Linux monotonic timestamp，並計入 DB 收集花費的時間。

DB 只彙總 LINE／TG outbox 的待送、已到期可送、派送中、失敗、重試、過期租約、最舊未完成／到期工作與延遲樣本。沒有原始資料輸出或新 DB grant；root／postgres 是既有操作端權限，不是新增給 API／worker 的 raw table 權限。工具不修復、取消或重新排隊任何工作。

延遲視窗是 `max(--since, 最近24小時)`，**同時要求 created_at／delivered_at 在視窗內**，排除「舊排程建立、現在才完成」的列污染新模式延遲。空渠道仍有一列；沒有樣本時 p50／p95／max 為 null，不是 0。倒退／未來 timestamp 另計 clock anomaly，不把負延遲算成快派送。失敗／未完成工作不受延遲視窗排除。

## 告警規則與輸出

- 服務不 active、收集失敗、schema mismatch：立即 critical／unknown。
- heartbeat 缺失或 age ≥90 秒；成功輪詢 age ≥120 秒／進度缺失：critical。啟動寬限是 pending，不是假裝 healthy，也不在沒有新進度證據時宣稱舊進度告警恢復。
- 連續錯誤 ≥3 輪、expired lease、最舊到期工作 ≥15 秒：warning，至少連續觀察 30 秒才開啟。
- 最舊到期工作 ≥60 秒：立即 critical；最舊未完成工作 ≥5 分鐘：持續 warning，即使重試尚未到期也不隱藏。
- failed receipt／clock anomaly：立即 critical，不自動 acknowledgement／刪除／重送。
- 延遲 p95 ≥5 秒 warning、≥15 秒 critical，均須至少 20 個樣本與持續 30 秒。少量慢樣本仍展示，但不冒充有統計意義的 p95 告警。

狀態包含 first／last observation、已通知 severity；發出 opened／escalated／recovered，重複狀態不重複 opened。相隔超過 90 秒的零星觀察不能確認持續 warning。收集失敗會保留已確認告警，打斷尚未確認的 warning，不宣稱它們恢復。已 confirmed critical 不隨小幅降級而抖動，須真正清除條件才恢復。

stdout 是一筆 allowlisted JSON；exit 0 為 healthy 或 pending（須讀 status 區分），1 warning、2 critical、3 unknown。失敗時只有泛化狀態，不輸出輸入路徑／內容或 SQL／provider exception。操作排程若日後啟用，應約每 30 秒保留同一私人狀態檔；判斷通知事件時看 alerts，不把每次 nonzero 當成新事件。狀態檔不是通知 outbox，未 fsync／未建立外部送達保證；crash 邊界不保證事件恰好一次。**沒有正式告警送達、沒有外部 sink，也沒有在本輪安裝排程。**

healthy 只代表當次觀察到的服務／輪詢／佇列條件正常；不是手機送達證明。delivered_at 是服務端記錄的 provider acceptance 後完成時間，created_at 到它也不等於精確 commit-to-phone latency。HTTP handler 不等候 provider，原 outbox／資格／claim／pre-send／lease／finish 邏輯與 minute fallback 不變。

## 型別修復

- `learner-pages.test.ts`：以 discriminated branch 建立 LINE 必有 liffId 的 channel。
- `admin-sessions.test.ts`：泛型明確滿足 `QueryResultRow`。
- `onboarding.test.ts`、`runtime-rls.test.ts`：驗證 fixture row 數量／存在後取 ID；optional request context 省略 undefined。

不加 any、不改 strict 設定、不用型別斷言掩蓋錯誤、不改套件 scripts。除一般 `pnpm verify` 外，務必另跑：

```sh
pnpm exec tsc -p tsconfig.eslint.json --noEmit
pnpm exec tsc -p tsconfig.receipt-health.json
```

CLI 亦以 `@ts-check`／JSDoc 明確型別與 unknown JSON 邊界通過獨立 strict 檢查；不以未檢查的 JavaScript 繞過型別要求。

## CI 型別防線與 Telegram 測試隔離（已核准提交／發布）

使用者先核准以下3檔案的本機實作，再另核准單一Telegram測試檔的案例隔離與安全診斷，最後核准commit／push／deploy；不包含時鐘或告警啟用變更。提交前GitHub仍執行先前workflow；新門檻須由候選exact-SHA CI實際驗證成功後才可部署。

- `.github/workflows/ci.yml`：保留既有 `verify` job、permissions、Node24、PostgreSQL health／test-database guard、frozen-lockfile install與build。在build後、原 `pnpm verify` 前加入具名步驟：`Typecheck all TypeScript source and tests`、`Strictly typecheck receipt health CLI`，執行上述兩條命令。任一步非零即阻擋，沒有continue-on-error或自動重試。
- `tsconfig.receipt-health.json`：繼承base，啟用allowJs／checkJs／noEmit／allowImportingTsExtensions，只include `scripts/check-receipt-health.mjs`及自動解析的匯入依賴。保留strict／noUncheckedIndexedAccess／exactOptionalPropertyTypes；明確skipLibCheck=false，維持原手動CLI命令的檢查強度。不把未檢查的其他MJS腳本宣稱為已涵蓋。
- 本文件：記錄門檻、本機命令、正反向驗證與驗收阻擋。CI門檻本身沒有修改package metadata／依賴／lockfiles、tsconfig.base／eslint設定、業務程式或資料庫約束；後續核准的測試變更僅限 `apps/public-api/tests/telegram-onboarding.test.ts`，見下段。不觸碰無關permissions-review檔案。

本機Node24驗證結果：

1. 兩道型別檢查均0errors。`--listFilesOnly`比對Git追蹤清單，170個TypeScript檔全數納入，包含88個tests目錄下的測試／輔助檔；缺漏0。CLI與health TS匯入依賴亦納入，沒有擴大到其他業務測試。
2. 私人隔離副本先確認兩門檻正常通過，再分別向新增合成測試檔與CLI加入number→string型別錯誤；兩門檻均以TS2322非零失敗。移除合成錯誤後均恢復通過。原CLI hash未變，隔離副本已刪，沒有執行CLI／provider／資料庫操作。證據 `/tmp/qigong-ci-type-gates-proof.json`。
3. 按CI順序先build、兩型別門檻，再跑完整 `pnpm verify`。build與兩門檻通過；該次完整回歸為 **817 passed／2 failed**，**該輪未通過整體驗收**。DB186、config2、identity6均過；API623過、2失敗，位於未修改的 `telegram-onboarding.test.ts`：有效token讀history收到403 `checkin_unavailable`（預期200），及後續跨學員測試預期一筆資料卻為空。不能宣稱本輪819全過或把失敗歸因於已證實的時鐘問題；本輪未量到失敗當下原因。
4. 沒有重跑整輪取綠燈、修改該測試、放寬授權／時間條件或改共享主機時鐘。保留 `/tmp/qigong-ci-type-gates-{build,all-types,cli-types,verify}.log`，整合失敗的定位／修復需另外提出範圍。此次只啟動／使用原本已停止的專用合成測試container，驗證後再次停止；沒有觸碰其他cluster或正式服務。

後續只修改 `telegram-onboarding.test.ts`：時區案例自行建立reviewer與另一學員的具完整FK／功法選取打卡，不再讀取前一案例留下的資料；歷史查詢失敗時，以另一個 `BEGIN READ ONLY` transaction收集allowlisted資格布林與時間差，明確標記originalRequestTransaction=false。診斷經schema投影，沒有姓名、ID、token、hash或SQL exception；有效／無效credential投影及敏感值不出現檢查皆過。原有channel時間起點、期限／跨人拒絕斷言與production SQL未改。

時區／history案例各自單獨通過，該檔4/4通過，兩道型別／lint／格式檢查通過；沒有重跑整輪取綠燈，也沒有重現原403，因此根因仍未結案。證據 `/tmp/qigong-telegram-isolation-{timezone,history-final,file}.log`。使用者現已核准提交／推送／發布；必須由新exact-SHA CI的兩道型別門檻與完整verify共同通過，不以本機個別案例成功冒充整輪或GitHub CI成功。

## 時間戳間歇問題：已證實與未證實

歷史 `/tmp/qigong-locale-verify-repeat-failure.log` 顯示 `learner-privacy` 呼叫 `admin.suspend_learner` 時違反 `person_interaction_channels_check`；早期 onboarding 曾 permission denied。原 fixture 使用剛建立的預設 CURRENT_TIMESTAMP 當成已生效的 channel／grant。

新增確定性測試：

1. 相等的 valid_from／valid_to 仍被 23514 拒絕；人工將**合成 fixture**起點設於未來，suspend 會產生同一 constraint 名稱／錯誤碼，且 transaction rollback 保持 person active／channel open。
2. 只把合成 fixture 改回明確歷史起點後，原 suspend 成功、valid_to > valid_from，舊 token 被拒絕；正式函式／約束完全未改。
3. 尚未生效的 regional grant 仍 permission denied，application 保持 pending／person_id null；還原合成 grant 的歷史起點後原審核成功。原其他 scope、version、post-lock expiry 與拒絕斷言保留。

修復僅在 `learner-privacy`／`onboarding` 中明確表達原本應已 active 的 fixture：起點設於 DB clock 一天前。沒有 blanket 全表重設、隱式 retry、增加 sleep、延後 deadline、放寬區間或正式回填。

**後續實測與未解界線：**短時間1,000次跨兩連線採樣未見負差，但最後整輪又在既有 `community-notes` Telegram作者／LINE讀者測試遇到儲存後首次 feed 為空（185項DB過、1項失敗）。保留 `/tmp/qigong-priority23-verify-intermittent-failure.log`，沒有用重新讀取或調整 published_at 讓斷言通過。該測試新增明確 length 斷言，原心得內容／隱私斷言仍保留；只有失敗時輸出 publication數量、active數量、snapshot時間差、作者資格與future channel數量，不輸出文字、暱稱、ID或credential。

加診斷後的整輪819項通過；同步在同一專用 PostgreSQL16／兩連線採樣 **17,054次**，出現 **5個跨交易負差樣本**、**1個同交易 clock_timestamp < CURRENT_TIMESTAMP 樣本**，最大跨交易負差 **116.11104ms**、queryFailed=false。證據 `/tmp/qigong-priority23-clock-watch-final.json`。這是目前測試環境 DB wall time 不單調的直接證據；不能把1,000次短採樣或整輪綠燈當成環境已穩定。

**尚未證實：**未抓到該次空 feed 失敗當下的時間差，不能斷言這一例必定由時鐘造成；也尚未證明是 host／VM 同步、clocksource、跨vCPU偏差或其他因素，不能推論正式環境有相同問題。人工future-start只證實時間敏感類別，不證明所有舊失敗有同一根因。原共享叢集、時鐘同步及其他 timezone／identity 間歇仍須追蹤。

**停止界線：**不因passing重跑而結案，也不加入等待／重試掩蓋問題。下一步需審查共享測試主機／Docker VM 的時鐘來源與同步狀態；設定變更會影響其他專案，需另行核准。本輪不修改其角色／所有權 fixture、clocksource、NTP、系統時間或任何正式設定。

## 本機驗證

- 專用 `qigong-priority23-test`／loopback55479／PostgreSQL16，與原共享叢集／角色隔離。
- 第一輪完整 verify：818 tests。增加 startup／collection-continuity 測試後，先 fresh build 再完整 verify 最終 **819 tests**（API625／DB186／config2／identity6），format／lint／source typecheck／build 通過；額外 all-test typecheck 與 CLI strict-JS 檢查均 **0 errors**。
- `learner-privacy`／`onboarding`／`telegram-workspace` 共32項，另作3輪獨立重複驗證，**32/32 ×3**；任一輪失敗即停止。這不包含後來失敗的community suite，也不證明原共享叢集問題消失。community加診斷後target16項與整輪819項通過，但前述失敗及17,054次時鐘負差證據仍保持開放，不以重跑藏錯。
- 新 health／CLI／SQL tests：涵蓋 channel 獨立、idle／hung、失敗批次、sample不足、延遲 epoch、pending retry、lease、clock anomaly、warning confirmation／gap／dedupe／escalation／recovery、損壞／權限／symlink／lock／backwards state、泛化錯誤／無私文輸出。
- Node24 Linux network-none mock collector：8 情境 healthy／stalled／inactive／missing heartbeat／legacy heartbeat／future heartbeat／DB failure／invocation changed 均符合預期。collector 接口為模擬；真 PostgreSQL SQL 另在獨立合成 DB 驗證。不是實際 systemd host／provider／手機驗收，未發任何真人訊息。
- Linux rehearsal 初次用 bind mount 無法讀取 daemon 端路徑，改 tar 傳輸又遇 macOS xattr；使用無 xattr 的明確檔案 tar 後通過。這是本機測試搬移問題，不是產品重試／資料重送。

證據：`/tmp/qigong-priority23-{types-baseline,types-final,verify-1,verify-final,database-baseline,repeat-1,repeat-2,repeat-3}.log`、`/tmp/qigong-priority23-clock-probe.json`、`/tmp/qigong-priority23-clock-watch-final.json`、`/tmp/qigong-priority23-verify-intermittent-failure.log`、`/tmp/qigong-priority23-verify-after-diagnostic.log`、`/tmp/qigong-priority23-linux-collector.json`、`/tmp/qigong-priority23-cli-types-final.log`；DB 合成憑證只保存在私人暫存設定，不放 Git／日誌。後續使用者已核准提交／推送／發布；精確SHA CI、加密備份實際還原與同schema37回退仍為發布門檻。告警安裝／排程／通知對象與啟用仍需另核准。
