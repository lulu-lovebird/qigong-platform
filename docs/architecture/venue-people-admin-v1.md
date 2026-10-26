# 團練場人員與出席紀錄 v1

**狀態：獨立受控 SQL／service／HTTP／可執行 web UI 已實作；尚未掛載主程式、navigation 或部署。**

基底：`origin/main@56284208942acb182651c02983011f80b8921a47`。只新增 0054；0052 personal history、0053 場地設定不在此 worktree，沒有建立替身、讀取其未合併內容或修改其 worktree。驗證範圍是既有 0001–0051 加獨立 0054，**不是 0052／0053 整合後 full chain 通過證據**。

## 檔案與 exports

| 檔案                                                                      | 交付                                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/0054_venue_people_read.sql`                                   | 新的 `qigong_venue_people_reader` 與 `admin.venue_people_read`、專屬 restrictive RLS、最小成功 audit                                              |
| `apps/public-api/src/venue-people-helpers.ts`                             | `parseVenuePeopleQuery`、`decodeVenuePeopleResult`、`encodeVenuePeopleCsv`、`venuePeopleMonthRange`、`venuePeopleTaipeiMonth`、query/result types |
| `apps/public-api/src/venue-people-service.ts`                             | `createVenuePeopleService(pool)`、`VenuePeopleService`、`venuePeopleMigrationVersion`                                                             |
| `apps/public-api/src/venue-people-routes.ts`                              | `registerVenuePeopleRoutes(app, options)`、`validateVenuePeopleConfig`、`VenuePeopleConfig`、`VenuePeopleRouteOptions`                            |
| `apps/public-api/src/venue-people-page.ts`                                | `renderVenuePeoplePage()`、`venuePeoplePageScript`、`venuePeopleContentSecurityPolicy`                                                            |
| `apps/public-api/tests/venue-people-{helpers,http,page,postgres}.test.ts` | strict selector、受控回應、CSV、HTTP、真正頁面 script、真 PG 測試                                                                                 |
| `apps/public-api/tests/fixtures/venue-people-synthetic.sql`               | 全新隔離測試 DB 的合成場地／學員／session，無電話或其他聯絡資料                                                                                   |
| `apps/public-api/tests/venue-people-local-pg.sh`                          | Node24／PG17、新建 0700 `/tmp/venue-people-pg.*`、僅 Unix socket、自動移除                                                                        |

每個實作／測試批次最多 5 檔；不修改既有 routes、auth、app、index、dashboard、fields renderer、migration、package／lock。沒有新增 dependency、代理、推送、合併、部署或外部 API 呼叫。

## 父代理接線（未執行）

在既有 `registerAdminRoutes` 私有 `principalFor` 邊界內，明確注入下列依賴；不要把 principal UUID 當 session，也不要把 session 放入 HTML／URL／browser state：

```ts
import { createVenuePeopleService } from './venue-people-service.js';
import { registerVenuePeopleRoutes } from './venue-people-routes.js';

// venuePeople 由 server composition-root 提供，不由 query/body/cookie 決定 enablement。
if (venuePeople?.enabled) {
  registerVenuePeopleRoutes(app, {
    config: venuePeople, // { enabled: true, publicOrigin: 'https://<reviewed-host>' }
    service: createVenuePeopleService(pool),
    pagePrincipalFor: principalFor // 既有逐次驗證 session 的 callback
  });
}
```

- 本批**沒有**向 `app.ts`／`admin-auth.ts`／`index.ts` 增加參數或呼叫；上述是父代理待實作的組合範例。
- 必須先整合／審查 0052、0053，再以真 PG 重跑完整 migration chain、RLS／ACL／default privileges，確認沒有 policy／role 名稱衝突、其他 migration 放寬 EXECUTE 或 SELECT。
- `app.ts` 現有 `maximumMigrationVersion`、`defaultOffMigrationVersions`、QR readiness 只認到 0051；父代理必須按最後整合 artifact 更新 readiness。不能只把 0054 丟入 production migration 目錄就宣稱現有 app 相容。
- 父代理新增後台導覽 `/admin/venue-people`，帶入 HTTPS public origin；本功能不自動沿用 QR／NFC flag，也不啟用 NFC quarantine。
- 頁面 server CSP 直接使用匯出的 hash policy；不可改套 unsafe-inline shell、重寫 script/style bytes 或加入 inline handlers。無外部 bundle／CDN／網路依賴。
- 延用既有 UUID request ID、HttpOnly `__Host-qigong-admin`、可讀 `__Host-qigong-admin-csrf` 與 logger 的不記 body／credentials 規則。不要記錄搜尋文字或 DB diagnostics。
- 本頁區域／場地輸入為明確 UUID selector，非授權 credential；可由父代理另行提供受控選單，但不得從查詢參數推定權限。

## HTTP（全部是 proposed mount paths，目前未自動註冊）

| 方法／路徑                            | 行為                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /admin/venue-people`             | 驗證 session 後僅給無學員資料的 shell；沒有 session 401、失效 callback 401、非空 query 400、依賴失敗 503 |
| `POST /admin/venue-people/api/read`   | 每次 SQL 驗證 session + `checkin.read` + 場地 region，回授權人員彙總或所選學員明細                       |
| `POST /admin/venue-people/api/export` | 每次 SQL 驗證 session + **獨立 `stats.export`** + 場地 region，回完整篩選 CSV；不先要求 view             |

POST 必須 `application/json`、同源 cookies、精確 `Origin === publicOrigin`、43 字元 base64url CSRF cookie/header timing-safe 相等；如帶 `Sec-Fetch-Site` 必須 `same-origin`。拒絕重複／格式不符 cookie。缺少／格式不符 session 401，來源／CSRF 403。body 上限 4096 bytes；parser／body-limit 錯誤固定安全 body，不洩漏原輸入。

SQL 錯誤映射：`28000` → 401、`42501` → 403、`22023` → 400、`54000` → 413 `{error:'export_too_large',maximumRows:1000}`；其他錯誤／不合法 DB 回應 → 503。所有回應 `no-store`、`no-referrer`、`nosniff`；不輸出任意 exception message。

### strict request

```json
{
  "mode": "people",
  "regionId": "01000000-0000-4000-8000-000000000003",
  "fieldId": null,
  "personId": null,
  "period": { "month": "2026-10" },
  "search": "",
  "sort": "recent",
  "direction": "desc",
  "page": 1,
  "limit": 20
}
```

範例 UUID 僅為合成測試 selector，不是 production config。

- `mode: 'people' | 'detail'`；people 的 personId 必須 null，detail 必須指定既有 person UUID。它是 **目標 selector**，不是 `personContext`／actor。
- fieldId 為 UUID 或 null。選到不存在／區域不符的場地固定 403；不回跨區場地存在性。不存在／未在所選授權範圍出席的學員回合法空結果，不揭露其他區資料。
- period 僅能是 `{month:'YYYY-MM'}` 或 `{from:'YYYY-MM-DD',until:'YYYY-MM-DD'}`，不可混用。日期真實存在、1–9999 年、半開區間 1–366 日；月份最多 `9999-11`，避免次月超出日期契約。
- search 為 trim 後 0–80 字、無控制字元；對既有 preferred/legal name 做 case-insensitive **literal substring**，不是 SQL／LIKE／regex；姓名不是身份鍵。
- sort 為 `name | count | days | recent`，direction 為 `asc | desc`，SQL 使用固定 CASE 排序並以 person ID／record ID 穩定 tie-break。UI 明細固定 recent desc；其他排序主要供彙總使用，明細 count/days 各列均為 1、name 為同一學員。
- page 為 number integer 1–10000，limit 為 number integer 1–100；不 coerce 字串、不接受 unknown keys、principalId、personContext、exporting、actor、姓名或電話歸戶欄位。
- export 使用相同 strict request，但 **忽略 page/limit 的分頁效果**；操作由 route 固定，不可由 request 升權。

### 回應與統計

版本 1；回應 echo canonical selector（from/until 已由 month 展開）、mode、exporting、page/limit、total、totals、rows。decoder 驗證 binding、精確頁長、唯一 ID、日期／場地／學員範圍、總計一致性，拒絕未知 PII 欄位。

- `totals = {attendanceCount,attendanceDays,learnerCount}` 對完整授權篩選集合計算，不是目前 page。
- people rows：`personId,name,attendanceCount,attendanceDays,latestDate`；total 為完整篩選學員數。同人同場同日唯一；跨場同日出席次數分計，日數按 local date label 去重。
- detail rows：`recordId,personId,name,date,timezone,checkedInAt,fieldId,fieldCode,fieldName,method`；total 為所選學員的授權篩選出席筆數。method 僅沿既有 schema 的 qr_gps／nfc_gps／volunteer_manual，並不推定歷史紀錄已經驗證。
- fieldId null 的累計合併**此區域授權場地**；指定 fieldId 才是該單場累計。累計／最近出席限所選期間，不冒稱生涯數據。
- 不查詢／回傳 raw GPS、電話、距離、志工身份、私密心得、日課內容。出席表沒有身份 channel snapshot；即使學員有多個 platform_identities，**也不捏造 LINE／Telegram／WhatsApp 來源**。

### 時間語義

頁面預設月份以 server 的 `Asia/Taipei` 現在月份產生，**不是 browser timezone**。月份或日期選擇轉成 calendar `[from,until)`，篩 `a.attendance_date`，即 0051 寫入時保存的場地當地曆日。它不是統一 Taipei／UTC instant window，不以現在 venue timezone 重算歷史。`timezone` 使用該筆 `attendance_timezone`；`checkedInAt` 為 UTC ISO instant。跨日期線同一 instant 可以落在不同 local day，去重日數依日期字面標籤；不依 timezone 分組增算日數。真 PG 測試涵蓋此差異與月份邊界。

## 授權與資料庫安全

SQL 函式簽名：

```sql
admin.venue_people_read(
  input_session TEXT, input_region UUID, input_from DATE, input_until DATE,
  input_field UUID, input_person UUID, input_search TEXT, input_mode TEXT,
  input_sort TEXT, input_direction TEXT, input_page INTEGER, input_limit INTEGER,
  input_export BOOLEAN
) RETURNS JSONB
```

service 僅呼叫上述固定 parameterized SQL，在 `withRequestContext(...,'qigong_api_runtime',{requestId})` 新交易執行；不接收／轉送 caller actor context。SQL 自 session 解析有效 principal，拒絕 person context／衝突 principal，逐次判斷 action 對應 permission 與 region，設定 transaction-local principal/region/action 後才讀資料。不接受「自己是學員」即可讀全人員的 bypass。

- 新 reader 是 **nonowner、NOLOGIN、NOINHERIT、NOBYPASSRLS**、無 membership，只有必要 column SELECT 和最小 audit INSERT，不能寫 attendance／people／fields；runtime 沒有新增任意 table SELECT。
- 使用既有 FORCE RLS，migration 在缺少 FORCE 時 fail closed。function 固定 `search_path=pg_catalog`、`row_security=on`；PUBLIC EXECUTE revoke，只授予 API runtime，worker／login 本身不可直接執行。
- 場地 restrictive policy 同時限制函式設定的 region、action allowlist 與 `admin.can_access_region`；attendance 透過已限縮場地，姓名透過已限縮 attendance。學員 home region 不限制跨區到場，也不用任意人員 context 取權限。
- 學員只使用既有 `identity.people.id`，名稱 preferred name → legal name →「學員」。不建平行人員表、不以姓名／電話歸戶、不 join 多平台身份造成統計倍增。
- view 僅 `checkin.read`，**不要求額外姓名 permission、learner.read 或 k5**。export 僅 `stats.export`，不由 export 推導 view，也不由 view 推導 export；region scope 各自重查。學員明細無法藉 ID 突破場地 scope。
- 成功 read/export 的 audit 只記 request、principal、operation、region、mode、rowCount；沒有姓名、搜尋文字、target person／record、session、GPS 或私密資料。不把 audit 本身暴露給本 reader。拒絕操作不在本函式交易內另寫持久 denial audit，不宣稱已提供拒絕稽核。
- CSV 每列每欄沿既有 `csvCell` quoting／引號 escape／公式前綴防護，含 BOM、CRLF。people 最多 1000 **學員列**，detail 最多 1000 **出席列**；第 1001 列回 413，不能 silently truncate。與單頁結果獨立。

## UI 行為與限制

真正 controller 已包含在 renderer 的 hash-authorized inline script：submit → 同源 POST → 全結果總計／列表 → 點姓名只查同 scope 明細 → 返回原列表頁；上一／下一頁維持已送出的 query。CSV 可直接送出，不需先讓 export-only 使用者取得 view。每次讀取目前 CSRF cookie，busy 期間禁止重入，錯誤會清除舊資料，不能顯示假空成功。只用 textContent／DOM API 顯示姓名及場地，不注入回應 HTML。

支援 label、大於等於 48px controls、aria-live、table caption、keyboard focus-visible、skip link、橫向 table overflow。已用 minimal DOM 執行**相同 script bytes**測試，不是實體瀏覽器／螢幕閱讀器驗收；父代理仍需手機寬度、200% 縮放、鍵盤、assistive technology 實測。沒有自動載入學員、任意建立假學員、教練志工名冊或遠端 NFC 寫入。

### 精確後續：人工補簽／作廢仍關閉

既有 `venue-manual-contract.ts`／`admin-venue-manual-page.ts` 只有獨立 UI 契約；本批沒有替它提供 transport 或打開 write。後續須另案完成：

1. 可信 admin session → 真實志工／管理員對應、逐次獨立 manual/void 權限與 venue scope；先明訂跨區到場與人工修正政策，不能因學員 home region 不同就任意拒絕正常到場。
2. 經審核的 historical local date／timezone、同人同場同日唯一（含 void tombstone）、record version、原子 compare-and-swap，不能刪除後重寫。
3. durable actor-bound idempotency／canonical payload digest／replay 重新授權／未知結果對帳、原因必填、不可變 audit 與原子 commit；不修改日課或私密心得。
4. 既有 UI 的雙確認／同源 CSRF + Origin、持久收據契約、衝突／超時／撤權／跨區／並行負向真 DB 測試，全部通過才掛寫入 routes。不得使用 runtime SELECT／quarantine bypass 暫代。

## 驗證（Node v24.22.1 / PostgreSQL 17.11）

```sh
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@17/bin:$PATH
pnpm exec prettier --check apps/public-api/src/venue-people-*.ts apps/public-api/tests/venue-people-*.test.ts docs/architecture/venue-people-admin-v1.md
pnpm exec eslint apps/public-api/src/venue-people-*.ts apps/public-api/tests/venue-people-*.test.ts
pnpm -r typecheck
pnpm exec tsc -p tsconfig.eslint.json --noEmit
pnpm exec vitest run apps/public-api/tests/venue-people-{helpers,http,page}.test.ts
bash apps/public-api/tests/venue-people-local-pg.sh
# 不採用任何未知 connection URL；全套既有 DB integration 預期略過：
env -u TEST_DATABASE_URL -u DATABASE_URL -u VENUE_QR_ISOLATED_PG_DIR -u VENUE_PEOPLE_ISOLATED_PG_DIR pnpm -r test
env -u TEST_DATABASE_URL -u DATABASE_URL -u VENUE_QR_ISOLATED_PG_DIR -u VENUE_PEOPLE_ISOLATED_PG_DIR pnpm --filter @qigong/public-api test
```

- 本批專屬離線 77 項、真 PG 11 項通過；PG 包含真 HTTP → service → SQL → RLS，view/export 分離、同人跨區 subset、home region 不同、多身份不倍增、總計／去重日數／filter／order／page、CSV injection、1000/1001、撤權／session revoked/expired、非法 selector／context、日期線。
- scoped formatter／lint、所有 package source typecheck、**全倉含 tests tsc** 通過。
- `pnpm -r test`：config 2、identity 6 通過；database **218 通過／310 略過／1 失敗**。失敗為既有 `packages/database/tests/venue-renumber-integration.test.ts:16` 固定 51 個 migration，新增 0054 後實際 52 個；未越界修改。父代理整合 0052／0053 時一併更新 migration artifact assertions 與既有 `venue-qr-postgres.test.ts` 的固定 51／latest0051 期待。
- public-api 全套另外執行以免被 recursive first-fail 跳過；最後重跑數字見交接回報。既有 DB integration 使用未知 TEST_DATABASE_URL 的部分全部略過，沒有宣稱通過。
- harness 驗證 PG17、無 TCP listeners、pristine DB、marker／pid／socket／owner／0700；只在此新 cluster 套用 0001–0051 + 0054。不載入 .env、不用既有 DB、不讀 production／phone 配置、不安裝 dependency。退出後移除 cluster；full chain 仍待父代理整合。
- 依賴驗證暫時使用主 checkout 已安裝 node_modules 的本地 symlink，沒有編譯／修改其他 worktree；交付前移除 symlink。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
