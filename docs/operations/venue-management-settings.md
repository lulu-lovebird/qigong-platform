# 團練場場地設定與 NFC／QR URL 管理（0053）

> **目前 QR 圖片契約見下方「本次 QR 圖片」**；後續地區選單及 standalone 章節保留原交付歷史，舊「沒有 QR 圖片／未接線／失敗數字」不是本次結果。
>
> 原地區選單變更基於 `origin/main@9cfe372054e53d9d33fdce22cf952ac128bb09bb`，只在本地開發／提交，**未部署、未 push、未建立遠端 PR**。下方「本次地區選單」為目前契約；再下方保留原 standalone 分支的歷史紀錄，舊 52／54-chain、「未接線」及舊失敗數字不是本次結果。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 本次 QR 圖片（2026-10-29）

- 精確基底 `40fc26fea98f252786c80e15f52a8fb010e3d304`（schema 58、提前 30 分鐘規則、歷史集點卡）。本次只新增本地 QR 圖片及 WebAdmin UI；沒有 SQL、migration、角色／權限、runtime check-in flag 或 LINE／LIFF 設定變更，沒有 push／merge／部署。
- 已取得新增依賴批准：runtime `qrcode@1.5.4`、dev `@types/qrcode@1.5.6` 及 lockfile。純本地編碼，不呼叫第三方 QR 服務；沒有 SVG 或任意 URL 編碼 endpoint。
- `POST /admin/api/venue-management/qr` 僅收 `{regionId,id}`，嚴格拒絕 query、額外 body 欄位、action、principal、URL／target。沿用唯一 session／CSRF cookies、header、exact trusted admin Origin、same-origin Fetch Metadata guards；每次先以原 `runVenueManagement` 的 `get` 重新驗證 session、讀取權限、scope 及場地，再編碼。具既有讀取權限的 regional viewer 可用，不授予 manage 權限。沿用原 get 的 `venue.management.read` audit（metadata operation=get），沒有新增 write action，也不修改場地或出席。
- 成功回傳 `{field:row+urls,target,pngDataUrl,filename}`。`target` **完全等於**既有 `venueManagementUrls(savedCode, configuredPublicOrigin).qr`，即 `https://<trusted-origin>/venue-checkin?venue=<saved-code>&source=qr`；不從 Host／forwarded／caller URL 取值。PNG 為 768px、黑白、Q error correction、四個 module 白色 quiet zone；target／data URL 有長度上限，檔名固定 `venue-<saved-code>-qr.png`。list／capabilities 不產生圖片，編碼失敗回通用 503，不回傳內部錯誤。
- 操作：選取**已儲存**場地 →「產生選取場地 QR」→ 實際圖片載入並解碼成功後，才啟用「下載 QR PNG」與「列印 A4 QR 場地牌」。預覽及牌面使用儲存快照，未儲存的名稱／時段／半徑不會混入。改選、篩選、重新載入、授權目錄重試、新增／更新均清除圖片；key 包含 region／id／version／code／target，sequence guard 丟棄過期 HTTP／image／decode 結果。
- A4 瀏覽器列印使用實際 QR，顯示名稱、code、時區、團練、提前 30 分鐘打卡時段（含前一天／週日換週與 24:00）、半徑、啟停狀態、精確來源網址及 BBB 公司署名。停用場地可產生，但牌面明示「不能簽到」。只列印牌面，不列印表單、導覽或操作按鈕；QR 不含 logo。
- 只為 `/admin/venue-management` 的既有 CSP 加入 `img-src data:`；其餘指令及其他 admin 頁面保持原狀。前端使用 createElement／textContent、限長 PNG base64 檢查及 exact target 比對，不插入 API innerHTML。
- **掃描仍先進入既有公開 landing，再點 LINE 繼續登入／定位**。產生 QR 不代表出席成功、不會開啟簽到 flag，也不宣稱修復外部 Safari／真 iOS 登入。

### 本次驗證邊界

- Node 24；`pnpm verify`、全部 source＋tests strict TypeScript、receipt-health strict TypeScript 通過。聚焦 encoder／route／DOM：108 tests；包括 auth／CSRF／scope／revocation、先授權才編碼、無寫入 action、真 PNG metadata、readonly、load／decode pending／failure、選取競態、下載／列印與 XSS literal text。
- 使用已安裝 Chrome／Playwright，真 HTTPS Fastify 路由配**合成 in-memory SQL transport**，不是 PostgreSQL 證據。實際 768px image load／decode、PNG 下載位元組、readonly UI、HTTP／decode 選取競態、壞 PNG、撤銷 session、1440px／390px 截圖均已檢查。非真 iOS。
- macOS Vision 解碼兩張合成 PNG、下載 PNG、窄螢幕牌面截圖及兩份 A4 PDF 的 raster，均符合精確 expected URL；PDFKit 確認各 **一張 A4**，沒有表單／導覽／控制文字。證據與重現腳本保存在 `/tmp/venue-admin-qr-evidence/`、`/tmp/venue-admin-qr-browser.mjs`、`/tmp/venue-admin-qr-validate.swift`，屬本機暫存，不是產品或真使用者資料。
- pure-mode `pnpm verify` 明確 unset DB URLs：2,776 passed／617 skipped；其中既有自含 history harness 會自行建立 disposable PG17（17 passed），不是所有 PG suites 都 skipped。另以既有 `scripts/test-venue-debug-local-pg.sh focused` 啟動全新 socket-only PG17：debug／schema58／early-window 25、management 16、people 11、QR 10，合計 62 passed；management 已補真 buildApp readonly QR、停用場地、scope／不存在／CSRF／注入／revocation、完整場地與出席快照不變及既有 get read-audit 的 assertions。沒有使用既有 DB／dotenv／外部 provider。
- 本機沒有 PG16，**沒有宣稱全部 DB 測試或 CI PG16 通過**；既有 CI PostgreSQL 16 與父代理獨立 QR 解碼／review 仍需執行。完整 commit／數量／log／部署前條件見 `/tmp/venue-admin-qr-HANDOFF.md`。

## 本次地區選單（2026-10-27）

### Endpoint 與最小契約

- `POST /admin/api/venue-management/regions`，body `{}` 或 `{lang:"zh_TW"|"zh_CN"|"en"}`；不收 region UUID、principal、token 或 client capability。讀取也要求既有唯一 session／CSRF cookies、CSRF header、trusted Origin；拒絕 cross-site Fetch Metadata，回應 no-store／no-referrer。僅在原 management feature gate 開啟時掛載，沒有新增 public 身分路徑。
- 成功：`{regions:[{id,displayName,countryName,code,canRead,canManage}]}`。名稱依 locale，簡中缺值回繁中，再英文／code；標籤固定顯示「名稱｜國家（地區代碼）」避免同名歧義。UUID 只用於 option.value 與後端 payload，不顯示可手填的區域 UUID。
- `readVenueManagementRegions` 在同一 request-context transaction 重新解析 session、設定 principal，再以 SQL 篩選有效 operational → country → global hierarchy 與既有 `can_access_region`／`venue_attendance_authorized` action。只回符合資格的地區，不先送全部地區給前端 filter，不使用角色名稱 allowlist。
- `qigong_api_runtime` 已由 0003 取得 `core.regions` SELECT；本次完整 PG 55-chain 證實名稱查詢可用。0053 function owner 的窄 column grant 不用來執行目錄。**沒有新增／擴大任何 GRANT、role permission、RLS、SQL 或 migration（沒有 0056）**。
- 原 suite/sidebar/people capabilities shape，以及原 `capabilities` endpoint 均不變。目錄只是 UI hint；create/update 仍經原 0053 每次驗 session、action、來源／目標管理 scope、鎖後有效期、audit reason 與 version。

### 實際初載／新增流程

1. 頁面開啟即由私有 session boundary 呼叫 `regions`，不必輸入 UUID。本次不自動查場地列表，避免把新增綁在列表成功與否。
2. 單一可查地區自動選取；多地區顯示名稱下拉。目錄完成且任一地區可管理，就啟用主「新增場地」，不要求先按查詢，也不以目前 filter 的可讀性決定是否可新增。
3. 新表單優先使用目前 filter 的可管理地區，否則唯一可管理地區自動選取，多個可管理地區則要求選擇。目標選單只含可管理地區；唯讀既有場地可顯示原地區但不開放修改。
4. 新增的 `regionId = field.region_id = 選取目標`，絕不使用尚未載入的 loadedRegion。更新則保留既有場地 source region，目標獨立驗權。選擇目標同步新表單的 filter／查詢；列表失敗或 pending 不阻擋原有新增權限。更換 filter 不丟棄新表單文字。
5. 目錄空、目錄失敗、列表失敗及 session 失效分開顯示；有「重試授權地區」與「重新登入」。不把錯誤轉成 false capability 或假成功。撤權／停區後後端拒絕 create；目錄重試也會重新反映權限。
6. 寫入 busy 阻止重複提交，舊列表回應不覆蓋新寫入結果。session／權限失效保留草稿；未知網路結果／版本衝突要求重新查核，不盲目重送。UUID、永久 code、座標／時區／時段驗證、reason、audit、既有桌面／手機 Grid 保留。

### 本次驗證與限制

- Node 24、PG 17，`LANG=C LC_ALL=C`；offline frozen-lockfile 還原既有依賴，未修改 manifest／lock。全倉驗證初次因缺 build exports 失敗，先執行既有 `pnpm build` 後恢復；另修正新測試兩個 ESLint 型別警告。PG 初次撤銷全部 grants 的預期已修正為既有 session 契約的 unauthenticated，不改授權政策。
- `pnpm verify` 最終 PASS（formatter、lint、workspace typecheck/test/build）。config 2、identity 6、database 261、public-api 2259 tests passed；database 310、public-api 291 skipped。未提供任何現有 DB URL，這不是全 PG 測試通過的宣稱。
- `pnpm exec tsc -p tsconfig.eslint.json --noEmit`（source + tests）及 `pnpm exec tsc -p tsconfig.receipt-health.json --noEmit`：PASS。
- 目錄單元 2、真 Fastify buildApp integration 22、VM controller／真 admin-auth transport 38 tests PASS；包含 XSS literal text、singleton／multiple／同名、唯讀、pending／double-create、空／錯誤目錄、列表失敗、失效草稿、來源／目標 payload、原排版及 ARIA label/status／native select。
- `bash apps/public-api/tests/venue-management-local-pg.sh`：**16 PASS**，全可見 0001–0055 migration chain、全新 0700 `/tmp/venue-management-*` cluster、socket-only、拒絕 host、無外部 API／現有 DB／手機 DB。包括 runtime 名稱 ACL、country/global/region scope、locale fallback、撤權／停區、四個既有角色的合成 policy 映射／撤銷、CRUD／跨區／CSRF／鎖後到期／出席凍結等回歸。角色權限映射只存在 disposable fixture，未寫入產品 migration 或預設授權。
- Chrome headless CDP 使用合成資料、阻擋 HTTP(S) 網路、不登入 production、不安裝 browser/package；390／1280 px screenshots 均 `scrollWidth === viewport width`，列表 503 時新增／編輯仍可用。**非真機測試**。手機模擬 ArrowDown 選區可用；桌面 headless 原生 popup 的鍵盤提交未可靠驗證，未宣稱通過（不再重試此自動化問題）。原生 select／label／required／ARIA DOM 契約已有測試。預覽阻擋資源使 logo 未載入，不代表正式資源變更。
- 預覽、metrics 與重現腳本保存在 session artifact 目錄 `artifacts/01a16943-0be7-7090-92f9-7a12f0777f7b/venue-region-picker/`（`venue-region-390.png`、`venue-region-1280.png`）；不是產品截圖或正式登入證據。

### PR 摘要

- 授權地區目錄在 server 以既有 policy + hierarchy 篩選；不改授權、不增加 migration。
- 區域 UUID input 改名稱 select；初載自動目錄、直接新增，列表錯誤不鎖住有管理權限者。
- 新增 security／VM／Fastify／55-chain PG 回歸，維持 people/sidebar 及現有欄位與排版。
- 僅本地 commits；父代理 review 後負責 push／建立 PR。不遠端 merge、不部署、不開 feature flag。

## 歷史 standalone 紀錄：交付與邊界

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

`apps/public-api/src/venue-management-page.ts`：`renderVenueManagementPage(locale?)`。舊 standalone 曾要求先輸入 operational region UUID；本次已由上方「本次地區選單」契約取代。

### 停用舊網址

父代理可信 public `/venue-checkin` lookup 應呼叫 `lookupManagedVenue`：

- null：顯示場地不存在，不嘗試簽到。
- active=false：顯示「場地已停用」，保留名稱／代碼；不得轉址至任意 caller host。
- active=true：沿既有可信 LINE／GPS／consent 寫入流程，URL 本身不是出席資格。

目前此公開頁接線**未完成**；SQL 寫入仍會拒絕 inactive。不能把 admin 預覽網址／source 當作驗證成功。

## 歷史 QR 依賴缺口（已解決）

原 standalone 交付沒有 QR 編碼器。上方「本次 QR 圖片」已在取得人類批准後加入 `qrcode`／型別及 lockfile，提供 PNG 預覽、下載與 A4 列印；不提供 SVG、任意 URL 編碼或第三方 QR 呼叫。

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
