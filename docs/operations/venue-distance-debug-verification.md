# Venue distance debug：本地交付驗證

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 工作區與提交

- branch：`feature/venue-distance-debug`
- base：`f58b224`（接續原 worktree，沒有開新 worktree）
- 最終程式提交：`50aab0d`；本文件與操作指南另為最後 documentation commit，可由 `git log` 取得最終 HEAD。
- 原有 4 檔未提交草稿先完成審視／驗證再提交，沒有覆寫或遺失。`AGENTS.md` 未修改；依使用者已核准每批最多 8 輪、同根因連續 3 輪無可驗證進展停損。

| 批次                    | local commit   | 檔數 | 結果與修復迴圈                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | -------------- | ---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 DB 草稿               | `31f0165`      |    4 | 初始 PG 5 pass / 1 fail：NUMERIC 是字串，不是距離演算法失敗。1 次修復：驗證十進位格式再 Number 轉換，新增真實球面距離精度 assertion；PG 6/6 pass。                                                                                                                                                                                                                                              |
| 2 API proof             | `dcc8472`      |    3 | QR + debug 47/47 pass。1 次修復：測試 mock 未使用參數的 ESLint 錯誤；formatter/lint/tsc pass。                                                                                                                                                                                                                                                                                                  |
| 3 config/readiness      | `48cdf65`      |    5 | 1 次修復：既有 startup spy 的三參數契約不應收到額外 false；保留 feature-off 呼叫形狀。相關 115/115 pass、tsc/lint/formatter pass。                                                                                                                                                                                                                                                              |
| 4 LIFF/history          | `2f80359`      |    5 | 無失敗修復；相關 202/202 pass、tsc/lint/formatter pass。                                                                                                                                                                                                                                                                                                                                        |
| 5 UI tests              | `12e982d`      |    3 | 1 次修復：測試 RequestInit body stringification 的 lint 問題，改為精確字串型別；147/147 pass、full source/tests tsc pass。                                                                                                                                                                                                                                                                      |
| 6 真 PG/API/stats       | `e2b627d`      |    5 | 2 次修復迴圈，均有可驗證進展：export fixture 不可多帶 page/limit（strict request）；inactive-person fixture 必須先關 channel，且使用合法 suspended 狀態；rejected application 必須移除 person 並有 reason。用正式 parser 解 union typing，不放寬 assertion。最終 dedicated 42/42 pass、0 skip；full source/tests tsc/lint pass。追加 nonce/ACL/FORCE RLS/context assertions 後 debug 9/9 pass。 |
| 7 55-chain expectations | `a5a9b74`      |    3 | 無失敗修復；history/static 20/20 pass，完整 `pnpm verify` 與兩份額外 tsc pass。精確新增 0055 期待值，不刪原 assertion。                                                                                                                                                                                                                                                                         |
| 8 server nonce          | `50aab0d`      |    3 | 無失敗修復；每次 debug 寫入用獨立 server UUID，mock 48/48、PG 9/9、lint/full source/tests tsc pass。                                                                                                                                                                                                                                                                                            |
| 9 docs                  | 本文件所在提交 |    2 | 操作／資料分類／限制與驗證紀錄；formatter、diff check 與最終 all harness 驗證。                                                                                                                                                                                                                                                                                                                 |

沒有批次超過 5 檔或 8 輪；沒有同根因連續 3 輪無進展；沒有 provider／工具缺失／程序崩潰事件或恢復重試。沒有刪除 assertion、降低 timeout、略過要求測試或變更 package/lock/CI。

## 最終執行結果

2026-10-27，最後程式提交 `50aab0d` 後重新執行：

```sh
bash scripts/test-venue-debug-local-pg.sh all
```

此腳本以乾淨環境與既有 Node24/PG17 建立多個互相獨立、0700、marker/PID/port/owner 防護、socket-only `/tmp/venue-debug-*` cluster，成功後逐一停止並 cleanup，不採用未知資料庫 URL。

| 套件／步驟                       | Passed | Skipped |
| -------------------------------- | -----: | ------: |
| dedicated debug HTTP/DB/RLS/HMAC |      9 |       0 |
| dedicated settings/management PG |     12 |       0 |
| dedicated people PG              |     11 |       0 |
| dedicated QR PG                  |     10 |       0 |
| `pnpm verify` config             |      2 |       0 |
| `pnpm verify` identity           |      6 |       0 |
| `pnpm verify` database           |    561 |      10 |
| `pnpm verify` public-api         |   2469 |      42 |

- `pnpm verify` 合計 **3038 passed、52 skipped**。不是「零 skipped」。
- 其中 42 skipped 是四套需專用新 cluster 的 PG tests；上表 dedicated 階段已另外真正執行全部 42 passed，不能把 skipped 本身當作 pass。
- 剩下 10 是 `packages/database/tests/venue-attendance-security.test.ts` 原有明確 `describe.skip('PostgreSQL verification PENDING…')` 的歷史安全佔位項，仍未實作／執行。沒有刪改它們或宣稱所有情境都已證實。
- database suite 的獨立 personal history PG **17/17 passed**，包含在 561 內，不重複加總。
- formatter、全 repo ESLint、各套件 typecheck、build：全部 pass。
- `pnpm exec tsc -p tsconfig.eslint.json --noEmit`（完整 source/tests）與 `pnpm exec tsc -p tsconfig.receipt-health.json --noEmit`：全部 pass。
- `git diff --check`：pass。0001–0054 migration 與 base bytes 無差異；只有新增 0055。
- dedicated 55-chain migration execution 與第二次 idempotent no-op 均真正 PG pass。

## 已驗證的拒絕與成功路徑

- API 錯／空／重複 header、disabled config、到期、錯 venue、client boolean authority 拒絕；無 token 不走 debug function。
- LINE token 使用本地 mock verify response（沒有外部 API）：錯 audience／issuer／expiry 401；合法 LINE claims 才往 DB。active/approved person、identity/channel、同意、venue active、window 均仍拒絕非法請求。
- DB disabled／missing／expired config、偽造／stale／future proof、不同交易 nonce、GUC spoof、直接 table/context/key/role/function access 均拒絕。
- 實際遠距 GPS：debug success；普通遠距 outside_radius；近距正式 success。test/real 同時請求互不覆寫，正式重播不誤回 test。
- 正式 personal lifetime/month/day totals 與 entries 不含測試；本人 test view 只有已驗證本人的明確 test label，正式 totals 為零。
- admin read/export、people/detail/export totals 先驗證只有 test 時為零，再加正式一筆後驗證為一；test 不進 CSV。日課 metrics/checkins/badges/jobs/achievement transitions 不變。
- header/body/SQL errors 不回顯認證資料或原始 GPS；實際 API logger、audit JSON、合成 PG server log 均驗證無 fixture secret、identity token、原始 GPS。原始 GPS 欄位 NULL；derived distance 精確驗證。
- NOLOGIN／NOBYPASSRLS／非 table owner／無 membership、精確 API-only EXECUTE、FORCE RLS 與 context 清理均真正 PG 驗證。
- LIFF VM 測試驗證點擊前不取 GPS、不發送，人工輸碼清空、只送 header、真實 GPS 不改寫、不使用 storage/console；成功 label、日課純連結與正常模式保留。這不是實體手機瀏覽器測試。

## 未完成／啟用前必要條件

- 無正式 token／DB enable config，功能保持 default-off；未部署／push／merge，也未接觸 `.env`、phone/正式 DB、SSH、DO、LINE Console、Rich Menu 或其他 worktree。
- 需要獨立安全審查（本次只有上下文內自審與本地測試，不宣稱跨模型或外部獨立審查）、實體 LIFF/LINE 驗收，以及外層 proxy/DB logging/redaction 和 secret 發放／撤銷流程核准。
- 操作設定與資料分類詳見 [venue-distance-debug.md](venue-distance-debug.md)。可能共用 composition-root 整合衝突：`apps/public-api/src/app.ts`、`index.ts`、`venue-suite.ts`；沒有修改 shared admin-auth 或 admin UI pages。
