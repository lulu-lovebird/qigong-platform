# WhatsApp固定書籤與裝置登入（schema27本機候選）

> 本檔記錄schema27的實作與驗證；後續Telegram提醒已形成未發布schema28整合候選，其API／worker契約及發布範圍請見[telegram-reminders](telegram-reminders.md)。主站仍26，兩項變更均未核准部署。

## 狀態與核准範圍

本機實作完成，尚未提交、推送、部署或啟用WhatsApp。主站仍是`97de5889ceda9257825f77a35f6e0f9f61b9c83b`／schema26。Meta Business Portfolio權限、App／WABA／電話／範本及真人手機驗收仍待完成；沒有改憑證、渠道開關或發布隱私政策。

本方案是網站裝置登入，不是WhatsApp官方「連結裝置」，沒有配對碼。書籤不構成永久資格，也不延長WhatsApp service window；停止練習摘要是產品決策，不以任何未驗證的費率改動為依據。

## 學員操作

1. 在WhatsApp輸入`checkin`，開啟簽章webhook綁定本人身份後提供的15分鐘私人連結。
2. 登入區預設勾選「這是我的裝置，記住30天」，明示「共用或公共裝置請取消勾選」。仍須點擊登入，不在開頁時默默建立30天登入。
3. 勾選時登入固定720小時；取消時固定15分鐘，均不是滾動續期。
4. 登入後將`https://checkin.baiyinqigong.org/whatsapp/checkin`加入書籤。同一瀏覽器的五頁與語言切換使用cookie，不將長效憑證放入網址、JSON或瀏覽器儲存API。
5. 打卡／更正顯示網頁保存成功，不傳WhatsApp摘要。LINE／Telegram摘要與WhatsApp申請核准／拒絕通知維持原樣。
6. 「登出此裝置」先處理busy／未儲存草稿離開確認，成功後撤銷本裝置session、清cookie並重載頁面；服務失敗不謊稱已登出。
7. 到期、cookie遭清除、切換瀏覽器或資格失效後，需要回WhatsApp取得新私人連結。WhatsApp內建瀏覽器與外部瀏覽器可能有不同cookie容器；不保證跨容器或無痕模式保留登入。

已開啟的匿名書籤再導向同頁新私人fragment時會重載以讀取新連結；已登入且有草稿時保留離開確認。正常取得證明後立即清fragment，不把私人網址加入書籤。

## API與資料庫邊界

- 新增`0027_whatsapp_browser_sessions.sql`，不重寫0001–0026。`platform.whatsapp_browser_sessions`僅存SHA256 session／CSRF雜湊與身份、person、期限／撤銷資訊，強制RLS、無runtime直接表權限。沒有自動建立session、同意或核准。
- `POST /whatsapp/auth/session`：僅接受嚴格JSON `{token,remember}`、本站Origin；高熵短證明必須未到期、未交換且為checkin用途。資料庫鎖定證明及person、重查资格後一次交換。已有session cookie時回409，不默默切換身份；先登出。
- `GET /whatsapp/auth/session`：驗證雙cookie、期限、撤銷、WhatsApp身份、本人核准、active learner、active interaction channel及必要政策同意。錯誤／過期cookie會清除；暫時DB故障回503，保留cookie。
- `POST /whatsapp/auth/logout`：本站Origin、JSON、cookie與`x-whatsapp-csrf-token`，撤銷單裝置登入。關閉interaction channel、suspend person或撤銷身份也會撤銷其session；資格恢复不自動恢復舊登入。
- `__Host-qigong-whatsapp`為Secure／HttpOnly／SameSite=Lax／Path=/、無Domain；`__Host-qigong-whatsapp-csrf`同規格但可由JS讀取。Cookie API必須核對CSRF；即使有其他有效短token，也不能降級繞過cookie驗證。長session不能作為HTTP body bearer登入。
- 既有短連結API仍可在原期限內使用，不能用長session冒充短證明。workspace／journal／歷史／偏好對Cookie與原短連結都保留同一身份與版本／事後鎖定／隱私邊界。
- API日誌遮蔽cookie、URL及`x-whatsapp-csrf-token`；不保證第三方、瀏覽器或代理從未取得私人網址。
- WhatsApp practice receipt入列回NULL；保存與重試強制`receiptQueued:false`。遷移取消舊pending／sending工作，新eligibility facade拒絕WA，worker移除WA practice sender。已送出或外部接受的in-flight訊息無法保證召回。
- LINE receipt及WA申請結果sender未移除。API exact27；worker gate為`ops.whatsapp_browser_schema_ready()`，architecture為`phase-12-whatsapp-browser`；舊26契約拒絕27。

## 本機驗證

- `pnpm verify`：520 tests、無skip，格式、lint、source typecheck與build通過。
- 額外`tsc -p tsconfig.eslint.json --noEmit`仍是既有10錯誤，新檔案未增加錯誤。
- DB／HTTP／VM覆蓋期限、一次交換、雜湊、記住選項、書籤、Cookie與bearer隔離、Origin／CSRF／嚴格body、登出、服務故障、撤銷、必要同意、無摘要及worker權限。
- 合成26→27升級／重跑：所有既有表指紋保留（僅metadata及舊WA receipt取消預期不同），LINE receipt原樣、零session回填、舊API／worker gate拒絕、新gate通過；舊WA已保存request重試也回false。
- Chrome20個390／1280雙語五頁布局通過。實際cookie jar驗證HttpOnly／Secure／Lax、15分鐘／30天、短連結過期仍用書籤、保存與dirty logout確認，零sender呼叫／WA receipt。發現並修正同頁fragment不重載及手機長書籤URL溢出。
- 瀏覽器是本機合成身份、獨立資料庫、mock Meta transport；localhost adapter僅為測試將Origin轉成本網站值。Origin安全另以HTTP真route測試。這不是正式HTTPS環境、Meta驗證、手機cookie保留或訊息送達驗收。
- 合成preview與完整測試不可同時共用Postgres55440：受控角色依賴檢查會拒絕新測試DB初始化。preview停止後相關回歸及完整verify通過；不把此結果稱為舊間歇性錯誤根因已解決。

## 後續發布／恢復

提交、CI、部署與渠道啟用須另外核准。部署前須用正式26快照隔離升級／重跑、matching API／worker、備份加密／站外解密雜湊核對與實際26還原，再做正式HTTPS與真人裝置验收。不因本機測試通過而變更Meta assets或政策draft。

schema27不能binary-only回退到26。回復需matching26資料庫及`97de588`API／worker／service設定；若已開流量，須另行核准並對帳新寫入及session／通知差異。本機合成升級不是正式快照恢復演練。
