# WhatsApp申請頁切換語言並保留輸入（已部署368e980／同schema46）

## 授權及目前狀態

使用者真人回報：join私人申請頁能開啟，但切語言回繁中、未送出內容清空；後明確核准**僅本機修正與隔離驗證**，保留三語／表單／同意狀態及目前語言送出，補測試與紀錄。不commit/push/deploy、不連正式寫入、不發訊息、不改資料庫／通知／授獎開關或身份／Origin／CSRF。兩份既有無關文件保留。使用者在1117測試與Chrome12組本機驗證完成後，已另明確要求commit/push/deploy；本次發布限同schema46 UI修正，待精確SHA CI、fresh46 clone相容／保存演練及停寫final加密DB／roles／runtime實際還原保存後切換，保持現有WA設定／通知與operator FALSE，不執行migration或修改Meta訂閱。已完成本次發布：功能368e980e3b2af5781548e51963f34b546d3ed918、CI39470584651原run1117tests；同46正式切換及243HTTPS驗證通過，詳見下方部署紀錄。

依先前部署及真人回報，正式仍951d1c8／schema46；WhatsApp測試WABA配置已另經核准API-only重啟，WABA／phone mapping修正後使用者確認join有回覆。這只證明先前測試號碼雙向收發，**本檔UI修正已部署，但尚待本人手機WebView驗收**；正式號碼、申請審核、通知範本與真人登入／打卡仍須各自驗收，不能從舊文件的「WA未配置」或本機測試推定目前營運狀態。

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

## 正式部署／實際還原／復原界線

- 功能SHA **368e980e3b2af5781548e51963f34b546d3ed918**，5檔提交，CI **39470584651**原run成功／**1117tests**與兩strict gates。API min42/max46、phase27與原workers不改，**不啟用migration applier／無DDL／grant／回填**，0001–0046全部immutable。實際329個manifest涵蓋檔案中，僅application-page.js及其map兩檔不同，另327檔byte-identical，包括後端／workers。
- fresh PG16隔離restore同46：86表／19people／61checkins原rows、source/privacy/audit/jobs／全部functions與attrs／RLS/ACL／roles保存，新舊API均ready。compiled WA三語×consent true/false共6組VM、9HTTP guest邊界過；只在VM mock收集payload，無真正送出申請；前後86表exact。compiled LINE／TG／grant／Authgear／journal等mock回歸及真systemd14 mock receipts／fresh雙lane heartbeat／graceful stop過。不是正式Meta或手機驗收，也未生成clone個資CSV。
- 預備harness曾沿用42→46的old-reject錯誤期待，被同schema guard拒絕；修為46新舊均ready。RT缺少community fixture及其受限角色讀取權，依既有流程補前置／僅postgres:qigong-api 640後完成，未改產品或放寬身份斷言；原failure logs保留。CI log ANSI表示法也在維護前被解析guard擋住，依實際表示法normalize後驗精確1117，不重跑CI。
- 維護 **2026-10-20 18:13:37–18:14:37 UTC（台北10/21 02:13:37–02:14:37）／60.813monotonic秒**。封鎖本站入口並停寫／drain API與雙worker；final DB／global roles／runtime站外AES-GCM、分離key、decrypt hash核對，**fresh PG16實際還原DB/roles及實際extract runtime**，完整86表／19people／61checkins／既有1draft/0preview保存，包含目前WA事件／連結與最新api.env，而非舊未配置WA snapshot。此後只做readonly契約檢查，正式DB未restore或變更schema。
- 同46 matching API／worker artifacts切換及version override後，私有API startup前後86表與security exact；**18:14:01 resume marker先於workers**，fresh health合格才開入口。兩份既有無關文件排除；env640／6protected檔與3enabled links／原通知flags保存，normal Caddy全檔byte-identical，其他站台不變。
- 正式 **243 Node HTTPS checks**通過，含三語WA新HTML／不導向、不呼叫workspace語言API、guest拒絕、正確Webhook challenge與unsigned401；沒有agent正式申請／checkin／心得／審核／個資CSV／provider test sends（guest OAuth smoke僅暫存login challenge）。API與realtime active／restart0、minute worker success／timer active；receipt health healthy、兩lane各queue0，epoch samples0/p95null，不代表真人延遲或exactly-once。
- 六項WA loaded environment逐一與目前api.env匹配，不輸出值。兩條真guest log probes以source TCP ports／reqId對應incoming URL [REDACTED]／completion200/401，marker及三個WA secrets未在current-invocation API journal出現。post-runtime另站外encrypt/decrypt hash後實際extract，驗env640／current／override／normal ingress，不冒稱post-release DB另還原。clone／probe停止、worker及community fixture憑證檔刪。
- schema46及operator FALSE保留，未改Meta訂閱或啟用新規則／通知。恢復後不得退42binary／DB或回灌舊snapshot覆蓋新寫入；優先46 fix forward。緊急binary回復僅能在另確認後切已驗same46的951 matching artifact並保留目前DB／WA env／audit／queue，不恢復舊設定。
- 部署helper／證據：`/tmp/qigong-wa-language-release-368e980/`、`/tmp/qigong-wa-language-release-{prepare,prepare-resume,realtime,realtime-fixed,realtime-complete,activate,public,post-backup}.log`；私有正式證據在`/root/qigong-deploy-368e980`與deployment-tools/368e980。加密備份`~/.local/share/qigong-platform/backups/deployment-368e980`，key在獨立backup-keys/deployment-368e980.key；不入Git／log／對話。

## 本機證據與真人驗收待辦

- `/tmp/qigong-whatsapp-application-language-red.log`（原8失敗）、`...-green.log`、`...-focused.log`（Email fixture原失敗）、`...-focused-fixed.log`、`...-verify.log`（1117）、`...-build.log`。
- `/tmp/qigong-whatsapp-application-language-browser/results.json`及12PNG；runner `/tmp/qigong-whatsapp-application-language-browser.mjs`，本機HTTP55532／CDP55533驗後停止；只含合成資料，不發送為真人截圖證明。DB採既有獨立測試PG16容器／loopback55526，完成後停止，不接正式DB。
- 提交／推送與同schema46部署已依後續核准完成，精確SHA CI、正式設定保護及final actual restore/preservation通過後才切換；目前WA API環境原樣保留，不以舊「未配置WA」runtime snapshot覆寫。schema仍46、保持fix forward及operator FALSE；不得順便啟用通知、新授獎或修改Meta訂閱。部署後需由本人手機重新開申請連結，驗證三語來回切換與保留輸入，不必提交申請以證明UI修正。
