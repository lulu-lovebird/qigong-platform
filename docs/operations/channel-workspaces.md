# LINE／WhatsApp 學員工作區與私人打卡摘要

**工作區功能migration24已整合候選schema25；已核准commit／push及隔離測試部署，尚未完成。正式仍為852cd05／schema22，兩個正式渠道保持未啟用。** 此批先完成LINE功能測試，再接WhatsApp；依使用者核准只做完整工作區、選單與私人打卡摘要，不做提醒、LLM、舊帳號／紀錄／勳章搬移或自動啟用。

## 入口與功能

兩個渠道都有checkin、leaderboard、method-analysis、achievements及journal頁；月曆在achievements的每月歷史頁籤，包含真實月格及可定位的當日紀錄。首頁具功法分類全選、今天／昨天獨立草稿、版本／UUID儲存、時區確認／受控變更、實際修改離頁保護、錯誤輸入保留及儲存成功但刷新失敗後避免重送。

- LINE：/line/維持既有LIFF endpoint；/line/checkin、/line/leaderboard、/line/method-analysis、/line/achievements、/line/journal。介面繁中，每次JSON request需LINE ID token，由原驗證器確認audience／expiry／subject；不接受user ID、person ID或摘要recipient作為瀏覽器授權。
- WhatsApp：對應/whatsapp/五頁，繁中／英文，沿用簽章後身份綁定15分鐘capability與Origin驗證，不把電話或身份ID放進URL。
- /{provider}/workspace/profile、report、save；/{provider}/preferences/timezone；/{provider}/journal/feed、own、publish。所有資料庫facade依有效本人身份解出person，無任意UUID讀取／寫入helper暴露。
- 同地區同渠道排行榜只列有效核准學員，使用遮罩識別；跨區共享心得仍依23的分享規則。成就用共用49個v1定義及重算引擎；不猜測季節活動日曆。
- LINE私聊選單／排行榜／功法分析／成就／紀錄／心得等指令回覆工作區連結。WhatsApp新增menu／stats／leaderboard／methods／achievements／history／journal及對應中文入口，提供互動list與文字fallback；只處理簽章後的已知workspace按鈕ID，不以按鈕ID作身份。

## 資料與相容性

0024新增forced-RLS channel request ledger、receipt outbox及WhatsApp service window。共用既有person-keyed workspace preference及checkin revision資料，不新增隱含跨平台連結，保留policy A。出現相同姓名／Email／電話不合併。

日期／功法／心得／感受／version／request UUID／receipt同交易寫入；相同身份與UUID重試回相同結果，異payload或過期version回409。等鎖後再確認本人、primary channel、approval、policy及連結期限；跨午夜或更正／補登期限失效不靜默改日期。

共享快照沿用23：政策仍draft直到Super審閱後發布；舊私密不回填，新origin預設分享，reflection consent、撤回、外部獨立同意及內容變更後撤下外部資格不變。停用身份／資格後讀取與寫入拒絕，摘要亦取消／送前重驗。

## 私人聊天摘要

摘要只含日期、所選功法、連續及累計天數。不含心得、感受或姓名／聯絡資料。使用既有allow-list builder，即使outbox payload混入其他欄位也不附加；收件人從已核准資料庫identity決定，不採用瀏覽器recipient。

- LINE使用Messaging API push；固定receipt UUID作X-Line-Retry-Key，409附accepted-request-id視作先前已接受。HTTP成功是API接受，不等於手機送達，也不宣稱exactly-once。
- WhatsApp只有簽章後、年齡符合customer-service-window的入站訊息可以更新服務窗口；不是按瀏覽器操作時間延長24小時。enqueue、claim及pre-send都檢查窗口，過期取消自由文字，不套用未核准模板；打卡仍成功且receiptQueued=false，頁面不宣稱已排入聊天。
- LINE／WhatsApp採10分鐘lease、最多8次嘗試、退避及過期lease恢復；撤銷／停用／服務窗口失效不送。傳送與撤銷的在飛行競爭不能保證收回。
- 錯誤訊息固定sanitize，不把provider URL、access token、電話、心得或感受寫入ordinary logs。
- Worker維持總共最多6次transport嘗試：onboarding3＋practice3按已設定渠道分配，三渠道均設定時各1。LINE10秒、WhatsApp5秒timeout，保留原60秒transport預算；badges另lane。不配置sender就不claim該渠道。

## 驗證與限制

- 工作區候選24完整pnpm verify **409項通過、無skip**；整合候選25最近連續兩次完整425項通過，format／lint／source typecheck／build及diff check通過。間歇性授權／WA錯誤根因未定位，重跑通過不等於已修復，僅核准隔離試行。額外全測試tsc仍10項既有錯誤、無新增。
- restricted runtime測試LINE ID token、Origin、禁止browser身份／recipient、5種report、私密原文不進摘要、retry UUID及version、timezone confirmation、rank跨區拒絕、pub ownership／withdrawal、lease撤銷及WhatsApp窗口過期；互動訊息測試沒有真實provider API請求。
- 23→24／重跑／舊契約拒絕、所有既有應用表指紋保留與政策draft驗證通過，未在正式快照演練。
- Chrome12種合成配置：兩渠道五頁390px及1280px桌機（LINE繁中／WhatsApp英文），零溢出／JS exception；LINE使用stub LIFF身份，非真實SDK登入；fragment、獨立草稿、31天月格驗證通過。
- Mini App修正回歸時WA資料庫workspace案例單次invalid link，原樣單獨重跑通過，原因未定位；保留為間歇性觀察，沒有更改正式程式或放寬驗證。
- 專用官方帳號／LIFF真實跳轉、WhatsApp WABA／電話／Meta互動清單與API實際送達仍須驗收，不能將本機mock當作真人驗收。
- LINE耐久webhook去重、完整非同步bot reply outbox、WhatsAppdelivery/read callback追蹤、個人提醒與清理保留jobs不在本批，仍待後續。

## 發布

目前正式22；本機目前須matching25 API／worker及完整0001–0025 artifact，不能把25程式指向22／23／24。沒有更改0001–0022、package／依賴／lockfile、保護env或provider開關；23及24都尚未部署。

已核准提交、推送、CI及隔離測試部署，先LINE再WhatsApp專用測試帳號驗收；未核准正式部署、新正式渠道啟用、舊Bot設定變更或正式政策發布。隔離環境不得使用正式provider憑證／學員資料，政策發布只限隔離資料庫且另標明測試。未來正式發布仍須正式22→25快照、policy draft／原始資料／隊列保留、舊binary拒絕、matching restricted API／worker smoke，最終站外備份實際還原。回復需matching22 DB＋852cd05 API／worker；開流量後另核准並對帳。政策發布另外由Super審閱，部署不自動生效。
