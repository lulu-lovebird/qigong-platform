# Telegram私人待審通知（schema32已部署、發送已啟用；個人需opt-in）

使用者核准先實作Telegram私聊通知新管理員／學員申請。已另經使用者核准commit/push/deploy 8f98da9／schema32，2026-10-14 18:04 UTC切換、CI38610844698／629tests成功。正式env／webhook／Bot commands／憑證／政策未改，未建立正式綁定或發送真人訊息；learner reminders啟用、WhatsApp未配置，review worker於2026-10-15 01:04 UTC經使用者另核准設true；未改個人偏好／綁定，當時1個bound、0個opt-in，無批量發送。見[部署與實際恢復證據](review-notification-deployment.md)。

## 管理員操作

正常Authgear管理員登入後開`/admin/notifications`（我的通知設定）：

1. 產生10分鐘高熵綁定指令，raw token只顯示一次；DB只存hash，重新產生撤銷舊未確認挑戰、不改原通知收件人。
2. 將`/admin_notify <token>`送到新平台Bot**本人私聊**。只有驗證Telegram webhook secret、private chat.id=from.id、非bot才處理，不需要同時是已核准學員，不按姓名／Email／電話找身份。
3. Bot提供6位確認碼。已登入後台輸入碼並帶CSRF／revision確認，才能綁定；轉傳token讓別人claim時仍缺本人的後台確認，不會立即替換收件人。確認碼只存hash、5次錯誤後失效；保存錯誤次數不因HTTP400 transaction rollback消失。
4. 綁定後通知種類預設仍off，勾選管理員申請／學員申請並保存、選語言。綁定不合併person或增加admin role，Telegram subject不能綁多個admin principal。
5. 本人測試加入outbox、至少間隔5分鐘，10分鐘內有效，需global worker啟用；不是API直接發送。解除綁定停止偏好、撤銷未確認挑戰與cancel pending/sending。

日誌／audit不含token、確認碼、recipient、申請姓名／Email／phone／reason。UI只顯示Telegram末4碼，不用localStorage/sessionStorage保存秘密。

## 事件與收件權限

- 管理員：access application draft/rejected→pending或新pending version；單純登入／profile metadata刷新／開表單不通知。
- 學員：pending且完整name/email/E164資料才發事件；placeholder pending不發，重試完整資料不洗版。pending改requested region另產生新scope事件並使舊region事件失效；明確重新提交以更新timestamp識別。
- LINE預核准：同交易直接approved，不形成complete pending事件，不發錯誤待審通知；既有申請人核准／拒絕通知outbox保持。
- 收件人須active principal、有效grant、本人綁定且類型opt-in，依原`admin.can_manage_access_target`／`admin.can_review_application`評估。Super／Master限制含master-role申請僅Super、自身申請不自審；regional/country僅原授權scope。
- permission probe是無runtime execute的private owner facade，短暫principal context後正常／異常都恢復，worker不能自行讀表／拿任意principal impersonation權限。
- queue／claim／pre-send都重查申請仍pending、region／version、recipient角色／scope、preferences revision及bound destination；已處理／移區／停用／撤權取消未送。不回填已有歷史pending為事件。

## 私聊內容與後台通知中心

只發`🔔 有新的管理員／學員申請待審核`、本輪同kind/region仍可審核的筆數及授權region名稱；不包含個資或理由。按鈕是正常`/admin/administrators`或`/admin/applications` HTTPS網址，仍Authgear登入／CSRF／原審核權限，不含token或聊天直接核准。

`/admin/notifications`目前範圍pending、無可用delivery route、發送failed數及最近20事件，不顯示他區資訊。沒有收件人或worker未排程不默默消失，UI保留unrouted警告與正常審核入口；此中心只列功能推出後的新事件，歷史pending仍在原申請列表。

## Worker與限制

新可選`REVIEW_NOTIFICATIONS_ENABLED=true`；缺省／false完全不queue/claim/send，其他字串拒絕；部署與正式開關已分別核准；2026-10-15 01:04 UTC只原子更改worker此flag=true，其他bytes／權限、API.env、learner reminder與WA配置保持。matching worker成功並恢復每分鐘timer，受限設定備份／驗證證據`/root/qigong-review-enable-20261015T010410Z`保留。私聊綁定確認碼回覆是使用者主動操作，獨立於此outbox開關。

- 每輪queue最多200 event-recipient pair，exclude已存在pair避免starvation；新pref revision可重新排已cancelled但仍pending事件，sent不重發。
- 最多5 merged leases并行，每組同principal/kind/region最多50 events、30秒合併等待、2分鐘lease、5秒HTTPtimeout、最多8次指數backoff不超15分鐘。大101事件驗證50/50/1，leader必須在該lease內。
- 所有lane parallel，review最多約5秒transport、既有最長lane約30秒；不聲稱DB等待有上限。角色／申請在網路發送之間仍有in-flight window，已接受訊息不能保證召回，ack遺失可能重送，非exactly-once。
- invalid payload／transport／lease錯誤只一般訊息及delivery UUID；無email/LINE/WhatsApp/group notification、無LLM／原始申請內容輸出。

## Schema與驗證

`0032_review_notifications.sql`新增preferences／hashed binding challenges／events／deliveries四表forced-RLS，無runtime表權限；owner-only permission probe与trigger，API本人設定、worker claim/payload/finish限定facades，沒有角色／person／grant／同意回填。API exact32／worker `ops.review_notification_schema_ready()`／`phase-17-review-notifications`。

DB11／HTTP7覆蓋雙向碼與wrong-code persistence、token hash／masked destination、private signed webhook與群組拒絕、CSRF／冒名／defaults-off、complete submissions／draft-noise／invites-no-review、跨區／Master限制、resolved與region-change、權限撤銷與context-restoration、unrouted warnings、prefs version/disconnect/re-subscribe、test rate-limit、merge101/50leader、lease/backoff／sent去重、無PII payload／normal authenticated links及global flagfalse。

31→32合成upgrade/reapply保留所有非metadata舊表指紋与歷史pending，新四表空、無歷史事件或自動訂閱；旧API/worker gate拒絕32，新ready。Mock provider與code不是Telegram真人送達或重放防護的全域exactly-once證明。

本次發布已另核准，正式31快照clone／最終站外加密backup實際還原與matching API-worker完成；review flag後續已另核准啟用；仍由管理員真人綁定／勾選並測試收件，不代為批量opt-in。32→31需matching31DB＋fee82ba，不可binary-only，流量後需對帳新events/偏好/綁定/alerts與其他寫入；不保證OS/Caddy災復。
