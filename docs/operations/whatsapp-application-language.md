# WhatsApp申請頁切換語言並保留輸入（發布候選／待部署）

## 授權及目前狀態

使用者真人回報：join私人申請頁能開啟，但切語言回繁中、未送出內容清空；後明確核准**僅本機修正與隔離驗證**，保留三語／表單／同意狀態及目前語言送出，補測試與紀錄。不commit/push/deploy、不連正式寫入、不發訊息、不改資料庫／通知／授獎開關或身份／Origin／CSRF。兩份既有無關文件保留。使用者在1117測試與Chrome12組本機驗證完成後，已另明確要求commit/push/deploy；本次發布限同schema46 UI修正，待精確SHA CI、fresh46 clone相容／保存演練及停寫final加密DB／roles／runtime實際還原保存後切換，保持現有WA設定／通知與operator FALSE，不執行migration或修改Meta訂閱。尚未實際切換。

依先前部署及真人回報，正式仍951d1c8／schema46；WhatsApp測試WABA配置已另經核准API-only重啟，WABA／phone mapping修正後使用者確認join有回覆。這只證明先前測試號碼雙向收發，**本檔的UI修正尚未部署／真人驗收**；正式號碼、申請審核、通知範本與真人登入／打卡仍須各自驗收，不能從舊文件的「WA未配置」或本機測試推定目前營運狀態。

## 根因與修正界線

- 原申請頁共用languageSwitchScript：先確認丟棄未送資料，再POST preferences/language並location.replace重載。現行WhatsApp該API先經checkin-only workspace credential resolver，apply用途proof不能通過，選單回原語言。即使導向成功，整頁重載也沒有保存form。這是來源程式的兩處問題；不以放寬checkin身份／Cookie／CSRF解決。
- 只有WhatsApp申請頁改用原頁presentation切換：預載三語source-owned UI dictionary，以textContent更新標題／說明／label／地區option／同意文案／按鈕／可辨識錯誤狀態；保留原input/select/checkbox節點，**不改value／checked、不翻譯姓名或輸入內容**。LINE／Telegram共用markup增加定位id/span，但原語言流程、LIFF／token／端點及打卡頁不改。
- 切換本身不呼叫fetch、不重載、不提交申請，也不替使用者勾同意。未送出資料只在當前DOM/RAM，**不寫localStorage/sessionStorage、URL、cookie或server**。語言cookie與URL query只含合法locale；私人proof保留原RAM，fragment從網址移除，不重新加回。
- 申請頁的語言只是presentation，切換時不保存服務端身份偏好。真正送出時使用最新applicationLocale，沿既有submit_whatsapp_application保存偏好及申請；未送出時Bot仍可能沿用舊語言。語系不推定地區，也不改地區選項值。
- 申請送出期間拒絕切換；服務失敗保留form且可切語言／重試，沒有自動重送。未勾同意仍由HTML required與既有後端literal true拒絕，沒有因顯示語言建立任何同意或session。
- 沒有新增migration／API／permission，0001–0046與package/lockfiles不變；checkin credential resolver及既有language API對apply proof的拒絕維持，沒有擴大workspace存取權。

## 驗證

- 先補回歸測試，原碼**8項預期失敗／31過**：切換有fetch／navigation、狀態未換語言；原始輸出保留在red log。修正後VM39全部過（新增9項），涵蓋三種初始語言×同意true/false、來回切換、literal HTML樣式姓名不變、所有欄位／checkbox／token保留、無navigation／API自動請求、query無proof／個資、最新locale送出、invalid token保持隱藏、in-flight freeze與失敗後保留並換語言。
- HTTP新增3種locale restricted-role案例：GET三語不改身份偏好；apply proof仍不能使用checkin／language workspace API；Origin、非法locale、false同意、偽造proof拒絕，僅有效申請一次成功／重複409，pending資料與語言正確；無審核／授獎變動，sender只在合成join mock呼叫一次。初次新增test期待Email原大小寫，遇既有SQL lowercase normalization而失敗，**僅精確期望改為toLowerCase**，資料庫／正式Email處理及原安全斷言不改，原failure log保留；focused50過。
- Node24 build、兩strict TS gates、靜態簡中map check1477phrases/1144mappings及完整format/lint/typecheck/test/build過：**1117 tests＝API824／DB285／config2／identity6，無skip**。沒有CI／commit／push／部署或為求綠重跑CI。
- 真本機headless Chrome **12組／12圖**：三種初始語言×同意true/false×390/1280。每組來回切換4次，document identity及form node identities不變、全部欄位／同意值保留、三語title/name label及query正確、fragment空、無自動POST／無preferences request、Storage API呼叫0、無水平overflow／JS exception／丟棄確認dialog。false同意時點submit會被HTML validation擋住；測試者再明確勾選才送出，12份只送到**本機mock HTTP endpoint**且payload locale為目前en，沒有正式申請或provider send。
- browser是本機rendered artifact＋mock HTTP／合成proof，不是正式HTTPS、Meta手機WebView／真人OAuth或實際申請送出驗收。正式重新整理／關閉頁面不提供未送出個資跨載入保存，本輪只保證在頁切語言保留。

## 證據與下一步

- `/tmp/qigong-whatsapp-application-language-red.log`（原8失敗）、`...-green.log`、`...-focused.log`（Email fixture原失敗）、`...-focused-fixed.log`、`...-verify.log`（1117）、`...-build.log`。
- `/tmp/qigong-whatsapp-application-language-browser/results.json`及12PNG；runner `/tmp/qigong-whatsapp-application-language-browser.mjs`，本機HTTP55532／CDP55533驗後停止；只含合成資料，不發送為真人截圖證明。DB採既有獨立測試PG16容器／loopback55526，完成後停止，不接正式DB。
- 提交／推送與同schema46部署已獲後續明確核准，仍須精確SHA CI、正式設定保護、final actual restore與保存通過才切換；部署前應保留本次另配置的WhatsApp API環境，不能以舊「未配置WA」runtime snapshot覆寫。schema仍46、保持fix forward及operator FALSE；不得順便啟用通知、新授獎或修改Meta訂閱。部署後需由本人手機重新開申請連結，驗證三語來回切換與保留輸入，不必提交申請以證明UI修正。
