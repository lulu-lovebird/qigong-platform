# Venue test scope schema57：本地驗證與父代理交接

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 來源與交付界線

- 獨立 SSH clone：`/tmp/qigong-venue-test-scope-20261027`（canonical `/private/tmp/qigong-venue-test-scope-20261027`）。
- Branch：`feature/venue-test-scope`；base **`638e8d1661939b69402a97213f87d6bc1e36851a`**，接手 clean、正式 schema56。
- 唯一 writer，沒有子代理；只 local development／isolated tests／local commits。不動舊 checkout、舊 metadata、AGENTS、manifest／lockfile／依賴、不 push／merge／deploy／建遠端 PR／刪 worktree。
- 沒有 SSH／prod／phone DB／DO／Cloudflare／LINE API／Console／Rich Menu／Tailscale／external worker；fixtures 只有合成身份、GPS、短效憑證。沒有產生正式 token、建立正式配置或啟用任何 flags。
- 按已核准計畫直接執行，每批≤5檔，測試後才 local commit。結構安全 SQL／ACL 仍需父代理審查；此 harness 沒有可呼叫的 `allow_tool: false` hook，未假稱已執行 hook veto。

## 批次與 commits

| 批次 | Commit                      | 檔案數／範圍                                                                                                   | 當批證據                                                                                     |
| ---- | --------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| B1   | `eec72cb`                   | 4：0057 SQL、DB repository／renumber tests、API debug PG chain                                                 | static 3 pass；PG migration 1 pass／11 intentional skip，後續全部補跑                        |
| B2   | `7b1eed6`                   | 5：debug config、QR API、app、suite readiness、debug unit tests                                                | unit 13 pass；debug PG 12 pass                                                               |
| B3   | `03d84ac`                   | 5：checkin page、onboarding、app public scope wiring、debug UI／checkin VM tests                               | UI／QR／checkin 143 pass                                                                     |
| B4   | `f2ed07a`                   | 5：suite unit／integration、management／people／QR PG tests                                                    | readiness 32 pass；focused PG 49 pass                                                        |
| B5   | `b0befad`                   | 2：兩碼 debug PG 強化、history PG chain                                                                        | focused PG 58 pass；history PG 17 pass；strict source＋tests tsc pass；首輪 full verify pass |
| B6   | `c793798`                   | 4：移除過時 CKS-only 常數、server-render／pagehide UI tests、debug PG page tests、static exact SQL delta tests | SQL static 3 pass；debug unit＋UI 26 pass；debug PG 21 pass；strict tsc pass                 |
| B7   | `c0f7b3b`                   | 1：PG chain 以 schema56 正常入口產生非空正式 attendance／audit 再升級                                          | debug PG 21 pass，舊 audit 非空且升級後逐 row 相等                                           |
| B8   | 本文件所在 docs-only commit | 2：本交接與 `venue-distance-debug.md`                                                                          | 格式與最終驗證見下方                                                                         |

完整清單：`git diff --name-only 638e8d1..HEAD`；不是一次提交全部檔案。B5 diff 中既有測試重縮排來自 configured Prettier 對 `it.each` callback 的格式化，沒有刪除原安全 assertions。

## 精確契約與預期 metadata delta

操作契約見 [venue-distance-debug.md](venue-distance-debug.md)。

- `tw-location-test` 僅接受短效碼 test check-in；沒有 header 的 API／direct runtime SQL normal entry 在寫入／重播前明確 `venue_test_code_required`。錯 header、off、過期、wrong scope／hash／expiry 回 `venue_debug_denied`，沒有 standard fallback。
- Config type 是兩個 literal code 的 union，但 singleton row／每個 token 同時只能綁一碼；非 null／非 array／非 wildcard／非 multi。期限≤60min，canonical ms expiry 與 proof 精確綁定。
- 0057 首先撤銷舊 secret row，不搬移權限、不建立 enabled row／token。0001–56 byte 不變，migration registry 是 filesystem enumeration，未瞎改 registry。
- 新 migration 只預期以下 metadata／data delta：
  1. `platform.venue_debug_config_venue_code_check` 改兩碼 enum，舊 config row 刪除。
  2. `platform.venue_qr_checkin(text,text,double precision,double precision)` body 多 test-site early denial。
  3. `platform.venue_debug_checkin(text,text,double precision,double precision,bigint,bigint,text)` body 的輸入 enum 擴兩碼，獨立 configured equality／HMAC-ms／nonce／issued window／advisory recheck 保留。
  4. `venue_debug_insert` WITH CHECK 精確綁 enabled、未過期配置場地。
  5. Ledger 新增0057；其餘 body、function OID／ownership／ACL／security-definer／search_path／row_security metadata 不變。
- Static safety test 精確比較 normal DDL 等於0055＋單一 early denial，debug DDL 等於0056＋enum／OR REPLACE；不以鬆 regex 或整段模糊 runtime replacement 掩蓋差異。
- PG chain 比對全體 platform／admin／core／identity／audit function metadata 不變；變動 body 精確只有上述兩入口。policy 數量不變，改動精確只有 `venue_debug_insert`。
- 不擴 admin grant／runtime 表 ACL／normal INSERT policy；normal writer 仍沒有 `is_test`／`verification_mode` INSERT 權限。Debug／region guard 角色、narrow ACL、FORCE RLS、PUBLIC exclusion 保持。
- 歷史 test SELECT 兩碼保持；正式舊 rows 不回寫、不刪除。只保存 derived distance，raw GPS 欄位 NULL；test／formal 同日獨立冪等，無日課副作用。
- UI 根據 server-selected public scope，test site 必顯「僅供測試，不計正式出席」，off／expired／mismatch 無普通 submit；matching 強制 test，CKS 明確 opt-in 且 normal GPS 可用。三語、fresh SDK credential、偏好、busy 防重送、pagehide／language token 清理皆保持。

## 環境與 guard 證據

- 既有 Node **24.22.1**：`/opt/homebrew/opt/node@24/bin`；既有 PostgreSQL **17.11**：`/opt/homebrew/opt/postgresql@17/bin`。
- 初次 setup 依核准執行 `pnpm install --frozen-lockfile --offline --ignore-scripts`；223 packages reused、0 downloaded。沒有網路安裝／更新 dependency manifest／lockfile。
- API `@qigong/config`、`@qigong/database`、`@qigong/identity` realpaths 均為此 clone 的 `packages/*`；無舊 worktree symlink／舊編譯借用。
- 全部測試子程序 `env -i`，只保留受控 HOME／PATH／LANG／LC_ALL／TZ；不讀 `.env`，不採用 inherited `DATABASE_URL`／`TEST_DATABASE_URL`。Full script 的 `TEST_DATABASE_URL` 只來自它自行建立的 disposable cluster。
- 既有 harness fresh 0700 alnum `/tmp/venue-debug-integration-*`，socket-only、`listen_addresses=''`、socket 0700、host auth reject；驗 owner／marker／PID／data dir／socket／port 後 cleanup，不連未知 DB。History suite 同樣自建受 guard 的 fresh local PG。
- Fixture／SQL diagnostics 不輸出合成 token、hash、credentials 或 raw GPS；PG log 有拒絕事件、negative leakage assertions 實跑。這不是正式 proxy／provider logging 驗收。
- 環境恢復使用 **0／2**；無測試失敗修復回圈，無同 root cause 三連無進展。兩次 exact edit 匹配失敗是未寫檔的工具定位修正，沒有降低任何 assertion。舊 release 的恢復額度未沿用／重置。
- 既有 PG16 `initdb` 不存在，**PG16 未執行**；沒有安裝 server／拉 image／借既有 container。

## 實際驗證

首輪 `b0befad`：`bash scripts/test-venue-debug-local-pg.sh full` **PASS**，包含 workspace prebuild、`pnpm verify`（format／lint／typecheck／tests／build）、`tsc -p tsconfig.eslint.json --noEmit` 與 `tsc -p tsconfig.receipt-health.json --noEmit`。
當時 config 2、identity 6、database 561 pass／10 skip、API 2574 pass／58 skip。B6 後 targeted static／UI／PG／strict tsc 均 pass。

最終程式點 **`c0f7b3b`**（B8 只有文件）再次實跑：

- `bash scripts/test-venue-debug-local-pg.sh full`：**PASS**。workspace prebuild、`pnpm verify` 的 format／lint／source typecheck／tests／build、strict source＋tests `tsc -p tsconfig.eslint.json --noEmit`、receipt `tsc -p tsconfig.receipt-health.json --noEmit` 全通過。
- Full：config **2 pass**、identity **6 pass**、database **564 pass／10 skip**（54 files）、API **2577 pass／58 skip**（103 passed files／4 skipped files）；合計 **3149 passed／68 skipped**。Skip 不是 pass：DB 10 為既有隔離分支門控；API 58 為四套獨立 PG suites，在 focused 入口同一程式已全數實跑。
- 最終 focused：**58 passed／0 skipped**；獨立 history PG：**17 passed／0 skipped**。
- 最終 9 套 UI／language／API／readiness：`line-venue-history`、`learner-pages`、`line-invite-pages`、`line-venue-checkin`、`venue-debug-ui`、`venue-qr`、`venue-debug`、`venue-suite`、`venue-suite-integration`，**365 passed／0 skipped**。
- `git diff 638e8d1 -- migrations` 只有新增0057；AGENTS／package.json／pnpm-lock.yaml 未改。文件證據追加後再跑 formatter／format check／targeted SQL 與 UI tests，local commit 後檢查 clean。

### 隔離 PG 實際覆蓋

- `bash scripts/test-venue-debug-local-pg.sh focused`：debug **21**、management **16**、people **11**、QR **10**，合計 **58 passed／0 skipped**。
- `env -i ... pnpm --filter @qigong/database exec vitest run tests/venue-history-postgres.test.ts`：**17 passed／0 skipped**。
- Debug suite 真從原56 artifacts 執行，再載入合成 enabled 舊 config、test／formal attendance、audit／venue fixture，升57只套一檔；原56 ledger checksum 不變，原 attendance／audit／venue rows 相等，舊 config 清空，repeat applied=[]。
- 無 header 的 normal HTTP／DB direct call 不論 API off／CKS scope／test scope 都拒測試場，且已存在正式 attendance 也不能 replay 成功。
- 兩碼 parameterized cases 分別做正確 scope、錯另一碼、錯 key、API／DB expiry差1ms、off／expired、stale／future issued、missing GPS、LINE claim／核准／身份／同意／channel、inactive venue／全階 hierarchy／day window／past cutoff deny；另共通案例直接檢驗錯 nonce／forged proof。
- CKS normal／test 同日並行與重試分離；兩碼 test history 可讀本人且無正式 totals；兩碼 test rows 對 formal history／admin read／CSV／people／detail／rollups 不可見；日課 metrics／checkins／badges／jobs／achievement transitions 不變。
- Startup readiness 獨立拒 missing EXECUTE、unsafe owner role、disabled FORCE RLS／region guard ACL；runtime 無 config／context／direct table／internal helper／SET ROLE 權限。
- Server page 選擇 scope／expiry 隱藏 controls、三語 notice、forced test mode、真 GPS header-only、fresh SDK、切語言／pagehide 清碼、busy 防重送與不接受 formal DTO 均有 VM／router 證據。

### 本地暫存 logs（不提交）

- `/tmp/venue-scope-b1-pg.log`、`/tmp/venue-scope-b2-pg.log`、`/tmp/venue-scope-b3.log`、`/tmp/venue-scope-b4-pg.log`。
- `/tmp/venue-scope-b5-pg.log`、`/tmp/venue-scope-b5-history.log`、`/tmp/venue-scope-b5-tsc.log`、`/tmp/venue-scope-b6-pg.log`。
- 首輪全量：`/tmp/venue-scope-full.log`；非空 audit 補驗：`/tmp/venue-scope-b7-pg.log`。
- 最終：`/tmp/venue-scope-final-full.log`、`/tmp/venue-scope-final-focused.log`、`/tmp/venue-scope-final-history.log`、`/tmp/venue-scope-final-ui.log`。
- 暫存 logs 為合成本地證據，不含真實 secrets／個資，不是可移植的 production evidence。

## 版本／撤銷／rollback 與父代理待辦

- 此 clone 的 app max57；debug-enabled exact57；debug-off 保留審過56相容，unknown58拒。所有正式開關、stage2 Origin、official LIFF／Endpoint／LINE Console 仍未變更。
- Schema57 forward-only；撤銷用 DB disabled／刪 config、API off／移除秘密或 expiry。保留既有 test／formal history，不使用清除 attendance 作回退。
- **base `638e8d1` API max56，升57後不能直接退回。** 需另備已驗證 schema57-compatible feature-off baseline 或 fix-forward；本輪沒有完成／冒稱 fallback release、production rollback 或 deploy rehearsal。
- 不編輯已發布 SQL、不 down migration、不回灌舊 snapshot 覆蓋新寫入。
- 父代理須以 base..最終 HEAD 全 diff 做 cross-family security review，特別審 SQL static DDL／ACL、test-only deny、scope／expiry proof、UI memory、readiness compatibility；此唯一 writer 沒有開子代理，**未宣稱已有獨立 review**。
- 父完成 review／整合／驗證後才自行 push／建立 isolated test PR；本輪不 push、merge 或 deploy。
- **未驗**：PG16、實體手機／真 GPS／真 LINE SDK OAuth、正式 logging／APM／proxy、正式 rollout／token delivery／activation／rollback。PG17／VM pass 不等於這些已完成。
- 最後交付 clean local HEAD；保留 clone 供父 inspect，不刪工作目錄。
