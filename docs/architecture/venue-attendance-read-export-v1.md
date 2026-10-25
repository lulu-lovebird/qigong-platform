# 團練場出席管理：forward scoped read/export v1（待審）

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 1. 本批交付及不變邊界

基線 `5bca01b829cc2c7ef1525e678d83cc85d27fb156`。本文件是可實作方案，
`apps/public-api/src/venue-admin-read-contract.ts` 是**未接線**的 request parser／success decoder；
測試僅純函式與負向 dependency mock。沒有 SQL、DB adapter、DB 連線、migration、gate、
角色／權限配置或成功 route。本批不改 0047／0048／0049、service／runner 或既有 UI。

已讀取介面：`@packages/database/src/venue-attendance-contract.ts`、
`@apps/public-api/src/venue-admin-service.ts`、`@apps/public-api/src/admin-field-routes.ts`、
`@apps/public-api/src/admin-attendance-routes.ts`。0049 和現 runner 仍 deny-only；意外 SQL
成功仍 rollback／503。不可把本 decoder 接到它們來偷開成功分支。
NFC default-off、readiness 拒絕 0049、write metadata 拒絕與人工 UI 未啟用均保留。

## 2. 現有模型能證明甚麼

| 來源                                              | 可證明的 schema／契約事實（不是 DB 實測）                                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 0047 `core.practice_fields`                       | 只有目前 `region_id`，沒有 effective-dated region history；`updated_at` 不是不可變歸屬證據                                                     |
| 0047 `core.field_attendance`                      | `person_id, field_id, checkin_at, checkin_method, distance_meters`；**沒有** `region_assignment_id` 或 event field-region snapshot             |
| 0047 unique index                                 | 同 person／field／Taipei 日期唯一；跨場同日可以；不等於防代簽證明                                                                              |
| 0002 `core.person_region_assignments`             | primary 有排除重疊約束；DATE `[valid_from, valid_to)`；secondary／program 不可代替 primary                                                     |
| 0003 `admin.can_access_person`                    | 使用 CURRENT_DATE 的現在歸屬，還有 learner self-read 分支；**不能**證明出席當日歷史權限                                                        |
| 0003 `admin.can_access_region`、0049 `authorized` | 同一有效 grant 的 action + global／country／operational scope；0049 另驗實際 session、principal、request、無 person context及 active ancestors |
| 0005 `admin.session_principal`                    | CURRENT_TIMESTAMP／STABLE 的 transaction snapshot；單靠它不能保證長交易內並行撤權的 wall-clock 語意                                            |
| `permission-model.md`                             | 歷史 check-in 歸屬與 aggregate privacy 要求；不是 venue attendance 已實作的 privacy engine                                                     |

禁止透過舊 `checkin_id` 借日課的 assignment／心得／方法來補出席歸屬；資料可能沒有連結，
也不能把現在 primary assignment 當過去 assignment，或把目前場地 region 當不可變歷史。

### 最小、保守的歷史可見域

未來 SQL 設 `d = (a.checkin_at AT TIME ZONE 'Asia/Taipei')::date`，必須同時滿足：

1. 真實 `f.id = a.field_id`；selector 的 `regionId` 不是所有權證明。
2. 經證據封存的 event field-region = selector region，且 v1 **目前** `f.region_id` 也等於該區。
3. 該 person 在 d 唯一有效 primary assignment 的 region = 同一 selector region，
   `valid_from <= d AND (valid_to IS NULL OR d < valid_to)`；assignment 必須與封存引用相符。
4. 實際 session 的本次 action 對該 operational region 有權，country/global 也只查一個明確區，
   不能利用不同 grant 拼湊 action／scope。name permission 另查同一歷史區。

跨區出席（person 當日 primary 與場地 event region 不同）**不進 rows、totals、匯出或提示**，
即使操作者有 global／兩區 grant 亦無例外；產品未核准可見性，不擅自放寬。
轉區前資料不給目的區，轉區後不給原區；可按原歷史區查已轉出學員，不以今天 primary 改歸屬。
場地移區後 v1 不把舊資料交給新區；不確定的舊資料不能推定可見。

**目前沒有足夠 schema 證明 event field region。**成功 attendance 的前置資料工程為另案核准的
不可變 scope ledger（建議 `core.venue_attendance_read_scopes`）：每個 attendance ID 唯一引用
person primary assignment ID、event field region、證據來源 ID／封存版本；FK／檢查須核對
attendance.person、field、Taipei 日期及 assignment。不得直接用目前 region 批次回填；
沒有可靠 field-region history 的 legacy row 不得標成 verified。現有原始列保持原狀。

v1 啟用 attendance 前要求全量 legacy provenance coverage／完整性檢查通過；無法證明就維持
attendance quarantine／unavailable，不能把所有未證明列濾掉後假稱成功空集合。
可先獨立審核僅 field.read 的 forward migration，attendance 的 0048 policy 不動。
ledger／evidence 的建置、受控回填與不可變性約束是**未實作**的獨立審查項，不是本批 migration。
封存後仍校驗 assignment 引用；日後修正歷史 assignment 必須使相應讀取失效，不能靜默重歸屬。

## 3. 未來 forward migration 的精確安全變換（本輪不新增 SQL）

選一個審核時仍空缺、排在 0049 之後的版本，不假定 0050 永遠可用。單一 migration transaction：

1. 驗證 ledger prerequisite、0048 policy 原定義、relrowsecurity／relforcerowsecurity、owners、
   所有既有 policies／ACL／函式 owner／dependencies；未知狀態立即 abort，不能自動採用寬鬆現況。
   鎖定兩表以排除並行 DDL／DML；禁止 runtime owner、superuser、BYPASSRLS 或角色 membership。
2. **先補上三個 restrictive write guards，再只替換原 FOR ALL quarantine**。兩表各建立：
   `AS RESTRICTIVE FOR INSERT TO PUBLIC WITH CHECK(false)`；
   `AS RESTRICTIVE FOR UPDATE TO PUBLIC USING(false) WITH CHECK(false)`；
   `AS RESTRICTIVE FOR DELETE TO PUBLIC USING(false)`。
   然後移除精確名稱 `practice_fields_security_quarantine`／`field_attendance_security_quarantine`
   的 FOR ALL policy，建立新的 restrictive **FOR SELECT TO PUBLIC** scoped fence。
   FOR ALL 無法直接只去掉 SELECT；此拆分是保留原來每項寫入拒絕的必要替換，不是解除全部隔離。
3. 新 SELECT fence 只容許專用 reader role 且私有驗證 context／逐 row scope predicate 成立。
   另建只給該 role 的 permissive FOR SELECT policy，predicate 同樣 scoped；restrictive AND fence
   防止其他 permissive policy 擴權。沒有 permissive policy 時仍 default deny。
   `ENABLE ROW LEVEL SECURITY`、`FORCE ROW LEVEL SECURITY` 永久保留；普通 table owner 亦被 fence 拒絕。
4. ACL 先逐 object 清除 PUBLIC／runtime／worker／authorizer／session login 與意外 default grants，
   包含 `pg_attribute.attacl`，不能只 REVOKE table 然後假稱 columnACL 已清。
   新 function 自動帶入的 PUBLIC/default EXECUTE 及新表 defaultACL 同樣清除。
   掃描 `pg_default_acl`、role inheritance／SET ROLE paths、schema CREATE／USAGE、grant options、
   function overload、sequence privileges；不改無關物件的 default ACL，若會重生不安全權限則 abort。
   不給任何角色 protected table 的 INSERT／UPDATE／DELETE／TRUNCATE／REFERENCES／TRIGGER。
   TRUNCATE 不受 RLS，必須靠 ACL 拒絕。不恢復 0047／舊 route 的任何入口。
5. 明列 column SELECT allowlist（下表），只給新 NOLOGIN reader；runtime 只 EXECUTE 新 facade。
   移轉新 facade 的 function ownership，**不**轉移 table ownership。不新增任何 role grant 或
   role_permissions；既有 super_admin／master_admin 也不自動升權。
6. migration 結尾以 catalog assertions 確認上述 RLS／policy command／roles／ACL 精確集合。
   任一 failure 整筆 rollback，不能中途提交裸露 SELECT；失敗保持原 0048。已提交後若需關閉，
   新 forward migration 先撤 facade EXECUTE，再恢復 restrictive SELECT false，寫入 guards 不動；
   不採 drop RLS／改舊 migration 或還原寬鬆 GRANT。

### 角色、欄位與 definer 邊界

新角色建議 `qigong_venue_reader`、`qigong_venue_read_guard`、`qigong_venue_read_audit`。
全部 NOLOGIN／NOINHERIT／NOSUPERUSER／NOCREATEDB／NOCREATEROLE／NOREPLICATION／NOBYPASSRLS，
無任何方向 membership，不擁有任何 protected table；guard/audit 只擁有受審函式。
同名現存角色若有屬性、ownership、ACL dependency（包括 cluster 其他 DB）即 abort，不能盲用。

| reader 所需資料                  | 僅可授予的 column SELECT；未列者不可授予                                               |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `core.practice_fields`           | `id, region_id, code, name_zh_tw, is_active`                                           |
| `core.field_attendance`          | `id, person_id, field_id, checkin_at, checkin_method, distance_meters`                 |
| 新 scope ledger                  | attendance／assignment／event-region／sealed-version 引用，無自由文字證據內容          |
| `core.person_region_assignments` | `id, person_id, region_id, assignment_type, valid_from, valid_to`                      |
| `core.regions`                   | `id, parent_region_id, region_type, active`                                            |
| `identity.people`                | **僅待 name permission 核准後** `id, preferred_name`，deny-by-default 的歷史 scope RLS |

表與新 ledger、private context／budget／audit storage 都要求 FORCE RLS，專用 role 的明確 policies；
不修改原有 authorizer 的廣泛權限來讓新 reader 借路。reader 不讀 sessions／RBAC 原表或電話。
people 沒有合格 preferred_name 時，visible 模式整筆 unavailable，不能 fallback 電話、LINE 名稱或 ID。
未獲 name 核准時完全不查 people 姓名，DTO 一律 null，不以 UUID／hash 假稱匿名姓名。

新 public facade 建議三個獨立簽名：
`admin.venue_read_fields_v1(session TEXT, query JSONB)`、
`admin.venue_read_attendance_v1(session TEXT, query JSONB)`、
`admin.venue_export_attendance_v1(session TEXT, query JSONB)`，returns JSONB。
query 即第 4 節，operation 必須與函式固定 action 一致；不重用 0049 的 export boolean 來混淆權限。
0049 所有舊函式（尤其 write）可原封不動繼續拒絕。

facade 為 SECURITY DEFINER、固定 `search_path=pg_catalog`、`row_security=on`、全限定名稱，
無 dynamic SQL／任意 relation／任意 ORDER BY／呼叫者控制的 function resolution。
需要 `public.digest` 時必須驗 extension 函式身份與不可被 runtime 替換，不能加 public 到 search_path。
只對 `qigong_api_runtime` 授精確 facade EXECUTE；private guard／predicate／audit helpers
無 PUBLIC、runtime、worker、session EXECUTE，不授任意 person lookup。

可信 context 不能只信任 `SET LOCAL principal/region/action`：facade 先調實際 session verifier，
核對 request principal／無 person context／request ID；私有 guard 建立 backend + transaction + request
綁定 permit，含已驗證 session hash reference、principal、固定 action、region、canonical query、
name 決策與短時 expiry。permit 表僅 guard 可寫、reader 經受控 predicate 可驗，runtime 不可讀寫。
guard 對 sessions 僅需 `token_hash, principal_id, expires_at, revoked_at` 與相應 RLS，RBAC 走受審 helper；
不保存 raw token。自稱 GUC、重放其他 connection 的 permit 或只有 principal UUID 一律無效。
helper 必須重查 session／active ancestors／grant 有效期，不以 permit 取代即時授權。
finally 刪除 permit，交易結束亦使 backend／tx 綁定失效；pool cleanup／error 丟棄沿用現有契約。
這是待實作的新私有機制，**不是 0049 已經提供的能力**。

## 4. 可測 DTO（v1，不代表啟用）

`parseVenueReadRequest(unknown)` 嚴格 parse、無 coercion／default／aliases，輸出深 immutable：

| operation           | 必填，除此以外皆拒絕                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `field.read`        | `regionId` UUID、`page` 1–10000、`limit` 1–100                          |
| `attendance.read`   | `regionId, from, until, filters, page, limit`                           |
| `attendance.export` | `regionId, from, until, filters`；不接受 page／limit，不以讀取 fallback |

`filters` 恰為 `{fieldId: UUID|null, method: 'nfc_gps'|'volunteer_manual'|null}`；兩欄必填。
無 person／姓名／志工／cohort／任意 region list／任意排序／搜尋／自由 SQL 篩選。
from、until 為合法 0001–9999 ISO 日期，**Asia/Taipei `[from, until)`**，差值 1–366 日。
UI 的 inclusive end 必須只轉換一次；不存在的日期與多 1 日均拒絕。

available envelope 固定 `version:1, state:'available', operation, regionId`：

- field：`page, limit, total, fields:[{fieldId, code, nameZhTw, isActive}]`。
  code 1–80、nameZhTw 1–120；不回座標、radius、排程、建立時間、URL／token 或廣泛 metadata。
- attendance read：另含原樣 `from, until, filters, timezone:'Asia/Taipei', nameVisibility, totals,
page, limit, rows`。
- attendance export：相同，但無 page／limit，改為 `rowCount`；rows 必須是**完整**集合，最多 1000。
  超過上限回 unavailable（稽核內部記 overflow），禁止截斷或改用 read 分頁拼匯出。

每個 attendance row 恰為：

```ts
{
  date: '2026-10-25', // Taipei 日期，不回原始時間戳
  learnerName: null, // 或核准後的 1–120 字姓名
  field: { fieldId: 'uuid', code: 'TPE-01', nameZhTw: '團練場' },
  method: 'nfc_gps', // 或 volunteer_manual，不是功法
  distanceMeters: 12.34 // 儲存值的有限非負數或 null；不推論 GPS 驗證成功
}
```

無 attendance／person／volunteer／checkin ID、原始 GPS、私密心得、電話、session、內部 audit ID。
距離最大 999999.99 對應現有 NUMERIC(8,2) 正值範圍；歷史負值或格式不合不做靜默修正。
欄位文字 trim／非空／禁止控制字元，欄寬不符的歷史值回 unavailable，不截斷假成功。

`totals = {attendanceCount, attendanceDays, learnerCount}`：均為完整**已授權且符合核准篩選**集合，
不是本頁。attendanceCount 依 person／field／Taipei 日期去重；attendanceDays 是集合中 distinct
Taipei 日期數（不是每人日數相加），learnerCount 為 distinct person。內部 IDs 只做 scope／去重，
不輸出；不混用日課／streak。排序固定 date DESC、field ID、person ID、attendance ID，最後三項
僅作內部 tie-breaker。fields 依 code、ID 排序。SQL 用同一短交易 snapshot 算完整 totals／page。
每次查頁仍重驗權限，不重用前頁授權；v1 不承諾跨 request snapshot 穩定，也不允許以分頁繞過匯出。

no-data envelope **只能** `{version:1,state:'suppressed'}` 或 `{version:1,state:'unavailable'}`，
不能附 count／rows／原因／存在性 hint。suppressed 僅用 attendance；未知 policy／provenance／
privacy engine、audit 或 DB failure 為 unavailable，絕不改成 total:0。
真正已驗證的空集合可 available／全 totals 0，但仍需完整授權、privacy 判斷與成功 audit。
未授權仍由外層固定 401／403（資源是否存在均同樣回應）；quarantine 保留 503，不由 decoder 改寫。
未來 suppressed 建議 HTTP 200/no-store、無下載 header；unavailable 503/no-store。僅 available
export 才能編 CSV、設 attachment；UTF-8 BOM、RFC quoting、公式／控制字元防護，名稱不能當檔名。
現有 CSV encoder 含 volunteer/time 等舊欄位，**不可**直接拿來當 v1 成功 encoder。

`decodeVenueReadResult(unknown, expectedRequest, serverNameDecision='redacted')`：
所有層級 strict schema、重建 clone 並深 freeze；逐欄驗證 operation／region／日期／filters／分頁
與 row 的 date／field／method；read 本頁長度必須精確對 total，export 長度精確等 rowCount／總數。
任何未知欄位（包括 nested GPS）、錯誤型別、私密 extras、部分 export、低於門檻卻 available，
均僅回固定 unavailable，不透傳 Zod／SQL 診斷或部分資料。
它**不能**驗證不同姓名代表不同人、歷史歸屬、總計真實性、RLS、anti-differencing 或 audit；
serverNameDecision 只能由可信 server policy 計算，不是 DB JSON／browser boolean。

## 5. 姓名、隱匿與 anti-differencing：未完成、需政策核准

建議另設 `venue_attendance.attendance.names` 專用權限，現有四個 permission 不包含它；
不能借 `learner.read` 現在歸屬或 `checkin.read_private_note` 自動取得姓名。
read／export 分別要求自身 action，named 再要求 names 對**同一歷史區**成立；names 本身無讀取權。
未核准不新增 permission／不分配 grant，維持 redacted。

提出可實作的初始 privacy profile（產品／privacy owner 未確認前不得發布成功資料面）：

- k=5 distinct learners，對完整 scope+filters 先算，不對 page 算；同名不同人不合併。
  1–4 人整個 rows／totals／export 都 suppressed，含 named 模式，不能用姓名權限豁免。
  0 與非零可區分仍有推斷風險，是否一律抑制 0 必須產品確認；目前 DTO 只表達真空集合的可能。
- 單次 k 門檻**不等於匿名**。date／場地／距離及逐列本身可識別；如無 row-level disclosure
  核准，privacy engine 必須 suppressed（不能因 learnerName=null 就放行）。不提供 per-day／
  per-field／per-method group 統計；未來增加 breakdown 必須每組及互補組再驗門檻。
- release ledger 以 principal + operational scope + policy revision 記 canonical query、內部 person-set
  keyed digest 與集合差異；read／export／分頁共用 ledger。除完全相同 canonical query 的翻頁外，
  對相交、相鄰日期、field/method 互補／改動查詢，若任一方向 set difference 為 1–4 人，抑制新釋出；
  對 scope 共享安全 ledger 阻止換帳號／country-global route 切換繞過；不把差異人數回給呼叫者。
- 提議每 principal + region 每 24 小時最多 20 次新 cohort release；同 canonical query 翻頁不扣
  新 cohort 額度，但仍有限速、重驗與 audit。跨 policy revision 不可清空歷史；retention／budget
  數值／collusion 邊界需核准，不能宣稱這個簡單 budget 已提供嚴格 differential privacy。
- release ledger 檢查／預算消耗／audit 原子執行，鎖住 scope budget key 防並行差分；有界處理，
  未知／timeout／ledger 缺失直接 unavailable。不可快取未 scoped raw JSON／CSV；v1 no-store。

這些 ledger／budget／privacy policies **尚不存在**；本 decoder 的常數 5 只是契約下限，
成功 fixtures 不證明 privacy 已實作。產品還需決定 named operational use 是否允許小群體例外；
目前一律無例外，不擅自決定寬鬆揭露。

## 6. Audit、撤權與成功釋出順序

每次 field read、attendance read／翻頁／export、suppressed／denied／unavailable 都應有受控 audit。
server-only audit helper 只寫 allowlisted event，不允許 runtime 任填 actor、SQL 或 payload；
reader 只 EXECUTE 該 helper，不給 audit 表 UPDATE／DELETE；storage owner 另置且 FORCE RLS。
最小事件：request ID、已驗 principal、action、operational region、canonical query keyed digest、
policy revision、names visible/redacted、結果類別、server time。成功 export 記已核准 rowCount；
suppressed 不記公開 count，不記 rows／姓名／token／raw filters／GPS／心得／電話或證據內容。
內部 count、query ledger、session hash 均不可輸出或寫一般 log；保存期限／稽核人權限需確認。

未來流程：request-bound 真 session → 固定 facade → provenance/row scope → privacy ledger →
完整投影／totals／page → server 嚴格 decoder →（export encode + byte cap）→ 同 connection 最終
wall-clock session/action/region/names 重驗 → atomic release audit／budget commit → 才能送 bytes。
建議 JSON 2 MiB／CSV 2 MiB、單次 5 秒／無串流；超限整筆 unavailable，不傳送前段。
rollback 不得留下「已成功釋出」audit；deny／failure 的 audit 需由獨立最小 helper 記固定結果，
不得因 audit 重試而送出資料。audit failure 一律不釋出。

撤權須訂明線性化點：新增 shared/exclusive actor/scope lock 協定，由 read release 與所有 session
revoker、grant／principal／region／歷史修正途徑共同遵守；最終使用新 READ COMMITTED statement
和 clock_timestamp 重查，不能依賴舊 CURRENT_TIMESTAMP。撤權在 release 點前完成則不得釋出，
release 點之後撤權無法收回已交付 bytes。現有撤權路徑未遵守此新協定，必須另批 review／測試，
不能宣稱僅補 final SELECT 就沒有 TOCTOU。未完成協定前成功資料面 NO-GO。

## 7. 隔離 PostgreSQL 驗證方案（本輪不執行）

另經授權後，於 Node **24.x**、一次性 local cluster／獨立 OS user／本機 Unix socket 執行；
`listen_addresses=''`、拒 TCP、無外網、無真實資料／備份／憑證，所有 session／人名均合成。
由隔離 fixture 啟停及清理 cluster-global roles／data directory，不能指向預設 PG socket 或
現有 TEST_DATABASE_URL；不讀 .env。缺 PostgreSQL／Node24 先回報，另取得安裝授權，不自裝系統工具。

必須先實作真正 SQL tests，不能把現有 skipped tests 改環境變數就當完成：

1. 全鏈 0001–0049 + 待審 forward、0047 舊資料保留／0048 quarantine／0049 拒絕基線；
   正常 upgrade、故障注入 transaction rollback、同名髒角色／未知 policy／ledger 不完整 abort。
2. 用真非 owner runtime／reader／worker／session login；FORCE owner 與 NOBYPASSRLS 驗證；
   PUBLIC、繼承／SET ROLE、tableACL／columnACL／grant option、惡意 defaultACL、function overload、
   search_path／temp shadowing、直接 helper／raw table／TRUNCATE 全矩陣。
3. metadata INSERT／UPDATE／DELETE、attendance self/manual INSERT、改 region／座標全部繼續拒絕；
   即使故意加 permissive policy 也不能寫；0049 write 與舊 runner 仍拒絕。
4. 真 session／偽 GUC／缺 request／person context／過期及 revoked／active ancestors／不同 action、
   grant 拆拼與 country/global 單區；read 無 export／names，names 無 read。私有 permit 跨 connection、
   transaction／request／expiry 重放皆拒絕，commit／rollback／timeout 後 pool 無殘留。
5. 歷史 primary 半開邊界／Taipei UTC 跨日／leap day／366、367 日；轉出／轉入／secondary、
   缺 provenance／場地移區、跨區出席（含 global）不洩露；沒有 checkin link fallback。
6. 固定排序／空集合／分頁／全量 totals、同日跨場、rowCount 1000/1001、距離 null／舊非法值、
   strict JSON／公式 CSV／bytes cap／decoder failure。確認不是 production route 成功就等於 SQL RLS 成功。
7. k=0/1/4/5、互補 filters／相鄰區間／跨 read-export／換頁與多帳號差分、scope-wide budget，
   並行 ledger 只一次 release；audit failure 及 rollback 不送 bytes。
8. session／grant 撤銷、region停用、person/field歷史修正與 release 以 barriers 交錯；測試撤權
   線性化前後兩種結果、跨 pool connection 與 teardown；先證明 revoker 同 lock 協定，不能只測 mock。

本輪無 DB 證據。順序為：parent 獨立安全審查＋產品政策確認 → provenance／privacy／revocation
儲存與函式實作審查 → 隔離 SQL 矩陣 → 嚴格新 adapter／route／CSV adapter → 額外 readiness／gate
與發布核准；每批至多 5 檔，不用本契約當作開 gate 的授權。
沒有可呼叫的 `allow_tool: false` veto hook，故以此 NO-GO 邊界提交 parent 結構安全審核，不假稱已觸發 hook。
