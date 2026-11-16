# WhatsApp 團練場打卡：實作分批與安全審查契約

狀態：功能分支開發交付，未上線；2026-11-16 建立。本文件保留早期設計／分批記錄，不是正式啟用核准。後續已完成 schema65、本人的紀錄 SQL/API、Bot 私人回程、可操作打卡／紀錄頁與預設關閉的啟用 gate；最新範圍與仍未完成的後台國家映射、發布關卡以 [部署準備](whatsapp-venue-release-readiness.md) 為準。

## 已確認的產品契約

- 台灣預設 LINE；馬來西亞、新加坡、香港預設 WhatsApp。以可信場地地區設定決定，不以 IP、手機語言或場地代碼前綴猜測。其他地區須明確選擇，不靜默回退。
- 共用公開入口 `/venue-checkin?venue=<code>&source=nfc&channel=line|whatsapp&lang=zh_TW|zh_CN|en`。QR 的 source 為 qr，一般連結為 link。
- 指定 channel 後不再顯示通路選擇器；場地關閉、停用、未知時維持唯讀並顯示原因，不觸發登入、定位或寫入。
- WhatsApp 私聊指令「團練 <場地代碼>」回傳私人登入連結。首次／過期登入後返回原場地；已有有效瀏覽器 Session 則直接確認資格。
- 打卡在 HTTPS 網頁執行，非聊天位置訊息；聊天深連結只是預填指令，仍需學員自行送出。
- 沿用已確認 LINE UI：場地名稱／右側時區、緊湊時段、開放時間標籤、綠色開放／黃色非時段、大型主按鈕、後端確認成功才顯示印章。含自己的團練紀錄。
- 不主動發送打卡聊天收據、不新增訊息範本、不自動合併身份、不自動切換通路、不自動補登每日練功。WhatsApp 回覆仍適用平台當時的訊息政策。

## 第一批：純連結契約（不啟用功能）

- `apps/public-api/src/venue-channel-links.ts`：嚴格驗證通路／場地／語言，純函式產生 NFC、QR、一般連結；地區預設純函式。
- `apps/public-api/tests/venue-channel-links.test.ts`：URL 形狀、四地區、語言獨立性、未知地區、惡意／多餘欄位及 origin 邊界。
- 此批不修改現有入口 parser、後台輸出、Bot、Session、migration 或 RLS。不能把純函式能產生網址當作通路已可使用。
- publicOrigin 只能來自服務端配置，不能傳入 Host、forwarded header 或請求參數。呼叫端必須先確認對應功能已啟用，再向管理員／學員發布網址。

## 第一批驗證與目前阻擋

- 37 項新網址契約測試、場地入口／後台 UI 回歸合計 261 項通過。
- Node 24 `pnpm verify` 通過；隔離資料庫未配置而跳過的整合測試不列為通過。
- `wa-venue-review` 獨立跨模型安全設計審查嘗試失敗：服務回報憑證失效，未產生審查結論。
- 因未完成必要審查，停止於純函式／測試／設計文件；不修改 Session、RLS、migration 或正式功能 gate。
- 上次 LINE UI-only 發布的審查豁免不適用此次身分／資料庫變更。

## UI 預覽批：不涉及身分與權限的可並行工作

- `apps/public-api/src/whatsapp-venue-preview-page.ts`：純 HTML／CSS 示範 renderer，未註冊路由、不含 script、不載入 SDK，不登入、不定位、不寫出席。所有操作按鈕停用，頁首明示預覽。
- 僅匯出 LINE 原有 `venueCheckinStyles` 供重用，不修改既有 LINE 控制器／權限／狀態流程。
- 七種操作狀態（登入、就緒、定位中、送出中、成功、GPS 失敗、結果未確認）加上非打卡時段唯讀畫面。三語 renderer 已有測試。
- 示範成功印章要求 formal receipt 形狀、場地 code 及場地當地日期一致，拒絕 test receipt／壞時區／壞日期；這只是 UI fixture 驗證，不是學員驗證或 DB 核准。
- `apps/public-api/tests/whatsapp-venue-preview-page.test.ts`：37 項新測試；與 LINE UI／控制器回歸合計 280 項通過。Node 24 `pnpm verify` 通過，DB 跳過項目仍不得算驗收。
- 本機 Orca 預覽：`http://127.0.0.1:4178/wa-venue-ready.html`。示範 HTML 由 `/tmp` 產生並提供，不加入正式 server routes。此 localhost 連結不是正式功能網址。
- 此批不解除下一節的安全審查關卡；登入、API、RLS、migration 與正式場地紀錄仍未實作／啟用。

## 第二批之前的必要安全審查（目前未通過／未豁免）

現有 `platform.venue_qr_checkin`（最新定義在 migration 0058）與 0051 的出席 RLS 綁定 LINE subject。不得把 WhatsApp Session 假裝成 LINE subject、以手機號碼查找 LINE 人員、讓前端傳 personId，或僅修改 RLS 為公開允許。

審查須逐項確定以下邊界及實際 SQL／交易設計，再變更授權：

1. **身分與 CSRF**：WhatsApp 寫入只接受現有 HttpOnly Session Cookie，CSRF Cookie／header 配對及固定可信 Origin。不得因缺少 Cookie 就回退至私人連結 token；不可把私人 token 放在 query、NFC、QR、日誌、localStorage。多重／畸形 Cookie、外站 Origin、session 混用 token 必須拒絕。
2. **資料庫再驗證**：不能僅依 HTTP 層剛才驗證成功就信任 personId；在實際寫入交易重新解析 Session、檢查有效主通路、學員啟用／核准／同意。鎖後重新檢查資格與 session 到期，處理撤銷競態。
3. **最小權限**：新增窄範圍 NOLOGIN／NOBYPASSRLS writer 或經審查的等效方案；API runtime 不取得學員、出席表的任意 SELECT／INSERT，不能執行任意 person 的核心函式。共用核心的 execute 不授予 PUBLIC／API runtime。SECURITY DEFINER 固定 search_path，表明確 schema 限定，移除 default ACL 殘留。
4. **RLS 與共用核心**：不得以可由 caller 設定的 GUC personId 作為唯一授權依據。保留 LINE adapter／debug 專用權限；WhatsApp 不可借 LINE 或 debug writer。共用核心參數、owner、可執行角色及不可偽造的交易上下文需明列。
5. **寫入與重試**：以 person／場地／場地當地日期計一次正式出席；以既有 unique constraint 處理併發。每次含 replay 均驗證當前時段與距離。相同紀錄回傳原保存時間與 replayed，不重複寫入或發收據。
6. **時間與定位**：共用現行 `venue_checkin_window`，以 DB clock、場地 timezone、開始前 30 分鐘及結束排他界線判定。驗證有限經緯度、半徑；不持久保存原始 GPS，不把 source=nfc 當在場證明。
7. **登入連結**：由已驗證 webhook sender 私聊取得；場地僅為導覽資訊，不能授予出席權限。fragment 私人 token 登入前清除可見網址，Session 建立仍使用既有機制；若已有不同身份不得靜默切換。固定 canonical 回程，只接受 venue/source/lang，不接受 redirect、Host 或任意 callback URL。
8. **紀錄讀取**：同交易重新驗證 Session 和資格，只讀自己的正式團練紀錄；不可接受前端 personId；分頁／日期／場地篩選均有界，測試紀錄不冒充正式出席。
9. **啟用與回退**：WhatsApp route／Bot／後台通路輸出受同一服務端 gate 控制。未開時不可發無效 NFC／QR；LINE 原有網址、未帶 channel 入口、歷史私鏈維持兼容。migration 必須 additive，不修改 0001–0064 已發布檔；回退先關功能，不倒退或刪除已寫出席。
10. **後台地區來源**：先確認可信場地讀取 DTO 能取得的地區識別及 country mapping；不直接把本批 ISO country 預設函式接到未核對的資料庫 region code。各場地通路設定持久化與權限也須在 migration 審查內。

## 後續分批（每批至多五個檔案）

- A：安全審查及 DB 契約定稿；通過後新增 migration 與隔離 PostgreSQL 測試，包含 SQL 直接繞過測試。
- B：WhatsApp Session-only 場地 API／資格與紀錄，接入功能 gate；保留 LINE 的 SQL／HTTP 相容測試。
- C：WhatsApp 場地頁及自己的紀錄頁，接入既有瀏覽器登入／登出；用純假資料在 Orca review 各種狀態。
- D：Bot 私聊指令與專用連結回程；登入和 webhook 簽章測試，不更動每日打卡指令語義。
- E：共用公開入口、後台場地通路設定與 NFC／QR 輸出；只在功能可用時發布。
- F：Node 24 verify、隔離 DB、跨模型最終安全審查、使用者確認及 CI。發布另行授權，不在開發時碰正式學員資料。

每批實際檔案範圍在動手前列出；超過五個檔案須解釋並取得核准，不能藉拆批隱藏依賴。未通過 DB／API／Bot／UI 整合前，任何單批完成都不能宣稱 WhatsApp 團練場打卡已完成。

## 必要驗收

- 台灣 LINE／馬新港 WhatsApp 正確直達；未知地區需明確設定；language 不改變通路。
- 未登入、不同帳號已登入、過期／撤銷／停用／未同意、CSRF、Origin、直接 DB 執行／偽造 GUC、越權紀錄全數 fail closed。
- 開放前一秒／恰好開放／結束前／恰好結束、跨日提早開放、DST、不同手機時區及假手機時間。
- 未點按鈕不定位；拒絕定位／逾時／超半徑／NaN／Infinity／服務故障均不顯示成功；寫入回應遺失保持結果未確認。
- 併發與重試只保存一筆；正式／測試分隔；非開放 replay 不繞過規則；只讀自己的紀錄。
- LINE 場地／日課及 WhatsApp 日課／既有 Session 行為無回歸；不產生主動聊天收據。
- 測試只用隔離 DB 與示範身份，不修改正式 learner／出席／徽章。資料庫整合測試被跳過時不得標為完整驗收通過。
