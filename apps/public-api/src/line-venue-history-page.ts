import { lineLoginScript } from './application-page.js';
import { venueDebugLabel } from './venue-debug.js';
import {
  htmlLocale,
  isLocale,
  languageOptions,
  resolveLocale,
  type Locale
} from './ui-localization.js';

export interface VenueHistoryEntry {
  readonly lang: Locale;
  // Resolved presentation locale is not evidence of an explicit query parameter.
  // Optional for compatibility with callers constructing an already-localized entry.
  readonly explicitLang?: boolean;
  readonly month?: string;
  readonly venue?: string;
  readonly page?: number;
}
export interface VenueHistoryPageConfig {
  readonly liffId: string;
  readonly entry: VenueHistoryEntry | null;
}
export type VenueHistoryRequest =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'history'; readonly entry: VenueHistoryEntry };
const path = '/line/venue-history';
const applicationKeys = new Set(['month', 'venue', 'page', 'lang']);
const callbackKeys = new Set([
  '_line_login_attempt',
  'code',
  'state',
  'error',
  'error_description',
  'liffClientId',
  'liffRedirectUri'
]);
const uniqueAllowed = (query: URLSearchParams, allowed: ReadonlySet<string>) =>
  [...query.keys()].every((key) => allowed.has(key) && query.getAll(key).length === 1);
const validMonth = (value: string) => /^(?!0000)[0-9]{4}-(?:0[1-9]|1[0-2])$/.test(value);
const validVenue = (value: string) =>
  value.length <= 64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(value);

// Routing discriminator only. Never redirect a primary LIFF state on the server;
// liff.init must see the original URL and perform primary -> secondary navigation.
export const venueHistoryRequest = (rawUrl: string, cookie?: string): VenueHistoryRequest => {
  try {
    const url = new URL(rawUrl, 'https://history.invalid');
    const states = url.searchParams.getAll('liff.state');
    const candidate = states.find((state) => /^\/venue-history(?:[?/#]|$)/.test(state));
    if (url.pathname !== path && !candidate) return { kind: 'none' };
    if (rawUrl.length > 8192 || url.hash) return { kind: 'invalid' };
    decodeURIComponent(rawUrl);
    let query = url.searchParams;
    if (states.length) {
      if (
        url.pathname !== '/line/' ||
        states.length !== 1 ||
        !candidate ||
        candidate.length > 512 ||
        !uniqueAllowed(query, new Set(['liff.state', ...callbackKeys])) ||
        !/^\/venue-history(?:\?[^#]*)?$/.test(candidate)
      )
        return { kind: 'invalid' };
      decodeURIComponent(candidate);
      query = new URL(candidate, 'https://history.invalid').searchParams;
      if (!uniqueAllowed(query, applicationKeys)) return { kind: 'invalid' };
    } else if (!uniqueAllowed(query, new Set([...applicationKeys, ...callbackKeys]))) {
      return { kind: 'invalid' };
    }
    const month = query.get('month');
    const venue = query.get('venue');
    const page = query.get('page');
    const lang = query.get('lang');
    if (
      (month !== null && !validMonth(month)) ||
      (venue !== null && !validVenue(venue)) ||
      (page !== null && (!/^[1-9][0-9]*$/.test(page) || !Number.isSafeInteger(Number(page)))) ||
      (lang !== null && !isLocale(lang))
    )
      return { kind: 'invalid' };
    return {
      kind: 'history',
      entry: {
        lang: resolveLocale({ lang }, cookie),
        explicitLang: lang !== null,
        ...(month === null ? {} : { month }),
        ...(venue === null ? {} : { venue }),
        ...(page === null ? {} : { page: Number(page) })
      }
    };
  } catch {
    return { kind: 'invalid' };
  }
};
export const venueHistoryUrl = (entry: VenueHistoryEntry): string => {
  const query = new URLSearchParams();
  if (entry.month) query.set('month', entry.month);
  if (entry.venue) query.set('venue', entry.venue);
  if (entry.page && entry.page !== 1) query.set('page', String(entry.page));
  if (entry.explicitLang !== false) query.set('lang', entry.lang);
  return path + (query.size ? '?' + query.toString() : '');
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
    title: '我的團練紀錄',
    intro: '登入後僅查詢本人出席紀錄，不需要定位；團練出席與日課分開計算。',
    language: '介面語言',
    languageFailed: '語言設定失敗，請稍後再試。',
    month: '月份（選填）',
    venue: '場地代碼（選填）',
    filters: '留白查詢所有月份／場地。場地請輸入完整代碼；這不是全部場地清單，可向老師確認代碼。',
    apply: '套用篩選',
    total: '累計出席次數（所有場地）',
    days: '累計出席日數（場地當地日期去重）',
    monthCount: '月份出席次數（不受場地篩選影響）',
    monthNote: '未指定月份時，月份統計採臺北本月；列表仍查詢所有月份。',
    loading: '正在載入本人團練紀錄，請稍候。',
    loaded: '已載入本人團練紀錄，依簽到時間由新到舊排列。',
    empty: '此篩選與頁次沒有團練紀錄。可調整篩選或返回上一頁。',
    unavailable: '團練紀錄服務尚未就緒或暫時無法使用。尚未取得紀錄，請稍後重試。',
    loginError: 'LINE 登入未完成或已失效。請重新開啟團練紀錄，完成 LINE 登入後再試。',
    forbidden:
      '目前無法查閱。請回 LINE 小幫手聊天完成加入／最新必要隱私同意，或聯絡老師確認學員資格，再重新開啟此頁。',
    invalid: '查詢參數無效，請使用原始團練紀錄連結，或確認月份及完整場地代碼。',
    retry: '重試',
    reopen: '重新開啟並登入',
    previous: '上一頁',
    next: '下一頁',
    page: '頁次',
    daily: '回到日課打卡'
  },
  zh_CN: {
    title: '我的团练记录',
    intro: '登录后仅查询本人出席记录，不需要定位；团练出席与日课分开计算。',
    language: '界面语言',
    languageFailed: '语言设置失败，请稍后重试。',
    month: '月份（选填）',
    venue: '场地代码（选填）',
    filters: '留白查询所有月份／场地。场地请输入完整代码；这不是全部场地清单，可向老师确认代码。',
    apply: '应用筛选',
    total: '累计出席次数（所有场地）',
    days: '累计出席日数（场地当地日期去重）',
    monthCount: '月份出席次数（不受场地筛选影响）',
    monthNote: '未指定月份时，月份统计采用台北本月；列表仍查询所有月份。',
    loading: '正在加载本人团练记录，请稍候。',
    loaded: '已加载本人团练记录，按签到时间由新到旧排列。',
    empty: '此筛选与页次没有团练记录。可调整筛选或返回上一页。',
    unavailable: '团练记录服务尚未就绪或暂时无法使用。尚未取得记录，请稍后重试。',
    loginError: 'LINE 登录未完成或已失效。请重新打开团练记录，完成 LINE 登录后再试。',
    forbidden:
      '目前无法查阅。请回 LINE 小帮手聊天完成加入／最新必要隐私同意，或联系老师确认学员资格，再重新打开此页。',
    invalid: '查询参数无效，请使用原始团练记录链接，或确认月份及完整场地代码。',
    retry: '重试',
    reopen: '重新打开并登录',
    previous: '上一页',
    next: '下一页',
    page: '页次',
    daily: '回到日课打卡'
  },
  en: {
    title: 'My group practice history',
    intro:
      'Sign in to view only your own attendance. No location is requested. Attendance is separate from daily practice.',
    language: 'Language',
    languageFailed: 'Language could not be saved. Please retry.',
    month: 'Month (optional)',
    venue: 'Venue code (optional)',
    filters:
      'Leave blank for all months / venues. Enter the full venue code; this is not a complete venue list. Ask your teacher for the code.',
    apply: 'Apply filters',
    total: 'Lifetime attendance count (all venues)',
    days: 'Lifetime attendance days (unique venue-local dates)',
    monthCount: 'Month attendance count (all venues, regardless of venue filter)',
    monthNote:
      'Without a month filter, the month total uses the current Taipei month; the list still includes all months.',
    loading: 'Loading your attendance history. Please wait.',
    loaded: 'Your attendance is loaded, newest check-in first.',
    empty: 'No attendance for these filters and page. Adjust filters or go to the previous page.',
    unavailable:
      'The history service is not ready or temporarily unavailable. No records were retrieved. Please retry later.',
    loginError: 'LINE sign-in is incomplete or expired. Reopen history and complete LINE sign-in.',
    forbidden:
      'Access is unavailable. Complete joining / current required privacy consent in the LINE Assistant chat, or ask your teacher to confirm eligibility, then reopen this page.',
    invalid: 'Invalid query. Use the original history link or check the month and full venue code.',
    retry: 'Retry',
    reopen: 'Reopen and sign in',
    previous: 'Previous page',
    next: 'Next page',
    page: 'Page',
    daily: 'Back to daily practice'
  }
} as const;

export const renderLineVenueHistoryPage = ({ liffId, entry }: VenueHistoryPageConfig): string => {
  const lang = entry?.lang ?? 'zh_TW';
  const t = texts[lang];
  const canonical = entry ? venueHistoryUrl(entry) : '';
  return `<!doctype html><html lang="${htmlLocale(lang)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>${t.title}</title><style>
:root{font:20px/1.65 system-ui,sans-serif;color:#172b24;background:#f3f7f3}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;padding:1rem}main{min-inline-size:0;inline-size:100%;max-inline-size:36rem;margin:auto}form{min-inline-size:0;inline-size:100%;max-inline-size:100%}h1{font-size:1.6rem}h1,p,li,dt,dd,label,button,a,footer{overflow-wrap:anywhere}button,a,input,select{font:inherit;min-height:48px}input,select{display:block;min-width:0;min-inline-size:0;width:100%;inline-size:100%;max-inline-size:100%;padding:.6rem;margin:.4rem 0 1rem}input[type=month]::-webkit-date-and-time-value{min-inline-size:0;text-align:start}input[type=month]::-webkit-datetime-edit{min-inline-size:0;padding:0}button,a{display:block;padding:.75rem;margin:1rem 0}button{width:100%;color:white;background:#195941;border:2px solid #195941;border-radius:.5rem}button:disabled{color:#404040;background:#ddd;border-color:#777}a{color:#164b83}label{display:block}dt{font-weight:700}dd{margin:0 0 1rem}li{padding:1rem .25rem;border-bottom:1px solid #777}ul{padding-left:1.25rem}:focus-visible{outline:3px solid #ad5100;outline-offset:3px}footer{font-size:18px;margin-top:2rem}#history-status{padding:1rem;border:2px solid #567365}
</style></head><body><main id="history-main" aria-busy="${entry ? 'true' : 'false'}"><h1>${t.title}</h1><p>${t.intro}</p>
${
  entry
    ? `<label for="history-language">${t.language}</label><select id="history-language" disabled>${languageOptions(lang)}</select>
<label for="history-view">紀錄類別</label><select id="history-view" disabled><option value="formal">正式出席</option><option value="test">${venueDebugLabel}</option></select>
<form id="history-filters"><label for="history-month">${t.month}</label><input id="history-month" type="month" min="0001-01" max="9999-12" value="${escapeHtml(entry.month ?? '')}" disabled>
<label for="history-venue">${t.venue}</label><input id="history-venue" type="text" maxlength="64" value="${escapeHtml(entry.venue ?? '')}" autocapitalize="none" spellcheck="false" aria-describedby="history-filter-help" disabled>
<p id="history-filter-help">${t.filters}</p><button id="history-apply" type="submit" disabled>${t.apply}</button></form>
<section id="history-totals" hidden aria-label="${t.title}"><dl><dt>${t.total}</dt><dd id="history-count"></dd><dt>${t.days}</dt><dd id="history-days"></dd><dt>${t.monthCount} — <span id="history-month-period"></span></dt><dd id="history-month-count"></dd></dl><p>${t.monthNote}</p></section>`
    : ''
}
<p id="history-status" role="status" aria-live="polite" aria-atomic="true">${entry ? t.loading : t.invalid}</p>
${entry ? `<ul id="history-entries"></ul><p id="history-page"></p><nav aria-label="${t.page}"><button id="history-previous" type="button" disabled>${t.previous}</button><button id="history-next" type="button" disabled>${t.next}</button></nav><button id="history-retry" type="button" hidden disabled>${t.retry}</button>` : ''}
<a href="/line/checkin?lang=${lang}" referrerpolicy="no-referrer">${t.daily}</a>
<footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer></main>
${
  entry
    ? `<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script><script>
${lineLoginScript(liffId, lang, canonical, { explicitLocale: entry.explicitLang === false ? null : lang })}
const historyText=${scriptJson(t)},historyInitial=${scriptJson(entry)},historyCanonical=${scriptJson(canonical)},historyLocale=${scriptJson(htmlLocale(lang))};
const get=id=>document.getElementById('history-'+id);
const main=get('main'),status=get('status'),language=get('language'),form=get('filters'),month=get('month'),venue=get('venue'),apply=get('apply'),totals=get('totals'),entries=get('entries'),previous=get('previous'),next=get('next'),retry=get('retry');
let ready=false,busy=false,hasMore=false,page=historyInitial.page||1,activeMonth=historyInitial.month||'',activeVenue=historyInitial.venue||'';
const canonicalUrl=selectedLocale=>{const target=new URL(historyCanonical,location.href);target.search='';if(activeMonth)target.searchParams.set('month',activeMonth);if(activeVenue)target.searchParams.set('venue',activeVenue);if(page!==1)target.searchParams.set('page',String(page));if(selectedLocale||historyInitial.explicitLang!==false)target.searchParams.set('lang',selectedLocale||historyInitial.lang);return target.pathname+target.search;};
const view=get('view');
const controls=()=>{for(const node of [language,month,venue,apply,view])node.disabled=busy||!ready;previous.disabled=busy||!ready||page<=1;next.disabled=busy||!ready||!hasMore;retry.disabled=busy;main.setAttribute('aria-busy',String(busy));};
const clear=()=>{entries.replaceChildren();totals.hidden=true;for(const id of ['count','days','month-count','month-period','page'])get(id).textContent='';hasMore=false;};
const fail=message=>{clear();status.textContent=message;retry.hidden=false;retry.textContent=ready?historyText.retry:historyText.reopen;};
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;
const validDate=value=>text(value,10)&&/^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const validResult=data=>{
  if(!data||data.ok!==true||data.timezone!=='Asia/Taipei'||data.page!==page||data.pageSize!==20||typeof data.hasMore!=='boolean'||!data.totals||!['attendanceCount','attendanceDays','monthCount'].every(key=>integer(data.totals[key]))||!Array.isArray(data.entries)||data.entries.length>20)return false;
  return data.entries.every(row=>{
    if((view.value==='test'?(row?.isTest!==true||row?.verificationMode!=='distance_debug'):(row?.isTest!==undefined||row?.verificationMode!==undefined)))return false;
    if(!row||!text(row.id,128)||!text(row.venueCode,64)||!text(row.venueName,300)||!text(row.checkedInAt,64)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(row.checkedInAt)||!Number.isFinite(Date.parse(row.checkedInAt))||!validDate(row.venueLocalDate)||!text(row.venueTimezone,100)||!/^[A-Za-z][A-Za-z0-9._+-]*(?:\\/[A-Za-z0-9._+-]+)*$/.test(row.venueTimezone))return false;
    try{new Intl.DateTimeFormat(historyLocale,{timeZone:row.venueTimezone}).format(new Date(row.checkedInAt));return true;}catch{return false;}
  });
};
const load=async()=>{
  if(!ready||busy)return;
  busy=true;clear();retry.hidden=true;status.textContent=historyText.loading;controls();
  history.replaceState(null,'',canonicalUrl());
  try{
    const currentToken=liff.getIDToken()||'';
    if(!liff.isLoggedIn()||!currentToken){ready=false;idToken='';fail(historyText.loginError);return;}
    const body={idToken:currentToken,page};if(view.value==='test')body.view='test';if(activeMonth)body.month=activeMonth;if(activeVenue)body.venue=activeVenue;
    const response=await fetch('/api/line/venue-history',{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json','x-venue-history':'1'},body:JSON.stringify(body)});
    if(!response.ok){
      if(response.status===401){ready=false;idToken='';fail(historyText.loginError);}
      else fail(response.status===403?historyText.forbidden:response.status===400?historyText.invalid:historyText.unavailable);
      return;
    }
    const data=await response.json();if(!validResult(data))throw new Error('invalid history result');
    const rows=[...data.entries].sort((a,b)=>Date.parse(b.checkedInAt)-Date.parse(a.checkedInAt));
    const items=rows.map(row=>{const item=document.createElement('li');const time=new Intl.DateTimeFormat(historyLocale,{timeZone:row.venueTimezone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(row.checkedInAt));item.textContent=(row.isTest===true?${scriptJson(venueDebugLabel)}+' — ':'')+row.venueLocalDate+' '+time+' ('+row.venueTimezone+') — '+row.venueName+' ['+row.venueCode+']';return item;});
    entries.replaceChildren(...items);
    get('count').textContent=String(data.totals.attendanceCount);get('days').textContent=String(data.totals.attendanceDays);get('month-count').textContent=String(data.totals.monthCount);
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit'}).formatToParts(new Date());
    get('month-period').textContent=activeMonth||parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;
    totals.hidden=view.value==='test';hasMore=data.hasMore;get('page').textContent=historyText.page+' '+page;status.textContent=rows.length?historyText.loaded:historyText.empty;
  }catch{fail(historyText.unavailable);}finally{busy=false;controls();}
};
form.onsubmit=event=>{event.preventDefault();if(!ready||busy)return;const m=month.value,v=venue.value.trim();if((m&&!/^(?!0000)[0-9]{4}-(?:0[1-9]|1[0-2])$/.test(m))||(v&&(v.length>64||!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(v)))){clear();status.textContent=historyText.invalid;controls();return;}activeMonth=m;activeVenue=v;page=1;void load();};
view.onchange=()=>{if(!ready||busy)return;page=1;void load();};
previous.onclick=()=>{if(!previous.disabled){page-=1;void load();}};
next.onclick=()=>{if(!next.disabled&&Number.isSafeInteger(page+1)){page+=1;void load();}};
retry.onclick=()=>{if(busy)return;if(ready)void load();else location.replace('https://liff.line.me/'+encodeURIComponent(liffId)+canonicalUrl().slice('/line'.length));};
language.onchange=async()=>{
  const selectedLocale=language.value;
  if(!ready||busy||!['zh_TW','zh_CN','en'].includes(selectedLocale)||selectedLocale===historyInitial.lang){language.value=historyInitial.lang;return;}
  busy=true;controls();
  let navigating=false;
  try{
    const currentToken=liff.getIDToken()||'';
    if(!liff.isLoggedIn()||!currentToken){ready=false;idToken='';language.value=historyInitial.lang;fail(historyText.loginError);return;}
    const response=await fetch('/line/preferences/language',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:currentToken,locale:selectedLocale})});
    if(!response.ok)throw new Error('language');
    document.cookie='__Host-qigong-learner-locale='+selectedLocale+'; Path=/; Max-Age=31536000; Secure; SameSite=Lax';
    location.replace(canonicalUrl(selectedLocale));
    navigating=true;
  }catch{language.value=historyInitial.lang;status.textContent=historyText.languageFailed;}finally{if(!navigating){busy=false;controls();}}
};
lineReady.then(()=>{ready=true;void load();}).catch(error=>{if(error?.message===lineLoginText.switching){busy=true;retry.hidden=true;status.textContent=lineLoginText.switching;controls();return;}fail(linePrimaryRedirect?lineLoginText.primary:historyText.loginError);main.setAttribute('aria-busy','false');controls();});
</script>`
    : ''
}</body></html>`;
};
