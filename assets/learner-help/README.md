# LINE Help操作截圖（已部署e2441cf／同schema46）

## 來源、同意與界線

使用者提供`line-01`至`line-07`七張手機截圖，確認為本人截圖，並明確同意其中修練紀錄作為公開Help示例；本輪僅核准本機實作，不含commit、push、deploy或provider設定修改。使用者另已回報自行將Help加入LINE正式圖文選單，本輪不操作該選單。使用者後續另明確核准commit/push/deploy，已按精確SHA e2441cfbbd6290378e0aa9a3a3b07a5ac278ab63原CI39916621797/1406tests、fresh46及停寫final actual restore/preservation通過後發布；詳見[部署與快取差異](../../docs/operations/learner-help-pages.md)。

原圖留在Git專案外，未複製進repository。入庫候選均只做確定性整數座標裁切、無損PNG重新編碼及metadata移除；沒有AI重繪、縮放、改字、改日期／數字／勾選或分享告知。逐像素解碼比對證明每個輸出RGB像素等於原圖對應區域；原圖1170×2532、RGB8、sRGB，輸出保留固定sRGB色彩宣告，只有`IHDR/sRGB/IDAT/IEND`，沒有`eXIf/iTXt/pHYs`。未見姓名、電話、Email或私人token；仍有經明確同意作示例的修練統計、日期、功法及感受，不能稱為虛構資料或即時帳號資料。

此確認不改變既有軟體、品牌或第三方素材授權，不是將其他學員內容／其他截圖公開的授權，也不寫入或回填正式隱私同意、資格、修練紀錄。

## 衍生檔案

座標以原圖左上角為原點，單位為像素：`x,y,width,height`。全部七張由5,162,773 bytes降為2,548,079 bytes，無損且無重繪。

| 衍生檔（line/）            | 裁切區域          | 放置位置                               |
| -------------------------- | ----------------- | -------------------------------------- |
| line-01-menu.png           | 0,1490,1170,790   | 首次使用文字後的選單入口               |
| line-02-checkin.png        | 0,505,1170,1940   | 每日打卡：日期與時區                   |
| line-03-pick-method.png    | 40,1200,1090,1220 | 每日打卡：群組／複選／全選             |
| line-04-feeling.png        | 40,775,1090,1690  | 每日打卡：選填與完整分享告知、完成按鈕 |
| line-05-result.png         | 110,930,1030,540  | 每日打卡：僅最新成功回條               |
| line-06-myachievements.png | 0,505,1170,2027   | 進階FAQ的原生收合成就示例              |
| line-07-history.png        | 0,505,1170,1980   | 每月歷史與單日紀錄                     |

固定檔名／完整SHA256／尺寸與section白名單在`apps/public-api/src/learner-help-images.ts`，不是讓query或任意path決定檔案。路由為`/line/help/images/<完整SHA256>/<固定檔名>`；僅讀經核准的衍生圖，讀取後hash不合或缺檔回sanitized503／no-store，不暴露路徑或原錯誤。

成功圖片`image/png`、nosniff/no-referrer/CORP same-origin、嚴格CSP、public max-age3600；Help HTML仍no-store，僅LINE增加`img-src 'self'`，其他來源/script/form/frame保持禁止。若未來要求撤圖，須同步撤頁面／白名單與檔案並處理快取；來源站一小時cache並非立即失效的存取撤銷機制。正式HTTPS實測Cloudflare會將公開圖片header改為`public,max-age=14400`（4小時，HIT；PNG完整SHA與安全標頭相同），本次未改Cloudflare設定。因此**對外是4小時，不承諾1小時或即時撤回**；若需縮短edge TTL，須另行審核，不把origin值當成edge保證。

## 封裝與驗證

本次已連同七個衍生PNG封裝／逐條驗證。未來發布也必須連同根目錄`assets/learner-help/line/`衍生檔封裝，保留`apps/public-api/dist`到根目錄assets的相對路徑並讓API服務帳號唯讀；不能只複製dist。缺檔／hash不合會503，readiness不代替七條圖片路由驗證。不得把專案外原圖、工具私有state或其他下載檔一起打包。

PNG／hash／尺寸／無metadata、七固定路由、拒絕未知／錯hash／跨渠道／路徑穿越／POST、HEAD／query不反射與sanitized503在`learner-help-images.test.ts`；三語LINE HTML、安全標頭、section位置、全套buildApp圖片路由與零DB，以及非LINE保留在`learner-help.test.ts`。裁切像素證據留本機`/tmp/qigong-help-crop.mjs`及`/tmp/qigong-help-crops-{12,34,56,7}.jsonl`，原圖不作CI依賴。
