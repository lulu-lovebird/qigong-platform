# LINE已驗證暱稱schema31部署紀錄

使用者核准commit／push／部署。初版commit5278dae；隔離smoke抓到排行榜JSON文案已改但SSR仍顯示「代號遮罩」，尚未切主站即修正並補測試。**實際部署程式`fee82bab37d84bb1d0a9cde259bdc797fc1460b5`**，CI [38527337097](https://github.com/lulu-lovebird/qigong-platform/actions/runs/38527337097)成功／609 tests／格式／lint／source typecheck／build；額外all-test tsc仍既有10錯誤。

主站exact`0031_line_verified_profile_names.sql`／`phase-16-line-profile-names`。LINE同地區排行榜用verified LINE nickname、自身加（你）；LINE journal stream的LINE作者用verified name，未取得／作者缺適用必要同意則匿名學員；其他渠道share alias、staff／external原形狀不變。

## 演練與備份

- exact git archive排除env／macOS metadata、遠端Node24 frozen build與hash manifest；历史migration与依賴未改。
- 初次5278dae rehearsal／stage錯誤證據保留並停止舊clone，主站全程仍30。修正版CI與artifact重新驗證；CI watch＋prepare工具timeout中斷時只在clone有partial fixture，檢查無剩餘process後重置clone為原30dump，重新upgrade／reapply／data比對／全部smoke，不沿用partial fixture。
- 正式30 snapshot＋roles在僅Unix socket55442的隔離cluster實際還原，完整fingerprint一致、舊e2e9a4b API ready；只套0031／重跑零新增。
- 原68 application tables／11 people／14 check-ins與全部非metadata列指紋保留。新增verified cache空，不複製申請姓名、不修改identity/person/application/grants/sessions/publications，也不回填同意或角色。
- compiled受限admin／Authgear profile／grant revision／LINE-TG／journal／sharing／brand／scope與新metadataOwn／anonymous無legal fallback／name更新／缺值保留／LINE feed名稱／TG alias／client spoof denied及SSR說明修正通过。matching worker＋reminder mock通过，沒有真人測試訊息或正式profile修改。
- 最終站外AES-256-GCM DB／roles／env-systemd逐一解密SHA256核對，角色設定實際重套隔離cluster、DB解密後實際還原，完整fingerprint相同、舊30 API ready，才正式遷移。

## 正式切換

**2026-10-14 07:27:56–07:28:20 UTC，維護24秒。**migration／reapply／before-switch data compare成功再切symlink與API drop-in，ready才恢復原timer。

- 128主站＋1公開500×500 PNG共129 HTTPS checks通過；新LINE排行榜SSR／browser文案不再說代號遮罩，journal明示LINE nickname與其他渠道alias用途。
- APIactive／NRestarts0／ExecMainStatus0、timeractive、matching新worker Resultsuccess／ExecMainStatus0；ops.line_profile_schema_ready true、舊30gatefalse，exact31。
- 正式兩份env byte hash不變；Telegram reminders flag true保持、WhatsApp unconfigured、active policy0。當時cache0，沒有批量讀取學員profiles或姓名回填。
- 實際synthetic LIFF query probe API日誌req.url `[REDACTED]`，未輸出私人日誌／name／token，不保證外部平台不記錄私人URL。
- LINE Console、LIFF scope／richmenu、憑證、正式政策文件與版本未改。沒有合成正式learner/principal/admin session/client/invite、沒有真人測試發送。

## 真人名稱驗收與限制

學員需關閉舊頁、重新從LINE richmenu開排行榜／心得流。Server verify既有ID token、同一次可信回覆的name寫入本人cache，不能以body displayName或申請姓名授權。已有cache會更新；尚未回訪或provider沒給name者匿名，沒有自動批量向Messaging API取名。新加入學員導向checkin後可取名。

真人LINE name claim尚待驗收；若缺profile scope／name claim，維持匿名，不以申請姓名補上。讀取仍需要適用必要同意，不把「加入時已同意」視為自動回填同意或發布draft政策。重名不合併身份；暱稱只是顯示欄位、不變更角色或scope。

## 恢復材料

- `/root/qigong-deploy-fee82ba`與`/opt/qigong-platform/deployment-tools/fee82ba`
- `/var/lib/postgresql/qigong-rehearsal-fee82ba`（已停止），未部署的5278dae artifact／clone／smoke failure保留。
- 工作站`/tmp/qigong-line-profile-release-fee82ba`與corrected verify／CI／prepare／rehearsal／activate logs。
- 受限站外`backups/deployment-fee82ba`與獨立`backup-keys/deployment-fee82ba.key`，不得加入Git或輸出對話。

31→30需matching30 DB＋e2e9a4b API-worker与old-release.conf，不可binary-only；流量後回復另核准並對帳新資料與profile cache寫入，不保證完整OS／Caddy災復。既有間歇性回歸問題不因CI／smoke通過稱為已修復。
