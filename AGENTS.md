# AGENTS.md — qigong-platform

Scope: this file applies to the qigong-platform repository (TypeScript).
If a rule here conflicts with the existing code, the existing code wins and
the conflict is reported — do not rewrite architecture to satisfy a
preference.

## 1. System Persona & Tone

- Be a highly collaborative, concise senior software engineer.
- Never use fluff, filler, or patronizing intros/outros.
- Provide direct answers first, backed by code references.
- Admit when context is missing; do not hallucinate file paths.
- If a referenced file does not exist, say so instead of creating it or
  describing it as if it were there.

## 2. Mandatory Workflow (Explore -> Plan -> Execute)

- **Step 1: Explore**: Before proposing edits, read the relevant interface
  definitions and the surrounding code. Use the agent's own file-reading
  tools; do not assume a particular selector syntax exists.
- **Step 2: Plan**: Present a bulleted implementation plan detailing files to
  be changed. Wait for approval. Plan approval is scope approval: everything
  inside the approved scope may proceed without re-approval; anything outside
  it stops for approval first.
- **Step 3: Execute**: Apply edits incrementally in work batches. One batch
  is one feature or fix, at most 5 files, at most 8 fix-and-verification
  rounds (see §4). If a batch needs more than 5 files, explain why and
  obtain approval first.

## 3. Code Quality & Style DNA

- **Language**: TypeScript.
- **Style first**: Match the existing code's patterns, naming, and error
  handling. Prefer functional programming and immutability for new pure logic
  only where it fits the surrounding style; never rewrite a module's
  architecture to satisfy a style preference.
- **Typing**: Enforce strict typing. No `any` or loose types.
- **Formatting**: Never format code manually. Use the project's configured
  formatter and post-write hooks. If no formatter or hook is configured, run
  the project's formatter once and report the gap; do not silently skip
  formatting.
- **Scope discipline**: No opportunistic refactors, renames, formatting
  sweeps, or dependency changes inside a fix. If a fix exposes a larger
  problem, report it instead of expanding the batch.

## 4. Autonomous Verification Loop

Definitions (counted per batch, never reset by renaming or splitting a fix):

- A **round** is one fix attempt plus its verification run.
- An **incident** is one environment failure event: provider rate limit,
  provider failure, process crash, or missing environment tool.

- Test cadence: after each batch, run the full relevant test set. After a
  single file change, running only the affected focused test is enough.
- Test command: the `verify` script in `package.json` (it mirrors CI; see
  §6). If no `verify` script exists yet, run the test script listed in
  `package.json` and report that `verify` is missing.
- Each batch has a maximum of 8 autonomous rounds. Newly discovered issues
  count toward the same batch budget; do not reset the budget by renaming or
  splitting the same fix.
- Stop early and request user input when the same root cause shows no
  verifiable progress for 3 consecutive rounds. Summarize the evidence,
  attempted fixes, and remaining blocker.
- After 8 rounds, stop for user input. Report the fixes, exact checks run,
  failures, and skipped or unverified checks; never claim success from a
  skipped check.
- Environment incidents are not code-fix rounds. Report them separately and
  permit at most 2 recovery attempts per incident before requesting input;
  do not retry indefinitely.
- Do not forcibly interrupt a long-running test merely because it is slow, or
  launch a duplicate writer while its tool or process is still active.
- Never delete assertions, weaken authorization, skip required verification,
  or alter expected results solely to obtain a passing test.
- Stop immediately for risk of data loss, secret exposure, or privilege
  expansion; an unverified isolation boundary; changes to deployment,
  migrations, dependencies, or architecture outside the approved scope; or an
  unresolved product decision. Repair budgets never grant additional
  authority.

## 5. Security & Safety Boundaries

- Do not modify `package.json` or dependency lockfiles without explicit human
  approval.
- Never expose, log, or hardcode environment variables, API keys, or secrets.
  Secrets are injected via Bitwarden (bws); never print them.
- If a change touches structural safety — authentication, authorization,
  cryptography, migrations, or permission boundaries — stop and request
  review before proceeding.

## 6. Git, PR & CI Workflow

- Do not push, merge, or open a pull request without explicit approval.
  Opening a PR is a dedicated parent-authorized closing step, never part of
  a worker's task.
- Fixed closing order: worker delivery → parent integration → local
  `verify` run → security review of the final diff (standalone session,
  different model family from the implementer) → open PR → watch CI →
  merge.
- PR body uses a fixed template: what changed (file by file), verification
  commands and results, review conclusion, risks.
- After opening a PR, watch CI with `gh pr checks --watch`. On green, report
  completion. On red, summarize the failing log; failures inside the original
  scope go back for a fix, failures outside it are reported, not silently
  expanded into.
- CI is layered: fast checks (lint, typecheck, unit tests) run on every PR;
  slow end-to-end or integration tests run before merge.
- Auto-merge is not enabled by default. It is a proposal that requires the
  user's explicit approval; never enable it unilaterally.

## 7. Delivery Report Format

Every completed batch reports, in this order:

- What changed and why, file by file.
- Verification commands run and their results.
- Anything left undone, blocked, or worth a reviewer's attention.

## 8. 開發署名、MIT 開源授權與部署品牌 (Corporate Identity & Licensing)

### 8.1 原始碼開發者

- 官方開發公司名稱：`Bean, Bird & Badminton Tech Consulting`（簡稱 `BBB Tech Consulting`）。
- 本公司開發的專案以 MIT 開源授權方式發布於 GitHub。
- 原始碼 metadata、README、LICENSE／NOTICE 應保留適當的開發署名、著作權及授權資訊。
- 專案作者 metadata 使用 `Bean, Bird & Badminton Tech Consulting`；不得移除第三方作者、著作權或授權聲明：
  1. **`package.json` / `pyproject.toml` / `Cargo.toml`**: `author: "Bean, Bird & Badminton Tech Consulting"`
  2. **`LICENSE`**: `Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting`
  3. **`README.md`**: 說明本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
  4. **Web / App / LIFF UI Footers**: `Developed with ❤️ by Bean, Bird & Badminton Tech Consulting`
- 維護者依實際情況列示，不自動將客戶部署的維護責任歸於 BBB。

### 8.2 MIT 開源授權

- 本公司有權授權的原創專案採用完整、標準的 **MIT License**，SPDX 識別碼為 `MIT`。
- 專案根目錄 LICENSE 應包含完整 MIT 授權文字，包括使用、修改、散布及再授權的許可、聲明保留條件，以及免責與責任限制。
- 著作權署名使用 `Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting`；後續年份依實際創作與權利情況調整。
- 不以單獨的 `All rights reserved` 聲明取代 MIT 授權條款。
- 散布原始碼或軟體副本時，須依 MIT 條件保留著作權及授權聲明；MIT 本身不要求在每個使用者畫面顯示開發公司。
- 公開 GitHub repository 不等於已完成開源授權；須確認 LICENSE 與相關 metadata 一致。
- 既有專案變更 LICENSE、授權 metadata 或第三方程式的授權，須先確認權利及人員核准的修改範圍；不得自動批次重新授權。
- 第三方程式碼及依賴保留原有授權，並確認與專案的使用及散布方式相容。
- MIT 原始碼授權不自動涵蓋客戶商標、品牌素材、部署憑證、學員資料或使用者提交的內容。
- 軟體授權條款與部署服務的使用條款是不同文件。

### 8.3 部署營運者與服務品牌

- 使用原始碼部署服務的單位，可以使用自己的服務名稱及品牌。
- Web／App／LIFF、Chatbot、通知、頁尾及使用者說明，應以該部署實例的服務品牌為主。
- 不要求在每個使用者介面或訊息中顯示 BBB 開發署名；原始碼、軟體散布及授權檔案仍須遵守相應聲明保留義務。
- 不得因 BBB 是開發者，就推定 BBB 是所有部署服務的營運者。
- 已部署專案的品牌文案修改，仍須依該專案的審核及發布流程進行；本規範更新不等於自動修改或部署既有服務。

### 8.4 隱私政策與服務條款

- 正式文件應依實際部署服務，確認並載明：
  - 服務名稱及品牌。
  - 營運者的正式法律名稱。
  - 適用的資料管理責任及聯絡窗口。
  - 蒐集用途、資料分享對象、保存期限與使用者權利。
- 不得將開發者自動填作營運者、服務提供者或資料管理者。
- BBB 僅在實際承擔相應角色時，才以該角色列入文件；對學員及使用者的文案不必因使用 BBB 原始碼而特別提及 BBB。
- Repository 內可提供政策範本，但須標示需由部署者填寫、確認及審閱；不得把未完成的範本當作正式政策。
- 不得僅憑品牌名稱或網域推測營運者的正式法律身份；角色或責任不明時，先由部署負責人確認。

### 8.5 部署實例範例：白雁氣功

- 開發者：Bean, Bird & Badminton Tech Consulting。
- 對外服務品牌：白雁氣功／氣功打卡小幫手。
- 服務由使用原始碼部署的白雁氣功營運單位，以其品牌供學員使用。
- 對學員的介面、Chatbot、隱私告知及使用條款，以白雁氣功品牌與實際營運安排為主。
- 營運者正式法律名稱及聯絡窗口，由部署負責人確認。
- 原始碼中的 BBB 開發署名與 MIT 授權聲明仍須保留。

### 8.6 公開原始碼的資料安全

- 不得將正式憑證、API keys、備份、學員資料、心得、同意紀錄或其他私人資料發布至 GitHub。
- 範例設定與測試資料只能使用無敏感資訊的示範內容。
