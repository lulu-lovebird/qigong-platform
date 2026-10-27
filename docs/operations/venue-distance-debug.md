# 限時中正紀念堂異地驗收（schema56；預設關閉）

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

本輪本地驗證與交接見 [venue-cks-debug-verification.md](venue-cks-debug-verification.md)。
[venue-debug-admin-integration.md](venue-debug-admin-integration.md) 與
[venue-distance-debug-verification.md](venue-distance-debug-verification.md) 為舊 schema55 歷史證據，不是 schema56 操作指示。

## 範圍

- 本輪只允許 `tw-taipei-cks`，不是任意場地白名單；舊 `tw-location-test` 不再接受新 Debug 寫入。
- **只豁免距離**。仍取得並傳送裝置的實際 GPS，保留 LINE audience/issuer/expiry、active person、approved application、active identity/channel、當前必要隱私同意。
- DB 在寫入交易重查身分、同意、場地 active、operational → country → global 各層 active、timezone、開放星期／時段。學員不必住在場地所屬地區。
- 在家測試也必須在場地的開放時段內；不得為成功而默默放寬時段或捏造 GPS。
- 同人、場地、場地當地日期、`is_test` 冪等；重播也重驗當前條件。測試和正式出席互不覆寫／阻擋。
- 只有 `X-Venue-Debug-Token` header 能選此模式；缺 header 走正式流程。錯碼、過期、關閉、錯場地、API/DB 設定不一致均明確拒絕，不降級為正式成功。
- Body 不接受 `isTest`、`debug`、person、subject 或 channel 覆寫。

## 初始關閉與版本

已發布 0001–0055 不變。`0056_venue_cks_distance_debug.sql` 由 migration runner 包在交易中：

1. **只刪除秘密設定表 `platform.venue_debug_config` 的舊 singleton row**，撤銷舊場地憑證，絕不把它轉授權 CKS。
2. 不建立 enabled row、不產生 secret、不刪 attendance、audit、context 或任何場地／學員資料。
3. 增加無 default 的 `venue_code`，硬 CHECK 為 `tw-taipei-cks`；有限的 `configured_at`；`expires_at > configured_at` 且最長 60 分鐘，expiry 必須對齊整數毫秒。
4. 移除舊六參數 Debug checkin 函式及其 ACL，換七參數函式，proof 綁定明確 expiry。
5. 僅 CKS 可 INSERT 測試筆；歷史 SELECT 保留舊 `tw-location-test` 並加入 CKS，正式 restrictive exclusion 不變。

Debug enabled 需要精確 schema56 與獨立 capability readiness。Debug off 時，QR／history／管理／報表保留精確 schema55 相容，也接受 schema56；舊的其他已審閱相容版本維持原規則，未知版本拒絕。相容或 health ready 都不代表已啟用／已配置有效憑證。

## 另行批准後才能配置

本輪未連正式環境、未配置正式 row、未產生／發放正式 token，以下僅為後續操作契約。

| API 設定名稱                        | 契約                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `VENUE_QR_CHECKIN_ENABLED`          | 正式 QR 路徑需明確啟用                                                                     |
| `VENUE_QR_PUBLIC_ORIGIN`            | 精確 HTTPS origin，沿用 Origin 與請求 header 防護                                          |
| `VENUE_DISTANCE_DEBUG_ENABLED`      | 預設 `false`；只有明確 `true` 才載入 Debug 設定                                            |
| `VENUE_DISTANCE_DEBUG_VENUE_CODE`   | 必填且只能是 `tw-taipei-cks`；空值、多碼、萬用字元、舊場地均拒絕啟動                       |
| `VENUE_DISTANCE_DEBUG_EXPIRES_AT`   | 必填 canonical UTC ISO（整數毫秒、結尾 Z）；啟動時在未來、距今不超過 60 分鐘，每次請求重查 |
| `VENUE_DISTANCE_DEBUG_TOKEN_SHA256` | 64 位小寫 hex；同時是 proof 的 HMAC authority，必須當作秘密，不可公開                      |

DB `platform.venue_debug_config` 只能由另行授權 operator／DB owner 安全配置；runtime／worker 無讀寫權限、無 HTTP setter。DB row 需 `enabled`、相同 `venue_code`、相同 hash，且 **API/DB expiry 必須是同一 epoch-millisecond**，不是各自設定稍有不同的到期時間或取較早者。請先選定一次到期值，再安全配置兩側，避免捨入或時間格式偏差。DB CHECK 的 60 分鐘由 `configured_at` 起算，API 啟動再獨立限制不超過未來 60 分鐘。

若任一側 off、過期、hash／expiry 不一致，寫入 fail closed。Readiness 只確認版本／安全 capability，不讀秘密設定，不確認 token 已可用。改變 DB expiry 也會立即撤銷舊 API proof；不能用於靜默延長已配置的憑證。

啟用前須審查外層 proxy、APM、Cloudflare 和 DB 診斷政策；不能由本地 logger 測試推論外部服務沒有擷取 body／headers。正式 secret 生成、人工發放、owner provisioning 與 feature activation 必須另行授權，不能複用 fixtures。

## LIFF 與本人紀錄

只有 Debug enabled 的 CKS 正式簽到頁顯示人工測試區；舊測試場地與 preview 頁不顯示。

1. 人工勾選異地測試並輸入短效碼；按鈕取得真實 GPS。
2. 輸入框立即清空，碼僅留於該次 async 請求記憶體；重試須重新輸入。
3. Token 只進 header，不進 URL、QR、Rich Menu、bundle、browser storage 或 console；body 仍只有 idToken、venue、實際 latitude／longitude。
4. 成功必須有 `isTest: true`、`verificationMode: distance_debug`，明示 **異地測試，未計入正式出席**。
5. 回日課只是連結；不會自動建立日課／心得／練功紀錄。

本人團練紀錄預設正式類別／正式 totals。頁內測試類別呼叫獨立 API `view: test`，仍驗登入、身分與同意，不需要 GPS／測試碼，也不能查別人。測試類別隱藏 totals、DB test DTO totals 固定零；Debug 關閉或過期後仍可查已存在的本人測試紀錄，包含舊場地紀錄。歷史 URL 不支援 `view=test` 授權參數。

## DB 信任、RLS 與保密

- API 先用 SHA-256 和 `timingSafeEqual` 驗 header，再以全新 server UUID nonce 建立 proof；不能由 inbound `X-Request-Id` 指定 nonce。
- HMAC message 精確為 `nonce|verified subject|venue|issued seconds|expires epoch-ms`。SQL 七參數為 subject、venue、latitude、longitude、issued、expires-ms、proof；原始 token 絕不進 SQL。
- DB 在 advisory lock 後查獨立 enablement、CKS scope、未到期、expiry 精確一致、proof（過去最多 30 秒、未來最多 2 秒）；proof 不回傳。
- `qigong_venue_debug` 保持 NOLOGIN／NOINHERIT／NOBYPASSRLS、非 table owner、無 memberships；runtime 僅精確入口 EXECUTE，PUBLIC／worker 無 EXECUTE。
- 新 `qigong_venue_debug_region_guard` 同樣不可登入、不可繼承、不可 bypass RLS、非 table owner、無 memberships。只讀 `core.regions` 的 id／parent_region_id／region_type／active 四欄；固定 `search_path=pg_catalog`、`row_security=on` 的 SECURITY DEFINER helper 只回傳 active hierarchy 布林，EXECUTE 只給 Debug role，不給 PUBLIC／runtime／worker。
- **既有 `core.regions` 並未啟用 RLS**；本輪不改其全域 RLS 或其他角色權限。新增定向 guard SELECT policy，保留現況；安全邊界是窄欄位 ACL＋helper EXECUTE，不宣稱該表已 FORCE RLS。其他既有 Debug context／attendance／venue／audit 表的 FORCE RLS 保持不變。
- Context 以 backend PID＋transaction ID＋person 綁定，runtime 不可讀寫、不能用自訂 GUC 授權；成功清除 context，失敗整筆交易回滾。
- Attendance 原始 GPS 均 NULL；僅保存 person／venue／date／time、derived distance、test／mode。沒有 note、日課 checkin ID 或 volunteer ID。
- Audit 僅保存結果、replayed、test／mode；request-scoped diagnostic 只映射 HTTP reqId → server auditRequestId UUID，不能當作 commit 成功證據。原碼／hash／proof／GPS／SQL 例外不進 API response／logger。
- 正式 SELECT 的 PUBLIC restrictive exclusion 仍排除 test，不授權 PUBLIC 讀取。正式 history、管理、people／detail、CSV totals 全部排除測試筆。
- 日課 stats／rewards 仍用 `core.checkins`；測試不建立日課、badge、job 或 achievement transition。

## 停用、撤銷與回退

- 隨時將 DB `enabled` 關閉／刪除 config 可撤銷 Debug；API feature off、到期或移除 API 秘密亦會拒絕，不必刪除測試歷史。
- 秘密外洩需撤銷兩側配置並安全處理，不把 hash 當作無害可公開值。
- Schema56 是 forward-only；部署前須另核准備份／rehearsal／相容 release。**不得直接退回最大只支援 schema55 的 `5d98a04` API**，也不得以舊 snapshot 覆蓋新寫入或編輯 0055。停用後使用 schema56 相容 release 或 fix-forward。

## 本地驗證入口

僅既有 Node24／PG17、隔離 0700 `/tmp/venue-debug-integration-*`、Unix socket、synthetic data。腳本以 `env -i` 清除 DB／provider 環境，不讀 `.env`、不採用未知 DB URL，cleanup 驗 marker／owner／PID／port。

```sh
bash scripts/test-venue-debug-local-pg.sh migration
bash scripts/test-venue-debug-local-pg.sh focused
bash scripts/test-venue-debug-local-pg.sh full
```

實際 pass／skip、commit 與限制見 [交接紀錄](venue-cks-debug-verification.md)。未做真 LINE／實體手機／正式 PG16 驗收；本地通過不代表正式功能已開放。
