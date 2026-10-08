# 管理後台移植：第一批

## 狀態與來源

從舊 `qigong-line-bot` 的 `adminPages.ts`、`adminApi.ts`、`adminStats.ts`、`methodStats.ts` 與 EJS 管理頁移植操作流程／統計功能，重新接到新平台的 person、check-in、功法目錄與權限。**已於2026-10-07 經核准的維護窗口部署正式站**，程式 release 為 `269555c`、schema 為 `0017_admin_reporting.sql`；舊 Bot、舊登入、舊資料庫及舊部署設定皆未修改。不載入舊版 Bootstrap／Chart.js CDN、不新增依賴，使用自有響應式版型與原生 SVG 趨勢圖。

後台已補齊繁體中文／英文。**2026-10-08 已另核准部署部分第二批 release `b271ede`／schema `0018`**，切換已移到側欄品牌下方、主要選單上方，右側只留登出。維護15秒、173項本機測試與23項公開檢查通過；詳細備份／演練／回復紀錄見 `Handoff.md`。Telegram／WhatsApp 的學員雙語偏好與通知語言不受影響。LINE／WhatsApp 新官方帳號尚未完成設定，不阻擋這批後台上線；新管道仍未配置／啟用。

| 網址                                     | 功能                                                             |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `/admin/`                                | 儀表板：期間 KPI、每日趨勢、指定日期已／未打卡分頁名單。         |
| `/admin/leaderboard`                     | 期間打卡／最長連續 Top 10／20／30，以及累計打卡分頁名單。        |
| `/admin/method-analysis`                 | 功法分布、姓名搜尋、選取學員、個人 30／90 日分析與分頁打卡明細。 |
| `/admin/method-analysis?personId=<UUID>` | 從名單直接查看有權限的學員；姓名不放在網址。                     |
| `/admin/applications`                    | 原有待審核功能：單筆核准／拒絕、全選／批次核准。                 |

目前仍未完成管理端心得流、tag 管理畫面／HTTP 路由及成就徽章。第二批私密心得／tag 資料模型及學員卡片、提交／更正／歷史已部署，tag 目錄目前為空、未自行建立標籤；心得查詢僅有 SQL／helper，不以空白管理頁假裝完成。AI 評語、個資自動合併與管理員更正打卡亦未實作。已檢視舊站實作，移植提案與待決策項目見 [第二批規格](admin-phase-2-proposal.md)。

## 新介面與管理員權限審核（已部署 `0019`）

使用者另確認側欄單一下拉語言選單、登出置於主要選單下方，申請選項統一為「地區管理員、白雁協會人員、白雁氣功教練、老師（Master）」。已於2026-10-08 13:23:46–13:24:11 UTC 核准部署 `79f3e4c`／`0019`，停機25秒；CI 37783413247、213項本機測試、正式快照升級／最終站外備份還原及公開 HTTPS38項通過。無 provider 測試訊息，舊 Bot／保護設定／既存 grants 未變。指定新 super admin 仍待本人登入與身分核對後 bootstrap。新增 super／master 分級使用的 `/admin/administrators`，可核准首次 Authgear 登入者、指定地區／全域角色、拒絕及撤銷授權；未核准帳號僅進獨立待審頁，不能讀管理資料。白雁協會人員採 `global_viewer`，氣功教練採新 `coach_admin`（全域私密心得及感受唯讀），兩位老師採新 `master_admin`（同樣讀取＋一般管理員授權）；master 不能修改自己、其他 master／super 帳號或 master 申請。正式 migration 為 `0019_admin_access_approval.sql`，API 最小／最大均為 `0019`，未改歷史 migration 或擴張原地區／唯讀／班級 coach 模板，也未自動變更既有 grants。詳細流程、第一位 super admin 的受控 bootstrap、213項本機驗證及部署限制見 [管理員權限審核](admin-access.md)。以下語言與初次發佈章節保留歷史 `0018` 版本說明；最新 `0019` 狀態以上述段落及 `Handoff.md` 為準。

## 管理介面語言

- 正式版「繁體中文／English」位於側欄品牌下方、主要選單上方；四頁共用同一組按鈕，手機版也在導航之前，右側只留登出。具備選取狀態、側欄對比及鍵盤焦點提示；尚未真人瀏覽器視覺驗收。文案涵蓋四個選單、標題、KPI、圖表、表格、分頁、篩選、審核／批次確認、拒絕理由提示、登入到期、權限不足與網路錯誤。使用 `admin-locale.ts` 型別完整的文案字典，未知錯誤不原樣曝光。
- 頁面語言優先採合法 `?lang=en`／`?lang=zh_TW`，其次採瀏覽器的 `__Host-qigong-admin-locale`，預設繁中。未知頁面語言安全回到有效偏好／繁中；API 不合法 `lang` 回400。英文入口例如 `/admin/?lang=en`。
- 偏好 cookie 只存兩個允許值，`Secure; SameSite=Lax; Path=/; Max-Age=31536000`，不含身份或權限。非 HttpOnly 是為了前端切換；既有 session 的 HttpOnly／CSRF／OIDC 規則不變。偏好在同一瀏覽器／主機保留，不是跨裝置、每管理員的資料庫設定。登入跳轉與跨選單保留偏好；Authgear 自己的登入畫面不在此翻譯範圍。
- 切換重載保留目前網址中的已套用條件、指定日期及選取的 personId；分頁回初始頁，未套用的輸入不保留。待審頁切換前會確認清除未送出的勾選／理由，取消則留在原頁；切換絕不自動送出核准／拒絕。已明確送出的在途審核不會因切換撤銷。
- 英文報表、選單選項與待審地區 metadata 使用既有 `name_en`；中文使用 `name_zh_tw`，包含功法父類別及歷史明細。SQL 欄位從固定兩項允許清單選擇，不插入原始 `lang`。沒有更改 method／region／person ID、排序或統計值，不新增 migration。
- 學員姓名、Email／電話及管理員自行填寫的理由保持原文，不作機器翻譯。管理介面切為英文不會改學員管道的語言偏好／通知內容。

## 統計定義

- 以 canonical **person + practice_date** 計算打卡人日；同次多選功法不增加打卡天數。Policy A 的不同 person 不視為同一真人，絕不依姓名／電話去重或連結。
- KPI 的「有練習的學員」是期間有打卡的有效 person；「有效學員」是目前範圍／篩選內 `status=active` 的 person，不含待審核 application。私人心得、聯絡資料不從報表 API 回傳。
- 週／月／季／年從日曆期間開始統計至目前報表日期；近30／90日包含目前日期。未發生的未來日不補零、不放入平均分母；已經過的零打卡日期會補零。平均每日人次四捨五入至一位小數。
- 報表期間的日期基準預設 **Asia/Taipei**；日期依儲存的學員練習日期，不是 UTC 訊息送出時間。API 可指定 PostgreSQL 認得的 `timezone`；此設定不更改學員練習時區。
- 指定日期名單與 KPI 期間分開。已打卡名單依實際紀錄；未打卡名單僅包含選定日期存在可讀主要地區 assignment 的有效 person。名單不代表通知同意、可推播或學員所在時區已過當日截止時間，不能直接當提醒清單。未來報表日期拒絕。
- 排行榜的累計天數與目前連續天數看全部可讀紀錄；目前連續需截至學員練習時區的今天或昨天。期間排名／期間最長連續只看選定期間，日期缺一天即斷開。不用功法選擇筆數取代天數。
- 功法分布的「選擇占比」以所有葉節點功法選擇次數為分母；個人占比以個人練習天數為分母，可複選所以不加總為100%。保留功法父子類別、現有 code 與順序。
- 平台篩選：學員需有該平台未撤銷身份，實際打卡則按 `submitted_via_identity_id` 的來源平台篩選；不是把另一平台的事件改標成該平台。
- 地區／學員範圍沿用 **目前的** person 授權與主要地區；有權限的管理者可查看該 person 的既有打卡歷史。這不是「歷史地區績效歸屬」報表。歷史地區 assignment 的原有隔離規則保留；班級範圍只額外可讀所屬學員的**目前**主要地區 metadata。

## 安全與相容性

- 沿用 Authgear OIDC／既有 HttpOnly session，沒有採用舊站管理密碼或建立登入後門。頁面未登入轉到登入頁；API 未登入回401。Session 到期、角色撤銷／到期、principal 停用會失去存取。
- 報表必須具備 `learner.read`、`checkin.read`、`stats.read`，資料再取各自 scope 的交集；具備任一權限不等於全域授權。無統計權限者回403，可從已授權的選單操作；待審核仍由既有 `onboarding.review` 判斷。
- `0017_admin_reporting.sql` 新增 check-in／selection **唯讀** RLS 權限與索引，沒有新增 runtime 寫入權限，也不改核准／學員寫入／歷史 migration。SQL 查詢以參數化篩選，不使用 browser 提供的 subject/principal 或 SQL 欄位名。
- 頁面與新 API 設 `no-store`；頁面沿用限制外部資源／嵌入的 CSP（目前 scripts／styles 仍允許 inline）、`no-referrer`、`nosniff`。姓名／功法等動態文字透過 `textContent`／DOM 插入，不經 `innerHTML`。分頁／數量、UUID、日曆日期、timezone、搜尋長度與合法期間皆驗證；`%`／`_` 搜尋視為字面文字。
- 非授權／不存在的學員 ID 統一回404，不透露是否存在。錯誤不記錄搜尋姓名／完整 SQL 內容。最新篩選結果優先，過期的前端 request 不覆寫新畫面。
- **目前 API 最小／最大版本均為 `0018_private_practice_notes_and_tags.sql`**，須隨同完整 `0001–0018` chain 與同版 worker；`0017` 不足以啟動本次 API。`0018` 新增私密表／受限函式與獨立 forced RLS，沒有擴充現有角色授權，普通報表不含心得／tag。前次 `0012 → 0017` 為歷史發布；本次另核准短暫停機 `0017 → 0018`，公開 readiness／runtime preflight 通過。

## 已完成的部署驗證

- 程式 commit／push 與 GitHub CI 成功，本機 `pnpm verify` 150項通過、無 skip；不改依賴或既有 migration。
- 版本化 release 保存 API／worker／完整遷移及 checksums；`current` symlink 指向 `269555c`，舊目錄保留。受限 env 未覆寫；API drop-in 僅以 ExecStart 標記公開 service version。
- 隔離 PostgreSQL16 演練升級、中途失敗 gate、續跑與備份還原；編譯後程式以受限 runtime／mock OIDC 驗證8個雙語頁面、12個報表、CSRF 邊界與 Telegram，未送真實測試訊息。
- 維護窗口取得 DB／roles／平台 env 與 systemd 備份，站外 AES-256-GCM 加密副本實際還原至隔離 cluster；舊 binary 在還原的 `0012` readiness 通過。
- 正式 `0013–0017` 完整套用且重跑零新增，31張既有表筆數／資料雜湊不變；API 與通知 timer 恢復，停機15秒。公開 HTTPS 的19項煙霧測試通過，包括未登入／無效 callback 邊界、雙語 Telegram 頁面及新管道404。
- 未冒用真人管理員、未審核正式學員作為測試；Authgear 真人登入、桌機／手機視覺及實際帳號跨 scope 驗收仍待進行。操作與回復限制見 repo 根目錄 `Handoff.md`。

## 本機與後續驗收

使用 Node24／pnpm10、**本機隔離 PostgreSQL16** 與含 `test` 的 `TEST_DATABASE_URL` 執行 `pnpm verify`。本次新增：

- `apps/public-api/tests/admin-reporting.test.ts`：真正 NOINHERIT／NOBYPASSRLS login + runtime role + mock OIDC provider，檢查區域／國家／全域／班級統計、API／RLS 越權、唯讀、角色到期／停用、日期、分頁、天數／連續、平台、字面搜尋與個人明細。
- `apps/public-api/tests/admin-dashboard.test.ts`：VM 執行產生的頁面 scripts，驗證導覽、KPI／SVG／名單、篩選／分頁、個人分析比例、XSS 字面呈現、錯誤／登入到期、過期 request 與一次性 CSRF 登出。
- `apps/public-api/tests/admin-locale.test.ts`：雙語 key／placeholder 完整、合法偏好優先序、注入／未知語言回退及一次性插值。其他兩份管理測試亦涵蓋英文畫面／資料、偏好 cookie／mock OIDC、篩選保留、切換不誤送審核及雙語網路錯誤。
- 全 migration chain／checksum／idempotency，以及 Telegram、LINE、WhatsApp／審核／通知回歸。VM 測試不是手機／真實瀏覽器視覺驗收。

後續在經批准的隔離驗收站確認：

1. 使用 Authgear 登入區域管理員，四個選單可導航；批次／單筆審核仍正確。
2. 有打卡／零打卡日期、週月季年、歷史日期、姓名、地區、平台、Top切換與分頁皆反映真正範圍；同名不合併。
3. 從已／未打卡與排行榜點到個人，確認30／90日、補登、功法父子類別、時區／明細；沒有私人心得或另一區姓名。
4. 用另一地區、班級與無統計權限帳號重做；手改 personId／region／API URL 不可越權。登出／過期後不能沿用舊頁面讀資料。
5. 桌機／手機確認側欄轉為頂部導覽、表格可水平捲動、鍵盤導覽／狀態提示與SVG；慢網路／連續換篩選不顯示舊資料。
6. 兩種語言重做上述流程；選單上方的語言切換可保留已套用條件／學員，跨選單與重新登入沿用偏好。審核切換的取消／確認皆不得誤送；姓名／理由維持原文，功法／地區改用對應名稱。

本次發佈已取得核准並完成版本化部署及隔離升級／還原演練；這不取代真人驗收，也不構成後續管道啟用或新發佈的授權。舊0012與新0017無相容重疊，不能以舊 binary 充當 migration 回滾；恢復舊版須配合還原 DB／舊 release／service drop-in。重開流量後還原會丟失後續寫入，須另行核准並處理差異。參考 [LINE pilot](line-pilot.md) 的失敗邊界。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
