# 第二階段C：版本化發布、即時授獎／撤回／恢復（已部署46／營運OFF）

## 核准與範圍

使用者已確認：無截止功法badge達標即發、更正後不達原得獎版本條件自動撤回、再次達標自動恢復；有截止活動仍須max supported-zone補登截止UTC＋完整24hours。接著核准完整C本機方案，包含統一引擎、啟用／取消、交易提交評估、歷史／CSV／學員相容、並行／補漏及**正式開關預設關閉**。本機實作階段未commit／push／deploy／連正式／發送得獎通知。使用者後續另明確核准本次A/B/C提交推送與42→43–46協調維護部署：精確SHA CI及隔離42相容先行版／升級保存演練通過，封鎖入口並停API／雙worker後取得final加密DB／roles／runtime、實際還原保存過才切換相容程式並升級46；resume後留46／fix forward，不退42或舊snapshot。**operator gate仍須FALSE，不啟用營運或新規則授獎／外部通知**。已按本次授權完成正式`951d1c8`／46：CI39371539528原run1105tests、隔離演練、停寫final實際還原／79表保存、正式42相容先行版及4migration升級過；維護69.035秒、237 Node HTTPS／healthy。gate FALSE、runtime/cancellations/new-award transitions/pending candidates0，原1draft不改。0001–0046現均immutable；兩份無關文件保留排除。見[部署與final actual restore／復原紀錄](achievement-versioned-deployment.md)。

## 核心資料與預設OFF

- `0045_versioned_achievement_runtime.sql`新增canonical badge identities，原49code原樣種入；既有award與A legacy-version FK改指canonical identities，**不改award row／earned_at／revoked_at／進度**。新event／challenge只在真正schedule時登錄canonical identity，不加入舊49 live definitions，避免舊評估器誤吃新規則。
- runtime versions引用B candidate、保留原sealed snapshot／SHA／candidate_version，新增effective_date、earliest_start_at、published_by/time；不可變UPDATE／DELETE／TRUNCATE。B snapshot本身永遠仍是awaiting_activation／activation_enabled=false，C實際registered／scheduled／published／cancelled狀態由獨立資料衍生，沒有改寫原快照。
- `ops.versioned_achievement_control.enabled` **DEFAULT FALSE**，forced-RLS、無API／worker raw access，也沒有web／admin enable endpoint。SQL enabled predicate還要求完整0046 ledger存在；只有45時不能啟用。local unit/browser只由隔離PG owner明確設true以測試，不是正式啟用。
- 新permission `achievement.activate`只預設映射global master／super；同一有效global role須具manage_drafts＋prepare_publication＋activate、principal active、wall-clock grant有效且operator gate true。總permission32；不新授任何人角色。worker不能直接呼叫activation／legacy-evaluator bypass，API不能寫control或任意person evaluator。

## 發布／取消交易

- GET activation-review＋POST candidate/:id/activate／cancel，strict DTO只接受expectedSnapshotHash、reason及confirmed=true。UI確認顯示code／版本／日期；不能由caller換config、版本號、actor或開營運flag。
- privacy shared lock、candidate row及per-code publication lock後重驗角色／operator gate、sealed hash、current draft revision／config/source、未來日期、season year及activity-start lock；timezone snapshot或deadline計算政策有變也拒絕，不默默改結算點。最後回應前同連線wall-clock實際session／角色／gate重查，失效回滾identity/runtime/jobs/audit。
- 日期必須仍晚於所有supported practice timezone的今天，不能把過去模擬稿直接啟用。每人以自己的practice timezone之practice_date達effective_date時才可用新版本；新進度從effectiveDate或更晚的明示startDate起算。metadata最早開始時間取sealed supported zones local midnight最小UTC，用於「任一允許時區已開始」的保守取消／活動鎖定判斷，不依語系猜地區。
- 同candidate重試／兩角色並行只產一個runtime row及scheduled audit，時間／snapshot不刷新。預開始可append cancellation並保留歷史；取消後原candidate不能重啟。修正稿可準備新的candidate/version在同未來日期取代**已取消**版本；同code未取消的同生效日仍由code鎖／collision guard拒絕。開始或已有award後不能取消。
- 開始後event／seasonal activity條件不可改；新rule/challenge可另建未來version。legacy49新版本以runtime snapshot呈現後，management來源／hash及顯示同步到可證實的新條件，不覆寫live49；舊未發布平行草稿變sourceChanged，不能拿舊來源發新版本。已registered快照不因它自身成為新source而誤標stale。

## 唯一評估與版本邏輯

- `0046_achievement_evaluation_and_readers.sql`加入pure qualifying helpers及統一`core.evaluate_practice_badges`。operator OFF時明確legacy fallback只管原49／原worker；ON後按immutable runtime或known legacy snapshot判定。
- 既有49 source保留原legacy-history語意，不因升級歸零；新版本只算自己的progress lower bound。current版本可新授獎；舊版只維護**已存在**award，不補發另一舊版本新獎。撤回／恢復始終用該版原條件，不套新版。
- unknown_legacy沒有可證實條件，保留紀錄、不猜資格，也不擅自撤回／恢復；歷史畫面明示未知。
- cumulative／longest-consecutive calendar islands、selected leaves ANY/ALL同日、morning/night regular且stored submission-time window、combo年度full-set、summer／winter與event起訖皆獨立條件。distinct practice_date每日最多一天；不讀心得感受，不重切舊日期或推課程完成。
- finite新版本用sealed snapshot中的global latest makeup cutoff＋86,400秒，legacy可證實season也補完整gate。**新授獎／恢復不能早於結算**；尚未ready不等於不合格，不因gate本身把已存在legacy早發紀錄撤掉。若更正後確實不達標則撤回，符合且可授獎時恢復。
- earned／revoked／restored都在同一原PK（person/code/version/period）上轉換，恢復不重建重複award、**earned_at保留原值**。原audit.practice_badge_changes保留，新forced-RLS audit.achievement_transitions紀錄action/cause/request/time，無reflection／contacts／名單；只有真實state transition寫audit，retry或重算同結果不新增事件。

## 提交即評估、排程與純讀

- mutation queue維持person→job鎖序，新增dirty_generation／evaluated_generation；checkins及method INSERT／UPDATE／DELETE enqueue。DEFERRABLE INITIALLY DEFERRED constraint triggers在成功交易COMMIT、所有methods最終狀態後每person/generation評估一次。API withRequestContext等待COMMIT才回應，因此達標／撤回／恢復已持久化，不等開獎章頁或每分鐘timer。audit/evaluation失敗會回滾整個practice／request／outbox交易，不留下半成品。
- practice_timezone變更也enqueue並defer評估，不改寫歷史practice_date或stored timezone。
- worker仍走bounded20 batch／SKIP LOCKED補漏；ON時force處理到期時間即使沒有新generation，也不會漏effective-date或settlement gate。next_due取person下一local midnight／未來effective day／settlement等最早時間。OFF仍legacy worker fallback。
- finite到期授獎是截止後worker排程處理，**不是保證精確在該秒送出**；量大時受bounded catch-up批次影響。無截止badge的正常practice transaction則commit即評估。沒有新增LINE／TG得獎通知，也不承諾external exactly-once。
- **所有workspace report別名已移除讀取內的evaluate呼叫，即使operator OFF也純讀獎章**，不再有GET/report繞過結算。這是相較A/B的明確行為變更：OFF期間原49仍靠legacy reconciliation，不再靠開頁補發。舊測試已改成明確reconcile，原得獎／撤回／恢復斷言保留並新增pure-read斷言；另有真native API在隔離C gate ON時commit→earned→revoked→restored測試。

## 顯示／CSV／操作UI

- 學員／後台版本reader、new canonical codes、scheduled/cancelled狀態及cumulative/consecutive／日期／ANY/ALL描述已接線。manual names只用explicit zh_TW/zh_CN/en或literal fallback；published_snapshot provenance讓系統UI OpenCC mapper跳過人工badge名稱，CSV title/filename同樣不自動轉換。姓名／心得／reason不翻譯。
- CSV仍一份一版本、原global super/master contacts權限、purpose/CSRF、5001 sentinel、size/cooldown、post-encode actual session驗權及formula／ID guards不變；不因取消／恢復發放外部通知。
- 管理頁從sealed snapshot顯示發布／排程與啟用前取消；operator OFF或無權限時隱藏／拒絕，沒有UI開關。activation理由另欄且離開有veto，confirmation綁id/hash與generation，權限失效清舊snapshot與controls。不從editor未存條件直接發布。

## 相容、已部署與未核准營運啟用

- 合併候選API min42/max46；42／43缺功能時明確fallback／拒絕不支援操作；44只prepare；45 gate因46未安裝而false；46預設control false。五個exact schema42–46的同候選readiness與version/export/gating矩陣過，phase27／原worker readiness不換。
- 舊正式be exact42不能直接接43–46。使用者已另核准本次commit/push與協調維護，須等exact-SHA CI／matching compatible42與42→46隔離演練過，再做停寫final加密備份actual restore/preservation、正式42相容先行版與逐步遷移／流量驗證。上述本次流程已執行並驗證，不沿用先前42維護授權；恢復後留46／fix forward，不能退42或回灌舊snapshot。43–46現在亦為已部署immutable migrations。
- **營運啟用另核准**：新control仍false，不因deploy或給activate permission自動打開。正式enable前還需真人角色／LINE/TG手機驗收、實際規則／日期確認、catch-up/backlog／batch容量與operational pause/fix-forward審核。此時沒有任何正式新版rule被發布或發獎。

## 驗證及失敗紀錄

- 最終Node24兩strict TS gates、format／lint／typecheck／build／靜態簡中來源檢查過，完整verify **1105 tests**（API812／DB285／config2／identity6）。
- 已生效／過去日期的runtime unit資料由隔離PG owner建構為歷史fixture；pure qualifier用explicit input_now檢查邊界，不改系統時鐘，也不表示正式RPC允許回填日期。真正activation HTTP案例仍只接受未來日期。
- 新DB runtime13＋44→46 upgrade1：81舊表normalized保存（只新activate permission／2 mappings與job新增generation欄位預期差異）、49 legacy canonical ids、control FALSE／no runtime/transition rows；commit native-style lifecycle、原earned_at、same-record/no duplicate audit、original-version/no progress carry、unknown保留、finite cutoff前1ms／exact＋read gate、started-lock、durable worker catch-up、ALL每日去重／中間狀態不評估、audit rollback整個practice、committed due-job與writer person-lock SKIP LOCKED競態不漏wake-up、全部legacy families與new combinations，raw/worker bypass拒絕。
- 新HTTP7：defaultOFF拒activate/no enable endpoint；兩角色future schedule/idempotent/cancel/同日新candidate替換；immutable management來源與人工簡中不轉換／live49不改；雙角色並行只一row/audit；CSRF/Origin/permission/confirmed/hash/stale拒絕；audit內撤actual session後identity/runtime/jobs/audit全rollback。VM32包含confirmed snapshot hash、取消、capability OFF、reason veto、403清controls。五schema矩陣及既有strict gates保留。
- 本機compiled Fastify＋獨立PG16／合成session browser **13組／24圖**（super/master ×三語 ×390/1280，加viewer拒絕）。只有此隔離preview owner把control設TRUE：12drafts／24prepare requests→12snapshots，12future schedules＋12pre-start cancellations、48confirmations，snapshot id/hash/time保留、無overflow/API/JS errors。預期48audit＝12draft＋12prepare＋12schedule＋12cancel；**新runtime/cancellation/identity metadata有預期變動**，原legacy definitions／awards／其他business hashes保持，jobs僅允許publication due_at排程差異。沒有實際授獎或外部send；DB／native HTTP另測commit授獎，不把future browser排程當真人award驗收。
- 開發期SQL dollar-quote錯誤修正留log；初次strict TS抓並行test的array元素可能undefined，改精確length2及逐項status檢查，無any/assertion放寬。首次full DB四項舊測試靠開頁發獎，依新pure-read契約改由explicit worker且新增read-before-reconcile無獎斷言；下一輪API同類case改僅該隔離fixture gate ON並加earned/revoked/restored audit，afterEach回OFF。原資格／scope／history期待不刪，不把evaluate放回讀取求綠。最後完整1104過，再補同日取消替換修正與family覆蓋後完整1105過；原failure logs不覆蓋。

證據：`/tmp/qigong-achievement-runtime-verify.log`（初TS）、`...-verify-full.log`（舊DB read-write期待）、`...-verify-complete.log`（舊API期待）、`...-verify-final.log`、`...-verify-final-complete.log`與最後UI phase-banner修正後的`...-verify-release-local.log`（同1105）；`/tmp/qigong-achievement-runtime-browser-{results,preservation}.json`及`...-{super|master}-{zh_TW|zh_CN|en}-{390|1280}-{ready|sealed}.png`。proof明示synthetic runtime metadata changed／legacy definitions unchanged，不假稱未發生本機publication。PG55526／preview55527／HTTP55528／CDP55529驗證後停止。無正式個資CSV、clock／Console／flags／政策／同意變更；原VM clock／history403／Python-UA edge差異不因此結案。
