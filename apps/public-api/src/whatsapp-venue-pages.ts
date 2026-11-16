/** WhatsApp venue pages. Existing browser Session bootstrap is reused unchanged.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import type { FastifyInstance } from 'fastify';
import type { Pool } from '@qigong/database';
import { z } from 'zod';
import { whatsappBrowserBootstrap } from './whatsapp-browser-bootstrap.js';
import { venueCheckinStyles, venueGuidancePresentation } from './line-venue-checkin-page.js';
import { createVenueEntryAvailability, venueEntryCodeSchema } from './venue-entry-guidance.js';
import {
  htmlLocale,
  languageOptions,
  localeSchema,
  uiText,
  type Locale
} from './ui-localization.js';
import {
  whatsappVenueConfigSchema,
  whatsappVenuePageQuerySchema,
  whatsappVenuePagePath,
  whatsappVenueChatUrl,
  type WhatsAppVenueConfig
} from './whatsapp-venue-navigation.js';
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
const scriptData = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
const copy = (locale: Locale) => {
  const en = locale === 'en';
  const t = {
    title: en ? 'Group practice check-in' : '團練場打卡',
    history: en ? 'My venue attendance' : '我的團練紀錄',
    login: en ? 'Sign in to this device' : '登入此裝置',
    chat: en ? 'Open WhatsApp for a private login link' : '開啟 WhatsApp 取得私人登入連結',
    needLink: en
      ? 'Send the command below in private WhatsApp chat, then open the new private link.'
      : '請在 WhatsApp 私聊送出下方指令，再開啟新的私人登入連結。',
    remember: en
      ? 'My device: remember for 30 days (uncheck on shared devices)'
      : '這是我的裝置，記住30天（共用裝置請取消勾選）',
    logout: en ? 'Sign out this device' : '登出此裝置',
    account: en ? 'Device and account' : '裝置與帳號',
    ready: en
      ? 'Ready. Location is requested only after pressing check-in.'
      : '已確認資格，按下打卡後才取得位置。',
    privacy: en
      ? 'Raw GPS is not stored. No proactive chat receipt is sent.'
      : '不儲存原始 GPS，不主動傳送聊天收據。',
    loading: en ? 'Checking eligibility…' : '正在確認資格…',
    locating: en
      ? 'Getting location. Attendance not yet submitted.'
      : '正在取得位置，尚未送出出席。',
    sending: en ? 'Confirming check-in. Do not submit again.' : '正在確認打卡結果，請勿重複送出。',
    button: en ? 'Confirm location and check in' : '確認位置並打卡',
    success: en ? 'Checked in' : '打卡成功',
    completed: en ? 'Check-in complete' : '已完成打卡',
    gps: en
      ? 'Location unavailable. Check location permission and retry. Attendance not submitted.'
      : '無法取得位置。請確認定位權限後再試；尚未送出出席。',
    uncertain: en
      ? 'Result not confirmed. Check history or retry safely; attendance may already be saved.'
      : '結果尚未確認，請查看紀錄或安全重試；出席可能已儲存。',
    failed: en
      ? 'Unable to continue. Check login, consent and venue status.'
      : '無法繼續，請確認登入、同意與場地狀態。',
    outside: en
      ? 'Outside the venue radius. No attendance saved.'
      : '超出場地定位半徑，本次未儲存出席。',
    closed: en
      ? 'Check-in is not available now. Refresh or scan the venue again.'
      : '目前不在可打卡時段，請重新整理或再次掃描場地。',
    daily: en ? 'Daily practice' : '每日練功打卡',
    back: en ? 'Back to venue' : '回到團練場',
    month: en ? 'Month (optional)' : '月份（選填）',
    venue: en ? 'Venue code (optional)' : '場地代碼（選填）',
    apply: en ? 'Apply filters' : '套用篩選',
    previous: en ? 'Previous' : '上一頁',
    next: en ? 'Next' : '下一頁',
    empty: en ? 'No attendance found.' : '尚無符合條件的團練紀錄。',
    total: en ? 'Total attendance' : '累計出席',
    days: en ? 'Venue-local dates' : '出席日期數',
    monthTotal: en ? 'Selected/current local month' : '所選／場地當地本月',
    language: en ? 'Language' : '介面語言'
  };
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, uiText(locale, v)])) as typeof t;
};
export const renderWhatsAppVenuePage = (
  config: WhatsAppVenueConfig,
  page: 'checkin' | 'history',
  locale: Locale,
  code: string | null,
  source: 'nfc' | 'qr' | 'link' = 'link',
  availability?: unknown
) => {
  const cfg = whatsappVenueConfigSchema.parse(config),
    t = copy(locale);
  if (code !== null) venueEntryCodeSchema.parse(code);
  const canonical =
    page === 'checkin' && code
      ? whatsappVenuePagePath(code, locale, source)
      : '/whatsapp/venue-history?' +
        new URLSearchParams({ lang: locale, ...(code ? { venue: code } : {}) }).toString();
  const view =
    page === 'checkin' && code ? venueGuidancePresentation(availability, code, locale) : null;
  const active = page === 'history' || view?.open === true;
  const calendar =
    view?.markup.replace(/^<header class="page-header">[\s\S]*?<\/header>/, '') ?? '';
  const chat = code ? whatsappVenueChatUrl(cfg, code, locale) : null;
  const title = page === 'history' ? t.history : t.title;
  const login = `<section id="wa-login-panel" class="venue-card" hidden><h2>${t.login}</h2><p>${t.needLink}</p><p><code>${escape(code ? 'venue ' + code + ' ' + locale : 'checkin')}</code></p>${chat ? `<a href="${escape(chat)}" referrerpolicy="no-referrer">${t.chat}</a>` : ''}<label><input id="wa-remember" type="checkbox" checked> ${t.remember}</label><button id="wa-login" type="button">${t.login}</button><p id="wa-login-status" role="status" aria-live="polite"></p></section><section id="wa-session-panel" class="venue-card" hidden><details><summary>${t.account}</summary><p id="wa-session-status"></p><a id="wa-bookmark" href="${escape(canonical)}">${escape(canonical)}</a><button id="wa-logout" type="button">${t.logout}</button></details></section>`;
  const actions =
    page === 'checkin'
      ? `<section id="wa-venue-action" class="venue-card" hidden><p class="venue-help">${t.privacy}</p><div id="wa-venue-stamp" class="checkin-stamp" aria-hidden="true" hidden><span>✓</span><strong>${t.success}</strong></div><p id="wa-venue-status" role="status" aria-live="polite">${t.loading}</p><button id="wa-venue-submit" class="checkin-primary" type="button" disabled>${t.button}</button></section>`
      : `<section id="wa-venue-action" class="venue-card" hidden><label>${t.month}<input id="wa-history-month" type="month"></label><label>${t.venue}<input id="wa-history-venue" maxlength="64" autocomplete="off"></label><button id="wa-history-apply" type="button">${t.apply}</button><p id="wa-venue-status" role="status" aria-live="polite">${t.loading}</p><p id="wa-history-totals"></p><div id="wa-history-entries"></div><nav class="venue-actions"><button id="wa-history-previous" type="button">${t.previous}</button><span id="wa-history-page"></span><button id="wa-history-next" type="button">${t.next}</button></nav></section>`;
  const back =
    page === 'history' && code
      ? `<a href="${escape(whatsappVenuePagePath(code, locale))}">${t.back}</a>`
      : '';
  const historyLink =
    page === 'checkin'
      ? `<a href="/whatsapp/venue-history?${escape(new URLSearchParams({ lang: locale, ...(code ? { venue: code } : {}) }).toString())}">${t.history}</a>`
      : '';
  return `<!doctype html><html lang="${htmlLocale(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>WhatsApp · ${title}</title><style>${venueCheckinStyles}.wa-success .checkin-stamp{display:grid}.venue-actions button{width:auto;flex:1 1 auto}.lang-control select{min-height:48px}.channel-label{color:#166534;font-size:13px}#wa-history-entries article{box-shadow:none}input[type=month],#wa-history-venue{width:100%}</style></head><body><main><header class="page-header"><h1>${title}</h1><label class="lang-control">${t.language}<select id="wa-venue-language">${languageOptions(locale)}</select></label></header><p class="channel-label">WhatsApp</p><section id="wa-venue-calendar">${calendar}</section>${active ? login + actions : ''}<nav class="venue-actions">${historyLink}${back}<a href="/whatsapp/checkin?lang=${locale}">${t.daily}</a></nav><footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer></main><script>${active ? whatsappBrowserBootstrap(locale) : `history.replaceState(null,'',${scriptData(canonical)});document.getElementById('wa-venue-language').onchange=()=>{const next=document.getElementById('wa-venue-language').value;if(!['zh_TW','zh_CN','en'].includes(next))return;const url=new URL(${scriptData(canonical)},location.origin);url.searchParams.set('lang',next);location.replace(url.pathname+url.search);};`}</script>${active ? `<script>const waVenuePage=${scriptData({ page, locale, code, canonical, t })};${whatsappVenueClient}</script>` : ''}</body></html>`;
};
export const whatsappVenueClient = String.raw`
(()=>{
 const {page,locale,code,canonical,t}=waVenuePage,$=id=>document.getElementById(id);
 let busy=false,completed=false,eligible=false,alive=true,pageNumber=1,hasMore=false,pageProof='';
 const status=(text,success=false)=>{$('wa-venue-status').textContent=text;$('wa-venue-status').className=success?'schedule-open':'';};
 const lock=value=>{busy=value;for(const id of ['wa-venue-submit','wa-history-apply','wa-history-previous','wa-history-next','wa-history-month','wa-history-venue','wa-venue-language','wa-logout']){const e=$(id);if(e)e.disabled=value;}if($('wa-venue-submit'))$('wa-venue-submit').disabled=value||completed||!eligible;if($('wa-history-previous'))$('wa-history-previous').disabled=value||pageNumber<=1;if($('wa-history-next'))$('wa-history-next').disabled=value||!hasMore;};
 window.whatsappMayLeave=()=>!busy;
 whatsappLoginText.needLink=t.needLink;
 const invalidate=()=>{eligible=false;completed=false;pageProof='';$('wa-venue-action').hidden=true;if($('wa-history-entries'))$('wa-history-entries').replaceChildren();if($('wa-venue-stamp'))$('wa-venue-stamp').hidden=true;whatsappAuthExpired();};
 const api=async(path,values,proof=pageProof)=>{
  if(!alive)throw Error('page hidden');if(!whatsappAuthenticated||!proof||proof!==whatsappCsrf()){invalidate();throw Error('credential changed');}
  const r=await fetch(path,{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'content-type':'application/json','x-whatsapp-csrf-token':proof},body:JSON.stringify(values),signal:AbortSignal.timeout(15000)});
  let data;try{data=await r.json();}catch{throw Error('invalid response');}
  if(!r.ok){if(r.status===401)invalidate();const e=Error('venue');e.code=data?.error;throw e;}
  if(!alive)throw Error('page hidden');if(proof!==whatsappCsrf()){invalidate();throw Error('credential changed');}return data;
 };
 const format=(stamp,zone)=>new Intl.DateTimeFormat(locale==='zh_TW'?'zh-Hant':locale==='zh_CN'?'zh-Hans':'en',{timeZone:zone,calendar:'gregory',numberingSystem:'latn',dateStyle:'medium',timeStyle:'short'}).format(new Date(stamp));
 const stampValid=value=>typeof value==='string'&&value.length<=64&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===value.slice(0,10);
 const dateMatches=(stamp,zone,date)=>{try{if(!stampValid(stamp)||typeof date!=='string'||typeof zone!=='string'||!zone||zone.length>100)return false;const parts=new Intl.DateTimeFormat('en',{timeZone:zone,calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(stamp));const p=k=>parts.find(v=>v.type===k).value;return p('year')+'-'+p('month')+'-'+p('day')===date;}catch{return false;}};
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const receiptValid=r=>object(r)&&Object.keys(r).length===5&&r.ok===true&&typeof r.replayed==='boolean'&&object(r.venue)&&Object.keys(r.venue).length===3&&r.venue.code===code&&typeof r.venue.name==='string'&&r.venue.name.length>0&&r.venue.name.length<=120&&dateMatches(r.checkedInAt,r.venue.timezone,r.attendanceDate);
 const refresh=async()=>{const r=await fetch('/api/whatsapp/venue-availability?'+new URLSearchParams({venue:code}),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok||data?.version!==1||data.availability!=='open'||data.venue?.code!==code){eligible=false;$('wa-venue-calendar').hidden=true;status(t.closed);return false;}return true;};
 const loadHistory=async()=>{
  if(busy||!alive)return;lock(true);status(t.loading);
  try{const values={page:pageNumber},month=$('wa-history-month').value,venue=$('wa-history-venue').value.trim();if(month)values.month=month;if(venue)values.venue=venue;const data=await api('/api/whatsapp/venue-history',values);
   if(!object(data)||data.ok!==true||data.dateBasis!=='venue_local_date'||data.page!==pageNumber||data.pageSize!==20||typeof data.hasMore!=='boolean'||!Array.isArray(data.entries)||data.entries.length>20||!object(data.totals)||!['attendanceCount','attendanceDays','monthCount'].every(k=>Number.isInteger(data.totals[k])&&data.totals[k]>=0))throw Error('history');
   const cards=data.entries.map(entry=>{if(!object(entry)||Object.hasOwn(entry,'isTest')||Object.hasOwn(entry,'verificationMode')||typeof entry.venueName!=='string'||!dateMatches(entry.checkedInAt,entry.venueTimezone,entry.venueLocalDate)||(venue&&entry.venueCode!==venue)||(month&&!entry.venueLocalDate.startsWith(month+'-')))throw Error('entry');const card=document.createElement('article');card.className='venue-card';const title=document.createElement('h2');title.textContent=entry.venueName;const time=document.createElement('p');time.textContent=format(entry.checkedInAt,entry.venueTimezone)+' ('+entry.venueTimezone+')';card.append(title,time);return card;});
   $('wa-history-entries').replaceChildren(...cards);$('wa-history-totals').textContent=t.total+' '+data.totals.attendanceCount+' · '+t.days+' '+data.totals.attendanceDays+' · '+t.monthTotal+' '+data.totals.monthCount;hasMore=data.hasMore;$('wa-history-page').textContent=String(pageNumber);status(cards.length?'':t.empty);
  }catch{if(alive){$('wa-history-entries').replaceChildren();$('wa-history-totals').textContent='';status(t.failed);}}finally{if(alive)lock(false);}
 };
 if(page==='checkin')$('wa-venue-submit').onclick=async()=>{
  if(busy||completed||!eligible||!alive)return;lock(true);let attempted=false;const proof=pageProof;
  try{if(!await refresh())return;const state=await api('/api/whatsapp/venue-entry-status',{},proof);if(state?.version!==1||state.status!=='approved'||state.privacy!=='clear')throw Error('eligibility');status(t.locating);
   let position;try{position=await new Promise((resolve,reject)=>{if(!navigator.geolocation){reject();return;}navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:10000,maximumAge:0});});}catch{status(t.gps);return;}
   if(!alive||proof!==whatsappCsrf())throw Error('credential changed');const latitude=position.coords.latitude,longitude=position.coords.longitude;if(!Number.isFinite(latitude)||!Number.isFinite(longitude))throw Error('GPS');
   status(t.sending);attempted=true;const result=await api('/api/whatsapp/venue-checkin',{venue:code,latitude,longitude},proof);if(!receiptValid(result))throw Error('receipt');completed=true;eligible=false;$('wa-venue-stamp').hidden=false;$('wa-venue-action').classList.add('wa-success');$('wa-venue-submit').textContent=t.completed;status(t.success+' — '+result.venue.name+' / '+format(result.checkedInAt,result.venue.timezone),true);
  }catch(e){if(alive)status(e.code==='outside_radius'?t.outside:e.code==='outside_window'?t.closed:attempted?t.uncertain:t.failed);}finally{if(alive)lock(false);}
 };
 else{ $('wa-history-apply').onclick=()=>{if(!busy){pageNumber=1;loadHistory();}};$('wa-history-previous').onclick=()=>{if(!busy&&pageNumber>1){pageNumber--;loadHistory();}};$('wa-history-next').onclick=()=>{if(!busy&&hasMore){pageNumber++;loadHistory();}}; }
 $('wa-venue-language').onchange=()=>{const next=$('wa-venue-language').value;if(busy||!['zh_TW','zh_CN','en'].includes(next)){$('wa-venue-language').value=locale;return;}const target=new URL(canonical,location.origin);target.searchParams.set('lang',next);location.replace(target.pathname+target.search+(!whatsappAuthenticated&&whatsappLink?'#'+whatsappLink:''));};
 document.querySelectorAll('.venue-actions a').forEach(a=>a.addEventListener('click',e=>{if(busy)e.preventDefault();}));
 window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
 window.addEventListener('pagehide',()=>{alive=false;eligible=false;$('wa-venue-action').hidden=true;if($('wa-history-entries'))$('wa-history-entries').replaceChildren();if($('wa-venue-stamp'))$('wa-venue-stamp').hidden=true;status('');});
 window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 window.addEventListener('focus',()=>{if(pageProof&&pageProof!==whatsappCsrf())invalidate();});
 (async()=>{await whatsappReady;if(!alive)return;pageProof=whatsappCsrf();$('wa-venue-action').hidden=false;if(page==='history'){await loadHistory();return;}lock(true);try{if(!await refresh())return;const state=await api('/api/whatsapp/venue-entry-status',{});eligible=state?.version===1&&state.status==='approved'&&state.privacy==='clear';status(eligible?t.ready:t.failed);}catch{if(alive)status(t.failed);}finally{if(alive)lock(false);}})();
})();`;

export const registerWhatsAppVenuePages = (
  app: FastifyInstance,
  pool: Pool,
  config: WhatsAppVenueConfig
) => {
  const cfg = whatsappVenueConfigSchema.parse(config),
    availability = createVenueEntryAvailability(pool);
  for (const page of ['checkin', 'history'] as const)
    app.get('/whatsapp/venue-' + page, { logLevel: 'silent' }, async (request, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-robots-tag', 'noindex,nofollow')
        .header(
          'permissions-policy',
          page === 'checkin'
            ? 'geolocation=(self), camera=(), microphone=()'
            : 'geolocation=(), camera=(), microphone=()'
        )
        .header(
          'content-security-policy',
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        );
      const parsed = (
        page === 'checkin'
          ? whatsappVenuePageQuerySchema
          : z.strictObject({
              lang: localeSchema.default('zh_TW'),
              venue: venueEntryCodeSchema.optional()
            })
      ).safeParse(request.query);
      if (!parsed.success)
        return reply
          .code(400)
          .type('text/html; charset=utf-8')
          .send(
            '<!doctype html><html><head><meta name="referrer" content="no-referrer"></head><body>Invalid venue link.<script>history.replaceState(null,"",location.pathname);</script></body></html>'
          );
      const data = parsed.data,
        code = 'venue' in data ? (data.venue ?? null) : null;
      const result = page === 'checkin' && code ? await availability(request.id, code) : undefined;
      if (result) reply.code(result.status);
      return reply
        .type('text/html; charset=utf-8')
        .send(
          renderWhatsAppVenuePage(
            cfg,
            page,
            data.lang,
            code,
            'source' in data ? z.enum(['nfc', 'qr', 'link']).parse(data.source) : 'link',
            result
          )
        );
    });
};
