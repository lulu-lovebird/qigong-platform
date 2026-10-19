# 獨立活動 badge41：部署、實際還原與復原邊界

## 授權與版本

- 使用者確認本機修正後，另核准commit／push／deploy，並明確核准**本次40→41直接協調維護例外**：精確SHA CI與隔離演練過，封鎖入口、停API／雙worker，final加密DB／roles／runtime實際還原及保存驗證後才升級切換；不是rolling expand或沿用40例外。
- 正式功能 **`fafbb68cef66c85552183047da96dbd0c32605e7`**，精確SHA CI **`39244722048`**首輪成功／**1014 tests**（API762／DB244／config2／identity6），兩strict gates與format／lint／typecheck／build／靜態簡中來源檢查過。功能提交恰21檔，兩份既有無關文件保留排除；dependencies／lockfiles不動。
- API exact **`0041_independent_activity_drafts.sql`**，雙worker `ops.achievement_event_drafts_schema_ready()`／`phase-26-independent-activity-drafts`。**0001–0041現均已部署、immutable**，未修改0001–0040。
- 「新增活動badge」是空白獨立event身份；「既有季節活動設定草稿」另列年度／三伏／冬至。名稱、日期、時區、門檻與reason不繼承季節來源；同名同日期也不合併。舊頁面需重新整理才能載入新控制項，不強制丟棄既有未存編輯。
- **僅草稿與aggregate試算**，不更新49 live definitions／season／award／jobs，不啟用正式rule發布、生效、發獎、撤獎或重算；publish disabled、`canPublish=false`，沒有publish／activate／recalculate端點。任一功法有效打卡日期於活動區間累計，每日最多一天；非連續天數或冬至功法限制。見[規格及本機證據](independent-activity-drafts.md)。

## 停寫前演練

- 正式8a46c07／40健康時，以一致exported readonly snapshot取得準備fingerprint及dump，站點仍可正常寫入；在fresh PG16實際restore roles／DB。**79表／19people／53checkins** exact；舊40 API ready、新41拒40。
- clone套41 **apply1／repeat0**，新41 ready、舊40拒41；全部79表normalized rows exact（只允許platform metadata architecture/time與ledger差異），journal source hashes／privacy／PGrole aggregate保留。無新增permission／role mapping；所有RLS／ACL／function attrs保留，僅四個指定function bodies變更，新增唯一ops gate。兩個新identity checks已validated、event partial index unique／valid。
- 既有scoped grants／Authgear／journals／community／invite／review／三語tags／作者／readonly成就／CSV皆回歸過。CSV只有合成目標的2 prepared audits／2 cooldowns，其他業務表保存，沒有正式個資CSV。
- 新管理真compiled回歸8個role×subject（super／master × rule／activity／challenge／event）、24 HTML＋24 catalog三語；8 drafts／8 previews／17預期audit增量，其餘business表不變。Origin拒絕、stale revision、cached preview、archive、viewer拒絕及publisher404正常；HTML確實包含新空白event與分離季節入口。
- 真Linux systemd receipts演練14 mock jobs、雙lane fresh heartbeat、error0／idle poll log0／正常SIGTERM；所有provider傳輸mock、真人測試send0。
- protected env640、units／flags／links capture；normal Caddy／maintenance／management-only hold在臨時loopback probe驗證，只影響checkin站點，其他站點不變。

## 正式最終備份與切換

- **2026-10-19 11:39:22–11:40:23 UTC／monotonic60.729秒**。入口fence驗503，停／drain notification timer與兩worker，API **11:39:23 UTC**停寫，確認無active／idle-in-transaction業務連線後取得final DB／roles／runtime。
- final備份站外AES-GCM、key分離0600、實際decrypt驗hash；runtime實際extract，roles／DB實際fresh PG16 restore。與停寫基線 **79表／19people／53checkins** exact；不是使用準備快照回蓋後來資料。
- final restored40驗舊API ready／候選拒40，再先對該clone升41與保存檢查，通過才對正式apply。正式 **applied1／repeat0**，constraint／unique-index狀態亦驗過。
- 切current、版本override及matching API／雙worker。workers仍停時loopback readiness41、guest管理頁302／管理與成就API401、LINE頁200／未配置WA404正常；API啟動前後全79表snapshot exact、既有data／audit／drafts／previews均保留，無agent建立正式event或匯出個資。
- **11:39:46 UTC先寫resume-boundary，再啟兩worker／timer**；從此已可能有正常寫入與副作用，不能回舊DB。待fresh heartbeat／health過，11:40:23正常入口恢復。53筆是停寫保存基線，正常流量後寫入另計。

## 恢復後驗證

- **229 Node HTTPS checks**過，涵蓋舊打卡／admin／隱私／成就／CSV guest邊界與管理三語guest302、讀寫API401、publisher／activate／recalculate404；未用正式管理員session或產生正式草稿／個資CSV。
- API與continuous receipts active／restart0／exit0；notification timer active、oneshot inactive／success／exit0正常。readonly receipt health使用本次resume epoch，healthy／alerts0；LINE／TG pending／due／sending／failed／expired lease／retrying均0。sample0、p95 null，非真人延遲或exactly-once證據。
- normal Caddy**全檔byte-identical**，env640／units／flags／links保留。post-runtime再次站外加密並實際decrypt／extract，比對current release／API override／env／Caddy；不restore正式DB。
- 真guest兩個合成query marker探針：journal cursor對應2 incoming `req.url='[REDACTED]'`＋200／401 completed reqId，marker未洩漏。本次無log harness失敗、未改產品logger。
- clone PG55498／probe55499停，合成session fixture／worker env移除。沒有改Cloudflare、provider Console、clock、政策／同意／WA／alerts scheduler／sink／recipients或其他旗標。
- 本機browser13組／24圖及clone三語回歸不等於真人OAuth／實體手機／所有角色裝置完整驗收。待使用者重新整理後確認空白新增與既有設定分流，勿預先寫已驗收。原clock／TG history403／Python-UA edge差異不因此結案。

## 復原規則

- **恢復後保留41／fix forward**。舊8a46c07 exact40拒41，不能binary-only退40／39或回灌舊snapshot抹除新checkins／drafts／audit。這次授權不包含這類資料回復。
- 只影響新管理時，受控management-only hold可遮蔽`/admin/achievement-management`與`/admin/api/achievement-management/*`，保留原打卡／readonly成就／CSV；必要時full maintenance、停API／雙worker，保留41後審matching41修復。先驗normal Caddy hash／其他站點／gates，不盲覆蓋drift。
- final備份是災難復原材料，非自動還原正式DB授權；隔離還原後仍需核對resume後增量與另行審核。

## 證據位置

- release `/opt/qigong-platform/releases/fafbb68cef66c85552183047da96dbd0c32605e7`；helpers `/opt/qigong-platform/deployment-tools/fafbb68`；guard／health／fingerprints／markers／crypto驗證 `/root/qigong-deploy-fafbb68`。
- 本機 `/tmp/qigong-activity-release-fafbb68` 與 `/tmp/qigong-activity-release-{prepare,regression,realtime,activate,public,post-backup}.log`。本次CI／release演練／正式切換各階段均首輪成功；先前本機實作失敗紀錄仍見規格文件，不刪除或混為正式失敗。
- 站外ciphertexts `~/.local/share/qigong-platform/backups/deployment-fafbb68`，分離key `~/.local/share/qigong-platform/backup-keys/deployment-fafbb68.key`；不得貼值或入Git。crypto helper在耐久backup路徑，不依賴/tmp-only檔案。

另見[schema協調規則](../architecture/schema-compatibility.md)及[先前40發布](achievement-management-deployment.md)。
