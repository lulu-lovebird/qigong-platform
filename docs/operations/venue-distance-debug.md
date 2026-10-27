# 限時異地驗收（未啟用／未部署）

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 範圍與授權邊界

- 僅 `tw-location-test`；僅豁免定位半徑，仍由裝置取得並傳送實際 GPS。
- LINE audience、issuer、expiry、active person、approved application、active identity/channel、最新必要隱私同意仍必須通過。DB 在寫入交易內重新驗證身份與同意。
- 場地 active、timezone、開放星期／時段、同人同場當地日期冪等都保留；重播也重新檢查當前條件。
- 只有 `X-Venue-Debug-Token` header 能請求此模式；無 header 一律走原正式流程。錯碼、過期、未啟用或錯場地明確回覆 `403 venue_debug_denied`，不降級為正式成功。
- input schema 不接受 `isTest`、`debug`、person、subject 或 channel 覆寫。
- 此分支沒有設定或產生正式 token，沒有連外 LINE、phone DB 或任何部署操作。

## 預設關閉與設定

遷移 `0055_venue_distance_debug.sql` 不建立 config 資料，也不建立 secret。

API composition root 的必要條件：

| 設定                                | 意義                                                                  |
| ----------------------------------- | --------------------------------------------------------------------- |
| `VENUE_QR_CHECKIN_ENABLED`          | 原正式 QR 功能必須已啟用                                              |
| `VENUE_QR_PUBLIC_ORIGIN`            | 精確 HTTPS origin，沿用原 origin/CSRF-like header 防護                |
| `VENUE_DISTANCE_DEBUG_ENABLED`      | 預設 `false`，只有明確 `true` 才讀 debug 設定                         |
| `VENUE_DISTANCE_DEBUG_EXPIRES_AT`   | 明確有限到期時間，啟動時不得已過期；每次請求重查                      |
| `VENUE_DISTANCE_DEBUG_TOKEN_SHA256` | 64 位小寫 hex hash；同時是 DB proof 的 HMAC key，必須當成認證秘密保護 |

DB 的 `platform.venue_debug_config` 必須另經授權管理者安全配置相符 hash、`enabled`、有限 `expires_at`。API/runtime/worker 沒有讀寫 config 的權限，沒有 HTTP setter；任一側關閉、到期或 key 不符皆拒絕寫入。實際有效期限是兩側期限的較早者。Capability readiness **不是** DB 啟用狀態確認，不能用 health ready 推論測試碼已可用。

本次未執行配置步驟。正式 secret 的安全發放、owner provisioning 與外層 proxy/DB logging 政策須獨立審查，不能從 fixture 複用測試碼。

## LIFF 操作與回傳

啟用且未到期時，只有 test venue 的正式簽到頁顯示測試區：

1. 人工勾選異地測試、輸入短效測試碼。
2. 按鈕才取得 GPS；測試碼立即從 input 清空，僅保留於此次 async 請求記憶體。
3. header 帶碼，body 仍只有原 idToken、venue、實際 latitude/longitude；禁止 URL、QR、bundle、storage、console 傳遞測試碼。
4. 成功須有 `isTest: true` 與 `verificationMode: distance_debug`，顯示 **異地測試，未計入正式出席**。回日課仍只是連結，不會替使用者日課打卡。
5. 重試需重新人工輸碼；若測試碼無效不會偷偷轉成正式流程。

本人團練紀錄預設只有正式紀錄／正式 lifetime、month、day totals。可在頁內切換明確標示的測試類別；API 使用 `view: test` 呼叫獨立的本人測試讀取函式，仍每次驗證登入、身份及同意，不需要測試碼、GPS，也不能查別人。測試頁隱藏正式 totals，DB test DTO totals 固定為零，不將驗收筆加進正式數字。測試 tab 可在 debug 關閉後保留查閱；在尚未具備 0055 的相容舊 DB 會明確不可用，沒有 mock fallback。

## DB 信任與資料分類

- API 先 SHA-256 + fixed-length `timingSafeEqual` 驗證 header，再建立短效 HMAC。
- 每個 debug 寫入使用全新 server UUID nonce 作為 DB request ID，不能由 inbound `X-Request-Id` 指定。proof 綁定 nonce、已驗證 LINE subject、venue、issued seconds。
- DB 獨立確認 config、到期、場地、proof（過去最多 30 秒，未來最多 2 秒），並在 advisory lock **之後** 檢查。proof 不作為 API 回傳資料。
- 受限 `qigong_venue_debug` 為 NOLOGIN、NOINHERIT、NOBYPASSRLS、非 table owner；無 role membership；僅精確函式 EXECUTE 給 API，PUBLIC／worker 不可執行。
- context table 受 FORCE RLS 約束，綁 backend PID + transaction ID + person；runtime 不可讀寫，也不能用自訂 GUC 授權。成功刪除 context；失敗交易回滾。
- GPS：僅當次 API／SQL 參數使用；attendance 原始 latitude/longitude 均 NULL，無 note、daily checkin ID、volunteer ID。不得啟用會記錄 bind parameters、request headers/body 或 SQL error statements 的外層診斷。
- 認證資料：原碼只存在人工輸入／header／請求記憶體；hash 是 HMAC authority，不是公開資訊。API logger 排除 body、URL、header，且有額外 `req.headers.x-venue-debug-token` redaction。DB harness 關閉 statement-on-error／parameter logging。
- 持久化：person/venue/date/time、derived distance、`is_test`、`verification_mode` 為受限個人出席資料；audit 僅記結果、replayed、test/mode，不含原碼、hash、proof 或 GPS。
- 正式 SELECT 的 PUBLIC **restrictive exclusion** 為 `NOT is_test`（僅不可登入 debug owner 例外），不是 PUBLIC bypass 授權。原 history／admin people/detail／read/export 都由各自非 owner reader 執行，故測試筆不進 totals 或 CSV。
- 日課 stats/rewards 使用 `core.checkins`，debug 不寫入該表。PG 驗證日課 metrics、checkins、badges、jobs、achievement transitions 在驗收前後不變。
- 唯一鍵為 `(person_id, field_id, attendance_date, is_test)`：正式 FALSE 分區仍只能一筆，測試 TRUE 分區也只能一筆。兩者不能覆寫、不互相阻擋；正式重播不會回傳測試成功。
- `NUMERIC(10,2)` 能容納地球最大球面距離；`pg` 回傳 NUMERIC 字串，測試先驗證十進位契約才轉數值，不修改全域 numeric parser。

## 版本與整合

- 保留已發布 0001–0054 bytes；0055 為唯一新 forward migration。
- enabled debug 必須精確 0055 且通過角色、function ACL/owner、FORCE RLS capability probe；普通 QR／suite 可接受各自既有版本與精確 0055，未知同號或未來版本仍拒絕。相容不等於啟用。
- 未修改另一個 venue-admin-ui worktree、admin UI pages 或 shared admin-auth。可能的 composition-root 整合衝突檔：`apps/public-api/src/app.ts`、`index.ts`、`venue-suite.ts`；另有三份 venue PG regression tests 更新 55-chain 期待值。合併時須逐一人工比對，不能整檔覆蓋另一功能。

## 本地驗證

只使用既有 Node24／PG17，不安裝套件；腳本以 `env -i` 清除外部 DB/provider 環境，不讀 `.env` 或採用未知 `TEST_DATABASE_URL`。所有新 cluster 在 0700 `/tmp/venue-debug-*`、socket-only、marker/owner/PID/port 檢查後 cleanup。

```sh
bash scripts/test-venue-debug-local-pg.sh focused
bash scripts/test-venue-debug-local-pg.sh full
```

- `focused`：debug HTTP/DB security 9、settings/management 12、people 11、QR 10，共 **42 passed、0 skipped**；每套獨立新 cluster，完整 55-chain。
- `full`：腳本自行建立 disposable database URL 後執行 `pnpm verify`，接著 full source/tests `tsc -p tsconfig.eslint.json --noEmit` 與 receipt-health tsc。
- full suite 結果與每批修復紀錄另見 `venue-distance-debug-verification.md`。

## 尚須獨立審查／不代表完成的工作

- 本地自審與合成測試不是跨模型／外部安全審查；啟用前必須獨立審查 HMAC/config/context/RLS、proxy/DB logger 與安全 secret 發放／撤銷。
- 未做實體手機／真 LINE provider 驗收，未建立正式 token 或 owner config，未部署、push、merge、改 Rich Menu／Console。
- 0055 變更無自動 downgrade／資料刪除方案；停用只需維持 server feature off 或到期，測試資料仍保持隔離供本人查閱。不得為回退覆寫已發布 migration 或刪正式出席。
