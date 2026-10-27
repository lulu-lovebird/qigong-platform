# 學員「我的團練紀錄」backend v1

> 整合狀態更新：已在本地 integration branch 接上主程式，**尚未上線**。最新 54-chain、路由／開關、驗證與限制見[整合交接](../operations/venue-history-admin-integration.md)。以下保留原 standalone 分支的交付／驗證紀錄；「未接線」、52 檔 migration 或舊失敗數字均屬該歷史範圍，不是目前整合狀態。

Developed with ❤️ by Bean, Bird & Badminton Tech Consulting

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 狀態與接線

此批僅提供 migration、可組裝 module、契約與測試；**未接線、未部署、未宣稱 ready**。
基底為 `origin/main` / `56284208942acb182651c02983011f80b8921a47`。
沒有修改 `app.ts`、`line-onboarding.ts`、`index.ts`、LIFF renderer、舊 migration、
readiness 或任何 dependency/lockfile；沒有 LINE/外部 API、既有 DB、部署、push 或 merge。

父代理於安全審核與 migration 發布核准後，從
`apps/public-api/src/venue-history.ts` import：

```ts
registerVenueHistoryRoutes(app, pool, {
  publicOrigin: 'https://<reviewed-public-origin>',
  loginChannelId: '<server-owned-LINE-login-channel>'
});
```

- export `registerVenueHistoryRoutes(app: FastifyInstance, pool: Pool, config: VenueHistoryConfig): void`。
- export `createVenueHistory(pool, config)`：回傳 `(requestId: string, input: unknown) => Promise<VenueHistoryOutcome>`。
- 同 module export strict input/success Zod schemas、success/outcome/config types。
- config 必須是 composition-root 資料；HTTPS origin 不得含 path/trailing slash。
  可選 `verifyIdentity` 只供受控測試注入；production 不注入即使用既有完整 LINE verifier。
  resolver 固定使用 adapter 內建 0050/0051 controlled resolver，沒有自填 person/resolver fallback。
- 父代理仍須統一更新 schema compatibility/readiness 上界及整合測試：既有 repository migration
  與 QR PG harness 仍固定 51，本批依限制沒有修改它們。不能僅改 readiness 就宣稱已上線。
- 本介面沒有可用 `allow_tool: false` hook；結構安全需父代理另行執行正式 review。

## 固定 HTTP 契約

`POST /api/line/venue-history`

必須 exact 同源 `Origin`、`Content-Type: application/json`（可含 charset）、
自訂 header `x-venue-history: 1`；不允許以 query/cookie/GUC/任意 channel 指定身份。
路由限制 body 6144 bytes。成功與失敗皆 `Cache-Control: no-store`、
`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`。

Strict request：

```ts
{
  idToken: string; // 非空，最多 4096 字元；由後端驗 issuer/audience/expiry/signature
  month?: string; // YYYY-MM，0001–9999，月份 01–12
  venue?: string; // 既有 stable code，最多 64 字元，非 field/person UUID
  page?: number; // positive safe integer，預設 1；禁止 coercion，固定 pageSize 20
}
```

所有未知 key，包括 `personId`、`principal`、`principalId`、`subject`、`platform`、
`channel`、`pageSize` 都拒絕；沒有 mock production 路徑。

```ts
{
  ok: true;
  timezone: 'Asia/Taipei';
  totals: {
    attendanceCount: number;
    attendanceDays: number;
    monthCount: number;
  }
  page: number;
  pageSize: 20;
  hasMore: boolean;
  entries: Array<{
    id: string;
    venueCode: string;
    venueName: string;
    checkedInAt: string; // ISO8601 UTC，保留 PostgreSQL 微秒
    venueLocalDate: string; // YYYY-MM-DD，既有 attendance_date，不重算
    venueTimezone: string; // 既有 attendance_timezone，IANA identifier
  }>;
}
```

- `attendanceCount`：本人 lifetime 所有場地出席次數，不受 month/venue/page 影響。
- `attendanceDays`：本人 lifetime **既有 venue-local 日期**去重。同一字面日期跨場算一天，
  但每場各算一次出席；日期線造成不同 local date 時各算一天，不依台北重算既有日期。
- `monthCount`：指定 `month` 的本人全場出席次數；未指定時依 **DB 時鐘的台北當月**。
  此值不受 venue/page 影響，不是日數。
- `entries`：month、venue 是可選篩選；**未指定 month 時不限制月份（lifetime entries）**。
  指定 month 時依既有 venueLocalDate 的月份，不按 UTC 或 browser timezone。
- 排序固定 `checkin_at DESC, id DESC`，固定每頁 20，取第 21 筆決定 hasMore。
  Offset paging 在兩次請求間有新增資料時可能位移；不宣稱跨請求 snapshot/cursor consistency。
- 本人無紀錄：全 0、`[]`、`hasMore:false`；只有篩選無結果或超末頁時仍保留 lifetime totals。
  不存在的合格式 venue code 是空集合，非場地存在性查詢。
- 場地已停用仍能讀本人歷史。本人所有國家/場地皆可看，不受 home-region 或 admin scope 限制。
- 不回傳 subject/personId、他人姓名、GPS、距離、notes、phone、identity mapping 或原始 DB errors。

固定失敗形狀 `{ok:false,error:string}`：

| HTTP | error                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| 400  | `invalid_input`；JSON/parser/body-limit 錯誤為 `invalid_or_unavailable_request`                                          |
| 401  | `invalid_line_identity`                                                                                                  |
| 403  | `invalid_origin`、`learner_identity_unavailable`、`privacy_acceptance_required`、`identity_consent_or_venue_unavailable` |
| 503  | `line_identity_unavailable`、`venue_unavailable`；路由未預期錯誤為 `invalid_or_unavailable_request`                      |

不 echo token/PII，不記錄 request、SQL diagnostics 或 arbitrary exception message。
父代理接線須保留既有 privacy logger，不得加入 raw body/exception logging。

## SQL 與信任邊界

```sql
platform.venue_personal_history(
  input_platform TEXT,
  input_subject TEXT,
  input_month TEXT DEFAULT NULL,
  input_venue TEXT DEFAULT NULL,
  input_page BIGINT DEFAULT 1
) RETURNS JSONB
```

- 新 `0052_venue_personal_history.sql`，不 snapshot/backfill legacy ledger，不寫日課、原始 GPS 或 notes。
- platform 參數保留跨 channel 演進位置，本期**僅接受 `line`**；其他 channel 不得直接傳 subject。
  未來各 channel 必須另審其 credential verifier/resolver，不可只刪掉 platform 檢查。
- HTTP 每次先透過既有 `createLineLearnerIdentityAdapter` verified LINE → controlled resolver → privacy。
  隨後以新的 runtime transaction 呼叫 SQL；SQL **再次**檢查 active person、未 revoked identity、
  active identity interaction channel、approved application、current required privacy acceptance。
  不依賴 adapter snapshot，也不用 `requestPersonContext` 當可信身份。
- 每次需有效 request UUID、空 person/principal context。SQL 函式採固定
  `search_path=pg_catalog`、`row_security=on`、`SECURITY DEFINER`。
- 專屬 `qigong_venue_history_reader`：NOLOGIN/NOINHERIT/NOBYPASSRLS/非 superuser，
  非任何 table owner、沒有 role membership、不重用 QR writer。不擴大 admin scope/policy。
- 最小欄位 SELECT：attendance 只有 `id/person_id/field_id/checkin_at/attendance_date/attendance_timezone`；
  fields 只有 `id/code/name_zh_tw`。沒有直接 identity 表 SELECT。
- `platform.venue_history_context` 是短暫授權 slot，鍵為 backend pid + transaction xid8，
  僅存 SQL 重新驗證得到的 person。不是 session、ledger 或資料快照；成功後刪除，失敗由 transaction rollback。
  table owner 是 migration owner，不是 reader；FORCE RLS。runtime/PUBLIC 無任何 context 存取權。
- RLS 透過不可供 runtime execute 的 `platform.venue_history_person()` 讀受保護 slot，
  attendance 只准該 person；fields 只准本人 attendance 所參照場地。偽造任何 custom GUC
  不會產生 slot，不會通過 RLS；runtime 也無法 SET ROLE reader。
- 新函式清除 PUBLIC/任意 default function ACL；僅 main function 給 API runtime EXECUTE，
  worker/session login 不直接取得 EXECUTE；撤除 PUBLIC/runtime attendance/fields 表存取。

**既有 trust model 的限制必須保留**：SQL 的 subject 是 server-owned verified input，不是 credential。
具任意 runtime SQL execution 能力的攻擊者仍可直接呼叫 main function 並指定另一有效 LINE subject；
本設計不是 DB 層 LINE JWT verifier，也不宣稱抵抗已攻陷 server/任意 SQL execution。
受保護 context 防的是直接表存取與偽造 GUC 繞過 RLS；HTTP strict schema + backend verifier
防的是用戶自行指定 person/subject。read transaction 重驗不等於將讀取與並行管理撤銷全序列化。

## 驗證

Node 24、既有 PG17；可 `pnpm install --frozen-lockfile --ignore-scripts`，不更動 lock。
`packages/database/tests/venue-history-postgres.test.ts` 自行建立全新
`/tmp/venue-history-*`、0700 目錄、marker guard、Unix socket、空 listen_addresses 的 PG17 cluster；
不用 TEST_DATABASE_URL/DATABASE_URL、不讀 .env、不連任何既有 DB。
所有 fixtures 為合成資料，沿用 `venue-qr-synthetic.sql` 再加第二合成學員/歷史列。
結束核對 marker、owner/mode、postmaster data/socket/port 後停止並清理自己的 cluster。
缺少指定本地 PG17 tools 時測試失敗，不會悄悄連別的 DB 或假稱已驗證。

```sh
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@17/bin:$PATH
# 55 項 HTTP/adapter tests；17 項實際 PG tests，含完整 52 migrations 與重跑無新增 migration
pnpm --filter @qigong/public-api exec vitest run tests/venue-history.test.ts
env -u TEST_DATABASE_URL -u DATABASE_URL -u PGOPTIONS -u PGSERVICE -u PGSERVICEFILE \
  pnpm --filter @qigong/database exec vitest run tests/venue-history-postgres.test.ts
pnpm typecheck
pnpm exec tsc -p tsconfig.eslint.json --noEmit # 全 source + tests
pnpm build # 全量測試前先建立 workspace package exports 的 dist
pnpm exec eslint apps/public-api/src/venue-history.ts apps/public-api/tests/venue-history.test.ts packages/database/tests/venue-history-postgres.test.ts
pnpm exec tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck apps/public-api/tests/venue-history.test.ts packages/database/tests/venue-history-postgres.test.ts
pnpm exec prettier --check apps/public-api/src/venue-history.ts apps/public-api/tests/venue-history.test.ts packages/database/tests/venue-history-postgres.test.ts docs/architecture/venue-personal-history-v1.md
env -u TEST_DATABASE_URL -u DATABASE_URL -u PGOPTIONS -u PGSERVICE -u PGSERVICEFILE pnpm -r --no-bail test
git diff --check
```

SQL 無配置 formatter；不手動套用第三方格式器，完整 migration chain 已由 PG17 parser/engine 真實執行。
首次 PG harness 測試發現 macOS `/tmp` realpath 差異，修正為核對兩種等價路徑；
下一輪 fixture 發現既有 suspension/revocation 須先關閉 channel、rejected application 約束，
依既有正規約束修正測試資料後 17 項全過，沒有放寬 production 約束。
scoped lint 發現 mock unused arguments，修正為實際參數斷言後通過。

### 最終本地結果與整合阻擋

- Node `v24.22.1`、PostgreSQL `17.11`；新增 55 HTTP/adapter + 17 real-PG tests 全過。
- `pnpm typecheck`、`tsc -p tsconfig.eslint.json --noEmit`（全 source/tests）、build、
  scoped ESLint、嚴格新 tests typecheck、Prettier、diff check 通過。
- 全量測試：config 2 passed、identity 6 passed、database 235 passed / 310 skipped / **1 failed**、
  public-api 2003 passed / 255 skipped；合計 **2246 passed、565 skipped、1 failed**。
- 唯一失敗為 `packages/database/tests/venue-renumber-integration.test.ts:16` 固定要求
  51 migrations，現在正確為 52。該檔不在核准 5 檔範圍，未修改或隱藏失敗；
  父代理需連同 readiness、既有 repository/QR PG migration expectations 一起整合更新。
- skipped 是未提供既有 DB URL 的歷史套件測試，不表示已通過；本批新的 PG17 suite
  不依賴 DB URL、無 skip，確實自行啟動合成 cluster 並執行完整 52 migrations。
- 首次全量測試與 build 平行導致舊測試 import config/dist 時尚未產生 build output；
  build 完成後以 `--no-bail` 全套重跑，僅剩上述 51→52 靜態預期失敗。
- 沒有可用的結構 hook 或跨模型安全 review；正式審查、接線、readiness 與發布仍待父代理。
