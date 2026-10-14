# LINE手機心得流（本機schema30候選）

## 範圍

使用者核准本機調整LINE rich menu `/journal`的社群心得流：手機單欄卡片、每次10筆、向下lazy load10筆，以及截至該笔練功日期的連續／累計天數。沒有commit／push／部署；主站仍0410e5f／schema29，LINE Console／rich menu／憑證、正式Telegram reminder flag與WhatsApp配置未改，policy仍draft。

「我的心得」保留20筆頁碼、sourceHash／revision、獨立草稿、發布／撤回與外部分享勾選。Telegram／WhatsApp、staff及external journal query不變。分享流程對LINE作者新增統計公開告知／發布確認文字，但不發布政策、不回填或公開舊私密原文。

## 手機呈現

每筆卡片：分享暱稱＋歷史打卡地區、練功日期、打卡提交時間、分享時間（依該筆record timezone明示IANA名稱）、🔥連續練功／⭐累計天數、功法標籤、心得原文、感受標籤。

- 單欄、窄螢幕自動換行；不用表格或真實姓名／Email／電話／LINE ID。
- 長心得先預覽160 codepoints，可展開完整snapshot；不翻譯user content，不使用innerHTML渲染動態內容。
- 地區取checkin.region_assignment_id的歷史region，而非目前primary region。
- 計數用core.practice_metrics(person,practice_date)：同日只算一次，未來日期排除；只回currentStreak與totalDays，不回person ID、逐日私密history、lastDate或longestStreak。計數依目前有效資料回算截止日期，補登可能使值改變，不是发布時永遠凍結的歷史數字。
- 聚合可能包括作者的未公開練功日期數量，但不回傳那些日期／私密心得／感受；社群仍只出現允許公開的share snapshot。LINE分享說明／我的心得與發布確認明示新增聚合欄位。

## Cursor API與可見性

新模式使用`POST /line/journal/feed`，帶原本server-verified `idToken`及`cursor:null`，返回最多10筆與`nextCursor`／`hasMore`／`snapshotAt`。下一批送完整cursor object：`snapshotAt`、`publishedAt`、publication UUID；opaque auth憑證不是cursor。

- SQL按`published_at DESC,id DESC`、候選最多11筆判斷下一批，10筆才計算aggregate，不對全部author逐筆算統計。
- 首次server upper timestamp邊界，keyset不用OFFSET；新share timestamp超過邊界不插入既有瀏覽，refresh才納入；equal timestamps以UUID排序。
- cursor strict fields／timestamp／UUID，snapshot不可在未來，30分鐘後需refresh。cursor可修改但不能授權，多數只是不同可見subset；所有批次重查viewer身份／資格／必要同意及author active／approved／active channel／未撤銷身份／active publication。
- 這不是跨請求MVCC snapshot。撤回／停用作者的新讀取會消失，已讀DOM不保證即時召回；新發布或修改publication時間可能從既有邊界離開，refresh取得現況。
- 不含cursor的舊LINE page模式仍20筆，TG／WA／staff／external endpoints／payload不增加region或統計欄位。

## 前端載入與狀態

- 初次10筆；IntersectionObserver距底300px觸發，batch追加、ID去重、同時最多一個request，fallback「再載入10筆」。
- render完成後再檢查sentinel，避免交叉事件在loading期間被忽略；初次／refresh回頂，切mine再返回feed重新取首批。
- 独立feed epoch與AbortController／15秒deadline，mode切換、reset／回打卡停止observer並abort。晚到舊response不覆蓋新頁；own editor仍busy／dirty確認。
- 網路錯誤保留已載卡片，只手動重試原cursor；auth401／403清卡片並停止讀取；400 cursor到期顯示需重新載入；底部empty／loading／retry／已看完，aria-busy與live status。

## 驗證與發布

- DB／API驗證10/10/5、equal timestamp去重、as-of25 streak／26 total、未來日期排除、private source不外洩、原地區保留、新分享upper boundary／refresh、withdraw／suspended writer、malformed／future cursor、reader identity／consent、worker denied與舊20模式。
- VM驗證追加／去重、scroll單request、render後sentinel補查、error retry相同cursor、stale abort／late response忽略、auth失效清除、refresh／observer缺少fallback、長文文字safe／展開、完成與空白、LINE限定及own／其他渠道保留。
- Chrome合成SDK／API：390、430、1280三布局通過，initial10→追加10→最後3、zero duplicate、long note無水平溢出，mine／feed可切換。不是實際LINE裝置／SDK／provider身份驗收。preview／Chrome已停止，synthetic screenshots与scripts保留於/tmp/qigong-line-stream-*。
- 29→30合成upgrade／reapply沒有新table或既有row變更，所有非metadata表hash與原community／staff／external／own／publish function definitions完全保留；新API／worker契約ready、旧29拒絕。
- API exact30，worker `ops.line_journal_stream_schema_ready()`，architecture `phase-15-line-journal-stream`。歷史0001–0029／依賴／政策文件未改。

commit／push／部署另核准，正式29快照clone／最終站外加密備份實際還原／matching API-worker後再測真人手機。30不可binary-only回29，流量後回復需對帳新寫入。既有間歇性practice identity／TG response問題有保留非敏感fixture診斷，不把rerun通過稱為已修復。
