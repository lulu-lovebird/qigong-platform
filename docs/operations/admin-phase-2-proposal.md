# 管理後台第二批：心得流、成就榜與快速感受標籤

## 狀態與範圍

**目前完成部分已依使用者另行核准，於2026-10-08 部署 release `b271ede`／schema `0018`，維護15秒。新管道啟用仍未核准；其餘第二批功能未完成。** 已新增 `0018_private_practice_notes_and_tags.sql`、三平台心得與感受卡片及提交／更正／歷史整合，文字與 tag 分開儲存、保留私密權限與歷史名稱快照。側欄語言切換亦已部署。管理端心得查詢 SQL／TypeScript helper 已有，但心得／tag 管理頁面與 HTTP 路由、成就模型及授獎 worker 尚未完成。

已修正 SQL 三值邏輯：心得查詢的範圍授權必須明確為 `TRUE`，功法資訊可見旗標將 `NULL` 轉為 `false`；跨範圍查詢與私密表 RLS 拒絕均有測試。隔離 PostgreSQL16 的完整 `pnpm verify` **173項通過、無 skip**，含格式、lint、source typecheck 與 build。正式 API schema 最小／最大均為 `0018`，程式 commit／CI 為 `b271ede`／[37739536716](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37739536716)。隔離升級、舊版拒絕新 schema、備份還原及受限 runtime／mock OIDC 演練通過；正式既有36張表資料不變，公開23項檢查通過，受限 env 不變，未送真實測試訊息。正式 tag 目錄目前為空，未自行建立標籤；自由心得可使用。未改歷史 migration、依賴、角色授權或舊 Bot；部署／備份／回復詳見根目錄 `Handoff.md`。

來源為 `/Users/myhsu/Devel/qigong-line-bot` 當前工作目錄，HEAD `7bcd85c`；未 fetch／核對遠端或正式舊站。保留該 repo 既有未提交的文件變更。以下區分舊站實際行為與新平台建議，不把程式存在誤認為真實帳號驗收完成。

**後續版本號註記：** 本機新管理員權限申請／審核已保留 `0019_admin_access_approval.sql`（未提交／部署，見 `admin-access.md`）；下列尚未實作的徽章 migration 規劃接續 `0020`，不覆寫 `0019`。

## 舊站功能核對

| 功能         | Source（相對舊 repo）                                                                        | 實際行為                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 心得流       | `src/services/methodStats.ts`、`src/views/admin/journal.ejs`、`src/routes/adminApi.ts`       | 只列非空 `practice_note`；依 `updated_at`／`created_at` 倒序，預設20筆、載入更多；顯示姓名、時間、功法與心得，連至個人分析。個人分析另列最近12筆，按練習日期倒序。 |
| 成就榜       | `src/services/adminStats.ts`、`src/routes/adminPages.ts`、`src/views/admin/achievements.ejs` | 徽章目錄與得獎學員，不是積分／名次排行榜。依六類分組，含尚無人取得的徽章、emoji／說明、去重得獎人數、獲得年度、同名辨識及個人分析連結。                            |
| 標籤管理     | `src/services/practiceFeelingTags.ts`、`src/views/admin/practice-feeling-tags.ejs`           | 新增、繁中／簡中／英文名稱、啟停、上下排序、整批儲存，最多30個；繁中必填，其他語言可空，名稱不得跨標籤重複。沒有刪除 UI；未送出的項目不代表刪除既有資料。          |
| 學員快速感受 | `src/views/liff/checkin.ejs`、`src/routes/liffApi.ts`                                        | 顯示啟用標籤，可複選；點擊會把繁中標籤文字加入心得，取消則移除相同文字行。心得最多1000字，手動輸入相同文字也被視為選取。沒有獨立 tag ID 關聯。                     |
| 授獎         | `src/badges.ts`、`src/services/lineCheckin.ts`、`src/services/sanfuBadges.ts`                | 打卡交易內評估，按學員／徽章／年度防重複；另有三伏補發排程。使用舊 `users` 快取統計、結構化功法及文字別名 fallback，不能直接照搬到新平台。                         |

心得流頁面保留舊 `reflectionNote`／`bodyFeelingNote` 顯示 fallback，但目前服務主要讀統一的 `practice_note`，不應照搬成三份不同的新資料欄位。

### 既有徽章規則

- **連續**：3／7／21／100天；**累計**：10／100天。
- **時段**：最近5個連續練習日期皆為 regular、有練習時區，按各筆 `created_at` 換算為05:00–07:00前或21:00–23:00前；makeup 不符合。這是提交時段，不是經驗證的實際練功起始時間。
- **季節**：三伏依指定年度期間總天數；冬至起27天的龜壽功練習，跨年度以冬至年度歸類。三伏有啟動／每日 reconciliation，不可只靠期間後再打卡才補發。
- **組合**：同次選滿大雁、五禽戲、回春、龜壽、正陽或靜功父類別的全部葉節點，按年度取得。
- **功法天數**：11個舊站功法群，各7／30／100天；有結構化選取優先使用，無選取時才以文字別名匹配。

上述11群不等於新平台既有六個父類別。必須建立 code 對照，缺少的功法先標示不適用，不能新增課程、靠名稱猜測或把心得文字當成已練習功法。

## 新平台建議設計

### 1. 私密心得與心得流

- 候選獨立 `core.checkin_notes`：以 `checkin_id` 關聯 canonical person／practice_date，統一 `practice_note`，保留 created／updated timestamps；首次提交及更正均與打卡／功法／標籤原子寫入。
- **不可直接把私密文字加到現有 `core.checkins` 的一般 SELECT 介面**：該表已有報表讀取授權。心得表與關聯表需獨立 forced RLS／受限函式，預設拒絕。
- 學員只透過既有身份綁定、未過期的 practice token 操作自己；延續核准／停用、練習時區、昨天中午補登／更正期限，不增加管理員任意改心得的後門。
- 管理員須同時具備 `learner.read` 與 `checkin.read_private_note`，資料取 person scope 交集；額外功法資訊也需 `checkin.read`。現有 regional／global viewer 的一般報表權限不包含私密心得，不自動擴權。
- 候選 `/admin/journal` 與獨立 `/admin/api/journal`：最近新增／更新優先，以 ID 作同時戳排序 tie-breaker、分頁20筆／載入更多；更改篩選先清除舊結果，防過期 request／重複追加。個人分析增加有權限才顯示的近期心得。
- 不在現有一般報表 JSON 混入心得。無權限者不取得筆數、文字、標籤或另一區姓名；未授權／不存在的個人一致404。無個人讀取權限時，徽章人數同樣不可洩漏。
- 保留姓名與心得原文，不機器翻譯；UI／功法名稱繁中／英文。DOM 使用 `textContent`、`no-store`／既有 CSP，搜尋及心得不得進 request URL／一般診斷日誌；內容不是公開社群動態。
- 長度建議1000個 Unicode code points，前端、API、DB 採相同計數，補 emoji／換行測試；空白心得但有感受標籤仍可進心得流。

### 2. 快速 tag：固定 ID 與歷史快照

- 候選 `core.practice_feeling_tags`：UUID／穩定 code、繁中／英文名稱、順序、啟用、內容版本；`core.checkin_note_tags` 保存選取 ID、提交時名稱快照與順序。保留關聯、啟停與歷史，禁止硬刪除已使用項目。
- 建議自由文字與選取標籤**分開儲存／顯示**，不自動刪改使用者手寫心得。若要完全復刻「插入文字行」，需另確認撤選、改名及手寫同名文字的語義；不能用文字比對當成唯一 tag identity。
- 歷史快照防止改名重寫學員過去記錄；顯示已停用的歷史選取但不可新增。可保留已選的停用 tag／明確移除；未改標籤的單純功法更正不得覆寫其快照。
- 候選 `/admin/practice-feeling-tags`、GET／PUT `/admin/api/practice-feeling-tags`：最多30個，新增、啟停、上下移動、整批儲存；無刪除按鈕，未列入不得被默默刪除。採 `taxonomy.manage`，保留 Authgear／CSRF；整批交易及版本衝突409，防止多人互相覆寫。
- 固定 ID 不變，重排不改含義；重複名稱與長度於後端驗證。啟用標籤建議繁中／英文必填，避免新平台英文介面顯示整組中文；簡中不列為本批必要 UI。
- 接共用 `checkin-page.ts` 與三個管道 API，不只新增後台畫面。LINE 顯示繁中；Telegram／WhatsApp 依身份 locale 顯示。公開定義清單不含學員選取或心得，私密關聯同樣需心得權限。

### 3. 成就榜與授獎

- 候選 `/admin/achievements` 為分類目錄，展示名稱／emoji／條件、**目前可讀 person 範圍內**的得獎人數與分頁得獎者；每 person 只計一次，年度可展開，連至只帶 personId 的個人分析。不是新增「總分排行」。
- 候選 `core.badge_definitions`／`core.person_badge_awards`：code、類別、繁中／英文文案、型別化規則與版本，授獎含 person、週期鍵、授獎／撤銷時間、規則版本及證據 reference；唯一鍵防並行／重送重複。同名用內部非敏感辨識碼，不曝露 LINE subject／電話。
- `badge.manage` 管理定義，不等於可查看學員；清單與統計另需 `learner.read`／`stats.read` scope。不得把 scope 人數與全域 recipients 混用，不因成就榜提供私密心得權限。
- 計算以 canonical practice_date／結構化 method ID／code，每父類別每人每天最多一天；不讀私密文字、不跨 Policy A 的不同 person 合併，不能依姓名／Email／電話聚合，也不搬舊站 user_badges。
- 無限期獎用固定 lifetime 週期鍵，年度／季節獎用活動年度，避免年度0／null混用重複。補登可影響連續／累計／功法／季節，但不能偽造提交時段；功法更正須重算組合／功法天數資格。
- 季節日期及活動時區先存經核准的年度設定；不擅自加入 `moment`／`lunar-javascript`／cron 依賴。現有六類以 code 規則逐項對照，尤其跨年、年度期間與新增葉節點對組合獎的影響須測試；規則版本不能重寫舊獎條件。
- 建議對「更正後不再符合」保留授獎歷史並標記 revoked／原因；成就榜只計有效獎。是否保留榮譽而不撤銷仍待產品確認。
- 打卡／更正交易記錄重算工作，獨立、可重試的評估 worker 處理；原子更新授獎與耐久通知意圖。定期 reconciliation 捕捉已結束活動／漏跑工作，不直接複用通知 worker 的外部發送交易作授獎引擎。
- 是否通知新徽章另行確認；模板／通知同意／服務窗口要按各管道規則，不自動新增 WhatsApp 模板或啟用未配置 sender。

## 建議實作分批與檔案範圍（未執行）

1. **心得＋tag 基礎**：新的 `0018` migration（確切名稱／schema 契約待核准），獨立 RLS／受限寫入與讀取函式；新增 `practice-notes.ts`、`practice-feeling-tags.ts` 及測試。改共用 `checkin-page.ts`、`learner-locale.ts`，三管道 onboarding 的 methods／history／submit／correct 契約；補不帶新欄位的舊 client 相容測試。
2. **心得後台／tag 管理**：新增 `admin-journal.ts`、`admin-feeling-tags.ts` 與測試；改 `admin-auth.ts`、`admin-dashboard.ts`、`admin-locale.ts` 的導航／權限／文案。一般 `admin-reporting.ts` 不混入私密資料，個人心得走獨立授權請求。
3. **徽章**：另一期 migration、定義／授獎／工作佇列、`badge-evaluation.ts`、獨立評估 worker、`admin-achievements.ts` 及受限學員自己的成就頁。先無外部通知驗證完整重算／去重／reconciliation，再另評通知與活動日曆管理。
4. 每次最多兩個檔案增修後立即測試；歷史 `0001–0017` 不改寫，不改依賴檔。實際 schema 最小／最大及同版 API／worker 發佈需另訂契約，隔離升級／還原演練及正式維護窗口另核准；目前完成部分已明確採用僅接受 `0018` 的 API 契約；使用者另核准這次短暫停機發布，不代表第二批所有功能已完成。

## 驗收門檻

- 心得：空白／tag-only／1000字／emoji／多行／XSS字面、初次／補登／更正／過期、交易回滾、各管道 token 不可互用；歷史及一般報表無私密內容洩漏。
- 權限：未登入401、缺權403、跨區／班級／停用／撤權／到期拒絕；有 stats.read 但無 private_note 的管理員不能得知私密筆數或內容；content_admin 不能靠管理 tag／badge 看到學員。
- Tag：繁中／英文標籤、選取／取消不改手寫文字、改名／停用／重排不改歷史、整批失敗回滾、多人版本衝突、偽造／重複／過量 IDs、CSRF拒絕、斷網及未提交切語言提示。
- 徽章：不同 person 不合併、同日多選不加天數、同人跨年度只計一位、補登／時段例外、跨年季節、規則版本／停用、並行／重送／重跑不重複、改功法後重算／撤銷、scope 不洩漏全域人數、活動結束且未再打卡仍可 reconciliation。
- 四頁既有功能、158項當前本機測試與舊 client 回歸；新增測試必須以隔離 PostgreSQL16 無 skip 驗證。兩種語言的桌機／手機真人驗收另行安排，不使用正式學員作合成資料。

## 開始實作前須確認

1. 心得預設為私密，哪些管理員需要明確取得 `checkin.read_private_note`？不自動擴張現有 regional_admin 權限。
2. 快速 tag 採獨立選取＋自由心得，還是完全復刻插入文字行？建議前者。
3. 成就榜採「徽章目錄＋得獎者」，是否另外需要排名？更正後不符資格是標記撤銷或保留榮譽？
4. 首期只套新平台既有六群可對照功法；缺少的課程／年度活動日期／新徽章通知均需另核准，是否接受此分批範圍？

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
