# Web Admin 唯讀成就榜（schema38候選，僅核准提交／推送，未部署）

## 範圍

使用者先核准第一版唯讀成就榜的本機實作，後續僅核准commit／push並等待exact-SHA CI；**沒有核准部署**。正式紀錄仍為0ec97d5／schema37；不操作正式入口／DB／provider Console／env／服務／旗標／告警或主機時鐘。歷史0001–0037、套件metadata／依賴／lockfiles、無關permissions-review與legacy不動。

新增 `/admin/achievements`，放在「報表／分析」內、練功排行榜之後。提供49種徽章、六類分組、共享圖示、條件說明、目前規則版本、設定狀態、獲獎人數及按徽章載入的學員名單。繁中／簡中／英文，沿用compact desktop／phone樣式；點選徽章後移至可聚焦名單區，提供返回圖鑑連結。

**不包含**活動日期／徽章規則編輯、補發／撤銷、歷史重算、舊系統資料匯入、CSV／外部發布或通知。尚未設定的季節活動直接提示，不猜官方日期。

## 資料與統計契約

- 只讀 `core.person_practice_badges` 已儲存、未撤銷且 `rule_version` 等於目前definition版本的紀錄。不是即時計算學員是否應獲獎。
- 每徽章人數為可見範圍內的distinct person，不以姓名、平台subject或年度筆數合併／重複計人。同人多年度各獎項留在明細中。
- 不呼叫學員端會執行 `core.evaluate_practice_badges` 的achievements report，不enqueue job、不寫獎章或audit。頁面明示背景結算可能待處理。
- 篩選：目前主要地區、目前有效互動管道、literal／case-insensitive姓名搜尋、季節活動年度。管道是目前channel，不把person-level獎章推定為某平台授予；其他已綁identity不是目前管道。
- 年度僅篩選summer／winter的award period，其他徽章不套用。combo的年度period仍如實顯示，不從 `earned_at` 推算活動年度。
- 獲獎記錄時間及讀取時間以UTC標明；不是首次達標日期。季節日期／timezone／requiredDays從現有設定讀取，不以definition.threshold取代每年活動門檻。
- 學員名稱沿用既有後台preferred／legal／public metadata，不使用名稱授權或綁定，不轉換人名。只有既有source-owned徽章／地區系統標籤作簡中呈現；原始資料不改。
- 有效學員／目前地區與cohort範圍沿用後台現行報表契約，不是歷史地區歸屬報表。停用人員／撤銷獎章不在預設榜單，歷史資料仍保留。

## 權限與唯讀 API

需要有效的既有管理session，以及 `stats.read`、`learner.read`、`checkin.read` 三項權限。每位學員都須同時通過三項 `admin.can_access_person`；country／region／cohort均套用。content-only／stats-only不足以讀取名單；不因有badge.manage就增加學員資料讀權。

- `GET /admin/api/achievements/capabilities`：僅canReadAchievements，導覽預設隱藏，查權限成功才顯示。
- `GET /admin/api/achievements`：scoped catalog／人數／期間與地區選項。
- `GET /admin/api/achievements/:code/recipients`：同一scoped population的distinct人數、確定排序名單與awards。

共同參數：lang、region UUID、platform、q（至多100 Unicode codepoints）、year2000–2200、page1–10000、limit1–100。未知參數拒絕；page／limit對catalog沒有分頁作用。不存在的badge404、未授權地區／不足權限403、無session401、格式400。停用／撤權後的下一讀取不再允許；不保證召回已經讀出的in-flight資料。

新migration只新增 `admin._achievement_people` 私有helper、兩個受限reader及ops gate。固定pg_catalog search_path、SECURITY DEFINER與顯式principal／permission／scope檢查；PUBLIC execute為0，helper不授予API／worker，reader只授API。徽章原表及工作／稽核表的raw讀權不增加，forced RLS／舊ACL保持。

HTTP回應no-store，HTML附既有CSP／no-referrer／nosniff。只有GET／HEAD讀取，沒有新增修改端點或CSRF繞路。DTO經明確schema投影，沒有Email、電話、provider subject、credential或心得；學員分析連結只含內部personId／lang，不帶姓名或平台ID。

前端使用textContent／text nodes，不以innerHTML插入DTO。Catalog與recipient各有AbortController／generation，切換篩選或新請求會丟棄舊回應；401／403會清除所有舊資料並使延遲成功回應失效。沒有localStorage或私人快取。原後台語言／logout／draft veto流程不變。

## Schema 與發布界線

新增且尚未部署的 `0038_admin_achievements.sql`，phase-23-admin-achievements。**不新增table，不修改既有award/rule/season/person/check-in/profile/publication/job/audit資料**；只改platform架構metadata／migration ledger並新增4個函式。

API min/max exact38；minute worker及realtime receipt runtime均用 `ops.admin_achievements_schema_ready()`，API和兩worker須matching38。37→38 preservation檢查涵蓋所有既有table hash（metadata僅排除預期架構／updated_at）、私人note source、stored award版本、jobs、RLS／ACL與舊function安全attrs；repeat migration為0。舊36→37升級測試固定只重播至37，不把新38混進舊邊界測試。

本候選不是37可接受的rolling expand release。正式發布另需核准相容橋接版，或明確審核的協調維護方案：drain／stop API＋minute＋realtime，final加密備份實際還原、38 clone preservation，再migration／matching切換。**不能只退37 binary**；降版要matching DB/API/兩worker及新流量對帳，不能拿舊snapshot覆蓋新寫入。見schema-compatibility contract。

## 本機驗證與證據

- Node24／獨立PostgreSQL16 `qigong-admin-achievements-test`、loopback55482；browser用另一獨立container `qigong-admin-achievements-preview`／55483，不干擾原共享roles／ownership fixtures。
- 完整 `pnpm verify` 首次抓到新VM測試3處不安全Request字串化，改以string／URL／Request.url縮窄，未關lint規則；後續完整 **851 tests**（API649／DB194／config2／identity6）與format／lint／source typecheck／build通過。額外all-test與CLI project嚴格型別亦通過；最後確認以交接最新結果為準。
- 新DB7項、37→38 preservation1項、真session HTTP15項、VM控制器7項及獨立nav capability／branding覆蓋。包括跨區偽造、同名不合併、目前channel vs其他identity、distinct多年度、撤銷／舊版本、空頁與參數、內容角色不足、撤權下一讀失效、BEGIN READ ONLY查詢、原表／helper拒絕及PUBLICexecute0。
- VM確認三語key完整、literal markup、套用篩選、stale catalog、401／403清資料與in-flight recipient抑制、明確重試、焦點／捲動／返回圖鑑。真HTTP確認簡中徽章標籤與原學員名稱保持原字。
- 真compiled API＋受限DB Chrome **12 layouts**（global/regional ×3 locales ×390/1280），24 screenshots，實際49cards／不同scope人數、literal名字／emoji、CSP、44px手機controls／16px輸入、無頁面overflow／JS exception／API failure；名單可聚焦且可回圖鑑。都是合成身分與模擬登入，不是真人／IdP或手機實機驗收。
- Browser harness初次阻擋既有外部logo，改由攔截器供應同一公開PNG而不放寬CSP；初次preview未設定LINE造成既有capability404，補僅合成LINE設定；重建DB時舊preview殘留controlled-role ACL依賴被guard拒絕，先正常結束並驗證preservation，再清理自己專用的合成DB重建，未放寬guard或改共享roles。產品API／資料隔離斷言未放寬。

證據：`/tmp/qigong-admin-achievements-{verify-2,types,cli-types,cdp-final}.log`、`browser-results.json`、`browser-preservation.json`及`*-catalog.png`／`*-recipients.png`；preview／Chrome／專用container結束後停止。私人合成DB設定不放Git／日誌，零正式存取／provider test send。本輪沒有修正或宣稱解決舊VM時鐘／間歇403問題。後續僅提交／推送以觸發候選exact-SHA CI，不能以本機851通過冒充GitHub結果；不作正式發布／入口維護閘或資料庫／服務操作，部署與回復準備仍需另核准。
