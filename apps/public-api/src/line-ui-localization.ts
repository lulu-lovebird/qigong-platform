import { uiText, uiDictionary, type Locale } from './ui-localization.js';
// Exact source-owned LINE UI phrases. Never apply this to interpolated learner content.
const english: Readonly<Record<string, string>> = {
  介面語言: 'Interface language',
  '切換語言會清除未送出的資料，確定繼續？': 'Switching language discards unsent details. Continue?',
  '語言設定失敗，請稍後再試。': 'Language could not be saved. Try again later.',
  '連結無效，請回 LINE 私聊輸入「加入」。': 'Invalid link. Send join in the LINE private chat.',
  '申請連結已過期或資料無法受理，請回 LINE 私聊輸入「加入」。':
    'The application link expired or is unavailable. Send join in the LINE private chat.',
  '請回 LINE 私聊輸入「打卡」。': 'Send checkin in the LINE private chat.',
  '白雁氣功｜氣功打卡小幫手': 'Baiyan Qigong | Qigong Assistant',
  'LINE作者對此心得流顯示已驗證的LINE暱稱，尚未取得時顯示匿名學員；其他渠道作者保留分享暱稱。卡片含練功地區、時間及截止當次日期的連續／累計統計，不公開私密原文或逐日歷史。':
    'LINE authors use their verified LINE nickname or an anonymous label. Other channels retain their sharing alias. Cards show practice region/time and streak/total as of that date, not private text or daily history.',
  '其他分享渠道／外部分享使用的暱稱（LINE心得流使用LINE暱稱）':
    'Alias for other channels/external sharing (LINE uses the verified LINE nickname)',
  '白雁氣功｜打卡小幫手入口': 'Baiyan Qigong | Check-in Assistant',
  '正在確認 LINE 身份…': 'Verifying your LINE identity…',
  '請先加入氣功打卡小幫手好友，再返回此邀請頁繼續。若頁面已關閉，請點小幫手傳來的「接續邀請」，或重新開啟原邀請連結；不必另填一般加入申請。':
    'Add the Qigong Assistant as a friend, then return here. If this page was closed, use the continuation link from the Assistant or reopen the original invitation. Do not submit a separate general application.',
  加入小幫手好友: 'Add the Assistant as a friend',
  '我已加好友，重新確認': 'I have added the Assistant — check again',
  必要隱私告知: 'Required privacy notice',
  請先閱讀: 'Please read ',
  與: ' and ',
  白雁氣功隱私政策: 'Baiyan Qigong privacy policy',
  氣功打卡小幫手補充告知: 'Qigong Assistant supplementary notice',
  '本次只處理必要同意，不代替你開啟心得分享或外部分享。':
    'This step records required consent only; it does not opt you into reflection or external sharing.',
  '我已閱讀並同意目前版本的必要隱私告知。':
    'I have read and accept the current required privacy notice.',
  同意並繼續: 'Accept and continue',
  '邀請地區：': 'Invitation region: ',
  '網站註冊 Email': 'Website registration email',
  國際格式電話: 'Phone including country code',
  姓名: 'Learner name',
  '本人填寫資料後，將依有效邀請自動核准，不需等待地區管理員。請勿轉傳邀請網址。':
    'Confirm your own details to be approved through this valid invitation without waiting for regional review. Do not forward the invitation.',
  加入並前往小幫手: 'Join and go to the Assistant',
  '進入「氣功打卡小幫手」聊天後，請點「練功打卡」。之後請從小幫手開啟打卡，關頁後方便查看同一個聊天裡的打卡回條。':
    'In the Qigong Assistant chat, choose Check-in. Open future check-ins from that chat so the saved check-in receipt is easy to find after closing the page.',
  前往打卡小幫手聊天: 'Open the Qigong Assistant chat',
  '若沒有自動切換，請按上方按鈕；仍未切換時，可改用下方聊天連結。桌面 LINE 或外部瀏覽器可能無法直接切換；請在手機 LINE 開啟，或自行切換到小幫手聊天。若已封鎖小幫手，請先解除封鎖。':
    'If the chat did not open, try the button or plain link below. Desktop LINE and external browsers may not switch automatically: use mobile LINE or open the Assistant chat yourself. Unblock the Assistant first if necessary.',
  改用連結開啟小幫手聊天: 'Open chat with the plain link',
  重新確認: 'Check again',
  'LINE 身份已失效，請重新開啟邀請網址。': 'Your LINE identity has expired. Reopen the invitation.',
  '無法確認 LINE 好友狀態，請稍後再試。': 'LINE friendship could not be verified. Try again later.',
  '接續連結已逾時或邀請已失效。請重新開啟原邀請網址；若仍無法使用，請向邀請人取得新連結。':
    'The continuation or invitation is unavailable. Reopen the original invitation, or ask for a new one.',
  '必要同意尚未完成，請重新確認。': 'Required consent is incomplete. Check again.',
  '基本資料格式不正確。': 'Check the format of your details.',
  '目前無法處理，請稍後再試。': 'This request is unavailable. Try again later.',
  已具備打卡資格: 'You are eligible to check in',
  加入成功: 'You have joined',
  '你已核准，不必重新申請。': 'You are approved; no new application is needed. ',
  '已核准加入。': 'Your membership has been approved. ',
  '已嘗試開啟小幫手聊天；若未切換，請按下方按鈕。':
    'Opening the Assistant chat was attempted. If it did not open, use the button below.',
  '請按下方按鈕，前往打卡小幫手聊天。': 'Use the button below to open the Assistant chat.',
  '請先加入好友。': 'Add the Assistant as a friend first.',
  '請先完成目前版本的必要隱私同意。': 'Accept the current required privacy notice first.',
  '你已有待審申請。請重新填寫並確認本人資料與邀請地區，提交後將依有效邀請直接核准。':
    'You have a pending application. Confirm your own details and the invitation region to be approved through this valid invitation.',
  '請填寫本人基本資料，提交後將依有效邀請直接核准。':
    'Enter your own details to be approved through this valid invitation.',
  '此申請目前無法用邀請接續，請聯絡地區管理員。':
    'This application cannot continue through an invitation. Contact your regional administrator.',
  '目前資格無法使用，請聯絡地區管理員。':
    'Access is unavailable. Contact your regional administrator.',
  '請先閱讀並勾選必要同意。': 'Read and select the required consent first.',
  '加入尚未完成，請重新確認。': 'Joining is incomplete. Check again.',
  '正在開啟 LINE 頁面，請稍候；若停留在此頁，請回 LINE 聊天重新取得連結。':
    'Opening the LINE page. If this page remains, get a new link in the LINE chat.',
  'LINE 登入未完成，已停止重複導向登入；請回 LINE 聊天重新輸入「加入」或「打卡」，使用新 LIFF 連結開啟。':
    'LINE sign-in is incomplete; repeated sign-in redirects have stopped. Get a new join or checkin link in the LINE chat.',
  '正在前往 LINE 登入，請完成登入後再試。': 'Complete LINE sign-in, then try again.',
  'LINE 登入尚未完成，請重新開啟頁面。': 'LINE sign-in is incomplete. Reopen the page.',
  '正在切換介面語言，請稍候。': 'Switching interface language. Please wait.'
};
const keys = Object.keys(english).sort((a, b) => b.length - a.length);
export const lineUiText = (locale: Locale, ownedText: string): string =>
  locale === 'en'
    ? keys.reduce((text, key) => text.replaceAll(key, english[key]!), ownedText)
    : uiText(locale, ownedText);
type Value = string | number | boolean | null | undefined;
export const lineUiTemplate =
  (locale: Locale) =>
  (parts: TemplateStringsArray, ...values: readonly Value[]): string =>
    parts
      .map((part, i) => lineUiText(locale, part) + (i < values.length ? String(values[i]) : ''))
      .join('');

export const lineBotTexts = (locale: Locale) =>
  locale === 'en'
    ? {
        title: 'Baiyan Qigong | Learner workspace',
        checkin: 'Check-in',
        ranking: 'Leaderboard',
        methods: 'Practice analysis',
        achievements: 'Achievements / calendar',
        journal: 'Shared reflections',
        continuation:
          'Continue your original invitation. Confirm your own details to be approved and start checking in:',
        follow:
          'Welcome to the Qigong Assistant. If you used an invitation, return to it and confirm your own details. Reopen the original invitation if the page was closed. Without an invitation, send join for a general application (manual review required).',
        application: 'Complete your application within 30 minutes:',
        approved: 'Approved. Send checkin to start.',
        rejected: 'Your application was not approved. Contact your regional administrator.',
        pending: 'Your application is pending review.'
      }
    : uiDictionary(locale, {
        title: '白雁氣功｜學員工作區',
        checkin: '練功打卡',
        ranking: '排行榜',
        methods: '功法分析',
        achievements: '我的成就／月曆',
        journal: '心得分享',
        continuation: '請接續原本的邀請，填寫並確認本人基本資料後即可核准、開始打卡：',
        follow:
          '歡迎加入氣功打卡小幫手！若從邀請連結加入，請返回原邀請頁，填寫本人基本資料後即可核准、開始打卡。若原頁已關閉，請重新點原邀請連結。\n沒有邀請連結者，請輸入「加入」提出一般申請（需人工審核）。',
        application: '請在 30 分鐘內填寫加入申請：',
        approved: '已核准。請輸入「打卡」開始。',
        rejected: '申請未獲核准，請聯絡所在地區管理員。',
        pending: '申請審核中，請耐心等候。'
      });
