# Qigong Platform — 交接摘要

> 最新正式環境已於 **2026-10-08 13:23:46–13:24:11 UTC** 經使用者核准的維護窗口升級，停機25秒。程式 release 為 `79f3e4ce5451a0c0732aca6784478deba4d15cdb`，schema 為 `0019_admin_access_approval.sql`。指定新 super admin 的本人登入／身分核對及 bootstrap 尚待完成。本文件區分已部署功能、尚未啟用的管道及未完成的真人驗收；保留前次 `b271ede`／`0018` 的恢復邊界與歷史紀錄。

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
- 原第二批心得管理頁／tag 管理／成就 worker backlog 不變；徽章 migration 規劃須接續 `0020`，不能再使用已保留給管理員審核的 `0019`。

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
