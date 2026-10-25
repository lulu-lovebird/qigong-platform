# QR 團練簽到：隔離演練與交付紀錄

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 狀態：成功路徑已實作，真 PostgreSQL／手機尚未驗證

開始於乾淨 `b3a61bc`，唯一實作者為父 checkout；沒有開代理、部署、push、讀 .env／機密、連正式或未知 DB／外部 API、修改依賴／lockfile／global config、刪 worktree。

本次實作不是 deny-only stub：

- `/api/line/venue-checkin` 真正組裝既有 LINE verifier、0049 identity resolver、privacy adapter 與 `platform.venue_qr_checkin`。寫入交易再次查身份／同意／場地 active、場地當地時間窗與半徑；只接受 token、venue code、當次位置，不接受 personId/checkinId。
- 新 0050 forward migration 保留 FORCE RLS，非表 owner／NOLOGIN／NOBYPASSRLS／無 membership 的 writer/reader 僅有必要 column 權限；runtime/session 無兩表直接權限。原 0047–0049 檔案完全未變。
- 替換 0048 deny-all 為明確 SELECT／verified INSERT policies；UPDATE／DELETE restrictive deny 保留。舊 NFC 路由與 gate 不開；0049 metadata/write 拒絕契約也沒有偷換成管理 CRUD。
- 0049 resolver 由 0050 forward replacement 改為 wall-clock validity；原非 owner 身份角色、最小欄位 ACL 與 RLS 保留。不是修改既有 migration 檔案。
- 同人同場當地日期唯一；跨場計次，日數對 local date 去重，跨區／跨國出席不按 home region 拒絕。GPS／日課連結／心得欄位保留 NULL，不新增或修改日課。
- 唯一衝突回原成功時間／日期；**每次 replay 仍須通過當下身份、同意、active、時段、半徑**。過了時段或離場的重試不會新增或假稱成功。
- LIFF 成功畫面顯示可信場地名稱／時間／時區，提醒「記錄今天功法與感受」，提供 `/line/checkin?lang=…`。不自動建立日課。網路結果不明時明說可能已記錄、可冪等重試。
- 新後台 `/admin/venue-qr` 有可用的 region/date/page 查詢與 CSV；每次私有 cookie → DB session → scoped function，POST 使用同源 Origin、既有 double-cookie CSRF。read 用既有 `checkin.read`，export 用 `stats.export`；無 k5／額外姓名 permission／anti-differencing／legacy scope ledger。

這些是程式接線與本地 mock／VM 證據，**不是 SQL 已成功編譯、真實 RLS 或 LINE／手機驗收證據**。本機沒有可呼叫的 `allow_tool:false` hook，仍須父代理獨立結構安全審查。

## 功能開關與啟動前提（未執行部署）

預設不配置 QR 即為 preview，API／新後台不註冊。URL 沒有 `mode`／`test`／`bypass`。
受控環境需由 server 配置：

```text
VENUE_QR_CHECKIN_ENABLED=true
VENUE_QR_PUBLIC_ORIGIN=https://<已核准的服務主機>
NFC_FIELD_CHECKIN_ENABLED=false
```

Origin 必須精確 HTTPS origin，不帶 path／尾斜線。原 LINE 四個設定 `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_LOGIN_CHANNEL_ID`、`LINE_LIFF_ID` 及既有 admin OIDC、`DATABASE_URL` 仍沿用現有安全配置，不在本文件填寫憑證。

- QR enabled 的 startup／health 必須是精確 `0050_venue_qr_attendance.sql`，不是任意 0050／0049／future；並通過既有 NOINHERIT session role preflight。default-off 也接受精確 0050（0049／任意 future 仍拒絕），使 migration 後仍可關閉功能、使用 preview／日課；這不授予 NFC capability。
- `buildApp` 的 `venueQr: { enabled: true, publicOrigin }` 是同一 server-only dependency。production 無 mock verifier、假身份或 URL bypass。測試只在 test code 注入 LINE mock。
- 正式啟動指令仍為既有 `pnpm build`、`pnpm --filter @qigong/public-api start`。**本次沒有執行 start、migration CLI、部署或網路代理。** 不要以本文件取代隔離 PG／Node24／安全審查。
- 原始 GPS 只有 JSON POST 參數；API 不記 body，logger 亦 redacts `req.body`／URL，parser/size 錯誤固定回覆、不記診斷。運維還須保證 reverse proxy/APM 不擷取 request body，PG `log_parameter_max_length=0`、`log_parameter_max_length_on_error=0`，不開參數／封包／crash dump 收集；不能宣稱應用碼控制了外部服務記錄。

## QR URL 與 Endpoint

```text
https://liff.line.me/{既有LIFF_ID}/venue-checkin?venue=tw-test-one&source=qr
https://<已核准的服務主機>/line/venue-checkin?venue=tw-test-one&source=qr
```

`venue` 嚴格 lower-case hyphen code、最多 64 字元。source 只是分類，不是授權或防偽；靜態 QR 可轉傳，GPS 亦可偽造。

既有文件指定 LIFF Endpoint `/line/`，本次未向 LINE Console／線上服務核對或修改。入口延續既有：

```text
LIFF 追加 /venue-checkin?... → /line/?liff.state=<encoded path>
→ SDK init primary → SDK secondary /line/venue-checkin?...
→ 必要時外部登入（canonical allowlist 續接）→ 本人按定位簽到 → 新 API
```

primary 不提前定位／提交；未知／重複／惡意應用參數仍拒絕。未開 server flag 時相同 URL 保持原預覽，不取 coords／不傳 API。缺 LINE 配置不提供入口。API 必須來自配置的 Origin、JSON 與 `x-venue-checkin: 1`，不使用 admin cookie 當學員身份。

## 全新場地／合成資料

0050 只接受全新空 attendance／venue；不做 legacy scope、日期回填或未知資料遷移。若已有資料應停止並另審，不刪資料來繞過。

場地配置需包含 `region_id`、唯一 `code`、`name_zh_tw`、場地 latitude/longitude、半徑 1–5000m、IANA timezone、`is_active` 及：

```json
{
  "day_of_week": [0, 1, 2, 3, 4, 5, 6],
  "start_time": "00:00",
  "end_time": "24:00"
}
```

星期 0=週日；時段為場地 wall-clock `[start,end)`。只支援同日窗，`24:00` 可作結束，不接受 NULL／倒序／跨夜窗。實際場地不應照抄全日合成設定；已出席的場地 region/timezone 不可移動，避免改寫既有歸屬／日期語意。

合成 fixture 位於 `apps/public-api/tests/fixtures/venue-qr-synthetic.sql`，只由一次性 harness 載入：

- SG home region 學員、LINE `U`+32 個 `a`，只在 mock verifier 使用 `synthetic-token`。
- `tw-test-one`／`tw-test-two`、`sg-test-one`、日期線東西場地與關閉時段場地；皆合成座標，沒有真實學員或營運場地。
- 一名 TW regional_viewer、一名僅 TW stats.export 的合成 exporter；合成 session 僅 fixture 使用，production 不內建這些身份。
- 測試直接查 fixture 的 `core.regions` IDs 傳後台 region selector。一般管理員只依既有 scoped view access 讀姓名／出席，CSV 另需 stats.export，不新增姓名權限。既有 mapping 證據為 0002 的 permission/role seed 與 0003 `admin.can_access_region`，不使用 learner self-read 或把兩個 scope grant 拼接。

**不要把 fixture 載入正式、共享或不明 DB。** 目前場地建立／修改及人工補登 UI 仍未接通；最低驗收用受控合成 SQL 配置場地即可，不能使用舊 NFC 管理路由。

## 一次性 PostgreSQL 演練（有現成工具才執行）

```sh
bash scripts/test-venue-qr-local-pg.sh
```

腳本只使用 PATH 已有 `initdb`／`pg_ctl`，不安裝、下載、載入 .env 或連既有 DB。以非 root 帳號建立全新 0700 `/tmp/venue-qr-pg.*` data-dir/socket，獨立 socket port 55479、`listen_addresses=''`，無 TCP 對外；載全部 repo migrations 與合成 fixture。test 先核對 marker／owner／postmaster paths 與 pristine DB，才建立連線；不用 TEST_DATABASE_URL。結束只停止／清除自己建立的 cluster，不刪 worktree。

十項可執行 PG cases 涵蓋 migration chain、角色／ACL／FORCE、無直接 runtime/session 權限、跨國真寫入與冪等、並行同場／跨場、日期線時區、半徑／時段／active、NULL 排程與 immutable region/timezone、LINE mock／同意與 identity 撤銷、偽造 principal／scope／read-export 分權、CSV 公式防護與成功稽核。LINE verifier 仍是 mock，PG 若未執行則不算通過。完整官方 SDK、DST 所有邊界、並行撤權的線性化及手機不在此測試的證明範圍。

### 本機實際結果

- Node `v26.10.0`，不是要求的 Node24；唯讀 PATH／既有常見安裝目錄未找到 Node24，不下載或改 global config。
- 未找到 `initdb`／`pg_ctl`／`psql`／Docker。腳本實跑 **exit 77**：`SKIP: existing initdb is required; nothing installed or connected.`
- 新 PG suite **10 skipped**；沒有任何真 PG 連線／SQL 執行／RLS 成功證據，這是發布 blocker。

## 批次提交及實際測試

每批 <=5 檔；每檔修改即測相關 suite、每批 configured Prettier 與測試後提交。SQL／shell 沒有既有 Prettier parser；SQL 是靜態契約檢查，shell 使用 `bash -n`。沒有安裝 formatter。

| 批次 | SHA       | 檔數 | 結果／目的                                                                      |
| ---- | --------- | ---- | ------------------------------------------------------------------------------- |
| 1    | `fdd0d1d` | 3    | 姓名／k5 契約修正；141 passed                                                   |
| 2    | `b8d1213` | 2    | 0050 SQL＋靜態；173 passed / 10 原有 DB skips                                   |
| 3    | `b9037ea` | 4    | LINE resolver／QR API／readiness；216 passed                                    |
| 4    | `a8738f4` | 5    | live LIFF＋server flags＋VM；218 passed                                         |
| 5    | `399bb9b` | 4    | admin cookie/CSRF／查詢 CSV；311 passed                                         |
| 6    | `b7724d7` | 5    | 隔離 PG harness／fixtures／SQL boundaries；44 passed / 當時 9 PG skips          |
| 7    | `f32f036` | 5    | parser／body privacy；48 passed                                                 |
| 8    | `160e0bf` | 3    | NULL 時段拒絕／PG 邊界；119 passed / 10 原有 DB skips，另新 PG 10 skips         |
| 9    | `ccc1dc1` | 1    | final lint 發現新 handler thenable 型別，一輪修復；47 passed、changed lint 通過 |

文件批次 10 為 `bbf9d57`（4 檔）。後續 readiness 安全收尾（3 檔）允許精確 0050 在功能關閉時繼續 preview／日課，enabled 仍只接受 0050、舊 NFC 仍拒絕；SHA 由最終回報取得，不在本檔自我引用。

baseline 全 workspace tests 通過：API 1453 passed / 233 skipped、database 173 / 292、config 2、identity 6；已包含實際 buildApp integration suites。
最終 source 回歸：API **1499 passed / 243 skipped**、database **176 passed / 292 skipped**、config **2 passed**、identity **6 passed**，合計 **1683 passed / 535 skipped**。
全 workspace typecheck/build 通過。全倉 lint 初次發現 2 項新 handler thenable 問題，單一修復輪 `ccc1dc1` 消除；仍有原檔 `apps/public-api/tests/line-checkin-nfc.test.ts` 的既有 8 errors（7 unused-vars、1 no-base-to-string），沒有修改該檔或 lint config。

最終命令（全部測試移除 DB URL／isolated-harness opt-in；沒有連線）：

```sh
env -u TEST_DATABASE_URL -u DATABASE_URL -u VENUE_QR_ISOLATED_PG_DIR pnpm test
env -u TEST_DATABASE_URL -u DATABASE_URL pnpm typecheck
env -u TEST_DATABASE_URL -u DATABASE_URL pnpm build
env -u TEST_DATABASE_URL -u DATABASE_URL pnpm lint
```

變更 TS 單獨 lint、新測試 strict tsc、變更 TS/Markdown Prettier、shell syntax 與 `git diff --check` 另逐項記錄於最終回報；沒有以全倉 format:check 或 mock 冒稱正式驗收。

## 待完成：發布與真人驗收

1. 在已證明隔離、工具已存在的 Node24／PG 環境跑上述 harness；若 SQL／ACL 出錯，最多三輪修復後停，不連共享 DB 找答案。
2. 父代理另做安全審查：新 definer/ACL/RLS、現有 privacy/session helpers、並行撤權語意、場地配置變更與外部 logging 設定。沒有宣稱本輪完成獨立 review。
3. 經另行核准才執行 migration、server flag、部署／LINE Console 調整；不能直接開舊 NFC gate。
4. 真人 Android/iOS LINE、外部登入回跳、實際 Endpoint/scopes、GPS 拒絕／timeout／離場／重試、QR 掃描與文字縮放／讀屏、成功回日課入口及後台 CSV。

沒有宣稱任何公開網址已上線、正式 DB 已更新或手機 QR 已實測。
