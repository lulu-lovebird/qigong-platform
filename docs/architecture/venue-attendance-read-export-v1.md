# 團練場出席：已核准 QR／查詢規則

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

本文件取代先前未核准的 k5、額外姓名 permission、anti-differencing、legacy provenance ledger 與跨區拒絕提案。

## 產品契約

- 既有 scoped view access 可看姓名及出席，不另收姓名權限、不要求最小群體人數。
- 授權歸屬為實際場地的 operational region；沿既有 `admin.can_access_region`，不以學員 home region 篩除跨區／跨國出席。
- `migrations/0002_identity_region_rbac.sql` 的 `checkin.read` 是 non-sensitive check-in view，既有 regional_viewer/global_viewer 等已有；`stats.export` 是既有 scoped export permission。新流程 read 使用前者、CSV 使用後者，不把登入等同 view permission。
- 全新開發，不建立 legacy ledger/backfill。既有資料若存在須在 forward migration 安全停止，而非默默改日期。
- 同人同場場地當地日期一次；同日跨場正常累計，attendanceDays 對當地日期去重。不更動日課／streak，成功後提醒記功法與感受。
- 場地具有 IANA timezone；server 時間判定當地日期、星期與時段，驗證位置與半徑。GPS 可偽造，不是防代簽證明。
- 原始 GPS 僅 POST 當次使用，不落資料庫、log、URL；既有 GPS／日課連結欄位保持 NULL。

## 安全資料面

新 forward migration 保留 FORCE RLS；專用 NOLOGIN/NOBYPASSRLS 非表 owner 函式角色只持必要 column SELECT／INSERT，無 membership，session login 無直接表權限。
0047–0049 不改寫；0048 deny-all 僅由新 reviewed SELECT／verified INSERT policies 取代，UPDATE／DELETE 仍拒絕。舊 NFC gate 與危險路由不開。

LINE ID token 先經原 verifier 的 issuer/audience/expiry 與官方驗證，0049 resolver 映射 active/approved/channel identity；寫入交易重新驗身份、同意、場地 active、當地時段與半徑。客戶不得提供 personId/checkinId；唯一鍵衝突重播已存在成功。

管理功能每次使用私有 admin cookie → 真 session → principal → region+operation permission，CSV 另需 CSRF 並稽核；不擴大既有私人心得權限。

`@apps/public-api/src/venue-admin-read-contract.ts` 保留嚴格 DTO shape/binding 驗證，但不是授權證據。read 最多 100 列／頁、export 最多完整 1000 列；不回傳原始 GPS、電話、心得或內部 learner ID。`timezone: venue-local` 表示各列日期依各場地時區，而非全部 Taipei。

## 驗證與發布

預設功能關閉，只有 server 配置可啟用；URL 無 mode/test/bypass。readiness 僅接受精確新 migration。
本地 mock／SQL 靜態測試不等於 PG RLS／ACL／並行已驗證。操作與實測結果見 `docs/operations/venue-qr-checkin.md`（本實作後續批次交付）。手機、真 LINE、部署與父代理安全審查另行完成。
