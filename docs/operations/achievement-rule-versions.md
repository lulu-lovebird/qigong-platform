# 第二階段A：不可變版本與歷史讀取相容（本機候選43）

## 核准與邊界

使用者確認：無結束日功法badge達標即發；更正後不再達原獲獎版本條件則自動撤回、保留audit；有結束日活動沿用max supported-zone補登截止UTC＋24hours。接著核准**A階段本機實作與驗證**，不是B發布、C即時授獎實作／啟用授權，也不包含commit／push／deploy。正式上一發布紀錄仍be126a5／42，本輪未連正式、無正式個資CSV／provider sends／Console／flags／政策／同意變更。既有兩份無關文件保留。

A完成版本底層、歷史讀取及CSV選版。**canPublish=false、publish／activate／recalculate endpoints仍不存在**，不將任何草稿轉正式，不啟用新rule、不回算／重設進度、不改寫既有獎章或49個live definitions。撤回後再達標是否自動恢復仍為C待確認項目，不因A擅自變更政策。

## 後續B本機候選44（未提交／未部署）

使用者另核准B的安全準備流程，已完成獨立private pending-candidate表、同有效global master/super準備權限、revision/hash/reason/future-date/session/post-lock guards及三語UI；不寫A的core version registry或live definitions、不啟用或發獎。合併候選API範圍延伸為42–44、phase27／原worker不動，同候選三schema矩陣過；仍須另核准相容先行版／正式發布，不在舊exact42上直接apply43/44。見[B詳細範圍／1079測試與13組browser證據](achievement-publication-candidates.md)。以下為A原本機checkpoint與其測試，不混稱B已正式啟用。

## 不可變版本

- 新`0043_achievement_rule_versions.sql`是additive expand；0001–0042完全不改。新增`core.achievement_rule_versions`，key=`badge_code/rule_version`，存provenance、snapshot、SHA256、captured_at。forced-RLS／無API-worker raw access，UPDATE／DELETE／TRUNCATE trigger拒絕；沒有新管理permission或publisher facade。
- `legacy_snapshot`：凍結可證實的現存definition（包含原canonical method_codes）與對應既有season資料。這是migration當時的來源快照，**不偽造原始生效／發布時間**，也不把既有49種規則改成新rule生效日起算或清空舊進度。
- `unknown_legacy`：已記錄獎章的舊版本沒有可證實原始條件時，snapshot=NULL；讀取顯示code＋版本、kind未知／threshold null及明確警語，不把目前名稱、門檻、功法或日期當作舊版條件。migration後發現未登錄的獲獎版本也能唯讀呈現未知來源，**GET不回填metadata**。
- 已知歷史snapshot不受後來current-definition修改影響。一般讀取不修改snapshot／source_hash／award／audit／queue。舊版年度／period照紀錄呈現，不猜未知類型；年度篩選仍只對可判定的summer／winter版本套用，不臆造未知版本季節條件。

## 後台與CSV

- 原42 facade／signature／現行49種邏輯不替換。新增version catalog／recipients facades，沿用stats.read＋learner.read＋checkin.read及所有person scopes。已知規則metadata不含個資；未知版本只在當前可見學員確有該版紀錄時出現在版本選項，不洩漏他區版本存在與人數。
- 後台保留49個主要圖鑑card，增加版本數提示與名單區版本下拉；切版顯示該版凍結名稱／條件，未知者明示不代入現行條件。名單仍是所選版本未撤銷紀錄；撤回歷史在學員頁保留、audit不刪除。沒有把跨版本名單混成目前版本。
- URL及API用`version`正整數；只接受數值或純正整數字串，拒boolean／null／空字串／負數／小數／空白字串。42尚無version facades時，明確version要求拒絕，不默默換成current。
- CSV新增version-aware preview／prepare，**一份CSV固定一個version**，filename包含vN；UI預覽及實際送出固定相同版本，版本／scope變動取消舊request，preview回報錯版即拒絕下載。預設舊42請求沒有version時保留原export路徑。
- 沿用global super／master同role export＋三read、verified provider/subject binding與current approved contact來源、Origin／CSRF／purpose確認、5001 sentinel拒超5000、JSON5MiB／CSV10MiB、30秒actor lock／cooldown、最少audit、不記名單搜尋或聯絡資料。CSV編碼後仍同連線wall-clock檢查actual session與授權，失敗回滾audit／cooldown且不送bytes；UTF8 BOM／RFC quoting／公式與ID文字保護不變。

## 學員頁與評估邊界

- TG與共用LINE／WA介面顯示獲獎ruleVersion，歷史／撤回版本依本人資料呈現；未知條件有明示文字、generic icon安全fallback、不出現undefined或推測門檻。名稱及獎章狀態用textContent，不翻譯學員姓名／心得／理由。
- 新private badges reader純讀，不能被runtime直接執行任意person。公開wrapper先沿用既有verified-token／provider-subject／privacy／eligibility驗證，再只讀該person的版本紀錄，不能看別人。
- **A刻意保留原學員report的legacy evaluator行為**：wrapper呼叫舊report再替換版本化badges；所以不宣稱整個學員獎章GET／report已完全無寫入。新的admin版本GET與private reader本身READ ONLY可執行。C才會統一所有授獎入口、拿掉讀取觸發評估並接即時mutation評估／補漏。既有49種授獎與每分鐘worker不因A被改寫。
- 無外部得獎通知接線；WA僅共用模板／相容讀取，不代表配置或啟用。

## 42／43相容發布策略（本輪不執行）

- Candidate API min42／max43。43不改`core.platform_metadata`的phase27；現有兩worker source／舊schema gate不動、在42及43均ready。另有API-only `ops.achievement_rule_versions_schema_ready()`，只表示additive reader schema已安裝，不表示發布或新授獎啟用。
- 新API在42先探測新facade signature是否存在，缺少則走舊SQL，不在42解析不存在的43函式。明確版本要求在42失敗而不是錯版匯出；43則選version-aware facade。已驗同一候選的42／43 API readiness與old worker gate。
- 舊be126a5 exact42仍拒43，**不能在舊程式運作時直接套43**。未來若核准，須先把相容42／43候選與matching workers部署到42、驗保護／還原／讀取契約，再在相容服務下進行43 expand及回歸；未完成的相容先行版部署、正式clone／backup actual restore與切換演練不假稱已完成。本輪沒有取得新維護例外，也沒有沿用42授權。
- B發布權限／immutable發布版本、生效與活動鎖定；C即時授獎、自動撤回、版本化重試／結算gate、舊版不被新版撤獎，仍需下一階段方案核准。不能只打開publish按鈕。

## 驗證與失敗證據

- Node24兩strict TS gates、format／lint／typecheck／build、靜態簡中來源檢查過；最終完整verify **1047 tests**（API779／DB260／config2／identity6）。
- 新DB8：actual42→43 apply1／repeat0、全部79舊表資料與原function definitions逐一保存（沒有metadata version/time例外，43不改phase27）、49個known snapshots、歷史unknown與region scope、本人撤回歷史、immutable UPDATE／DELETE／TRUNCATE／raw/helper/worker拒絕、兩角色單版export與cooldown/audit、verified snapshot不被current覆蓋。新metadata表共80表，沒有修改award／jobs。
- 新HTTP42／43矩陣2：同候選readiness兩邊200、worker gate兩邊true、42不支持version時400、43歷史名單與synthetic-only CSV只含v7、filename與audit同v7、嚴格輸入、publish false／端點404；沒有正式個資匯出。TG新增本人歷史／已撤回／不可讀別人case；admin VM18含三語選版、CSV pin、preview錯版拒絕、確認時切版取消。
- 實際compiled Fastify＋獨立PG16及合成session，browser **13組／24圖**（super／master ×三語 ×390／1280，加viewer讀取但無個資export）。390未知v7／1280可證實舊v2切換、URL／名稱／警語與metadata count過，12次CSV metadata preview與12次取消確認，**browser不生成任何CSV檔**、不寫audit／cooldown；其他business fingerprints相同、drafts/previews/audit增量0、無overflow／API或JS errors。不是真人OAuth／實體手機或實際部署驗收。
- 開發期SQL NULL經DISTINCT推斷為text、constraint括號錯誤已修正；synthetic CSV測試原本錯期待未引號文字，修成精確RFC quoted version欄位。失敗輸出保留，未改歷史migration。
- 首輪完整verify發現既有admin-reporting測試在3/20=.15時，JS toFixed回.1而PostgreSQL numeric round回.2；已用獨立BigInt有理數half-up期望值取代binary toFixed，**正式報表SQL未改、未調時鐘／fixture或放寬相等斷言**。focused27及完整1047過。之後收緊version型別再驗完整1047，非無原因重跑求綠。

證據：`/tmp/qigong-achievement-versions-verify.log`（原rounding失敗）、`...-verify-final.log`與最終`...-verify-complete.log`；`/tmp/qigong-achievement-versions-browser-{results,preservation}.json`及`...-{super|master}-{zh_TW|zh_CN|en}-{390|1280}-{catalog|historical}.png`。私密合成fixture／憑證不貼值、不入Git。專用測試PG55518／preview PG55519、HTTP55520／CDP55521在驗證後停止。
