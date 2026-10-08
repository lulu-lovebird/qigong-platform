# 已授權管理員名單與授權異動

## 狀態

使用者已確認實作；本機候選 `0020_admin_grant_management.sql`／API 最小及最大 `0020`，**未提交、推送或部署**。正式維持 `79f3e4c`／`0019`，未改任何正式 grants、保護設定、歷史 migration 或依賴。完整隔離 PostgreSQL16 的 `pnpm verify`：223項通過、無 skip，包含格式、lint、source typecheck、tests、build；`git diff --check` 通過。

## 操作流程

1. 在「管理員權限」選擇「等待核准」或「已授權使用者」；另保留所有帳號等進階篩選及20筆分頁。
2. 已授權名單包含既有受控預先配置帳號，不以申請狀態 approved 作為唯一依據；至少一筆目前期間內的 grant 才列入。停用帳號仍列出已配置授權，但其 effective 狀態為 false。歷史授權全部失效的帳號只在所有帳號檢視。
3. 每筆 grant 顯示角色、地區／全域範圍及有效／未生效／失效狀態。Authgear 沒有提供 Email 時明示缺少 Email，不以姓名或 Email 合併帳號。
4. 「編輯授權」展開原角色及地區，修改後填理由及確認。允許 regional_admin、global_viewer、coach_admin、master_admin 的模板及有效 operational region；不開放任意 permission 清單。舊 coach／country／super 等角色不直接編輯，保留原設定。
5. 單筆「撤銷」關閉指定 grant；「移除全部管理權限」需另填理由並確認全部撤銷。保留歷史 grant 與稽核，不刪除 Authgear 帳號、管理員身份、學員或打卡資料。
6. 異動撤銷該帳號既有普通管理 session，須重新登入。篩選／分頁寫回 URL，語言切換保留已套用條件；切換頁面先確認未送出設定，不自動提交。

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

需要另行核准提交／部署、演練 `0019 → 0020` 及備份還原，完整 matching artifact／API／worker 才能上線。舊 `0019` binary 不相容 `0020`；回復需匹配 `0019` DB＋`79f3e4c` release／drop-in／worker，開流量後還原會失去後續寫入，須另獲核准與對帳。

真人 Authgear、桌機／手機瀏覽器驗收仍待完成。心得／tag 管理頁、成就 worker backlog 不因這批完成而消失；下一個未實作的徽章 migration 規劃改接 `0021`。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
