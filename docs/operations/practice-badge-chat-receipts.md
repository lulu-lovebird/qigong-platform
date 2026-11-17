# 打卡聊天收據遺漏新成就：migration66 修正

狀態：本機修正與隔離測試完成；正式環境已先升級65，**尚未發布本修正或執行66**。不使用正式學員補登、撤銷／重頒成就或測試聊天訊息。

## 已重現的原因

- `channel-workspace.ts` 原本在自己的儲存交易提交前，透過另一條 pool 連線呼叫批次 reconciliation。該連線看不到當次未提交打卡，且 API login／role 並未取得此批次 evaluator 權限；錯誤又被忽略。
- LINE 的前後 report 比較沒有可靠的同交易評估、完整 award key 或持久化快照。
- Telegram 的 queue payload 與文字 renderer 都沒有完整的新徽章欄位。合成資料即使傳入 unlockedBadges，原 renderer 也會略過它。
- 舊 LINE badge-only SDK helper 吞掉發送錯誤，仍關閉 LIFF，不能區分資料已儲存與聊天送達未確認。

這是程式與合成測試的診斷，不是對使用者正式紀錄做重算或單筆資料取證。

## 實作

### SQL：同交易、本人、可重試

`migrations/0066_practice_badge_receipts.sql` 保留原 authenticated community save 的九參數簽名、owner 與 ACL。只處理 LINE／Telegram；WhatsApp 日課與團練不改流程、不啟用功能。

- 驗證本人、community person advisory lock、TG link row lock、person row lock，再次驗證；維持 TG link→person 順序。
- 新 requestUUID：先評估既有狀態，取得 active `(code,ruleVersion,period)` baseline，再原有 save、評估當次變更與計算差集。撤銷後恢復可再次列入；沒有新 award 不恭賀；不更改成就門檻或資格規則。
- Replay 仍呼叫原 save 驗證 fingerprint，但不重新評估、不建立新收據。首個 delivery owner 保留於原有 request cache。
- Fresh wrapper nonce 僅作收據關聯，不是身份證明。nonce 在 transaction-local GUC，兩個原 queue builder 放進內部 payload，wrapper 以 nonce＋本人／identity／checkin 嚴格找到當次收據，立刻移除 marker。partial indexes 只支援這個短暫關聯。
- note、nonce、achievement cause 的原 GUC 值在成功／例外路徑恢復；交易／savepoint 回滾可能恢復先前值，不宣稱例外後必為空字串。
- private snapshot helpers 為 SECURITY INVOKER、固定 search_path，清除 PUBLIC／API／worker 及非 owner ACL；不授予 API 任意 person evaluator 或 badge table 讀取。
- 新徽章 metadata 來自保存 award 的版本定義，與新安全摘要／收據及 cache 在同一個交易完成。worker 看不到未提交的半成品。

### LINE：協商一次交付所有權

新版頁面送 `lineReceiptMode=liff-summary-v1`，僅協商通知所有權，不作授權依據。

- 新版：在 commit 前將當次 Bot 收據標為 cancelled（原因為 LIFF owner，**不是 delivered**），API 只回傳 receipt ID 與白名單 formatter 生成的完整摘要＋新徽章文字；LIFF await sendMessages 後才可自動關閉。
- 舊開啟頁面不送 mode：保留一則 Bot summary，payload 含新成就；API 隱藏頂層 unlockedBadges／lineReceipt，避免舊 badge-only JS 再送一次。
- 更換 capability 重試同 UUID 不轉移首個 owner，也不重排另一個 sender。
- schema65 兼容階段尚無 lineReceipt，維持原 Bot 回覆；新 API 不再做錯誤的跨連線 reconciliation。
- SDK 缺失／不在 LINE client／拒絕／結果不明：顯示「已儲存，但聊天未確認送達」、保持頁面，不自動轉 Bot、不自動重試／重存同樣內容。訊息 attempt/sent sets 防同頁重入；這不是 provider 網路端的全域 exactly-once 保證。
- 畸形200／服務錯誤不假裝儲存已確認；保留 requestUUID、草稿，可安全重試原操作。保留另一日期與未儲存時區選擇。

**配額界線：**新版已由 LIFF owner 接管的收據不做 Bot Push。舊頁面相容路徑仍使用 Bot Push，可能消耗原有配額；不能從 cancelled rows 或 receipt row 數推論實際計費量。

### Telegram 與隱私

同一交易把新 badges 放入原有待送收據，worker 提交後讀到完整 snapshot。formatter 僅使用允許的日期／功法／統計／指引與 badge metadata；不加入心得、感受、聯絡資訊或 credentials。

Legacy UI 別名只在 code／version1／名稱／門檻／methods／configurationKnown 等完整白名單條件吻合時使用；publisher 與不同版本名稱不猜測。訊息保守限制4000 UTF-16 units、不切斷正常 emoji；徽章在指引前，過量時明示剩餘數量與「我的成就」。

## 驗證與審查

- 正陽晨功＋夜功的新 award 在 legacy 與 versioned 模式的 LINE／Telegram 收據均有隔離測試。
- 覆蓋：同 UUID／改 fingerprint／併發、無新 award、補登、修正撤銷與恢復、完整版本／period key、GUC 恢復、失敗 rollback、private helper 權限拒絕、worker 在 commit 前看不到收據、舊65 cache／未送 receipt 升級不被回填或搶走 owner。
- LIFF VM：等 SDK 完成才關閉、SDK reject／外部瀏覽器不假稱成功、無變更不重存、畸形200重用 UUID、保留其他日期與時區草稿；no actual messages。
- Node24 全檔 tsc 與帶專用 PostgreSQL16 的 verify 有通過紀錄；最終發布以 exact commit CI 及實際最後測試紀錄為準。89項專用 runner 場景未跑，不列為通過。
- Gemini 3.8 Flash 的 fresh standalone 跨家族設計及程式靜態審查為 APPROVE；reviewer 沒有自行執行提供的測試。這不是所有任意舊系統路徑都不會 deadlock，亦不是 provider 全域 exactly-once 保證。

## 發布前與順序

1. 完成 commit／push、exact head CI、PR／main 審查與合併授權。
2. 確認既有 LIFF app 的 `chat_message.write` scope 與實際 client permission。匿名 metadata 嘗試未能確認，**不是已證實有權限，也不是已證實缺權限**；若權限未配置，SDK 會明確顯示 saved-but-unconfirmed，不能以此當完整交付驗收。
3. 保持 WhatsApp venue flag OFF，不改官方門號、不啟用其他功能。
4. 新鮮一致性備份、檔案校驗及原65檢查；65已部署且不得改寫其 SQL／checksum。
5. **先部署兼容65／66的 API 與新收據 worker**。receipt worker 必須重新載入 renderer；短暫停 fallback timer並等既有舊 oneshot 完成／妥善 drain，避免66 payload被舊 renderer略過。環境／tokens 不變，勿以學員訊息做部署探針。
6. 留存66相容 fallback build再套66，限制 lock／statement timeout。索引／函式變更由 migration runner 同交易處理，失敗保持65。不要在66成功後切回 max65 binary；不可用舊 DB 備份覆寫已接受的新打卡。
7. 驗證 currentVersion66、API／worker readiness、原 LINE／Telegram／WhatsApp 路由兼容與 metadata/ACL；不執行正式 learner evaluator 或發測試 Push。

**今日已取得但舊聊天漏掉的徽章不自動補推**，不為了補訊息撤銷或重頒，也不重新處理舊 request cache。需要補發時應另取得使用者授權並評估重複／配額，不混入本次正常儲存流程。
