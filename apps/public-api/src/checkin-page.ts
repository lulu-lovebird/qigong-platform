import { htmlLocale, languageOptions, uiTemplate, uiText } from './ui-localization.js';
import type { LearnerLocale, LearnerTextKey } from './learner-locale.js';
import { learnerPrivacyTexts } from './learner-privacy-locale.js';
import {
  lineLoginScript,
  languageSwitchScript,
  pageTexts,
  type LearnerPageChannel
} from './application-page.js';

export interface CheckinPageOptions {
  action?: string;
  field?: string;
  [key: string]: string | undefined;
}

export type CheckinPageQuery = string | URLSearchParams | CheckinPageOptions;

export const parseCheckinQuery = (query?: CheckinPageQuery): CheckinPageOptions => {
  if (!query) return {};
  if (typeof query === 'string') {
    const raw = query.startsWith('?') ? query.slice(1) : query;
    const sp = new URLSearchParams(raw);
    const result: CheckinPageOptions = {};
    for (const [k, v] of sp.entries()) result[k] = v;
    return result;
  }
  if (query instanceof URLSearchParams) {
    const result: CheckinPageOptions = {};
    for (const [k, v] of query.entries()) result[k] = v;
    return result;
  }
  return query;
};

export const isNfcTouchQuery = (query?: CheckinPageQuery): boolean => {
  const options = parseCheckinQuery(query);
  return options.action === 'nfc_touch' || Boolean(options.field);
};

const nfcTexts = (locale: LearnerLocale) => {
  if (locale === 'en') {
    return {
      title: 'Baiyin Qigong Outdoor Group Practice - Senior Large-Font Check-in Panel',
      heading: 'Baiyin Qigong Outdoor Group Practice',
      subheading: 'Senior Large-Font Check-in Panel',
      fieldLabel: '📍 Practice Field: ',
      generalField: 'Outdoor Practice Field',
      statusPreparing: 'Preparing check-in…',
      gpsHeading: 'Field Location Verification',
      gpsGuide:
        'Please allow location permission. The system will verify your proximity to the practice field to confirm attendance.',
      gpsButton: 'Allow Location & Check In',
      retryButton: 'Grant Permission & Retry',
      gpsDenied:
        'Location permission was denied. Please allow location access in your device settings to check in.',
      locating: 'Acquiring GPS location…',
      submitting: 'Location acquired, submitting check-in…',
      successHeading: 'Group Practice Check-in Successful!',
      successDesc: 'Your outdoor group practice attendance has been recorded.',
      completed: 'Check-in Completed!',
      supplementMethods: 'Supplement Today’s Practice Methods',
      manualCheckin: 'Daily Personal Practice Check-in (Methods & Journal)',
      failed: 'Group practice check-in failed. Please contact on-site volunteers.',
      gpsUnavailable: 'GPS location is currently unavailable. Please move to an open area and try again.',
      gpsTimeout: 'Location acquisition timed out. Please tap retry.'
    };
  }
  return {
    title: uiText(locale, '白雁氣功戶外團練 - 樂齡大字體簽到面板'),
    heading: uiText(locale, '白雁氣功戶外團練'),
    subheading: uiText(locale, '樂齡大字體簽到面板'),
    fieldLabel: uiText(locale, '📍 團練場地：'),
    generalField: uiText(locale, '戶外團練場地'),
    statusPreparing: uiText(locale, '正在準備打卡…'),
    gpsHeading: uiText(locale, '團練場地定位確認'),
    gpsGuide: uiText(locale, '請允許瀏覽器定位授權，系統將自動比對團練場地距離以確認您的出席。'),
    gpsButton: uiText(locale, '允許定位並自動打卡'),
    retryButton: uiText(locale, '重新授權並簽到'),
    gpsDenied: uiText(locale, '定位授權已被拒絕。請至手機或瀏覽器設定允許存取位置，方可完成現場打卡。'),
    locating: uiText(locale, '正在獲取 GPS 定位…'),
    submitting: uiText(locale, '定位成功，正在進行團練打卡…'),
    successHeading: uiText(locale, '團練簽到成功！'),
    successDesc: uiText(locale, '已成功完成今日戶外團練出席記錄。'),
    completed: uiText(locale, '簽到完成！'),
    supplementMethods: uiText(locale, '補充今日練功功法'),
    manualCheckin: uiText(locale, '一般自主練功打卡（日常功法與心得）'),
    failed: uiText(locale, '團練簽到失敗，請洽詢現場助教志工。'),
    gpsUnavailable: uiText(locale, '目前無法取得定位訊號，請至開闊處後再試一次。'),
    gpsTimeout: uiText(locale, '定位超時，請重新按下「重新授權並簽到」。')
  };
};

export const renderNfcCheckinPage = (
  channel: LearnerPageChannel,
  options: CheckinPageOptions
) => {
  const locale = channel.locale ?? 'zh_TW';
  const texts = nfcTexts(locale);
  const supplementHref =
    channel.platform === 'line' ? '/line/checkin' : '/telegram/checkin';
  const fieldCodeDisplay = options.field || texts.generalField;

  return uiTemplate(locale)`<!doctype html>
<html lang="${htmlLocale(locale)}">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow"><title>${texts.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f0fdf4; color: #0f172a; font-size: 20px; line-height: 1.6; }
    .container { max-width: 680px; margin: 0 auto; padding: 24px 16px; }
    .nfc-card { background: #ffffff; border-radius: 20px; padding: 28px 24px; border: 3px solid #166534; box-shadow: 0 10px 30px rgba(0,0,0,.1); margin-bottom: 20px; }
    h1 { font-size: 32px; color: #14532d; margin: 0 0 8px; font-weight: 800; }
    h2 { font-size: 24px; color: #0f172a; margin: 0 0 16px; font-weight: 700; }
    .nfc-subtitle { font-size: 22px; color: #15803d; font-weight: 700; margin: 0 0 16px; }
    .nfc-field-badge { background: #dcfce7; color: #14532d; font-size: 20px; font-weight: 700; padding: 12px 16px; border-radius: 12px; border: 2px solid #86efac; margin-bottom: 16px; }
    .nfc-guide-card { background: #fefce8; border: 2px solid #ca8a04; border-radius: 14px; padding: 16px; margin-bottom: 20px; font-size: 19px; color: #713f12; }
    .nfc-error-card { background: #fef2f2; border: 2px solid #dc2626; border-radius: 14px; padding: 16px; margin-top: 16px; font-size: 19px; color: #991b1b; }
    .nfc-btn { width: 100%; background: #15803d; color: #ffffff; border: 0; border-radius: 16px; padding: 20px 24px; font-size: 22px; font-weight: 800; cursor: pointer; display: block; box-sizing: border-box; text-align: center; }
    .nfc-retry-btn { width: 100%; background: #b45309; color: #ffffff; border: 0; border-radius: 14px; padding: 16px 20px; font-size: 20px; font-weight: 700; cursor: pointer; margin-top: 12px; }
    .nfc-supplement-btn { width: 100%; background: #0284c7; color: #ffffff; border: 0; border-radius: 16px; padding: 20px 24px; font-size: 22px; font-weight: 800; text-decoration: none; display: block; box-sizing: border-box; text-align: center; margin-top: 20px; }
    .nfc-checkmark-wrap { text-align: center; margin: 12px 0; }
    .nfc-checkmark { font-size: 96px; line-height: 1; color: #16a34a; font-weight: 900; display: inline-block; }
    .nfc-success-title { font-size: 30px; color: #14532d; text-align: center; margin: 8px 0; font-weight: 800; }
    .nfc-desc { font-size: 20px; color: #334155; text-align: center; margin: 0 0 16px; }
    .nfc-status { font-size: 20px; font-weight: 600; text-align: center; color: #166534; min-height: 30px; margin: 16px 0; }
    .nfc-switch-wrap { text-align: center; margin: 24px 0 12px; }
    .nfc-secondary-link { color: #15803d; font-size: 18px; font-weight: 600; text-decoration: underline; }
    nav select { font-size: 18px; padding: 8px 12px; border-radius: 8px; margin-bottom: 12px; }
    footer { color: #475569; font-size: 14px; text-align: center; padding: 24px 0; }
    @media (max-width: 480px) { .container { padding: 16px 12px; } .nfc-card { padding: 20px 16px; } h1 { font-size: 28px; } .nfc-btn, .nfc-supplement-btn { font-size: 20px; padding: 18px 20px; } }
  </style>
${channel.platform === 'line' ? '<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>' : ''}
</head>
<body><div class="container">
<nav><select id="languageSwitch" aria-label="Language">${languageOptions(locale)}</select></nav>
  <section class="nfc-card">
    <h1>${texts.heading}</h1>
    <p class="nfc-subtitle">${texts.subheading}</p>
    <div id="nfcFieldBadge" class="nfc-field-badge">${texts.fieldLabel}<span id="nfcFieldName">${fieldCodeDisplay}</span></div>
    <p id="nfcStatus" class="nfc-status" role="status" aria-live="polite">${texts.statusPreparing}</p>
  </section>
  <section id="nfcSuccessCard" class="nfc-card" hidden>
    <div class="nfc-checkmark-wrap" aria-hidden="true"><span class="nfc-checkmark">✓</span></div>
    <h2 class="nfc-success-title">${texts.successHeading}</h2>
    <p id="nfcSuccessDetail" class="nfc-desc">${texts.successDesc}</p>
    <a id="nfcSupplementLink" class="nfc-supplement-btn" href="${supplementHref}">${texts.supplementMethods}</a>
  </section>
  <section id="nfcGpsCard" class="nfc-card">
    <h2>${texts.gpsHeading}</h2>
    <div id="nfcGpsNotice" class="nfc-guide-card">
      <p class="nfc-guide-text">${texts.gpsGuide}</p>
    </div>
    <button id="nfcGpsButton" type="button" class="nfc-btn">${texts.gpsButton}</button>
    <div id="nfcGpsErrorNotice" class="nfc-error-card" hidden>
      <p id="nfcGpsErrorText" class="nfc-error-text">${texts.gpsDenied}</p>
      <button id="nfcRetryBtn" type="button" class="nfc-retry-btn">${texts.retryButton}</button>
    </div>
  </section>
  <div class="nfc-switch-wrap">
    <a id="nfcManualSwitchLink" class="nfc-secondary-link" href="${supplementHref}">${texts.manualCheckin}</a>
  </div>
  <footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer>
</div><script>
  ${
    channel.platform === 'line'
      ? lineLoginScript(channel.liffId, locale) + "\nconst token='';"
      : `const tg = ${channel.platform === 'telegram' ? 'window.Telegram?.WebApp' : 'undefined'};
  if (tg) { tg.ready(); tg.expand(); }
  const token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);`
  }
  const params = new URLSearchParams(location.search);
  const fieldCode = params.get('field') || ${JSON.stringify(options.field ?? '')};
  const status = document.getElementById('nfcStatus');
  const gpsCard = document.getElementById('nfcGpsCard');
  const successCard = document.getElementById('nfcSuccessCard');
  const gpsErrorNotice = document.getElementById('nfcGpsErrorNotice');
  const gpsErrorText = document.getElementById('nfcGpsErrorText');
  const gpsButton = document.getElementById('nfcGpsButton');
  const retryBtn = document.getElementById('nfcRetryBtn');

  const postAttendance = async (coords) => {
    status.textContent = ${JSON.stringify(texts.submitting)};
    const response = await fetch('/${channel.platform}/checkin/field', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ${channel.platform === 'line' ? 'idToken' : 'token'},
        locale: ${JSON.stringify(locale)},
        field: fieldCode,
        latitude: coords.latitude,
        longitude: coords.longitude
      })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || ${JSON.stringify(texts.failed)});
    }
    return response.json();
  };

  const onGpsSuccess = async (position) => {
    try {
      await postAttendance(position.coords);
      if (gpsCard) gpsCard.hidden = true;
      if (successCard) successCard.hidden = false;
      status.textContent = ${JSON.stringify(texts.completed)};
    } catch (error) {
      status.textContent = error.message;
      if (gpsErrorNotice) gpsErrorNotice.hidden = false;
      if (gpsErrorText) gpsErrorText.textContent = error.message;
    }
  };

  const onGpsError = (err) => {
    if (gpsErrorNotice) gpsErrorNotice.hidden = false;
    let message = ${JSON.stringify(texts.gpsDenied)};
    if (err && err.code === 2) {
      message = ${JSON.stringify(texts.gpsUnavailable)};
    } else if (err && err.code === 3) {
      message = ${JSON.stringify(texts.gpsTimeout)};
    }
    if (gpsErrorText) gpsErrorText.textContent = message;
    status.textContent = message;
  };

  const triggerGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onGpsError({ code: 2, message: ${JSON.stringify(texts.gpsUnavailable)} });
      return;
    }
    if (gpsErrorNotice) gpsErrorNotice.hidden = true;
    status.textContent = ${JSON.stringify(texts.locating)};
    navigator.geolocation.getCurrentPosition(onGpsSuccess, onGpsError, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    });
  };

  if (gpsButton) gpsButton.addEventListener('click', triggerGps);
  if (retryBtn) retryBtn.addEventListener('click', triggerGps);

  ${
    channel.platform === 'line'
      ? `lineReady.then(() => { triggerGps(); }).catch(error => { status.textContent = error.message; });`
      : `triggerGps();`
  }
  ${languageSwitchScript(channel.platform, locale)}
</script></body></html>`;
};

export const renderCheckinPage = (
  channel: LearnerPageChannel & { query?: CheckinPageQuery },
  query?: CheckinPageQuery
) => {
  const resolvedQuery = query ?? ('query' in channel ? channel.query : undefined);
  if (isNfcTouchQuery(resolvedQuery)) {
    return renderNfcCheckinPage(channel, parseCheckinQuery(resolvedQuery));
  }
  const locale = channel.locale ?? 'zh_TW';
  const texts = pageTexts(channel);
  const t = (key: LearnerTextKey) => texts[key];
  return uiTemplate(locale)`<!doctype html>
<html lang="${htmlLocale(locale)}">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow"><title>${t('checkinTitle')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f6f7fb; color: #1f2937; }
    .container { max-width: 640px; margin: 0 auto; padding: 20px; }
    .card { background: #fff; border-radius: 14px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,.08); margin-bottom: 16px; }
    h1 { font-size: 24px; margin: 0 0 8px; } h2 { font-size: 16px; margin: 0 0 12px; }
    .muted { color: #6b7280; font-size: 14px; } .hint { background: #eff6ff; color: #1d4ed8; padding: 10px 12px; border-radius: 10px; font-size: 14px; }
    .date-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 4px; border-radius: 12px; background: #f3f4f6; margin: 14px 0; }
    .date-tab { background: transparent; color: #374151; padding: 10px; border: 0; border-radius: 9px; }
    .date-tab.active { background: #0d6efd; color: white; } .date-tab.makeup.active { background: #b45309; }
    .method { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
    .method:last-child { border: 0; } .method input { width: 18px; height: 18px; }
    .method-group { border-bottom: 1px solid #f3f4f6; padding: 4px 0; }
    .method-group:last-child { border: 0; } .method-row { display: flex; align-items: center; gap: 10px; }
    .method-row .method { flex: 1; border: 0; } .child-list { margin-left: 40px; }
    .toggle-btn { width: 30px; height: 30px; border: 1px solid #d1d5db; background: white; border-radius: 8px; }
    .toggle-spacer { width: 30px; flex-shrink: 0; } .method-hint { color: #9ca3af; font-size: 12px; }
    button { cursor: pointer; font: inherit; } .action { width: 100%; background: #0d6efd; color: white; border: 0; border-radius: 12px; padding: 14px; font-weight: 600; }
    .action:disabled { background: #9ca3af; } .entry { border-top: 1px solid #f3f4f6; padding: 12px 0; }
    .entry button { background: white; border: 1px solid #0d6efd; border-radius: 8px; color: #0d6efd; padding: 6px 10px; margin-top: 8px; }
    .feelings { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; } .feelings button,.feeling-chip { border:1px solid #a5b4c8; border-radius:16px; padding:5px 10px; background:white; } .feelings button[aria-pressed="true"] { background:#dbeafe; border-color:#2563eb; } .feeling-chip { display:inline-block; margin:4px; } textarea { width:100%; min-height:100px; font:inherit; padding:10px; box-sizing:border-box; } .practice-note { white-space:pre-wrap; overflow-wrap:anywhere; }
    .status { margin: 12px 0; } footer { color: #6b7280; font-size: 12px; text-align: center; }
    @media (max-width: 480px) { .container { padding: 14px; } .card { padding: 16px; margin-bottom: 12px; } }
  </style>
${channel.platform === 'line' ? '<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>' : ''}
</head>
<body><div class="container">
<nav><select id="languageSwitch" aria-label="Language">${languageOptions(locale)}</select></nav>
  <section class="card"><h1>${t('checkinHeading')}</h1><p class="muted">${t('checkinIntro')}</p>
    <p id="stats" class="hint" hidden></p><div id="dateTabs" class="date-tabs" hidden>
      <button id="todayTab" class="date-tab active" type="button">${t('today')}</button>
      <button id="makeupTab" class="date-tab makeup" type="button">${t('yesterday')}</button></div>
    <p id="dateStatus" class="muted"></p></section>
  <form id="checkin" class="card" hidden><h2 id="formHeading">${t('methodsHeading')}</h2><div id="methods"></div>
    <section><h2>${t('noteHeading')}</h2><p>${t('feelingsLabel')}</p><div id="feelingTags" class="feelings"></div><label for="practiceNote">${t('noteLabel')}</label><textarea id="practiceNote" placeholder="${t('notePlaceholder')}" aria-describedby="noteCount notePrivacy"></textarea><p id="noteCount" class="muted" aria-live="polite"></p><p id="notePrivacy" class="muted">${t('notePrivacy')}</p><p id="reflectionPrivacy" class="muted" hidden></p></section>
    <button id="submitButton" class="action" type="submit">${t('submit')}</button></form>
  <p id="status" class="status" role="status" aria-live="polite">${t('loading')}</p>
  <section id="historyCard" class="card" hidden><h2>${t('historyHeading')}</h2><p class="muted">${t('historyIntro')}</p><div id="entries"></div></section>
  <footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer>
</div><script>
  ${
    channel.platform === 'line'
      ? lineLoginScript(channel.liffId, locale) + "\nconst token='';"
      : `const tg = ${channel.platform === 'telegram' ? 'window.Telegram?.WebApp' : 'undefined'};
  if (tg) { tg.ready(); tg.expand(); }
  const token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);`
  }
  const ui = ${JSON.stringify(texts).replaceAll('<', '\\u003c')};
  const privacyUi=${JSON.stringify(learnerPrivacyTexts(locale))};
  const format = (key, values) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), ui[key]);
  const form = document.getElementById('checkin');
  const methods = document.getElementById('methods');
  const status = document.getElementById('status');
  const dateStatus = document.getElementById('dateStatus');
  const todayTab = document.getElementById('todayTab');
  const makeupTab = document.getElementById('makeupTab');
  let historyData;
  let selectedDate = 'today';
  let editing = null;
  const practiceNote = document.getElementById('practiceNote');
  const feelings = document.getElementById('feelingTags');
  let selectedFeelings = new Set();
  const noteDrafts = new Map();
  const rememberNote = () => noteDrafts.set(selectedDate,{text:practiceNote.value,ids:[...selectedFeelings]});
  const updateNoteCount = () => document.getElementById('noteCount').textContent=format('noteLength',{count:[...practiceNote.value].length});
  practiceNote.addEventListener('input',updateNoteCount);
  const restoreNote = entry => {
    const draft=noteDrafts.get(selectedDate);
    practiceNote.value=draft?.text ?? entry?.practice_note ?? '';
    selectedFeelings=new Set(draft?.ids ?? (entry?.feeling_tags ?? []).map(tag=>tag.id));
    updateNoteCount();
  };
  const renderFeelings = () => {
    feelings.replaceChildren();
    const choices=new Map((historyData.feelingTags ?? []).map(tag=>[tag.id,tag]));
    for(const tag of checkinForDate()?.feeling_tags ?? []) choices.set(tag.id,tag);
    for(const tag of choices.values()) {
      const button=document.createElement('button');button.type='button';button.disabled=historyData.privacy?.reflectionConsent===false;button.textContent=tag.name;button.setAttribute('aria-pressed',String(selectedFeelings.has(tag.id)));
      button.addEventListener('click',()=>{if(selectedFeelings.has(tag.id))selectedFeelings.delete(tag.id);else selectedFeelings.add(tag.id);renderFeelings();});
      feelings.append(button);
    }
  };
  const post = async (route, payload) => {
    const response = await fetch('/${channel.platform}/checkin/' + route, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ${channel.platform === 'line' ? 'idToken' : 'token'}, locale: ${JSON.stringify(locale)}, ...payload })
    });
    if (!response.ok) throw new Error(response.status === 409 || response.status === 403
      ? ui.checkinConflict
      : ui.operationFailed);
    return response.json();
  };
  const checkinForDate = () => historyData.entries.find(entry => entry.practice_date === (
    selectedDate === 'today' ? historyData.today : yesterday()));
  const yesterday = () => {
    const day = new Date(historyData.today + 'T00:00:00Z');
    day.setUTCDate(day.getUTCDate() - 1);
    return day.toISOString().slice(0, 10);
  };
  const selectedMethods = () => [...form.querySelectorAll('input[name="methods"]:checked')].map(input => input.value);
  const selectMethods = codes => {
    for (const input of form.querySelectorAll('input[name="methods"]')) input.checked = codes.includes(input.value);
    updateGroups();
  };
  const updateGroups = () => {
    for (const group of methods.querySelectorAll('.method-group')) {
      const children = [...group.querySelectorAll('input[name="methods"]')];
      const parent = group.querySelector('input[name="group"]');
      parent.checked = children.every(input => input.checked);
      parent.indeterminate = !parent.checked && children.some(input => input.checked);
    }
  };
  const render = () => {
    document.getElementById('stats').hidden = false;
    document.getElementById('stats').textContent = format('stats', { streak: historyData.currentStreak, total: historyData.totalDays, zone: historyData.timezone });
    document.getElementById('dateTabs').hidden = false;
    todayTab.classList.toggle('active', selectedDate === 'today');
    makeupTab.classList.toggle('active', selectedDate === 'makeup');
    makeupTab.disabled = !historyData.makeupOpen;
    makeupTab.textContent = historyData.makeupOpen ? ui.yesterday : ui.makeupClosed;
    const existing = checkinForDate();
    practiceNote.disabled=historyData.privacy?.reflectionConsent===false;
    document.getElementById('notePrivacy').textContent=historyData.privacy?.active?privacyUi.sharing:ui.notePrivacy;
    const reflectionHint=document.getElementById('reflectionPrivacy');if(reflectionHint){reflectionHint.hidden=historyData.privacy?.reflectionConsent!==false;reflectionHint.textContent=privacyUi.reflectionRequired;}
    renderFeelings(); updateNoteCount();
    const date = selectedDate === 'today' ? historyData.today : yesterday();
    dateStatus.textContent = existing ? format('alreadyRecorded', { date }) + (existing.editable ? ui.canCorrect : '')
      : format(selectedDate === 'makeup' ? 'makeupAvailable' : 'notRecorded', { date });
    form.hidden = !!existing && editing !== existing.id;
    document.getElementById('formHeading').textContent = editing ? format('correcting', { date }) : ui.methodsHeading;
    document.getElementById('submitButton').textContent = editing ? ui.saveCorrection : format(selectedDate === 'makeup' ? 'completeMakeup' : 'completeDate', { date });
    const entries = document.getElementById('entries');
    entries.replaceChildren();
    for (const entry of historyData.entries) {
      const row = document.createElement('div'); row.className = 'entry';
      const heading = document.createElement('strong'); heading.textContent = entry.practice_date + (entry.entry_kind === 'makeup' ? ui.makeupEntry : '');
      const description = document.createElement('div'); description.textContent = entry.method_names.join('、');
      row.append(heading, description);
      for(const tag of entry.feeling_tags ?? []) { const chip=document.createElement('span');chip.className='feeling-chip';chip.textContent=tag.name;row.append(chip); }
      if(entry.practice_note) { const note=document.createElement('p');note.className='practice-note';note.textContent=entry.practice_note;row.append(note); }
      if (entry.editable) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = ui.correctMethods;
        button.addEventListener('click', () => {
          rememberNote();
          selectedDate = entry.practice_date === historyData.today ? 'today' : 'makeup';
          restoreNote(entry);
          editing = entry.id; selectMethods(entry.method_codes); render(); form.scrollIntoView({ behavior: 'smooth' });
        });
        row.append(button);
      }
      entries.append(row);
    }
    document.getElementById('historyCard').hidden = false;
    if (!historyData.entries.length) entries.textContent = ui.noHistory;
  };
  for (const [button, date] of [[todayTab, 'today'], [makeupTab, 'makeup']]) {
    button.addEventListener('click', () => {
      rememberNote(); selectedDate = date; editing = null; restoreNote(checkinForDate());
      selectMethods(checkinForDate()?.method_codes ?? []); render();
    });
  }
  const load = () => Promise.all([post('methods', {}), post('history', {})]).then(([catalog, history]) => {
    if (!catalog.methods.length) throw new Error(ui.noMethods);
    const groups = new Map();
    for (const method of catalog.methods) {
      if (method.parent_code) {
        if (!groups.has(method.parent_code)) groups.set(method.parent_code, { code: method.parent_code, name: ${locale === 'en' ? 'method.parent_name_en || method.parent_name_zh_tw' : locale === 'zh_CN' ? 'method.parent_name_zh_cn || method.parent_name_zh_tw' : 'method.parent_name_zh_tw'}, children: [] });
        groups.get(method.parent_code).children.push(method);
      }
    }
    const makeLabel = (method, name) => {
      const label = document.createElement('label'); label.className = 'method';
      const input = document.createElement('input'); input.type = 'checkbox'; input.name = name; input.value = method.code;
      label.append(input, document.createTextNode(${locale === 'en' ? 'method.name_en || method.name_zh_tw' : locale === 'zh_CN' ? 'method.name_zh_cn || method.name_zh_tw' : 'method.name_zh_tw'})); return label;
    };
    for (const method of catalog.methods) {
      if (!method.parent_code) {
        const row = document.createElement('div'); row.className = 'method-row';
        const spacer = document.createElement('span'); spacer.className = 'toggle-spacer';
        row.append(spacer, makeLabel(method, 'methods')); methods.append(row);
        continue;
      }
      const group = groups.get(method.parent_code);
      if (group.rendered) continue;
      group.rendered = true;
      const container = document.createElement('div'); container.className = 'method-group';
      const row = document.createElement('div'); row.className = 'method-row';
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'toggle-btn';
      toggle.setAttribute('aria-label', ui.expand + group.name); toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = '+';
      const parentLabel = makeLabel({ code: group.code, name_zh_tw: group.name }, 'group');
      const hint = document.createElement('span'); hint.className = 'method-hint'; hint.textContent = ui.selectGroup; parentLabel.append(hint);
      const childList = document.createElement('div'); childList.className = 'child-list'; childList.hidden = true;
      for (const child of group.children) childList.append(makeLabel(child, 'methods'));
      const parentInput = parentLabel.querySelector('input');
      parentInput.addEventListener('change', () => {
        for (const input of childList.querySelectorAll('input')) input.checked = parentInput.checked;
        updateGroups();
      });
      childList.addEventListener('change', updateGroups);
      toggle.addEventListener('click', () => {
        childList.hidden = !childList.hidden;
        toggle.textContent = childList.hidden ? '+' : '−';
        toggle.setAttribute('aria-expanded', String(!childList.hidden));
      });
      row.append(toggle, parentLabel); container.append(row, childList); methods.append(container);
    }
    updateGroups();
    historyData = history; restoreNote(checkinForDate()); status.textContent = ''; render();
  });
  ${
    channel.platform === 'line'
      ? `lineReady.then(load).catch(error => { status.textContent = error.message; });`
      : `if (!/^[A-Za-z0-9_-]{43}$/.test(token)) status.textContent = ui.invalidCheckin;
  else load().catch(error => { status.textContent = error.message; });`
  }
  ${languageSwitchScript(channel.platform, locale)}
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const selected = selectedMethods();
    if (!selected.length) { status.textContent = ui.selectAtLeastOne; return; }
    if([...practiceNote.value].length>1000) {status.textContent=ui.noteTooLong;return;}
    const noteFields=historyData.privacy?.reflectionConsent===false?{}:{practiceNote:practiceNote.value,feelingTagIds:[...selectedFeelings]};
    const button = document.getElementById('submitButton'); button.disabled = true;
    try {
      const corrected = !!editing;
      await post(corrected ? 'correct' : 'submit', corrected
        ? { checkinId: editing, methods: selected, ...noteFields }
        : { methods: selected, makeup: selectedDate === 'makeup', ...noteFields });
      historyData = await post('history', {});
      noteDrafts.delete(selectedDate); restoreNote(checkinForDate());
      editing = null; status.textContent = corrected ? ui.corrected : ui.checkedIn; render();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
</script></body></html>`;
};
