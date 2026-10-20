# 第二階段B：準備不可變待啟用版本（本機候選44）

## 核准與安全邊界

使用者在A本機完成後，確認B具體方案：建立「準備發布、待啟用版本」、global master／super權限、revision／hash／reason／session／future-date及post-lock來源防護，補UI／三語／測試；**本輪不commit／push／deploy／連正式，不啟用正式發布或發獎**。A所有本機修改與兩份既有無關文件保留。正式上一發布仍be126a5／42。

現有49評估器會讀`core.practice_badge_definitions`，所以B**不在live definitions或A的core.achievement_rule_versions登錄新badge／版本**，不排授獎job、不更新awards。所有新記錄只在admin私有candidate表；即使日期到達仍不自動啟用。C尚未完成前`canPublish=false`，publish／activate／recalculate endpoints仍404；不得把這個按鈕改名為「已正式發布」。

## 後續C本機候選45／46（A/B/C均未部署）

使用者另確認自動恢復政策並核准C本機完整實作，版本化評估／即時commit／撤回恢復、runtime發布與取消、report pure-read、UI／CSV新code已過最終1105測試及13組合成browser。operator control DEFAULT FALSE、無enable API；只有隔離tests／preview owner開true測positive。不改B sealed rows，實際registered/state由獨立C資料衍生；下方B checkpoint的canPublish=false在operator OFF時仍成立。相容範圍延伸42–46，正式commit/deploy/enable另核准。見[C範圍、證據、已知行為變更與正式前置](achievement-versioned-runtime.md)。

## 資料與授權

- 新`0044_achievement_publication_candidates.sql`，不改0001–0042已部署migration，也不覆寫A的0043。增加forced-RLS、無API／worker raw grants的`admin.achievement_publication_candidates`與restricted facades。
- 新permission `achievement.prepare_publication`只預設映射super／master；必須同一有效global角色同時具備manage_drafts及prepare_publication、principal active、wall-clock grant有效。不是實際activation／award permission；viewer／非global角色不能準備。permissions總數31；沒有把任何人新授角色。
- snapshot固定draft id／revision、subject／code／year、normalized config（累計／連續、canonical leaf ANY/ALL／日期皆照saved draft）、原baseConfig與hash、config/source hash、生效日、supported timezone陣列及活動deadline。SHA256封存、單row可達128KiB拒超限；理由另存且1–1000codepoints／不允許NUL，UI提醒勿填學員個資。人工reason不保證天然不含個資，不置入metadata名單。
- state只能`awaiting_activation`、activation_enabled只能false；UPDATE／DELETE／TRUNCATE immutable triggers拒絕。沒有可切active的B狀態欄位或endpoint。將來C需獨立activation log／狀態衍生，不能改寫這份sealed config。
- `candidate_version`是保留候選號，不等於已生效rule_version。每code在advisory lock下取A registry、stored award versions（含來源不明舊版）及既有candidates最大值＋1，避免撞舊版；只保留編號、不寫core version registry。C啟用仍要重查碰撞／來源及相容性。

## 準備交易

1. UI只對已儲存、未archived／locked／sourceChanged且沒有未存條件修改的draft顯示可用按鈕。reason-only可準備；缺理由不送request。
2. GET publication-review在actual session及prepare role下回傳draft revision、config/base/source hashes、生效日、eligible與固定blocked reason，不發獎、不audit、READ ONLY可執行。
3. 過去模擬日期不能準備：effective_date必須嚴格晚於**每個supported practice timezone的今天**，以max當地日判斷；不默默改日期。季節activity年必須等於start year；原已開始season鎖與來源changed也拒絕。
4. 確認訊息明示只是待啟用、沒有啟用與發獎。POST只接受expectedRevision／三hashes／reason／confirmed=true；不接受caller config、actor、code、版本號、activation／award旗標。
5. SQL拿privacy shared lock、draft FOR UPDATE、per-code publication advisory lock及global publication-capacity lock後，重新驗wall-clock權限、目前來源／條件、活動開始狀態、future date與三hashes；不能用舊review直接覆蓋新revision。
6. 同draft／revision相同hash重試回原id／timestamp／snapshotHash，不新增audit；跨master/super並行也只有一份。不同新revision產生新candidate，原snapshot不變。capacity5000拒超限，不截斷；API statement_timeout5秒。
7. 寫candidate及最小`achievement.publication_prepared`audit同transaction：actor/request/draft/code/version/hashes、waiting state及false flags，不放config／名單／聯絡資料。回應前仍同連線檢查actual token／principal／prepare permission的wall-clock有效性，失效整筆candidate／audit回滾。

## 讀取與UI

- 新service `admin-achievement-publication.ts`以strict DTO驗證review／sealed snapshot／list，activation與awarding均literal false。新的API是publication-review、prepare-publication、publication-candidates，不是publish／activate。
- 既有管理頁增加「準備發布版本」、全域候選列表（20筆分頁）及凍結快照面板。三語顯示「候選版本／待啟用／發獎關閉」；即使生效日期到達也不自動啟用的說明可見。一般Save、Preview、Archive原權限與veto不放寬。
- review的id／revision必須仍對應所見saved draft；確認期間改條件或切draft不送POST。準備成功只清相同舊reason，不覆蓋另行輸入的條件或名稱。
- snapshot的config獨立顯示；原draft修改revision、archived或source改變後getter衍生stale=true，sealed bytes／timestamp不變。再次準備是新候選號。C必須再次檢查current draft/source／stale／future-policy等，不能因B曾eligible就盲啟用。取消／啟用生命周期仍留C另行設計，B不刪snapshot。
- global授權喪失時清editor、list及snapshot面板；不自動重試。所有DOM動態文字用textContent，config名稱的簡中／英文只取明示欄位或literal fallback，不翻譯reason／人工內容。

## 相容與後續

- 同候選API min42/max44，42／43沒有B facade時capability false且準備API拒絕；44才依角色提供`canPreparePublication`。`canPublish`一直false。44不改phase27，兩原worker source／gate不動，沒有授獎啟用旗標。
- 舊be exact42不能直接跑43／44。A／B都未部署；未來須另核准，先把42–44相容程式及matching workers部署到42、實際驗還原／保護／流量，再按審核方案expand43／44。沒有新維護例外，不沿用先前42授權。
- C仍需新version-aware evaluator、同步mutation評估／補漏、活動UTC cutoff＋24hours gates、原版本自動撤回與歷史相容、啟用交易與控制；無截止功法badge達標即發政策已確認，撤回後再達標是否自動恢復仍待確認。LINE/TG得獎通知也未在B接通。

## 證據

- Node24兩strict TypeScript gates、format／lint／typecheck／build與靜態簡中來源檢查；最終完整verify **1079 tests**（API800／DB271／config2／identity6）。A的42→43 test固定target43，舊43資料不混進B歷史驗證。
- DB11：actual43→44 apply1／repeat0、80舊表normalized rows（只允許新permission／2 default mapping差異）及全部原function definitions保存；兩角色、read-only review、sealed deadline＋86,400秒、無live/core-version/award/job變更；並行／idempotence、stale/archived、forged hash／revision／confirm、future-date／year/source、reserved version避unknown舊號、immutable/raw/helper/worker/viewer拒絕、audit rollback、實際capacity lock等待後來源與自然grant expiry重驗。
- Model9／新HTTP6／VM29；HTTP涵蓋兩角色read/retry/list、Origin／CSRF／strict body／past simulation、audit內撤session後final rollback、自然session expiry後wait回滾；API同候選42／43／44三matrix均ready、只有44可準備、三邊publish false／activate404。
- compiled Fastify＋獨立PG16／合成session browser **13組／24圖**（兩角色×三語×390／1280，加viewer拒絕）。12 drafts、24次確認／準備POST只建12 unique candidates，重試id/hash/time相同、重開sealed snapshot正常；沒有aggregate preview、沒有Core version／definition／awards/job改變。預期24 audit＝12 draft-created＋12 preparation，其他business fingerprints相同，無overflow／API或JS errors／provider sends／正式資料。非真人OAuth或實體手機完整驗收。
- 初輪針對舊capabilities exact shape測試因新增false capability而失敗，增加該false精確期望、原canPublish=false斷言不動。完整verify先抓新HTTP fixture unused delay與unsafe any，移除unused並用實際strict schemas parse；下一輪既有0013→0014 upgrade合成reviewer預設valid_from時間邊界出現permission denied。保留失敗，將該**測試**角色明示clock_timestamp-1day並加`can_review_application=true`前置斷言；正式授權SQL／歷史migration／系統時間不改，不宣稱時計／VM根因修復。focused與完整1079過，沒有為求綠忽略失敗／放寬驗證。

位置：`/tmp/qigong-publication-candidates-verify.log`（原lint）、`...-verify-final.log`（原upgrade權限失敗）、最終`...-verify-complete.log`、`/tmp/qigong-publication-candidates-browser-{results,preservation}.json`、`...-{super|master}-{zh_TW|zh_CN|en}-{390|1280}-{ready|sealed}.png`。私密合成憑證不貼值／入Git；test PG55522、preview PG55523、HTTP55524／CDP55525驗證後停止。見[A範圍](achievement-rule-versions.md)、[schema策略](../architecture/schema-compatibility.md)。
