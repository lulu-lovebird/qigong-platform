# 管理員權限申請與分級審核

## 狀態

本輪已依使用者確認於本機實作；**未提交、推送或部署**。正式仍為 `b271ede`／schema `0018`、原雙按鈕語言切換與右側登出。本機候選版本需完整 `0001–0019`，API 最小／最大均為 `0019_admin_access_approval.sql`；不能直接替換正式 binary。

完整隔離 PostgreSQL16 的 `pnpm verify`：**213項通過，無 skip**，含格式、lint、source typecheck 與 build。未改歷史 migration、依賴、正式設定或舊 Bot。新增兩個角色及 `admin_access.manage` permission（配置給 master／super）；未擴張既有 regional_admin／global_viewer／班級 coach 模板，未自動轉換任何既有授權。

## 介面與流程

- 共用四頁與管理員審核頁：語言下拉選單在側欄品牌下方；登出在主要選單下方，右側不放按鈕。保留 locale cookie、套用的篩選／personId／日期；待審學員與管理員審核頁切換先確認、取消恢復選單值，不自動提交決定。
- Authgear 驗證成功、但尚無管理授權：發出獨立 HttpOnly 待審 cookie，導向 `/admin/access`。可申請 `regional_admin`／`global_viewer`／`coach_admin`／`master_admin`，填地區／工作範圍說明與理由；不開放未授權帳號枚舉班級目錄。
- 待審頁僅顯示本人申請狀態。登入 Authgear 只證明身份，不等於管理權限；待審 token 永遠不由既有 `admin.session_principal` 解出管理員身份，也不能讀報表／審核學員／管理授權。
- 具有有效 **global `super_admin`／`master_admin` grant** 且具管理授權能力的帳號顯示「管理員權限」選單，進入 `/admin/administrators`。可看已驗證 issuer／subject、姓名／已驗證 Email、申請角色與說明、現有授權；姓名／Email 相同的帳號仍獨立，不自動合併、核准或依 Authgear 自訂 role claim 賦權。
- 核准可選最終角色；`regional_admin` 必須指定有效 operational region，其餘三個角色固定 global，不能附帶地區／班級 UUID。畫面顯示權限摘要，**coach_admin／master_admin 均包含全域私密心得與所選感受唯讀權限**；沒有任意 permissions 勾選或瀏覽器建立 super admin。
- Master 僅可核准／拒絕、另增／撤銷一般三種角色：regional_admin、global_viewer、coach_admin。Master 申請及其他 master／super 帳號（含未到開始日期的高權限 grant）保留 super admin 操作；SQL 封鎖自我異動、高權限升授／撤銷，UI 依服務端 `canManage`／`canRevoke` 與可配置角色清單顯示，不能靠偽造 body 繞過。
- 拒絕／核准／新增角色／撤銷均要求理由與 CSRF。已核准或受控預先配置的帳號可另增地區／全域角色；尚待核准者不能繞過審核直接授權。變更理由與姓名保留原文。
- 核准後需重新登入才取得普通管理 session；待審 credential 不會升級。新增／撤銷角色會撤銷受影響帳號的既有普通 session，必須重新登入；權限撤銷／到期、principal 停用也持續由 session／SQL 授權檢查拒絕。
- 不允許透過此介面修改自己的 grants；保護最後有效 super admin。異動均進 `audit.events`，記錄 actor、target、role／scope、理由、版本或原授權。審核使用版本及鎖防重複核准；角色異動序列化，在取得鎖後重新驗證操作者，含等待期間撤銷或到期。

## 確認的角色規格

| 身分               | 角色／範圍               | 私密心得及感受 | 管理員授權                                    |
| ------------------ | ------------------------ | -------------- | --------------------------------------------- |
| 地區管理員         | regional_admin／指定地區 | 無             | 無                                            |
| 白雁工作人員       | global_viewer／全域唯讀  | 無             | 無                                            |
| 白雁氣功教練       | coach_admin／全域唯讀    | 可讀           | 無                                            |
| 白雁老師、彥寬老師 | master_admin／全域       | 可讀           | 管理一般管理員                                |
| 指定最高管理員     | super_admin／全域        | 可讀           | 包含配置 master；super 初始配置由受控程序處理 |

Coach／master 沒有新增學員修改、打卡更正、資料匯出、標籤維護、訊息廣播或個資刪除權限。既有班級 `coach` 仍維持原角色與授權，不因這次新角色而升為全域。心得管理頁／HTTP 路由仍屬未完成 backlog；本輪驗證的是權限、SQL 查詢及審核流程，不是假稱該畫面已上線。

## 第一位 super admin：受控 bootstrap

使用者已指定第一位 super admin 候選帳號；聯絡 Email 另以私下核對為準，不寫入程式或自動授權條件。**本輪未建立 Authgear 帳號或配置任何正式 grant**。指定人選不等於核准部署；真正授權仍須核對正確 tenant 的 issuer／subject、UID 及已驗證 Email。

1. 指定使用者先登入正確 Authgear tenant／client，取得待審記錄。
2. 受控 DBA 私下核對該記錄的 `oidc_issuer + oidc_subject` 與 Authgear 帳號 UID；不可只憑姓名、Email 或登入先後順序。不得把 OIDC token／code／憑證貼到聊天或提交 repo。
3. 使用受控 migration／DB owner 連線，在交易內鎖定與配置下列 grant；`principal_id` 必須是上一步已核對的 UUID。**以下為操作範本，不是本輪已執行的正式操作。**

```sql
-- psql: 先以受控方式設定 verified_principal 變數；不是從網頁 JSON 取得。
BEGIN;
SELECT pg_advisory_xact_lock(1919, 1);
SELECT id, oidc_issuer, oidc_subject, status
FROM admin.principals
WHERE id = :'verified_principal'::uuid AND status = 'active'
FOR UPDATE;
-- 必須核對上列恰為預期身份的一筆資料，否則 ROLLBACK。
WITH added AS (
  INSERT INTO admin.role_grants (principal_id, role_id, scope_type, reason)
  SELECT p.id, r.id, 'global', 'Approved controlled super admin bootstrap'
  FROM admin.principals p CROSS JOIN admin.roles r
  WHERE p.id = :'verified_principal'::uuid AND p.status = 'active'
    AND r.code = 'super_admin'
  ON CONFLICT DO NOTHING
  RETURNING principal_id
)
INSERT INTO audit.events
  (request_id, action, target_type, target_id, reason, outcome)
SELECT gen_random_uuid(), 'admin_access.bootstrap', 'admin_principal',
  principal_id::text, 'Approved controlled super admin bootstrap', 'success'
FROM added;
-- Fail closed if no effective global super admin grant was created or retained.
SELECT 1 / CASE WHEN EXISTS (
  SELECT 1 FROM admin.role_grants g JOIN admin.roles r ON r.id = g.role_id
  JOIN admin.principals p ON p.id = g.principal_id AND p.status = 'active'
  WHERE g.principal_id = :'verified_principal'::uuid
    AND r.code = 'super_admin' AND g.scope_type = 'global'
    AND g.valid_from <= clock_timestamp()
    AND (g.valid_to IS NULL OR g.valid_to > clock_timestamp())
) THEN 1 ELSE 0 END AS bootstrap_guard;
UPDATE admin.sessions SET revoked_at = CURRENT_TIMESTAMP
WHERE principal_id = :'verified_principal'::uuid AND revoked_at IS NULL;
UPDATE admin.access_applications
SET status = 'approved', version = version + 1,
  decision_reason = 'Approved controlled super admin bootstrap',
  decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE principal_id = :'verified_principal'::uuid AND status <> 'approved';
COMMIT;
```

4. 確認 grant 的 scope 為 global、帳號有效、audit 已留下記錄；使用者重新登入，核對管理頁與跨 scope 拒絕。此範本不是通用帳號管理 API，也不把 DB owner 的操作冒記成某個登入者。

## 邊界與驗證

- 新 `admin.access_applications`／`admin.access_sessions` 強制 RLS；runtime 沒有直接表讀寫權限，待審 token 僅存 hash。角色寫入只經受限 definer 入口；共享內部 writer 沒有 runtime EXECUTE。
- 管理員名稱、OIDC subject、Email、申請／異動理由不放 request URL 或一般失敗診斷；JSON 不含 session token。HTTP 邊界沿用 OIDC state／nonce／PKCE、issuer／audience 驗證、既有 cookie／CSRF 與限制型 CSP；動態文字用 `textContent`。
- 測試含受限 NOINHERIT／NOBYPASSRLS login、首次待審／未授權／CSRF、四種角色 scope、跨地區私密心得／tag 的實際 forced-RLS 與 journal 查詢、master 委派／保護帳號與請求、唯讀角色禁止寫入權限、重複與並行核准、拒絕重送、身份不合併、停用／到期、角色新增與 session 撤銷、等待鎖時失權／到期、雙語 VM 操作、XSS 字面顯示。
- 不等於真人 Authgear／桌機／手機驗收通過；仍需部署前演練 `0018 → 0019`、備份還原及 matching API／worker。實際 Authgear profile／email claims 是否提供，也需用指定帳號驗收；缺少已驗證 Email 時不採用未驗證值。
- 未實作授權通知、申請／session 定期保留清理、公開註冊 rate-limit 或任意角色自訂；不要將這批當成可直接大規模公開的管理員註冊服務。成就／心得管理頁的既有 backlog 不因這批完成而消失。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
