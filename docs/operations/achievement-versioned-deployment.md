# 成就第二階段A/B/C正式部署：43–46／營運維持OFF

## 已部署與授權範圍

- 功能SHA **`951d1c8856aaba15dd8f6dcaaabb91feef489f04`**，精確SHA CI **39371539528**原run成功：**1105 tests**（API812／DB285／config2／identity6）、兩strict TS gates及format/lint/build/static-map皆過；44檔功能提交排除兩份既有無關文件，dependencies／lockfile／package metadata與0001–0042不改。提交前git staged whitespace檢查發現新0046多餘EOF空行，僅移除尾端空白並驗upgrade test後才提交，沒有重跑CI求綠。
- 使用者另明確核准本次commit/push及**42→43–46協調維護**：精確SHA CI／隔離42相容及升級保存先過；入口封鎖、API及雙worker停寫／drain後取得final加密DB／roles／runtime，actual restore/preservation先過，才切相容42程式、升級46與matching服務；resume後留46／fix forward，不退42或舊snapshot。不是沿用先前42維護例外，也不是不停機rolling宣稱。
- 正式schema **`0046_achievement_evaluation_and_readers.sql`**；API min42/max46，phase27與`ops.achievement_event_streak_schema_ready()`／原worker gate不變。0001–0046現在均已部署、immutable。舊be126a5 exact42拒43–46，不得在46復用。
- **`ops.versioned_achievement_control.enabled=FALSE`，runtime版本／取消／新授獎transition／待啟用candidate正式計數均0**。沒有enable endpoint或raw runtime control grant；部署不是營運啟用。沒有正式發布新rule、以新引擎發獎或得獎通知，沒有agent正式draft／個資CSV／真人provider test sends。既有個人選擇與訊息旗標、WA未配置、draft policy不變。

## 隔離先行演練

- production42準備snapshot為79表／19people／55checkins；加密站外備份與分離key，解密hash／fresh PG16 actual restore。old42和同一951候選在42均ready；兩worker入口JS與be原artifact逐檔相同，worker restricted實際42 gate通過，不呼叫provider。
- 相同候選42→43–46 apply4/repeat0；old42在46明確不ready、新候選ready。保留79舊表normalized rows、原draft/cache/source與security/role aggregates：只允許兩新permission／四role mappings及job generation欄位預期差異。七新表合計86表；49 canonical legacy identities／可證實snapshot，未知舊版本不猜。原function只允許已審核evaluator/queue/reconcile、四個management來源／save/get/catalog及report純讀變更，其餘hash/attributes不變；新增函式集合逐一對照這四份migration。
- compiled原scope/grant/Authgear/三語/聯絡名單/CSV/學員及worker回歸過。新管理8synthetic drafts／8previews、24HTML＋24catalog、2waiting snapshots／預期21audit；valid master/super capability仍canPublish=false，實際activate403，其他business表與原private資料保存。CSV僅隔離合成actors的2份，其他既有cooldown/audit保留，正式CSV0。
- 真systemd連續回條演練14mock jobs、雙lane heartbeat fresh、idlepoll logs0、SIGTERM正常；provider sends0。新版正向schedule/cancel及commit earn/revoke/restore由1105 tests及本機隔離browser另證，不把OFF部署演練冒稱正式ON驗收。

## 正式停寫final actual restore與切換

- 維護 **2026-10-20 05:05:07–05:06:16 UTC**（台北13:05:07–13:06:16），monotonic **69.035秒**。API05:05:09停寫；此時實際為**79表／19people／56checkins／既有1draft／0preview**。最後一筆正常寫入比準備snapshot多1筆，使用final備份保存，沒有以55筆準備快照覆蓋。
- final DB／global roles／runtime在停寫後取得，分別AES-GCM加密站外、獨立key；解密後hash相同，fresh PG16實際還原DB與roles、實際extract runtime並檢查env640／override／links。79表／函式與attrs／RLS／ACL／source／audit／jobs／privacy／roles fingerprint對final正式42 **exact**，不是只pg_restore --list。
- 還原驗證後先切同一951 API及version override，入口仍fenced、workers仍停；正式42 private live回報951、ready min42/max46／qigong-api，**05:05:33確認相容先行版**。API啟動前後79表exact，隨後再次停止API，未在舊be42運作時套43–46。
- final還原clone先apply4並驗79舊表保存，再正式apply4／repeat0。正式46比對final42預期保存，以及final-clone46完整normalized資料／全部function definitions與attrs／RLS／ACL／roles／metadata／control；新metadata捕捉時間不同只在對應新表投影排除，原資料時間不排除。新permission UUID只在預定兩code／四mappings投影處理，原資料照驗。
- matching API private46 startup前後**86表exact**，既有1draft raw hash／revision／config與cached資料不改。operator FALSE、新runtime／transition0。**05:05:40先寫resume marker再啟原雙worker／timer**，heartbeat／新epoch health合格才恢復入口。恢復後採46 fix forward；沒有正式DB restore或downgrade。

## 部署後驗證與復原界線

- **237 Node HTTPS checks**過，含新publication/review/activate/cancel guest401、runtime-enable404與原安全標頭／三語／未登入邊界；不建立正式草稿或個資CSV。兩個真guest日誌probe依TCP source ports／reqId精確對應：incoming URL `[REDACTED]`、completion200/401、synthetic marker不洩漏；不用錯誤schema／模糊grep當證明。
- API／realtime active、restart0／exit0；minute worker最近success／exit0、timer active。`check-receipt-health --local --since <resume-epoch>` healthy／alerts0，兩lane pending/due/sending/failed/expired/retrying0；當次delivery samples0／p95null，**不是實體手機延遲或external exactly-once驗收**。
- env兩檔640及六protected檔、三enabled links／原flags保存；整份normal Caddyfile與維護前byte-identical，其他站台不變；clone/socket55530與probe55531停止、synthetic credential fixture刪。post-release runtime另站外加密、解密hash後實際extract，驗normal ingress／env／current link／override，不把這一步說成另一份post-release DB restore。
- **新引擎仍OFF**。所有workspace report在OFF也已純讀，不再靠開頁補發；原49維持legacy background reconciliation，不重設進度。這不是已啟用新版本的commit即授獎。真人global角色／手機／語言／歷史及單版CSV驗收尚待，不代辦正式個資匯出。
- 若有異常，維持46、pause/drain相關服務並fix forward；舊be exact42不可服務46，不能恢復維護前DB或配置覆蓋新寫入。營運啟用、實際rule／future日期發布、catch-up容量／backlog／pause方案、provider得獎通知皆須另審，不因本部署獲授權。原clock nonmonotonicity、history403及Python-UA edge差異不因此結案；無Console／Cloudflare／clock／legal-policy／告警啟用變更。

## 證據位置

- 本機`/tmp/qigong-versioned-release-951d1c8/`及`/tmp/qigong-versioned-release-{prepare,regression,realtime,activate,public,post-backup}.log`；維護前helper字串escape語法失敗已修並node --check過，未改產品程式或放寬保護。正式helper在`/root/qigong-deploy-951d1c8`與`/opt/qigong-platform/deployment-tools/951d1c8`，fingerprint與credentials保留私有，不貼資料值。
- 站外`~/.local/share/qigong-platform/backups/deployment-951d1c8/`；key獨立在`~/.local/share/qigong-platform/backup-keys/deployment-951d1c8.key`，不得入Git／log／對話。
- [A版本／歷史讀取](achievement-rule-versions.md)、[B待啟用快照](achievement-publication-candidates.md)、[C引擎／安全與本機證據](achievement-versioned-runtime.md)、[相容契約](../architecture/schema-compatibility.md)。
