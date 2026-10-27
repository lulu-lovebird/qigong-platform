# CKS Debug schema56 本地驗證與父代理交接

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 來源與邊界

- Worktree：`/Users/myhsu/.herdr/worktrees/qigong-platform/feature-venue-cks-distance-debug`（沿用保留 workspace，未建立新 worktree）。
- Branch：`feature/venue-cks-distance-debug`；base：`5d98a045c8e6dae3ded163ceea5cf5d92d29a1f8`；接手時 clean、無新 commit。
- 本輪僅 local commits／隔離測試，父代理負責安全 review、整合與後續 push／PR；本輪沒有 push、merge、部署、prod SSH、正式 token／flags、LINE Console／Rich Menu 或子代理。
- 不改 `application-page.ts`、`line-venue-history-page.ts`、language tests（另一 `venue-pref-ui` writer 所有），也不改主 checkout 或本 worktree 的 AGENTS。
- Node24、PG17 使用既有 Homebrew tools。依批准執行 `pnpm install --frozen-lockfile --offline --ignore-scripts`：223 packages 全部本機重用、0 downloaded；package／lockfile 不變。API 的 `@qigong/config`、`database`、`identity` realpath 均位於本 worktree `packages/`；編譯由本 worktree 完成，沒有借外部 workspace 舊編譯。

## 本地 commit／批次

每批最多五個檔案，批間有對應測試，未修改已發布 migration。

| 批次         | Commit            | 檔案與結果                                                                                                                                                                                                                                                          |
| ------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1           | `e7fda7d`         | 新 SQL0056；`repository-migrations.test.ts`、`venue-renumber-integration.test.ts`、`venue-debug-postgres.test.ts`、`test-venue-debug-local-pg.sh`。PG migration targeted 1 pass／9 intentional skip；static migration artifact 3 pass。中間狀態未宣稱完整 PG 通過。 |
| B2           | `71ba30c`         | `venue-debug.ts`、`venue-qr.ts`、`app.ts`、`venue-suite.ts`、`venue-debug.test.ts`。單元 10 pass；API／DB CKS binding、canonical expiry、七參數 proof、schema55 feature-off 相容。                                                                                  |
| B3           | `124e04d`         | `line-venue-checkin-page.ts`、`venue-debug-ui.test.ts`、`venue-suite.test.ts`、`venue-suite-integration.test.ts`、`venue-debug-postgres.test.ts`。UI／readiness integration 33 pass，debug PG 12 pass。                                                             |
| B4           | `f7bcb66`         | 管理／people／QR PG tests 與 database `venue-history-postgres.test.ts`。Focused PG 49 pass／0 skip；獨立 history PG 17 pass／0 skip。                                                                                                                               |
| B4 全量修復  | `e1c5472`         | `isolated-venue-roles.setup.ts` 加入新 guard 的固定 orphan cleanup allowlist；保留 preexisting／referenced role 與 cluster opt-in 防護。全量 verify 通過。                                                                                                          |
| Logging 補驗 | `5e29c91`         | `test-venue-debug-local-pg.sh` 加 `log_error_verbosity=terse`；`venue-debug-postgres.test.ts` 直接檢查 PG server log 有拒絕事件、無合成原碼／hash／identity credential／原始 GPS。Focused 再次 49 pass／0 skip。                                                    |
| B5           | 本文件所在 commit | 更新 `venue-distance-debug.md` 與新增本交接文件；無程式或依賴變更。                                                                                                                                                                                                 |

所有檔案路徑的完整清單可用 `git diff --name-only 5d98a04..HEAD` 取得。B1–B5 後應 clean；保留 worktree 供父代理 inspect／review，不自行清除。

## PG55 → 56 真實證據

`apps/public-api/tests/venue-debug-postgres.test.ts` 的 beforeAll 使用新建、0700、Unix-socket-only 的 PG17 cluster：

1. 從 staging directory 執行原 55 migrations。
2. 載入純合成場地／學員資料、舊場地測試 attendance，以及原 55 enabled config（僅 fixture authority）。
3. 執行完整 artifacts，只有 `0056_venue_cks_distance_debug.sql` 被新增套用。
4. 比對前 55 個 ledger checksum 全部相同；舊 attendance／場地 row 完全不變。
5. config row 清空；舊六參數 `to_regprocedure` 為 NULL；重跑 migration 無新增。
6. runtime 仍可讀本人舊 `tw-location-test` test history；無新 config 時 CKS 寫入明確拒絕。
7. 每個案例才由 isolated owner 配置短效合成 CKS row；runtime／worker 不可自我 provisioning。

12 個 debug PG 案例另證明：

- 正式路徑仍驗距離；Debug 用真實 GPS 算 distance，原始 GPS 不持久化。
- 並行正式／測試／重播冪等分離，正式不被覆寫。
- API／DB off／expired、錯場地（包含舊場地）、expiry 相差 1ms、偽造 proof、錯 nonce、過舊／過新 issued 全部拒絕。
- config 只允 CKS，有限期限不超過 60 分鐘、runtime 不可讀寫配置／context／internal helper 或 SET ROLE。
- 身分、LINE claims、核准、同意、channel、venue active、開放時段重驗；缺 GPS 拒絕。
- Operational／country／global 任一 inactive 拒絕。為單獨驗 guard 對不一致 hierarchy 的抵抗，該案例只在合成 DB 由 owner 暫停 USER triggers，finally 復原狀態與 triggers；正式 migration 沒有停 trigger。
- 本人測試歷史有標記；正式歷史、管理／people／detail、read／CSV totals 排除 test；日課 metrics／checkins／badges／jobs／achievement transitions 不變。
- HTTP logger 只記 nonsensitive request-ID correlation；API responses／logger 與 PG server log 不含 fixture 原碼、hash、credential 或原始 GPS。

## 實際執行／pass 與 skip

使用 `env -i` 的受控腳本，只建立 disposable DB URL、不讀 `.env`、不採用 inherited DB URL。

- `bash scripts/test-venue-debug-local-pg.sh migration`：最初 B1 **1 pass／9 skip**（只選 migration case；已由後續完整 12 cases 補驗）。
- `bash scripts/test-venue-debug-local-pg.sh focused`：最終 **49 pass／0 skip**：debug 12、management 16、people 11、QR 10。每套各自 fresh cluster。
- 獨立 `@qigong/database vitest run tests/venue-history-postgres.test.ts`（清空外部環境，指定既有 PG17 bin）：**17 pass／0 skip**。
- `bash scripts/test-venue-debug-local-pg.sh full`：**PASS**。包含預先 workspace build、`pnpm verify`（format／eslint／typecheck／tests／build）、`tsc -p tsconfig.eslint.json --noEmit`、`tsc -p tsconfig.receipt-health.json --noEmit`。
  - config：2 pass。
  - identity：6 pass。
  - database：53 files pass，561 tests pass／10 skip。10 skip 位於既有 `venue-attendance-security.test.ts` 的非啟用隔離契約分支，不冒稱通過。
  - API：103 files pass／4 files skip，2505 tests pass／49 skip。四套獨立 PG tests 在全量入口按環境門控跳過；**同一批 49 cases 已在 focused 入口全部實跑通過**。
- 本地全量輸出：`/tmp/venue-cks-full-verification.log`（臨時檔，不提交）。
- SQL formatter 不在既有 Prettier 支援範圍，初次單檔嘗試回報 no parser；沒有安裝 formatter 或手動重排。Repo `pnpm format:check` 已實跑通過。

修復紀錄：B2 首次 PG 顯示 region 表非 FORCE RLS 的錯誤 readiness 假設及舊函式 signature assertion；已改為 guard 欄位 ACL 檢查與七參數契約。B3 發現測試造 parent inactive 受既有 hierarchy trigger 阻擋、過期 fixture 不符合新 CHECK，已修正 fixture。B4 首次全量因新 guard 未清理而造成後續 suite 角色衝突，僅修 isolated orphan allowlist 後全量通過。無三輪同因無進展，無安裝／網路環境復原重試。

## 父代理特別審查點

- **`core.regions` 在既有 schema 沒有 RLS**。沒有為通過 readiness 而改全域 RLS；新 guard 僅四欄 SELECT＋僅回 boolean 的 SECURITY DEFINER helper、EXECUTE 僅 Debug role。定向 SELECT policy 已建立，但不宣稱未啟用 RLS 的表已受 FORCE RLS 保護。保留其他 identity／member role／global grants。
- API／DB expiry 是同一整數毫秒值，HMAC 含 expiry；schema56 不再採舊版「兩側期限較早者」。60 分鐘由明確 operator configuration 控制，API 額外驗 future ≤60 分鐘。
- 本輪僅 CKS；不能把 env 設定解讀為任意場地／多場地擴權。無 config 的初始狀態必定 off，舊配置被撤銷而不是自動搬移。
- 需跨模型安全 review、父整合語言偏好 writer 後再驗證；本輪未宣稱 UI 語言修復完成，也未創建 remote PR。
- **PG16 未跑、真 LINE／手機未跑、production logging 未確認**。PG17／mock provider 通過不等於這些驗收完成。

## 後續配置與回退（未執行）

精確設定名稱與操作契約見 [venue-distance-debug.md](venue-distance-debug.md)。新必要 env 名稱為 `VENUE_DISTANCE_DEBUG_VENUE_CODE`，沒有 secret 值寫入 artifacts。

後續需另批准 feature activation、受限人工 secret delivery、API＋DB 同一 expiry／hash／CKS 配置、外部 request／error 捕獲檢查；不以 health ready 推論配置存在。隨時 DB enabled=false／刪 config、API off／撤銷秘密或 expiry 可關閉；測試資料保留並隔離。

Schema56 沒有 unsafe downgrade。`5d98a04` 的最大 schema 是55，不可直接退回該 API 搭配56；預備相容 feature-off release 或 fix-forward。不得 edit 0055、恢復舊 snapshot 覆蓋新寫入或刪除出席來回退。
