# 手機 QR：持續運行的隔離本機環境

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 2026-10-26 交付狀態：本機 running，HTTPS／真人 onboarding 被阻擋

**不要把 HTTPS 的 HTTP 200 當作簽到服務已就緒。** 此輪實際讀到的 Tailscale Serve 是 foreground `443 / → http://127.0.0.1:55043`，不是交接預期的 `3100`。
以本機 `/usr/bin/curl` 正常驗證 TLS，`/line/` 與 QR 頁回 200，但 title 是 **OpenClaw Control**，body hash 不等於隔離 API；HTTPS `/health/ready` 回 404。
未重設／變更這個既有 Serve、未停止其他程序、未開 Funnel。現在沒有可如實宣稱能用手機完成簽到的 HTTPS URL。

隔離 API 已 detached 運行，僅 bind `127.0.0.1:3100`，不隨啟動命令結束退出；不是開機服務，重開機／清除 `/tmp` 後不保證留存。

| 項目                      | 本輪保留的實際值                                           |
| ------------------------- | ---------------------------------------------------------- |
| private root              | `/tmp/venue-phone-pg.oYLjj3`（0700）                       |
| API PID                   | `15860`                                                    |
| PostgreSQL postmaster PID | `15851`                                                    |
| socket                    | `/tmp/venue-phone-pg.oYLjj3/socket`                        |
| socket port               | `55480`；`listen_addresses=''`，無 TCP                     |
| state（無憑證）           | `/tmp/venue-phone-pg.oYLjj3/state.json`（0600）            |
| schema                    | `0050_venue_qr_attendance.sql`；完整 repo migrations       |
| readiness                 | `http://127.0.0.1:3100/health/ready` → 200，`ready:true`   |
| session / runtime         | `venue_phone_login` / `qigong_api_runtime`，preflight 通過 |

PID／目錄是本次快照，不應作固定配置；未來啟動以工具輸出的 state 為準。

## URL 與目前限制

目標 LIFF URL（**尚不可作完成驗收用**）：

```text
https://liff.line.me/2011968988-KX3MjakL/venue-checkin?venue=tw-location-test&source=qr
```

目標 HTTPS 預覽／簽到入口（目前送到其他服務）：

```text
https://mingyenmac-mini.tailbf9b8d.ts.net/line/venue-checkin?venue=tw-location-test&source=qr
https://mingyenmac-mini.tailbf9b8d.ts.net/line/
```

本機已驗證可用的 HTML：

```text
http://127.0.0.1:3100/line/venue-checkin?venue=tw-location-test&source=qr
http://127.0.0.1:3100/line/?liff.state=%2Fvenue-checkin%3Fvenue%3Dtw-location-test%26source%3Dqr
```

這是 server QR enabled 的真簽到頁，不是 mock 成功頁；GET 不定位、不提交。`venueQr.publicOrigin` 精確為 `https://mingyenmac-mini.tailbf9b8d.ts.net`；舊 NFC 關閉。LIFF Console Endpoint 是否確為此主機 `/line/` **尚未核對或變更**。

手機需要加入允許存取此節點的 tailnet 並啟用 Tailscale；未開放公網。即使修復路由，仍須確認 LIFF Console Endpoint、LINE OAuth 回跳與手機瀏覽器定位權限，不能以本機 curl 代替。

## DB、憑證與副作用邊界

- 啟動器固定使用 keg-only Node 24／PG17；只新建 `0700 /tmp/venue-phone-pg.*`，不用 brew default cluster／service 或任何傳入 DB URL。
- migrations 僅以新 cluster 的 `venue_phone_owner` 執行；API login 為 `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`，只有 `qigong_api_runtime` membership、無直接 object grants／ownership。不是 superuser 跑 API。
- Unix socket trust 限制於私人 0700 目錄。此方案只供同一受信任本機帳號測試，不是正式 DB 憑證方案。
- 唯一自訂 seed：三層合成 region 與 `tw-location-test`「目前位置測試場」，Asia/Taipei、100m、每日 `[00:00,24:00)`。固定測試場地座標在 runtime seed，並非收集到的原始 GPS。
- 只在此空 DB 啟用既有 privacy policy，**沒有**代使用者接受同意、建立學員／LINE identity／onboarding approval／admin principal／session／invite。沒有載入既有含合成學員的 PG test fixture。
- LINE 四項僅由短命 Node `--env-file` 子程序選取到受控記憶體管道，父程序不直接讀 `.env`；其餘 service 設定不傳給 API。`NODE_OPTIONS` 明確覆蓋為空。LINE 值不放 shell argv、state 或 logs；不把環境載入 shell。
- API 的 DB connection 僅由已驗證新 cluster socket 組成。API logger 關閉，stdio 丟棄；PG 關閉 statement／參數 logging，error statement／message threshold 為 panic。啟動時 shell 關閉 core dumps。不以此宣稱可控制外部裝置的封包或 crash dump 收集。
- 使用既有真 LINE verifier，沒有 mock、合成預設學員或身份 bypass；只有使用者實際送出登入請求時才會按需驗證。此輪未向 LINE 送憑證探測／verify 請求，也未完成手機登入。
- 不建立 adminAuth，不做 OIDC discovery，隔離 API `/admin/venue-qr` 為 404。`/line/webhook` 在解析前回 404，reply adapter 另 fail closed，不發 LINE 訊息。沒有 notification worker、Telegram／WhatsApp 配置或連正式 DB。
- 不修改原 migrations、package／lockfile、日課邏輯或既有 worktrees，沒有 push／部署／merge／開代理。本機沒有可呼叫的 `allow_tool:false` hook；未假稱已取得該 hook 安全審查。

## 新真實帳號：安全 onboarding 策略與精確 blocker

目前 DB 的學員／LINE mapping／admin principal／attendance／日課皆為 0。未取得真實 LINE subject，也不應把真帳號綁到任一測試假學員。

完成真人驗收前需要另外核准、逐項解鎖：

1. **HTTPS 路由衝突**：現有 443 Serve 屬另一服務；需由擁有者核准專用路由／origin 或明確調整它。不執行 `serve reset`，不擅停 OpenClaw。若換 origin，必須同步 QR server 配置，不能用 URL 參數 bypass。
2. **既有 onboarding Origin**：`apps/public-api/src/line-onboarding.ts` 的申請、`line-invites.ts` 的邀請，以及 `learner-privacy-routes.ts` 的同意提交，都只接受 `https://checkin.baiyinqigong.org`，不是此 tailnet origin。此輪不改這個安全契約；不能從 tailnet 頁直接完成它們，也不要轉去正式站提交測試資料。
3. **正常申請入口憑證**：`/line/apply` 不是無條件註冊；需要既有流程簽發的申請 link。isolated webhook 已封鎖，未改正式 webhook，沒有向 bot 發訊息取得 link。不能偽造 subject、link、privacy acceptance 或 approval 補齊。
4. **受授權的人工核准**：需安全配置針對本 isolated DB 的管理員身份與地區權限，讓真實手機登入經既有 verifier → 本人同意 → 申請 pending → 授權管理員人工審核。既有管理頁路徑 `/admin/applications`、審核 API `POST /admin/api/applications/:id/decision`；本 runtime 刻意不註冊它們，沒有可用的本機核准 URL 或 default key。需要另行核准安全的管理操作方案，不以 autoapprove／臨時 superuser identity mapping 代替。

修復前的診斷目標 URL（只有本機 HTML 能開，提交流程仍受以上限制）：

```text
https://mingyenmac-mini.tailbf9b8d.ts.net/line/apply
https://mingyenmac-mini.tailbf9b8d.ts.net/privacy?platform=line&lang=zh_TW
```

解除上述限制後，才能讓本人用目標 LIFF URL 登入／同意／申請，由授權者核准後再到場測試。不要求在聊天或 shell 貼出 idToken、accessToken、LINE subject 或 GPS。

## 啟動／停止／清理

從 repo root 執行；不要在 shell `source .env`，也不要改用真實 DB：

```sh
ulimit -c 0
/opt/homebrew/opt/node@24/bin/node scripts/venue-phone-local.mjs start
```

若 3100 已占用會拒絕，不停止未知程序。新啟動會建立全新空 DB；不重用舊 cluster。啟動失敗只清理自己新建的 app／cluster，若不能確認所有權則保留並報路徑。

本次**停止但保留 DB**：

```sh
/opt/homebrew/opt/node@24/bin/node scripts/venue-phone-local.mjs stop /tmp/venue-phone-pg.oYLjj3
```

本次**停止並刪除這個私人測試目錄**（也可在 stop 後執行）：

```sh
/opt/homebrew/opt/node@24/bin/node scripts/venue-phone-local.mjs cleanup /tmp/venue-phone-pg.oYLjj3
```

工具先驗證 private marker／UID／0700／postmaster 路徑，再確認 API PID 的精確 command line；只對匹配的 API PID 發 SIGTERM，使用指定 data-dir `pg_ctl -m fast -w stop`。不 `pkill`，不觸碰既有 Serve 或其他 cluster。沒有 resume 指令；停止後若需新測試，可 cleanup 舊目錄再 start 新空 DB。

## 本輪實際驗證

- launcher 單元／安全契約：**7 passed**。
- QR、LIFF HTML／primary redirect、QR admin regression：**110 passed**。
- 既有一次性 PG harness：**10 passed／0 skipped**，真正完整 migrations、合成 verifier 的 DB 行為測試；不是手機／真 LINE 證據。
- harness 前三次因本機 macOS locale 使 PG startup `postmaster became multithreaded during startup` 失敗；最後一次明確 `LANG=C LC_ALL=C` 成功，沒有修改既有 harness。診斷保留的失敗 cluster 已清除；測試成功 cluster 由原腳本清理。
- workspace typecheck、獨立 strict tsc 檢查 `scripts/venue-phone-runtime.ts`、新增檔案 Prettier 與 `git diff --check` 通過。
- 持續 phone cluster 另通過完整 migrations、runtime preflight；DB 設定核對無 TCP、socket 0700、參數 logging 為 0，僅 1 個合成場地，無學員／管理員／簽到／日課。
- local health、LINE entry、QR GET／primary 均 200；空 JSON 的 QR POST 回 400（無 token／位置、未進 verifier）；webhook 與 admin disabled 為 404。
- 啟動 → cleanup → 3100 釋放／私人目錄消失已實測，重新建立此表列出的 cluster 留給後續操作。
- 正常 TLS curl 確認 HTTPS 回應來自錯誤的既有服務，因此 **HTTPS 手機環境未達成功定義**。沒有宣稱 LINE verify、手機定位／簽到或 endpoint 已驗收。

可重跑的非真人測試（清空繼承 service 設定）：

```sh
/opt/homebrew/opt/node@24/bin/node --test scripts/venue-phone-local.test.mjs
env -i HOME=/Users/myhsu LANG=C LC_ALL=C \
  PATH='/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:/usr/bin:/bin' \
  bash scripts/test-venue-qr-local-pg.sh
```
