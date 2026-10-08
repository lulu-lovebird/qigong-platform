# Qigong Platform — 交接摘要

> 最新正式環境已於 **2026-10-08 15:50:04–15:50:43 UTC** 經使用者核准部署，停機39秒。程式 release 為 `ccd06a9d43fd4c82534b4732f6bb516c4eecfa78`，schema 維持 `0020_admin_grant_management.sql`。管理員卡片／操作表單已重排；沒有正式 migration 或授權異動。本文件保留前次版本的恢復邊界與歷史紀錄，區分部署與真人驗收狀態。

## Telegram 四頁與聊天摘要（本機完成，未提交／未部署）

- 使用者核准第一批與第二批一起實作；聊天回覆如舊版，不含心得／感受。參考舊 `qigong-telegram-bot` HEAD `3886b40121326cdbef90233ef0370d6913b02146`，保持舊 repo 唯讀，沒有搬帳號／舊勳章或啟用 LINE／WhatsApp／LLM。
- 新 `telegram-workspace*.ts`：繁中／英文打卡、同地區遮罩排行榜、30／90天本人功法分析與近期私密心得、成就／每月歷史；Bot 私聊 `/checkin`、`/leaderboard`、`/methodanalysis`、`/achievements` 等回覆四個 WebApp 按鈕。仍以已核准身份的15分鐘平台 capability 授權，並非信任未驗證 initData／瀏覽器 user ID。
- 今天／昨天獨立草稿、分類全選、受控時區確認／變更、只在實際修改時警告、失敗保留輸入、busy／UUID retry／grant-independent checkin versions。官方 SDK ready／expand／native closing guard；先清除平台 capability 再讓 SDK 快取其 Telegram initParams，最後清除 fragment；僅放行官方 script 與 Telegram Web iframe，其他管道與後台 CSP 不變。
- 新 `0021_telegram_learner_workspace.sql`：forced-RLS workspace／版本／request ledger／receipt outbox、固定 v1 49個 badge definitions、person awards／audit、核准季節設定與耐久 jobs。儲存功法／心得／感受／版本／摘要同交易；只回傳日期／功法／連續與累計天數，收件人從已授權 identity 決定。sender allow-list／sanitized errors，不把私密欄位／provider URL／token 混入訊息或日誌。
- 成就依 canonical practice_date 與結構化 code，不用心得文字猜功法；更正可標記資格 revoked、保留歷史，重新符合可 restored。job trigger＋daily reconciliation，沒有新的勳章通知。三伏／冬至沒有猜測或 seed 活動日期；未設定核准日曆時明確顯示尚未開放。管理端心得／tag／成就榜 UI 仍未完成。
- 通知 worker 三個獨立 lane：onboarding、Telegram receipts、badge reconciliation；兩個 transport lane 各3筆，遵守既有60秒預算，全部結束才關 pool。10分鐘 lease／8次重試／退避／撤銷取消／送出前重驗；Telegram API 接受不等於裝置送達，也不宣稱 exactly-once／可以撤回在飛行中的訊息。
- 隔離 PostgreSQL16／Node24 `pnpm verify` **319項、無 skip**；workspace DB15／生成頁26／API與sender18，另有0020升級新測試。20→21／重跑／舊契約拒絕及既有應用表雜湊保留（core metadata 架構標記除外）通過；不是正式快照演練。worker-only login 的 compiled worker 三 lane 零項實際通過，沒有 migration-table SELECT。額外全測試 tsc 仍為10項既有錯誤，沒有本批檔案錯誤。
- Chrome CDP 合成資料390px四頁／1280px英文打卡與截圖檢查：零橫向溢出／JS exception、官方 SDK、fragment 清除、SDK 快取無 capability、native guard、獨立草稿／儲存／月歷史通過。不是正式 Telegram Android／iOS／Web 真人驗收，零真實訊息。
- **正式仍是頂部 `ccd06a9`／schema20；本批未 commit／push／部署、未改正式 env／grants。** 新 API／worker 只接受exact0021，不能直接替換20，也不能只退回舊20 binary；正式升級／備份還原演練與發布須另核准，跨schema rollback 必須配對DB與程式／worker並對帳後續寫入。細節／待辦見 `docs/operations/telegram-workspace.md`。本批使用先前保留的徽章 migration21，下一個新 migration 應接22，不改寫0001–0020。

## 管理員卡片與具名操作表單（已部署 `ccd06a9`，同 schema20）

- 使用者核准新設計及 commit／push／部署，程式 `ccd06a9d43fd4c82534b4732f6bb516c4eecfa78`；CI [37803401344](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37803401344) 成功。繁中／英文帳號卡片先顯示姓名／Email／帳號與申請狀態、角色／範圍／授權狀態／期間；身份與申請資料收入 details。角色操作列不放常駐文字框，按「修改授權」「移除此筆授權」「新增角色」才展開具 legend、目標、可見標籤及多行理由的 fieldset；全部移除置於獨立警示區。
- 同時間只展開一個操作表單；切換操作／取消有實際修改才確認，取消重設基線並返回按鈕焦點。理由說明用途與稽核留存，依 Unicode 限制1–500字，禁止空白／NUL；role／scope／reason payload 及 server-side CSRF／version／授權規則未改。單筆及全部移除分別說明範圍與不刪帳號／學員資料。拒絕只送 reason／decision／申請版本，不帶 role。
- 寫入期間停用 fieldset，busy 防重送、取消、切換表單及名單／篩選／分頁；失敗／403／409 保留表單值，顯示就地錯誤。self／master／super、legacy／suspended／scheduled 的既有保護仍以 SQL 為防線。
- 完整 PostgreSQL16 `pnpm verify` **259項通過、無 skip**（生成頁47項），格式／lint／source typecheck／build／diff check 通過。額外全測試 typecheck 與前版覆蓋比較仍為10項既有錯誤、無新增。以本機 Chrome CDP 驗證合成示範資料的390px手機／1280px桌機，繁中修改、英文移除及預設清單截圖檢查完成，document/body scrollWidth 等於 viewport、表單展開數正確；不等同正式 Authgear／真人裝置驗收。
- 正式快照隔離還原、matching artifact migrations 兩次零新增、編譯後雙語頁／mock OIDC／受限 runtime／授權交易／私密練功紀錄演練通過。最終 DB／roles／平台 env／systemd 站外 AES-256-GCM 副本解密核對雜湊，DB 副本實際還原為20、完整資料與停機基線一致、fbdf7a1舊程式 readiness 通過。正式不跑 migration，42張表完整雜湊（含 grant revision）未變，2 people／3 check-ins、grants／sessions 保持原狀。
- 公開 HTTPS41項通過，無真實測試訊息；API active／NRestarts=0／ExecMainStatus=0，timer active／worker 最近 Result=success／ExecMainStatus=0，保護 env 雜湊不變，未動舊 Bot 或啟用新 provider。
- 恢復資料：`/root/qigong-deploy-ccd06a9`、工具 `/opt/qigong-platform/deployment-tools/ccd06a9`、一次性腳本 `/tmp/qigong-release-ccd06a9/`；站外 `~/.local/share/qigong-platform/backups/deployment-ccd06a9/`，key 另置受限 backup-keys。備份不宣稱完整 OS／Caddy 災難復原。可退回同20 `fbdf7a1` binary／symlink／原 API drop-in／matching worker，**不應還原 DB**，保留後續寫入。

## 管理員入口與未儲存提示（`fbdf7a1` 發佈歷史，同 schema20）

- 使用者核准文案調整及同時部署；提交／推送程式 `fbdf7a1c700f27da0ce8a1059aeb48225d69e9f1`，CI [37797685206](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37797685206) 成功。繁中／英文改為「審核管理員申請」與「管理現有授權」，各附用途說明與 aria-describedby；申請狀態及 API 篩選值未改，不混淆學員報名審核。
- 納入前輪本機修正：名單、篩選、分頁、重新載入只在角色／範圍／理由與載入基線不同時提示，使用對應文案，不再錯用語言提示；取消保留輸入／套用篩選／頁碼／URL。預填或僅展開編輯器不算修改、恢復原值不提示；讀取／切換不提交權限異動，成功儲存重設基線、失敗保留修改。共用管理側欄語言確認保持原樣；待審申請頁重新載入也改為檢查實際修改。
- 完整隔離 PostgreSQL16 `pnpm verify` **239項通過、無 skip**，含格式／lint／source typecheck／build／diff check。首輪既有 DB master-request 保護測試出現 admin access denied，完整重跑及 CI 通過，沒有改 SQL；原因未定位。額外全測試 typecheck 仍有10項既有錯誤，已用 HEAD source 覆蓋比較確認沒有新增，不能宣稱全測試 typecheck 乾淨。
- 正式快照還原、clone 遷移兩次均零新增、新舊程式對同20 readiness 均通過；受限 runtime／mock OIDC／雙語編譯畫面／授權交易／私密練功紀錄演練通過，無真實 provider sends。正式停機最終 DB／roles／平台 env／systemd 的 AES-256-GCM 站外副本驗證解密雜湊，DB 副本實際還原為20、與停機基線完全一致、舊4a0237e readiness 通過。
- 正式**不執行 migration**，42張表完整資料雜湊（包含 grant revision）均保持一致，2 people／3 check-ins、角色／grant／session 未變。API active／NRestarts=0／ExecMainStatus=0，timer active／worker 最近 Result=success／ExecMainStatus=0；保護 env 雜湊未變，公開 HTTPS41項通過，不啟用新 provider、不動舊 Bot。真人 Authgear／桌機／手機實際操作驗收仍待完成。
- 恢復資料：`/root/qigong-deploy-fbdf7a1`、工具 `/opt/qigong-platform/deployment-tools/fbdf7a1`、一次性腳本 `/tmp/qigong-release-fbdf7a1/`；站外 `~/.local/share/qigong-platform/backups/deployment-fbdf7a1/`，key 另置受限 backup-keys。備份不宣稱完整 OS／Caddy 災難復原。
- 本次同20 UI-only release 可退回 `4a0237e` symlink／原 API drop-in／matching worker，**不應還原 DB**，以保留後續寫入。若另外退回19，則必須依下段完整 DB＋binary 邊界，另核准並對帳。

## 已授權名單／編輯／全部移除（`0020` 首次部署歷史）

使用者另核准 commit／push／部署後，程式 `4a0237e96d9a6181fea0c1a98f0f475c4bc1acb1` 已上線；CI [37791615057](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37791615057) 成功。正式快照升級／重跑零新增／舊程式拒絕20／最終站外備份實際還原為19／公開 HTTPS41項通過，無真實測試訊息。全部42張既有表原始資料保留（principals 雜湊只排除新增版本欄），3 principals 的新版本均為1，2 people／3 check-ins 與既存 grants／sessions 未變更；未動保護 env、舊 Bot 或新 provider 設定。API active／NRestarts=0／ExecMainStatus=0；通知 timer active、worker 最近 Result=success。

恢復資料：`/root/qigong-deploy-4a0237e`、部署工具 `/opt/qigong-platform/deployment-tools/4a0237e`；站外 AES-256-GCM 備份 `~/.local/share/qigong-platform/backups/deployment-4a0237e/`，key 另置受限 backup-keys。最終 DB／roles／平台 env／systemd 副本均核對解密雜湊，DB 副本實際還原並與停機基線一致，19舊程式 readiness 通過。腳本 `/tmp/qigong-release-4a0237e/` 為一次性工具，未宣稱完整 OS／Caddy 災難復原。

回復必須恢復 `0019` DB＋`79f3e4c` release／API drop-in／matching worker，不可只換 binary。已開流量後 DB 還原會失去後續寫入，須另核准與對帳。

已完成 `0020_admin_grant_management.sql`。管理權限頁新增等待核准／已授權入口，涵蓋既有 provisioned 帳號、角色與範圍、Email 缺漏及 effective 狀態；可原子編輯既定角色／地區、單筆撤銷及全部撤銷，保留歷史與 audit，不刪除 Authgear／學員資料。授權 revision 由 trigger 維護，CSRF／scope／版本／並行交易／session 撤銷／master 與自我異動保護均測試。

完整 PostgreSQL16 `pnpm verify` **223項通過、無 skip**，包含格式／lint／source typecheck／build。未改歷史 migrations、依賴、正式 grants 或保護設定；正式 API 最小／最大均為 `0020`，匹配完整0001–0020 artifact／API／worker；19舊 binary 不相容20。受控 owner 的 future grants 網頁撤銷不支援、整批拒絕而非部分撤銷；舊角色不直接編輯。操作細節及部署／restore 待辦見 `docs/operations/admin-grant-management.md`；徽章 migration 改規劃接 `0021`。

另：使用者回報實際登入後，查到該次登入帳號已有有效 global super_admin 與正常 session，未重複授權或新增 grant；Authgear 記錄未提供 Email，所以不能依指定 Email 查詢結果推定沒有權限。帳號依 issuer＋subject 判斷，需本人核對已知 sub；正式的現存授權保持原狀。

## 新管理界面與分級權限審核（已部署 `0019`）

使用者已核准文案調整、提交／推送與部署；程式 `79f3e4ce5451a0c0732aca6784478deba4d15cdb`／schema `0019_admin_access_approval.sql` 已於 **2026-10-08 13:23:46–13:24:11 UTC** 部署，停機25秒。CI [37783413247](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37783413247) 成功。本機213項無 skip、正式快照升級／舊版 readiness 拒絕／最終站外備份實際還原通過；公開 HTTPS38項通過，無真實測試訊息。保留既有40張表的原始資料（核准新增的 roles／permission／mappings 另驗證），2 people／3 check-ins 與全部既存 grants 未變。

最終 DB／roles／平台設定的 AES-256-GCM 站外副本逐一核對解密雜湊並實際還原；API active、NRestarts=0／ExecMainStatus=0，通知 timer active、最近 worker Result=success。保護 env 雜湊未變，未動舊 Bot 或啟用新 LINE／WhatsApp。指定新 super admin 候選帳號尚無對應 Email 登入紀錄；等待本人完成真實 Authgear 登入／身分核對，不是假稱已授權。

- 使用者確認新規格：語言改為側欄緊湊下拉，登出移至主要選單下方；繁中／英文、篩選保留與未送出審核切換提醒均保留。
- 新候選 `0019_admin_access_approval.sql`、`admin-access*.ts`：Authgear 首次未授權登入建立獨立待審身份／session，僅能提交與讀取本人申請；待審 credential 永不變成普通管理 session，不能讀報表或授權資料。
- 有效 global super／master 可在 `/admin/administrators` 管理授權。地區管理員採 `regional_admin + region`；工作人員採 `global_viewer + global`；氣功教練採新 `coach_admin + global`（含私密心得及感受唯讀）；兩位老師採新 `master_admin + global`（相同讀取＋一般管理員授權）。Master 僅能管理三種一般角色，不能處理自己、其他 master／super 帳號或 master 申請；僅 super 可配置 master，瀏覽器不能配置 super。沒有任意 permissions 編輯／Authgear role claim 自動授權／姓名或 Email 合併帳號。
- 核准需重新登入；角色異動會撤銷受影響帳號普通 session。SQL 保護自我異動／最後 super admin，版本鎖／交易／audit 及並行操作後重新驗證角色／時鐘到期均有測試。原有歷史 migrations、依賴與正式設定未動；既有地區／全域唯讀／班級 coach 模板未擴張，未自動變更現存 grants。新增管理員授權 permission 配置給 master／super。
- 使用者已指定第一位 super admin 候選人（Email 私下核對、不寫死程式），但 **未建立 Authgear 帳號或配置正式 grant**；須完成 Authgear 登入／已驗證 Email、核對 issuer／subject／UID，再由受控 DB owner bootstrap。指定人選不是部署核准。操作流程與限制見 `docs/operations/admin-access.md`。
- 正式 API 最小／最大均為 `0019`，匹配完整0001–0019 artifact／API／worker。隔離 PostgreSQL16 的完整 `pnpm verify` **213項通過、無 skip**，含格式／lint／source typecheck／build。真人 Authgear／桌機／手機視覺驗收與指定帳號 bootstrap 尚待完成；`0018 → 0019` 發布／還原演練已通過。回復舊程式必須還原 `0018` DB＋`b271ede` release／API drop-in／worker，不能只換 binary；重新開放流量後還原會失去後續寫入，需另核准與對帳。
- 恢復資料：遠端 `/root/qigong-deploy-79f3e4c`、部署工具 `/opt/qigong-platform/deployment-tools/79f3e4c`；站外 `~/.local/share/qigong-platform/backups/deployment-79f3e4c/`，金鑰另置受限 backup-keys。一次性操作腳本 `/tmp/qigong-release-79f3e4c/`；不是通用部署工具。備份包含 DB／roles／平台 env／systemd，未聲稱完整 OS／Caddy 災難復原。
- 原第二批心得管理頁／tag 管理／成就 worker backlog 不變；徽章 migration 規劃須接續 `0021`，不能再使用已保留給管理員審核／授權異動的 `0019`／`0020`。

## 第二批部分功能（已部署；其餘功能未完成）

- 使用者已確認同卡片上方複選感受 tag、下方自由心得；兩者分開儲存，選取／取消不改寫文字，均維持私密權限。
- 已套用 migration `0018_private_practice_notes_and_tags.sql`：獨立 forced RLS 心得／tag 快照、版本鎖 tag 目錄、三平台身份綁定與心得查詢。Telegram／LINE／WhatsApp 提交、更正與歷史，以及共用學員卡片已接上；省略欄位保留既有資料。
- 修正權限三值邏輯：新心得函式以 `IS NOT TRUE` 拒絕未明確授權的個人篩選；`methodsVisible` 的 `NULL` 正規化為 `false`。跨區／一般報表讀者無法取得私密文字與 tag，私密心得讀者不因此取得功法權限。未改既有角色授權或歷史 migration。
- `admin-journal.ts` 僅為查詢 helper；管理端心得／tag 畫面及 HTTP 路由、成就模型、評估／reconciliation worker **尚未完成**。參見 `docs/operations/admin-phase-2-proposal.md`。
- 正式 API 的 schema 最小／最大均為 `0018`，不是正式 `0017` 的可直接替換版本。隔離 PostgreSQL16、Node24／pnpm10 的完整 `pnpm verify` **173項通過、無 skip**；format／lint／source typecheck／build 與 `git diff --check` 通過。
- 程式 commit／push `b271ede`，GitHub CI [37739536716](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37739536716) 成功。正式主機 frozen-lockfile／Node24 建置，保存完整 artifact checksums。側欄語言切換已正式移至品牌下方、主要選單上方。
- 隔離正式快照演練 `0017 → 0018`、重跑零遷移；既有36張表筆數／資料雜湊不變。受限 login／mock OIDC 驗證8個雙語管理頁、12個報表、CSRF、學員心得＋tag 寫入／讀回及錯誤交易回滾；無真實 provider sends。舊 binary 在 `0018` readiness 拒絕，還原 `0017` 後再次通過。
- 停機取得最終 DB／roles／平台 env／systemd 備份；站外 AES-256-GCM 副本逐一驗證解密雜湊，最終 DB 副本實際還原至隔離 cluster 並與停機基線完全一致，舊版 readiness 通過。正式僅新增 `0018`、重跑零新增，既有36張表不變（2 people／2 check-ins）。
- 維護15秒後 API／通知 timer active，`NRestarts=0`、`ExecMainStatus=0`；公開 HTTPS **23項檢查通過**：正確 release／schema、雙語學員卡片、未登入管理頁／API、OIDC 無效 callback、Origin 拒絕與 Unicode 長度驗證、新管道及未完成管理頁404。受限 env 雜湊不變，未改舊 Bot／角色授權、未送真實測試訊息。
- 正式 tag 目錄目前為空，未自行建立／猜測標籤；自由心得可使用，tag 管理 UI／路由仍須後續完成。此批不是完整第二批功能或真人驗收通過。

## 專案與 Tech Stack

白雁氣功跨 IM 學員審核與練功打卡平台：管理員以 Authgear 登入，依地區／班級權限審核及查看報表；核准學員使用獨立 Telegram Bot。LINE／Meta WhatsApp Cloud API adapter 程式已部署，但新管道設定尚未配置，路由未啟用；舊 Bot、舊登入、舊資料庫及 webhook 保持獨立。

Node.js 24、pnpm 10.15.1 workspace、strict TypeScript、Fastify 5、PostgreSQL 16（受限 runtime roles／SQL 函式／forced RLS）、Authgear OIDC Authorization Code + PKCE、Vitest／ESLint／Prettier。正式 HTTPS 入口為 Cloudflare → Caddy → loopback API。公司署名為 **Bean, Bird & Badminton Tech Consulting**。

## 目錄與功能

| 路徑                                                                       | 用途／狀態                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/public-api/src/index.ts`、`app.ts`                                   | 啟動、環境設定、路由、migration 相容性及 runtime readiness。                 |
| `admin-auth.ts`、`oidc-provider.ts`、`admin-pages.ts`                      | Authgear／session／CSRF、待審 API；審核頁為 `/admin/applications`。          |
| `admin-dashboard.ts`、`admin-reporting.ts`、`admin-locale.ts`              | 已部署：總覽／已未打卡名單、排行榜、功法與個人分析、四頁側欄繁中／英文切換。 |
| `telegram-onboarding.ts`、`application-page.ts`、`checkin-page.ts`         | 已部署：申請／打卡、歷史／補登／更正、語言偏好及共用頁面模板。               |
| `line-onboarding.ts`、LINE page wrappers                                   | 程式已部署、管道未啟用；簽章、LIFF ID token、申請／打卡／通知待真人驗收。    |
| `whatsapp-onboarding.ts`、`whatsapp-client.ts`                             | 程式已部署、管道未啟用；專用 WABA／電話、Cloud API／模板／手機待真人驗收。   |
| `onboarding-notifications.ts`、`notification-worker.ts`                    | 同版通知 worker 已部署；目前僅配置 Telegram sender。                         |
| `packages/database/src/`、`packages/config/src/`、`packages/identity/src/` | DB／migration／request context、設定驗證及身份契約。                         |
| `migrations/0001–0018`                                                     | 已完整套用；歷史 migration 不可改寫，API 最小／最大均為 `0018`。             |
| `apps/public-api/tests/`、`packages/database/tests/`                       | API／授權／報表／通知／整合與 migration 測試。                               |
| `docs/operations/`、`scripts/backup-remote-postgres.sh`                    | 管道試行、後台驗收、systemd、備份／還原文件。                                |
| `.github/workflows/ci.yml`、`docs/architecture/`、`docs/adr/`              | PostgreSQL 16 CI、架構契約及決策。                                           |

上述 source 短檔名均位於 `apps/public-api/src/`。

## 前次 `269555c`／`0017` 發佈與驗證（歷史）

- 程式 commit／push：`269555c`，GitHub CI [37662918158](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37662918158) 成功。本機 Node24／pnpm10／隔離 PostgreSQL16 的 `pnpm verify` **150項通過，無 skip**；格式、lint、source typecheck、build 通過。未改依賴或原有 migration。
- 升級前重新核對正式 schema 為 `0012`；LINE／WhatsApp API 及 sender 設定皆未配置。新 release 在正式主機使用 frozen lockfile 安裝、Node24 建置，排除環境檔及 AppleDouble archive metadata，留存 source archive SHA-256／compiled artifact／migration checksums 的 `release-manifest.json`。
- 專用 PostgreSQL16 隔離 cluster 不開 TCP listener，正式快照還原保留 ownership／ACL／roles。演練 `0013` 已提交、`0014` 故意失敗時，新舊 API 相容性皆拒絕；接續完整遷移至 `0017` 成功。既有31張資料表逐表筆數及 SHA-256 資料雜湊不變。
- 編譯後程式以真實受限 `qigong-api` login、隔離 mock OIDC session 驗證8個雙語後台頁面、12個報表、CSRF／未登入邊界與 Telegram 雙語；網路 sender 為 mock，未對真實帳號送測試訊息。另驗證實際 Authgear discovery 與正式 callback origin，不冒用管理員登入。
- 暫停平台 API／通知 timer，等待在途 worker 結束；取得最終 DB custom dump、完整 cluster roles、受限平台 env／systemd 設定備份。站外副本以 AES-256-GCM 加密保存，解密金鑰與副本位於工作站 repo 外的受限目錄，未輸出／提交憑證。
- 從最終站外加密 DB 副本實際還原至隔離 cluster，31張資料表及 schema 與停機快照完全一致；舊 binary 在還原的 `0012` 上 readiness 通過。解密完整性／archive catalog／篡改拒絕均驗證。
- 正式完整套用 `0013–0017`，重跑遷移零新增，既有31張表完全一致；凍結快照為2位 person、2筆 check-in，既有關聯／歷史未改寫。切換同版 API／worker 後，公開 readiness 為 `ready: true`、runtime login 為 `qigong-api`，API／通知 timer active。
- 維護窗口為 **18:39:24–18:39:39 UTC（15秒）**。公開 HTTPS 的19項煙霧測試涵蓋雙語未登入頁／cookie、API401、無效 callback400、Telegram 頁面與無效 webhook401、新 LINE／WhatsApp 路由404；未送真實測試訊息。這不等於真人登入、桌機／手機視覺或 provider 裝置驗收。

## 正式環境與回復邊界

- Singapore `sgp1`、Ubuntu 24.04、`152.42.183.10`；1 vCPU／2 GiB RAM／50 GB 配置磁碟，無 swap。僅小規模單機試行，沒有容量／高可用保證。
- `/opt/qigong-platform/current` 現為 symlink，指向 `/opt/qigong-platform/releases/b271ede1b6619556ca281ed1c914359e59865ee0`。前版 `269555c3e3bff2c8a380e8c5518da86390460bed` 及更早的 `pre-269555c` 保留；不能僅切回目錄當成 schema 回滾。
- `qigong-platform-api.service` 以 `qigong-api`、`qigong-notification-worker.timer`／service 以既有 notifier 設定運行；API loopback 為 `127.0.0.1:3100`。API 更新 `90-release.conf` drop-in，僅覆寫 ExecStart 以標記公開的 `SERVICE_VERSION`，不覆寫受限 `api.env`／`notification-worker.env`。
- root-only 本次操作／備份紀錄位於 `/root/qigong-deploy-b271ede`；站外加密副本位於工作站 `~/.local/share/qigong-platform/backups/deployment-b271ede/`，部署工具位於 repo 外 `/tmp/qigong-release-b271ede/` 及正式主機 `/opt/qigong-platform/deployment-tools/b271ede/`，解密金鑰在獨立受限 `backup-keys/` 目錄。不得複製進 repo、輸出金鑰或把設定備份原文上傳。
- API 與 schema 緊耦合，本次 `0017` 和 `0018` 無相容重疊，使用者已核准維護窗口升級。中途遷移失敗必須維持維護狀態、向前修復或依核准流程還原 DB；舊 binary 不是 migration 回滾。回復前版必須配合本次 `0017` 備份、`269555c` release、`old-release.conf` 與同版 worker；更早的 `0012` 回復流程僅屬前次歷史。**重開流量後還原會丟失後續寫入，須另核准並處理資料差異。**
- 此次已實際執行版本化切換／還原演練，但工具為 repo 外的一次性操作腳本；通用 release／upgrade rehearsal scripts、自動部署及藍綠發布仍未建置。
- 原交接記錄 `ubuntu1` 每日19:20 UTC 拉取備份；本次未重新核對該 cron。`pg_dump` 本身不含主機配置；此次另備份 roles／平台 env／systemd，但完整災復仍需 Caddy／PostgreSQL／OS 設定與定期跨主機復原演練。

## 已部署功能與限制

- `/admin/`、`/admin/leaderboard`、`/admin/method-analysis`、`/admin/applications`：原生 SVG／響應式 shell，無舊 Bootstrap／Chart.js CDN 或新依賴。保留 Authgear、單筆／批次核准拒絕及 CSRF；不搬舊登入／舊資料。
- 報表取 `learner.read`／`checkin.read`／`stats.read` scope 交集，遵守目前 person 授權／主要地區。班級僅額外可讀目前主要地區 metadata，歷史 assignment 原地區隔離不放寬。以 person／練習日期計算人日，多選功法不增加天數；不是歷史地區績效歸屬。
- 管理後台測試含地區／國家／全域／班級／唯讀／越權／停用／到期、日期／分頁／連續與個人分析、VM scripts／XSS／SVG／過期 request；未取代真人瀏覽器驗收。完整清單見 `docs/operations/admin-dashboard.md`。
- 管理介面優先合法 URL `lang`，其次安全 locale cookie，預設繁中。四頁側欄切換保留已套用 URL 條件／personId，重設分頁；待審切換須確認清除未送出勾選／理由，絕不自動提交。不翻譯姓名／自填理由，非跨裝置 DB 偏好；Authgear 外部登入畫面不在翻譯範圍。
- Telegram 私聊 `/language en`／`/language zh_TW`、申請／打卡頁、回覆、功法／歷史／通知跟隨管道偏好。偏好可在申請前建立，網頁更新須有效、身份綁定短效 token；舊語言 update 不覆寫較新設定。LINE 維持繁中。
- **Policy A 已正式套用**：每次新核准建立獨立 person，不依姓名／Email／電話自動關聯；既有關聯不拆分。合併／跨管道切換自助流程未實作，person／date 唯一不等於真人去重。
- 核准學員共用上架功法，功法可見不等於課程完成／AI 推薦資格；未來 AI 只取結構化允許清單，RAG 解釋官方內容。日期依學員練習時區，昨天中午前可補登／更正，資料庫再次驗證期限；父節點全選只提交葉節點。
- WhatsApp 專用 Cloud API adapter 已含 raw-body HMAC、WABA／電話隔離、inbox 去重、短效連結、雙語申請／狀態／審核／打卡／歷史／補登／更正與模板通知。明確勾選通知同意，`STOP` 撤回；缺同意不發模板，過期入站不回自由文字。模板／account／手機尚未驗收，未發真實 Meta API 請求。
- WhatsApp 去重不等於 exactly-once：外部發送在 domain transaction 內，上游接受後 timeout／commit 失敗仍可能重複。`delivered` 僅代表 API 接受，非裝置收件；status callbacks／耐久 reply outbox／保留清理／負載與 rate-limit／重新同意流程未實作，撤回不能取消已在途訊息。LINE webhook 仍缺耐久去重。

## 待辦與注意事項

1. 真人以 Authgear 完成後台繁中／英文桌機／手機驗收，確認導航／篩選／個人分析／單筆批次審核及不同地區／班級拒絕；不要拿正式學員當合成測試資料。
2. 完成管理端心得／tag 頁面與路由、成就模型／評估 worker；已部署的私密心得／tag 基礎不代表完整功能。AI 評語另外審核。
3. 新 LINE／WhatsApp 官方帳號、專用電話及模板由管理者私下設定；依 `line-pilot.md`／`whatsapp-pilot.md` 驗證後另批准啟用。LINE Login Channel ID 不等於 Messaging Channel ID，LIFF fragment／手機行為待驗證；舊 Bot 不變。
4. 建置可重複、版本化且不含 env 的 release tooling、監控／備份保留與復原排程；維持 schema 相容性 gate，擴大使用前補容量／負載驗證。
5. 更新過時 README／pilot／ADR 階段描述。資料庫測試須隔離、名稱含 `test` 的 `TEST_DATABASE_URL`；無 URL 的 skip 不能算整合通過，受控共用 roles 的測試避免跨套件 DB 平行衝突。
6. 額外全測試檔型別檢查仍有既有 `QueryResultRow`／exact optional 等錯誤；標準 `pnpm verify` 的 source typecheck 通過，不含該額外檢查。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
