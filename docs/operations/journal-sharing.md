# 練功心得、跨區分享與合作系統 API

**已部署：2026-10-09 10:02:27–10:02:45 UTC，18秒；release 852cd05ce54c9aac4a2e650fb207d04838760684／schema22。** [CI37914571159](https://github.com/lulu-lovebird/qigong-platform/actions/runs/37914571159) 成功。既有心得保持私密，正式分享／外部client皆零，官網登入串接尚未啟用。

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## 權限與入口

| 角色／入口                                              | 可讀內容                                        | 可寫內容                                     |
| ------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------- |
| global Super、master_admin、coach_admin：/admin/journal | 全地區私密心得及感受                            | 心得唯讀；不自動取得 taxonomy.manage         |
| regional_viewer：/admin/journal                         | 已授權 operational 地區內全部心得，包括私密內容 | 心得唯讀；無跨區、匯出或刪除能力             |
| regional_admin、global_viewer                           | 原有報表                                        | 本批不增加私密心得權限                       |
| taxonomy.manage：/admin/practice-feeling-tags           | 快速標籤目錄                                    | 雙語名稱、啟用、停用、排序、最多30項整批儲存 |
| 已核准 Telegram 學員：/telegram/journal                 | 跨所有地區的主動分享快照，以及自己的私密原稿    | 發布或撤回自己的分享                         |
| 合作系統 backend：/api/v1/shared-journal                | 明確另外同意外部讀取的分享快照                  | 唯讀                                         |

地區授權沿用既有 person scope／主要地區規則，不依姓名、Email、Authgear role claims 或外部網站帳號自動授權。regional_viewer 接入待審申請、Master／Super 普通角色核准、版本式編輯、單筆／全部撤銷；必須指定 active operational 地區，不接受 global 或 cohort scope。自我異動、受保護帳號、最後 Super、版本／鎖後再驗證、audit 和 session 撤銷規則維持。

遷移新增 regional_viewer 私密讀取 permission，撤銷持有此角色者的既有普通 session，要求重新登入；不改既有 grants 或建立管理員。既有 cohort coach 的 scoped 權限不轉為 global coach_admin。

管理員心得 API：GET /admin/api/journal?lang=zh_TW&page=1，選填 personId UUID，每頁20項。範圍外學員不回傳內容或可識別計數。標籤 GET／PUT /admin/api/practice-feeling-tags：PUT 須有效管理 session、CSRF、版本、taxonomy.manage；停用／改名不改寫歷史標籤快照，不提供硬刪除。

## 學員同意與快照

- 私密原稿與分享獨立儲存；不自動發布既有心得，也不把感受納入聊天摘要。
- /journal、/share 是 Bot 私聊第五個 WebApp 入口；舊四頁導覽亦可進入。沿用身份綁定15分鐘平台 capability，不信任未驗證 initData／瀏覽器 user ID。
- 首次暱稱空白，心得、感受、外部分享預設未選；顯示原稿、功法及感受預覽，再確認發布。暱稱不自動複製真實姓名；自由文字仍可能含自行輸入的個資，不能宣稱自動去識別化。
- 分享為獨立快照。更正私密原稿不更新分享；重新發布須確認預覽及符合 publication version。
- own 回應的 sourceHash 綁定完整來源；發布在 person lock 後再比對，預覽後來源更動回409，不發布未見新內容。撤回不要求來源仍相同。
- 心得、感受、合作系統讀取分別選擇，內容須非空。分享亦包含日期及功法名稱，不含真實姓名、聯絡資料、平台身份／person ID。
- 撤回停止平台新讀取。已看過、截圖、複製或在飛行中的回應無法收回；合作系統須停止呈現並清除快取。作者停權、身份撤銷、管道關閉／未核准期間不供讀取。
- 只在實際修改時阻止離頁／語言切換；失敗保留輸入，成功只重設該卡基線，不丟失其他卡草稿。成功卡需重新載入才能再修改。
- SDK啟動前移除 capability，避免 initParams cache 留存，並清除 fragment。LINE／WhatsApp 未新增分享入口或啟用。

## 合作系統登入契約（正式串接前須確認）

API **驗證系統 credential，不驗證網站終端使用者 session**。白雁官網等合作 backend 須先驗證自己的使用者已登入及有網站讀取權限，再呼叫 API；不得提供匿名代理 endpoint。網站登入不是平台管理員授權，也不建立身份連結。尚未核准官網登入／授權串接，不能宣稱已完成官方整合。

- 每個 backend 用獨立可撤銷 shared_journal.read credential，不用管理員 session 或瀏覽器密鑰。
- 僅有效 global Super 透過 POST /admin/api/journal/clients 發行；需 CSRF、label、expiresAt、reason。回傳 id／token／expiresAt／scope，token 僅當次顯示，DB 僅存 SHA-256；不自動建立 client、不提供原 token 清單。
- 最長90天。POST /admin/api/journal/clients/:id/revoke 帶 reason、CSRF；遺失 token 必須另發行並撤銷舊 client。
- GET /api/v1/shared-journal?lang=zh_TW&page=1，Authorization: Bearer [server-side credential]。雙語，每頁20項，只讀 active 且 externalEnabled 快照。
- 禁止 Origin header 的瀏覽器整合，無 CORS、no-store／no-referrer。缺少 Origin 不證明是 backend，真正認證仍靠 credential，須保存在 backend secret store。
- 每 client 每分鐘60次。401 credential 無效／撤銷／到期，403 瀏覽器整合，400 查詢錯誤，429 含 Retry-After: 60。
- 禁止內容快取、永久批次匯入；撤回後須合作方清除。平台不能保證刪除既有第三方副本，正式串接須核准及驗收清除流程。
- Audit 記 client ID、頁碼／筆數、異動理由，不存 credential、心得、感受、聯絡資料或外部使用者身份。合作方不得記錄 Authorization header。

## 發布與回復

- 新 0022_journal_sharing.sql，不改0001–0021。新增兩張 forced-RLS 表；runtime 無直接 SELECT／內部 helper 權限，只能呼叫 credential-bound facade。
- 正式 API／worker exact0022。新 binary 不可指向21，舊21 binary 不可指向22。
- 經核准完成正式快照21→22／重跑／旧binary拒絕／matching worker／OIDC／授權及分享／外部撤銷 smoke。最終DB／roles／env／systemd站外AES-256-GCM副本逐一解密核對雜湊，DB實際還原21與基線（含metadata）一致，舊0ed750d readiness通過。回復須 matching21 DB＋0ed750d API／old-release.conf／worker；開流量後另核准並對帳。
- 完整 pnpm verify：**356項通過、無 skip**，格式／lint／source typecheck／build 通過。額外全測試 tsc 尚有10項既有錯誤，沒有本批新錯誤。
- isolated PostgreSQL16 scope／快照／來源衝突／撤回／credential／限流／CSRF／標籤／grant保護／21→22 session撤銷測試通過。Chrome六種390px／1280px雙語合成配置無溢出／JS exception，SDK cache 無 capability，草稿 native guard 通過；合成畫面不代表真人 Telegram／Authgear／官網驗收；正式快照演練另已完成。
- 正式保留51張舊表授權變更排除後完整雜湊、3人／5筆打卡／grants／sessions；新增2表。region permission＋1 migration audit＋architecture metadata為核准差異，無需撤銷的viewer session。82項公開HTTPS檢查通過，API active／NRestarts=0／ExecMainStatus=0，timer active、worker Result=success／ExecMainStatus=0，實際三lane均0；保護env不變。worker演練3筆mock摘要無私密內容，零真實測試訊息。
- 回復資料：/root/qigong-deploy-852cd05、/opt/qigong-platform/deployment-tools/852cd05、/tmp/qigong-release-852cd05、~/.local/share/qigong-platform/backups/deployment-852cd05；key另置受限backup-keys。停止的rehearsal cluster可清除，保留備份與舊21 release。不宣稱完整OS／Caddy災難復原。
