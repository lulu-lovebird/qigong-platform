# Venue debug + admin：本地整合驗證

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 範圍與交接狀態

- Branch：`feature/venue-debug-admin-integration`；獨立 worktree，自 `origin/main@f58b22441b80a40036200f5712af9110bc525722` 開始。
- 最後程式／測試提交：`bf2d97f`；文件提交另列於 `git log`，實際交接 HEAD 用 `git rev-parse HEAD`。
- 來源：debug `8b2bf3a`（9 commits）、admin `b74487c`（5 commits），共同 base `f58b224`。逐筆審 diff、`cherry-pick -x`，沒有一次 merge 26 檔或整檔覆蓋共享功能。
- 不修改此 worktree 的 `AGENTS.md`；不操作父 checkout，更沒有覆寫、提交或 stash 父 checkout 已批准的 AGENTS 草稿。每批最多 5 檔、每批最多 8 修復輪，同根因連續 3 輪無進展停損；本輪均未達停損。
- 只本地提交。沒有 push、遠端 merge、PR 建立、deploy、SSH、DO、正式／phone DB、`.env`、外部 LINE、Rich Menu、Console、Tailscale、代理、全域工具安裝或刪除 worktree。未建立正式測試碼、secret 或 owner enable config。
- 既有 Node24、PG17、pnpm cache；`pnpm install --frozen-lockfile --offline` 重用 cache，下載 0；沒有新增 dependency、manifest 或 lockfile 差異。

## 來源 → 整合提交與逐批驗證

| 批次                           | 來源      | 整合 SHA  | 檔數 | 本輪實際驗證                                                                                                                                            |
| ------------------------------ | --------- | --------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 DB                          | `31f0165` | `4a1be09` |    4 | 隔離 PG 6/6；formatter。另以 `881c57c` 限縮 integration cluster prefix（2 檔）。                                                                        |
| D2 API                         | `dcc8472` | `a5a62b8` |    3 | debug + QR 47/47；formatter。                                                                                                                           |
| D3 composition/readiness       | `48cdf65` | `aaccee6` |    5 | debug + suite 16/16；formatter；後續 startup privacy 48/48。                                                                                            |
| D4 LIFF/history                | `2f80359` | `1679461` |    5 | history、QR、startup privacy 227/227；formatter。                                                                                                       |
| D5 UI tests                    | `12e982d` | `c301fde` |    3 | history + debug UI 147/147；formatter。                                                                                                                 |
| D6 HTTP/PG/stats               | `e2b627d` | `21e7786` |    5 | 四專用 PG 42/42、0 skip；formatter。人工解 script prefix 衝突，保留新 runner 與 integration guard。                                                     |
| D7 55-chain                    | `a5a9b74` | `118e5fa` |    3 | 真 PG history + static 20/20；formatter。另以 `56404ed` 限縮 history cluster prefix（1 檔）。完整 migration apply/repeat 在 full 另驗。                 |
| D8 server nonce                | `50aab0d` | `489cf32` |    3 | debug + QR 48/48、真 PG debug 9/9；formatter。                                                                                                          |
| D9 source docs                 | `8b2bf3a` | `67de593` |    2 | formatter、diff check。來源驗證數字不是本整合版數字。                                                                                                   |
| A1 settings                    | `0daba96` | `7fa1f15` |    2 | settings controller 22/22；formatter。                                                                                                                  |
| A2 capabilities                | `9ce026c` | `87ae451` |    4 | suite/controller 43/43，四專用 PG 42/42（含新增 capability 真 SQL assertions）；formatter。共享 management test 保留完整 55-chain 與 admin assertions。 |
| A3 people                      | `f417ea3` | `58ab49b` |    2 | people + suite 28/28；formatter。                                                                                                                       |
| A4 transports                  | `85211ae` | `41c5021` |    3 | settings + people + suite 53/53；formatter。                                                                                                            |
| A5 source docs                 | `b74487c` | `d9bd72d` |    1 | formatter。                                                                                                                                             |
| C1 audit correlation           | —         | `2163a1e` |    5 | debug/QR/log privacy 134/134、真 PG debug 9/9；ESLint、完整 source/tests tsc、formatter。                                                               |
| C2 integrated readiness/scopes | —         | `122c6d6` |    2 | suite 21 + capability 6 passed，四專用 PG 44/44；ESLint、完整 source/tests tsc、formatter。                                                             |
| C3 live HTTP + runner          | —         | `bf2d97f` |    2 | 真 PG debug 9/9，含新增 HTTP 拒絕 assertions；ESLint、完整 source/tests tsc、formatter。runner 全套與 compiled worker 實測通過。                        |

逐批失敗與修復均保留 assertions：D1 guard 尚不接受 integration prefix，補精確 prefix 後 6/6；D4 startup 測試缺 package build，建置既有 packages 後 227/227；D6 三檔新增 guard 需 Prettier；C1 audit 是不可變、跨測試保留，改為排除測試開始前既有 request UUID 後驗證新寫入恰為兩筆；C2 修正測試 signature 的 schema 名稱及 pg 不支援多 statement prepared query，逐項恢復綠燈；C3 身份撤銷 fixture 必須先關 interaction channel，遵守既有 trigger 後通過。沒有刪除／skip assertion 或放寬 production 安全條件。

第一次 full 的 compiled worker symlink smoke test timeout：fresh worktree 尚無 API `dist`，`verify` 的 build 位於 tests 之後；不算完整成功，也不是 baseline 豁免。runner 最小補 `pnpm build` 在 verify 前，第二次 full 的該 11-test runtime suite 真正通過。沒有提高 timeout、改測試 assertion 或跳過 CLI。沒有 provider incident／重試；各根因最多 1 次修復後有可驗證進展，未達 8 輪或同根因 3 輪無進展。

## 最小 audit correlation 修復

選擇 **安全 UUID 映射日誌**，沒有增加 SQL 參數、metadata 欄位或新 proof 版本：

1. HTTP `x-request-id` 仍經既有嚴格 UUID 驗證；CRLF、測試碼、identity token、過長輸入改用 server UUID，不把原 header 寫入 log。有效 client UUID 可以重複，不能當 authentication 或全球唯一證明。
2. 通過 token 與 identity 初驗後，每次 debug write 仍用全新 `randomUUID()` 作為 DB transaction request ID。HMAC 繼續綁此 nonce、已驗證 subject、venue、issued seconds；絕不重用 client request ID 作 proof authority。
3. `VenueDebugRequestLogger`（`apps/public-api/src/venue-qr.ts`）為 request-scoped、同步、只收 `{readonly auditRequestId: string}` 的具體 callback；沒有 header、body、subject、token、hash、proof、GPS 或 exception 參數。callback 回傳不參與授權，sink throw 也不改寫入結果、不重試或輸出 raw error。
4. 真 route 透過已受限的 `request.log` 發出 `venue_debug_audit_attempt`。既有 binding 的 `reqId` 對應 HTTP response header，新 `auditRequestId` 對應 DB `audit.events.request_id`。privacy boundary 只在此 event 接受 own-data、嚴格小寫 UUIDv4 欄位；其他 event、getter、prototype、陣列、任意字串皆丟棄。
5. event 是 **attempt**，不是成功／commit 保證。DB 拒絕或 rollback 可有映射而無 success audit；正式模式／錯測試碼不發此事件。logger disabled、threshold 過高或 sink 故障時映射可能不可得，需查核日誌保留配置，不能宣稱 durable tracing。原 audit 不受此限制影響。

真 PG 證據：同一個 inbound HTTP UUID 連續成功與 replay，兩個 response 都保留 HTTP UUID；新 success audit 恰兩筆、`replayed` 分別 false/true、DB UUID 互異且不同於 HTTP UUID；兩筆 log 精確對應各 audit UUID。另以真 mock SQL 算 HMAC 確認仍綁 DB nonce，跨 nonce proof 的真 PG 拒絕測試保留。日誌驗證無 fixture 原碼、hash、HMAC proof、identity token、raw GPS；HTTP 注入與 logger callback throw／invalid mapping 的負向測試通過。

`0055` 未修改，故專用 proof 及函式 signature 完全不變；沒有悄悄放寬 schema、caller bypass 或可由 attacker 指定 nonce 的 correlation 參數。已發布 `0001–0054` 與 base bytes 完全相同；`0055` 也與來源 `8b2bf3a` bytes 相同。

## 整合契約與真測覆蓋

- 預設全部 off；debug 只在精確 0055 且各 capability 證據完整時 ready。54 的 debug-off QR／history／management／people 保留相容；同號未知及 0056 future 拒絕。54/55 HTTP composition 矩陣是 mock schema 證據，真 PG 本輪是完整 55-chain，不冒稱重建真 PG54。
- 真 PG 獨立撤銷 history、management、people、debug 的 runtime EXECUTE，逐一得到正確 feature not ready，恢復後 ready；debug context 取消 FORCE RLS、owner role 改 LOGIN 也 fail closed，全部 finally 還原。
- 真 HTTP + 合成 LINE verify transport：audience／issuer／expiry、錯碼、錯 venue、API config expiry、revoked identity、active person、approved application、active interaction channel、必要 consent、venue active、開放 window 皆拒絕；拒絕後不多寫 attendance 或 success audit。無 token 遠距仍 outside radius；debug 用真實遠距 GPS，近距正式簽到與 test/real 並行自然鍵互不覆寫或卡位。
- `tw-location-test` 才可豁免距離；兩側 enable／expiry 與 HMAC server nonce 保留。正式 RLS rollups／history totals／admin detail／CSV 排除 test，獨立 own test tab 明標，不加入日課 checkins、metrics、badge、jobs 或 achievement transitions。
- UI/admin-auth 的 field-only reader、field manager、people reader、export-only 維持各自 scope；真 PG 驗證 field read/manage 不推導 people read/export、跨區拒絕、inactive operational region 隱藏 capability、session revoke 即時失效。VM→Fastify 與真 SQL CRUD/version/CSRF/Origin/settings/people/history/舊 QR 回歸保留。
- 沒有 k5 或新增姓名限制，沒有跨國次數限制；NFC 與 manual add/void 仍關閉。QR 仍只有網址文字牌，未造 QR bitmap、未外送第三方或加未批准 encoder dependency。

## 最終驗證命令與結果

使用既有 Node `24.22.1`／PG `17.11`／pnpm `10.15.1`：

```sh
env -i HOME="$HOME" PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin \
  LANG=C LC_ALL=C bash scripts/test-venue-debug-local-pg.sh all
```

runner 清除 inherited DB/provider 環境；只用新建 0700 `/tmp/venue-debug-integration-*`、Unix socket、無 TCP cluster，marker／owner／PID data/socket/port 核對後自動 cleanup。history 專用 fixture 亦只建此前綴；不採未知 `TEST_DATABASE_URL`。full URL 只由本輪新 cluster 組合，沒有讀 `.env`。

| 執行                                        | Passed | Skipped |
| ------------------------------------------- | -----: | ------: |
| dedicated debug HTTP/DB                     |      9 |       0 |
| dedicated management/settings/capability    |     14 |       0 |
| dedicated people                            |     11 |       0 |
| dedicated QR                                |     10 |       0 |
| verify config                               |      2 |       0 |
| verify identity                             |      6 |       0 |
| verify database（含真 PG history 17）       |    561 |      10 |
| verify public-api（含 receipt CLI/runtime） |   2487 |      44 |

- 四專用套共 **44 passed、0 skipped**；全 workspace **3056 passed、54 skipped**。54 skips 中 44 是四專用套在 generic URL run 有意不跑，已用專用 fresh clusters 真跑 44/44；另 10 是既有 `venue-attendance-security.test.ts` PENDING 清單，仍未實作／執行，不冒稱全部安全情境都已證實。
- 55 migrations 真 apply、精確清單與 repeat no-op 均通過；沒有刪 migration assertion。
- `pnpm verify` 的全 repo formatter、ESLint、workspace typecheck、tests、build 全過；完整 source/tests `tsc -p tsconfig.eslint.json --noEmit` 與 receipt CLI `tsc -p tsconfig.receipt-health.json --noEmit` 全過。
- `git diff --check` 通過；`AGENTS.md`、manifest／lock、0001–0054 migration 與 base 無差異；本輪新 cluster 全部 cleanup，無殘留。
- 最後程式提交後與本文件格式化後再次執行上述 `all`，完整 exit 0；真測數字如上。

## Review 與仍未驗證項

- `venueintegration-security`：獨立上下文、不同模型家族 `cliproxyapi/gemini-3.8-flash-high`，對 `2163a1e` vs `f58b224` 做唯讀 code review，沒有 actionable P0–P2 findings。檢視 nonce/HMAC、UUID-only callback/log boundary、scope、RLS；不是 reviewer 親自執行 PG 的證據，真測由本輪 runner 執行。
- 沒有可呼叫的 `allow_tool: false` hook；未聲稱已觸發／通過該 hook。父最後檢查與另一輪 cross-family review 仍待父決定；本輪 review 不取代後續核准。
- PG16、真 LINE provider、手機／實體瀏覽器／讀屏驗收尚未執行。沒有部署或啟用功能；外層 proxy／DB logging、secret owner provisioning／撤銷、安全日誌保留及正式啟用需獨立批准。
- Potential future PR 僅為本地整合候選，尚未建立／push；0055 未發布。若之後發布，不能再覆寫已發布 migration；本輪不提供 destructive downgrade。

Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
