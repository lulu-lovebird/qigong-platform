# 學員補充說明、同意、預設分享及資格停用

**候選程式已commit／push `75834f6`，CI 38055345937成功，本機隔離升級／還原通過；公開HTTPS與真人渠道測試尚待配置。未核准正式部署，正式仍為852cd05／schema22。** 詳見[隔離試行](isolated-channel-pilot.md)。 隱私功能由migration0023提供；已整合到LINE／WhatsApp及Telegram候選API／worker exact0025。

## 已確認的營運安排

- 品牌：白雁氣功／氣功打卡小幫手；以陪伴練功、成就及心得交流為目的。
- 承接官網政策：https://app.getterms.io/view/4ZncR/privacy/en-us；2026-10-09取得並核對的頁面標示最後更新為2025-05-16。不是把官網的分析、廣告或全部供應商用途直接複製到小幫手。
- 隱私窗口：邱伶婷／eqibaiyin@gmail.com。
- 同意後新增的打卡日期、功法、心得與感受，預設給小幫手內有效學員及授權工作人員閱讀。使用遮罩識別／分享暱稱，不分享Email、電話、平台身份ID，也不向一般網路公開。
- Regional Admin 可以停用自己管理範圍的學員；本人不能讀別人，其歷史分享對其他學員隱藏，但管理端依權限與必要目的仍可查閱。
- 資格停用不是正式帳號／資料刪除，不取消原政策及適用法律的資料權利或期限，也不授權無期限保存。

## 文件與生效

- docs/legal/checkin-helper-supplement.zh-TW.md、checkin-helper-supplement.en.md 為雙語補充說明，涵蓋小幫手使用規則與資料分享。
- 版本 baiyin-checkin-supplement-v1，內容雜湊由版本及兩份完整文件的固定JSON結構計算SHA-256。
- Migration0023僅登錄 draft，**部署不等於發布政策**。draft時不要求新同意、不回填同意、不自動分享舊資料，沿用既有服務行為。
- /privacy 公開提供全文；正式生效狀態由頁面顯示。政策檔案與DB版本／雜湊不符時拒絕提供可接受的版本。
- 僅global Super可在 /admin/privacy-policy 審閱完整文件、填理由並確認發布；POST /admin/api/privacy-policy/publish 必須既有session＋CSRF＋精確版本／雜湊。
- 文件變更須更新版本／migration及matching artifact，不編輯已部署歷史migration或把舊同意當作新用途同意。

## 同意與防繞過

- Telegram /privacy、/terms、隱私；LINE／WhatsApp privacy／隱私／terms／條款，可閱讀及調整同意。
- 一般加入／打卡等指令，在必要時先提供15分鐘的私人政策連結。來源先由原有webhook簽章／帳號驗證，capability另行綁定平台及subject；不接受瀏覽器提交user ID作為身份。
- /learner/privacy/accept 是嚴格JSON／Origin驗證的POST；有明確未預勾的一般同意。記錄平台subject雜湊、版本、文件雜湊、時間及語言，不建立資格或依姓名／Email／電話合併人。
- 健康相關心得／感受使用獨立、選填且未預勾的 reflection consent；未同意仍可打卡，但不能新增心得／感受。頁面說明／停用欄位與DB寫入檢查同時實施，不只靠前端。
- 取消reflection consent會停止學員／外部對既有心得與感受快照的新讀取；必要原始紀錄仍依管理權限與保存規則處理。後續修正不默默重新公開撤回紀錄。
- 簽章驗證後的Chatbot入口、既有Web API及資料庫facade都需有效版本同意；舊capability也不能繞過。pre-consent實作函數已封鎖runtime直呼，包括worker通用報名入口。
- 語言選擇、政策閱讀、隱私聯絡及WhatsApp STOP保留；WhatsApp通知同意與服務同意互不代替。未讀／不同意不會自動接受，系統不宣稱證明逐字閱讀。

## 預設分享與歷史邊界

- 新checkin在建立時記錄consent origin；只有此類紀錄自動建立分享快照。先前私密紀錄不回填origin，更正也不自動公開。
- 新共享內容更正同步更新共享快照；已撤回不自動重新公開。
- 外部分享仍另外明確同意。新快照external_enabled預設false；內容變更使既有外部同意失效，須重新預覽／確認，不默默對外更新。
- 學員／合作API不讀停用作者的內容。/admin/shared-journal及GET /admin/api/shared-journal供授權工作人員讀共享歷史，包括停用作者。
- journal.read_shared配置給Super／Master／Coach／global_viewer／regional_admin／regional_viewer，以及既有country_admin；這是共享資料閱讀，不提升舊私密原稿的閱讀權限。
- 舊分享若沒有本批staff分享標記，工作人員仍須具該作者的既有私密閱讀scope才可查閱。/admin/journal加入停用學員，但仍逐筆檢查learner.read與checkin.read_private_note及地區／班級範圍。
- 不加入心得／感受到Chatbot打卡摘要，不啟用LLM或新增成就通知。

## 資格停用

- /admin/learners及GET /admin/api/learners：可管理profile的角色才能使用，列出其範圍內active／suspended學員，提供姓名篩選與分頁。
- POST /admin/api/learners/:id/suspend：session、CSRF、版本與1–500字理由；授權鎖後及person鎖後再核對scope及實際時鐘到期，避免排隊後使用過期授權。
- 同一交易先關閉互動管道，再suspend person、使Telegram／WhatsApp既有連結到期、撤銷對應政策同意，記錄理由／版本／audit。先關管道以符合既有安全trigger。
- 保留原始checkins、心得、地區歸屬及身份；不移除管理員grants、Authgear帳號，不影響其他獨立person的跨管道申請。錯誤或範圍外／版本衝突不部分停用。
- 沒有本批自動復課／重新啟用或永久刪除功能；這些需另行核准的流程。隱私請求仍可透過既有聯絡窗口處理。

## 驗證與發布邊界

- 本機isolated PostgreSQL16完整pnpm verify **388項、無skip**，格式／lint／source typecheck／build通過；額外全測試tsc仍有10項既有錯誤，沒有新增。
- 涵蓋版號／hash／Origin／錯平台／過期連結、signed Telegram／LINE／WhatsApp入口、不同意及通知分離、新紀錄／舊私密、敏感同意撤回／外部重新同意、跨區拒絕／版本／排隊授權到期及退休分享隔離。
- 22→23／重跑／舊契約拒絕／原始people、notes及withdrawn publication保留，零自動acceptance／origin及draft狀態驗證通過；不是正式快照演練。
- Chrome390px／1280px八種雙語合成配置：policy、learner eligibility、shared history、policy publication；無橫向溢出／JS exception，未預勾、fragment清除、409輸入保留通過。不是真人Telegram／Authgear／LINE／WhatsApp驗收。
- 最終回歸前一次WhatsApp既有更正案例回409；原樣單獨重跑通過，原因未定位，保留為間歇性測試觀察，不把重跑當作已修復原因。
- 候選API／worker只支援25，artifact必須包含0001–0025；正式22 binary不能直接用23／24／25 DB。已核准提交／推送／CI及隔離試行，但正式發布仍須另核准、matching artifact／CI、正式22→25快照演練、最終站外備份實際還原；回復需matching22 DB＋852cd05 API／worker，開流量後另核准並對帳。
- 不修改0001–0022、package.json／lockfile、保護設定或provider開關。正式LINE／WhatsApp保持未啟用；候選完整工作區已實作，專用測試渠道真人驗收、官網串接、保存清理jobs／完整刪除自動化仍待後續。
