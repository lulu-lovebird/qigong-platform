# 活動／成就與功法badge草稿40：正式部署與復原

## 範圍與核准

- 使用者先核准phase1與獨立功法badge本機實作，再核准commit／push／deploy，並明確選擇本次39→40直接協調維護：封鎖打卡入口、停API及雙worker，final加密備份實際還原與保存驗過才升級切換。不是沿用CSV39例外或rolling expand。
- 功能 **`8a46c07c9dfecaec7b86a3dcbdcf1e526e66926e`**，精確SHA CI **`39229829965`**首輪成功，**999 tests**（API754／DB237／config2／identity6），兩strict gates、format／lint／typecheck／build與靜態簡中來源檢查過。功能commit恰30檔；兩份既有無關文件保留排除。
- API exact **`0040_achievement_management_drafts.sql`**，雙worker `ops.achievement_management_schema_ready()`／`phase-25-achievement-management-drafts`。0001–0039未變；0040已部署，現在同樣immutable。
- **只開草稿與aggregate試算**，有效global master／super可編輯；preview另需同一角色三項read及person scopes。正式rule發布／生效／發獎／撤獎／重算未實作或啟用，沒有publish／activate／recalculate端點，`canPublish=false`。兩角色未來可發布仍是phase2，不是本次已完成。
- 新功法badge累計預設30天，勾選才連續；不定起算＝新rule預計生效日，指定日不得更早；不承接生效前歷史。ANY／同日ALL是canonical leaves快照，parent是選葉便利，不是課程資格或巢狀條件。生效日目前仍是模擬輸入，不是正式啟用承諾。

## 維護前驗證

- 正式71b2a8b／39健康，env640、normal Caddy全檔hash、既有current／API override、unit與三個既有true旗標先capture；其他站點及flags不變。
- 準備備份站外AES-GCM解密驗hash並實際還原fresh PG16；39舊API ready、新40 API拒39。clone套用40一次、repeat零次；舊39 API拒40，新40 ready。
- **77舊表／19people／51checkins**保存驗證。僅允許本次新增permission及兩個default role mappings、architecture/time與migration ledger差異；所有其餘normalized rows／source hashes／privacy bytes／PGrole aggregate／舊RLS-ACL／function definitions及屬性保留。新增兩空private表、15 restricted functions；無runtime raw table access／PUBLIC execute，worker無management facade權限。
- clone真compiled打卡／授權scope／Authgear profile／private journals／community／review／invite／三語tags／作者／readonly成就／CSV回歸過。CSV只對合成目標，2 prepared audit／2 cooldown，其餘表保留；沒有正式個資CSV。
- 新管理回歸：6個role×subject草稿及preview、18 HTML＋18 catalog三語案例，origin拒絕、stale revision拒絕、相同revision preview快取、archive、未授權與publisher端點不存在。6 drafts／6 previews／13預期audit外，所有business表完全相同；`wouldRevoke=0`／publication false。
- Linux real-systemd receipts演練14 mock jobs、fresh雙lane heartbeat、error0／idle poll log0／SIGTERM正常。所有provider傳輸mock，無真人測試send。
- Caddy以臨時loopback probe實測normal／full maintenance／management-only feature hold，僅checkin站點upstream，其他站點不變；未啟用hold作正式常態。

## 正式維護與最終還原

- **2026-10-19 09:41:20–09:42:21 UTC，monotonic61.307秒**。入口maintenance後停／drain API、continuous receipts與notification worker及timer。
- 停寫後重新取得**final DB／roles／runtime**站外加密備份，key分離0600；不是拿維護前準備快照覆蓋後續資料。全部解密驗hash；runtime實際extract；roles及DB實際fresh PG16 restore，精確77表／19people／51checkins驗保存。
- final restored39舊API ready／新40拒39；在該還原clone先升級40與保存驗證，才對正式套用40：**applied1／repeat0**。正式仍保持入口fence／workers停止。
- 切current與matching API／雙worker artifacts；loopback readiness40、guest管理頁302／API401、私密與打卡舊頁、env／unit／flags保存過。API啟動前後79表snapshot exact；兩新private表為空，沒有agent建立正式草稿、個資CSV或授獎job。
- **09:41:45 UTC先寫resume-boundary再啟workers／timer**，其後即視為已恢復寫入／副作用；09:42:21驗健康後正常入口開放。正常worker後續合法寫入另計，不假稱永久保持51筆。

## 恢復後證據

- **229個Node HTTPS checks**過，包括舊LINE／TG／WA模板／admin／隱私／成就／CSV guest邊界，新增管理三語guest302、讀寫API401、publish／activate／recalculate404。無正式登入或真人provider驗收；WA仍未配置／啟用。
- API／continuous receipts active、restart0／exit0；notification timer active、oneshot inactive／success／exit0是正常狀態。readonly receipt health以新resume epoch檢查healthy／alerts0；雙queue pending／due／sending／failed／expired lease均0。delivery sample0、p95 null，不宣稱真人延遲或exactly-once。
- protected env／units／flags／links保存；normal Caddy全檔byte-identical。post-runtime再加密站外備份，實際解密驗hash與extract比對current、API override、env640及normal Caddy。
- 日誌兩輪共4個合成guest probe，marker均未洩漏。初輪額外harness錯期待completed紀錄含`<redacted>`而失敗；實際是incoming `req.url='[REDACTED]'`，completed只帶reqId／res。保留failure JSON，依實際schema修正harness、以journal cursor精確對應2個incoming＋200／401 completed，marker缺席與URL精確redaction均過。沒有修改產品logger／安全斷言或重跑CI。
- clone／probe停止、private session fixtures移除。未改Cloudflare、provider Console、clock、政策／同意、WA、正式alerts scheduler／sink／recipients。原Python-UA edge403、clock／history403不因此結案。
- 尚待人員以實際帳號／手機驗收管理頁；合成瀏覽器／clone回歸不等於完整真人角色、語系、裝置matrix。

## 復原邊界

- 恢復40寫入後**保留40／fix forward**。71b2a8b與afd90b5 exact39皆拒40；不得binary-only退39／38，也不得回灌舊snapshot抹除新打卡／草稿／audit。
- 如僅management出問題，先受控啟用matching管理feature hold，遮蔽`/admin/achievement-management`與`/admin/api/achievement-management/*`，保留既有打卡、readonly成就及CSV；必要時full maintenance、停API／雙worker，保留40資料後審核matching40修復。每次仍須驗normal Caddy hash、其他站點及service gates，不盲覆蓋drift。
- 最終備份是復原材料與保存證據，不授權自動restore正式DB；災難重建仍需隔離還原、增量／恢復後資料核對與另行批准。

## 證據位置（不含secret值）

- 正式release／tools：`/opt/qigong-platform/releases/8a46c07c9dfecaec7b86a3dcbdcf1e526e66926e`、`/opt/qigong-platform/deployment-tools/8a46c07`。
- 正式guard／health／fingerprints／crypto驗證：`/root/qigong-deploy-8a46c07`；log harness原失敗`log-redaction-first-failure.json`與修正通過`log-redaction-passed.json`。
- 本機helpers `/tmp/qigong-management-release-8a46c07`；各階段log `/tmp/qigong-management-release-{prepare,regression,realtime,activate,public,post-backup}.log`。
- 站外加密材料 `~/.local/share/qigong-platform/backups/deployment-8a46c07`；分離key在`~/.local/share/qigong-platform/backup-keys/deployment-8a46c07.key`，不得貼值／入Git。crypto helper由耐久backup路徑使用，不依賴只有/tmp的檔案。
- stopped clone `/var/lib/postgresql/qigong-rehearsal-8a46c07`（55496），loopback probe55497已停止；不得連回正式做合成fixture。

規格：[草稿第一階段](achievement-management-drafts.md)、[功法badge](method-badge-drafts.md)、[schema協調原則](../architecture/schema-compatibility.md)。
