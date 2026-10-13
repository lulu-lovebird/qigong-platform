# LINE邀請自動核准schema29部署紀錄

使用者明確核准commit、push及部署。程式`0410e5fee4ef2cf3964ab8ef4a196904a1f4e069`、CI [38351901085](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38351901085)成功／570 tests／format／lint／source typecheck／build；額外all-test tsc仍既有10錯誤。主站為exact`0029_line_invites.sql`／`phase-14-line-invites`。

## 演練與最終恢復證據

- 精確git archive、不含env／macOS metadata，Node24／frozen lockfile遠端建置及SHA256 manifest；source／dist／lockfile／歷史migration檢查。
- 正式28快照＋roles實際隔離還原至僅Unix socket55442的rehearsal；完整指紋相同、舊79825b9 API ready。
- 升級只套0029、重跑零新增；原66 application tables／11 people／13 check-ins及全部非metadata列指紋保留，新invite與redemption兩表空，沒有自動核准／同意／session／reminder／角色回填。
- compiled受限admin／Authgear verified profile與issuer-subject／grant revision／LINE-TG工作區／journal／外部分享與撤銷／brand／scoped permissions通過。
- 新compiled邀請管理頁兩語、Super session／CSRF／one-time token與列表遮蔽、server-friend前置、跨身份最後一額度並行、重試不耗額度、版本撤銷及撤銷後學員既有资格通過。Mock transport／合成身份都在隔離cluster，零正式邀請、learner或真人測試訊息。
- matching新worker含原本已啟用的Telegram reminder lane，mock驗證標準核准通知；WhatsApp沒有設定或啟用。
- 最終站外AES-256-GCM DB／roles／env-systemd逐一解密SHA256核對，roles設定重套於隔離cluster、DB解密後實際還原，指紋完全相同、舊28 API ready後才正式遷移。

## 正式切換與檢查

**2026-10-13 05:42:59–05:43:16 UTC，維護17秒。**遷移／重跑／資料比對成功後才切release symlink與API drop-in，ready再恢復timer。

- 124主站檢查＋1公開500×500 PNG驗證，共125 HTTPS checks通過；`/line/invite`200、未登入admin邀請頁302／API401、無Origin與錯誤body拒絕。
- API active／NRestarts0／ExecMainStatus0；timer active，matching新worker Resultsuccess／ExecMainStatus0。
- `ops.line_invite_schema_ready()`true，舊28 worker gate false。兩份protected env byte hash不變；Telegram提醒flag仍true、WhatsApp unconfigured、active policy0。
- 正式邀請0／redemption0，沒有自動建立發給學員的token或批量核准舊申請。
- 真實synthetic LIFF query probe API日誌req.url為`[REDACTED]`，未輸出私人日誌／token；不保證外部LINE或代理永不記錄private URL。
- LINE Console／LIFF scopes／linked OA未修改。Server friendship是mock驗證，**真人加好友驗收尚未完成**；若profile scope或正確OA關聯缺失，會fail closed，須負責人核准並確認配置。

## 使用與後續真人驗收

Super Admin可開`https://checkin.baiyinqigong.org/admin/line-invites`，建議先發1人／短期测试邀請並立即保存只顯示一次的網址。請依[line-invites](line-invites.md)驗證新LINE帳號加好友／填資料自動核准、原帳號重開不耗額度、quota滿與撤銷對新帳號阻擋、既有有效學員仍進打卡。不要以姓名／Email／電話推定原名冊身份；bearer轉傳仍可讓其他人加入。

政策仍draft，不會為測試自行發布。已pending／rejected／suspended不被邀請覆蓋。若現有已核准LINE帳號有必要同意待完成，先完成同意；普通加入仍人工審核。

## 恢復與證據

- `/root/qigong-deploy-0410e5f`
- `/opt/qigong-platform/deployment-tools/0410e5f`
- `/var/lib/postgresql/qigong-rehearsal-0410e5f`（已停止）
- 工作站`/tmp/qigong-line-invites-release-0410e5f`、release verify／CI／prepare／activate logs。
- 受限站外`backups/deployment-0410e5f`與獨立`backup-keys/deployment-0410e5f.key`，不得加入Git或輸出對話。

29→28需matching28資料庫＋79825b9 API／worker及old-release.conf，不能binary-only。開流量後回復需另核准，對帳新申請／身份／邀請額度／通知與提醒寫入；不是完整OS／Caddy災復。既有間歇性回歸診斷保留，不因本次CI與演練通過稱其根因已修復。
