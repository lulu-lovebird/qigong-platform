import { learnerTexts, type LearnerLocale, type LearnerTextKey } from './learner-locale.js';
import { htmlLocale, languageOptions, uiTemplate, uiText } from './ui-localization.js';
import { lineUiText } from './line-ui-localization.js';

export type LearnerPageChannel = (
  { platform: 'telegram' | 'whatsapp' } | { platform: 'line'; liffId: string }
) & { locale?: LearnerLocale };

export const pageTexts = (channel: LearnerPageChannel) =>
  channel.platform === 'line'
    ? {
        ...learnerTexts(channel.locale ?? 'zh_TW'),
        invalidApplication: lineUiText(
          channel.locale ?? 'zh_TW',
          '連結無效，請回 LINE 私聊輸入「加入」。'
        ),
        applicationConflict: lineUiText(
          channel.locale ?? 'zh_TW',
          '連結已過期或資料無法受理，請回 LINE 私聊輸入「加入」。'
        ),
        invalidCheckin: lineUiText(channel.locale ?? 'zh_TW', '請回 LINE 私聊輸入「打卡」。'),
        checkinConflict: learnerTexts(channel.locale ?? 'zh_TW').lineConflict
      }
    : channel.platform === 'whatsapp'
      ? {
          ...learnerTexts(channel.locale ?? 'zh_TW'),
          invalidApplication:
            channel.locale === 'en'
              ? 'Invalid link. Reply join in WhatsApp for a new link.'
              : uiText(channel.locale ?? 'zh_TW', '連結無效，請回 WhatsApp 私聊輸入「加入」。'),
          applicationConflict:
            channel.locale === 'en'
              ? 'Application link expired or unavailable. Reply join in WhatsApp.'
              : uiText(
                  channel.locale ?? 'zh_TW',
                  '申請連結過期或無法受理，請回 WhatsApp 私聊輸入「加入」。'
                ),
          invalidCheckin:
            channel.locale === 'en'
              ? 'Invalid link. Reply checkin in WhatsApp.'
              : uiText(channel.locale ?? 'zh_TW', '連結無效，請回 WhatsApp 私聊輸入「打卡」。'),
          checkinConflict:
            channel.locale === 'en'
              ? 'Link expired, date already recorded or correction deadline passed. Reply checkin in WhatsApp.'
              : uiText(
                  channel.locale ?? 'zh_TW',
                  '連結失效、日期已打卡或更正期限已過。請回 WhatsApp 私聊輸入「打卡」。'
                )
        }
      : learnerTexts(channel.locale ?? 'zh_TW');

export const languageSwitchScript = (
  platform: 'telegram' | 'whatsapp' | 'line',
  locale: LearnerLocale
) => `
    document.getElementById('languageSwitch').addEventListener('change', async () => {
      const selector=document.getElementById('languageSwitch'),next=selector.value;
      if(!['zh_TW','zh_CN','en'].includes(next)||next===${JSON.stringify(locale)}||(document.getElementById('submitButton')?.disabled||form.querySelector('button')?.disabled)){selector.value=${JSON.stringify(locale)};return;}
      if([...new FormData(form)].some(([,value])=>String(value).trim())&&!confirm(${JSON.stringify(locale === 'en' ? 'Switching language discards unsent details. Continue?' : uiText(locale, '切換語言會清除未送出的資料，確定繼續？'))})) {selector.value=${JSON.stringify(locale)};return;}
      try {
        ${platform === 'line' ? 'await lineReady;' : ''}
        const response=await fetch('/${platform}/preferences/language',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({${platform === 'line' ? 'idToken' : 'token'},locale:next})});
        if(!response.ok)throw Error(ui.languageFailed);
        document.cookie='__Host-qigong-learner-locale='+next+'; Path=/; Max-Age=31536000; Secure; SameSite=Lax';
        location.replace(location.pathname+'?lang='+next+'#'+token);
      } catch {selector.value=${JSON.stringify(locale)};status.textContent=ui.languageFailed;}
    });
`;

export const lineLoginScript = (liffId: string, locale: LearnerLocale = 'zh_TW') => {
  const messages = {
    primary: lineUiText(
      locale,
      '正在開啟 LINE 頁面，請稍候；若停留在此頁，請回 LINE 聊天重新取得連結。'
    ),
    incomplete: lineUiText(
      locale,
      'LINE 登入未完成，已停止重複導向登入；請回 LINE 聊天重新輸入「加入」或「打卡」，使用新 LIFF 連結開啟。'
    ),
    loggingIn: lineUiText(locale, '正在前往 LINE 登入，請完成登入後再試。'),
    missing: lineUiText(locale, 'LINE 登入尚未完成，請重新開啟頁面。'),
    switching: lineUiText(locale, '正在切換介面語言，請稍候。')
  };
  return `
    const liffId = ${JSON.stringify(liffId).replaceAll('<', '\\u003c')};
    const lineInterfaceLocale=${JSON.stringify(locale)},lineLoginText=${JSON.stringify(messages)};
    let loginRedirectUri = location.href;
    const lineInitialQuery = new URLSearchParams(location.search || '');
    const linePrimaryRedirect = lineInitialQuery.has('liff.state');
    const lineLoginReturned = ['_line_login_attempt','code','error','liffClientId'].some(key => lineInitialQuery.has(key));
    const linePrivateFragment=/^#([A-Za-z0-9_-]{43})(?:[?&]|$)/.exec(location.hash||'')?.[1]||'';
    const lineLocaleCodes=['zh_TW','zh_CN','en'];
    const lineRequestedLocale=lineInitialQuery.get('lang');
    const lineSavedLocale=(document.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-qigong-learner-locale='))?.slice('__Host-qigong-learner-locale='.length);
    let idToken = '';
    const lineReady = (async () => {
      await liff.init({ liffId });
      if (linePrimaryRedirect) throw new Error(lineLoginText.primary);
      if (!liff.isLoggedIn()) {
        if ((typeof liff.isInClient === 'function' && liff.isInClient()) || lineLoginReturned)throw new Error(lineLoginText.incomplete);
        const redirect = new URL(loginRedirectUri);redirect.searchParams.set('_line_login_attempt', '1');loginRedirectUri = redirect.href;liff.login({ redirectUri: loginRedirectUri });throw new Error(lineLoginText.loggingIn);
      }
      idToken = liff.getIDToken() || '';if(!idToken)throw new Error(lineLoginText.missing);
      history.replaceState(null, '', location.pathname+(lineLocaleCodes.includes(lineRequestedLocale)?'?lang='+lineRequestedLocale:''));
      if(!lineLocaleCodes.includes(lineRequestedLocale)&&!lineLocaleCodes.includes(lineSavedLocale)){
        let preferred=null;
        try{const r=await fetch('/line/preferences/language',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({idToken})});if(r.ok){const saved=await r.json();if(lineLocaleCodes.includes(saved.locale))preferred=saved.locale;}}catch{/* Presentation preference failure never bypasses the later authenticated API. */}
        if(preferred&&preferred!==lineInterfaceLocale){location.replace(location.pathname+'?lang='+preferred+(linePrivateFragment?'#'+linePrivateFragment:''));throw new Error(lineLoginText.switching);}
      }
    })();
  `;
};

export const renderApplicationPage = (channel: LearnerPageChannel) => {
  const locale = channel.locale ?? 'zh_TW';
  const texts = pageTexts(channel);
  const t = (key: LearnerTextKey) => texts[key];
  return uiTemplate(locale)`<!doctype html>
<html lang="${htmlLocale(locale)}">
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
    <nav><label>${locale === 'en' ? 'Language' : uiText(locale, '介面語言')} <select id="languageSwitch">${languageOptions(locale)}</select></label></nav>
    <form id="application">
      <label>${t('name')}<input name="name" autocomplete="name" maxlength="150" required></label>
      <label>${t('email')}<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
      <label>${t('phone')}<input name="phone" type="tel" autocomplete="tel" pattern="\\+[1-9][0-9]{6,14}" required></label>
      <label>${t('region')}<select name="region" required>
        <option value="">${t('selectRegion')}</option><option value="tw-general">${t('taiwan')}</option>
        <option value="my-general">${t('malaysia')}</option><option value="sg-general">${t('singapore')}</option>
        <option value="hk-general">${t('hongKong')}</option><option value="other-general">${t('other')}</option>
      </select></label>
      ${channel.platform === 'whatsapp' ? `<label><input name="notificationConsent" type="checkbox" required>${channel.locale === 'en' ? 'I agree to receive WhatsApp messages about my application decision. Reply STOP to opt out.' : uiText(locale, '我同意透過 WhatsApp 接收申請審核結果通知；可回覆 STOP 取消。')}</label>` : ''}
      <button type="submit">${t('applyButton')}</button>
    </form>
    <p id="status" role="status" aria-live="polite"></p>
  </main>
  <footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer>
  <script>
    const token = location.hash.slice(1);
    const ui = ${JSON.stringify(texts).replaceAll('<', '\\u003c')};
    ${channel.platform === 'line' ? lineLoginScript(channel.liffId, channel.locale ?? 'zh_TW') : "history.replaceState(null, '', location.pathname);"}
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
    ${languageSwitchScript(channel.platform, locale)}
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
        if (!response.ok) {
          ${
            channel.platform === 'line'
              ? `
          if (response.status === 409) {
            const conflict = await response.json();
            if (conflict.error === 'line_invite_continuation_required') {
              form.hidden = true;
              status.textContent = '正在接續有效邀請，請在邀請頁確認本人資料後直接核准。';
              location.replace(${JSON.stringify('https://liff.line.me/' + encodeURIComponent(channel.liffId) + '/invite')} + (/^[A-Za-z0-9_-]{43}$/.test(conflict.resumeToken || '') ? '#' + conflict.resumeToken : ''));
              return;
            }
          }
          `
              : ''
          }
          throw new Error(response.status === 409 ? ui.applicationConflict : ui.applicationFailed);
        }
        form.hidden = true;
        status.textContent = ui.applicationSent;
      } catch (error) { status.textContent = error.message; button.disabled = false; }
    });
  </script>
</body>
</html>`;
};
