# LINE 邀請加好友後接續與待審本人確認（已部署schema33）

使用者另核准commit/push/deploy，正式4aa38f1709222e2f38b72f51c97bb8923f7f8d64／schema33，2026-10-15 03:47:26–03:47:44 UTC完成，CI38677398987／651tests成功；現有申請／通知／邀請額度／env保留，沒有批量核准。此變更包含migration及matching API-worker，不是same-schema UI修補。見[部署／實際還原證據](line-invite-continuation-deployment.md)。

## 問題與目標流程

從有效邀請LIFF網址加入：LINE登入 → 加氣功打卡小幫手好友 → 必要隱私同意（若適用）→ 填寫本人姓名／Email／國際電話、確認邀請地區 → 同交易直接核准 → `/checkin`。基本資料表單保留，不以姓名／Email／電話認人或合併身份。

原本`follow`與「加入」共用一般申請回覆。LINE可能在LIFF OAuth期間、邀請頁尚未驗證subject之前就發出follow，因而傳出`/apply`人工審核入口。URL又會在LIFF完成後清除，重整／關閉重開沒有server-side接續。這些是可重現的分流缺口；正式先前的待審紀錄沒有invite redemption，但沒有真人操作trace，不聲稱知道學員實際點擊順序。

## 新行為

- `0033_line_invite_continuation.sql`只新增接續表與函式override，既有0001–0032不動；不批量核准／回填context、同意或事件。
- ID token驗證後、有有效邀請的status先記錄接續，再提供加好友提示。forced-RLS `platform.line_invite_continuations`只有subject、invite FK、random nonce、SHA256 resume hash與期限；無原始invite／resume token、姓名／Email／電話。
- resume=`HMAC(channelSecret, domain+subject+nonce)`，不把nonce當bearer。15分鐘固定期限（另不超過invite到期），重複status不延長；新邀請可取代同subject接續，舊連結可能失效，回原邀請重開即可。變更簽署key後以原邀請重開可更新hash，舊key產生的resume失效。
- API與signed webhook都以同一verified LINE subject查接續。轉傳resume不能讓不同subject兌換。原始共享邀請仍是bearer，可轉傳給其他人；兩者不是同一權限語意。
- 有context的follow／「加入」／「打卡」回`/invite#resume`，先於一般privacy reply分流；**只是導回邀請，沒有代同意或核准**。頁面照常檢查好友與必要同意。
- OAuth先follow、尚無context時，不自動傳一般申請URL；提示返回原邀請頁／重新點原邀請。無邀請者仍可明確輸入「加入」走人工審核，並非所有follow自動核准。
- URL清理後重整或固定`/invite`頁，先驗證本次ID token再接續自己仍有效的context。明確提供錯誤／過期token時不偷偷換成其他邀請。沒有localStorage/sessionStorage、cookie或raw-token持久化。
- 好友頁回到前景時重新確認；resume逾時提示重開原邀請，失敗保留當頁已填草稿，不顯示假成功。
- 舊`/apply`表單若已有有效context，API與subject-lock內的SQL都阻擋降級成pending，回409／導回邀請頁重新確認；此舊表單安全回復情況可能需再填資料，不將它冒充已核准。

## 已待審者與安全界線

- `line_invite_state`對**同一subject、未連到既有person identity、status=pending且有效邀請**提供form／必要同意與`pendingApplication`提示。沒有邀請不會直接核准；僅開頁、加好友、status或保存context均不核准。
- 本人重新填寫並確認資料／邀請地區後，redeem鎖grant／subject／invite／原申請row，再查有效性、creator權限、region、quota、privacy與linked identity；等待後也重查resume期限。保留原application UUID，確認資料及邀請region、新person／identity／channel／核准／一次quota／redeem／audit／正常核准結果outbox在同交易完成。
- 已核准有效身份仍獨立於邀請有效性直接進打卡，不重寫資料、不耗額度。rejected／suspended／revoked identity／不符合資格或已連既有identity者不會被邀請恢復。沒有依個資合併、授予admin角色或改原授權模型。
- 新邀請核准不產生待審review event。轉核准既有pending時，不新增待審event，取消該申請pending/sending reviewer deliveries並清lease；保留歷史sent／audit。**已送出或provider已接受的in-flight無法保證召回**，原worker pre-send權限／pending再查保留。
- 逾時context在讀取／保存時按expiry index、最多100筆`SKIP LOCKED`清理；15分鐘是授權期限，不是保證15分鐘內物理刪除。成功核准同交易刪掉本人context。
- 新函式PUBLIC撤權，API無直接表讀寫／private target resolver，worker不能讀subject context。Origin／strict body／CSRF與既有RLS、服務開關、draft政策不變。

## 驗證

- `pnpm verify`成功：651tests（API481、DB162、config2、identity6），format/lint/source tsc/build通過。
- DB及HTTP：invite→friend→signed follow→resume→資料→approved→history API200；early-follow不產生普通申請連結／line link；正常無邀請「加入」保留；舊form降級阻擋；同subject pending確認、原UUID／region／quota一次性、unsent提醒取消；跨subject、過期／撤銷／無權issuer、既有資格／privacy／DB權限保護。
- DB等待existing pending row期間讓resume過期，釋鎖後拒絕、沒有person／quota變動；重複狀態不續期、簽署key hash更新／舊resume失效。
- 32→33全表fingerprint（排除core metadata）不變，context空、forced RLS，migration重跑零新增；舊32 API/worker gate拒絕33、新33 contract通過。31→32歷史測試固定到32，沒有改寫舊migration。
- 整份rendered HTML/script VM：friend返回／resume、清fragment後reload、本人pending確認才submit、失敗保留草稿；一般表單409導回邀請、不顯示送出成功。
- actual Chrome390／1280合成布局：清URL後reload／visibility返回、真DOM填表requestSubmit、resume payload、checkin redirect、零橫向overflow／runtime exception。Provider navigation攔截成synthetic頁，無外部發送。這不是正式LINE手機／OAuth／好友交付驗收。
- `/tmp/qigong-line-invite-continuation-{verify,verify-2,all-types}.log`、preview/cdp scripts與390/1280 screenshots保留，preview／Chrome已停止。
- 第一次完整verify遇到既有`onboarding.test.ts`兩項間歇permission denied，未修改該測試或授權；target重跑及完整verify2成功，不宣稱已找出／修正此既有flakiness。額外all-test tsc仍10個既有錯誤，沒有新增。

## 已核准發布與恢復限制

commit/push／exact SHA CI、正式32備份解密實際還原／新舊契約及隔離整HTML流程、schema33 migration與matching API-worker部署已完成；137HTTPS checks通過，兩份env bytehash與兩個Telegram flag true、WA未配置、隱私政策draft保持。33不能只切binary回32；若流量後DB回復，須另核准並對帳新的pending轉核准、身份／配額／通知等寫入，不可覆蓋掉新資料。

發布後由原待審學員本人重新點原有效邀請、填／確認資料再核准，不代操作、不批量核准；真人從白雁圖文選單一路驗收到打卡仍待完成。
