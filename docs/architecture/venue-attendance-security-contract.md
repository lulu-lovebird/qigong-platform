# 團練場出席管理：第一版安全資料庫契約

> 以下為重編號前 0049 批次的歷史契約，內文舊檔名／SHA／測試紀錄保留，不是現行發布規格。
> 未部署 venue 0047／0048／0049／0050 已順延為 0048／0049／0050／0051；本契約現行檔案為 `migrations/0050_venue_attendance_security_contract.sql`。
> 完整映射與最新證據見 [本地整合紀錄](../operations/venue-renumber-integration.md)。
> 最新 [已核准產品規則](venue-attendance-read-export-v1.md) 與
> [0051／QR 演練](../operations/venue-qr-checkin.md) 已取代舊 Taipei-only、四個新增 read permission
> 與尚無 production resolver 的限制；0048–0050 僅更名，0051 forward 實作 scoped read／verified INSERT。
> 舊 NFC 管理路由／metadata write／人工流程仍未開；10 項隔離真 PG 已通過，手機及本輪獨立安全審查不在證明範圍。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 狀態與範圍

基於 `8d46dc143c108da5e2399d78f1bdb9c68300367b`，在獨立 worktree
`feature/venue-admin-security-v1` 交付五檔：

- `migrations/0049_venue_attendance_security_contract.sql`：確認 0049 原先空缺後新增。
- `packages/database/src/venue-attendance-contract.ts`
- `packages/database/src/index.ts`：只增加契約 export。
- `packages/database/tests/venue-attendance-security.test.ts`
- 本文件。

**這是待 PostgreSQL 驗證的 forward SQL 與本地可測契約，不是已啟用功能。**
沒有執行 SQL、建立角色、連 DB／外部 API、讀取機密、部署、push、merge 或開子代理。
未修改 `apps/public-api`、0047／0048、依賴、lockfile、既有日課或 quarantine 文件。

0048 的兩個 restrictive deny-all policy、ENABLE／FORCE RLS、ACL 撤銷全部保留。
0049 不引用／查詢／寫入 `core.practice_fields` 或 `core.field_attendance`，不提供解隔離函式。
NFC gate、readiness、route/service 保持原狀；既有 readiness **尚不接受 0049**，因此也不能
把這份 migration 當成一般服務可直接發布的版本。沒有以靜態測試證明 SQL 可執行／授權有效。

## SQL 函式簽名與權限

以下五個新增函式清除 PUBLIC 與其他 default function ACL（包含直接 session EXECUTE），
再只授予 `qigong_api_runtime` EXECUTE。沒有 worker／session login／PUBLIC EXECUTE，
沒有新角色 membership、表 owner 轉移、BYPASSRLS 或隔離表 GRANT。

```sql
platform.resolve_line_learner_identity(input_subject TEXT) RETURNS JSONB

admin.venue_attendance_authorized(
  input_session_token TEXT, input_region_id UUID, input_operation TEXT
) RETURNS BOOLEAN

admin.venue_attendance_read_fields(
  input_session_token TEXT, input_region_id UUID
) RETURNS JSONB

admin.venue_attendance_write_field(
  input_session_token TEXT, input_region_id UUID, input_field_id UUID,
  input_change JSONB
) RETURNS JSONB

admin.venue_attendance_read_attendance(
  input_session_token TEXT, input_region_id UUID,
  input_from DATE, input_until DATE, input_export BOOLEAN
) RETURNS JSONB
```

後四個函式均 `SECURITY INVOKER`、固定 `search_path=pg_catalog`。
`authorized` 只回答 RBAC 前置條件；其餘三個是**明確可呼叫的拒絕契約**，沒有成功分支：

| 條件                                      | 結果                                               |
| ----------------------------------------- | -------------------------------------------------- |
| 無效 session／context／permission／region | SQLSTATE `42501`、`venue_attendance_forbidden`     |
| 已授權但 metadata／日期輸入不合法         | SQLSTATE `22023`、`venue_attendance_invalid_input` |
| 已授權且輸入合法                          | SQLSTATE `55000`、`venue_attendance_quarantined`   |

這不是可用 CRUD、出席列表或 CSV。沒有假空陣列、假成功、privileged fallback，
不因 RLS 下查不到資料就回傳成功。`field.write` 僅保留既有場地的 metadata 更新契約：
`{ "nameZhTw": "…", "isActive": true }`，兩欄必填、不得附加欄位；名稱去空白後 1–120 字元。
目前不提供建立／刪除／移區／座標／排程變更，也沒有出席新增／志工補登入口。
未來必須另審、實作並鎖定 field row，**先由真實 row 取得 region 再授權**；目前
`input_field_id`／`input_region_id` 都只是 resource selector，不能證明彼此一致。
因本版不存取場地 row，所以即使 selector 跨區也只能被拒絕，不能宣稱已驗證 row scope。

出席查詢／匯出日期採 `Asia/Taipei` 的 `[input_from, input_until)`，最多 366 日；
export 使用獨立 permission，不以 read 權限 fallback。沒有開放任意 person 篩選或私密欄位。
未定義成功 response shape，以免 UI／報表把拒絕契約誤當可用查詢。

## 可信 LINE subject → 最小學員 snapshot

唯一新增 `SECURITY DEFINER` 為 `resolve_line_learner_identity`，固定
`search_path=pg_catalog`、`row_security=on`，owner 為專用 `qigong_venue_identity`：

- NOLOGIN、NOINHERIT、NOSUPERUSER、NOCREATEDB、NOCREATEROLE、NOREPLICATION、NOBYPASSRLS。
- 不持有資料表 ownership；只擁有這個映射函式。role 若已存在且屬性不符、有任一方向
  membership 或既有 ownership／ACL dependency，migration 直接拒絕，不默默採用或修補。
- 角色是 cluster-global；dependency 檢查涵蓋其他 DB。不能把已用於其他 DB 的同名角色
  當作乾淨角色重用；未來隔離測試須在受控 cluster 管理角色生命週期。
- 僅授予 `identity, platform` schema USAGE，及以下四表必要 column SELECT：

| 表                                     | 欄位                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `identity.people`                      | `id, status`                                                            |
| `identity.platform_identities`         | `id, person_id, platform, external_subject_id, revoked_at, verified_at` |
| `identity.person_interaction_channels` | `person_id, platform_identity_id, valid_from, valid_to`                 |
| `identity.onboarding_applications`     | `person_id, platform, external_subject_id, status`                      |

四個明確的 SELECT RLS policy 僅給這個無 membership 的角色，分別限制 active person、
已生效且未撤銷的 LINE identity、當前有效 channel，以及 LINE approved application。
映射函式亦自行重查相同條件與所有關聯，不依賴 owner 免 RLS 或自稱 GUC。
不授予姓名、電話、email、日課、privacy 表或隔離表的任何新 SELECT。

輸入僅允許 `^U[0-9a-f]{32}$`。同一 person／identity 的 channel 必須
`valid_from <= CURRENT_TIMESTAMP` 且 `valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP`；
application 必須同 LINE subject／person 且 approved。無合格資料回 SQL NULL，成功只回：

```ts
{
  subject: string;
  identityId: string;
  personId: string;
  revoked: false;
  learnerActive: true;
  channelActive: true;
  applicationApproved: true;
}
```

**DB 不驗 LINE token，subject 格式不是認證。** SQL execution actor 必須是可信伺服器；
不能讓 browser、request body 或任意使用者直接呼叫／指定 subject。具 runtime SQL 能力的
攻擊者仍可任選 subject，這不是抵抗任意 SQL execution 的 credential 驗證方案。

`resolveLineLearnerIdentity(client, verifiedSubject)` 與既有
`LineLearnerResolver` 結構相容，只使用一個參數化專用函式呼叫，嚴格驗證單一 SQL row、
輸出欄位、UUID、subject 一致性與旗標；成功物件 immutable，畸形輸出不當成有效身份。
不得直接查 identity 表、先用 person GUC 解 RLS 或用 report/helper owner 繞路。

本版**尚未接入** `createLineLearnerIdentityAdapter`。後續在 DB review／隔離測試完成後，
才能由伺服器組裝 resolver；adapter 仍需先驗 LINE issuer／channel audience／expiry／signature，
在清空 person／principal 的 runtime transaction 呼叫 resolver，再沿用既有 `privacy_usage`。
映射函式沒有同意政策、沒有建立 privacy session；snapshot 不是可重用 session 或出席寫入權限。
CURRENT_TIMESTAMP／STABLE 是 transaction snapshot，不保證並行撤銷後仍可寫；未來出席寫入
須當下重查與處理競爭，不能依賴先前 mapping 成功。

## 管理 session、逐操作 RBAC 與 scope

`runVenueAttendanceAdminOperation(pool, requestId, sessionToken, input)`：

1. 嚴格驗證 operation／metadata／日期與 request UUID；拒絕 person／volunteer／principal／
   subject／idToken／checkin／GPS／心得等額外欄位。session token 只允許 32–128 base64url 字元。
2. 使用既有 `withRequestContext(pool, 'qigong_api_runtime', { requestId }, …)`，清空 person／principal。
3. 在同一 transaction 透過既有受控 `admin.session_principal(token)` 驗 session，
   只把 DB 驗出的 UUID 設成 transaction-local principal；不接受 request 自填 principal。
4. 參數化呼叫專用操作函式；SQL 再查實際 session，核對其 principal 與 context 一致。
   缺 request context、任何 person context、過期／撤銷 session 均不能靠偽造 GUC 授權。
5. 正常收到 SQL 拒絕後 rollback／release，回固定 `{ ok: false, error }`；不回 DB diagnostic。
   意外 SQL 成功也視為契約失效並 rollback，不透傳資料。rollback 失敗沿用既有 helper 丟棄 client。

SQL `authorized` 使用既有 `admin.can_access_region`，同一有效 grant 同時滿足 action 與
region；active principal／grant 有效期沿用既有模型。目標須 active operational region，
country 與 global ancestor 也須 active。允許既有 global／對應 country／對應 region scope；
cohort／privacy case／content／platform grant 不可當場地管理權限。
不使用 `can_access_person` 的 learner self-read，也不把兩個不同 scope grant 拼成授權。

| operation           | 新增 permission                      |
| ------------------- | ------------------------------------ |
| `field.read`        | `venue_attendance.field.read`        |
| `field.write`       | `venue_attendance.field.manage`      |
| `attendance.read`   | `venue_attendance.attendance.read`   |
| `attendance.export` | `venue_attendance.attendance.export` |

只新增 `admin.permissions` code；**沒有新增 role_permissions／role_grants**，現有角色包括
super_admin／master_admin 不會自動取得權限。後續需以既有受控管理流程明確配置，不能靠登入
或 `checkin.read`／`stats.read` 推論權限。即使配置後，本版三個操作仍只拒絕。

module 不解析 HTTP cookie／query／header、不新增 route、不負責 CSRF；未來寫入路由仍必須
從既有 authenticated admin session 與 CSRF 邊界取 credential，不可把傳入 UUID 當 session。
既有 session verifier 的實際 DB 安全性本批未重新證明，沒有新增 session 表授權或 owner 繞過。

## 資料最小化與出席日數

- 團練場出席管理獨立於日課；不新增／更新日課，不選功法、不儲存或連結私密心得。
- 無 learner attendance 寫入函式；不得恢復 0047 舊 INSERT 或使用歷史
  `checkin_id`／`student_note`／`user_latitude`／`user_longitude` 欄位。
  本批不刪除／回填既有歷史資料；不宣稱舊資料已完成去識別／清理。
- 未來 GPS 僅當次驗證，原始資料不保存／不記 log；可保存經核准的驗證結果與距離。
  靜態 NFC URL＋GPS 仍不是防轉傳或強防代簽證明。
- 沿用 0047 的 `(person_id, field_id, Taipei date)` 唯一索引：同人同場同日一次，同日跨場可。
  這裡只檢查既有 SQL 形狀，未實測原子並行、衝突處理或真實約束。
- v1 權威出席日期固定 `Asia/Taipei`，不採 browser、person 或 PostgreSQL session timezone。
  未來若按場地時區需另審 migration／歷史相容性，不能僅改 UI 日期。
- `countVenueAttendanceDays(instants)` 僅對**同一已授權學員**的 canonical UTC timestamps
  轉 Taipei 日期並去重；不是 DB 查詢／scope check，不得混入其他學員或日課 streak。

## 本地驗證證據與限制

測試命令明確移除 `TEST_DATABASE_URL`，沒有讀其內容或載入 .env。新 DB 套件本地
node_modules 原先缺失，暫時連結父 checkout 已安裝依賴執行工具；沒有安裝、更新依賴，
驗證後移除臨時連結。工具實際為 Node `v26.10.0`、pnpm `10.15.1`、Vitest `3.2.7`；
Node 非專案要求的 24，pnpm 有 engine warning，仍需 Node 24 重驗。

```sh
# 新測試 116 passed、10 明確 skipped；加 0047／0048 契約為 170 passed、10 skipped
# 新 suite 的十個 skipped 是待實作的真實 PostgreSQL 驗證項目，不是已備妥 DB 測試。
env -u TEST_DATABASE_URL pnpm --filter @qigong/database exec vitest run tests/venue-attendance-security.test.ts tests/nfc-security-quarantine.test.ts tests/field-attendance-schema.test.ts

# database 全套：173 passed、292 skipped；未執行 migration／DB 測試
env -u TEST_DATABASE_URL pnpm --filter @qigong/database test

pnpm --filter @qigong/database typecheck
pnpm --filter @qigong/database build
pnpm exec eslint packages/database/src/venue-attendance-contract.ts packages/database/src/index.ts packages/database/tests/venue-attendance-security.test.ts
pnpm exec tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck packages/database/tests/venue-attendance-security.test.ts
pnpm exec prettier --check packages/database/src/venue-attendance-contract.ts packages/database/src/index.ts packages/database/tests/venue-attendance-security.test.ts docs/architecture/venue-attendance-security-contract.md
git diff --check
```

TS／Markdown 使用既有 Prettier 格式化；Prettier 對 SQL 的 inferredParser 為 null，
沒有新增 formatter 或假稱 SQL 已被 PostgreSQL parser 驗證。靜態 mutation 包含移除 session
核對／同區權限／角色隔離／function ACL 清理、恢復假成功與追加廣泛授權／日課寫入。
mock 只證明參數、呼叫順序、清空 context、拒絕與錯誤清理，不證明真實 RLS 或 session 拒絕。

初次工具執行因 worktree 未安裝依賴找不到 vitest，改用既有本地依賴。新測試第一次有一項
Vitest `it.each` 展開空陣列 fixture 的錯誤、及測試型別／unused parameter 問題；第 1 輪
修復後通過，並補嚴格時間格式／year-zero 拒絕。沒有超過三輪修復，也未擴大修改範圍。

### 父代理後續整合前必須完成

1. 結構安全 review：本介面沒有可呼叫的 `allow_tool: false` hook，本機 commit 不代替 hook、
   security review 或發布核准。確認 migration runner 的 transaction、角色建立／function owner
   transfer 能力與 cluster-global role dependency 行為；本批完全沒有執行它們。
2. 明確可拋棄的隔離 PostgreSQL：補實作 fixtures 與十項 skipped 驗證矩陣，驗證 SQL 能編譯／
   upgrade／rollback／舊資料保留、普通非 owner resolver／owner FORCE、PUBLIC／session／worker／
   default ACL、偽造 context、跨區／action scope、search_path shadowing 與 pool cleanup。
   skipped 不是通過，禁止只移除 skip 或加環境變數就宣稱驗證完成。
3. 驗證後才組裝 LINE adapter resolver；不把 mapping snapshot 當 privacy／出席授權。
4. 另批設計安全的場地 read/write 與 attendance read/export 實作：取得真實 row region、
   防移區 TOCTOU／鎖定、權限分配、分頁與最小輸出、歷史 region 可見性、CSV 注入防護／稽核。
   不能僅刪除本版 `55000` 或給表 GRANT；0048 仍會拒絕，亦不得用 owner／BYPASSRLS 躲避。
5. 另批實作 self／manual attendance：可信 credential、當下 identity／channel／eligibility／
   privacy 版本與撤銷／並行、逐操作場地授權、權威 server 時間窗、原子防重；志工身份來自
   真實 admin session 與獨立 permission，不能自填 volunteer ID。本批沒有提供該權限或 writer。
6. 真實 DB 證據與安全審核先於任何替換 quarantine、readiness／migration 相容性更新、
   NFC 開啟或端到端成功路徑。UI／報表代理只能依本契約呈現 unavailable，不能擴權。
