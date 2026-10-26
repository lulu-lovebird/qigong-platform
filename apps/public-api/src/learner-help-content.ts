import { uiText, type Locale } from './ui-localization.js';
import { localeQuery } from './learner-locale.js';
export type HelpChannel = 'line' | 'telegram' | 'whatsapp';
export interface HelpSection {
  readonly title: string;
  readonly steps: readonly string[];
}
export interface HelpFaq {
  readonly title: string;
  readonly body: string;
}
export interface LearnerHelpContent {
  readonly title: string;
  readonly intro: string;
  readonly dailyLink: string;
  readonly more: string;
  readonly start: HelpSection;
  readonly daily: HelpSection;
  readonly history: HelpSection;
  readonly sharing: string;
  readonly faqs: readonly HelpFaq[];
  readonly support: string;
  readonly privacy: string;
  readonly policyNote: string;
}
export const helpUrl = (channel: HelpChannel, locale: Locale): string =>
  'https://checkin.baiyinqigong.org/' + channel + '/help' + localeQuery(locale);
export const helpLabel = (locale: Locale): string =>
  locale === 'en' ? 'Help / getting started' : uiText(locale, '使用說明');
export const isHelpCommand = (text: string | undefined): boolean =>
  /^(?:\/?help(?:@\w+)?|說明|说明|使用說明|使用说明|幫助|帮助)\s*$/i.test(text?.trim() ?? '');

export const learnerHelpContent = (channel: HelpChannel, locale: Locale): LearnerHelpContent => {
  const english = locale === 'en';
  const start: Readonly<Record<HelpChannel, readonly string[]>> = english
    ? {
        line: [
          'Add the check-in helper as a friend. If you received an invitation, open the original invitation first; do not start another application.',
          'Read the notice and confirm your own details and region. A valid invitation can approve you directly; an ordinary application waits for a regional administrator.',
          'After approval, open Practice check-in from the helper’s menu. You do not need to understand every feature first.'
        ],
        telegram: [
          'If invited, open the original invitation URL and press Start; no invitation code needs typing. The helper sends your private form. Otherwise send /start in the helper’s private chat.',
          'Read the notice and confirm your own details. A valid invitation approves you directly in its assigned region; an ordinary application needs administrator approval. Opening a check-in page alone gives no access.',
          'After approval, tap Start check-in or send /checkin. The Mini App verifies your Telegram identity.'
        ],
        whatsapp: [
          'If invited, open the original invitation URL and press Send on the prefilled WhatsApp message; no typing is needed. The helper sends your private form. Otherwise send join.',
          'Read the notice and confirm your own details. A valid invitation approves you directly in its assigned region; ordinary applications wait for approval. Application-decision message consent is separate from reflection-sharing consent.',
          'After approval, send checkin and open the private link. Sign in before starting; use Remember me only on your own device.'
        ]
      }
    : {
        line: [
          '加入打卡小幫手好友。有收到邀請時，請先開原邀請連結，不必另填一份一般申請。',
          '依頁面閱讀告知，確認本人資料與地區。有效邀請可直接核准；一般加入申請需等待地區管理員審核。',
          '核准後，從小幫手選單開啟「練功打卡」。不用先學會所有功能。'
        ],
        telegram: [
          '有邀請請開原邀請網址並按開始，不必手填邀請碼；小幫手會傳本人專用表單。一般加入則在私人對話輸入 /start。',
          '依頁面閱讀告知並確認本人資料。有效邀請依指定地區直接核准；一般申請需管理員審核。開啟打卡頁本身不會取得打卡資格。',
          '核准後，點「開始打卡」或輸入 /checkin，Mini App會確認你的Telegram身份。'
        ],
        whatsapp: [
          '有邀請請開原網址，WhatsApp訊息已預填，按送出即可，不必打字；小幫手會傳本人專用表單。一般加入則輸入 join。',
          '閱讀告知並確認本人資料。有效邀請依指定地區直接核准；一般申請等待審核。申請結果通知與心得分享同意不同，請各自確認。',
          '核准後，輸入 checkin、開私人連結並登入；只有個人裝置才使用「記住我」。'
        ]
      };
  const daily: Readonly<Record<HelpChannel, readonly string[]>> = english
    ? {
        line: [
          'In LINE, tap Practice check-in or send 打卡 / checkin. Prefer the helper’s current LINE link.',
          'Check the practice date and select only methods you actually practiced. Notes and feeling tags are optional.',
          'Tap Complete check-in and wait for a saved message. In supported LINE browsers the page may close; a private chat receipt does not include your notes or feelings.'
        ],
        telegram: [
          'Tap Start check-in in the private bot chat, or send /checkin to open the Mini App.',
          'Check the date, choose the methods you actually practiced and tap Complete check-in. Notes and feeling tags are optional.',
          'Wait for the saved result. Supported Mini Apps may return to chat, and a private receipt may follow; do not keep submitting while waiting for delivery.'
        ],
        whatsapp: [
          'Send checkin in WhatsApp and open your own link. On a remembered personal device you may use the fixed check-in bookmark.',
          'Check the date, choose the methods you actually practiced and tap Complete check-in. Notes and feeling tags are optional.',
          'The saved record and encouragement appear on the website. After at least 3 seconds it tries to close only if no other drafts remain; if it stays open, close or go back manually. No chat summary is sent.'
        ]
      }
    : {
        line: [
          '在LINE點「練功打卡」，或輸入「打卡」／checkin，從小幫手目前提供的LINE連結開啟。',
          '確認練習日期，只勾選今天實際練習的功法。心得與感受可以不填。',
          '按「完成打卡」，等網頁確認已儲存。支援的LINE瀏覽器可能返回聊天；私人聊天回條不包含心得或感受。'
        ],
        telegram: [
          '在Bot私人對話點「開始打卡」，或輸入 /checkin 開啟Mini App。',
          '確認日期，選實際練習的功法，再按「完成打卡」。心得與感受可以不填。',
          '等網頁確認儲存。支援的Mini App可能返回聊天，私人回條可能稍後送達；等待時不用反覆提交。'
        ],
        whatsapp: [
          '在WhatsApp輸入 checkin，開啟本人連結。已記住登入的個人裝置，也可使用固定打卡書籤。',
          '確認日期，選實際練習的功法，再按「完成打卡」。心得與感受可以不填。',
          '網頁會顯示已儲存紀錄與鼓勵。至少停留3秒，沒有其他草稿才嘗試關閉；關不掉請手動關閉或返回。WhatsApp不傳聊天摘要。'
        ]
      };
  const history = english
    ? [
        channel === 'line'
          ? 'Open Achievements / calendar in the LINE menu, then choose Monthly history.'
          : channel === 'telegram'
            ? 'Open Achievements from the bot buttons, then choose Monthly history in My practice.'
            : 'Send history or menu, open My practice, then choose Monthly history.',
        'Choose a month to see recorded dates and methods. Badge names are encouragement, not a checklist you must finish before checking in.'
      ]
    : [
        channel === 'line'
          ? '在LINE選「我的成就／月曆」，進入「我的修練」後點「每月歷史」。'
          : channel === 'telegram'
            ? '從Bot按鈕開成就頁，進入「我的修練」後點「每月歷史」。'
            : '輸入 history 或 menu，開啟「我的修練」，再點「每月歷史」。',
        '選月份查看已記錄日期與功法。徽章只是鼓勵，不必先研究或完成全部徽章才能每天打卡。'
      ];
  const faqs: HelpFaq[] = english
    ? [
        {
          title: 'I forgot yesterday, or chose a wrong method',
          body: 'Choose Yesterday / makeup for yesterday’s entry, or Today to correct today. Yesterday can only be made up or corrected before noon in your confirmed practice time zone. Follow the page’s actual eligibility message; changing language does not change the deadline.'
        },
        {
          title: 'Did it save? Why is there no message?',
          body:
            channel === 'whatsapp'
              ? 'A confirmed completion record on the website means the save succeeded. No WhatsApp practice summary is sent. If the result is uncertain, retain your input and check Monthly history before making another attempt.'
              : 'Use the saved result on the website and Monthly history to confirm your record. Chat delivery can be delayed or fail independently. Do not submit repeatedly just because a receipt has not appeared.'
        },
        {
          title: 'A link expired, or I cannot sign in',
          body:
            channel === 'line'
              ? 'Return to the helper and send 打卡 / checkin for a current entry. Use the original invitation for invitation onboarding. A private application link normally lasts 30 minutes; do not forward it.'
              : channel === 'telegram'
                ? 'Return to the private bot chat and tap a current Mini App button or send /checkin. If using a private check-in link, it lasts 15 minutes; a private application link lasts 30 minutes. A permanent menu button is not a permanent authorization.'
                : 'Send checkin again for a fresh private link; it lasts 15 minutes. Application links last 30 minutes. Personal-device Remember me is a fixed 30 days, not renewed by each visit. Other browsers and private browsing may have separate cookies.'
        },
        {
          title: 'Are my notes and feelings private?',
          body:
            channel === 'whatsapp'
              ? 'Read the page’s sharing and consent information before writing. WhatsApp notes are not automatically posted to the learner community or sent as a chat summary; any explicit sharing is a separate action. Leave notes blank if you prefer.'
              : 'Notes and feelings are optional. New LINE/Telegram reflections enter the learner stream under the page’s disclosure; older private records are not automatically made public. Do not include phone numbers, email or other sensitive details.'
        },
        {
          title: 'Can I change language or use another messaging app?',
          body: 'Use the page’s language selector. A language is not a region or identity. LINE, Telegram and WhatsApp accounts and old-bot history are not automatically merged by matching names, email or phone. Contact your regional administrator before changing your regular channel.'
        },
        {
          title: 'I have unsaved changes or a badge has not updated',
          body: 'Resolve the unsaved-content prompt before leaving. A saved date does not discard another date’s draft. Badges may update later; your confirmed save and Monthly history are the record to check.'
        }
      ]
    : [
        {
          title: '昨天忘了打，或功法選錯了',
          body: '補昨天請選「昨天／補登」，改今天請選「今天」。昨天只可在已確認練功時區的中午前補登或更正，是否可操作以頁面資格提示為準；切語言不會改變期限。'
        },
        {
          title: '到底有沒有存好？怎麼沒有訊息？',
          body:
            channel === 'whatsapp'
              ? '網頁出現已確認的完成紀錄，表示本次儲存成功；WhatsApp不發練功聊天摘要。不確定時先保留輸入，查看「每月歷史」再操作。'
              : '以網頁已儲存提示與「每月歷史」確認紀錄。聊天回條可能另外延遲或失敗，不要因尚未收到回條就反覆提交。'
        },
        {
          title: '連結過期或登入不了',
          body:
            channel === 'line'
              ? '回小幫手輸入「打卡」／checkin，從新的入口開啟。有邀請請回原邀請；一般私人申請連結通常30分鐘有效，請勿轉傳。'
              : channel === 'telegram'
                ? '回Bot私人對話點目前的Mini App按鈕或輸入 /checkin。若用私人打卡連結，有效15分鐘；私人申請連結30分鐘。永久選單按鈕不等於永久資格。'
                : '重新輸入 checkin 取得15分鐘私人連結；申請連結30分鐘。個人裝置「記住我」固定30天，不會每次使用續期。不同瀏覽器或無痕模式可能不共用登入。'
        },
        {
          title: '心得與感受會給誰看？',
          body:
            channel === 'whatsapp'
              ? '填寫前請看頁面的分享與同意說明。WhatsApp心得不會自動進入學員社群，也不作聊天摘要；另外明確分享是不同操作。不想寫可以留白。'
              : '心得與感受可不填。LINE／Telegram新的心得依頁面告知進入學員心得流；既有私密紀錄不會因此自動公開。請勿寫電話、Email或敏感個資。'
        },
        {
          title: '可以切語言或換通訊軟體嗎？',
          body: '介面可切語言，但語言不是地區或身份。LINE、Telegram、WhatsApp帳號及舊bot歷史，不會因姓名、Email或電話相同就自動合併；要更換常用管道，請先聯絡地區管理員。'
        },
        {
          title: '有未存內容，或勳章沒有立即更新',
          body: '離頁前先處理未儲存提醒；存好某一天，不會替你丟掉另一天草稿。勳章可能稍後才反映，請先看已確認的儲存提示與「每月歷史」。'
        }
      ];
  if (channel === 'whatsapp')
    faqs.push(
      english
        ? {
            title: 'Personal or shared device?',
            body: 'Keep Remember me selected only on your own device. Uncheck it on a shared/public device; the short login lasts 15 minutes. Bookmark only https://checkin.baiyinqigong.org/whatsapp/checkin without a private fragment. Sign out this device when finished on a shared device.'
          }
        : {
            title: '自己的手機，還是共用裝置？',
            body: '只有個人裝置才保留「記住我」；共用或公共裝置請取消，短登入15分鐘。書籤只存 https://checkin.baiyinqigong.org/whatsapp/checkin，不要存私人片段網址。共用裝置用完請「登出此裝置」。'
          }
    );
  if (channel === 'telegram')
    faqs.push(
      english
        ? {
            title: 'Do I need reminders?',
            body: 'No. You can check in without reminders. Telegram reminders are optional; use /remind to manage them and /remind off to stop them. This help page never enables reminders or notifications for you.'
          }
        : {
            title: '一定要開提醒嗎？',
            body: '不用。沒有提醒也能打卡。Telegram提醒可自行用 /remind 管理，/remind off 停止；閱讀說明不會替你開啟提醒或通知。'
          }
    );
  const content: LearnerHelpContent = {
    title: english
      ? 'Getting started with ' +
        { line: 'LINE', telegram: 'Telegram', whatsapp: 'WhatsApp' }[channel]
      : { line: 'LINE', telegram: 'Telegram', whatsapp: 'WhatsApp' }[channel] + '使用說明',
    intro: english
      ? 'Each day: open, select your practice, and finish. Everything else can wait until you need it.'
      : '每天只要記住：開啟、勾功法、完成。其他功能，有需要再看就好。',
    dailyLink: english ? 'I want to check in today' : '今天我要打卡',
    more: english ? 'More help when you need it' : '有需要再看的說明',
    start: { title: english ? '1. First time here' : '1. 第一次使用', steps: start[channel] },
    daily: { title: english ? '2. Your daily check-in' : '2. 每天怎麼打卡', steps: daily[channel] },
    history: { title: english ? '3. Find your records' : '3. 查看自己的紀錄', steps: history },
    sharing: english
      ? 'Notes and feelings are optional. Read the sharing notice before writing; do not enter sensitive personal details.'
      : '心得與感受可以不填；填寫前先看分享告知，不要填敏感個資。',
    faqs,
    support: english
      ? 'Still stuck? Contact your regional administrator with the time, phone/browser and visible error. Do not forward private links, tokens, screenshots with contacts or reflection text.'
      : '仍有問題，請聯絡所屬地區管理員，提供時間、手機／瀏覽器與畫面錯誤。不要轉傳私人連結、憑證、含聯絡資料或心得的截圖。',
    privacy: english ? 'Privacy and consent information' : '隱私與同意說明',
    policyNote: english
      ? 'This is a usage guide, not a policy or a consent form. Reading it does not apply, approve you, record agreement or change any notification setting.'
      : '這是使用指引，不是政策或同意表。閱讀不會送出申請、核准資格、記錄同意或改變通知設定。'
  };
  // Only these source-owned guide strings are converted; no learner data enters this function.
  const own = (text: string) => uiText(locale, text);
  return {
    ...content,
    title: own(content.title),
    intro: own(content.intro),
    dailyLink: own(content.dailyLink),
    more: own(content.more),
    start: { title: own(content.start.title), steps: content.start.steps.map(own) },
    daily: { title: own(content.daily.title), steps: content.daily.steps.map(own) },
    history: { title: own(content.history.title), steps: content.history.steps.map(own) },
    sharing: own(content.sharing),
    faqs: content.faqs.map((f) => ({ title: own(f.title), body: own(f.body) })),
    support: own(content.support),
    privacy: own(content.privacy),
    policyNote: own(content.policyNote)
  };
};
