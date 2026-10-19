# 獨立活動 badge：空白新增與季節設定分流（本機候選41）

## 問題與核准

使用者指出「新增活動」卻帶入三伏修練資料。原40按鈕其實建立既有三伏／冬至的年度設定草稿，不是獨立新增；儲存也只改private draft，未直接改正式季節資料，但操作語意不符需求。使用者確認修正方案後完成本機實作與驗證，後續另明確核准本次commit／push／deploy及40→41直接協調維護例外。待精確SHA CI／隔離演練通過，停API／雙worker後取得final加密DB／roles／runtime並實際還原及保存驗證，才可升級切換；目前尚待執行。正式rule發布與授獎仍不在範圍。

## 兩個明確入口

- **新增活動 badge 草稿**：名稱（三語）、說明、開始／結束日期、顯示時區、所需天數與reason皆空白；不取三伏／冬至的名稱、門檻、年度或來源。尚未填寫時不自動儲存；有未存編輯時仍需確認捨棄。
- **建立既有季節活動設定草稿**：保留原活動年度與三伏／冬至選擇、來源差異及已開始活動鎖定；不是新增獨立badge。切換到空白新增不會儲存或變更該來源。
- 獨立活動儲存後有新的server-generated `event_<32hex>`代碼；同名／同日期也不合併或覆蓋。不能由client指定代碼，更新保留身份／revision，不能換成季節草稿；`year=null`，以日期區間描述活動，可跨年。
- 現階段活動條件是**期間內任一功法有效打卡的不同日期累計**，每日最多一天；不是冬至龜壽限制、連續天數或課程完成判定。起算＝活動開始／預計生效日，之前的日期不承接；日期／時區／門檻需完整填寫才可儲存。未加入未經確認的其他條件或獎章圖像設定。
- preview仍只讀結構化打卡、不讀心得感受，採原supported timezone最晚D+1 noon補登截止UTC＋完整86,400秒結算試算；不延長補登權利。所有結果都是模擬，`publicationEnabled=false`／`wouldRevoke=0`，無publish／activate／recalculate接口。

## 資料與安全

- **0001–0040完全不動**。新增`0041_independent_activity_drafts.sql`，既有forced-RLS private draft表新增subject `event`／identity constraint與partial unique index，`definition_code=NULL`，不新增／改寫49 live definitions或正式季節／awards／jobs。
- 既有activity／rule／challenge rows、source hashes、previews與audit原樣保留。只替換四個必要函式body：`_achievement_config_source`、`_achievement_config_validate`、`save_achievement_config_draft`、`compute_achievement_config_preview`。原owner／ACL／SECURITY DEFINER／search_path／volatility與其他function definitions保存驗證。
- 無新增permission／role mapping／raw table grants；有效global master／super條件不變。Origin／CSRF、actual session最後重查、revision／reason、post-lock來源／權限重驗、容量／冷卻／timeout不放寬。
- candidate API exact41、雙worker改`ops.achievement_event_drafts_schema_ready()`／`phase-26-independent-activity-drafts`。正式40與candidate41不相容，**本次提交推送與41直接維護例外已另明確核准，待CI／演練與final actual restore/preservation通過才執行；resume後保留41／fix forward，不退40或回灌舊快照**；不沿用已完成的40維護例外，不在線migrate41，不能只換前端或修改40 migration。

## 驗證

- Node24兩strict TypeScript gates、format／lint／typecheck／build、靜態簡中來源檢查；完整verify **1014 tests**（API762／DB244／config2／identity6）。舊39→40 upgrade test固定target40，沒有讓41混入歷史驗證。
- DB新增7項：40→41 apply1／repeat0、全部79表normalized data（僅metadata architecture/time預期差異）與原security attrs保存，舊季節draft／cached preview／base hash不變；兩角色獨立身份、interval內任一打卡distinct日計數、read-only preview、來源／日期／code forgery拒絕、revision與跨subject防護、無raw／worker權限。
- Model26、VM19、HTTP17過；新增針對空白新增、三語季節切換清空、POST null identity／PATCH server identity、不變更live data及invalid input拒絕的覆蓋。
- 真compiled Fastify＋隔離PG16／合成session，browser **13組／24圖**（master／super × 三語 ×390／1280，加viewer拒絕）。每組從既有三伏草稿輸入未存修改，確認捨棄後空白新增、填寫、實存與試算；12次確認、12 event drafts／12 previews／24預期audit，所有其他business表fingerprint相同。無API／JS error、無overflow，手機44px／16px、publish disabled；非真人OAuth或實體手機驗收。
- 首次SQL產生器替換字元／partial-read片段錯誤已修復，未改歷史migration。首次verify lint指出測試fixture對unknown做字串相加，改成明確String；下一輪抓出TG worker readiness測試仍呼叫40舊gate，改驗41 gate、保留ready=true斷言。失敗紀錄保留，沒有放寬型別／安全斷言或無原因重跑。browser首次fixture readiness因背景preview未起動而停，改detached程序啟動後完整矩陣過，產品未為測試改碼。

證據：`/tmp/qigong-activity-badge-verify-complete.log`、`/tmp/qigong-activity-badge-browser-{results,preservation}.json`、`/tmp/qigong-activity-badge-{super|master}-{zh_TW|zh_CN|en}-{390|1280}-{blank|preview}.png`；失敗log與私密合成fixture留在本機，不入Git／不貼憑證。測試專用PG55508、preview PG55509與HTTP55510／CDP55511均於驗證後停止。沒有連正式、產生正式個資CSV、真人provider send、Console／flags／政策／同意變更。
