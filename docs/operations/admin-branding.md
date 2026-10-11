# Web Admin藍色系與側欄logo

**本機實作及驗證通過，已核准commit／push／同schema25部署，執行中。** 使用者核准修改管理後台以配合LINE圖文選單品牌；主站仍為83dce1e／schema25，學員頁、Bot、環境設定、資料庫與政策發布不變。

## 色碼與覆蓋

| Token     | 色碼    | 用途                                                |
| --------- | ------- | --------------------------------------------------- |
| primary   | #082850 | 主文字、主要按鈕、連結、KPI及SVG圖表文字            |
| secondary | #305888 | 選單active／hover、次文字、圖表bar、表單邊框／focus |
| accent    | #98C0D8 | 側欄連結、卡片邊框、標記、深色區focus               |
| deep      | #002048 | 側欄、危險操作／錯誤文字與框線                      |

白色、淺藍中性色保留作surface／canvas，不將低對比淺藍用於白底細字或表單邊界。brand colors集中於admin-branding.ts，已移除admin原綠色系及紅色硬編碼；危險操作以原有明確文案、粗字、加粗／虛線框及錯誤側邊線區分，不只靠色彩。

完整覆蓋總覽、排行榜、功法分析、學員申請審核、管理員授權、私密心得／快速標籤、學員資格、共享歷史、政策頁，以及獨立待審管理員portal。待審頁不使用管理導航、不新增角色或報表存取。

## Logo與安全

- 使用者指定外部PNG：https://e-qi.org/wp-content/uploads/2024/09/light-mode-logo.png。公開原圖500×500；未下載到repo、未重繪／變色／加filter，圖片自身的紅紫品牌色保留，不將其視為CSS配色。
- 管理側欄品牌文字／語言／選單上方置入logo；桌機112px、手機80px，保留正方比例及object-fit:contain。待審頁置於標題上方，仍維持獨立流程。雙語alt、明確width／height，無inline onerror script；原品牌文字在圖片不可用時仍存在。
- 四組管理HTML routes共用adminContentSecurityPolicy，僅增加`img-src`完整指定PNG URL；script／style／connect／base／form／frame原限制不變，不允許wildcard、外部script或其他圖片來源。
- 圖片referrerpolicy=no-referrer，管理頁既有no-store／no-referrer不變。遠端logo的可用性與URL內容由提供方控制；未宣稱永久可用。外部logo不是MIT原始碼授權的一部分。
- 沒有修改principalFor、capabilities、SQL／RLS、CSRF、reason／version、角色／session、hidden權限導航、dirty guard或使用者輸入渲染。

## 驗證

- 完整pnpm verify與最終樣式補SVG文字後重跑皆454項通過、無skip，格式／lint／source typecheck／build通過；額外全測試tsc仍為既有10項錯誤、無新增。新增20項品牌／對比測試，以及管理journal／tags圖片CSP整合測試；既有授權／待審／報表／policy邊界測試加上CSP精確比對。
- Chrome44組合成配置：10個後台頁＋待審頁，390px／1280px、繁中／英文；實際遠端logo在CSP下載入500px原圖、比例1:1、no-referrer，body／sidebar計算色碼正確、零JS exception或整頁橫向溢出。不是正式Authgear真人驗收，沒有存取主站資料或憑證。
- 手機總覽發現grid card的auto minimum width使表格撐大layout，補card／article min-width:0後重測；表格內overflow捲動保留，不用裁切整頁來掩蓋溢出。
- 預覽截圖及一次性preview／CDP scripts只存/tmp/qigong-admin-brand-*，使用無敏感合成資料，不提交品牌圖片或測試資料到Git。
- 不新增migration或依賴，不改package／lockfile、授權metadata；額外全測試tsc已覆核仍為既有10項錯誤，不把source typecheck通過當作該檢查乾淨。

## 後續

使用者已另核准commit／push／部署；必須先確認CI與部署檢查，不能把核准當作已完成。若部署，本批為同schema25視覺更新，需精確artifact／CI、受限API及logo CSP smoke；回退切回matching舊25API／worker，不還原DB以保留之後寫入。真人仍應核對桌機／手機、圖片失敗fallback、keyboard focus及危險操作文字，不使用正式學員資料作合成測試。
