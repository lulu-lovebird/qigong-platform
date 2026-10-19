# 收合後台分類／打卡功法 UI 發布紀錄（同schema39）

## 正式版本

- **`71b2a8b52b563f3ec28ece56cc68e04318280a59`／schema39**，2026-10-19發布；API min/max39、minute／realtime仍為 `ops.achievement_export_schema_ready()`／phase24。
- 精確SHA CI **39184093510**首輪成功：**911 tests**（API698／DB205／config2／identity6），兩道具名strict gates、format／lint／typecheck／build通過，沒有CI重跑。
- 使用者另核准本次commit／push／deploy。功能commit只含6檔：3個共用UI模組、2個測試檔與設計文件；原人工驗收文件增補及無關permissions-review保留、不納入。
- 本次是same39 UI切換，**沒有執行migration applier、DDL、grant、回填或規則變更**。所有0001–0039與dependencies／lockfiles／package metadata不變；不沿用或執行舊38→39維護migration流程。

## 已發布互動

後台各分類預設收合，＋／−切換，一次只展開一類；目前分類標示、權限隱藏、原有草稿離頁保護與手機外層導覽保留。打卡父功法預設收合，展開集合僅存本頁RAM；重繪／日期切換／失敗重試不丟勾選與草稿，父全選／partial與leaf-only payload保持。LINE／TG共用editor套用，WA只同步模板、未啟用服務。見[設計與合成驗證](collapsible-navigation-methods.md)。

## 演練與最終還原

- 準備階段以同一exported readonly snapshot做fingerprint與pg_dump；還原至獨立PG16／socket55494，**原afd90b5與新71b2a8b都39 ready**。
- 77表全資料／metadata／source hashes／cache／publication／privacy／acceptance／grants／audit／jobs、table RLS／effective ACL、所有既有function definition hash與安全屬性、PG role aggregate均exact相等，沒有排除業務資料或允許metadata改變。
- 真compiled舊scope／grants／Authgear／private／external／community／review／invite／三語tags／作者與成就榜回歸通過；CSV6組preview與兩角色合成匯出通過。CSV測試只排除本次合成actors的兩筆prepared audit／cooldown，其他既有export history與limits也納入保存，不假設正式資料沒有匯出歷史。
- 新compiled分類／功法模板12組contract過；本機25組三語／渠道／390／1280px、49張截圖與鍵盤／勾選／草稿證據保留，非真IdP／實體手機驗收。
- 真Linux hardened continuous worker14個合成mock jobs、兩lane fresh heartbeat／error0、idle成功log0、SIGTERM正常；無provider真實測試訊息。
- Caddy normal／maintenance／既有achievement-hold經adapt／validate／loopback55495真probe；全部3100 upstream都在checkin host，其他站台canonical不變。正常設定準備時未改。

首次legacy smoke helper仍預期「舊版拒新schema」，因舊afd39實際ready而拒絕（actual true／expected false），發生於正式維護前。修正為本次**舊／新皆39 ready**契約、保留舊／新相容斷言並續跑剩餘演練；不重跑CI、不重新灌fixture、不改產品或schema。原中止log與continuation log保留。

## 正式切換（UTC）

| 時間                | 動作                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-19 01:24:43 | 進入checkin-only503／no-store／Retry-After60維護。                                                                                                                                              |
| 01:24:44            | minute timer／兩worker已停或drain完成、API停止，確認無active／idle-in-transaction寫入。                                                                                                         |
| 停寫期間            | 取得final DB／roles／runtime＋ingress站外AES-256-GCM備份，逐一解密hash驗證；實際extract runtime驗env640／Caddy hash，fresh PG16實際還原final roles/settings及DB，驗old/new39 ready與exact保存。 |
| 01:25:12            | matching71 API於入口關閉／workers未起時通過readiness、guest routes及exact指紋；先寫resume-boundary，再恢復workers／timer。                                                                      |
| 01:25:48            | minute新版本success、realtime heartbeat／health healthy後恢復normal ingress。                                                                                                                   |

Monotonic維護 **65.163秒**；UTC整秒標記相差65秒。final snapshot **77表／19people／49checkins**、所有metadata與data/security/source指紋exact相等；production與clone contract只有SELECT／readiness，migration applier未執行。未restore正式DB或丟棄任何後續寫入；normal worker恢復後正常業務寫入另計。

編譯manifest比較255個dist檔案：**249逐位元組相同**，僅 `admin-dashboard`、`admin-layout-styles`、`telegram-workspace-pages` 三個JS及各自source map變更；後端、API路由／授權與兩worker編譯碼保持。

## 上線後驗證

- **215項公開Node HTTPS回歸成功**，含三語LINE／TG新收合editor template、原管理／學員／邀請／心得／CSV guest拒絕；管理員未登入只驗302／401，不建立正式authorized session或下載個資CSV。
- 實際LIFF-query及管理API-query兩個log probe：req.url均 `[REDACTED]`，raw query與合成CSRF marker不入log；不輸出原始journal或個資。
- API／RT active、exit0／restart0；minute新版本success／exit0、timer active。一次性health healthy／alerts0，checkpoint兩lane pending/sending/failed/expired0、deliverySamples0／p95null，不稱為新真人手機延遲驗收。
- 六個protected env／base-unit檔案byte hash、owner／mode及三個enabled link保持，env640；原三個旗標、個別選擇、WA未配置／privacy draft保持。只有current與API版本override為預期切換。沒有告警排程／sink、provider Console、Cloudflare、NTP或clocksource調整。
- 整份normal Caddyfile與原始檔byte-identical，owner／mode及其他站台保持；post-runtime／current link／manifest／normal-ingress另站外加密、decrypt-hash並實際extract驗證。
- 公開Authgear login smoke有短暫login challenge，不說成全DB零寫入；沒有正式合成學員／checkin／note／award／binding、authorized admin session、正式CSV或provider測試訊息。
- clone／rehearsal unit／Caddy probe已停止，worker.env與community／realtime／achievement／export credential fixture刪除。既有Python-UA公開health403邊緣差異與舊時鐘／history403根因不因本次Node檢查通過而結案，沒有鬆斷言或更改安全設定。

## 恢復與證據

本次UI可受控回到已驗證相容39的 `afd90b5` matching API／雙worker與saved override；先停／drain並保留目前env、所有新寫入／queue／audit，**不restoreDB、不退38、不覆蓋新資料**。若無法保證matching artifact與readiness，保持維護並檢查／修正39。不要沿用舊schema的rollback或盲目覆寫後來已變動的Caddy配置；本次新hold不是所有UI問題的通用修復。

- `/root/qigong-deploy-71b2a8b`：guarded ingress／normal／maintenance／hold、protected-system、final backup／actual restore／fingerprints、compiled comparison、private-ready／health／log proof與時間界線。
- `/opt/qigong-platform/deployment-tools/71b2a8b` 與 release71b2a8b：實際驗證工具及manifest。`ops.mjs`移除migration applier，只做same39相容／保存檢查。
- `/var/lib/postgresql/qigong-rehearsal-71b2a8b`／socket55494停止；admin-disabled probe55495停止。還原資料只供證據／演練，不能蓋回正式新流量。
- 站外 `~/.local/share/qigong-platform/backups/deployment-71b2a8b`，key另存 `backup-keys/deployment-71b2a8b.key`；final DB／roles／runtime與post-runtime ciphertext均驗證，無明文個資／key進Git或對話。
- 本機 `/tmp/qigong-folding-release-{prepare,legacy-continuation,regression,realtime,activate,public,post-backup}.log` 與 `/tmp/qigong-folding-release-71b2a8b/`。先前本機harness失敗證據保留於設計紀錄列出的paths。

請真人重新開啟後台及打卡頁，在實際IdP與手機驗收預設收合、分類互斥、＋／−、父全選／partial、今日／昨日與草稿；既有CSV／唯讀成就的確認不代替這輪新UI人工驗收。
