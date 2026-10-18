# 成就個資 CSV schema39 發布／實際還原紀錄

## 已發布版本與授權

- 正式：**`afd90b57febd03e05a7c59d0c5e1b81ac6c25bc6`／schema39**，2026-10-18發布。
- 精確SHA CI **39123945084**首輪成功，**891 tests**（API678／DB205／config2／identity6）；build、兩道具名strict type gates、format／lint／typecheck／verify均過，未重新執行CI碰運氣。
- 使用者在本機實作後，另核准commit／push／deploy，再明確核准**本次**38→39協調維護例外、關閉打卡入口、停API與雙worker、最終加密備份／實際還原驗證，以及恢復後保留39／fix forward。未自動沿用38的方案A，也不是rolling expand release。
- 功能commit精確23檔；既有 `admin-achievements-deployment.md` 人工驗收增補及無關 `web-admin-permissions-review.md` 均保留、不納入此次提交。dependencies／lockfiles／package metadata與legacy repositories不變。

## 功能邊界

`achievement.export_personal`只映射至 `super_admin`／`master_admin`，要求有效global grant與同一角色的stats／learner／checkin read；沿用既有三項person scope交集。CSV匯出目前已套用篩選的全部授權得獎者，不限目前分頁。包含明確綁定且未撤銷的平台 IDs、基本姓名、目前管道精確匹配之approved application電話／Email與成就資料；缺值留白，不猜測或合併身份。

下載須有效session、正式Origin、CSRF、固定用途與明確確認；等待鎖後及CSV編碼後重查wall-clock權限／session。最多5,000人、JSON5MiB／CSV10MiB，超限拒絕而非截斷；UTF-8 BOM／RFC quoting／文字與公式保護、安全本地化成就檔名，no-store、無公開CSV URL／伺服器暫存檔。成功準備僅寫最小audit與30秒私有冷卻，不記錄名單、姓名、電話、Email、IDs、查詢字串或CSV；`prepared_not_confirmed_saved`不證明檔案已存妥。

一般GET圖鑑／名單不新增聯絡個資、不中途evaluate／補發／通知；歷史與私人心得不改。詳細來源／格式／保管提醒見[設計與驗證](achievement-personal-export.md)。正式個資下載不在本次代理操作授權範圍內。

## 部署前演練

1. 正式確認原 `a9f6f50`／38，API／realtime／minute timer正常、minute成功；protected env640與Caddy原始hash符合預期。
2. 只讀exported PostgreSQL snapshot同時供準備fingerprint與 `pg_dump --snapshot` 使用，避免在線寫入造成不同時間快照被誤稱相等。還原至private PG16／socket55492，舊38 ready／候選39拒38，再clone apply1／repeat0與完整preservation。
3. 驗證全部76舊表資料、privacy／acceptance／publication／cache／journal_source hashes、grants／audit／jobs、RLS／effective ACL、既有函式owner／ACL／search_path／volatility及**definition hash**、PG角色屬性／credential aggregate hash。僅排除預期architecture/time、一項新增permission與兩筆mapping；新forced-RLS冷卻表空、六新函式／PUBLIC execute0／API與worker無raw table read，worker沒有export facade。
4. 真compiled clone scope／grant／Authgear／private／external／community／review／invite／三語tag／author／舊成就榜回歸通過。新CSV6組role×locale preview、super/master各一份合成CSV、viewer拒絕、CSRF／Origin拒絕、冷卻、最小audit及**其他全部表指紋不變**通過，無正式名單輸出。
5. 真Linux hardened continuous worker接受14個合成mock jobs，兩lane heartbeat fresh／error0、idle成功log0、SIGTERM正常。provider真實發送0；不是手機延遲或exactly-once驗收。
6. 準備DB／roles亦站外AES-256-GCM加密、decrypted hash比對，實際解密到另一個全新PG16 cluster；再驗38→39完整保存。這是維護前的restore rehearsal，不取代停寫後的final backup。
7. Caddy normal／maintenance／achievement-hold各經adapt／validate與admin-disabled loopback55493真probe；確認全部3100 upstream都位於單一checkin host，其他站台canonical配置不變，normal來源未改。hold含CSV／preview路徑503驗證，未在正式啟用。

本機18組三語／角色／390與1280px layout、36截圖及兩份合成browser download證據沿用同一compiled source；不等於真IdP／實體手機驗收。

## 正式維護時序（UTC）

| 時間                | 動作                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-18 12:07:44 | 寫入維護起點、套用checkin-only503／no-store／Retry-After60 fence。                                                                                                                                                                          |
| 12:07:46            | Origin／公開HTTPS fence確認；minute timer、realtime與minute已drain／停止，API停止，確認無active／idle-in-transaction寫入。                                                                                                                  |
| 關站期間            | final DB／roles／runtime＋ingress站外加密、逐一解密hash驗證；runtime實際extract驗env640及兩種Caddy hash。全新PG16實際還原final roles/settings與DB，38 old-ready／candidate-rejected、clone39 preservation通過，才正式apply39一次／repeat0。 |
| 12:08:11            | matching39 API已在入口關閉／workers未起時通過readiness、guest routes及exact資料指紋；**先寫resume-boundary，再啟動workers／timer**。此時即開始forward-only界線。                                                                            |
| 12:08:47            | minute新版本成功、realtime首heartbeat與只讀health通過後恢復normal ingress。                                                                                                                                                                 |

Monotonic量測維護 **63.232秒**（UTC整秒標記相差63秒）；無正式migration前中止或回退。最後停寫快照為**76舊表／19people／42checkins**；資料與來源／安全指紋全部保存，僅上述預期39結構與permission／metadata／ledger改變。新表使總數77。未還原正式DB、回灌舊快照或人工重算歷史；normal workers恢復後的正常業務寫入另計。

## 上線後驗證與未改事項

- **209項公開HTTPS回歸成功**，包含三語入口、管理員guest302／401、舊LINE／TG功能及新CSV／preview匿名拒絕；另驗實際CSV-query與既有LIFF-query兩個request log probe，`req.url='[REDACTED]'`、raw query及合成CSRF marker不入log。
- 沒有建立正式合成學員／checkin／note／award／binding／authorized admin session；沒有產生正式個資CSV或真實provider測試訊息。公開Authgear login smoke會建立一筆短暫login challenge，**不將此說成所有正式表零寫入**；無登入或授權完成。
- API／realtime active、exit0／restart0；minute新版本success／exit0、timer active。一次性health healthy、alerts0；checkpoint LINE／TG pending、sending、failed、expired leases0，epoch deliverySamples0／p50／p95／max均null，非新手機延遲驗收。
- 六個protected env／base-unit檔案byte hash、owner／group／mode及三個enabled link保持；env640。API版本override與current release為預期切換。realtime／提醒／review既有開關與個別選擇不變，WA未配置、privacy draft不變；沒有新告警排程／sink／收件人、provider Console、NTP或clocksource變更。
- 整份正常Caddyfile與原始檔**byte-identical**，owner／mode保持，其他站台不變。post-release runtime／normal-ingress／current link／manifest另站外加密、decrypt-hash並實際extract驗證。
- rehearsal unit／clone／temporary Caddy probe已停止，clone worker.env與community／realtime／achievements／export credential fixture刪除；各次私有PG資料目錄保留且未對外listen。

### 保留的非產品失敗／診斷

- 本機第一輪完整verify的3處舊schema期待值，以及TS fixture mock型別／control-regex lint修正，保留在設計紀錄；CI沒有失敗重跑。
- 部署helper產生時曾因JavaScript replacement字串把shell regex的 `$'` 當替換指令，`bash -n`拒絕；改用literal callback後syntax檢查及演練通過，未操作正式入口或DB。
- CI log取數一度未處理GitHub的literal `^[[…m` 色碼，proof拒絕；只修parser，精確四組測試數2／6／205／678才接受，未重跑CI。
- 維護前health CLI第一次漏必需的 `--since`，回 `unknown`／exit3，未證明健康也未改服務；保留失敗JSON，提供原release resume epoch後實際collection才healthy。維護後均使用新resume epoch。
- 上述不關閉舊Docker／主機時間回退或原403根因；沒有調整時鐘或鬆化安全斷言。

## 恢復界線與證據

**恢復寫入／worker處理後保留39；不退38 binary、不以任何舊快照覆蓋新寫入。** CSV／成就局部故障可在重新驗證現有配置後使用本release的achievement-only ingress hold，其餘故障保留full checkin maintenance並用matching39 fix forward。沒有39相容舊功能緊急binary；不要呼叫先前37／38部署的rollback工具，也不要盲目套用後來已變動的Caddy配置。

- 正式 `/root/qigong-deploy-afd90b5`：封閉／恢復marker、manifest與helper驗證、normal／maintenance／hold配置、backup restore／fingerprint／private-ready／health／log-redaction／protected-system證據。`ingress.py`拒絕未知source hash或live config drift。
- `/opt/qigong-platform/deployment-tools/afd90b5` 與 `/opt/qigong-platform/releases/afd90b57febd03e05a7c59d0c5e1b81ac6c25bc6`：實際驗證工具／immutable source build；API min/max39、minute與realtime皆 `ops.achievement_export_schema_ready()`／`phase-24-achievement-personal-export`。
- PG16 `/var/lib/postgresql/qigong-rehearsal-afd90b5`／socket55492已停；probe55493亦停。formal final與preparation restore資料夾均私有／不可當正式rollback。
- 站外 `~/.local/share/qigong-platform/backups/deployment-afd90b5`，key另存 `backup-keys/deployment-afd90b5.key`，不入Git／log。final38 DB／roles／runtime與post39 runtime ciphertext均驗證；preparation backup不可取代final backup，任何pre39備份在resume後都不是直接回灌方案。
- 本機 `/tmp/qigong-achievement-export-release-{prepare,regression,realtime,backup-rehearsal,activate,public,post-backup}.log` 與 `/tmp/qigong-achievement-export-release-afd90b5/`；只留受控證據、不散布正式個資。

下一步為有權管理員的新CSV介面／真IdP／手機人工驗收。檔案一旦離開服務無法因撤權追回，需依實際營運政策保管與刪除；本次沒有替未完成政策補同意，也沒有由代理自動下載正式學員名單。
