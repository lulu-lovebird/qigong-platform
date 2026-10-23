import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { uiText, type Locale } from './ui-localization.js';

export type LineHelpImageSection = 'start' | 'daily' | 'history' | 'achievements';
export const lineHelpImages = [
  {
    file: 'line-01-menu.png',
    sha256: '4d52829027ae9809798332f7144a1fd2e0eeaab2060968f90ce73ed9c0096ec5',
    width: 1170,
    height: 790,
    section: 'start',
    title: '從LINE選單開始',
    englishTitle: 'Start from the LINE menu',
    caption: '點「練功打卡」開始；「使用說明」可回到本頁，「我的成就」可查看紀錄。',
    englishCaption:
      'Tap Practice check-in to begin, Help to return here, or My achievements to find your records.'
  },
  {
    file: 'line-02-checkin.png',
    sha256: 'd5d4155b90afdca69ce0223ed35173ced68632a30b730eafbed57d731e0b4e56',
    width: 1170,
    height: 1940,
    section: 'daily',
    title: '先確認日期與練功時區',
    englishTitle: 'Check the date and practice time zone',
    caption: '平常選「今天」；補昨天請選「昨天／補登」，是否可操作以頁面資格提示為準。',
    englishCaption:
      'Normally choose Today. For yesterday, choose Yesterday / makeup and follow the page’s eligibility message.'
  },
  {
    file: 'line-03-pick-method.png',
    sha256: '6e4c0bca31356499a36fe7a0d4c8f82d49cc5edf74e4dc926cc95c6621c775d5',
    width: 1090,
    height: 1220,
    section: 'daily',
    title: '只勾選實際練習的功法',
    englishTitle: 'Select only methods you actually practiced',
    caption: '用加號展開群組，可複選；「全選」會選取該群組全部項目，請確認符合實際練習。',
    englishCaption:
      'Expand a group with + and select multiple methods. Select all selects the entire group; check that it matches your actual practice.'
  },
  {
    file: 'line-04-feeling.png',
    sha256: 'ed57f992563f2790193e534a40adb069d0c847483244fad8f20302ee7971d2c3',
    width: 1090,
    height: 1690,
    section: 'daily',
    title: '心得可留白，再完成打卡',
    englishTitle: 'Notes are optional; complete your check-in',
    caption: '心得與感受可不填。填心得前請閱讀分享告知；不想分享請留白。最後按「完成打卡」。',
    englishCaption:
      'Notes and feelings are optional. Read the sharing notice before writing; leave notes blank if you do not want to share. Finally tap Complete check-in.'
  },
  {
    file: 'line-05-result.png',
    sha256: 'a6e228854305c3822f8a2d561cb3c37381275050858dc7f55226bf9cc5f5107a',
    width: 1030,
    height: 540,
    section: 'daily',
    title: '返回聊天查看打卡回條',
    englishTitle: 'Return to chat to see the receipt',
    caption:
      '回條顯示日期、功法及統計，不含心得或感受。回條可能延遲；請以網頁儲存結果及每月歷史確認，不用反覆提交。',
    englishCaption:
      'The receipt shows the date, methods and statistics, not notes or feelings. Delivery may be delayed; confirm the saved result or Monthly history instead of submitting repeatedly.'
  },
  {
    file: 'line-06-myachievements.png',
    sha256: 'a391749ded4fd98a03f059de54ec8a400f085474be00d2cf7feba9a14cd54bd6',
    width: 1170,
    height: 2027,
    section: 'achievements',
    title: '成就總覽只是鼓勵',
    englishTitle: 'Achievements are encouragement',
    caption: '在「我的修練」查看境界與勳章，或切到「每月歷史」。不必先研究所有勳章才能每天打卡。',
    englishCaption:
      'My practice shows levels and badges, with a Monthly history tab. You do not need to understand every badge before checking in each day.'
  },
  {
    file: 'line-07-history.png',
    sha256: '091682a9140b21f963fcad8f0aa062c73ea17260e6e31e9abf9191c4c91b6cbf',
    width: 1170,
    height: 1980,
    section: 'history',
    title: '用每月歷史查看紀錄',
    englishTitle: 'Find records in Monthly history',
    caption: '選月份查看有打卡的日期與下方逐日紀錄。截圖的日期、天數、功法及感受都只是示例。',
    englishCaption:
      'Choose a month to see recorded dates and daily details below. Dates, counts, methods and feelings in the screenshot are examples only.'
  }
] as const satisfies readonly {
  readonly file: string;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly section: LineHelpImageSection;
  readonly title: string;
  readonly englishTitle: string;
  readonly caption: string;
  readonly englishCaption: string;
}[];

export type LineHelpImage = (typeof lineHelpImages)[number];
export const lineHelpImagePath = (image: LineHelpImage): string =>
  '/line/help/images/' + image.sha256 + '/' + image.file;
export const lineHelpImageText = (image: LineHelpImage, locale: Locale) => ({
  title: locale === 'en' ? image.englishTitle : uiText(locale, image.title),
  caption: locale === 'en' ? image.englishCaption : uiText(locale, image.caption)
});
export const lineHelpImageLabels = (locale: Locale) => ({
  notice:
    locale === 'en'
      ? 'These Traditional Chinese screenshots were provided with the account owner’s consent. Dates, counts, methods and feelings are example records, not your live data. Tap an image to open its original size. For first-time enrollment, follow the written instructions below.'
      : uiText(
          locale,
          '以下繁體中文截圖經帳號本人同意提供；日期、天數、功法及感受是示例紀錄，不是你的即時資料。點圖片可另開原尺寸。首次加入請依下方文字指引。'
        ),
  open: locale === 'en' ? 'Open full-size image' : uiText(locale, '查看原尺寸圖片'),
  achievements:
    locale === 'en'
      ? 'View the achievements screen (optional)'
      : uiText(locale, '查看成就畫面（選看）')
});

export const registerLearnerHelpImages = (app: FastifyInstance): void => {
  for (const image of lineHelpImages)
    app.get(lineHelpImagePath(image), async (request, reply) => {
      reply
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff')
        .header('cross-origin-resource-policy', 'same-origin')
        .header(
          'content-security-policy',
          "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; sandbox"
        );
      try {
        const bytes = await readFile(
          new URL('../../../assets/learner-help/line/' + image.file, import.meta.url)
        );
        if (createHash('sha256').update(bytes).digest('hex') !== image.sha256)
          throw Error('Help image integrity');
        return reply.header('cache-control', 'public, max-age=3600').type('image/png').send(bytes);
      } catch {
        request.log.warn({ event: 'help_image_unavailable' });
        return reply
          .code(503)
          .header('cache-control', 'no-store')
          .send({ error: 'help_image_unavailable' });
      }
    });
};
