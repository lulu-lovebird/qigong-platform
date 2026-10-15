# 三渠道共用badge圖示（本機，未提交部署）

使用者核准移植qigong-line-bot各badge圖示到LINE／Telegram／WhatsApp共用成就頁。這是display-only修正，**沒有migration**，API/worker exact schema34與phase19不變；不改解鎖條件、門檻、49個catalog定義、年度／lifetime語意、earned/revoked紀錄或授權。

## 圖示來源及代碼

- 原repo只讀：`qigong-line-bot/schema.sql`及`migrations/005_line_combo_badges.sql`、`008_line_method_day_badges.sql`；舊頁使用DB的emoji欄位，不是每枚badge一個PNG。
- 新`apps/public-api/src/badge-icons.ts`複製49個emoji對應，獨立共用、readonly/frozen，production與CI不依賴舊repo存在。
- 舊`seasonal_summer_27`／`seasonal_winter_27`對應平台`seasonal_summer`／`seasonal_winter`；舊6個combo無suffix，平台對應`combo_<group>_7`。這只是code alias，**不把舊規則／名稱／功法集合蓋回平台**，例如靜功全套的既有定義保留。
- 4連續、2累計、2時段、2季節、6全套、33功法天數，共49。原始設計有共用emoji（如🌱／🪷），照原樣保留，不宣稱49個全都不同的圖案。平台不同OS的emoji字形可能不同，不新增外部字型或圖片依賴。

## 共享呈現與安全

`telegram-workspace-pages.ts`是三渠道共用renderer；改成獨立36px主圖示、名稱、鎖定標記。全部仍依API badges原順序呈現，沒有依姓名／語言猜圖示。

- 有至少一筆未撤銷award：正常色彩、原earned底色與狀態文字。
- 沒有有效award（含只有revoked、尚未取得／未設定且無有效award）：保留原圖示，以grayscale／opacity淡化，加獨立🔒；只淡化裝飾圖示，不淡化名稱／規則／狀態文字。
- 狀態仍是原`awards.filter(!revoked)`邏輯。配置狀態不會抹掉過往有效獎章，歷史年份／撤銷文字保留，不造假解鎖。
- 未知／未來code用🏅，不使用🏆暗示已得獎；prototype名稱也不能讀出Object的預設屬性。圖示／鎖為aria-hidden裝飾，讀屏仍有badge名稱與原本的文字狀態。
- DOM全部用textContent／安全節點，code只存dataset，無innerHTML、供應商API／asset network request。鎖與圖示不成為認證或授權依據。

## 驗證

- 完整`pnpm verify`通過**684項**（API497／DB179／config2／identity6）、format/lint/source typecheck/build。
- 新badge-icons3項：49個舊圖示逐一一致、code aliases／catalog集合完整、Unicode grapheme完整／readonly與安全fallback。reference fixture保存在平台，不讓CI讀取sibling repo。
- 既有完整HTML/scripts VM fixture新增6項：LINE繁中、TG與WA中英各49枚、earned/locked/revoked-only/unconfigured無有效award狀態、unknown/prototype code及不可信名稱安全顯示。WA走synthetic cookie-session bootstrap，沒有啟用正式WA服務。
- 真HTTP/DB成就報表的49個code與共用圖示表完全相符，原combo撤銷／修正測試保留通過；沒有更動DB/API回覆欄位。
- actual Chrome390／1280共10layouts，每頁49張卡：code→圖示逐一比對、normal/grayscale/opacity與獨立鎖、zero card/page overflow及runtime exception。LINE繁中／TG-WA中英、全部provider/backend synthetic，不是真人device或WhatsApp交付驗收。
- Browser driver最初在換頁時可能把上一頁的49張卡當成新頁ready，下一次讀取遇新頁空DOM；已改成每次先等about:blank完成，再導航與等待49卡，10layouts全部通過。這是test driver同步修正，不是產品／解鎖邏輯修復。
- 證據`/tmp/qigong-badge-icons-{verify,all-types}.log`、preview/cdp scripts與10張截圖。preview/Chrome已停；專用隔離PG16 `qigong-badge-ui-test`／loopback55455驗證完成後停止，原共享測試叢集未動。不宣稱修復既有共用叢集flakiness；額外test-inclusive tsc仍10個既有錯誤，沒有新增。

## 發布限制

尚未commit/push/deploy。正式仍9d00120／schema34，notify flags／env／policy／所有歷史紀錄不變。若核准發布，走same-schema34的exact SHA CI與matching API-worker，不新增0035、不為圖示更新DB或重新算獎章；同schema回退可以matching9d00120 API-worker切換，不還原DB／覆蓋新寫入。實際發布流程與備份仍需另核准。

舊qigong-line-bot原有dirty docs／.DS_Store等未動；平台untracked `docs/operations/web-admin-permissions-review.md`繼續排除。
