# LINE／Telegram新心得明示分享（已部署schema34）

## 已核准範圍

使用者核准：LINE與Telegram打卡表單明示**「打卡心得供所有學員閱讀」**，不提供分享checkbox；不想分享可不填心得。Telegram英文顯示同義文案。這是送出當次內容的明示分享，不宣稱LINE網站的同意已被小幫手記錄，也不發布草稿政策或回填法律同意。

正式為9d00120484f0ef46ba83ed65166c1ac176a60e4d／schema34，2026-10-15 10:32:13–10:32:30 UTC部署完成，CI38719995438／675tests與140HTTPS checks成功；詳見[部署／實際還原證據](community-note-sharing-deployment.md)。使用者已回報邀請→核准→打卡成功。使用者後續另核准commit/push/deploy，已以全新獨立PostgreSQL16叢集完整驗證675項通過，未改任何測試斷言或正式授權條件；最終正式33備份解密實際還原與matching34 API-worker部署均完成；原私人紀錄不回填，兩份env bytehash與通知flags保留，Console未改。調查時正式有6筆LINE非空心得（全渠道9筆）、journal publications0、active policy0、accepted records0；故管理端可讀私人紀錄而心得流空，不將它說成API抓取失敗。

## 行為

- LINE與Telegram工作區表單移除「私密」心得標題、放明確分享告知，無分享checkbox。另告知暱稱、功法、勾選感受、練功地區／日期與統計會隨心得供**已核准有效學員**閱讀，不對匿名／未核准者開放。
- 新表單送出notice version `student-community-notes-v1`；新RPC在原save同一交易完成owned/versioned/idempotent練功儲存與publication，外部分享FALSE。空白／純空格不刊登，只有選感受而沒寫心得也不產生新心得卡；原chat summary仍不含心得／感受。
- 新UI首次建立的checkin記錄notice origin；既有只有練功、原本沒有心得的記錄，在本人新版表單首次寫入新心得時也可刊登。**原有私人心得不因升級、修改或加notice的重試被公開**；不回填既有6筆。
- 舊頁面／舊client沒有notice則維持原行為，不會因部署被偷偷改成公開；replay不會補marker。公開過的自動管理心得更新快照；舊client私人修正不會被先前公開請求的重試帶出去：須目前version及note仍匹配，才刷新snapshot。
- 清空自動管理心得會停用該publication；之後本人新版再寫可重新刊登。原有「我的心得」發布／選擇／撤回保留，任何本人手動操作或privacy撤回後改為manual-controlled，後續save/retry不自動覆寫或重發。UI會報告保留私人／手動分享狀態，不假稱已公開、也不直接關閉native頁面。
- 歷史私人心得仍可由本人在「我的心得」明確發布。WhatsApp打卡、舊save endpoints與獨立external opt-in不變；不因新預設向外部API／網站分享。

## 實作與安全

- 新 `0034_community_note_sharing.sql`，舊0001–0033完全不動。新增forced-RLS `core.community_note_origins`，只存checkin FK、notice version、manual_controlled及timestamp，不存法律同意或內容副本。
- API按渠道驗證notice literal；WhatsApp拒絕此field。無notice呼叫仍走原save語意及result shape；原request/version/reason/post-lock/timezone/校正期限與收據去重保留。
- notice的transaction-local context只由新save facade設定／還原。原checkin即時trigger記錄origin；刊登函式private不授權runtime直接執行，owned identity／active person／channel／approved及reflection consent再次驗證。
- 原privacy default-publication trigger對community-origin記錄不自動刷新，避免漏帶notice的舊client更新私人文字卻公開。自動刊登的publication標記context，手動publish/withdraw trigger辨識後保留本人控制；person advisory lock＋publication→origin鎖順序協調save/手動分享。runtime不能直接讀寫origin表。
- 原必要同意及reflection consent gates不繞過；若日後有正式active政策，未同意／已拒絕心得同意者不能靠notice繞過。只打卡、沒有心得仍可依既有政策規則進行。政策拒絕會清掉敏感snapshot／停external，原規則保留。
- 新API exact34、worker `ops.community_notes_schema_ready()`／phase-19-community-notes。33→34測試保留舊私密文字與所有非metadata指紋，新origin表空、forced RLS、重跑0；舊33 gate拒絕34。歷史32→33測試固定chain到33。

## 驗證與開發回歸背景

- 新DB16項（LINE8／TG8）通過：跨地區／渠道閱讀、預設external off、空白不刊登／新增note／清空重寫、舊私人／舊client／replay不公開、版本不符不搬私人修正、withdraw保留、consent gates獨立、rollback／停用／權限。
- LINE/TG HTTP各一項新整合測試確認save後feed讀到文字、400拒絕未知notice／external注入；完整HTML/scripts VM另5項確認確切文案、notice payload、不新增checkbox、原私人／manual狀態不假關頁、WA不變。
- 最新source typecheck、format/lint、build通過；額外all-test tsc仍10個既有錯誤，不新增。
- actual Chrome390／1280：LINE繁中、TG中英，打卡＋心得頁共12頁；真DOM選功法、填心得、save攜notice、成功訊息、feed顯示、note卡無checkbox／無「私密」標題、zero overflow／exception。SDK／backend皆synthetic，沒有真人provider發送，preview/Chrome已停。不是正式LINE/TG手機交付驗收。
- 中間版本完整verify曾673項通過；增加2項privacy cases及修正畫面標題後，**舊共用叢集當時675項完整verify未全通過**，當時不能宣稱全綠；後續獨立乾淨叢集675及exact SHA CI均成功。後續完整回歸先後出現：WA時區API400、TG miniapp關閉channel時間戳check constraint、journal source-conflict測試卻先遇practice identity unavailable。前兩項單獨重跑成功，最後一項未再重跑；與既有類似flakiness根因仍待查。該輪達重試上限後停止，沒有宣稱修復根因。使用者後續核准發布，改用全新隔離PostgreSQL16測試叢集（55454／qigong-community-release-test）完整pnpm verify **675項**及format/lint/source TS/build成功；未放寬斷言或改正式權限。這排除了本次發布候選在乾淨環境中的重現，但不證明舊共用叢集不穩根因已修復。
- 新community fixture有一次在建立Telegram link後未能resolve身份；已把合成「既有active」channel明確設為一天前生效並assert link ready，後續該suite通過；這不表示已找到／修正其他既有時間戳／權限不穩根因。
- 證據 `/tmp/qigong-community-notes-verify*.log`、all-types/build log、preview/cdp scripts及12張screenshots。不得將provider秘密／正式資料帶入Git。

## 下一步

後續發布已獲核准並完成，獨立乾淨叢集最終675通過（/tmp/qigong-community-release-verify.log）、exact SHA CI成功、正式33備份實際解密還原及matching34 API-worker切換完成。不能以局部測試／中間673通過代替該完整675結果，也不將原共用叢集flakiness說成已修復。

發布沒有批量公開舊私人心得（調查當時6筆LINE）；現在請由本人新增一筆LINE、TG心得端到端驗收，若已有舊私人心得需另行明確發布；未填文字不應刊登。34不能只切binary退33；流量後DB回復須matching33DB＋4aa38f1 API-worker及另核准寫入對帳，不能覆蓋新心得與分享／撤回狀態。
