import { lineLoginScript } from './application-page.js';
import { venueDebugLabel, venueDebugVenueCode } from './venue-debug.js';
import {
  htmlLocale,
  isLocale,
  languageOptions,
  resolveLocale,
  type Locale
} from './ui-localization.js';

export interface VenuePreviewEntry {
  venue: string;
  source?: 'nfc' | 'qr' | 'link';
  lang: Locale;
  explicitLang?: boolean;
}
type PreviewRequest =
  { kind: 'none' } | { kind: 'invalid' } | { kind: 'preview'; entry: VenuePreviewEntry };
const path = '/line/venue-checkin';
const callbackKeys = new Set([
  '_line_login_attempt',
  'code',
  'state',
  'error',
  'error_description',
  'liffClientId',
  'liffRedirectUri'
]);
const applicationKeys = new Set(['venue', 'source', 'lang']);
const uniqueAllowed = (query: URLSearchParams, allowed: ReadonlySet<string>) =>
  [...query.keys()].every((key) => allowed.has(key) && query.getAll(key).length === 1);

// Never redirect to liff.state on the server. Only select this renderer for the exact
// appended LIFF path; the official SDK still owns primary -> secondary navigation.
export const venuePreviewRequest = (rawUrl: string, cookie?: string): PreviewRequest => {
  const url = new URL(rawUrl, 'https://preview.invalid');
  const direct = url.pathname === path;
  const states = url.searchParams.getAll('liff.state');
  const candidate = states.find((state) => /^\/venue-checkin(?:[?/#]|$)/.test(state));
  if (!direct && !candidate) return { kind: 'none' };
  if (rawUrl.length > 8192) return { kind: 'invalid' };
  let query = url.searchParams;
  if (states.length) {
    if (
      states.length !== 1 ||
      !candidate ||
      candidate.length > 512 ||
      !uniqueAllowed(query, new Set(['liff.state', ...callbackKeys])) ||
      !/^\/venue-checkin(?:\?[^#]*)?$/.test(candidate)
    )
      return { kind: 'invalid' };
    query = new URL(candidate, 'https://preview.invalid').searchParams;
    if (!uniqueAllowed(query, applicationKeys)) return { kind: 'invalid' };
  } else if (!uniqueAllowed(query, new Set([...applicationKeys, ...callbackKeys]))) {
    return { kind: 'invalid' };
  }
  const venue = query.get('venue');
  const source = query.get('source');
  const lang = query.get('lang');
  if (
    !venue ||
    venue.length > 64 ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(venue) ||
    (source !== null && source !== 'nfc' && source !== 'qr' && source !== 'link') ||
    (lang !== null && !isLocale(lang))
  )
    return { kind: 'invalid' };
  return {
    kind: 'preview',
    entry: {
      venue,
      ...(source === null ? {} : { source }),
      lang: resolveLocale({ lang }, cookie),
      explicitLang: lang !== null
    }
  };
};
export const venuePreviewUrl = (entry: VenuePreviewEntry): string => {
  const query = new URLSearchParams({ venue: entry.venue });
  if (entry.source) query.set('source', entry.source);
  if (entry.explicitLang !== false) query.set('lang', entry.lang);
  return path + '?' + query.toString();
};
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char
  );
const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
const texts = {
  zh_TW: {
    title: '團練入口預覽',
    notice: '測試預覽，尚未記錄出席',
    venue: '場地代碼',
    unknown: '尚無可信場地資料，無法確認場地名稱、時段或是否在場。',
    privacy:
      '只有按下按鈕才會請求定位。原始位置僅當次處理，不儲存、不傳送。靜態 NFC／QR／連結可轉傳，來源標記僅供分析，並非防偽或出席證明。',
    button: '確認位置並測試',
    ready: 'LINE 初始化完成，可開始定位測試；這不是學員資格或場地驗證。',
    loading: '正在初始化 LINE，請稍候。',
    loginError:
      'LINE 登入未完成或初始化失敗。請重新開啟原 LIFF 連結；若仍失敗，請回 LINE 聊天重試。尚未記錄出席。',
    locating: '正在取得定位，請稍候。',
    located: '定位已取得，但未經後端場地驗證。這只是測試，尚未記錄出席。',
    denied: '您未允許定位。請在裝置設定允許後再試；尚未記錄出席。',
    timeout: '定位逾時，請稍後再試；尚未記錄出席。',
    unavailable: '目前無法取得定位，請確認裝置設定後再試；尚未記錄出席。',
    unsupported: '此瀏覽器不支援定位，請換用支援定位的瀏覽器；尚未記錄出席。',
    daily: '記錄今天功法與感受',
    history: '查看我的團練紀錄',
    language: '介面語言',
    languageFailed: '語言偏好未儲存。請稍後重新選擇語言重試。',
    invalid: '入口參數無效或缺少場地代碼。請重新取得正確連結；尚未記錄出席。'
  },
  zh_CN: {
    title: '团练入口预览',
    notice: '测试预览，尚未记录出席',
    venue: '场地代码',
    unknown: '尚无可信场地资料，无法确认场地名称、时段或是否在场。',
    privacy:
      '只有按下按钮才会请求定位。原始位置仅当次处理，不储存、不传送。静态 NFC／QR／链接可转发，来源标记仅供分析，并非防伪或出席证明。',
    button: '确认位置并测试',
    ready: 'LINE 初始化完成，可开始定位测试；这不是学员资格或场地验证。',
    loading: '正在初始化 LINE，请稍候。',
    loginError:
      'LINE 登录未完成或初始化失败。请重新打开原 LIFF 链接；若仍失败，请回 LINE 聊天重试。尚未记录出席。',
    locating: '正在取得定位，请稍候。',
    located: '定位已取得，但未经后端场地验证。这只是测试，尚未记录出席。',
    denied: '您未允许定位。请在设备设置允许后再试；尚未记录出席。',
    timeout: '定位超时，请稍后再试；尚未记录出席。',
    unavailable: '目前无法取得定位，请确认设备设置后再试；尚未记录出席。',
    unsupported: '此浏览器不支持定位，请换用支持定位的浏览器；尚未记录出席。',
    daily: '记录今天功法与感受',
    history: '查看我的团练记录',
    language: '界面语言',
    languageFailed: '语言偏好未保存。请稍后重新选择语言重试。',
    invalid: '入口参数无效或缺少场地代码。请重新取得正确链接；尚未记录出席。'
  },
  en: {
    title: 'Group practice entry preview',
    notice: 'Test preview — attendance has NOT been recorded',
    venue: 'Venue code',
    unknown:
      'No trusted venue lookup is available. Venue name, schedule and presence are unverified.',
    privacy:
      'Location is requested only when you press the button. Raw location is handled only for this attempt, never stored or sent. Static NFC/QR/links can be forwarded; source is an analytics label, not proof of authenticity or attendance.',
    button: 'Check location and test',
    ready:
      'LINE initialization completed. You can test location; learner eligibility and venue are not verified.',
    loading: 'Initializing LINE. Please wait.',
    loginError:
      'LINE login or initialization failed. Reopen the original LIFF link or return to LINE chat to retry. Attendance has NOT been recorded.',
    locating: 'Getting location. Please wait.',
    located:
      'Location acquired, but NOT verified against a venue by the backend. Test only — attendance has NOT been recorded.',
    denied:
      'Location permission denied. Allow location in device settings and retry. Attendance has NOT been recorded.',
    timeout: 'Location timed out. Please retry. Attendance has NOT been recorded.',
    unavailable:
      'Location unavailable. Check device settings and retry. Attendance has NOT been recorded.',
    unsupported:
      'This browser does not support location. Use a supported browser. Attendance has NOT been recorded.',
    daily: 'Record today’s practice and reflections',
    history: 'View my group practice history',
    language: 'Language',
    languageFailed: 'Language preference was not saved. Select the language again to retry.',
    invalid:
      'Invalid entry parameters or missing venue code. Obtain a valid link. Attendance has NOT been recorded.'
  }
} as const;

const checkinTexts = {
  zh_TW: {
    title: '團練場簽到',
    notice: '正式出席簽到：送出後由後端驗證並記錄',
    unknown:
      '請在場地開放時段、定位半徑內簽到。簽到獨立於日課，同人同場當地日期一次，跨場正常累計。',
    privacy:
      '按下按鈕才取得並傳送本次位置供後端驗證；不保存原始 GPS、不寫入網址或紀錄。QR 可轉傳，GPS 不是防偽證明。',
    button: '確認位置並簽到',
    ready: 'LINE 初始化完成；後端仍會驗證身份、同意、場地與位置。',
    sending: '正在驗證並記錄出席，請稍候。',
    success: '出席已記錄',
    retry: '無法確認結果，可能已記錄。請重試；同人同場同日不會重複計次。',
    outside_radius: '位置不在場地半徑內，請在現場重試。',
    outside_window: '目前不是場地開放時段。',
    rejected: '簽到未完成。請確認學員資格及最新隱私同意，或回 LINE 聊天辦理。'
  },
  zh_CN: {
    title: '团练场签到',
    notice: '正式出席签到：提交后由后端验证并记录',
    unknown:
      '请在场地开放时段、定位半径内签到。签到独立于日课，同人同场当地日期一次，跨场正常累计。',
    privacy:
      '按下按钮才获取并传送本次位置供后端验证；不保存原始 GPS、不写入网址或日志。QR 可转发，GPS 不是防伪证明。',
    button: '确认位置并签到',
    ready: 'LINE 初始化完成；后端仍会验证身份、同意、场地与位置。',
    sending: '正在验证并记录出席，请稍候。',
    success: '出席已记录',
    retry: '无法确认结果，可能已记录。请重试；同人同场同日不会重复计次。',
    outside_radius: '位置不在场地半径内，请在现场重试。',
    outside_window: '目前不是场地开放时段。',
    rejected: '签到未完成。请确认学员资格及最新隐私同意，或回 LINE 聊天办理。'
  },
  en: {
    title: 'Venue attendance',
    notice: 'Live check-in: the server verifies and records attendance',
    unknown:
      'Check in within the venue radius and opening hours. Attendance is separate from daily practice: once per person, venue and local date; visits to other venues count normally.',
    privacy:
      'Pressing the button sends this attempt’s location for server validation. Raw GPS is not stored, logged or put in URLs. QR links can be forwarded; GPS is not proof against impersonation.',
    button: 'Confirm location and check in',
    ready: 'LINE initialized. The server still checks identity, consent, venue and location.',
    sending: 'Verifying and recording attendance. Please wait.',
    success: 'Attendance recorded',
    retry:
      'Result unknown; attendance may already be recorded. Retry safely: the same venue and local date will not count twice.',
    outside_radius: 'Outside the venue radius. Retry on site.',
    outside_window: 'The venue is outside its opening hours.',
    rejected:
      'Check-in was not completed. Confirm learner eligibility and current privacy consent, or return to LINE chat.'
  }
} as const;

export const renderVenuePreview = (
  liffId: string,
  entry: VenuePreviewEntry | null,
  mode: 'preview' | 'checkin' = 'preview',
  historyEnabled = false,
  debugEnabled = false
): string => {
  const lang = entry?.lang ?? 'zh_TW';
  const live = mode === 'checkin';
  const debugAvailable = live && debugEnabled && entry?.venue === venueDebugVenueCode;
  const t = live ? { ...texts[lang], ...checkinTexts[lang] } : texts[lang];
  const canonical = entry ? venuePreviewUrl(entry) : '';
  const historyHref = /^[A-Za-z0-9-]{1,100}$/.test(liffId)
    ? `https://liff.line.me/${encodeURIComponent(liffId)}/venue-history?lang=${lang}`
    : `/line/venue-history?lang=${lang}`;
  return `<!doctype html><html lang="${htmlLocale(lang)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>${t.title}</title><style>
:root{font:125%/1.65 system-ui,sans-serif;color:#172b24;background:#f3f7f3}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;padding:1rem}main{max-width:36rem;margin:auto}h1{font-size:1.6rem}p{overflow-wrap:anywhere}.notice{border:3px solid #725000;background:#fff5d6;padding:1rem;font-weight:700}button,a,select{font:inherit;min-height:48px}button,a{display:block;padding:.75rem;margin:1rem 0}button{width:100%;color:white;background:#195941;border:2px solid #195941;border-radius:.5rem}button:disabled{color:#404040;background:#ddd;border-color:#777}a{color:#164b83}select{max-width:100%}:focus-visible{outline:3px solid #ad5100;outline-offset:3px}footer{font-size:.8rem;overflow-wrap:anywhere;margin-top:2rem}
</style></head><body><main><h1>${t.title}</h1><p class="notice">${t.notice}</p>
${entry ? `<p>${t.venue}：<strong>${escapeHtml(entry.venue)}</strong></p><p>${t.unknown}</p><p>${t.privacy}</p><label for="preview-language">${t.language}</label><select id="preview-language" disabled>${languageOptions(lang)}</select><button id="preview-test" type="button" disabled>${t.button}</button>` : ''}
${debugAvailable ? `<details><summary>${venueDebugLabel}</summary><p>僅豁免距離；仍需真實 GPS、身份、同意與開放時段。測試碼限人工輸入，僅當次記憶體使用，不放入網址或儲存。</p><label><input id="preview-debug-enabled" type="checkbox">使用異地測試</label><label for="preview-debug-token">短效測試碼</label><input id="preview-debug-token" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="256"></details>` : ''}
<p id="preview-status" role="status" aria-live="polite" aria-atomic="true">${entry ? t.loading : t.invalid}</p>
${live && entry && historyEnabled ? `<a id="preview-history" href="${escapeHtml(historyHref)}" referrerpolicy="no-referrer" hidden>${t.history}</a>` : ''}
<a href="/line/checkin?lang=${lang}" referrerpolicy="no-referrer">${t.daily}</a>
<footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer></main>
${
  entry
    ? `<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script><script>
${lineLoginScript(liffId, lang, canonical, { explicitLocale: entry.explicitLang === false ? null : lang })}
const previewText=${scriptJson(t)},previewCanonical=${scriptJson(canonical)},previewInitial=${scriptJson(entry)};
const status=document.getElementById('preview-status'),button=document.getElementById('preview-test'),language=document.getElementById('preview-language');
let previewReady=false,previewBusy=false,previewCompleted=false;
${
  debugAvailable
    ? `const debugToggle=document.getElementById('preview-debug-enabled'),debugInput=document.getElementById('preview-debug-token');
let debugToken='';
const clearDebug=(reset=false)=>{debugToken='';debugInput.value='';if(reset)debugToggle.checked=false;};
globalThis.addEventListener?.('pagehide',()=>clearDebug(true));`
    : 'const clearDebug=()=>{};'
}
const controls=()=>{button.disabled=previewBusy||!previewReady||previewCompleted;language.disabled=previewBusy||!previewReady;${debugAvailable ? 'debugToggle.disabled=debugInput.disabled=previewBusy||!previewReady||previewCompleted;' : ''}};
const invalidate=()=>{previewReady=false;idToken='';clearDebug(true);status.textContent=previewText.loginError;};
const currentCredential=()=>{try{const currentToken=liff.getIDToken()||'';if(liff.isLoggedIn()&&currentToken)return currentToken;}catch{/* SDK failure never authorizes a request. */}invalidate();return '';};
language.onchange=async()=>{
  const next=language.value;
  if(!previewReady||previewBusy||!['zh_TW','zh_CN','en'].includes(next)||next===previewInitial.lang){language.value=previewInitial.lang;return;}
  previewBusy=true;clearDebug(true);controls();
  let navigating=false;
  try{
    const currentToken=currentCredential();if(!currentToken){language.value=previewInitial.lang;return;}
    const response=await fetch('/line/preferences/language',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:currentToken,locale:next})});
    if(response.status===401){invalidate();language.value=previewInitial.lang;return;}
    if(!response.ok)throw new Error('language');
    document.cookie='__Host-qigong-learner-locale='+next+'; Path=/; Max-Age=31536000; Secure; SameSite=Lax';
    const target=new URL(previewCanonical,location.href);target.searchParams.set('lang',next);
    status.textContent=lineLoginText.switching;
    location.replace(target.pathname+target.search);navigating=true;
  }catch{language.value=previewInitial.lang;status.textContent=previewText.languageFailed;}finally{if(!navigating){previewBusy=false;controls();}}
};
lineReady.then(()=>{previewReady=true;controls();status.textContent=previewText.ready;}).catch(error=>{if(error?.message===lineLoginText.switching){previewBusy=true;clearDebug();status.textContent=lineLoginText.switching;}else status.textContent=linePrimaryRedirect?lineLoginText.primary:previewText.loginError;controls();});
controls();
button.onclick=()=>{
  if(!previewReady||previewBusy||previewCompleted||button.disabled)return;
  if(!currentCredential()){controls();return;}
  if(!navigator.geolocation){status.textContent=previewText.unsupported;return;}
  ${
    debugAvailable
      ? `const testing=debugToggle.checked;debugToken=testing?debugInput.value:'';debugInput.value='';
  if(testing&&(debugToken.length<32||debugToken.length>256)){clearDebug();status.textContent='測試碼無效、已到期或測試未開啟；未完成簽到。';return;}`
      : 'const testing=false;'
  }
  previewBusy=true;controls();status.textContent=previewText.locating;
  const finish=message=>{status.textContent=message;previewBusy=false;clearDebug();controls();};
  try{navigator.geolocation.getCurrentPosition(
    ${
      live
        ? `async position=>{
      status.textContent=previewText.sending;
      try {
        const currentToken=currentCredential();if(!currentToken){finish(previewText.loginError);return;}
        const response=await fetch('/api/line/venue-checkin',{
          method:'POST',cache:'no-store',credentials:'omit',redirect:'error',
          headers:{'content-type':'application/json','x-venue-checkin':'1'${debugAvailable ? ",...(testing?{'X-Venue-Debug-Token':debugToken}:{})" : ''}},
          body:JSON.stringify({idToken:currentToken,venue:${scriptJson(entry?.venue)},latitude:position.coords.latitude,longitude:position.coords.longitude})
        });
        if(response.status===401){invalidate();finish(previewText.loginError);return;}
        const data=await response.json();
        if(!response.ok||data.ok!==true){
          finish(data.error==='venue_debug_denied'?'測試碼無效、已到期或測試未開啟；未完成簽到。':response.status>=500?previewText.retry:data.error==='outside_radius'?previewText.outside_radius:data.error==='outside_window'?previewText.outside_window:previewText.rejected);return;
        }
        if((testing?(data.isTest!==true||data.verificationMode!=='distance_debug'):(data.isTest!==undefined||data.verificationMode!==undefined)))throw new Error('invalid result mode');
        if(!data.venue||typeof data.venue.name!=='string'||typeof data.checkedInAt!=='string'||typeof data.venue.timezone!=='string')throw new Error('invalid result');
        const time=new Intl.DateTimeFormat(${scriptJson(htmlLocale(lang))},{timeZone:data.venue.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(data.checkedInAt));
        status.textContent=(data.isTest===true?${scriptJson(venueDebugLabel)}:previewText.success)+' — '+data.venue.name+' / '+time+' ('+data.venue.timezone+'). '+previewText.daily;
        ${historyEnabled ? "document.getElementById('preview-history').hidden=false;" : ''}
        clearDebug();previewCompleted=true;previewBusy=false;controls();
      }catch{finish(previewText.retry);}
    }`
        : '()=>finish(previewText.located)'
    },
    error=>finish(error.code===1?previewText.denied:error.code===3?previewText.timeout:previewText.unavailable),
    {enableHighAccuracy:false,timeout:10000,maximumAge:0}
  );}catch{finish(previewText.unavailable);}
};
</script>`
    : ''
}</body></html>`;
};
