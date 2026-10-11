# LINE圖文選單與打卡後返回聊天

## 新官方帳號六格選單

使用者確認自行製作／設定圖文選單；本批不透過API發布／變更任何rich menu，不動舊官方帳號。品牌以白雁氣功／氣功打卡小幫手為主。可用三欄兩列大尺寸模板，聊天選單名稱「功能選單」。

以下LIFF ID從主站公開頁面核對，為公開app識別碼，不是secret或access token；若更換部署app，必須重新核對，不拿這個ID作身份授權。

| 格位 | 標籤       | 動作     | 值                                                       |
| ---- | ---------- | -------- | -------------------------------------------------------- |
| 上左 | 練功打卡   | URL      | https://liff.line.me/2011968988-42BgF96N/checkin         |
| 上中 | 排行榜     | URL      | https://liff.line.me/2011968988-42BgF96N/leaderboard     |
| 上右 | 功法分析   | URL      | https://liff.line.me/2011968988-42BgF96N/method-analysis |
| 下左 | 成就／月曆 | URL      | https://liff.line.me/2011968988-42BgF96N/achievements    |
| 下中 | 心得分享   | URL      | https://liff.line.me/2011968988-42BgF96N/journal         |
| 下右 | 加入／申請 | 文字訊息 | 加入                                                     |

- LIFF Endpoint仍為`https://checkin.baiyinqigong.org/line/`，保留openid與同Provider／正確官方帳號連結。LIFF URL後綴由SDK primary／secondary redirect處理，不新增信任任意liff.state的伺服器redirect。
- 加入／申請不是固定URL：Chatbot需要在簽章後建立本人短效私人申請連結，不直接指定沒有token的`/line/apply`。不把申請token、idToken或身份ID放入圖文選單。
- 未核准學員點其他格仍須經過資料庫本人／資格檢查；圖文選單不是授權。Developing下測試帳號要有Login channel對應測試權限，不是只有Messaging channel權限。
- 隱私／使用說明仍可私訊「隱私」閱讀；政策目前draft，圖文選單設定不發布政策或讓舊紀錄自動分享。

## 返回聊天修復（候選，待部署）

- 原因：衍生LINE工作區移除了TG SDK，但仍使用TG initData／close guard，沒有呼叫LIFF closeWindow；Bot工作區回覆是一般HTTPS，亦不保證在真正LIFF browser開啟。
- 修復LINE工作區：確認server成功儲存後才呼叫`liff.closeWindow()`，且必須`liff.isInClient()`、SDK bridge可用、所有日期與時區都沒有其他實際未存草稿。先解除writing／busy與beforeunload guard，不等待profile刷新或聊天摘要送達，不呼叫sendMessages／sendData重發摘要。
- 另一天／時區草稿存在時留開；LIFF內提供手動「返回聊天」，有dirty時先確認，取消不丟內容。closeWindow缺少或throw時恢復正常頁面流程；失敗儲存不關閉。
- 普通瀏覽器／外部登入不強制window.close，手動返回按鈕隱藏；TG與WA保留原有行為。舊聊天中的一般HTTPS連結不會被追溯修改，需重新私訊「打卡」或使用新圖文選單的LIFF URL測試。
- Bot五個工作區連結從實際LINE_LIFF_ID動態產生，不把部署ID或憑證寫死在程式。加入／政策的短效私人連結與驗證流程不變。
- 本機完整`pnpm verify` **433項通過、無skip**；新增測試涵蓋commit前不close、commit後只close一次且不refresh、409保留、外部瀏覽器、bridge缺少／throw、另一天／時區草稿及手動確認，signed commands回configured LIFF五個入口。這是合成DOM／mock provider驗證，不是LINE Android／iOS真實bridge證明。
- 不新增migration；仍exact25。同schema UI修復回退應切回matching舊25 API／worker，不還原DB，以保留後續寫入。主站修復部署及真人重測結果另記錄；已存在的間歇性授權錯誤仍未宣稱修復。

## 真人重測

1. 修復部署後，從LINE圖文選單或新收到的LIFF連結開啟「練功打卡」，確認正確頁面及登入身份；不要使用舊普通HTTPS訊息或Chrome測自動關閉。
2. 選功法並儲存，確認回到原聊天、私人摘要只一筆且沒有心得／感受；只有API成功不表示裝置已收到摘要。
3. 先改另一日期的草稿，再儲存目前日期，確認不自動關閉、未存草稿仍在；手動返回確認的取消／同意都測。
4. 若仍未關閉，提供裝置／LINE版本／開啟方式及時間，保留SDK isInClient／bridge可用性的非敏感布林資訊；不貼URL fragment、idToken、cookie或私人內容。圖文選單管理者自行保留舊menu設定，以便操作回退。
