# NFC 第二階段：第一批資料庫隔離

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 狀態與邊界

基於 `6ced05a`，本批只有 forward migration `0048`、靜態契約測試與本文件。
**尚未執行 migration、連接資料庫、推送或部署；不是端到端完成。**
沒有修改 `0047`、API、身份驗證、日課、功法、依賴或環境設定；NFC gate 仍預設關閉。

`0047` 建立的 `core.practice_fields` / `core.field_attendance` 沒有 RLS。
既有 field check-in route 接受客戶端 `personId`、`volunteerPersonId`、`checkinId`，
service 直接使用 pool，不能當成可信身份或操作授權。
本批選擇封鎖資料庫入口，而不是給這些 API 增加 GRANT。

## 0048 安全策略（待隔離 PostgreSQL 驗證）

- 兩表均 ENABLE / FORCE RLS；非 superuser、非 BYPASSRLS 的普通 owner 也受 RLS 約束。
- 兩個 `AS RESTRICTIVE FOR ALL TO PUBLIC USING (FALSE) WITH CHECK (FALSE)` policy
  隔離全部讀寫；既有或意外新增的 permissive policy 不能放行。
- 撤銷 PUBLIC、API runtime、worker runtime、authorizer 的全部表權限。
- 掃描兩表現存 ACL，撤銷其他非 owner 的直接表權限及欄位權限，包含 session login、
  PUBLIC 欄位 grant、default ACL 已產生的授權及其 dependent grants（CASCADE）。
  不更動全域 default privileges 或其他資料表。
- 若兩表 owner 是受控 runtime / authorizer，整個 migration 失敗，由既有 runner rollback；
  不把資料表交給 runtime，也不變更角色 membership / BYPASSRLS。
- migration 使用 transaction-local `search_path = pg_catalog`；catalog、table 與函式引用
  schema-qualified，動態識別字以 `%I` / `quote_ident` 引用。
- 不新增 function、EXECUTE grant、session / owner 特例或 permissive policy。
  未來若要開放 controlled function，必須另審固定 search_path、schema qualification、
  非 runtime owner、明確 REVOKE PUBLIC / 最小 EXECUTE，以及 function 自身的身份與授權檢查。
- 無論 GUC 中的 person / principal、客戶端 volunteer ID、region scope 或 checkin ID 為何，
  都不構成放行條件。**目前是拒絕全部存取，不是已實作細分 region / ownership 授權。**
- 不新增 attendance 與日課的連結，不新增或改寫功法／日課；既有資料也不回填或清除。

RLS 不限制 superuser / BYPASSRLS，也不能阻止有 DDL 權限的管理者改掉 policy；
owner 固有的 DDL / TRUNCATE 權限並未消失。既有 FK referential actions 亦不是本批新增的存取路徑。
服務仍必須使用既有 NOINHERIT、無 ownership / direct ACL 的 session login，
通過 `checkApiRuntimePreflight` 後以 `withRequestContext` 切換非 owner runtime。
本批沒有證明任何實際環境符合上述角色條件。

## 不可直接部署的相容性阻擋

目前 `apps/public-api/src/admin-auth.ts` 的 `nfcMigrationVersion` 及 app 的 maximum migration
仍為 `0047_practice_fields_and_nfc_attendance.sql`。
**執行 0048 後，現版 `/health/ready` 會以 `schema_version_mismatch` 拒絕，即使 NFC gate 關閉。**
若 NFC gate 意外開啟，schema readiness 亦不能通過版本／SELECT 權限探測。

這是刻意保留、尚未解除的發布阻擋，不代表可直接把 migration 發到現有服務。
後續批次必須先完成安全 review、隔離 DB 證據及新版 readiness 的相容性處理；
不得刪除 quarantine、放寬 GRANT 或單純把 gate 開啟以修復 readiness。
本執行介面沒有可呼叫的 `allow_tool: false` hook；本機 commit 不代替結構安全審核或部署核准。

## 本地驗證結果

所有執行的測試均為純函式、mock 或靜態契約，沒有執行 PostgreSQL 測試或 migration。

| 命令                                                                                                                                                                                                                           | 結果                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @qigong/database exec vitest run tests/nfc-security-quarantine.test.ts tests/field-attendance-schema.test.ts`                                                                                                   | 54 passed（19 新契約、35 既有 schema）                                                                                                          |
| `pnpm --filter @qigong/public-api exec vitest run tests/field-checkin.test.ts tests/health.test.ts`                                                                                                                            | 58 passed；既有成功 mock 不代表舊 API 已可信                                                                                                    |
| `pnpm typecheck`                                                                                                                                                                                                               | 四個 workspace package 通過                                                                                                                     |
| `pnpm exec tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck packages/database/tests/nfc-security-quarantine.test.ts` | 新測試檔 strict typecheck 通過                                                                                                                  |
| `pnpm exec eslint packages/database/tests/nfc-security-quarantine.test.ts`                                                                                                                                                     | 通過                                                                                                                                            |
| `pnpm exec prettier --check packages/database/tests/nfc-security-quarantine.test.ts docs/operations/nfc-security-quarantine.md`                                                                                                | 通過；TS / Markdown 由既有 Prettier 格式化                                                                                                      |
| `pnpm exec tsc -p tsconfig.eslint.json --noEmit`                                                                                                                                                                               | 不通過；未修改的 `admin-branding.test.ts` 缺 fieldSchedule / attendance，`field-checkin.test.ts` 的 Fastify / pg mocks 型別不符；本批不擴大修復 |

曾在初始 REVOKE 增加 CASCADE 後，契約的舊精確字串失敗 1 項；同步契約後全部通過（1 輪修復）。
目前 Node 為 `v26.10.0`，專案要求 Node 24，pnpm 有 engine warning；須於 Node 24 再驗證。
既有 Prettier 對 SQL 的 `inferredParser` 為 null；未安裝 formatter 或假稱 SQL 已格式化／解析。
靜態契約包含移除 FORCE / ENABLE、偽造身份例外、跨區例外、未驗證 checkin link、
追加 GRANT / definer / 日課更新、移除表／欄位 ACL 清理及 owner 檢查的負向 mutation。
這些只保護 migration 文字形狀，**不證明 SQL 能執行或真實 RLS / ACL 行為**。

## 後續批次（仍需完成）

1. **可信身份與 privacy**：沿用 `line-profile.ts` 的 server-side LINE verification、既有
   credential / privacy gate 及有效 identity / interaction channel 模型，確認使用者資格、
   撤銷與政策同意。不得從 body / query / header 的 person ID 設定 request context。
   本次沒有呼叫 LINE 或其他外部 API。
2. **受控操作**：learner self-checkin 身份由已驗證 credential 導出；manual volunteer 身份
   由 authenticated admin session 導出，服務端檢查操作 permission、有效 grant 與場地 region。
   沿用 `admin.can_access_region` 等既有模型，不使用 `can_access_person` 的 self-read 分支當寫入授權。
   場地管理、出席讀取、CSV export 各自檢查 action / scope；不因登入或 self identity 自動取得權限。
3. **一致性與最小資料**：開放存取前驗證 field operational region、learner / volunteer scope、
   歷史 region 可見性與 checkin owner 一致性；GPS / student note / 匯出另處理最小揭露及 consent。
   目前 quarantine 禁止所有地區與 checkin link 存取，但沒有新增一致性 constraint，也沒有清查舊資料。
4. **產品決策**：團練 attendance 是否計入日課、使用何種功法尚未決定。
   維持 attendance 獨立／不影響日課；不得自行捏造功法。
   若未來決定開放日課連結，必須先加入同 person 的 ownership 防線及負向測試。
5. **真實隔離 DB 與發布**：只有明確證明可拋棄且隔離的本機 PostgreSQL 才可執行。
   測試 upgrade / rollback、原有資料保留、PUBLIC／direct session／role membership／column grants、
   普通 owner FORCE、missing / forged context、跨區、錯誤 volunteer / checkin owner、pool context cleanup
   與 SQL search_path shadowing；確認 pg_catalog 的 ACL 清理及 CASCADE 語意。
   再審核是否逐項替換 quarantine、增加最小 EXECUTE、更新 migration readiness。
   在此之前保持 gate 關閉，不宣稱端到端完成。
