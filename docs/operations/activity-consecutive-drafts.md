# 獨立活動 badge：可選連續打卡（已部署42）

## 核准與範圍

使用者確認41可空白新增，回報缺少「需連續打卡」選項，再核准開始本機修改。本機階段未提交／推送／部署／連正式；使用者後續另明確核准本次commit／push／deploy與41→42直接協調維護例外。待精確SHA CI及隔離演練過，封鎖入口並停API／雙worker後取得final加密DB／roles／runtime、實際還原及保存驗證通過才升級與matching切換；已完成正式be126a5／42切換，CI39281636756首輪1031 tests、維護62.146秒／229 Node HTTPS及health過；見[正式部署／實際還原與復原邊界](activity-consecutive-deployment.md)。0042現亦immutable。既有人工readonly驗收增補與permissions-review兩份無關文件保留，不納入本次變更。

- 僅獨立活動 `subject=event`新增「需連續打卡」，預設未勾。三伏／冬至既有`activity`條件、rule及功法badge既有challenge語意不變。
- 未勾：活動起訖日期內不同有效打卡日期累計達N天。勾選：期間內任一段連續N個曆日達標，中斷後新段從頭計；曾達標不因後續中斷而撤回該段達標事實。每日最多一天，任一功法，不計活動開始前或結束後的日期，不承接舊活動進度。
- 日期依既有practice_date結構化資料計算，非湊滿N×24小時；跨月／年／閏日也依曆日相鄰。有效補登仍受原規則，沒有延長補登權利。結算試算仍max supported-zone D+1noon UTC＋完整86,400秒，不改正式授獎時機。
- 日期／時區／門檻原有必填與範圍驗證不變；勾選不自動改名稱、不自動儲存、不自動試算。儲存後再開保留選項；修改任何條件立即清掉畫面舊preview並停用preview，避免把累計舊結果當作連續新結果；只有reason變更不會假稱計算條件已變。未存離開veto保留。
- 表單條件摘要、已保存preview都顯示累計／連續模式，三語手機／桌面一致。**仍僅草稿及aggregate試算**，不發布、不生效、不發／撤獎、不重算既有awards；`publicationEnabled=false`／`wouldRevoke=0`。

## 向後相容與安全

- 0001–0041 immutable不改。新`0042_activity_consecutive_drafts.sql`只替換`admin._achievement_config_validate`及`admin.compute_achievement_config_preview`兩個body，保留原owner／ACL／SECURITY DEFINER／search_path／volatility；不改其他function definitions、table/index/constraints、permissions、role mappings或raw grants。
- 既有event JSON缺`continuous`＝累計。**讀取不補寫false、不回填、不增加revision、不改configHash／baseHash或舊preview觀測／到期時間**；DTO使用optional boolean而非default注入，舊cached result沒有該欄位仍合法。只有明確保存才把checkbox布林值寫入新revision。
- SQL允許event省略flag或提供真正boolean，拒字串／number／null；季節activity仍拒該額外key。預覽選event_streak時只對accepted distinct dates分island取完整段，未勾／省略走原累計。新event preview回傳明確mode；既有cached preview不改寫，缺mode在UI按原累計解讀。
- 原Origin／CSRF、actual session最後重查、global master／super與preview三read/person scopes、reason／revision、post-lock source／grant／started checks、容量／timeout／cache／cooldown均保留。舊cached revision在保存後不會冒充新revision。無個資roster或心得感受讀取。
- 正式API exact42、兩worker `ops.achievement_event_streak_schema_ready()`／`phase-27-activity-consecutive-drafts`；41與42不相容，**本次commit／push／deploy及42直接維護例外已另核准；已在CI／演練與final actual restore/preservation過後完成切換，resume後保留42／fix forward，不退41或回灌舊快照**，不沿用41例外、不在線migrate42或binary-only切換，不改正式flags／provider／政策。

## 驗證

- Node24兩strict TS gates、format／lint／typecheck／build、靜態簡中來源檢查通過。完整verify **1031 tests**（API771／DB252／config2／identity6）首輪成功；既有40→41 upgrade固定target41，未混入42，歷史39→40維持target40。
- 新DB8：實際41→42 apply1／repeat0、全部79表normalized資料（只有預期architecture/time／ledger差異）、原RLS／ACL及function attrs保存；舊event config／revision／sourceHash／cached preview原樣保留、無false回填；兩角色累計2／連續1；多功法同日不多算；活動前後邊界／gap／已完成段／門檻／閏日／跨年；read-only preview；toggle僅intentional revision與舊cache失效；invalid flag／季節override／viewer／raw／worker拒絕。
- Model27、VM24、HTTP20過；新覆蓋三語checkbox預設、只對event可見、不autosave／不改手動名稱、舊cache顯示累計與條件改動清除舊結果、明確true／false save與重開、legacy缺欄位不正規化、strict seasonal／event輸入。
- 真compiled Fastify＋獨立PG16、合成session及本機origin adapter，browser **13組／24圖**（super／master × zh_TW／zh_CN／en ×390／1280，加viewer拒絕）。390未勾累計2、1280勾連續1；12份實存event／12preview／24預期audit，重開模式保存、toggle清舊preview且不發request，checkbox label手機44px／輸入16px、無overflow／API或JS errors；所有其他business表fingerprint相同，沒有真人provider send或正式資料。非真人OAuth／實體手機完整驗收。
- 本輪完整suite／browser均首輪過，沒有放寬斷言或為求綠重跑。專用測試PG55512／preview PG55513、HTTP55514／CDP55515於驗證後停止。

證據：`/tmp/qigong-event-streak-verify.log`、`/tmp/qigong-event-streak-browser-{results,preservation}.json`、`/tmp/qigong-event-streak-{super|master}-{zh_TW|zh_CN|en}-{390|1280}-{blank|preview}.png`。私密合成fixture不入Git、不貼cookie／連線憑證。本機階段未連正式；正式僅本次另核准的0042與matching切換，沒有產生正式個資CSV、改clock／Console／flags／政策／同意，原clock／TG history403及Python-UA edge差異不因此結案。

參考：[獨立活動41規格](independent-activity-drafts.md)、[41部署與復原](independent-activity-deployment.md)、[schema協調規則](../architecture/schema-compatibility.md)。
