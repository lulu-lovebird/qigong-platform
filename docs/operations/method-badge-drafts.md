# 獨立功法 badge 草稿：累計／連續與全新 rule 起算（本機擴充）

## 核准與狀態

使用者要求可勾選單一功法／組合，回春功30天預設累計，勾「連續」才是回春功連續30天；起始可指定或不定，並明確確認不含舊歷史、**從全新rule生效日起算**，再核准開始本機實作。

本輪擴充既有未發布40的草稿／試算工作區，**功能本機階段沒有提交、推送、部署、正式發布或發獎；使用者後續已另核准本次commit／push及直接維護發布，尚待精確SHA CI、演練與final actual restore/preservation通過後才切換，rule發布與授獎仍不開放**。保留既有本機修改；0001–0039、dependencies／lockfiles與兩份無關文件不動。正式設定／DB／Console／flags未連線或變更。發布按鈕仍disabled，publisher／activate／recalculate接口不存在。

## 規格

- 新增「功法badge」分頁及獨立draft subject `challenge`，不是修改現有49個published badge code。
- 新建時client code必須null；server產生 `challenge_<32hex>`，private唯一index保護。後續revision固定code，不能改成另一draft或現有method_huichun_30。
- 未部署0040的private draft表增加definition_code：既有rule/activity仍FK對應原definition，新challenge必須null且獨立code。core.practice_badge_definitions及person awards維持不變，沒有預先建立active badge。
- threshold預設30、範圍1–10000；continuous預設false。累計計distinct有效practice_date，連續取範圍內曾達成的最長連續曆日，不要求今天仍繼續練、不把停練當成撤銷舊獎章。
- effectiveDate是此全新rule的**預計生效日／本階段模擬值**；正式生效日與不可回填檢查由第二階段publisher負責，目前不代表rule已啟用。
- startMode=effective代表「不定（從本全新rule生效日起算）」且startDate必須null；不是全部歷史，也不以2000年或建立draft時間偷代。指定日期時startMode=date、startDate必填且不得早於effectiveDate。
- 試算實際下界為指定startDate，否則effectiveDate；以既有保存的practice_date與時區口徑計算，不重新切分舊日期。回傳effectiveDate與progressStartDate分開呈現。生效前的累計／連續段與原有rule進度不承接，舊獎章及總打卡統計不歸零。
- 功法只允許實際canonical leaf codes，至少1項、最多100項、不重複。選any為當天任一勾選子功法，選all為同日全部勾選子功法；每日最多一天。這是扁平子項集合的OR／AND，不是自由運算式或任意巢狀條件。
- 選回春功群組時，勾選當下的回春子項並存成明確code快照；ANY模式任一子項可算一天。ALL模式則需全部所選子項同日完成，介面明示，不能把群組checkbox本身送成method code。未來新增子項不自動納入。
- 不以選功法推定修過課，也不使用enrollment recorded_at猜完課日；本次起算只由rule生效日／較晚指定日決定，沒有新增課程資格或個人完課日期流程。
- 新challenge目前無活動結束日期／season deadline，preview deadline=null、數值仍為模擬；不宣稱已決定第二階段無截止badge的正式發獎／更正時點。原三伏／冬至最晚補登截止UTC＋24h不變。

## 介面

- 保留單一sidebar入口，頁內新增功法badge分頁；不加長側邊分類。
- 預設30、連續checkbox未勾；不定模式不需另填起始日，但草稿仍需填全新rule的預計生效日，讓試算基準明確。
- 模式切換時指定日期有min=effectiveDate；回不定清除指定日並送null，不默默clamp較早日期。
- 功法群組原生details預設收合、父全選／partial，無父項的獨立功法單列；以parent code分組，不以名稱猜測。checkbox及＋展開只改草稿，不自動儲存／preview／發獎。
- 繁中名稱提供建議：整組回春＋ANY為「回春功30天」，勾連續為「回春功連續30天」；手動改名後不覆蓋。English／簡中仍明確輸入、空白回退；條件摘要永遠顯示真正累計／連續、天數、ANY／ALL及起算日，不從名稱猜規則。
- 手機單欄／44px checkbox label與控制項、桌面雙欄，沿用品牌／CSP／草稿離頁保護。以text nodes顯示所有名稱，不使用HTML插入。沒有local/sessionStorage。

## 權限與驗證

沿用有效global master/super的 `achievement.manage_drafts`；preview需同一角色具備三read與現有人scope。Origin／CSRF／實際session最終重查、reason、revision／source hash、post-lock檢查、timeout／容量／cache／rate與audit界線不變。沒有新個別角色grant、raw table權限或個資CSV能力。

新增測試發現原候選0040的leaf validation中未限定的 `code` 在子查詢可能綁成內層 `m.code`，造成parent/unknown code通過。已改明確 `requested.code`，並要求method_type=leaf且無child；catalog同樣只回leaf。此候選未部署，沒有改任何歷史migration或放寬斷言。

- 新DB8使用兩位合成學員：各有生效後30日、一位連續30、一位含斷日，另有生效前紀錄及同日多功法。驗累計2人／連續1人、31日0人（不承接歷史／重複）、較晚指定日起算、單項／ANY／AND、新code及舊49 definitions／awards／checkins／jobs全指紋保存。
- 模型增加10案例：default累計、日期null／min、生效日不變、code server-owned／update不可null、連續boolean與禁止all_history模式。
- HTTP增加3案例：master/super獨立草稿create／patch／preview及forged code、parent／空方法、非法模式拒絕。
- VM增加4案例：預設UI、群組leaf-only payload／名稱建議／手動名保留、起算模式切換、未選方法不送出及不自動保存。
- 最終完整Node24 `pnpm verify` **999 tests**（API754／DB237／config2／identity6）與兩道strict gates通過，format／lint／typecheck／build皆過；這是本機驗證，未觸發本次GitHub CI。最終觸控／details樣式調整後再完整驗證同為999，非重試掩蓋失敗。
- 新Chrome13組：super/master×三語×390/1280，加viewer拒絕。24截圖、12份真正保存於隔離PG16的合成challenge draft與12次preview；手機累計／不定與桌面連續／指定日均過，無overflow／API／JS錯誤，publication始終disabled。服務結束時只新private表與24筆預期audit改變，全部business表指紋不變。

本機證據：`/tmp/qigong-method-badge-verify-final.log`、`...-browser-results.json`、`...-browser-preservation.json`、`...-cdp.log`及 `/tmp/qigong-method-badge-{role}-{locale}-{width}-{draft|preview}.png`。純合成登入／Origin adapter，應用請求轉loopback、logo離線供應，不代表正式OAuth或實體手機；provider sends0／production touched=false。preview／Chrome及專用containers完成後停止。原clock/history403與Python-UA edge差異仍未結案。

使用者已明確核准本次39→40直接維護例外；必須封鎖打卡入口、停API／雙worker、final加密備份實際還原與保存通過才升級，不能在39服務運作時直接migrate40。恢復後保留40並fix forward，不退39或覆蓋新資料；其他flags、正式個資CSV與rule發布／發獎不在本次啟用範圍。第二階段需完成immutable rule versions、正式activation、獎章／歷史／CSV版本讀取及所有評估入口，才可讓兩角色正式發布新badge。第一階段不產生任何正式新獎章。
