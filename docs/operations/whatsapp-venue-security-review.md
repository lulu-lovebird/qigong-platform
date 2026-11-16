# WhatsApp 團練場打卡：本機初步安全檢查

狀態：**以下為早期階段檢查記錄，不是最終跨家族安全審查通過紀錄。** 之後已實作且經同家族、隔離上下文補充審查的範圍包括 SQL 身分／writer、schema65 整合與本人紀錄；後續 Bot／可操作頁與 gate 見部署準備文件。早期「未實作」描述只代表當時階段，不代表目前檔案仍不存在。最終啟用／部署仍須完成發布關卡。

## 審查方式與限制

- 本機協調者唯讀核對目前純函式、測試、設計文件及既有 Session／LINE 場地 SQL。
- `wa-security-review`（Claude Opus 5）未能執行：審查服務憑證失效。
- `wa-security-review-2`（Gemini 4 Argon High）未能執行：服務回報使用額度限制。
- 兩次都未取得模型審查結論，不可記為獨立審查完成或核准。
- 不執行正式 DB 查詢，不修改既有登入／RLS／資料庫，不啟用路由、不部署。

## 更新：指定 GPT／Gemini 雙審查嘗試

- `wa-safe-review-1`／`cliproxyapi/gpt-6-astra`：已完成唯讀審查。這是同模型家族、獨立上下文的補充審查，**不構成跨家族驗證**。
- `wa-safe-review-2`／`cliproxyapi/gemini-4-argon-high`：未能執行，服務仍回報使用額度限制；沒有 Gemini 審查結論。
- GPT 對已實作的純 URL／資料契約／無腳本 UI 判定 **CONDITIONAL**；對未實作的 auth／SQL／RLS 設計判定 **BLOCK**。
- 唯一具體新程式缺陷為低風險：月份 regex 的 JavaScript `$` 可能接受結尾換行。協調者已於 `whatsapp-venue-contract.ts` 加 `.length(7)`，補上 LF、CR、CRLF、U+2028、U+2029 五項拒絕測試。修正後契約測試 53 項、含 UI 預覽共 90 項通過，Node 24 `pnpm verify` 通過；本機 DB 整合跳過項目仍不算驗收。
- 尚未完成修正後 reviewer 複核；CONDITIONAL 不可自動改記為 APPROVE。
- GPT 額外要求：列出既有與新增的累積 ACL／角色會員／SECURITY DEFINER 呼叫圖；API runtime 原已能執行 LINE／debug writer，新增 facade 不等於 DB 通路隔離。需明確定義「不新增廣權」與「DB 強制通路隔離」的差別。
- 撤銷與鎖順序須涵蓋 Session、person、identity、channel、application、privacy，不能只鎖 Session；必須有實際 DDL 與隔離測試才能解除設計阻擋。
- 日界線規則以實際打卡時的場地當地日期計算。跨午夜的兩次打卡可能屬不同日期，不能承諾任何跨日重試都不新增紀錄。
- 下一步仍是補齊可審查權限設計並取得跨家族／人工審查，不得據此啟用路由、修改權限或部署。

## 功能分支最終補充審查紀錄

- `wa-final-review-1`／`cliproxyapi/gpt-6-astra` 審查新增 live pages/client、navigation、API/readiness 與 app/index/Bot/公開入口整合，判定 CONDITIONAL，限定預設關閉的功能分支檢查點。
- 審查未指出可具體證實的新增高／中風險可利用問題；條件為最終全 TypeScript 檢查與完整 DB verify 通過，且不開 PR／不合併／不部署。
- 協調者之後取得通過結果：全檔 tsc、帶隔離 PostgreSQL16 的 verify；詳見部署準備。模型本身未重跑測試，其判定不自動改成跨家族核准。
- `wa-final-review-2`／Gemini 未執行成功，回報使用額度限制。
- 已明示後台國家預設通路尚未接入；目前可用的是服務端 gate 與明確 channel 的 URL，不宣稱自動完成台灣／馬新港的場地配置。
- 此次使用者核准的是 commit／push 功能分支，不構成 main 合併或正式啟用／部署核准。

## A. 第一批已存在的程式：初步未發現阻擋項，但未獨立核准

範圍：`apps/public-api/src/venue-channel-links.ts` 及其單元測試。

已核對：

1. 通路僅 `line`／`whatsapp`，場地沿用嚴格 `venueEntryCodeSchema`，locale 為既有三語 enum；strictObject 拒絕 token、personId、redirect 等額外欄位。
2. query 由 URLSearchParams 編碼；網址不含學員憑證或身份，不把 NFC／QR 連結當登入或在場證明。
3. origin 沿用 `trustedVenueOrigin`：只接受無帳密、路徑、query、fragment 的精確 HTTPS origin。**這是格式檢查，不是網域白名單**；未來呼叫端必須使用服務端可信設定，不能接受請求傳入 origin。
4. TW→LINE、MY／SG／HK→WhatsApp，未知／小寫／空白等值返回 null，不從語言、IP 或場地 code 猜測地區。
5. 目前沒有 production caller；未修改共用公開入口 parser。`channel=whatsapp` 尚不能當成正式可用網址發布。

驗證：本次重跑 `venue-channel-links`、`venue-entry`、`venue-fields-ui` 測試，合計 261 項通過。先前 Node 24 verify 通過不等於 DB 整合驗收；當時本機缺少測試 DB，部分整合測試跳過。

## B. 後端整合：BLOCK，以下項目必須先有可審查設計

### B1 — 高：LINE 專用 RLS 不得直接擴為 WhatsApp 權限

證據：`migrations/0051_venue_qr_attendance.sql` 的 `venue_attendance_replay`／`venue_attendance_verified_insert` 以 `resolve_line_learner_identity` 綁定 person；最新 `platform.venue_qr_checkin` 在 `migrations/0058_venue_early_checkin_window.sql` 再驗證 LINE subject 與同意。

必要決策：具體列出 WhatsApp adapter、共用核心的 function owner、execute grants、表欄位權限、RLS 條件及交易上下文來源。API runtime 不得取得任意 person writer、角色會員資格或資料表廣泛讀寫權限。不能僅接受可偽造的 GUC personId。這是對新設計的阻擋，不是宣稱目前 LINE 邊界已被繞過。

### B2 — 高：Session-only 與同交易驗證不能靠通用 resolver 保證

證據：`apps/public-api/src/whatsapp-browser-session.ts` 的 `resolveWhatsAppWorkspaceCredential` 在沒有 Cookie 時允許既有私人打卡 token；`migrations/0027_whatsapp_browser_sessions.sql` 的 `whatsapp_browser_credential_subject` 在 Session 找不到時也會查私人 link。這是現有日課相容行為，不應順便刪除或改壞。

新場地 API 必須明確拒絕 token fallback，並在寫入交易使用 Session＋CSRF 的專用驗證。HTTP 曾驗證成功不代表等待鎖後 Session／同意仍有效。需定義 session、person、身份／主通路撤銷的鎖順序與重驗證時點，並測試撤銷競態。

### B3 — 中：可信 country／通路持久化來源尚未接上

證據：目前 `venue-management.ts` 的場地資料包含 `region_id`，網址輸出 `venueManagementUrls` 沒有 channel；新 helper 接收的是 ISO country string，尚未有可信 DTO mapping 的 integration caller。

後台必須由服務端管理的場地／region 配置選擇通路，明確處理未設定國家與手動 override 的規則及管理權限，不可把 region UUID 或 venue code 前綴直接當 country。純函式能輸出 WhatsApp URL 不等於該通路已啟用；gate 關閉時不能向學員發布失效連結。

### B4 — 中：私人登入連結與回程綁定尚未定稿

必須確認：已驗證 WhatsApp webhook sender、私聊指令語法及錯誤處理、固定 canonical 回程、fragment token 的清除時點、跨瀏覽器 Session 不共享時的引導，以及已登入其他身份的拒絕切換行為。不接受任意 redirect、query 中的 token、前端 personId 或 NFC source 作為授權。

### B5 — 高：缺少實際 migration／API 與隔離 DB 驗證

尚無 WhatsApp 場地寫入、自己的紀錄 API、RLS migration 或權限測試；不能以純網址測試替代後端核准。

開始實作前須完成 B1–B4 設計的獨立審查；程式完成後再審最終 diff 並執行隔離 PostgreSQL 測試：直接 SQL 呼叫／偽造 GUC、跨身份讀取、Cookie／CSRF／Origin、資格／同意撤銷、跨日／DST、同時重送去重、時段／半徑及正式／測試隔離。保留 LINE 回歸、不可新增主動聊天收據。

## 下一步

恢復可用的跨模型審查服務，或由具 PostgreSQL RLS／Session 經驗的人工安全審查者審核上述設計並留下結論。上次 UI-only 發布豁免不適用本次身份與資料庫變更。現階段不繼續變更權限，也不把本機初步檢查當獨立核准。
