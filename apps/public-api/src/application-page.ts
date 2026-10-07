import { learnerTexts, type LearnerLocale, type LearnerTextKey } from './learner-locale.js';

export type LearnerPageChannel = (
  { platform: 'telegram' | 'whatsapp' } | { platform: 'line'; liffId: string }
) & { locale?: LearnerLocale };

export const pageTexts = (channel: LearnerPageChannel) =>
  channel.platform === 'line'
    ? {
        ...learnerTexts('zh_TW'),
        invalidApplication: '連結無效，請回 LINE 私聊輸入「加入」。',
        applicationConflict: '連結已過期或資料無法受理，請回 LINE 私聊輸入「加入」。',
        invalidCheckin: '請回 LINE 私聊輸入「打卡」。',
        checkinConflict: learnerTexts('zh_TW').lineConflict
      }
    : channel.platform === 'whatsapp'
      ? {
          ...learnerTexts(channel.locale ?? 'zh_TW'),
          invalidApplication:
            channel.locale === 'en'
              ? 'Invalid link. Reply join in WhatsApp for a new link.'
              : '連結無效，請回 WhatsApp 私聊輸入「加入」。',
          applicationConflict:
            channel.locale === 'en'
              ? 'Application link expired or unavailable. Reply join in WhatsApp.'
              : '申請連結過期或無法受理，請回 WhatsApp 私聊輸入「加入」。',
          invalidCheckin:
            channel.locale === 'en'
              ? 'Invalid link. Reply checkin in WhatsApp.'
              : '連結無效，請回 WhatsApp 私聊輸入「打卡」。',
          checkinConflict:
            channel.locale === 'en'
              ? 'Link expired, date already recorded or correction deadline passed. Reply checkin in WhatsApp.'
              : '連結失效、日期已打卡或更正期限已過。請回 WhatsApp 私聊輸入「打卡」。'
        }
      : learnerTexts(channel.locale ?? 'zh_TW');

export const languageSwitchScript = (platform: 'telegram' | 'whatsapp', locale: LearnerLocale) => `
    document.getElementById('languageSwitch').addEventListener('click', async () => {
      try {
        const response = await fetch('/${platform}/preferences/language', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, locale: ${JSON.stringify(locale === 'en' ? 'zh_TW' : 'en')} }) });
        if (!response.ok) throw new Error(ui.languageFailed);
        location.replace(location.pathname + ${JSON.stringify(locale === 'en' ? '' : '?lang=en')} + '#' + token);
      } catch (error) { status.textContent = ui.languageFailed; }
    });
`;

export const lineLoginScript = (liffId: string) => `
    const liffId = ${JSON.stringify(liffId).replaceAll('<', '\\u003c')};
    const loginRedirectUri = location.href;
    let idToken = '';
    const lineReady = (async () => {
      await liff.init({ liffId });
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: loginRedirectUri });
        throw new Error('正在前往 LINE 登入，請完成登入後再試。');
      }
      idToken = liff.getIDToken() || '';
      if (!idToken) throw new Error('LINE 登入尚未完成，請重新開啟頁面。');
      history.replaceState(null, '', location.pathname);
    })();
`;

export const renderApplicationPage = (channel: LearnerPageChannel) => {
  const texts = pageTexts(channel);
  const t = (key: LearnerTextKey) => texts[key];
  return `<!doctype html>
<html lang="${channel.locale === 'en' && channel.platform !== 'line' ? 'en' : 'zh-Hant'}">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow"><title>${t('applicationTitle')}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; color: #203027; background: #f8faf8; }
    main { background: white; padding: 1.5rem; border-radius: .7rem; border: 1px solid #dae5db; }
    label { display: block; margin: 1rem 0; } input, select { display: block; box-sizing: border-box; width: 100%; padding: .65rem; margin-top: .35rem; }
    button { padding: .7rem 1rem; background: #285c3b; border: 0; border-radius: .4rem; color: white; cursor: pointer; }
    button:disabled { opacity: .5; } #status { min-height: 2rem; }
    input[type="checkbox"] { display: inline; width: auto; margin-right: .5rem; }
  </style>
${channel.platform === 'line' ? '<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>' : ''}
</head>
<body>
  <main>
    <h1>${t('applicationTitle')}</h1>
    <p>${t('applicationIntro')} ${t(channel.platform === 'line' ? 'lineLink' : 'privateLink')}</p>
    ${channel.platform !== 'line' ? `<nav><button id="languageSwitch" type="button">${channel.locale === 'en' ? '繁體中文' : 'English'}</button></nav>` : ''}
    <form id="application">
      <label>${t('name')}<input name="name" autocomplete="name" maxlength="150" required></label>
      <label>${t('email')}<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
      <label>${t('phone')}<input name="phone" type="tel" autocomplete="tel" pattern="\\+[1-9][0-9]{6,14}" required></label>
      <label>${t('region')}<select name="region" required>
        <option value="">${t('selectRegion')}</option><option value="tw-general">${t('taiwan')}</option>
        <option value="my-general">${t('malaysia')}</option><option value="sg-general">${t('singapore')}</option>
        <option value="hk-general">${t('hongKong')}</option><option value="other-general">${t('other')}</option>
      </select></label>
      ${channel.platform === 'whatsapp' ? `<label><input name="notificationConsent" type="checkbox" required>${channel.locale === 'en' ? 'I agree to receive WhatsApp messages about my application decision. Reply STOP to opt out.' : '我同意透過 WhatsApp 接收申請審核結果通知；可回覆 STOP 取消。'}</label>` : ''}
      <button type="submit">${t('applyButton')}</button>
    </form>
    <p id="status" role="status" aria-live="polite"></p>
  </main>
  <footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer>
  <script>
    const token = location.hash.slice(1);
    const ui = ${JSON.stringify(texts).replaceAll('<', '\\u003c')};
    ${channel.platform === 'line' ? lineLoginScript(channel.liffId) : "history.replaceState(null, '', location.pathname);"}
    const form = document.getElementById('application');
    const status = document.getElementById('status');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      form.hidden = true; status.textContent = ui.invalidApplication;
    }
    ${
      channel.platform === 'line'
        ? `
    form.querySelector('button').disabled = true;
    lineReady.then(() => { form.querySelector('button').disabled = false; }).catch(error => { form.hidden = true; status.textContent = error.message; });`
        : ''
    }
    ${channel.platform !== 'line' ? languageSwitchScript(channel.platform, channel.locale ?? 'zh_TW') : ''}
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('button');
      button.disabled = true;
      status.textContent = ui.sending;
      const data = Object.fromEntries(new FormData(form));
      try {
        ${channel.platform === 'line' ? 'await lineReady;' : ''}
        const response = await fetch('/${channel.platform}/onboarding/apply', {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, ${channel.platform === 'line' ? 'idToken,' : ''} ...data ${channel.platform === 'whatsapp' ? `,locale: ${JSON.stringify(channel.locale ?? 'zh_TW')}, notificationConsent: data.notificationConsent === 'on'` : ''} })
        });
        if (!response.ok) throw new Error(response.status === 409 ? ui.applicationConflict : ui.applicationFailed);
        form.hidden = true;
        status.textContent = ui.applicationSent;
      } catch (error) { status.textContent = error.message; button.disabled = false; }
    });
  </script>
</body>
</html>`;
};
