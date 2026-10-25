import { lineLoginScript } from './application-page.js';
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
      lang: resolveLocale({ lang }, cookie)
    }
  };
};
export const venuePreviewUrl = (entry: VenuePreviewEntry): string => {
  const query = new URLSearchParams({ venue: entry.venue });
  if (entry.source) query.set('source', entry.source);
  query.set('lang', entry.lang);
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
    language: '介面語言',
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
    language: '界面语言',
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
    language: 'Language',
    invalid:
      'Invalid entry parameters or missing venue code. Obtain a valid link. Attendance has NOT been recorded.'
  }
} as const;

export const renderVenuePreview = (liffId: string, entry: VenuePreviewEntry | null): string => {
  const lang = entry?.lang ?? 'zh_TW';
  const t = texts[lang];
  const canonical = entry ? venuePreviewUrl(entry) : '';
  return `<!doctype html><html lang="${htmlLocale(lang)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>${t.title}</title><style>
:root{font:125%/1.65 system-ui,sans-serif;color:#172b24;background:#f3f7f3}*{box-sizing:border-box}body{margin:0;padding:1rem}main{max-width:36rem;margin:auto}h1{font-size:1.6rem}p{overflow-wrap:anywhere}.notice{border:3px solid #725000;background:#fff5d6;padding:1rem;font-weight:700}button,a,select{font:inherit;min-height:48px}button,a{display:block;padding:.75rem;margin:1rem 0}button{width:100%;color:white;background:#195941;border:2px solid #195941;border-radius:.5rem}button:disabled{color:#404040;background:#ddd;border-color:#777}a{color:#164b83}select{max-width:100%}:focus-visible{outline:3px solid #ad5100;outline-offset:3px}footer{font-size:.8rem;overflow-wrap:anywhere;margin-top:2rem}
</style></head><body><main><h1>${t.title}</h1><p class="notice">${t.notice}</p>
${entry ? `<p>${t.venue}：<strong>${escapeHtml(entry.venue)}</strong></p><p>${t.unknown}</p><p>${t.privacy}</p><label for="preview-language">${t.language}</label><select id="preview-language" disabled>${languageOptions(lang)}</select><button id="preview-test" type="button" disabled>${t.button}</button>` : ''}
<p id="preview-status" role="status" aria-live="polite" aria-atomic="true">${entry ? t.loading : t.invalid}</p>
<a href="/line/checkin?lang=${lang}" referrerpolicy="no-referrer">${t.daily}</a>
<footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer></main>
${
  entry
    ? `<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script><script>
${lineLoginScript(liffId, lang, canonical)}
const previewText=${scriptJson(t)},previewCanonical=${scriptJson(canonical)};
const status=document.getElementById('preview-status'),button=document.getElementById('preview-test'),language=document.getElementById('preview-language');
let previewReady=false;
language.onchange=()=>{if(!previewReady)return;const next=language.value;if(!['zh_TW','zh_CN','en'].includes(next))return;const target=new URL(previewCanonical,location.href);target.searchParams.set('lang',next);location.replace(target.pathname+target.search);};
lineReady.then(()=>{previewReady=true;button.disabled=false;language.disabled=false;status.textContent=previewText.ready;}).catch(()=>{status.textContent=linePrimaryRedirect?lineLoginText.primary:previewText.loginError;});
button.onclick=()=>{
  if(!previewReady||button.disabled)return;
  if(!navigator.geolocation){status.textContent=previewText.unsupported;return;}
  button.disabled=true;language.disabled=true;status.textContent=previewText.locating;
  const finish=message=>{status.textContent=message;button.disabled=false;language.disabled=false;};
  try{navigator.geolocation.getCurrentPosition(
    ()=>finish(previewText.located),
    error=>finish(error.code===1?previewText.denied:error.code===3?previewText.timeout:previewText.unavailable),
    {enableHighAccuracy:false,timeout:10000,maximumAge:0}
  );}catch{finish(previewText.unavailable);}
};
</script>`
    : ''
}</body></html>`;
};
