# 已授權管理員名單與授權異動

## 狀態

最新卡片／操作表單版已於 **2026-10-08 15:50:04–15:50:43 UTC** 核准部署 `ccd06a9d43fd4c82534b4732f6bb516c4eecfa78`（39秒），schema 維持20，不執行正式 migration。CI 37803401344、259項完整測試無 skip、正式快照演練／最終站外備份實際還原／公開 HTTPS41項通過。42張表完整資料與保護 env 不變，無真實測試訊息；API／timer 正常。同20回復可用fbdf7a1 binary／symlink／原 API drop-in／matching worker，不應還原 DB。390px／1280px本機 Chrome 合成資料預覽有檢查排版與無水平溢出，正式真人驗收仍待完成。以下保留前版紀錄。

最新 UI 修正已於 **2026-10-08 15:08:35–15:08:53 UTC** 核准部署 `fbdf7a1c700f27da0ce8a1059aeb48225d69e9f1`（18秒），schema 維持20，無正式 migration／授權異動。CI 37797685206、239項完整測試無 skip、正式快照／最終站外備份實際還原及公開 HTTPS41項通過。42張表完整資料（含 grant revision）與保護 env 不變，無真實測試訊息；API／timer 正常。此次同20可退回4a0237e binary／drop-in／matching worker，不需也不應還原 DB。備份及演練限制見 `Handoff.md`。以下是首次升級20的歷史紀錄。

使用者核准 commit／push／部署後，已於 **2026-10-08 14:24:10–14:24:28 UTC** 部署（停機18秒）。程式 `4a0237e96d9a6181fea0c1a98f0f475c4bc1acb1`／schema `0020_admin_grant_management.sql`，API 最小及最大均為 `0020`。CI 37791615057 成功，223項完整本機測試無 skip，格式／lint／source typecheck／build／diff check 通過。正式快照升級、舊程式拒絕新版、最終站外備份實際還原及公開 HTTPS41項通過；無真實測試訊息。全部42張既有表原始資料保留（僅新增 revision 欄排除雜湊），既有帳號／授權／session／學員資料未變。未改保護 env、歷史 migration、依賴、舊 Bot 或啟用新 provider。

## 操作流程

1. 在「管理員權限」選擇「審核管理員申請」（查看已送出、尚未核准的管理權限申請，核准或拒絕，非學員報名審核）或「管理現有授權」（查看現有／預先配置管理員，依操作權限調整角色、地區及撤銷）。兩入口各有常駐用途說明，繁中／英文同步；另保留申請狀態名稱、進階篩選與20筆分頁。
2. 已授權名單包含既有受控預先配置帳號，不以申請狀態 approved 作為唯一依據；至少一筆目前期間內的 grant 才列入。停用帳號仍列出已配置授權，但其 effective 狀態為 false。歷史授權全部失效的帳號只在所有帳號檢視。
3. 每筆 grant 顯示角色、地區／全域範圍及有效／未生效／失效狀態。Authgear 沒有提供 Email 時明示缺少 Email，不以姓名或 Email 合併帳號。
4. 預設先閱讀帳號卡片與逐筆角色／範圍／狀態／期間，身份與申請資料收在「身份與申請詳細資料」。點「修改授權」才展開原角色及地區表單；「新增角色」使用獨立表單，不取代既有授權。所有控制都有可見標籤，「異動理由（必填）」為多行文字框，附稽核用途、500字上限與範例，填寫後確認送出。允許 regional_admin、global_viewer、coach_admin、master_admin 的模板及有效 operational region；不開放任意 permission 清單。舊 coach／country／super 等角色不直接編輯，保留原設定。
5. 「移除此筆授權」只展開選定角色的理由／確認表單；「移除全部管理權限」位於卡片底部獨立警示區，展開全部移除的理由／確認表單。兩者明示異動帳號、授權範圍與不刪資料，一律再確認才送出。保留歷史 grant 與稽核，不刪除 Authgear 帳號、管理員身份、學員或打卡資料。
6. 異動撤銷該帳號既有普通管理 session，須重新登入。篩選／分頁寫回 URL，語言切換保留已套用條件；切換名單／篩選／分頁／重新載入僅在有實際未儲存設定時顯示對應確認，不再誤用語言文案；取消保留輸入、篩選、頁碼及 URL，不自動提交。預填值不算修改，恢復原值或儲存成功後可直接切換，儲存失敗仍保護修改。

同時只展開一個操作表單；切換操作或取消如有修改須確認捨棄，取消還原預填值並將焦點返回操作按鈕。寫入期間停用表單及阻擋重送／取消／名單切換；失敗、過期版本或權限不足時保留輸入並顯示就地錯誤。理由按 Unicode 字數驗證1–500字，空白或 NUL 不送出。手機單欄及上下排列操作按鈕，CSS 以 access-* 限定，不重排其他管理報表。

## 安全與一致性

- `admin.principals.access_grant_version` 與申請 revision 分開。每次 role_grants 插入／修改／刪除由 definer trigger 增加版本，不受普通登入 last_login 更新影響；runtime 無直接修改版本的入口。
- 編輯、單筆撤銷及全部撤銷的 HTTP body 必須包含版本及理由。CSRF、UUID、嚴格 body／scope schema 與 SQL 授權均檢查；未知或錯誤版本不會更新。
- Role mutations 沿用 global advisory lock，等待鎖後重新檢查操作者；新操作依 principal → grant 鎖順序，鎖後再次驗證目標與版本。
- 編輯在同一交易關閉舊 grant、建立新 grant。新角色／地區無效、已有重複授權、沒有權限或版本衝突時，舊 grant、session、版本與 audit 一起回滾。
- 全部撤銷先驗證整個非過期集合，再逐筆異動；Master 遇到不能管理的 legacy／高權限角色不會先撤部分一般權限。自我異動、最後有效 super admin、Master 不得修改其他 master／super 或 master 申請等既有保護保留。
- 畫面依服務端 canEdit／canRevoke／canRevokeAll 控制操作，但真正的防線為 SQL。自己仍可看到自己的授權，不可修改。
- Web 建立的 grants 即時生效。受控 owner 曾設定的 future grants 不可透過這批撤銷，整批有預排授權時拒絕，避免改寫原日期或留下稍後生效的授權；需要受控程序另行檢查。既有預排資料不會被 migration 改動。

## 介面

- `GET /admin/api/access/accounts?status=authorized&page=1`：目前已配置授權名單；既有 status 篩選保持相容。
- `POST /admin/api/access/grants/:id/edit`：version、role、regionId（僅 regional_admin）、reason；回傳替代 grantId。
- `POST /admin/api/access/grants/:id/revoke`：version、reason。
- `POST /admin/api/access/accounts/:id/revoke-all`：version、reason；回傳 revokedCount。

## 部署與驗收待辦

已完成核准的 `0019 → 0020` 升級／重跑零新增／matching artifact／API／worker 驗證。最終 DB／roles／平台 env／systemd 的站外 AES-256-GCM 副本核對解密雜湊，DB 實際還原為19並與停機基線一致、舊版 readiness 通過；備份及一次性工具路徑見 `Handoff.md`。舊 `0019` binary 不相容 `0020`；回復需匹配 `0019` DB＋`79f3e4c` release／drop-in／worker，開流量後還原會失去後續寫入，須另獲核准與對帳。

真人 Authgear、桌機／手機瀏覽器驗收仍待完成。心得／tag 管理頁、成就 worker backlog 不因這批完成而消失；下一個未實作的徽章 migration 規劃改接 `0021`。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
