# 舊LINE bot徽章雅名顯示別名（發布候選／待部署）

## 核准與範圍

使用者核准本機移植可證實的49項badge名稱，33功法天數按code/7/30/100精確對應，其餘不猜配；只做顯示層、不改條件／進度／獲獎／不可變快照／CSV原名，不覆蓋custom或published新版本、unknown歷史不套名。**本輪未commit/push/deploy、未連正式寫入／發訊息**，不改DB/migrations、舊bot、通知／授獎／Meta／dependencies；兩份既有無關文件保留。依先前部署正式仍48caf6d／46，使用者在1345測試及Chrome12組驗證完成後，另明確核准本次commit/push/deploy；發布限同schema46、CSV／歷史原名及現WA環境不變，須精確SHA CI、fresh46 clone相容／保存、停寫final加密DB／roles／runtime實際還原保存過才切換，不執行migration／不改Meta或營運旗標。尚未切換。

## 名稱與版本契約

- `legacy-badge-names.ts`保存49條來源可追溯metadata，原source名稱取舊schema.sql及005/008 catalog，測試fixture另存原49名字與三份SQL SHA256。33method code不變、6combo明示加_7後綴、2seasonal明示去_27，其餘8code不變，沒有模糊字串配對。來源repo與所讀source檔hash驗前後相同。
- 這是**命名來源對照，不代表舊授獎器與新規則相同**；不移植舊note比對fallback、時區、連續／累計或日期判定。例「靜功雙法」沿用舊catalog名稱，platform frozen集合仍含周天／七星／鬆靜三leaf，不因字面「雙」刪改條件。實際門檻、methodCodes、版本與原規則說明照原API顯示。
- 只在verified versioned facade回傳、ruleVersion嚴格數值1、configurationKnown=true、provenance未標custom/published/unknown、kind/threshold/canonical leaf集合及原始locale名稱**全部匹配**預期v1 metadata時加`displayName`。缺欄位、changed name/threshold/kind/leaves、duplicate/new leaf、所有v2+、unknown，以及任何continuous/methodMatch/effective/start/end/progressStart/activationState欄位存在均拒套。42 unversioned fallback不猜名字。
- 新欄`displayName`是derived presentation；**name原欄／snapshot/source hashes／seasons／award timestamp/revoked／counts不改**。原輸入上的stale displayName會移除後重驗；nested versions逐個重驗，不能把current v1別名漏到所選v7或published。
- 繁中雅名逐字保留；簡中只對source-owned白名單用靜態對照，英文頁因舊source沒有英文雅名，使用原中文literal fallback、不杜撰英譯。原英文版本名與英文條件仍可見。姓名、心得、理由、自訂及publisher人工名稱不進此轉換。
- LINE／TG／WA學員圖鑑及後台「成就榜／選版名單」以displayName為主標題、原name附明示「僅為舊版顯示別名；版本快照與CSV原名…」。安全textContent，不把雅名當HTML、身份或條件。管理草稿名稱／sealed快照／發布內容不自動改填。
- CSV服務／原name/schema/header/filename／purpose/Origin/CSRF/scopes／5000限制／cooldown／final actual-session check／audit保持原樣；預覽確認與實際CSV仍用原版本名，畫面明示差異，沒有正式個資匯出。

## 49項逐一對照

| 舊code                 | platform code          | 原繁中雅名           | 名稱來源                                    |
| ---------------------- | ---------------------- | -------------------- | ------------------------------------------- |
| `streak_3`             | `streak_3`             | 入門                 | `schema.sql`                                |
| `streak_7`             | `streak_7`             | 小成                 | `schema.sql`                                |
| `streak_21`            | `streak_21`            | 結丹                 | `schema.sql`                                |
| `streak_100`           | `streak_100`           | 百日築基             | `schema.sql`                                |
| `total_10`             | `total_10`             | 初芽                 | `schema.sql`                                |
| `total_100`            | `total_100`            | 大樹                 | `schema.sql`                                |
| `time_morning`         | `time_morning`         | 晨露                 | `schema.sql`                                |
| `time_night`           | `time_night`           | 夜靜                 | `schema.sql`                                |
| `seasonal_summer_27`   | `seasonal_summer`      | 夏練三伏             | `schema.sql`                                |
| `seasonal_winter_27`   | `seasonal_winter`      | 冬練三九             | `schema.sql`                                |
| `method_dayan_7`       | `method_dayan_7`       | 大雁功｜雁行入雲     | `migrations/008_line_method_day_badges.sql` |
| `method_dayan_30`      | `method_dayan_30`      | 大雁功｜雁翥沖虛     | `migrations/008_line_method_day_badges.sql` |
| `method_dayan_100`     | `method_dayan_100`     | 大雁功｜雁歸太和     | `migrations/008_line_method_day_badges.sql` |
| `method_wuqinxi_7`     | `method_wuqinxi_7`     | 五禽戲｜五行啟藏     | `migrations/008_line_method_day_badges.sql` |
| `method_wuqinxi_30`    | `method_wuqinxi_30`    | 五禽戲｜五靈調炁     | `migrations/008_line_method_day_badges.sql` |
| `method_wuqinxi_100`   | `method_wuqinxi_100`   | 五禽戲｜五禽歸真     | `migrations/008_line_method_day_badges.sql` |
| `method_huichun_7`     | `method_huichun_7`     | 回春功｜春芽復炁     | `migrations/008_line_method_day_badges.sql` |
| `method_huichun_30`    | `method_huichun_30`    | 回春功｜春和養真     | `migrations/008_line_method_day_badges.sql` |
| `method_huichun_100`   | `method_huichun_100`   | 回春功｜回春長青     | `migrations/008_line_method_day_badges.sql` |
| `method_guishou_7`     | `method_guishou_7`     | 龜壽功｜龜息守一     | `migrations/008_line_method_day_badges.sql` |
| `method_guishou_30`    | `method_guishou_30`    | 龜壽功｜龜鶴養元     | `migrations/008_line_method_day_badges.sql` |
| `method_guishou_100`   | `method_guishou_100`   | 龜壽功｜壽炁綿長     | `migrations/008_line_method_day_badges.sql` |
| `method_zhengyang_7`   | `method_zhengyang_7`   | 正陽功｜朝陽啟炁     | `migrations/008_line_method_day_badges.sql` |
| `method_zhengyang_30`  | `method_zhengyang_30`  | 正陽功｜正陽養正     | `migrations/008_line_method_day_badges.sql` |
| `method_zhengyang_100` | `method_zhengyang_100` | 正陽功｜陽和充盈     | `migrations/008_line_method_day_badges.sql` |
| `method_huanghai_7`    | `method_huanghai_7`    | 晃海功｜晃海聽潮     | `migrations/008_line_method_day_badges.sql` |
| `method_huanghai_30`   | `method_huanghai_30`   | 晃海功｜海定神凝     | `migrations/008_line_method_day_badges.sql` |
| `method_huanghai_100`  | `method_huanghai_100`  | 晃海功｜海天一炁     | `migrations/008_line_method_day_badges.sql` |
| `method_lotus_7`       | `method_lotus_7`       | 蓮花養心法｜蓮心初照 | `migrations/008_line_method_day_badges.sql` |
| `method_lotus_30`      | `method_lotus_30`      | 蓮花養心法｜蓮臺澄心 | `migrations/008_line_method_day_badges.sql` |
| `method_lotus_100`     | `method_lotus_100`     | 蓮花養心法｜蓮華見性 | `migrations/008_line_method_day_badges.sql` |
| `method_heqi_7`        | `method_heqi_7`        | 和氣舒壓法｜和氣舒懷 | `migrations/008_line_method_day_badges.sql` |
| `method_heqi_30`       | `method_heqi_30`       | 和氣舒壓法｜和光同塵 | `migrations/008_line_method_day_badges.sql` |
| `method_heqi_100`      | `method_heqi_100`      | 和氣舒壓法｜氣和神泰 | `migrations/008_line_method_day_badges.sql` |
| `method_sanwo_7`       | `method_sanwo_7`       | 三窩功｜三窩聚炁     | `migrations/008_line_method_day_badges.sql` |
| `method_sanwo_30`      | `method_sanwo_30`      | 三窩功｜三田歸元     | `migrations/008_line_method_day_badges.sql` |
| `method_sanwo_100`     | `method_sanwo_100`     | 三窩功｜窩藏元和     | `migrations/008_line_method_day_badges.sql` |
| `method_liuyin_7`      | `method_liuyin_7`      | 六音理臟法｜六音調藏 | `migrations/008_line_method_day_badges.sql` |
| `method_liuyin_30`     | `method_liuyin_30`     | 六音理臟法｜六律和臟 | `migrations/008_line_method_day_badges.sql` |
| `method_liuyin_100`    | `method_liuyin_100`    | 六音理臟法｜六炁周流 | `migrations/008_line_method_day_badges.sql` |
| `method_jinggong_7`    | `method_jinggong_7`    | 靜功｜守靜入門       | `migrations/008_line_method_day_badges.sql` |
| `method_jinggong_30`   | `method_jinggong_30`   | 靜功｜澄心守一       | `migrations/008_line_method_day_badges.sql` |
| `method_jinggong_100`  | `method_jinggong_100`  | 靜功｜虛極靜篤       | `migrations/008_line_method_day_badges.sql` |
| `combo_dayan`          | `combo_dayan_7`        | 大雁雙修             | `migrations/005_line_combo_badges.sql`      |
| `combo_wuqinxi`        | `combo_wuqinxi_7`      | 五禽圓滿             | `migrations/005_line_combo_badges.sql`      |
| `combo_huichun`        | `combo_huichun_7`      | 回春雙式             | `migrations/005_line_combo_badges.sql`      |
| `combo_guishou`        | `combo_guishou_7`      | 龜壽全式             | `migrations/005_line_combo_badges.sql`      |
| `combo_zhengyang`      | `combo_zhengyang_7`    | 正陽雙照             | `migrations/005_line_combo_badges.sql`      |
| `combo_jinggong`       | `combo_jinggong_7`     | 靜功雙法             | `migrations/005_line_combo_badges.sql`      |

## 本機驗證

- 獨立VM176：49×三語精確來源對照、33method/8顯式改碼/49唯一性、stale alias清除、prototype/new/custom/published/unknown/default名不符／新條件欄位／錯集合/version拒絕、原name／hash／award／user文字不變、原CSV三語未改。
- 三語admin VM新增3含literal HTML樣式名稱、原名提示、v1→unknown v7不漏別名、CSV metadata確認仍原名且取消不產生bytes；學員3渠道×三語新增9，legacy alias、unknown原名及publisher原文安全顯示。
- exact42/43/44/45/46同候選HTTP matrix5：42沒有display aliases，43+各49個default aliases、未知v7不套、CSV v1 preview仍原名／無displayName；catalog/preview前後definitions／不可變versions／awards／jobs／audit fingerprints不變。原scope/export/security matrix保留。Native TG包含撤回／unknown版本及他人不可見，LINE及WA cookie讀取alias49／三語、CSRF拒絕維持。
- 最初完整1338過，補強「runtime新條件即使v1也拒套」7案後，既有DB practice-notes test遇channel剛建立valid_from時間邊界，原本應測重複feeling tag的請求先被identity guard拒絕；保留原failure，僅隔離fixture的channel valid_from明示clock_timestamp−1day並加owner-only確切person前置檢查。初次誤以runtime呼叫private helper遭permission denied，改由fixture owner檢查，**沒有新增grant／改正式SQL或放寬斷言**；原8項auth/Unicode/RLS/expiry案例全保留並過。這不是VM／時計根因修復。
- 最終Node24 build、兩strict TS gates、format/lint/typecheck與完整verify **1345tests＝API1052／DB285／config2／identity6，無skip**；靜態簡中source1546phrases/1203mappings。最早TS unknown array closure改用局部const保留narrowing；來源guard未放寬。
- 真本機Chrome **12組／12圖**＝admin成就榜與共用WA學員圖鑑×三語×390/1280。49原雅名、原版本名、unknown v7／manual published v2保護、無水平overflow／JS exception／storage呼叫；6次synthetic CSV metadata preview全部取消，**CSV prepare/bytes0**。auth/API均mock、external SDK/images禁用或移除，不是真Meta/OAuth／手機／正式scope驗收。初preview mock未像真API把string版號轉number而無prompt，修mock coercion後驗過，未改產品。

## 證據／下一步

- `/tmp/qigong-legacy-badge-{unit,matrix,matrix-final,telegram,line,whatsapp,build,verify,verify-final,verify-complete,note-fixture,note-fixture-fixed}.log`；verify為原1338成功、verify-final為既有DB前置失敗、verify-complete為1345成功；note-fixture保留private-helper拒絕，fixed為owner檢查後focused8過。
- `/tmp/qigong-legacy-badge-browser/{mapping.json,results.json}`與12PNG，runner `/tmp/qigong-legacy-badge-browser.mjs`；browser.log為原mock版號失敗，browser-fixed/complete為成功，不覆蓋failure。HTTP55532/CDP55533及測試PG16/55526驗後停止。
- 舊source hash保存在私有/tmp對照，fixture只含公開source metadata／雅名，無使用者個資或憑證。圖與合成CSV不假稱已發Telegram或真下載驗收。
- commit/push與同schema46發布已獲後續明確核准；仍須精確SHA CI及final actual restore/preservation過才切換，不得順便啟用新引擎、移植舊用戶/awards、修改CSV格式或改寫歷史migration／snapshot。正式發布須保留目前WA env與所有既有資料、同46 fix forward，不能回灌舊snapshot。
