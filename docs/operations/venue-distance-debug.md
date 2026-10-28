# 單場地短效測試簽到（schema57；預設關閉）

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

本輪證據與父代理交接見 [venue-test-scope-verification.md](venue-test-scope-verification.md)。
[CKS schema56](venue-cks-debug-verification.md)、[schema55 integration](venue-debug-admin-integration.md) 與
[schema55 verification](venue-distance-debug-verification.md) 保留為歷史，不是 schema57 啟用指示。

## 場地與模式契約

- 每個配置／token **只能精確綁定一個** `tw-location-test` 或 `tw-taipei-cks`；不是多場地白名單，不接受 array、wildcard、null 或逗號串。
- `tw-location-test` **僅供測試，不計正式出席**。無 header 的正常 API 與直接 SQL normal entry 都回拒絕，且在寫入／重播前拒絕；不因已有正式歷史而回普通成功。
- 此公開場地碼不是秘密。正常路徑以 `venue_test_code_required` 提示需要短效測試碼；帶錯碼、關閉、過期、錯 scope、API／DB mismatch 回 `venue_debug_denied`，沒有 standard fallback。
- `tw-taipei-cks` 保留標準 GPS 簽到；只有人工明確勾選測試並輸入有效短效碼才使用 test 模式。不把全部 CKS 簽到自動變成 test。其他場地正常 GPS 流程不變。
- **只豁免距離**。仍取用裝置實際 GPS，保留 LINE audience／issuer／expiry、active person、approved application、active identity／channel、當前必要隱私同意。
- DB 在 advisory lock 後重查獨立配置、身分、同意、場地 active、operational → country → global active hierarchy、timezone 與開放星期／時段。重播同樣重驗；不捏造 GPS、不放寬截止時段、不要求 home-region 等於場地 region。
- 同人／場地／當地日期／`is_test` 獨立冪等。只寫 `is_test=true`、`verification_mode=distance_debug`；不回寫舊正式出席、不刪歷史、不補出席、不自動建立日課。
- 唯一模式憑證為人工輸入後的 `X-Venue-Debug-Token` header。Body 不接受 `debug`、`isTest`、person、subject 或 channel 覆寫。QR feature 關閉時仍沿用既有未註冊 endpoint 行為，不新增旁路。

## 初始關閉、migration 與 readiness

0001–0056 byte checksum 不變；registry 自動列舉 filesystem，沒有另造 registry。
新增 `0057_venue_test_scope.sql` 由既有 runner 包在交易中：

1. 刪除 `platform.venue_debug_config` 舊 singleton row，撤銷 schema56 authority，不搬移舊 token、不建立 enabled row／secret。
2. 只把非 null 單一 `venue_code` CHECK 改為上述兩個精確值。原 singleton、finite window、canonical millisecond expiry、最長 60 分鐘約束保持。
3. 固定靜態重列 schema55 normal function，僅增加 test-site early denial；ownership／ACL／其他正常驗證保持。
4. 固定靜態重列 schema56 debug function，僅擴充可接受代碼的 enum；DB `configured venue = input venue`、HMAC、expiry-ms、nonce、issued window、lock 後重驗不變。
5. Debug INSERT policy 僅允當前 enabled、未過期配置的精確場地。兩碼的歷史 SELECT 保持；normal writer 不新增 `is_test`／mode INSERT 權限，不放寬 normal INSERT policy。
6. 不改 attendance／audit／場地／身份資料，不新增角色、runtime 表 ACL、admin grant 或 HTTP setter；不更動 restrictive 正式統計排除。

API 最大版本為57。Debug enabled **只接受精確57**，且獨立 probe function／role／ACL／RLS capability；不是只看版本。
Debug off 的 default-off／normal QR／管理／people／history 保留各自已審過的56及更早相容範圍，並接受57；未知58拒絕。Suite probe 精確 count/version 配對54、55、56、57，debug 只接受57。
Readiness 不讀秘密、不建立配置，也不代表已啟用有效 token。

## 另行批准後才能配置

本輪沒有正式配置／token／啟用，以下只是後續操作契約。

| API 設定名稱                        | 契約                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `VENUE_QR_CHECKIN_ENABLED`          | 明確啟用既有 QR 路徑；本輪不改正式 flags                                        |
| `VENUE_QR_PUBLIC_ORIGIN`            | 精確 HTTPS origin；既有 Origin／header 防護不變，stage2 Origin 配置不在本輪範圍 |
| `VENUE_DISTANCE_DEBUG_ENABLED`      | 預設 false，只有明確 true 載入配置                                              |
| `VENUE_DISTANCE_DEBUG_VENUE_CODE`   | 必填且只有一個 `tw-location-test` 或 `tw-taipei-cks`                            |
| `VENUE_DISTANCE_DEBUG_EXPIRES_AT`   | Canonical UTC ISO，整數毫秒、Z；啟動時 future ≤60min，每請求重查                |
| `VENUE_DISTANCE_DEBUG_TOKEN_SHA256` | 64位小寫 hex，也是 proof HMAC authority，須當作秘密                             |

DB 配置只能由另行授權 operator／owner 安全 provisioning；runtime／worker 無讀寫配置權限。
API／DB 的 venue、hash、**同一 epoch-millisecond expiry** 必須一致，不能各自取不同 expiry 或取較早者。
DB window 從 finite `configured_at` 起算，`expires_at > configured_at` 且 ≤60min；API 再獨立檢查期限。延長 DB expiry 會使舊 API proof 無效，不是靜默延期。

HMAC message 保持 `server nonce|verified subject|venue|issued seconds|expires epoch-ms`；DB 只接受過去30秒／未來2秒內 issued。
每次使用全新 server UUID，不使用 HTTP incoming request ID 作授權 nonce；原始碼不進 SQL。
外層 proxy／APM／Cloudflare 與 DB logging 需另審，不能從本地測試推論正式外部服務不擷取敏感資料。

## LIFF 與本人紀錄

- 頁面只取得 server-selected public venue scope，不取得 hash／秘密／其他學員資料。有效 matching scope 才顯示人工輸碼區。
- `tw-location-test` 一律顯示「僅供測試，不計正式出席」；debug off、expired 或 nonmatching configuration 提示未開放，controller 禁止普通 submit，即使以程式更改 disabled 也不能送出。
- Matching test site 強制 test 模式，不能以取消 toggle 切普通成功；CKS 則保持明確 opt-in，普通 GPS 可用。
- 三語文案沿既有 zh_TW／zh_CN／en pattern。錯誤不洩 SQL、PG location 或詳細 body。
- 碼只在當次 request memory／header；立即清空輸入框、重試重新輸碼。pagehide／切語言清碼；fresh SDK credential、語言偏好優先序、busy／防重送不退。
- 不放 URL／QR／menu／storage／log。不改官方 LIFF `2011968988-42BgF96N`、Endpoint `/line/` 或 Console；靜態 NFC 不是 proof-of-touch。
- 成功必須是 test DTO，明示不計正式出席。日課按鈕只是連結，不自動建立任何日課／心得／獎勵。
- 本人歷史正式／test 分流；test history 不需 GPS／短效碼，仍需身份與同意，不能查別人，兩個場地的既有 test history 皆保留。正式 totals／CSV／rollups／people／detail 排除 test；test DTO totals 為零。

## DB 安全與撤銷／回退

- Debug role／region guard 仍 NOLOGIN、NOINHERIT、NOBYPASSRLS、非 table owner、無 memberships。runtime 只有精確入口 EXECUTE，PUBLIC／worker 無入口 EXECUTE。
- Region guard 保持只讀 regions 四欄＋boolean helper；既有 `core.regions` 未啟用 RLS，不宣稱新增了 FORCE RLS。其他原有 FORCE RLS、narrow ACL、`row_security=on`／固定 search_path 不變。
- Context 保持 backend PID＋transaction＋person 綁定；runtime 不可讀寫。成功清除，失敗 transaction rollback。原始 GPS 欄位均 NULL，只保存 derived distance。
- DB enabled=false／刪配置、API off／撤銷秘密或到期可關閉；保留歷史，不能用刪 attendance 當撤銷。
- **Schema57 forward-only。base `638e8d1` 最大只支援56，升57後不能直接 rollback 到原 binary。** 必須另備已驗證的 schema57-compatible feature-off baseline，或 fix-forward；本輪沒有聲稱已完成該 fallback release。
- 不編輯0056或更早 SQL、不 unsafe down migration、不回灌舊 snapshot 覆蓋新寫入。部署／備份／activation／正式 token／rollback rehearsal 均須另核准。

## 本地驗證入口

只使用既有 Node24／PG17、fresh 0700 `/tmp`、socket-only、synthetic fixtures；腳本 `env -i` 清除 inherited DB/provider 環境，不讀 `.env` 或採用未知 DB URL。

```sh
bash scripts/test-venue-debug-local-pg.sh focused
bash scripts/test-venue-debug-local-pg.sh full
```

完整 pass／skip、commit、限制與父代理待辦見 [本輪交接](venue-test-scope-verification.md)。PG16、真手機／LINE／正式 logging 未驗；本地通過不等於已部署或已開放。
