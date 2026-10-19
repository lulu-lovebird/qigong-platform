# 活動／成就管理第一階段：草稿與彙總預覽（本機候選40）

## 狀態與核准界線

使用者review後確認：先限三伏／冬至與現有49種成就；master、super均可編輯及發布；已開始活動鎖定條件；新版本進度從生效日開始；結算在最晚補登截止後**完整24小時**，考慮時區。接著核准開始實作。

本輪按已提出的第一階段落地：**草稿編輯、與來源差異、彙總試算；正式發布／生效／授獎不啟用**。介面明示master與super第二階段皆可發布，現在 `canPublish=false`、按鈕disabled、沒有publish／activate／recalculate endpoint。功能本機階段未修改正式服務／資料、Cloudflare、provider、政策或旗標。使用者後續另核准本次commit／push／deploy與39→40直接協調維護例外，須精確SHA CI與演練通過、停API／雙worker後取得final加密備份並實際還原驗保存，才可升級切換；目前尚待執行。既有人工驗收文件增補與無關permissions-review保留。

## 介面與資料流

- 既有「系統與個人設定」分類增加單一「活動與成就管理」入口，不新增一長串sidebar子項；capability獨立查詢、失敗隱藏，分類仍初始收合。
- 三分頁：活動日曆、成就規則、草稿／預覽紀錄。已發布日曆／49種定義唯讀；47種非季節規則建立修訂草稿，兩種季節條件由活動草稿管理，避免兩處門檻矛盾。
- 桌面雙欄、手機單欄，延用品牌／CSP／34px桌面與44px觸控、16px手機輸入。所有來源、使用者名稱／說明／差異均用text nodes，不插入HTML。
- 名稱有繁中必填、簡中／英文選填；空白明示回退繁中。draft內容不自動翻譯；既有source-owned labels使用既有三語對照，OpenCC只開發時重產靜態map。
- 活動欄位：summer／winter、年度2000–2200、名稱／說明、起訖日（含當日、允許跨年）、顯示時區、達標日數。活動生效日與開始日相同；不猜官方日期、不自動填起訖。最多367個日期、requiredDays不得超過天數。
- 規則欄位：固定code／kind、名稱／說明、新版生效日期、按kind允許的threshold及leaf codes。streak／total、method ANY日數、combo同日全部所選leaf且threshold=1；morning/night固定05:00–07:00／21:00–23:00、只計regular，以entry保存的practice_timezone解讀提交時間。seasonal winter固定現有三種Guishou任一，summer計練功日。
- 草稿允許用過去日期作純模擬，但不能發布；已存在且開始的published season不能建立覆寫草稿。未來正式發布仍須驗未來生效時間、不可變版本、活動開始鎖定與舊版相容。
- 草稿帶optimistic revision及建立時base config/hash；save等待鎖後重查權限、版本、來源及活動是否已開始。來源變更不silent rebase，改建新草稿／另審rebase。封存只改私人draft狀態，理由必填，不封存或撤銷正式活動／獎章。
- 差異目前是「草稿與建立時來源」；revision用於衝突控制，audit保存動作／revision/hash，不宣稱已提供完整舊草稿內容時間軸或published-version history。正式不可變版本與發布紀錄屬第二階段。
- config／reason未儲存時保留離頁提醒。失敗不清表、不自動重送；401／403清除受保護欄位。generation／AbortController忽略過期view回應；不寫local/sessionStorage、不下載檔案。

## 權限、HTTP與保存

新增 `achievement.manage_drafts` 只映射有效global `super_admin`／`master_admin`；principal須active、grant已生效且未到期。不是由Email／姓名或前端按鈕授權，也不沿用CSV個資匯出權限。

預覽另要求**同一有效global角色**同時具備stats.read／learner.read／checkin.read及管理權限，再由 `_achievement_people` 套現有三項person scope。metadata管理不隱含讀取全站學員統計；失去preview權限時detail不回傳cached aggregate。最後實際session與wall-clock權限在同一request connection再驗證，失敗回滾draft／preview／audit，不額外借pool連線。

新增接口：

- `GET /admin/achievement-management`
- `GET /admin/api/achievement-management/{capabilities,catalog,drafts}`
- `GET /admin/api/achievement-management/drafts/:id`
- `POST /admin/api/achievement-management/drafts`
- `PATCH /admin/api/achievement-management/drafts/:id`
- `POST /admin/api/achievement-management/drafts/:id/{preview,archive}`

寫入要求真實session、正式Origin、JSON、CSRF、strict欄位／UUID／revision；不接受actor、code替換、publish flag或可執行expression。body有限制、statement timeout5秒、no-store／no-cache／no-referrer／nosniff，HTML沿用admin CSP。錯誤只映射控制碼：400輸入、401登入、403權限／CSRF、404無資源、409版本／來源衝突、413容量、423已開始鎖定、429冷卻、503未知錯誤；不洩SQL/provider diagnostics。

`admin.achievement_config_drafts` 與 `admin.achievement_config_previews` 為新forced-RLS私有表，API／worker無raw table grants。固定pg_catalog definer facades，helper不授API／worker，PUBLIC無execute；worker只有ops readiness。沒有對正式badge definitions、seasons、awards、jobs、checkins、publication或consent的DML。

audit動作僅draft_created／updated／archived／previewed，actor／request／draft、subject/code/year、revision、base/config hash及固定preview metadata；不放config、名單、姓名、電話、Email、心得或感受。操作理由原文保留、長度受限，介面提醒勿填學員個資；不把人工理由保證為完全不含個資的機器欄位。權限變更、文件與metadata仍不代表對外發布同意。

## 試算與時區

`compute_achievement_config_preview` 可於 `BEGIN READ ONLY` 執行，不呼叫具寫入副作用的既有evaluator。只讀結構化practice_date／entry_kind／created_at／practice_timezone與method selections，不依姓名／心得／感受猜規則。所有新進度僅計practice_date>=effectiveDate，不重設學員總統計。

輸出只有授權有效學員數、來源版本目前得獎數、生效日起符合數、額外符合數、既有獎章保留數、固定wouldRevoke=0，以及觀察／到期時間。季節另有最晚補登截止、結算UTC、顯示時區呈現及timezone count/hash；不回傳學員名單、person ID或聯絡資料。

```text
D = 活動最後一天
每個支援練功時區：D+1 中午12:00 → UTC
latestMakeupCutoff = max(以上UTC)
settlementAt = latestMakeupCutoff + interval '24 hours'
```

時區集合取server支援的UTC與IANA slash名稱（排除posix/right重複樹），不是當前學員名單或UI語言。預覽record保存集合／結果快照；不以local interval '1 day'代替24小時，不延長原補登權限。不合法／無法round-trip的local cutoff拒絕計算。截止前即使provisional合格，`awardableNow=0`；其他時間的數值仍只是模擬，publicationEnabled永遠false。

同actor／同草稿revision之有效預覽可重用10分鐘，觀察時間與到期時間不延長；新revision須重做。新預覽每actor5秒冷卻，串行鎖保護；最多5,000名授權有效學員、1,000份未封存草稿、10,000筆預覽紀錄，超限拒絕、不截斷。到期預覽不自動刪除或重設audit；後續需另定保留／清理政策。

## 後續核准擴充：獨立功法 badge 草稿

使用者後續確認累計預設30天、勾連續才計連續曆日，起算「不定」為全新rule生效日而非舊歷史，指定日不能更早。新增private subject challenge與server-generated code／definition_code分離，不覆蓋49種live definitions；新增功法badge分頁、群組leaf快照／ANY或同日全部、連續checkbox、起算模式與名稱建議。所有設定仍只存草稿／預覽，沒有active新badge或授獎。詳見[完整擴充規格與最終999項驗證](method-badge-drafts.md)；下方974為原第一階段完成時的歷史驗證，不是擴充後總數。

## 本機測試與發布界線

- 新DB23：兩角色／scope與raw/helper/PUBLIC/worker拒絕、草稿CRUD／archive、來源／revision／並行衝突、audit rollback、等待後grant expiry、global draft-capacity lock等待後再次驗來源／活動開始狀態、READ ONLY計算、全部八種rule families／季節專屬條件、from-effective進度、舊award保留、cache／rate、管理與preview權限分離、global截止及DST兩方向精確86,400秒。
- 模型15、HTTP11、VM11，加nav／branding：strict輸入、不可偽造actor／發布、實際session／Origin／CSRF、三語、跨年、最終session撤銷／自然到期回滾、未知SQL錯誤遮罩、disabled publish、reason草稿保護、literal顯示、年份null、失敗保留及權限清空。
- 39→40 upgrade1：所有77舊表／source hashes／舊function definitions與安全屬性不變，僅排除新增permission／兩mapping與metadata架構/time；新表空、RLS／ACL另驗。歷史38→39測試固定39，不放寬舊保護。首次apply1、repeat0，舊ops gate false／新true。
- Browser：compiled Fastify與獨立PG16、12組super/master×3語×390/1280＋viewer拒絕1組，24張截圖；實際保存12份合成draft與12次preview，手機44px／16px、無overflow／API錯誤／JS錯誤。所有既有business tables指紋不變，只有兩新表及24筆預期draft audit。local adapter提供合成session與Origin、logo離線供應，不代表正式OAuth／實體手機驗收；provider sends0、production touched=false。
- 新DB測試的reserved SQL aliases與VM測試在dirty時嘗試preview的fixture期待曾被拒，修正alias／改用實際save denial路徑後通過。最後補上global capacity鎖等待後的source／started-state再次驗證及確定性競態案例；未關規則、放寬資料斷言或調整時鐘。先前完整963、加rule-family後973皆過；再加上述guard/test後最終完整974，並以最終migration重建隔離preview DB重跑13組browser，非靠重試掩蓋失敗。既有clock/history403問題不因綠燈結案。
- 最後重建preview時，browser fixture尚未生成便被讀取，harness以ENOENT中止；保留log並補有界fixture readiness等待後通過，未更改產品斷言。
- 最終Node24 fresh build、兩道strict gates與完整 `pnpm verify` **974 tests**（API737／DB229／config2／identity6）通過，format／lint／typecheck／build皆過。這是本機結果，不是GitHub CI；本次沒有commit／push。

全套最終結果以 `/tmp/qigong-achievement-management-verify-final.log` 為準；其他證據為 `...-browser-results.json`、`...-browser-preservation.json` 及 `/tmp/qigong-management-{role}-{locale}-{width}-{draft|preview}.png`，均為合成內容、不入Git。獨立preview／Chrome與測試containers完成後停止。

新增候選 `0040_achievement_management_drafts.sql`／phase25，API及雙worker本機candidate exact40；**已部署0001–0039不改**。正式39 binary不接受40，本candidate不接受39；使用者已另行明確核准本次39→40協調維護例外，不是沿用先前CSV39例外或rolling expand。須先關閉打卡入口並停止API／雙worker，final加密備份實際還原與保存驗證後才升級40並啟matching artifacts；不在線migrate40。恢復寫入後保留40／fix forward，不退39或回灌舊快照；正式rule發布、授獎及重算仍停用。

第二階段另核准：不可變published rule/activity versions、未来生效及全部評估入口的結算gate、舊版獎章／名稱／條件讀取、版本選擇與一CSV一版本、正式發布與排程。不得因發布新版讓歷史獎章消失，也不因preview／一般管理GET發獎或撤獎。
