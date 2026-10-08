# Telegram 學員 Web UI 與私人聊天摘要

## 狀態

使用者核准打卡頁與其餘三頁一起實作，並確認聊天摘要**不包含心得或感受**。本批為本機實作／隔離驗證，**尚未 commit／push／正式部署**。正式環境仍為 `ccd06a9`／schema `0020`；不得把本文件當成部署或真人 Telegram 驗收完成的紀錄。

來源：唯讀參考 `/Users/myhsu/Devel/qigong-telegram-bot`，HEAD `3886b40121326cdbef90233ef0370d6913b02146` 的 `public/webapp/*.html`、`src/routes/api.ts`、`src/services/chatSummary.ts`、`practiceTimezone.ts`、`stats.ts`、`badges.ts`。沒有修改舊 Bot、搬帳號／舊勳章、改依賴或啟用 LINE／WhatsApp／LLM。

## 四個頁面與入口

| 頁面               | 路徑                        | Bot 命令                                           |
| ------------------ | --------------------------- | -------------------------------------------------- |
| 練功打卡           | `/telegram/checkin`         | `/checkin`                                         |
| 練功排行榜         | `/telegram/leaderboard`     | `/leaderboard`                                     |
| 我的功法分析       | `/telegram/method-analysis` | `/methodanalysis`、`/methods`                      |
| 我的修練／每月歷史 | `/telegram/achievements`    | `/achievements`、`/history`、`/mystats`、`/badges` |

- 私人聊天的命令回覆附四個 `web_app` 按鈕，身份仍用平台既有15分鐘 capability，最新 Bot 連結會取代前一連結。頁面導航共用這份 capability；不憑未驗證的 Telegram `initData`／瀏覽器 user ID 授權。
- 繁中／英文、卡片式手機／桌機 UI。今天與昨天分開保留功法／心得／感受草稿，分類全選／部分選取、補登與期限內修改；失敗保留輸入、重試沿用 request UUID、寫入期間禁止重送或切換。成功後只重設已儲存日期，不清掉另一日期草稿。
- 語言／跨頁／重新載入只在實際修改時確認；恢復基線不確認。時區選擇同樣保護未儲存變更。接受離開後不再觸發第二次 beforeunload；官方 SDK 的 native closing confirmation 保護草稿及進行中的寫入。
- 使用官方 `https://telegram.org/js/telegram-web-app.js` 做 ready／expand／關閉確認。先從 fragment 取出平台 capability，僅留下 Telegram 自身的 `tgWebApp*` 參數供 SDK 初始化，最後清除 fragment；平台 capability 不交給 SDK 的 initParams sessionStorage 快取。支援 Telegram 以 `?` 或 `&` 附加參數，以及普通瀏覽器私人連結。
- CSP 僅放行官方 SDK script、同源 API、inline 靜態 script/style；只有 `https://web.telegram.org` 可嵌入這四頁。沒有擴張管理後台／LINE／WhatsApp 的 frame policy。回應為 no-store／no-referrer，動態姓名／方法／心得／標籤用 textContent／value，不使用 innerHTML。
- 確認／受控變更 canonical person 練功時區：24小時冷卻、相同日期及補登窗口，有記錄時不可跳越窗口；不重寫歷史日期／時區。既有明確連結到同一 person 的身份仍共用其時區，不擅自拆分或另建身份。

## API 與資料安全

新增 POST `/telegram/workspace/profile`、`/report`、`/save`、`/telegram/preferences/timezone`。所有請求要求既有正式 Origin、JSON content type、嚴格 payload 與有效 capability；身份必須已核准、person active、Telegram identity 未撤銷且互動管道有效。沒有 browser-supplied personId／chatId／region scope。

- `/report` 的 view：leaderboard／methods／achievements／history；排行榜 week／month／quarter／year／all、分析30／90天、歷史 `YYYY-MM`。無任意 person 查詢或無界限歷史分頁。
- 排行榜只含**目前同主要地區、已核准且管道有效的 Telegram 學員**，最多30位、同天數並列；其他人只顯示區域內遮罩代號及天數，不回傳姓名／Email／電話／provider subject／person UUID／心得／感受。另回傳本人名次，沒有套用管理員全域報表權限給學員。
- 分析每功法群每人每日最多一天；比例分母為 group-days 合計。本人近期心得及每月歷史可顯示私密文字／標籤快照，不翻譯原文、不傳 LLM。
- 自由文字與感受 ID 分開存；1000 Unicode code points、最多30個不同 tag。省略欄位保留既有資料；停用／改名不重寫歷史快照。
- `platform.telegram_workspace_save` 原子處理功法／私密欄位／版本／UUID request ledger／聊天摘要佇列；person lock、post-wait 授權與實際時鐘重驗證、版本衝突409。重複相同 request 回傳已提交結果；相同 request 改 payload 拒絕。單日唯一／補登與更正期限仍由 SQL 決定。
- 歷史 submit／correct API 保留相容，成功交易亦排入摘要。舊 correct API 沒有 UUID ledger，不宣稱替所有舊客戶端新增重試冪等性。

新增 `0021_telegram_learner_workspace.sql`：workspace preferences／checkin versions、request ledger／receipt outbox、49個固定 v1 badge definitions、person awards／change audit、season configuration 與耐久 jobs。新表全部 forced RLS；runtime 沒有直接表讀寫或內部 evaluator／arbitrary-person helper 權限。沒有新增管理員 role／permission／grant，沒有姓名／Email 合併。

## 摘要與 worker

摘要只包含：成功／補登／修改、日期、儲存的功法名稱、連續與累計天數。以交易內 committed-data snapshot 產生，收件人從已授權 Telegram identity 決定；不讀心得／感受／Email／電話。sender 另用明確欄位 allow-list，即使 payload 混入私密欄位也不顯示。

- `notification-worker.ts` 保留 onboarding lane，另加 Telegram receipts 及 badge reconciliation；三 lane 全部結束才關 pool。兩個 transport lane 各最多3筆、10秒 timeout，避免常態超過既有60秒 systemd budget。
- receipt lease 為10分鐘、claim skip-locked、最多8次、指數退避；恢復過期 lease，耗盡最後一次且 crash 的項目標記 failed。撤銷／停用後取消尚未發送的項目，送出前再檢查身份與 lease。
- 回覆失敗不回滾已成功的打卡；UI 說明「排入回覆」而非「已送達」。Telegram `ok:true` 僅代表 API 接受，不代表裝置收到。
- **不是 exactly-once**：Telegram sendMessage 沒有此流程可用的冪等鍵，API 接受後逾時或 DB ack 失敗／lease 恢復仍可能重複；不能撤回已在飛行中的發送。
- 錯誤只保存通用 delivery failure、內部 receipt UUID；不保存 provider URL／token／原始私密錯誤。

## 成就規則

固定 v1 結構化 code mapping：連續3／7／21／100天、累計10／100天、連續五天05–07或21–23一般提交（補登不符合）、六群同次全套年度獎、十一功法群7／30／100天及兩種季節獎，共49項。新增 taxonomy leaf 不會默默重寫既有全套規則。不用心得／文字別名推定功法，不搬舊帳號授獎。

- 連續／累計／功法／時段採 lifetime；全套／季節採年度 period。唯一鍵與 person lock 防並行／重跑重複；更正後不再符合時標記 revoked、保留 award 與 audit，重新符合則 restored，不硬刪除歷史。
- 更正與打卡 trigger 產生 durable job；worker 每批20位、person→job 鎖順序／skip-locked、不等待正在寫入的學員。已處理者下一日再 reconcile，因此活動結束且未再打卡者仍可評估；本人開成就頁亦會重新評估。
- 三伏／冬至活動須由受控 owner 提供**核准的年度起迄日、時區與 required_days**。本批不猜日期、不引入 lunar／cron 依賴、不 seed 實際活動。未設定時頁面明確顯示尚未開放。季節設定及 badge 管理／全域成就榜 UI 尚未提供。
- 首版 definitions 只讀；未來改規則須新版本／保存舊定義，不可直接改寫既有 rule arrays。新勳章不另發通知。

## 驗證與發佈邊界

Node24／pnpm10、隔離 PostgreSQL16，完整 `pnpm verify` 319項、無 skip（DB workspace15、生成頁26、API／sender18、schema upgrade新增1）。額外全測試 tsc 仍有四個舊檔的10項既有錯誤，無本批檔案錯誤；不宣稱全測試 typecheck 乾淨。

- 0020→0021、重跑無新增、舊 exact0020 契約拒絕、最新 exact0021 接受；既有應用表資料雜湊不變（core metadata 架構標記除外）。不是正式快照升級／還原演練。
- 受限 **worker-only** login 實際執行 compiled worker，三 lane 零項通過；沒有 migration-table SELECT 權限，schema readiness 用受限 boolean facade。測試全部外部 sender mocked／零真實訊息。
- 本機 Chrome／官方 SDK 合成資料：390px 四頁、1280px英文打卡、零橫向溢出／JS exception、fragment 清除、SDK快取無平台 capability、native closing guard、日期草稿、儲存及每月歷史；截圖人工檢查。不是實際 Bot／Telegram Android／iOS／Web 的真人驗收。
- API **min/max 均 exact0021**，worker亦檢查exact0021；不能把新程式直接替換正式schema20，也不能只把舊20程式指向21。正式需另核准 commit／push／部署、停API與worker、備份／snapshot 升級及還原演練、matching artifact／schema／worker切換。21→20 回復須配對DB，不是之前同20 UI-only binary rollback；開流量後要另外對帳後續寫入。
- 待真人驗收、核准活動日曆、空 feeling tag 目錄管理、durable webhook reply／rate／retention／outbox cleanup；不宣稱已完善所有營運工具。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

版權所有 (c) 2026 Bean, Bird & Badminton Tech Consulting
