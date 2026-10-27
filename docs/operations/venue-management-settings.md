# 團練場場地設定與 NFC／QR URL 管理（0053）

> 整合狀態更新：已在本地 integration branch 接上主程式，**尚未上線**。最新 54-chain、路由／開關、驗證與限制見[整合交接](./venue-history-admin-integration.md)。以下保留原 standalone 分支的交付／驗證紀錄；「未接線」、52 檔 migration 或舊失敗數字均屬該歷史範圍，不是目前整合狀態。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 交付與邊界

- Base: `origin/main@56284208942acb182651c02983011f80b8921a47`。
- 新增且獨占 `migrations/0053_venue_management.sql`。開工已 fetch origin/main，未發現遠端 0053 衝突。
- 沒有 0052 檔案，沒有虛造或修改 personal history；實際 PostgreSQL 測的是完整可見的 0001–0051 加 0053（52 檔），不是完整未合併功能鏈的證明。
- 不改 `app.ts`、`admin-auth.ts`、`index.ts`、既有 migration、其他代理檔案、package／lock。沒有部署、push、merge 或修改外部設定。
- 新路由模組未被任何 production entrypoint 匯入；`enabled` 預設 false，連路由都不註冊。父代理最後完成安全審查／掛載，並重新跑含真正 0052／0054 的完整鏈。

## 真正可用

注入既有私有 session／CSRF 邊界並明確掛載後，可以使用真實 PostgreSQL：

- 建立（系統產生 UUID）、區域清單、單筆查詢、完整更新及停用／再啟用；**沒有刪除 API**。
- 永久唯一場地 code，改名不改 URL；停用後無法重用。資料庫 trigger 阻止更換 UUID／code 及刪除場地，即使沒有出席也不刪除。
- 名稱、中英名稱、區域、地址、經緯度、半徑、IANA timezone、每週星期／同日時窗、active。
- 每次寫入必填 reason；更新必填 version。資料列鎖、同場地 advisory lock 及更新後 version+1。audit 記錄原因、前後完整場地設定與版本。失敗寫入不留下部分更新／成功 audit。
- 既有區域 `checkin.read` 或 `venue_attendance.field.read` 可讀；寫入**只接受** `venue_attendance.field.manage`，並使用 0050 的 active operational／country／global 檢查。沒有自動授權任何既有角色；一般 regional_viewer 不能建立或修改。
- 更新先以來源 region + UUID 找到並鎖定真實場地；移動再檢查目標 region 權限。已有出席的場地禁止修改 region／timezone。可改位置／時段，但必須有 audit reason 並通過版本檢查。
- UI 透過 DOM textContent／value 顯示名稱，沒有 API 字串 innerHTML。唯讀者仍可檢視網址；儲存失敗誠實顯示未儲存，未接線會顯示 404／503 而非模擬成功。
- URL 固定為 `https://<trusted-origin>/venue-checkin?venue=<code>&source=nfc`，另有 `qr`、`link`。伺服器的 publicOrigin 必須是 exact HTTPS origin（不能有路徑、userinfo、query）。不使用 Host、forwarded headers 或使用者輸入 redirect host。
- 複製 NFC／QR 目標／一般 URL；剪貼簿不可用時提供手動選取。可列印目前選取場地牌（名稱、代碼、啟停、網址、公司署名）。

## SQL／RLS 審查注意（必須由父代理核准）

這是結構性權限變更，尚未掛載／部署；本環境沒有可呼叫的 `allow_tool: false` 安全 hook，不能宣稱已通過該 hook。

- 新函式 owner：`qigong_venue_manager`、`qigong_venue_config_guard`，皆新建 NOLOGIN／NOINHERIT／NOSUPERUSER／NOBYPASSRLS，沒有角色 membership，也不擁有表。
- 保留兩表 ENABLE + FORCE RLS。沒有 runtime／session 直接表 grant，沒有 attendance INSERT／UPDATE／DELETE grant。
- **唯一調整的既有 policy** 是 0051 的 `venue_fields_no_update`：原本 PUBLIC 全拒，改為只放行 `current_user='qigong_venue_manager'`；其他既有／未來（含 0052）角色仍被拒。新管理角色另有 source／target scope permissive policy。沒有廣泛移除 PUBLIC veto 或將既有角色加入可寫清單。
- 0051 的場地 DELETE、出席 UPDATE／DELETE restrictive veto 保持原樣；0051 QR reader／writer policies 不變。新增 existence-only attendance SELECT 只 grant `field_id`：guard 用於檢查是否已有出席；manager 因 0051 invoker validation trigger 需要，仍限於其可見場地。不授予學員姓名／person_id／GPS 等欄位。
- Guard trigger 在 field UPDATE 及 attendance INSERT 使用相同 advisory lock，保護首次出席與 region／timezone 修改交錯；INSERT 再檢查當前啟用狀態、timezone／當地日期。guard 不回傳學員資料，也不更新任何 attendance。
- API 每操作用真正 session token 查 principal 並在同一交易設定 context；函式再次比對 session。寫入等待鎖後再次查 session、wall-clock expiry 及來源／目標管理 grant 的 wall-clock validity（不只依賴 transaction timestamp）。
- 全部新函式固定 `search_path=pg_catalog`；SECURITY DEFINER 固定 row_security=on。清除 PUBLIC 與可能的 default function ACL，再只 grant 指定 runtime 函式。trigger function 不向 runtime 開放。
- 0051 原 QR function 沒有被重寫。管理員間 optimistic concurrency 已測；本交付**沒有宣稱**把既有 QR 讀取中心／時窗到寫入出席的整段邏輯改成同一個場地 row-lock snapshot。若父代理要保證「設定更新期間所有進行中的 QR 一律套用新位置／時窗」，需要另審 QR transaction 鎖契約；不可用本測試當成該性質的證明。

## Exports 與父代理接線

`apps/public-api/src/venue-management.ts`：

- `venueManagementFieldSchema`、`venueManagementRowSchema`、`venueManagementOperationSchema` 與對應 types。
- `runVenueManagement(pool, requestId, sessionToken, operation)`：僅 session 解析身分，不收 principal。
- `trustedVenueOrigin(value)`、`venueManagementUrls(code, publicOrigin)`。
- `lookupManagedVenue(pool, requestId, code)`：透過受控 runtime 函式回傳 `null | {code,name,active}`，不開放任意表 SELECT。

SQL 函式：

- `admin.venue_management(text,text,uuid,uuid,integer,jsonb,text)`。
- `admin.venue_management_lookup(text)`。
- `core.guard_venue_management()`：只供 trigger。

`apps/public-api/src/venue-management-routes.ts`：

- `registerVenueManagementRoutes(app, pool, options)`、`VenueManagementRouteOptions`、`venueManagementError`。
- options：`enabled: true`（預設不開）、server-trusted `publicOrigin`、可選不同的 exact `adminOrigin`、`sessionFor`、`validCsrf`、`principalFor`。
- 父代理應在既有 feature gate 內明確掛載；不可直接打開舊 NFC／其他出席寫入能力。
- `sessionFor` 必須在 `admin-auth` 私有 cookie 邊界取 `__Host-qigong-admin`，拒絕缺漏／重複／非 43 字元 base64url；絕不可讀 body/query 的 token 或 principal。
- `validCsrf` 每 POST 重新檢查唯一 `__Host-qigong-admin-csrf` cookie 與唯一 header，43 字元 base64url，用既有 timing-safe digest 比較；路由另檢查 exact trusted admin Origin。讀取／capabilities 也走 POST + CSRF。
- `principalFor` 只供 HTML 入口，必須使用既有 fresh session lookup；API 不信任其 principal，會自己重新驗證。
- Fastify request ID 必須沿既有 app 設定使用 UUID；資料庫 request-context 會拒絕其他格式。

Routes：

- `GET /admin/venue-management`（HTML）。
- `POST /admin/api/venue-management/{capabilities,list,get,create,update}`。
- 共用 body `regionId`；get 加 `id`；create 加 `field,reason`；update 加 `id,version,field,reason`。不要在 body 放 action、principal 或其他額外欄位；嚴格拒絕。
- field snake_case schema 如上，name_en 必須為 string 或 null，address 必須提供（可空字串）。時窗 HH:mm，結束可 24:00，結束必須大於開始。
- 成功：capabilities `{canRead:true,canManage:boolean}`；list `{fields:[row+urls]}`；其他 `{field:row+urls}`。create 201，其餘 200；400 格式、401 session、403 scope／CSRF、404 找不到、409 code／version／已出席凍結衝突、503 backend。
- 舊 `/admin/fields` renderer／路由維持原狀；父代理需自行決定導覽至新頁或整合舊入口，避免同 path 重複註冊。本分支不修改導覽或假稱舊頁已接上新 CRUD。

`apps/public-api/src/venue-management-page.ts`：`renderVenueManagementPage(locale?)`。頁面先輸入 operational region UUID 再查詢；尚未提供區域名稱下拉選單。

### 停用舊網址

父代理可信 public `/venue-checkin` lookup 應呼叫 `lookupManagedVenue`：

- null：顯示場地不存在，不嘗試簽到。
- active=false：顯示「場地已停用」，保留名稱／代碼；不得轉址至任意 caller host。
- active=true：沿既有可信 LINE／GPS／consent 寫入流程，URL 本身不是出席資格。

目前此公開頁接線**未完成**；SQL 寫入仍會拒絕 inactive。不能把 admin 預覽網址／source 當作驗證成功。

## QR 依賴缺口

目前 manifest／lock 沒有可信本地 QR 編碼器。**沒有 QR 圖片產生、下載或第三方 QR 呼叫**，也沒有自製未驗證編碼器。若要實際 QR 圖片／PNG／SVG 下載，須另取得新增套件及 lock 變更的人類批准，再審查固定版本、授權、純本地編碼與測試；例如可評估 `qrcode`，但本交付沒有安裝或預先批准它。

## 驗證

Node 24，`pnpm install --frozen-lockfile --offline`，沒有改 lock 或下載依賴。先 build workspace config／database／identity 以解析既有 package exports。

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm lint
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm typecheck
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm exec tsc -p tsconfig.eslint.json --noEmit
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm --filter @qigong/public-api test
PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@17/bin:$PATH \
  bash apps/public-api/tests/venue-management-local-pg.sh
```

專屬 harness 只建立新的 `/tmp/venue-management-*` 0700 cluster，Unix socket only、listen_addresses 空、host auth reject，合成資料；trap 關閉並刪除自己建立的 cluster。不讀 dotenv、不使用現有 DB URL、不接 production／手機 DB。專屬 PG 測試只有在 marker 與目錄權限正確時啟動；完整執行所有當下可見 migrations（不是 SQL mock）。

- 專屬單元／DOM／拒絕路由測試 18 個。
- 真實 PG 整合 11 個：CRUD、code 停用不重用、UUID/code 不可改、XSS 字串保存、稽核、既有 viewer 唯讀、來源／目標區域、競爭版本、出席保留／凍結、HTTP CSRF／Origin／duplicate cookie、URL、鎖等待後 session／grant 到期、首次出席與時區修改競爭、0051 QR 寫入回歸。
- `public-api` 全套需每批獨立跑（workspace test 在 database 失敗後可能不再執行它）。
- 全倉 `pnpm test` 的已知阻塞：既有 `packages/database/tests/venue-renumber-integration.test.ts` 把 migration 數量寫死為 51；此分支實際 52，該測試失敗。不在允許修改範圍，因此未改，**不能宣稱全倉全綠**。父代理應整合新 migration 後修正這個歷史數量斷言；真正 0052／0054 全鏈也必須重驗。既有 `venue-qr-postgres.test.ts` 亦有 51／0051 尾端假設，整合後應更新再跑，而非據此跳過安全驗證。

Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
