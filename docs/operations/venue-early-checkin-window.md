# 團練開始前30分鐘開放打卡（schema58；本地候選，未部署）

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 核准範圍與資料契約

- 基底 `89854cc271a6285d3b11780786378ae0b72b7eb0`（schema57），唯一 writer 分支 `feature/venue-early-checkin-window`。僅本地／全新隔離 PostgreSQL／待父代理 review、PR；未 push、merge、部署、連線正式 DB、啟用 Debug 或更改任何正式場地。
- `active_time_rules.start_time`／`end_time` 仍是真正團練時間。例：CKS 週六09:00–11:00不改，推算打卡08:30–11:00；migration 不 UPDATE 場地，亦不補出席或改任何既有 attendance／audit。
- 正式 `platform.venue_qr_checkin` 與 Debug `platform.venue_debug_checkin` 均在 DB 權威 clock 下，包含重播，每次套用同一規則：`session_start_instant - interval '30 minutes' <= at_time AND at_time < session_end_instant`。開始含、結束不含。不是 API／client 時間覆寫。
- 星期以**團練開始的場地當地日期**判定。helper 檢查當地 today、tomorrow：週六00:15團練可在週五23:45開放；週日00:15可在週六23:45開放。多 weekday 仍用原 JSON array，不加其他團練日。
- `attendance_date` 仍為 `(actual_checkin_at AT TIME ZONE venue.timezone)::date`，**不是團練日期或 UTC 日期**。例如週五23:45打卡記週五；午夜後同場打卡屬週六，依原契約可能另算一次。唯一索引仍 person／venue／actual-local-date／`is_test`，正式與 test 隔離。
- 原 JSON 時間驗證保持：`start < end`；start 不可24:00，end 可24:00，代表團練日次日00:00且該瞬間拒絕。不增加一般跨夜團練支援。

## 時區與 DST 決策

helper `platform.venue_checkin_window(jsonb,text,timestamptz)` 先用場地 timezone 把每個候選團練日的 start／end 轉成真正 `timestamptz`，**之後**才減30分鐘 elapsed interval；不先從 local `time` 減30而回繞或套錯 weekday。

沿 PostgreSQL `AT TIME ZONE` 既有解析：DST 不存在的時刻採 transition 前 offset；重複時刻採 transition 後 offset（一般 spring gap／fall fold 為 standard-time interpretation），不由 client 自創 offset。測試明確鎖定 America/New_York 2026-03-08 02:15→07:15Z（提前窗06:45Z）與2026-11-01 01:15→06:15Z（提前窗05:45Z）。若轉換後 start／end 不形成可用區間，條件不會放行。NULL、非 finite at_time、壞 JSON／時間／weekday、無效 timezone 全部回 FALSE；入口以 `IS DISTINCT FROM TRUE` fail closed。

管理頁為沒有具體日期的**一般週例唯讀預覽**。平日以顯示的 local HH:mm 推算，明示 DST 切換以 DB 實際瞬間判定，不把無日期預覽當某次 DST 課程的授權。跨日清楚列「前一天週六23:45–週日01:00」。無效輸入顯示無法計算，不顯示 NaN／假開放。

## SQL、ACL 與撤銷

- 僅 forward 新增 `0058_venue_early_checkin_window.sql`；0001–0057 bytes 不變。registry 沿 filesystem 自動列舉。
- helper 為 STABLE、SECURITY INVOKER、固定 `search_path=pg_catalog`、純 JSON／zone／instant 計算，無查表、SECURITY DEFINER、新 role 或 read grant。移除 PUBLIC 及 migration owner default ACL 帶入的額外 grantees，僅授 EXECUTE 給 `qigong_venue_qr_writer`／`qigong_venue_debug`（owner 固有權利除外）。只定向修改新 helper ACL，不修改 global default ACL。
- readiness 以 runtime 查 catalog，驗 helper 的 invoker／search_path、owner 等於既有 platform schema owner、兩 writer execute、無 runtime／worker／其他 grantee／grant option。不給 runtime helper EXECUTE；實際 PG tamper 測試授給 runtime 後 readiness 拒絕，再撤銷。
- 兩個入口以固定靜態 CREATE OR REPLACE DDL 重列。source-comparison test 精確比對 schema57 完整尾段，允許的唯一變化就是兩個時段 gate 換 helper；owner、ACL、metadata、proof、context、其他函式 body 一致，沒有 `pg_get_functiondef` 模糊字串重寫。
- migration **刪除舊 `platform.venue_debug_config` singleton row**，包含非空 enabled 舊配置。原 token fail closed、無 scope 搬移，不建立 secret／enabled rows，不自動延長 expiry。新配置、正式 flags、正式 activation 一律另行核准；本輪沒有 provisioning。
- test-site normal API／SQL 仍早拒，不因在半徑內或重播而回正式成功。每 token 仍只 scope 單一 test-site 或 CKS；hash、HMAC nonce／issued、canonical ms expiry≤60min、GPS、身份／同意／approval、原 hierarchy guard、原半徑及 contexts 隔離保持。正常入口既有 hierarchy 行為不順手擴 scope。
- 原 test writer 限制、正式 history／CSV／people／rollups 排除 test、日課不自動建立，全數保持。未修改任何 role logging 設定。

## 頁面與 compatibility

- 管理頁改稱「每週團練日」「團練開始／結束」，另列唯讀打卡預覽。輸入／weekday／timezone 變更即更新。save payload 保留09:00等原團練值，不新增可寫 lead／checkin-start；唯讀角色不因預覽得到儲存權限，版本／draft／CSRF／mobile grid 維持。
- 學員繁中、簡中、英文區分團練／打卡時段、場地時區、前一天提前窗、實際 local check-in 日期。只提供通則，具體團練時段由管理員既有場地資料提供；沒有授權 metadata 就不虛構數字，不新增公開場地枚舉 API，不讀 query 個人時程或接受 client clock。
- 保留 PR8 status／按鈕旁回饋、locating→sending→success、reduced-motion／in-view scroll、test unavailable 單份訊息、原生月份、語言偏好與 SDK 回跳。history page 未變更。
- API max58。Debug enabled 僅精確 `0058_venue_early_checkin_window.sql`；Debug off／正常與管理 people 等既有57相容保留。Suite exact chain counts 54–58；未知59及同號未知 filename 拒絕。
- **升58後不可直接 rollback 原 `89854cc` max57 binary。** 後續需另備經審核／驗證的58-compatible feature-off baseline 或 fix-forward；本輪沒有建立 fallback release。不可 unsafe down migration／以舊 snapshot 覆蓋新寫入。

## 真正驗證與限制

使用既有 Node24、PG17，依賴 frozen-lockfile／offline／ignore-scripts 安裝，無新增 dependency／下載 browser。`scripts/test-venue-debug-local-pg.sh` 以 `env -i`、fresh0700 `/tmp`、socket-only、owner／marker／pid guard；不讀 `.env`、未知 DB URL 或其他 worktree 編譯物。

- `bash scripts/test-venue-debug-local-pg.sh focused`：PG17 Debug25、management16、people11、normal QR10全部通過。
- Debug beforeAll 真正先套0001–0057，插入非空舊 Debug 配置、正式／test attendance 及 audit，再只套0058／repeat0。舊 ledger checksum、attendance、場地、audit exact；既有 function owner／ACL／metadata、policy、role／membership、table owner／ACL／RLS、default ACL exact。只有兩入口 body、new helper catalog、新 ledger、宣告的 config revocation 變更。
- PG helper 固定時間涵蓋08:29:59.999拒／08:30含／09:00／10:59:59.999／11:00拒、31min、非 weekday、多 weekday、Sat／Sun 前日午夜窗、end24、Asia/Taipei、New York gap／fold、NULL／壞輸入；不是 source/mock 冒充 SQL 證據。
- 正式／Debug 入口以**真 now＋合成受控 schedule**驗提前30接受、31拒及重播重查，early window 內 consent／inactive identity／missing GPS／stale proof 仍拒。跨午夜固定時刻的日期／唯一索引為 owner-only 合成 insert fixture，使用同 helper 與原 date expression；不宣稱在真時鐘午夜做了 LINE 真人打卡，未加 production clock override。
- 全量 `bash scripts/test-venue-debug-local-pg.sh full` 已通過 format／lint／source typecheck／tests／build，另含 `tsconfig.eslint.json` source-and-tests strict 與 `tsconfig.receipt-health.json` strict：config2、identity6、database566 pass／10 skip，public API2626 pass／62 skip（專屬 isolated PG tests 在 focused 另行執行）。
- 既有 Chrome loopback mock：320／390／1280px 無橫向溢位，mobile start／end 同寬堆疊、desktop 同列，09:00 payload 保持、08:30預覽及 Sunday←Saturday 前日字樣通過並檢視截圖。`/tmp/venue-window-browser.log`、`/tmp/venue-window-admin-{320,390,1280,midnight}.png` 僅是合成 UI，不是 DB／身份／手機證據。
- 本機無 PG16，PG16 **未驗**；未做真人 LINE／手機、正式 logging、雲端／外部 provider、migration 正式備份還原或部署。沒有 SSH、Cloudflare、Console／Rich Menu、Tailscale phone DB、真資料、子代理、push、merge、刪 worktree。

交接檔：`/tmp/venue-early-window-HANDOFF.md`。父代理須 inspect diff／跨家 review／重跑測試後才能另依核准 push PR；本地通過不等於正式已開放。
