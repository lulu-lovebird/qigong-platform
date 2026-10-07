# Qigong Platform — 交接摘要

> 正式環境資訊沿用 2026-10-07 交接快照，本輪未重新連線驗證或部署。下列「本輪接手更新」為本機程式／測試結果；早期 README／ADR 中的階段描述可能已過時。

## 專案一句話＋Tech Stack

新建的白雁氣功跨 IM 學員審核與練功打卡平台：管理員透過 Authgear 登入並按地區審核，核准學員透過獨立 Telegram Bot（LINE／WhatsApp 首版本機完成、待驗收）使用同一份功法目錄及 PostgreSQL 打卡資料；舊 Bot 各自保持獨立。

**技術**：Node.js 24、pnpm 10 workspace、strict TypeScript、Fastify 5、PostgreSQL 16（遷移、受限 SQL 函式、RLS）、Authgear OIDC Authorization Code + PKCE、Telegram Bot webhook、LINE Messaging API + LIFF、Meta WhatsApp Cloud API（後兩者尚未部署）、Vitest／ESLint／Prettier；正式入口由 Cloudflare → Caddy → loopback API 提供 HTTPS。公司署名為 **Bean, Bird & Badminton Tech Consulting**。

## 目錄導覽

| 路徑（相對本 repo）                                                                                      | 用途                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/public-api/src/index.ts`、`app.ts`                                                                 | 讀取環境設定、啟動 Fastify、註冊路由、檢查資料庫 migration 相容版本與 readiness。                           |
| `apps/public-api/src/admin-auth.ts`、`oidc-provider.ts`、`admin-pages.ts`                                | Authgear OIDC／session、報表與待審 API；審核移至 `/admin/applications`。                                    |
| `apps/public-api/src/admin-dashboard.ts`、`admin-reporting.ts`                                           | **本機未部署**：響應式管理後台、總覽／名單／排行／功法與個人分析，查詢遵守 RLS／scope。                     |
| `apps/public-api/src/telegram-onboarding.ts`、`telegram-application-page.ts`、`telegram-checkin-page.ts` | 獨立 Telegram Bot webhook、申請／打卡 API 與 Web UI；包含近期紀錄、連續天數、更正與父子功法。               |
| `apps/public-api/src/line-onboarding.ts`、`line-application-page.ts`、`line-checkin-page.ts`             | **本機未部署**：新 LINE webhook 簽章驗證、LIFF ID token 驗證、申請與打卡頁／API。                           |
| `apps/public-api/src/onboarding-notifications.ts`、`notification-worker.ts`                              | 核准／拒絕訊息的重試配送；正式環境目前以 Telegram 通知為主，LINE sender 為本機新功能。                      |
| `apps/public-api/tests/`、`packages/database/tests/`                                                     | API、授權、通知、migration 和資料庫隔離整合測試。                                                           |
| `packages/database/src/`、`packages/config/src/`、`packages/identity/src/`                               | 資料庫連線／migration／request context、環境設定驗證與共用身份契約。                                        |
| `migrations/0001–0012`                                                                                   | **已在線上套用**：身份、地區、RLS、審核、通知、Telegram 打卡／紀錄、六組父子功法。歷史 migration 不可改寫。 |
| `migrations/0013_line_onboarding.sql`                                                                    | **僅本機**：LINE 申請／打卡基礎；內含舊隱式關聯，須立即接續 0014，不能停在此版啟用。                        |
| `migrations/0014_no_implicit_identity_linking.sql`                                                       | **僅本機**：A 政策，未來核准不自動關聯；完整發佈須接續到0017，既有關聯不拆分。                              |
| `migrations/0015_channel_locales.sql`                                                                    | **僅本機**：管道語言偏好、Telegram 語言 update 去重、英文功法／歷史。                                       |
| `migrations/0016_whatsapp_onboarding.sql`                                                                | **僅本機**：WhatsApp inbox／短效連結／同意／申請與打卡；接續0017才符合目前 API。                            |
| `migrations/0017_admin_reporting.sql`                                                                    | **僅本機**：管理報表唯讀 RLS／索引、班級所屬學員目前地區 metadata；目前 API 要求此版。                      |
| `docs/operations/`、`scripts/backup-remote-postgres.sh`                                                  | Droplet、Authgear、Telegram／LINE 試行、systemd、異地備份與還原操作文件。                                   |
| `.github/workflows/ci.yml`、`docs/architecture/`、`docs/adr/`                                            | PostgreSQL 16 CI、架構契約與早期決策紀錄；部分文案需隨實作更新。                                            |

## 進度

| 已完成（正式環境）                                                                                                                                                    | 進行中（本機／待啟用）                                                                                                                              | 待辦                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 新平台已在 `https://checkin.baiyinqigong.org` 運行；Authgear 管理員登入、地區審核／批次審核、獨立 `@qigong_checkin_bot` 申請及打卡、核准／拒絕通知。                  | 管理後台第一批、LINE／WhatsApp adapter、Telegram 雙語、`0013–0017` migration、通知與整合測試在**未提交的工作目錄**；目前未部署、未啟用 webhook。    | 在核對新 LINE channel 設定後，完成部署、LINE Console webhook 驗證、真實 LIFF 登入／申請／核准／打卡／通知端到端演練；舊 LINE Bot 不改動。 |
| 線上 migration `0012_telegram_method_hierarchy.sql`；22 項共用功法，包含大雁、五禽戲、回春、龜壽、正陽、靜功六組可展開父子節點。                                      | LINE 的 Messaging API channel、LINE Login channel、LIFF 與環境變數由管理者準備；LINE webhook URL：`https://checkin.baiyinqigong.org/line/webhook`。 | 定版課程名稱／上架範圍、會員庫學功資料與 AI 推薦資格規則；RAG 只提供課程解釋。                                                            |
| Telegram 近期 14 筆紀錄、連續／總天數；當天或練習時區昨天中午 12:00 前可更正功法。正式 `/health/ready` 為 `ready: true`；API 與通知 timer 運行中。                    | 本輪隔離 PostgreSQL 16 驗證 150 項測試（無 skip），格式、lint、typecheck、build 通過；**管理後台／A／雙語／WhatsApp 已本機實作，真人驗收待辦**。    | 建立版本化發佈、切換及可演練的回滾流程；更新 README／過時的操作文件與 ADR。                                                               |
| `ubuntu1` 每日 19:20 UTC 主動拉取 PostgreSQL 備份；既有備份已在隔離 PostgreSQL 16 容器完成還原演練。最後提交推送為 `cb6dd3c`，對應 Telegram 紀錄與父子目錄，CI 成功。 |                                                                                                                                                     | WhatsApp 真人驗收／送達追蹤、跨管道切換自助流程、提醒／徽章等後續功能。                                                                   |

## 本輪接手更新（本機，未部署）

- 已完成本機兩階段工作：Telegram 雙語基礎，再接 Meta WhatsApp Cloud API adapter；另完成管理後台移植第一批。Node.js 24／pnpm 10、隔離 PostgreSQL 16 的 `pnpm verify` 共 **150 項通過，無 skip**；格式、lint、typecheck、build 通過。未改依賴檔或原有 migration，未部署／連線驗證正式環境。
- 新增 `admin-dashboard.ts`／`admin-reporting.ts`：`/admin/` 為總覽，另有 `/admin/leaderboard`、`/admin/method-analysis`；待審頁移至 `/admin/applications`，原有單筆／批次功能與 Authgear／CSRF 保留。移植舊 LINE 後台操作流程但不搬舊資料、不共用舊登入／依賴。
- `0017_admin_reporting.sql` 加唯讀 check-in／功法 selection RLS 與索引；報表取 `learner.read`／`checkin.read`／`stats.read` scope 交集。班級僅新增目前主要地區 metadata 存取，**歷史 assignment 原地區隔離不放寬**。依 person／練習日期統計，多選功法不增加天數；範圍採目前學員授權，不是歷史地區績效歸屬。
- 管理後台第一批及雙語共48項驗證：真實受限 runtime login 與 mock Authgear session 的地區／國家／全域／班級、去重天數／連續、分頁／篩選／30和90日分析、唯讀／越權／停用／到期；VM script 測試 XSS 字面呈現、SVG、分頁、錯誤、過期 request 與一次性登出。操作／驗收清單見 `docs/operations/admin-dashboard.md`；尚未真人瀏覽器視覺驗收。
- `learner-locale.ts` 提供嚴格型別繁中／英文文案。Telegram 私聊 `/language en`／`/language zh_TW`、申請／打卡頁切換、Bot 回覆、功法／歷史與審核通知跟隨管道偏好；LINE 維持繁中。語言切換重載不保留未送出的表單／勾選。
- `0015_channel_locales.sql` 儲存每管道身份的偏好（可在申請前建立）；網頁只透過有效、身份綁定的短效 token 設定，不信任 phone／subject。Telegram 重送或較舊的語言 update 不覆寫新設定。共用模板保留申請 fragment／短效連結規則。
- `whatsapp-onboarding.ts`／`whatsapp-client.ts` 與 `0016_whatsapp_onboarding.sql` 實作新 WABA／電話專用 Cloud API：callback challenge、原始 body 簽章／帳號驗證、資料庫 inbox 去重、雙語申請／狀態、審核、打卡／歷史／補登／更正、短效連結與模板通知。主服務與 worker 已接設定，但真實 Meta API／手機尚未驗收。
- **A 政策延續**：0014 禁止個資自動關聯，兩種核准順序／跨地區都各自建立 person；既有關聯不拆分，合併／管道切換不實作。相同真人可有多個 person，每 person 每日唯一不等於真人去重。
- **通知／去重邊界**：WhatsApp 申請明確勾選結果通知同意，`STOP` 撤回；缺同意不發模板，進既有重試／失敗流程。核准／拒絕固定用已核准中英文 Meta 模板，過期入站消息不回自由文字。已提交的申請重新同意流程未實作；撤回不能取消已在途訊息。
- WhatsApp inbox 去重跨重啟／並行有效，但回覆與 domain transaction 內含外部 API：上游接受後 timeout／commit 失敗仍可能重複，不是 exactly-once／耐久回覆 outbox。notification `delivered` 代表 API 接受，不代表裝置收件；status callback 未持久化。收件追蹤、inbox 保留期限／清理、負載／rate-limit 與真人驗收仍待辦。LINE webhook 仍無耐久去重。
- 新增 `docs/operations/channel-locales.md`、`whatsapp-pilot.md`，同步 LINE／ADR 發佈版本；**目前 API 最小／最大均為0017**，需完整 `0001–0017` chain 與同版 worker。0013／14／15／16 是中間版，逐檔 migration 提交失敗須維持維護狀態；選定政策／本機測試通過不等於核准部署。
- 下一步：管理後台第一批隔離驗收，確認後再做第二批日誌／體感標籤／成就徽章（目前缺資料模型／學員流程，未假裝完成）；版本化 artifact 與升級／還原演練仍待另核准。LINE／WhatsApp 新官方帳號與模板設定暫緩，不阻擋後台本機驗證；舊 Bot 不變。
- 額外全測試檔型別檢查仍有未修改資料庫測試既有錯誤；標準 `pnpm verify` 不含此額外檢查。

- 管理後台已補繁中／英文：`admin-locale.ts` 的完整文案／placeholder、四頁右上切換、審核確認／錯誤與既有資料庫英文地區／功法／父類別／歷史名稱；SQL 名稱僅從固定允許清單取用。不翻譯姓名／自填理由、不變統計／method code／權限、不新增 migration。
- 語言依合法 URL `lang` 優先於安全的 `__Host-qigong-admin-locale` 瀏覽器 cookie，預設繁中；切換保留已套用網址條件／personId，分頁重設。待審切換確認清除未送出的勾選／理由且不自動提交；取消不丟失內容。偏好跨選單／登入保留，非跨裝置管理員 DB 偏好；Authgear 外部登入畫面不翻譯，學員管道通知語言不變。

## Decision log

| 決定                                                                                                              | 原因／限制                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 新平台從新資料起步；舊 LINE／Telegram／WhatsApp Bot 不搬移測試打卡、也不共用 webhook。                            | 避免舊系統資料與新正式學員資料混雜，並允許逐管道試行。                                                                             |
| 一人可有多個已核對的 IM 身份，但同時間只允許一個主要打卡管道；`UNIQUE(person_id, practice_date)`。                | 平常固定使用單一 IM，跨管道不能對同一天重複打卡；切換流程另行設計。                                                                |
| Authgear 僅驗證管理員；`(issuer, sub)` 對應平台預建 principal，角色與地區權限由本平台資料庫判斷。                 | 身份供應商不決定審核授權；學員會員庫不複製密碼，對接細節仍待定。                                                                   |
| 申請收姓名、官網 Email、含國碼電話及地區；管理員核准後才可打卡，`membership_status=pending` 不阻止試行學員。      | 會員整合尚未完成，先以人工審核控制入口。                                                                                           |
| **A 已採用**：核准建立獨立學員；姓名、Email、電話相同也不自動關聯。                                               | 0014 已在本機實作／驗證；既有關聯不拆分，管道切換／合併另設計。相同真人可能有多個 person，日期唯一不等於真人去重；部署仍須另批准。 |
| 首版所有核准學員看到同一套上架功法；列表可見、課程完成與 AI 可推薦資格分開。                                      | 不把打卡列表誤當個人授課資格；未來 AI 只使用結構化允許清單，`qigong-kb-rag` 解釋官方內容。                                         |
| 打卡日期依學員練習時區；昨天中午前補登或更正，資料庫函式在寫入時再次驗證。                                        | 讓跨國學員一致，防止前端繞過時限；父節點全選只提交葉節點。                                                                         |
| 資料庫採單一 Droplet PostgreSQL 16、受限 runtime roles／RLS 與審核交易內通知佇列；異地備份由 `ubuntu1` 主動拉取。 | 權限和原子性在資料層維持，Droplet 不需向家中主機建立備份連線。                                                                     |

## 已知坑與 workaround

- **舊文件過時**：`README.md`「Current Phase」、`docs/operations/droplet-pilot.md`「Outstanding pilot setup」、Telegram 試行文件仍描述已上線項目為待辦；以實際 migration、readiness 及本文件進度為準。ADR 0002 已採用 A 並記錄 0014 實作；0013 的匹配規則僅為被取代的歷史，不得啟用。
- **Migration 與 API 緊耦合**：`app.ts` 指定最小／最大版本；正式環境仍以直接同步建置檔、套 migration、重啟服務為主，並非版本化切換。新版 API 只相容 `0017`；不可在僅相容 `0012` 的舊 API 運行時先升 schema，也不可停在 `0013–0016` 啟用。Migration 逐檔提交；任何中間版成功而後續失敗須維持維護狀態、修復或按核准流程還原。先規劃同版發佈與回復。
- **LINE 兩種 Channel ID 不同**：`LINE_LOGIN_CHANNEL_ID` 是 LIFF 的 LINE Login Channel ID，不是 Messaging API Channel ID。API 驗證 LIFF ID token，webhook 對**原始 body**驗證 `x-line-signature`；LINE token／secret 不放入 Git。LINE 首次登入跳轉需保留申請連結 fragment，登入後再從網址清除；真實手機行為尚未驗證。
- **LINE webhook 尚未上線**：現有正式 API 只有 `0012`；LINE Console 立即 Verify 新 URL 預期尚不會通過。`docs/operations/line-pilot.md` 所列 LIFF endpoint／路由設定要以實際 LINE Console 的跳轉行為再核對。
- **測試需隔離 PostgreSQL 16**：資料庫整合測試要設定名稱含 `test` 的 `TEST_DATABASE_URL`；共用受控 roles 的多套 DB 測試平行執行曾互相干擾，必要時以 `vitest run --maxWorkers=1` 序列驗證。沒有 DB URL 時部分測試會 skip，不能誤當整合測試已過。
- **備份不含主機配置**：`pg_dump` 不含 cluster roles、`/etc/qigong-platform/*.env`、Caddy 或 systemd；完整災難復原需另備其設定。家中 cron 若錯過排程不補跑，需人工觸發並核對檔案與隔離還原。

## 部署規劃：DigitalOcean Droplet 規格與決策

- **目前規格（已核對）**：DigitalOcean Singapore `sgp1`、Ubuntu 24.04 Droplet `152.42.183.10`；**1 vCPU、2 GiB RAM、50 GB 配置磁碟**（系統根分割區約 48 GB）、目前無 swap。屬單機試行配置，不能宣稱已完成容量／高可用壓測。
- **現行拓撲**：Cloudflare DNS／TLS → Caddy → `127.0.0.1:3100` Fastify；同機 PostgreSQL 16 僅本機存取。`/opt/qigong-platform/current` 跑 Node 24，`qigong-platform-api.service` 以 `qigong-api` 運行；`qigong-notification-worker.timer` 定期喚起通知 worker。正式憑證保存在受限的 `/etc/qigong-platform/api.env`、`notification-worker.env`，不可輸出、複製至 repo 或提交。
- **為何先用此規格**：目前以小規模試行、單一 API 與本機 PostgreSQL 起步，1 vCPU／2 GiB 避免過早投入多節點成本；已有 `ubuntu1` 異地備份與還原演練。這是階段性配置，不代表容量保證。監控 CPU、可用記憶體、磁碟／DB 增長、延遲與備份成功率後，再決定升級 CPU／RAM、加 swap、擴磁碟或分離資料庫；建立發佈回滾與復原演練後再擴大使用者數。
- **LINE 上線順序**：確認 A／0017 artifact 與發佈／回復 gate，批准相容版本或經演練的停機窗口；再核對新 Messaging API channel secret／access token、LINE Login Channel ID、LIFF ID，設定 `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_LOGIN_CHANNEL_ID`、`LINE_LIFF_ID` 於 `api.env`，另在 worker env 設 `LINE_CHANNEL_ACCESS_TOKEN`；接著依 `docs/operations/line-pilot.md` 將已驗證的同版 API、worker 與完整 `0013–0017` migration 一起部署，檢查 `/health/ready`、webhook 簽章、真實 LIFF 與核准通知後才開新 LINE webhook。**舊 LINE Bot 不變。**
- **後續部署改善**：由目前 in-place 同步改為版本化 releases，先驗 migration 相容與健康狀態再切換服務，保存可復原的前版及還原流程；相關目標見 `docs/architecture/schema-compatibility.md`，不應把文件中的藍綠流程誤認為目前已實作。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
