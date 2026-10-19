# 後台分類與打卡功法收合（same39已發布）

## 核准與範圍

使用者核准本機實作：後台分類預設收合、一次只展開一類；打卡父功法預設收合，以＋／−切換子項，不變更勾選、全選、草稿或打卡規則。

使用者在本機驗證後另核准本次commit／push／deploy；正式已發布 **71b2a8b52b563f3ec28ece56cc68e04318280a59／schema39**，精確SHA CI39184093510／911 tests與215項公開HTTPS通過，維護65.163秒。詳見[發布／actual restore與恢復紀錄](collapsible-navigation-deployment.md)。前述本機階段未操作正式服務、資料庫、Cloudflare、provider Console、權限、政策或營運開關。API與雙worker仍保留既有exact39／phase24；沒有migration、dependency或lockfile變更。既有人工驗收文件增補與無關permissions-review保留，不納入本功能。

## 後台分類

- `admin-dashboard.ts` 共用shell將分類改為原生 `details/summary`，每份新頁面不帶 `open`，預設僅見分類與＋；展開後為−，可再收起。
- 原生同名details與toggle fallback共同維持一次只展開一類；忽略已收起的延遲toggle事件，避免關閉剛打開的另一類。
- 目前分類保留邊線標示、子連結保留 `aria-current`；桌面／手機現有外層導覽行為維持，resize不展開全部子分類。
- capability非同步回覆仍控制每個連結／空分類的隱藏；空或隱藏分類也收起，不因點開而取得權限。後端授權不改。
- 展開不導航、不fetch、不觸發離頁草稿veto；真正點子連結仍經原有未儲存保護。沒有新增local/sessionStorage。
- `admin-layout-styles.ts` 僅調整分類summary、＋／−、收合內容與目前分類外觀；桌面34px、手機／coarse44px及原有focus樣式保留。

## 打卡功法

目前LINE／Telegram使用 `telegram-workspace-pages.ts` 的共用editor；WhatsApp模板也由同一renderer產生，**不代表啟用WhatsApp**。舊 `checkin-page.ts` 本來已有預設收合，不另更動。

```text
＋ □ 大雁功 · 全選

− □ 大雁功 · 全選
     □ 大雁初
     □ 大雁高
```

- 有子項的群組初始 `hidden=true`／＋／`aria-expanded=false`；按鈕為 `type=button`，加上指向穩定子區塊ID的 `aria-controls`。
- 展開集合僅存目前頁面的RAM；editor重繪、今日／昨日切換及失敗重試保留手動展開狀態。新文件／重新載入重新開始收合，沒有跨登入保存；不承諾瀏覽器原生history/BFCache一定重建文件。
- 頁面profile中消失的群組會移除展開狀態；之後重新出現預設收合。
- 子checkbox仍在DOM，收合不取消或清除選取。父層全選／部分選取保持；只有leaf codes送出，不將parent code加入payload。
- 沒有子項的獨立功法維持單列，不加多餘群組／展開按鈕。方法名稱仍用text nodes，不當HTML、不依文字猜測分類。
- 只切換可見性不capture／修改draft signature或requestId，不影響native Mini App關閉確認；既有日期、timezone、idempotency、版本、資格、功法可用範圍及私密／公開心得規則不變。
- 手機／coarse的展開按鈕與標籤至少44px，子項縮排配合觸控尺寸；三語沿用既有展開／收合說明。

## 本機驗證

- Node24 fresh build、兩道CI同款strict type gate、完整 `pnpm verify` **911 tests**通過（API698／DB205／config2／identity6），format／lint／typecheck／build均過；此為提交前本機結果，正式精確SHA CI與發布另見上方紀錄。
- 新增20項測試：導覽6（含三語參數）、workspace14（含3渠道×3語參數）。涵蓋預設收合、accordion與延遲事件、capability失敗／空分類、resize／新文件、無額外fetch／草稿veto、隱藏勾選與父全選／partial、日期草稿、failed-save requestId、native離頁確認及profile群組移除。
- compiled共用shell／workspace的Chrome檢查 **25組版面／49張截圖**：後台3語×390／1280px，加手機拒絕capability1組；LINE／TG／WA模板3渠道×3語×390／1280px。原生Enter／Space、同時只開一類、手機44px、literal惡意標記文字、standalone不重複、勾選／日期／心得草稿保存及無額外API呼叫通過，無全頁overflow、前端JS錯誤或API失敗。
- 瀏覽器使用純合成API與登入SDK、假example.invalid域名；應用請求攔截至loopback，logo離線供應，其餘外部頁面請求封鎖。沿用實際admin CSP及渠道CSP，未放寬。preview沒有DB連線、沒有正式OAuth／provider登入或訊息，也沒有啟用WA。
- 三次browser harness中止分別為CDP鍵盤事件缺少文字keypress、evaluate重複全域const，以及漏mock WA既有session的GET端點。只補齊harness並保留失敗log，未改產品授權、草稿／選取斷言或忽略API錯誤；最後完整25組通過。不把模擬當實體手機驗收。
- preview／Chrome及本次使用的專用PG16測試container驗證後停止；合成證據不納入Git。既有時鐘負差與原403診斷未因此結案。

證據：`/tmp/qigong-collapsible-ui-verify.log`、`...-browser-results.json`、`...-cdp.log`及三份失敗log；截圖 `/tmp/qigong-folding-{page}-{locale}-{width}-{closed|open}.png`，另有denied手機畫面。

## 發布界線與人工驗收

本次提交／推送／部署已獲使用者另行核准，不沿用先前CSV39授權。這是same39 UI release，沒有新schema；須先通過精確SHA CI，再驗最終加密備份實際還原、舊afd90b5與新API同時39 ready及完整資料保存，受控切換matching API／雙worker。不執行migration applier、舊38 downgrade或舊snapshot回灌，不改其他營運開關。

人工驗收可檢查：新開後台各分類收合、分類互斥／鍵盤／空分類隱藏、手機外層導覽正常；新開打卡只見父項及獨立功法，＋展開、−收合，父全選與partial保持，切今日／昨日與失敗重試不丟草稿。正式帳號／IdP／實體手機與既有真實業務資料不由本輪自動操作。
