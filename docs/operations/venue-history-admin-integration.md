# 團練場出席管理／我的團練紀錄：本地整合交接

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 狀態：已本地接線，尚未上線

- Integration branch：`feature/venue-history-admin-integration`。
- Base：`origin/main@56284208942acb182651c02983011f80b8921a47`；fetch 後仍相同，沒有 migration 編號衝突。
- 本文件的已驗證 source/test head：`24761de`；文件提交的最終 HEAD 由交接回覆提供，避免文件自引用。
- 原 `feature/venue-attendance-qr` 保持 `74b979ebb197832d88519e18d22c9a7a68047721`，未改寫。
- 只本地 cherry-pick、source/tests/docs commits；未 push、開 PR、遠端 merge、部署或重啟 runtime。
- 沒有 SSH／DO、正式或手機 DB、LINE 外部 API／Console／Rich Menu／webhook 設定操作。
- 沒有修改 package／lock、CI、全域設定，沒有新依賴。0047–0051 檔名與 bytes 相對 base 完全不變。
- 0052、0053 保留交付內容；**尚未發布的 0054** 另補 default function ACL 清理，沒有修改已發布 checksum。

## 原分支與逐 commit 接收

全部以 `git cherry-pick -x` 保留原始來源；沒有整支一次大批 merge，也沒有撿入非交付 commits。

| 交付分支 tip                  | 原 commit → integration commit                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| history backend `bb8807a`     | `bb8807a` → `8c33622`                                                                                             |
| history frontend `4cece2a`    | `4cece2a` → `046235e`                                                                                             |
| management settings `534bead` | `ee2f729` → `6f7c216`；`4933194` → `d7ee10c`；`534bead` → `88c4fae`                                               |
| management people `e191af3`   | `5729b84` → `f9a4fd0`；`3d74afc` → `3f38eb1`；`fb7ef9b` → `beadc3d`；`9c9f3d4` → `094b091`；`e191af3` → `9d852ec` |

Settings 與 people 的原 PG tests 各有一次 cherry-pick 衝突：保留上游新測試，同時保留父分支已修正的完整 migration chain 斷言；沒有選整檔 ours/theirs 丟掉測試。

### 每批檔案清單

以下縮寫只為可讀性：`S=apps/public-api/src/`、`T=apps/public-api/tests/`、`D=packages/database/tests/`、`M=migrations/`、`O=docs/operations/`、`A=docs/architecture/`。每個 commit/batch 均不超過 5 檔；逐批檢查 formatter（適用檔案）與相關測試，失敗修正後才前進。

| Commit          | 檔案（完整 prefix 依上列）                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `8c33622`（5）  | S/venue-history.ts；T/venue-history.test.ts；A/venue-personal-history-v1.md；M/0052_venue_personal_history.sql；D/venue-history-postgres.test.ts                          |
| `046235e`（4）  | S/line-venue-checkin-page.ts；S/line-venue-history-page.ts；T/line-venue-history.test.ts；O/line-venue-history.md                                                         |
| `6f7c216`（4）  | S/venue-management.ts；T/venue-management-local-pg.sh；T/venue-management-postgres.test.ts；M/0053_venue_management.sql                                                   |
| `6d1b0da`（1）  | T/venue-management-postgres.test.ts                                                                                                                                       |
| `d7ee10c`（3）  | S/venue-management-page.ts；S/venue-management-routes.ts；T/venue-management.test.ts                                                                                      |
| `88c4fae`（5）  | S/venue-management-page.ts；T/venue-management-postgres.test.ts；T/venue-management.test.ts；O/venue-management-settings.md；M/0053_venue_management.sql                  |
| `f9a4fd0`（4）  | S/venue-people-helpers.ts；S/venue-people-service.ts；T/venue-people-helpers.test.ts；M/0054_venue_people_read.sql                                                        |
| `3f38eb1`（3）  | T/fixtures/venue-people-synthetic.sql；T/venue-people-local-pg.sh；T/venue-people-postgres.test.ts                                                                        |
| `b5d8921`（1）  | T/venue-people-postgres.test.ts                                                                                                                                           |
| `beadc3d`（5）  | S/venue-people-page.ts；S/venue-people-routes.ts；T/venue-people-http.test.ts；T/venue-people-page.test.ts；T/venue-people-postgres.test.ts                               |
| `094b091`（4）  | S/venue-people-helpers.ts；T/venue-people-helpers.test.ts；T/venue-people-postgres.test.ts；A/venue-people-admin-v1.md                                                    |
| `a4ea260`（1）  | T/venue-people-postgres.test.ts                                                                                                                                           |
| `9d852ec`（1）  | A/venue-people-admin-v1.md                                                                                                                                                |
| `021b6d1`（5）  | D/isolated-venue-roles.setup.ts；D/repository-migrations.test.ts；D/venue-history-postgres.test.ts；D/venue-renumber-integration.test.ts；T/venue-qr-postgres.test.ts     |
| `6f5f1b3`（2）  | S/venue-suite.ts；T/venue-suite.test.ts                                                                                                                                   |
| `098f057`（5）  | S/app.ts；S/admin-auth.ts；S/line-onboarding.ts；S/line-venue-checkin-page.ts；T/line-venue-history.test.ts                                                               |
| `2afd179`（5）  | S/index.ts；S/admin-auth.ts；S/admin-dashboard.ts；S/venue-people-page.ts；T/venue-suite-integration.test.ts                                                              |
| `0909ad7`（3）  | S/app.ts；S/venue-entry.ts；T/venue-suite-integration.test.ts                                                                                                             |
| `88cb639`（5）  | T/venue-management-postgres.test.ts；T/venue-people-postgres.test.ts；T/venue-qr-postgres.test.ts；D/venue-history-postgres.test.ts；scripts/test-venue-suite-local-pg.sh |
| `5340462`（2）  | S/admin-dashboard.ts；T/admin-navigation.test.ts                                                                                                                          |
| `bcda57e`（2）  | M/0054_venue_people_read.sql；T/venue-people-postgres.test.ts                                                                                                             |
| `24761de`（2）  | T/startup-log-privacy.test.ts；T/venue-management-postgres.test.ts                                                                                                        |
| 本文件批次（5） | O/venue-history-admin-integration.md；A/venue-personal-history-v1.md；O/line-venue-history.md；O/venue-management-settings.md；A/venue-people-admin-v1.md                 |

## 真實路由與現有 exports 接線

- `app.ts` 明確使用 `registerVenueHistoryRoutes`，只傳 server-owned origin、LINE login channel 與既有受控 verifier。沒有虛構 repository export 或把 identity selector 當憑證。
- `line-onboarding.ts` 在普通 workspace／venue preview 前辨識 history；direct `/line/venue-history` 與 primary `/line/?liff.state=<encoded /venue-history?...>` 使用原 renderer／login helper，SDK 仍掌握 primary redirect。月份、場地、頁次、語系登入回跳保留；非法輸入 400，關閉功能時 503 安全頁、無 SDK。
- `POST /api/line/venue-history` 只在 history opt-in 時掛載；strict JSON、精確 Origin、自訂 header、完整 LINE verifier、resolver／privacy、SQL 內重驗。只讀本人跨場／跨國歷史，不受 home-region 或 admin scope 侷限；不得傳 personId/subject/principal。
- QR 成功頁只有 **QR 與 history 均明確啟用** 才包含隱藏紀錄連結；真實簽到成功驗證後才顯示。日課按鈕保留，沒有隱含建立日課。
- `admin-auth.ts` 私有 closure 掛載 `registerVenueManagementRoutes`、`registerVenuePeopleRoutes` 與 `createVenuePeopleService`。使用唯一 43-char session cookie；不把 principal UUID 當 session，不把 session 放 HTML／URL。
- Settings：`GET /admin/venue-management`；`POST /admin/api/venue-management/{capabilities,list,get,create,update}`。每次 body strict、私有 session、CSRF、可信 admin Origin，讀寫均由受控 SQL 重驗 action + region。
- People：`GET /admin/venue-people`；`POST /admin/venue-people/api/{read,export}`。read 沿現有 `checkin.read` 可看姓名，沒有 k5／另加姓名權限；export 只驗獨立 `stats.export`，不從 view 推導。
- `GET /admin/api/venue-suite` 驗 fresh session 後只回功能開關，不回學員資料／權限承諾。既有 admin shell 動態顯示各已啟用功能的空殼入口；真正資料逐次授權，不依賴導覽可見性。
- 管理 write 必須既有 `venue_attendance.field.manage` + source/target region scope；既有 viewer 仍不能寫。沒有自動新 grant／view → write 升權。
- `venue-entry.ts` 在 management 啟用時使用現有 `lookupManagedVenue`：可信名稱 escaping；停用 410、不存在 404、失敗 503，不跳轉到 LINE。關閉 management 時仍為原「未驗證」入口，不假冒查詢成功。
- People page 保留原 hash CSP；標題統一「團練場出席管理 · 人員與出席紀錄」。人工補簽／作廢 API 未掛載，舊 NFC 仍 quarantine，沒有開出可用補簽 transport。

## 獨立配置與 readiness

所有 boolean 都沿 `index.ts` 的嚴格 `true|false` parser，預設 false；只是設定，不代表發布核准。

| 功能           | 開關                       | 開啟時必要 origin／配置                                                                                |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| QR             | `VENUE_QR_CHECKIN_ENABLED` | `VENUE_QR_PUBLIC_ORIGIN`、既有完整 LINE config                                                         |
| 本人歷史       | `VENUE_HISTORY_ENABLED`    | `VENUE_HISTORY_PUBLIC_ORIGIN`、既有完整 LINE config                                                    |
| 場地管理       | `VENUE_MANAGEMENT_ENABLED` | `VENUE_MANAGEMENT_PUBLIC_ORIGIN`（公開入口 URL）；admin Origin 從既有 OIDC callback server config 取得 |
| 人員讀取／匯出 | `VENUE_PEOPLE_ENABLED`     | `VENUE_PEOPLE_PUBLIC_ORIGIN` 必須等於既有 OIDC callback Origin；必須配置 admin auth                    |

Origins 必須 exact HTTPS origin，無 userinfo／path／trailing slash；不讀 Host 或 forwarded host。

- 新功能預設不啟用；舊 daily／preview compatibility 仍保留原 0042–0051 精確清單，並加入精確 `0054_venue_people_read.sql`。
- QR 能相容精確已發布 0051 與完整 0054；不是任意數字上限。0052／0053 過渡 schema 或同號未知 filename 都不 ready。
- 任一 history／management／people 啟用，都要求精確 0054 與 54 筆 migration，再**各自**以 runtime/catalog 驗 function 簽名／EXECUTE、固定 owner、SECURITY DEFINER、固定 search_path／row_security、新角色無 login/inherit/bypass/membership/表 ownership、相關表 FORCE RLS。缺少證據即不 ready；不是只抬上限。
- 啟用的新功能在 Fastify `onReady` 再驗證，無法跳過 startup/readiness 直接服務資料路由。`/health/ready` 同樣使用全部已啟用配置。
- `NFC_FIELD_CHECKIN_ENABLED` 必須維持未設定／false；沒有任何 migration 能讓舊 NFC flow ready。

## SQL／角色交互覆核

- history reader、manager、config guard、people reader 四個新專屬 owner 無 membership／table ownership／BYPASSRLS；API runtime 沒有新增任意表 SELECT。0052 history transaction slot 不由用戶 GUC 建立；0054 restrictive region/action policies 不擴大 0052 self scope。
- 0053 唯一調整 0051 field UPDATE restrictive veto，僅放行專屬 manager，另有管理 scope policy；attendance UPDATE/DELETE、field DELETE veto 保留。已有 attendance 的 region/timezone 不可改；初次 attendance 與設定更新同 advisory lock。位置／時窗的 in-flight QR snapshot 限制仍如原 settings 文件，未冒稱完整序列化所有 QR 驗證步驟。
- 0052／0053／0054 新函式均清掉任意 default EXECUTE ACL，再明確給 runtime；新 PG 對抗 fixture 事先設任意 default function grant，確認四個公開受控函式不繼承該 grant。
- 0051 原始 GPS 寫入仍 NULL、不改日課；合成 QR 回歸真實驗證。
- `isolated-venue-roles.setup.ts` 只擴充固定 allowlist：qr writer/reader、history reader、manager、config guard、people reader。保留 preexisting OID、仍被任何 database／membership 引用者；沒有 DROP OWNED／CASCADE 清除物件，沒有對不明 cluster 開 teardown。
- 沒有可呼叫的 `allow_tool: false` veto hook，本輪**不能宣稱已觸發／通過**。這是本地父代理檢查與測試，不是獨立 security review。

## 驗證與精確 skips

Node `v24.22.1`／PostgreSQL `17.11`。測試命令均清除 inherited DB／PG／NODE preload 等環境，不讀 `.env`。整合 harness 的 cluster 都是新建 0700 `/tmp/venue-suite-*`、專屬 port、Unix socket only、host auth reject、空 listen_addresses；清理核對 marker／owner／mode／pid/data/socket/port，只停止和刪除本次建立的 cluster。

```sh
# 既有工具；不安裝、不連既有 URL。all = focused PG + full verify。
env -i HOME="$HOME" PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin \
  LANG=C LC_ALL=C TZ=UTC bash scripts/test-venue-suite-local-pg.sh
# 可分別執行：...sh focused / ...sh full
```

- 完整 0001–0054 migration fresh chain、重跑無新增、歷史 0046→0047 邊界／renumber 舊檔不存在與 invitation checksum assertions 保留並通過。
- history 專屬 PG **17 passed**；settings 專屬 PG **12 passed**（含真 `buildApp` → 私有 closure → SQL/RLS）；people PG **11 passed**；舊 QR PG **10 passed**。全部跑完整 54 chain，沒有把原 standalone 分支的 52-file 證據冒稱整合證據。
- 真 `buildApp` 涵蓋 direct／primary history、disabled／unknown／transition schema、缺少 capability 證據、strict self-only API、admin session duplicate／CSRF／Origin、view 無寫權、跨區拒絕、export 獨立、fresh session revoke 立即拒絕、可信 lookup 與成功頁 link gate。
- `pnpm verify` 在本次新 disposable `TEST_DATABASE_URL` 上執行：format:check／lint／typecheck／全 tests／build 全過；另 `tsc -p tsconfig.eslint.json --noEmit`（全 source/tests）與 `tsc -p tsconfig.receipt-health.json --noEmit`（receipt CLI）通過。
- 最終 workspace **2996 passed / 43 skipped**（完整重跑已核實）；config 2、identity 6、database 536 / 10 skipped、API 2452 / 33 skipped。33 是 marker 專屬 settings/people/QR tests，已由 focused harness 另跑 **33/33 passed**；不可把它們說成在 generic URL run 執行。
- 另 10 skipped 是原 `venue-attendance-security.test.ts` 明確 `describe.skip` 的 0050 歷史「PENDING」驗證清單，並非新增 skip。沒有刪除／改成 pass／解除其未完成警示；真 0051–0054 suites 提供本輪特定能力證據，但不聲稱覆蓋那 10 項全部廣泛性質。
- 曾修正：standalone migration 數量／fixture delete guard／0053 衝突錯誤碼預期，以及全量測試首次發現的導覽四群組固定預期。每項在下一輪通過；未放寬 production 權限或拿掉 assertions。沒有任何失敗連續超過 3 輪。
- 早期逐原 commit 檢查使用各交付既有 `/tmp/venue-history-*`／`venue-management-*`／`venue-people-pg.*`／`venue-qr-pg.*` 獨立合成 harness；都已清理，沒有使用既有 cluster。最後整合驗證已改用本次要求的 `/tmp/venue-suite-*`。

## PR 摘要與下一步（父先審，不自動 PR）

**建議 PR title：** `feat: integrate learner venue history and scoped venue attendance administration`。

**摘要：** 接通本人團練紀錄 LIFF/API、受 session/CSRF/Origin 保護的場地 CRUD 與人員 read/export；明確預設關閉、完整 54 migrations、獨立 readiness，保留舊 QR、GPS-null、日課與 quarantine 邊界。原分支來源可追溯，無 package/lock 或發布歷史改寫。

仍待：

1. 對 `5628420..HEAD` 做獨立 security review，優先 0052–0054 RLS/ACL、session/Origin、IDOR、撤權／並行邊界；本輪沒有宣稱 cross-family review。
2. PG16 fresh/upgrade/rehearsal 及 production-like default ACL 演練。現有 history 專屬 harness 明確需要本機 Homebrew PG17，**不是 Linux/PG16 CI 已通過證據**；PR 前要核准可攜 harness/CI runner 執行策略，不能以新增 skip 解決。
3. 人工實測官方 LIFF／外部登入、iOS/Android、三語、手機寬度／縮放／讀屏。不得直接套 Rich Menu 或修改 Console。
4. QR 圖片編碼依賴仍未獲批准：目前只有 QR 目標網址／列印文字牌，沒有外部 QR service、假圖或未驗證自製編碼器。新增套件／lock 必須另取得人類批准。
5. 人工補簽／作廢仍 disabled；獨立寫入 permission、actor/idempotency/version/audit 契約通過後才另案接線。
6. 父審後再決定 PR／migration 發布與功能開啟，全部需要後續明確授權，本輪不執行。
