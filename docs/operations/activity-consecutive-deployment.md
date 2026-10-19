# 獨立活動連續打卡42：正式部署與復原

## 核准與版本

- 使用者先核准本機實作，再另核准commit／push／deploy與**本次41→42直接協調維護例外**；精確SHA CI／隔離演練過，封鎖入口、停API／雙worker、final加密DB／roles／runtime實際還原及保存過才升級切換。不是rolling expand，不沿用41例外。
- 正式功能 **`be126a547142f6917accd98993ac1e938d955f59`**，精確SHA CI **`39281636756`**首輪成功／**1031 tests**（API771／DB252／config2／identity6），兩strict gates、format／lint／typecheck／build與靜態簡中來源檢查過。CI曾queued／runner未指派／steps0，當時沒有停機或升級；使用者要求繼續後確認同一run成功才續行，未重跑、跳過或拿本機測試替代CI。
- 功能commit恰21檔；兩份既有無關文件保留排除，dependencies／lockfiles／0001–0041未改。現在**0001–0042均已部署、immutable**。
- API exact **`0042_activity_consecutive_drafts.sql`**，兩worker `ops.achievement_event_streak_schema_ready()`／`phase-27-activity-consecutive-drafts`。
- event表單新增「需連續打卡」，預設未勾＝累計；勾選取活動起訖內任一完整N曆日連續段，gap後新段重計，每日最多一天，不承接活動前後日期。已達標的完整段不因後來gap撤回。三伏／冬至既有activity條件不加flag、不改語意；功法challenge原有功能保留。
- **仍僅草稿與aggregate試算**；不發布／生效／發獎／撤獎／重算，publish disabled、`canPublish=false`、無publish／activate／recalculate端點。既有49 live definitions／season／awards與正常worker邏輯不改。見[完整規格與本機1031測試、13組browser證據](activity-consecutive-drafts.md)。

## 隔離演練

- 正式fafbb68／41健康時，一致exported readonly snapshot供準備fingerprint／dump，入口保持可用。在fresh PG16實際restore roles／DB，**79表／19people／53checkins** exact；舊41 API ready，新42拒41。
- clone套42 **apply1／repeat0**，新42 ready／舊41拒42。全部79表normalized rows exact（只允許platform metadata architecture/time及ledger差異）、journal source hashes／privacy／PGrole aggregate保留；兩private表的raw config／preview hashes、revision、舊cached觀測到期資料無回填。僅validator／compute兩個指定body變更，新建唯一ops gate；原owner／ACL／SECURITY DEFINER／search_path／volatility與其餘function definitions、RLS及raw grants保存。原41 constraints／event unique index仍valid。
- 真compiled scoped grants／Authgear profile／journals／community／invite／review／三語tags／作者／readonly成就與CSV回歸過；CSV只有合成目標2 prepared audit／2 cooldown，其餘業務表保存，無正式個資CSV。
- 新管理8個role×subject（super／master × rule／activity／challenge／event）、24 HTML＋24 catalog三語過。event明確true／false保存與preview、toggle後revision2／latestPreview null、舊revision409、cached preview、Origin拒絕／archive／viewer及publisher404正常。新增8 drafts／8 previews／19預期audit增量，其餘business表及全部原有private rows hash不變，沒有覆蓋clone中原有使用者草稿。
- 真Linux systemd receipts14 mock jobs、雙lane fresh heartbeat、error0／idle poll log0／正常SIGTERM；所有provider傳輸mock，無真人測試send。兩strict TS gates在正式編譯產物／測試source上也過。
- protected env640／units／flags／links capture；normal／maintenance／management-only hold用臨時loopback probe實測，只有checkin站點受影響、其他站點不變。

## 正式最終備份與切換

- **2026-10-19 16:38:38–16:39:41 UTC／monotonic62.146秒**（台北10月20日00:38–00:39）。maintenance入口驗503，停／drain notification timer與兩worker；API **16:38:39 UTC**停寫、確認無active／idle-in-transaction業務連線後重新取final DB／roles／runtime。
- final材料站外AES-GCM、分離0600key、實際decrypt驗hash；runtime真正extract、roles／DB真正fresh PG16 restore，與停寫基線 **79表／19people／53checkins** exact。不是拿維護前準備快照覆蓋後來資料。
- final restored41先驗舊API ready／候選拒41，再在還原clone升42及驗保存，通過才正式apply。正式 **applied1／repeat0**，原constraint／unique-index亦驗valid；切current／版本override及matching API／兩worker。
- workers仍停時，loopback readiness42、管理頁guest302／管理與成就API401、LINE200／未配置WA404正常；API啟動前後79表snapshot exact，**既有1份draft與0份preview的raw table hashes不變**，沒有新增false、改JSON／revision／sourceHash。正式當時無preview，舊cached-preview兼容另有本機actual41→42合成測試證明，不假稱有真人cache樣本。
- **16:39:05 UTC先寫resume-boundary，再啟兩worker／timer**；之後可能已有正常寫入與副作用。fresh heartbeat／health過，16:39:41正常入口恢復。53筆是停寫保存基線，正常流量後寫入另計；沒有回灌正式DB。

## 恢復後驗證

- **229 Node HTTPS checks**過：舊打卡／admin／隱私／成就／CSV guest邊界、管理三語guest302、讀寫API401、publisher／activate／recalculate404。未用正式管理員session測試、未由agent建立正式草稿／個資CSV。
- API／continuous receipts active、restart0／exit0；notification timer active、oneshot inactive／success／exit0正常。readonly receipt health用本次resume epoch，healthy／alerts0；LINE／TG pending／due／sending／failed／expired lease／retrying均0。sample0／p95 null，不宣稱真人延遲或exactly-once。
- protected env640／units／flags／links保留、normal Caddy**全檔byte-identical**。post-runtime再站外加密，真正decrypt／extract並比對current、版本override、env／Caddy；不restore正式DB。
- 真guest兩個合成query markers經local3100：以journal cursor＋probe TCP source ports辨識incoming，再以reqId對completed200／401；`req.url='[REDACTED]'`、marker未洩漏。未改產品logger，不依賴沒有其他真人請求的假設。
- clone PG55516／probe55517停、合成session fixture／worker env移除。未改Cloudflare、Console、clock、政策／同意／WA／alerts scheduler／sink／recipients或任何其他旗標；原clock／TG history403／Python-UA edge差異不因此結案。
- 請使用者重新整理管理頁，勾選後保存再試算；不強制丟棄舊頁未存修改。13組本機browser／clone三語覆蓋不等於真人OAuth／實體手機／所有角色matrix；42人員驗收尚待，不預先寫已驗收。

## 復原邊界

- **恢復後保留42／fix forward**。舊fafbb68 exact41拒42，不可binary-only退41／40，也不可舊snapshot回灌抹掉新checkins／drafts／audit。這次授權不包含這類資料回復。
- 只影響管理時，可受控啟用management-only hold，遮蔽`/admin/achievement-management`與`/admin/api/achievement-management/*`，保留既有打卡、readonly成就及CSV；必要時full maintenance、停API／雙worker，保留42後審matching42修復。每次先驗normal Caddy hash／其他站點／service gates，不覆蓋drift。
- final備份是災難復原材料，非自動restore正式DB授權；隔離還原後仍要核對resume後增量與另行審核。

## 證據位置

- release `/opt/qigong-platform/releases/be126a547142f6917accd98993ac1e938d955f59`；helpers `/opt/qigong-platform/deployment-tools/be126a5`；guard／health／fingerprints／markers／crypto驗證 `/root/qigong-deploy-be126a5`。
- 本機 `/tmp/qigong-streak-release-be126a5`，`release-state.json`由queued checkpoint更新為completed；各階段 `/tmp/qigong-streak-release-{prepare,regression,realtime,activate,public,post-backup}.log`。queue watch timeout是未分派runner的等待，不是測試失敗；沒有隱藏重跑。
- 站外ciphertexts `~/.local/share/qigong-platform/backups/deployment-be126a5`；分離key `~/.local/share/qigong-platform/backup-keys/deployment-be126a5.key`，不得貼值／入Git。crypto helper來自耐久backup路徑，不依賴/tmp-only檔案。

另見[schema協調原則](../architecture/schema-compatibility.md)、[先前41部署](independent-activity-deployment.md)。
