# WhatsApp打卡完成紀錄與關閉提示（發布候選／待部署）

## 核准範圍

使用者於2026-10-21回報本人WhatsApp已可打卡，因不回傳聊天紀錄，希望Web UI顯示本次紀錄、「已完成打卡，明天繼續加油！」再關閉。此回報只代表該次本人打卡，非完整手機／角色／語言matrix驗收。使用者另核准本機完成畫面與隔離測試，**不commit/push/deploy、不連正式寫入／發訊息、不改身份／Origin／CSRF、資料庫、LINE/TG、通知、授獎或Meta設定**。兩份既有無關文件保留。使用者在1156測試與18組Chrome驗證完成後，另明確核准commit/push/deploy；本次限同schema46 UI發布，須精確SHA CI、fresh46 clone相容／保存、停寫final加密DB／roles／runtime actual restore/preservation過才切換，不執行migration，保留目前WA環境／通知／授獎／Meta設定。尚未切換，正式上一功能仍368e980／schema46。

## 完成畫面契約

- 僅WA checkin頁在原save成功分支接入新`whatsapp-checkin-completion.ts`；其他渠道／其他WA頁不插入。原認證Cookie／CSRF、actual session、未儲存草稿、requestId及版本衝突流程不改，沒有新API／migration／server sender。
- API回應前不顯示完成、不啟動關閉計時。成功回應仍驗UUID checkinId、安全整數且前進的version、與本次日期／既有紀錄相符的regular/makeup/corrected，以及receiptQueued=false；不完整／不一致回應視為尚未確認，保留原內容及requestId，可安全重試同payload，不能假稱未寫入或改新id重送。
- 送出前複製本次日期／練習時區、當時選取功法的顯示名稱及原version／操作類型；確認後顯示三語完成標題、鼓勵、日期／時區／功法／打卡或補登或更正，不使用後續選取或其他日期的值冒充本次紀錄。用textContent建立記錄，不注入HTML、不顯示姓名／電話／Email／checkinId／心得／感受。功法名稱照既有UI字串，不另翻譯人工內容。
- 完成卡顯示時隱藏編輯器，阻擋再次儲存，避免已完成畫面重複POST。原profile刷新只更新已儲存日期，其他日期草稿不清空；刷新成功後才安排3秒計時（畫面至少顯示3秒）。若刷新失敗，完成紀錄仍保留並明示已儲存／刷新失敗，**暫停自動關閉、不重送save**；返回編輯仍沿既有needsRefresh保護。
- 關閉前與計時觸發時重查busy／writing、所有日期及時區dirty、離頁與登入狀態。其他草稿未儲存不自動丟棄，也不彈出自動確認代替本人同意；卡片提示返回編輯。返回編輯、pagehide或新關閉動作取消舊timer／generation，避免舊回呼關閉新畫面。
- WhatsApp WebView／Safari／Chrome沒有通用保證可關閉的WA SDK。沒有其他草稿時只嘗試window.close；未觀察到closed或拋錯，保留正確完成卡並顯示「請使用瀏覽器的關閉或返回按鈕回到 WhatsApp」，不顯示已成功關閉。另有「完成／關閉」及「返回編輯」按鈕，手機最小44px／可換行。
- 不自動登出、不撤銷30天cookie、不發聊天摘要、不延長Meta service window；頁面重新開啟不重播完成卡。私人資料不加入網址／瀏覽器storage，沒有自動WA深連結／代填或發送訊息。登入失效時新完成卡取消／隱藏，不憑卡片認定仍有資格。

## 驗證及失敗證據

- 新獨立VM23：三語、文字安全與快照不隨後續日期／時區／名稱改變、七種無效／未知ack拒絕、makeup/corrected、3000ms等待、blocked／throw／closed三種關閉分支、busy/writing/其他dirty在timer觸發重驗、返回編輯取消stale timer、刷新失敗仍保留確認紀錄但不關閉、auth expiry不關閉。
- 共用頁整合由68增至84（新增16）：三語真rendered script、僅收到成功回應才顯示、pending無完成、失敗401/403/409/503／network／malformed保留內容與同payload requestId重試、補登／更正、private note/feeling不進完成紀錄、完成後第二次submit不POST、不logout/webhook、刷新失敗不重送、另一日期草稿仍完整且阻擋關閉、LINE/TG不含新completion/window.close。現有fixture修正WA receiptQueued=false及依request分類action，對應既有真HTTP契約，不改正式資料。
- 首輪新增整合6個失敗源於VM stub未解析HTML的hidden初值；明示wa-completion初始hidden=true以符合實際markup，原失敗輸出保留，不把assert放寬。完整verify再抓新test將Request/URL直接String的5處lint，改typed workspaceRequestPath辨別string/URL/Request，未用any或關閉規則；原lint log保留。修正後完整verify **1156tests（API863／DB285／config2／identity6，無skip）**、Node24 build／兩strict TS gates／format/lint/typecheck與靜態簡中1494phrases/1160mappings過。
- 獨立PG16 native WA cookie HTTP9過，既有保存無sender／receipt斷言保留，新增真response UUID／正整數version／regular及receiptQueued=false的完成畫面前置契約檢查。實際資格／CSRF／expiry／logout／撤銷與service-window隔離仍過，不建立正式記錄。
- 從Git HEAD另編譯原baseline，比對三語LINE/TG四工作頁及其他WA四頁，**36份rendered HTML逐byte相同**；只有WA checkin加入新流程，不能把共用import的變動說成LINE/TG行為變更。
- 真本機headless Chrome **18組／18圖**：三語×390/1280×regular/makeup/corrected。真DOM與真150ms模擬pending期間無完成，成功後記錄日期／功法／類型與locale正確，私密心得不進卡片，編輯器隱藏、3000ms前不關閉，真等待超過3秒後blocked-close提示且紀錄仍可讀；無水平overflow、44px按鈕、JS exception0／Storage calls0／logout或webhook請求0。登入、Cookie讀取與HTTP傳輸均合成mock，window.close刻意mock為blocked；18次保存只到記憶體mock，**不是實際WA WebView、真關閉或正式打卡驗收**。

## 證據與待辦

- `/tmp/qigong-wa-completion-{integration-first,integration,integration-fixed,http,verify,verify-fixed,build}.log`；verify是原lint失敗，verify-fixed是1156完整成功。`/tmp/qigong-wa-completion-scope.json`為36份byte比較，baseline由Git HEAD在/tmp獨立編譯。
- Chrome runner `/tmp/qigong-wa-completion-browser.mjs`、`/tmp/qigong-wa-completion-browser/results.json`與18PNG；HTTP55532/CDP55533驗後停止。獨立測試PG16 loopback55526驗後停止。沒有使用正式憑證、私人連結或真手機資料作fixture；圖不冒充已交付Telegram或真人結果。
- commit/push與同schema46發布已獲後續明確核准；仍須精確SHA CI、final actual restore/preservation通過才切換，發布需保留目前WA env、既有通知／operator FALSE、不改Meta訂閱，不恢復舊未配置WA snapshot。正式本人手機尚需驗成功畫面／補登更正／手動關閉及其他草稿保護；不能從本機mock推定WhatsApp會允許window.close。
