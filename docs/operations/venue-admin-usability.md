# 團練場後台可用性補齊（本地交接）

> 下文「非 QR 圖片」文字牌與開關狀態是來源分支的歷史交接，不是現行功能或部署狀態。現行後台 QR 預覽、PNG 下載及 A4 列印流程以 [場地設定操作文件](venue-management-settings.md) 為準；實際是否上線仍須查看發行驗證紀錄。

此文件保留來源分支的歷史結果；本地整合版最新 SHA／55-chain／correlation 與驗證數字見 [venue-debug-admin-integration.md](venue-debug-admin-integration.md)。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 狀態與範圍

- Branch：`feature/venue-admin-usability`；base：`origin/main@f58b22441b80a40036200f5712af9110bc525722`。最終 head 以 `git rev-parse HEAD` 取得。
- 開始時工作樹乾淨。先讀 AGENTS、[整合 runbook](venue-history-admin-integration.md)、[設定契約](venue-management-settings.md)，再審實際 app／私有 admin auth／導航／兩個 renderer 與測試。
- CRUD、本人 history、人員 read/export **原本已接線**，不是本輪重寫。本輪補操作與安全提示缺口，不變更資料模型。
- 依父交接資訊，既有 schema 54 與來源已發佈，但正式功能開關全部關閉；本輪未遠端查證，也**沒有部署本輪 UI、開啟任何功能或修改正式設定**。舊文件的 standalone「未接線」敘述不是目前程式狀態。
- 本地 UI 已可在受控測試配置操作現有 CRUD/read/export；正式環境仍不應宣稱已開放。全部開關關閉時，場地／人員路由與 capability endpoint 不掛載（404），導航保持隱藏；不是成功空列表。

## 實際發現與補齊

### 場地設定

`apps/public-api/src/venue-management-page.ts`：

- 原唯讀 fieldset 整組 disabled，鍵盤無法聚焦／複製欄位。改為可檢視且文字欄位 readonly，啟停／排程 checkbox 與儲存仍停用；現有 UUID、永久 code 與 version 顯示保留。
- 停用現有 active 場地先確認，清楚說明舊 NFC／QR／link 無法簽到、已有出席保留。取消確認不發送寫入。
- 更新 409 或網路／無效回應造成未知寫入結果後，保留草稿及原版本、鎖住編輯／新增／重送，必須明確重新載入查核。不以重試自動覆蓋或假稱未提交。
- 新增使用**已成功驗證的查詢區域**，不因尚未提交的區域輸入修改而換掉來源授權範圍。移出區域的成功結果不混入來源區域清單。
- 載入錯誤顯示尚未成功載入，不與成功空結果混淆；保留錯誤／權限／重新登入／重載說明。編輯與新增後移動鍵盤焦點到場地 UUID／版本說明。
- NFC／QR／一般 URL 仍由可信 server origin + 永久 code + 固定 source 產生；copy 成功／手動選取 fallback 與列印保留。文字牌明標「非 QR 圖片」，移除已過時的 lookup 未接線提示。
- 地址、中心座標、半徑、IANA timezone、週排程、啟停、異動原因沿既有嚴格後端契約；已有出席禁止改 region/timezone 的保護未改。異動原因提醒勿填學員個資／心得。

### 導航與人員權限

`apps/public-api/src/venue-admin-capabilities.ts`、`admin-auth.ts`：

- 原 `GET /admin/api/venue-suite` 只回開關，所有已登入者都可能看到入口。現在同時驗唯一私有 session、active operational region 與現有 `admin.can_access_region`；無相關權限、關閉或查詢失敗不顯示導航。
- GET 回傳仍為 `{management, people}`，不改既有 dashboard wire shape。既有導航「團練場出席管理」及「場地設定」「人員／出席」連結直接消費結果；未修改共享 dashboard。
- 新增 `POST /admin/api/venue-suite/capabilities`，只接受 `{regionId: UUID}`；每次在交易內從 session 重新解析 principal、設定 context，回傳此區域的 `canReadPeople`／`canExportPeople`。只使用既有 authorizer 與區域 metadata，不讀學員／出席表、不創造新 DB contract。
- 私有 cookie 不離開 auth closure；唯一 43 字元 session／CSRF、exact trusted admin Origin、可選 Sec-Fetch-Site 同源限制、strict body／1KB limit／固定錯誤回應保留 fail-closed。格式錯誤不回傳 JSON 片段／SQL diagnostics。
- capability 只供 UI 提示；SQL 資料函式仍逐操作獨立重驗 session／action／region。read 不推導 export，export-only 使用者不必先取得 view。

### 人員／出席

`apps/public-api/src/venue-people-page.ts`：

- 先填區域 UUID、按「驗證區域權限」，讀取與 CSV 按各自權限啟用；停用旁有具體原因，不是可點但一定失敗的假按鈕。
- 保留月份、起日含／結束日不含、場地 UUID、姓名搜尋、排序、頁數與每頁數量；日期取代月份時不再被月份 HTML required 阻擋。
- 篩選變更立即清掉舊名單／學員明細／總計與分頁；換區域必須重驗，不能沿用上一區域的 capability。
- CSV 成功保留原查詢、明細與頁次，不跳頁或清空成功結果。超過 1000 筆清楚提示縮小範圍；401／403 清掉敏感結果及 capability，503／網路／無效回應可「重試原查詢」，不冒稱查無資料。
- 保留跨場去重日數、學員明細及「完整篩選結果、不是單頁／生涯總數」說明。
- 手機窄寬 grid 可縮至容器內；保留大字／觸控目標／焦點 outline／table caption／aria-live／skip link／CSP 精確 hash／企業 footer。人工補簽與作廢按鈕永久 disabled，附尚缺後端授權等原因；通用 busy 控制不會把它們打開。
- API 字串只走 textContent/value，不使用 innerHTML；不新增 browser storage、身份 token accessor、PII log、raw GPS、電話或心得蒐集。場地中心座標是既有設定，不是學員原始 GPS。

## 本地驗證

Node `v24.22.1`、既有 PG `17.11`、pnpm `10.15.1`。`pnpm install --frozen-lockfile --offline` 僅重用既有 cache；沒有下載、新依賴、manifest 或 lock 差異。

各批不超過 5 檔、順序修改、每次修改後跑相關測試，提交如下：

| commit     | 檔數 | 結果                                                                                    |
| ---------- | ---- | --------------------------------------------------------------------------------------- |
| `0daba96`  | 2    | 場地安全／唯讀操作，22 tests passed                                                     |
| `9ce026c`  | 4    | 權限導航／區域 capability，81 focused tests passed；完整 54-chain 專屬 PG 通過          |
| `f417ea3`  | 2    | 人員 UI 狀態，53 focused tests passed                                                   |
| `85211ae`  | 3    | renderer→VM→Fastify transport 與未知寫入結果回歸，89 focused tests passed（含 privacy） |
| 本文件提交 | 1    | 文件與最終交接                                                                          |

測試不是僅比對 HTML 片段：

- 場地／人員測試執行真實 renderer 序列化的 controller，mock DOM 對 innerHTML 寫入直接拋錯；涵蓋 literal hostile name、readonly、copy fallback、confirm/cancel、409／未知提交／pending 去重、頁次／明細／篩選／retry／獨立 export。
- `venue-suite-integration.test.ts` 使用真 `buildApp`、Fastify inject、mock SQL，並取得伺服器實際回傳的人員頁，再把其 script 放入 VM，fetch 轉發回 Fastify。驗證 live CSRF／Origin／cookies、read-only、export-only、CSV blob 回收及撤銷 session 後 disabled／清除資料。
- `venue-management-postgres.test.ts` 在真 54-chain 中加驗此區域 viewer、export-only、跨區拒絕與即時 session revoke capability；原 CRUD/version／已有出席凍結／CSRF／Origin／RLS 回歸仍保留。

```sh
# 只建立本次新 /tmp/venue-suite-* 0700 socket-only cluster；不採用 inherited DB URL。
env -i HOME="$HOME" PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin \
  LANG=C LC_ALL=C TZ=UTC PG_BIN_DIR=/opt/homebrew/opt/postgresql@17/bin \
  bash scripts/test-venue-suite-local-pg.sh focused

# 工具執行限時須 >= 300 秒；包含 pnpm verify + 全 source/tests 及 receipt CLI tsc。
env -i HOME="$HOME" PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin \
  LANG=C LC_ALL=C TZ=UTC PG_BIN_DIR=/opt/homebrew/opt/postgresql@17/bin \
  bash scripts/test-venue-suite-local-pg.sh full
```

- 最終 full exit 0：全倉 format:check／lint／workspace typecheck／tests／build，以及 `tsc -p tsconfig.eslint.json --noEmit`、`tsc -p tsconfig.receipt-health.json --noEmit` 全過。
- 全 workspace **3033 passed / 43 skipped**：config 2、identity 6、database 561 / 10 skipped、public-api 2464 / 33 skipped。
- focused 真 PG：history **17**、management **12**、people **11**、QR **10 passed**；工具測試 **25 passed**。API 的 33 個 marker 專屬 skips 已在 focused 另跑 33/33 passed，不把 generic URL run 的 skip 當 pass。
- 另外 10 skipped 仍是既有 security suite 的歷史 PENDING 清單；未刪除／轉成 pass，不聲稱全面安全性都由本輪證明。
- 首次 `all` 的 focused 及 database 測試通過，但工具 120 秒 timeout 中止了後半 API 全套；**該次不算完整成功**。改用 300 秒限時的 `full` 後全部通過。中止留下的自建 cluster 已額外核對本輪建立時間、owner、0700、marker、PID、data/socket/port 與 process command 後停止並清理；成功 runner 自行做 marker/PID 核對清理。最終無本輪 `venue-suite-*` 殘留。
- 中途 readonly 舊測試預期及新增測試的 strict query type／unused mock args／不必要 assertion 各在下一輪修正；沒有任何問題連續失敗超過 3 輪，未放寬 production 安全條件以通過測試。
- VM／inject／真 PG 不是實體手機、真瀏覽器／讀屏、LINE 或 PG16 證據；這些未執行。沒有獨立 security review／子代理，也沒有可呼叫的 `allow_tool: false` hook，不聲稱已觸發／通過。

## 父整合順序、衝突與未完成項

1. 依序整合上述 commits；**不要只拿人員頁而漏掉 capability module／auth endpoint**，否則驗權會 404 並誠實保持 disabled。CRUD/read/export 本身早已接線，本輪無其他待接資料 adapter。
2. 共享檔衝突清單：`apps/public-api/src/admin-auth.ts` 是必要私有 cookie 邊界，新增 import 與原 venue-suite gated block；`tests/venue-suite-integration.test.ts`、`tests/venue-management-postgres.test.ts` 可能與 debug 分支的 schema/readiness 回歸相鄰。父需人工核對，不自動覆蓋。
3. 未修改 `app.ts`、`index.ts`、`venue-qr.ts`、history API、任何 0051–0054 SQL；**沒有新增 0055**。`feature/venue-distance-debug` 的 worktree／檔案未觸碰。若 debug 交付 0055，schema readiness 與其驗證矩陣由父另整合，本輪不抬版本、不改資料契約。
4. 正式功能仍全 off。父審核來源、安全邊界與可信 origins 後，才另案決定發布／開關；本輪沒有 push、merge、部署、SSH、外部 API／LINE／Console/Rich Menu 或其他代理操作。
5. QR 圖片仍缺可信本地 encoder。**需要人類明確批准新增 npm `qrcode`（含版本／授權審查及必要型別套件、lock 變更）**，理由是純本地標準 QR 編碼及 PNG/SVG 下載，避免第三方外送或未驗證自製編碼。此名稱只是待批准建議，未安裝／批准；目前只交付 copy URL 與印網址文字牌，不能稱為可掃 QR。
6. 人工補簽／作廢仍無後端授權寫入契約，維持 disabled；不發明 default admin key、bypass 或假成功 adapter。
7. 區域及場地目前仍使用 UUID 輸入；沒有發明無權限可讀的全域名冊／下拉資料源。命名選單、三語完整 UI、真手機／縮放／鍵盤／讀屏及 PG16 驗收需後續安排，不以 CSS／VM 測試取代人工驗收。

Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
