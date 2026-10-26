# Venue migration 重編號與遠端本地整合

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 範圍與版本

- 分支：`feature/venue-attendance-qr`。
- 乾淨起點：`b65d142831d854befb8438ff778e8f8ce7ffc440`。
- 整合遠端：`origin/main@156d7dc4bbb77b3bc940ed957a4f407dac17cebe`。
- 本地 merge：`b88c94229f1798097279f123020c47dc09c1de3b`；保留兩個 parents。
- 文件前最後程式／規格提交：`cd99676`；最終 HEAD 為包含本文件的提交，以交付回報／`git rev-parse HEAD` 為準，不編造自我 SHA。

用戶已明確核准本地 merge、四份尚未部署 venue SQL 更名與相關未發布引用同步。先讀 AGENTS、readiness／admin／DB interfaces 及遠端 diffs；遠端檔案樹確認 invitation 已佔 0047，遠端分支不含原 venue baseline commit `1c60c28`。未部署判斷依用戶明確確認及本地歷史／隔離測試紀錄，**沒有連正式 DB 複查 ledger**。原測試名稱的「applied 0047」不是正式部署證據，現改為 byte-identical baseline 契約。

唯一 writer 是父 checkout；沒有代理或平行 writer。每個人工修改批次最多五檔。遠端官方 merge 引入完整三個 upstream commits；只有四個衝突檔人工整合，不把它偽稱五檔以下的 upstream diff。

## 最終 migration mapping

| 原 venue 檔案                                 | 現行檔案                                      | SQL 內容                                      |
| --------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| `0047_practice_fields_and_nfc_attendance.sql` | `0048_practice_fields_and_nfc_attendance.sql` | 位元組完全相同，原 checksum 保留              |
| `0048_nfc_attendance_security_quarantine.sql` | `0049_nfc_attendance_security_quarantine.sql` | 位元組完全相同，原 checksum 保留              |
| `0049_venue_attendance_security_contract.sql` | `0050_venue_attendance_security_contract.sql` | 位元組完全相同，原 checksum 保留              |
| `0050_venue_qr_attendance.sql`                | `0051_venue_qr_attendance.sql`                | 僅兩個空資料／配置錯誤訊息中的 0050 改為 0051 |

**`0047_channel_invitations.sql` 不更名、不改內容。** 0001–0047 全部逐檔比對 `origin/main@156d7dc` 位元組相同；invitation SHA-256 固定為 `8afe46a82202557afcd58182a2c213b0ffc91720837ef5d1c28c49603ebf6a13`，另有靜態回歸測試。全鏈 51 個檔案、編號各唯一，舊 venue 檔名不存在。

前三份 venue SQL 的原編號 comments 刻意保留為原版本來源，沒有更動它們的 checksum；不能照 comments 的歷史號碼選檔。歷史文件上方新增 mapping／歷史註記，保留當時 SHA、實際測試數字與舊手機 schema 快照，沒有把過去測試描述改成從未發生的新編號。

## 整合與安全行為

- `app.ts`：同時保留 remote privacy logger、bounded error responses、invitation transports 及 venue entry／QR wiring。
- `admin-auth.ts`：保留 remote 第五參數 invitation transports，QR config 接第六參數；channel-invite session／CSRF 路由與 QR cookie／Origin／CSRF 邊界均保留。
- `admin-dashboard.ts`：channel invitation capability link 與 venue capability links 都保留；沒有直接開啟隱藏管理能力。
- `index.ts`：沿用 remote import-safe／privacy-safe lifecycle、cleanup／signal ownership；QR 設定從同一 source 解析，明確 true 才傳入 app／enabled readiness。新測試涵蓋無設定、有效 opt-in、缺失／非法設定與不洩漏診斷。
- API 最小仍為 0042；最大為精確 `0051_venue_qr_attendance.sql`。另有完整檔名白名單：default-off 只接受已知 0042–0046、invitation 0047、venue baseline 0048、quarantine 0049、QR 0051；denial-only 0050 拒絕。QR enabled 僅接受精確 0051。未知同前綴／排序落入範圍／future 檔名均拒絕，不靠提高 maximum 放行。
- 舊 NFC 仍 default-off 且任何支持版本都不能啟用；QR 成功路徑與 privacy、identity、scoped read/export、FORCE RLS／ACL 不放寬。
- repository fresh-chain expected list／檔名 regex 掃描及精確檔名契約同步更新。真 PG 在 fixtures **之前**驗證完整 51 份已套用、重跑 0、deployment regions／venues／privacy acceptances 為空及 invitation 三表 FORCE RLS；fixture 自建合成地區與必要身份，不依賴正式 seed。
- 官方 package files／lock 與 remote 完全相同；只執行 `pnpm install --frozen-lockfile --ignore-scripts`，沒有自行調版本、改 lock、執行安裝 lifecycle scripts 或改全域 Node。

## 批次提交與驗證

| SHA       | 人工檔數 | 內容與當批結果                                                         |
| --------- | -------- | ---------------------------------------------------------------------- |
| `be0d135` | 4        | 四份 git mv；逐檔 byte-identical、編號唯一靜態契約通過                 |
| `c0c8130` | 5        | DB 契約／0051 錯誤訊息；172 passed、10 skipped、1 runtime 引用相依失敗 |
| `178701e` | 5        | runtime／精確白名單；上述相依消除，DB 173/10 skip、API 54、lifecycle 7 |
| `4a19bd4` | 5        | schema 拒絕矩陣／route 註記；150 passed                                |
| `bbc90bd` | 4        | identity／legacy controlled boundary 註記；API 109、DB 116/10 skip     |
| `b88c942` | 4 衝突   | 官方 merge；typecheck、343 passed/11 skip、隔離 PG 10 passed           |
| `374e893` | 1        | 原有 NFC test 8 lint errors 機械修正；保留原斷言，10 tests／全倉 lint  |
| `047a70f` | 3        | 全鏈／immutable invitation 靜態 141/10 skip；加強後 PG 10 passed       |
| `14c1bca` | 1        | privacy-safe startup 與 QR opt-in 回歸；104 passed                     |
| `e3011bf` | 5        | 現行文件 mapping／歷史標記；119 passed，精確檔名收尾再測 38 passed     |
| `518f625` | 5        | 舊交接歷史標記／新 handoff；175 passed                                 |
| `cd99676` | 1        | schema compatibility 現行規格；60 passed                               |

本文件為最後單檔紀錄批次。逐批執行相關測試與 diff check；TS／Markdown 另用 configured Prettier，最終所有變更檔案格式檢查通過。SQL／shell 未手動重排。`c0c8130` 的相依失敗如實保留，不算已通過或刪除 assertion；下一批引用更新後轉綠。原八項 lint 在單一獨立批次修正，未關閉規則；沒有用三輪以外的反覆修復掩蓋失敗。

## 最終 Node24／PG17 結果

工具：Node **24.22.1**、pnpm **10.15.1**、PostgreSQL **17.11**；使用既有 keg-only PATH，`LANG=C LC_ALL=C`。

| 驗證項目                                                   | passed | skipped | failed |
| ---------------------------------------------------------- | ------ | ------- | ------ |
| workspace `pnpm test`：API                                 | 1946   | 255     | 0      |
| workspace `pnpm test`：database                            | 219    | 310     | 0      |
| workspace `pnpm test`：config／identity                    | 8      | 0       | 0      |
| workspace 合計                                             | 2173   | 565     | 0      |
| `scripts/test-venue-qr-local-pg.sh` 真 PG（另一次執行）    | 10     | 0       | 0      |
| `node --test scripts/venue-phone-local.test.mjs` lifecycle | 7      | 0       | 0      |

`pnpm typecheck`、`pnpm build`、全倉 `pnpm lint`、shell syntax、變更檔案 Prettier 與 `git diff --check` 通過。普通 workspace 測試清除 DB URLs 與 harness opt-in，因此 database／邀請 HTTP 等需要外部 DB 的 suites 明確 skipped；另一次十項真 PG 使用全新私有 Unix socket 合成 DB，不把 mock 或 skipped 當成完整 DB 授權驗收。

額外全倉 `pnpm format:check` **不通過**：`AGENTS.md`、`apps/public-api/src/checkin-page.ts`、`apps/public-api/src/line-checkin-page.ts` 三份既有格式警告；逐檔確認和起點 `b65d142` 位元組完全相同。未為消除額外檢查而修改專案指令或無關舊程式；本次實際變更檔案格式檢查通過。這不是 typecheck/build/lint/test 失敗。

原始驗證 log（本地暫存、非正式 artifact）：`/tmp/venue-renumber-final-tests.log`、`/tmp/venue-renumber-final-gates.log`、`/tmp/venue-renumber-final-isolated.log`。另有核心 gates 全綠的 `/tmp/venue-renumber-final-core-gates.log` 及隔離清理留證 `/tmp/venue-renumber-final-cleanup.log`；早期相依與 lint 失敗亦如上記錄。

隔離 harness 只新建自己的 `0700 /tmp/venue-qr-pg.*`，無 TCP listener；退出 trap 停止／清除此新 cluster。最終留證確認新建的 `/tmp/venue-qr-pg.pCIEXX1A` 完成 10 項測試後執行自身 pg_ctl stop／rm，且目錄已不存在；未檢查或清理其他叢集。沒有連任何既有 DB、phone cluster 或正式服務；沒有刪 worktree。LINE verifier 仍 mock，未跑真人手機／LINE Console／實際 provider 發送。沒有可呼叫的 `allow_tool:false` hook，也沒有假稱完成該 hook 審查或本輪獨立跨家族安全 review。

## PR 摘要與限制

建議標題：**Integrate invitation/privacy updates and renumber unpublished venue migrations to 0048–0051**。

- 保留已發布 invitation 0047 與全部既有 SQL/checksums；只順延未發布 venue artifacts／引用。
- 本地 merge 最新 upstream，保留 invitation onboarding、privacy-safe diagnostics 與官方安全依賴，QR default-off／舊 NFC deny 不變。
- 加強精確 readiness、immutable invitation／全鏈回歸、fresh synthetic PG 與 startup opt-in 測試；文件區分現行規格與歷史證據。
- 核心驗證全綠；565 項一般 opt-in DB skips 與三份原有全倉格式警告明列，不聲稱正式 DB／手機驗收完成。

**沒有 push、遠端 merge、deploy、正式 migration、LINE Console 變更、讀 `.env`／secret、開代理或更動既有手機 0050 DB／程序。** 正式發布仍需另行核准相容窗口、遷移身份、停寫／備份與實際還原、資料保留與 logging 審核；若現場已有 venue 資料或未知角色，必須停下另審，不刪資料、不放寬 RLS。真人 LINE／Android／iOS／定位／回跳與 CSV 驗收尚未完成。
