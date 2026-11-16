# WhatsApp 團練場 API／授權契約（待獨立審查）

狀態：**資料契約已開始實作；HTTP／SQL 尚未實作或授權。** 本文件不是 migration、部署核准或獨立安全審查結果。

## 1. 本批可驗證範圍

`apps/public-api/src/whatsapp-venue-contract.ts` 僅定義 Zod 資料形狀，未註冊 route，不讀 Cookie、不連 DB、不驗證身份、不寫出席。

- 寫入 body 僅 venue、latitude、longitude。拒絕 token、idToken、session、csrf、personId、subject、channel、source、debugToken、isTest、手機時間等額外欄位。
- 紀錄 body 僅 month、venue、page。page 預設 1，上限 10000；不接受 personId 或 test view。
- 正式回應沿用正式出席形狀，拒絕 debug／test 欄位；檢查場地 code 與時間戳的場地當地日期一致。
- WhatsApp 紀錄明示 `dateBasis: venue_local_date`，不沿用 LINE 紀錄的 `timezone: Asia/Taipei` 欄位。每筆顯示保存的 venueTimezone；月份及 distinct day 統計以保存的 venueLocalDate 為準，不代表跨時區的連續 24 小時。
- 回應 schema 能接受資料，不等於 DB 已寫入、身份正確或場地授權成立。未來 adapter 還要綁定請求場地、分頁／月份／篩選及實際保存紀錄。
- 本批 48 項新契約測試；與現有預覽測試合計 85 項通過。

## 2. 擬定端點（全部須服務端功能 gate，尚未註冊）

| 方法／路徑                              | 用途                     | 身份來源               |
| --------------------------------------- | ------------------------ | ---------------------- |
| GET `/whatsapp/venue-checkin`           | 場地頁殼及可信公開可用性 | 公開；不代表登入／資格 |
| GET `/whatsapp/venue-history`           | 自己紀錄的頁殼           | 頁殼不含私人紀錄       |
| POST `/api/whatsapp/venue-entry-status` | 確認本人資格／同意       | Session Cookie＋CSRF   |
| POST `/api/whatsapp/venue-checkin`      | 正式出席寫入／安全重送   | Session Cookie＋CSRF   |
| POST `/api/whatsapp/venue-history`      | 本人正式紀錄             | Session Cookie＋CSRF   |

gate 關閉時不註冊上述新端點；Bot、公開入口、後台不發布未啟用通路網址。不能因已有 WhatsApp 日課配置就自動開場地寫入。

## 3. HTTP 驗證順序

1. 固定可信 publicOrigin，由服務端設定。精確 Origin、JSON content type、body 大小及 strict schema 檢查；不信任 Host／Forwarded 決定回程或授權。
2. Session 必須來自唯一有效的 HttpOnly Cookie；CSRF Cookie 與 header 必須有效且一致。缺 Cookie 不回退私人 token。多重 Cookie、Cookie＋body token、錯 Origin 全拒絕。
3. 前端不得提交 person／identity／subject。API 只把 Session＋CSRF 傳至專用 SQL facade；不能從一般 resolver 的結果直接取 personId 呼叫共享 writer。
4. SQL 交易內再次確認 Session、有效 WhatsApp identity、核准學員、主通路、同意及可用性。外層剛才讀到 eligible 不可作為寫入權限。
5. 只有交易成功提交且正式回應驗證／請求綁定正確，才顯示成功印章。傳輸結果不明維持 uncertain，不自動假設失敗，也不自動無限重送。
6. 錯誤回應只用穩定代碼，不回 SQL、憑證、原始座標或別人的存在與否。

## 4. SQL facade 草案與 ACL 目標

下列只是待審介面名稱，不是現有可執行函式：

- `platform.whatsapp_venue_checkin(session TEXT, csrf TEXT, venue TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION)`。
- `platform.whatsapp_venue_history(session TEXT, csrf TEXT, month TEXT, venue TEXT, page INTEGER)`。
- `platform.whatsapp_venue_status(session TEXT, csrf TEXT)`。

ACL 目標：

- API runtime 僅獲上述窄 facade 的 EXECUTE，不新增任意 person 出席 writer 權限、資料表廣泛讀寫、角色 membership 或 BYPASSRLS。
- PUBLIC、worker、其他通路 runtime 及非必要 default ACL grantee 不可 EXECUTE 新 facade 或內部 primitive。
- 新的隔離 function owner 必須 NOLOGIN、NOINHERIT、NOBYPASSRLS、無會員關係，固定 search_path=pg_catalog，明確 schema 限定，保留 FORCE RLS。
- 個人紀錄 reader 與 writer 分離；writer 不因需要 replay 就取得其他人的出席 SELECT。
- 不修改既有 LINE writer／debug grants。初期共用現有純輸入時段計算與經審查的無權限業務 helper，而非為了減少程式重複而先重寫 LINE 身份權限。
- 不能暴露「傳入任意 personId 即可寫入」的共用函式。若採 private shared writer，必須只消費不可由 API runtime 偽造的內部交易上下文；owner、所有呼叫者及 RLS 實際 SQL 需完整列出。

## 5. 鎖與撤銷：必須先解決的阻擋

既有撤銷可經 person、identity、channel 的 UPDATE trigger 撤銷 Session；登入本身亦會鎖 person 與私人 link。新流程不可只鎖 Session 或加入孤立 advisory lock 就宣稱已避免競態。

待審方案需提交可執行的隔離測試／鎖圖，確認：

- 先依 Session hash 做唯讀定位，再對身份依賴與 Session 取得必要鎖，鎖後以 clock_timestamp 重驗證；不信任交易開始時的 CURRENT_TIMESTAMP。
- 寫入與撤銷的共同線性化點、鎖順序及保護到提交的範圍。不能只在開始時檢查後釋放保障。
- 不為了 SELECT FOR UPDATE／SHARE 悄悄增加 UPDATE 權限或放寬 restrictive UPDATE policy；PostgreSQL 行鎖需要的實際 ACL／RLS 必須驗證。
- person／identity／channel／application／privacy／Session 的撤銷、過期及刪除路徑全部納入，不能只測 logout。
- 明確決定既有撤銷函式是否需要同一鎖協議；若必須變動，先由安全審查核准範圍，再 additive migration，保留日課行為。

在此項未審定之前，不寫新的 RLS／SECURITY DEFINER 實作。不把 SQL prototype 或本批 schema 測試當作權限已安全。

## 6. RLS 上下文設計的選擇標準

候選：私有交易上下文表，由專用驗證 facade 綁定 backend PID＋transaction ID＋Session／身份，再供 reader／writer 的 RLS 使用。若採此方案，必須證明：

- API runtime 不可直接讀寫上下文表，也不能執行未驗證的 setter；函式 owner 不因 table ownership 或 default ACL 得到旁路。
- pid 重用、交易回滾、connection pool 重用及異常路徑不會沿用別人的上下文；交易 ID 不以 caller GUC 提供。
- 同一交易內不同身份不能改寫已綁定上下文；跨通路上下文不相容。
- 讀取 RLS 的 helper 不形成遞迴或能被 API runtime 任意調用的身份 oracle。

這是候選而非既定決策；最終須與 session 專用 resolver／現有 RLS 的真實 DDL 一起獨立審查。不能只用自訂 GUC personId 當唯一證明。

## 7. 寫入與紀錄驗收

- DB server 時間、場地 timezone、既有提前 30 分鐘時段、真實半徑，每次含 replay 都重新確認。
- 正式與測試分隔；不實作 WhatsApp debug bypass。
- 以既有 person／field／場地當地日期／is_test unique key 去重，不以瀏覽器 request UUID 假裝身份。
- 同日跨場正常累計；replay 回傳原保存時間，不新增聊天收據；不保存原始 GPS。
- 紀錄只限綁定本人，最多每頁 20 筆；schema 以外，adapter 還須驗證 request page、month、venue、排序與 ownership。
- 隔離 DB 必測 API runtime 直接 SQL、假 GUC、越權讀取、撤銷競態、兩筆併發、response 遺失、跨日提前開放、DST、午夜日期及 LINE 回歸。

## 8. 審查與發布

`wa-authority-review` 替代獨立模型本次仍回報服務憑證失效，未執行審查。須由可用的跨模型 reviewer 或有 PostgreSQL RLS 經驗的人工 reviewer，對第 4–6 節定稿後審核；再實作 SQL、HTTP 與登入。UI 確認不等於此項核准；先前 UI-only 發布豁免不適用。

本批不修改身份、權限、正式入口、Bot、migration 或部署；不測正式學員資料。
