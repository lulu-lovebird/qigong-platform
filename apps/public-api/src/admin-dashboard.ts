import { uiTemplate, uiText, htmlLocale, languageOptions } from './ui-localization.js';
import { adminLayoutStyles } from './admin-layout-styles.js';
import { adminBrandColors, adminBrandStyles, renderAdminLogo } from './admin-branding.js';
import {
  adminLocaleCookie,
  adminLocaleQuery,
  adminLocaleScript,
  adminTexts,
  type AdminLocale,
  type AdminTextKey
} from './admin-locale.js';
export type AdminPage =
  | 'overview'
  | 'leaderboard'
  | 'achievements'
  | 'methods'
  | 'review'
  | 'access'
  | 'journal'
  | 'tags'
  | 'learners'
  | 'shared'
  | 'privacy'
  | 'invites'
  | 'notifications'
  | 'achievementManagement'
  | 'fieldSchedule'
  | 'attendance';

const nfcNavLabels: Record<AdminLocale, Record<string, string>> = {
  zh_TW: {
    navFieldSchedule: '團練場出席管理 · 場地設定',
    navAttendance: '團練場出席管理 · 出席報表',
    fieldSchedule: '團練場出席管理',
    attendance: '團練場出席管理 · 出席報表'
  },
  zh_CN: {
    navFieldSchedule: '团练场出席管理 · 场地设置',
    navAttendance: '团练场出席管理 · 出席报表',
    fieldSchedule: '团练场出席管理',
    attendance: '团练场出席管理 · 出席报表'
  },
  en: {
    navFieldSchedule: 'Group Practice Attendance · Venues',
    navAttendance: 'Group Practice Attendance · Reports',
    fieldSchedule: 'Group Practice Attendance',
    attendance: 'Group Practice Attendance · Reports'
  }
};

const navigation: ReadonlyArray<{ page: AdminPage; path: string; label: AdminTextKey }> = [
  { page: 'overview', path: '/admin/', label: 'navOverview' },
  { page: 'leaderboard', path: '/admin/leaderboard', label: 'navLeaderboard' },
  { page: 'achievements', path: '/admin/achievements', label: 'navAchievements' },
  { page: 'methods', path: '/admin/method-analysis', label: 'navMethods' },
  { page: 'review', path: '/admin/applications', label: 'navReview' },
  { page: 'access', path: '/admin/administrators', label: 'navAccess' },
  { page: 'journal', path: '/admin/journal', label: 'navJournal' },
  { page: 'tags', path: '/admin/practice-feeling-tags', label: 'navTags' },
  { page: 'learners', path: '/admin/learners', label: 'navLearners' },
  { page: 'shared', path: '/admin/shared-journal', label: 'navShared' },
  { page: 'privacy', path: '/admin/privacy-policy', label: 'navPrivacy' },
  { page: 'invites', path: '/admin/line-invites', label: 'navInvites' },
  { page: 'notifications', path: '/admin/notifications', label: 'navNotifications' },
  {
    page: 'achievementManagement',
    path: '/admin/achievement-management',
    label: 'navAchievementManagement'
  },
  {
    page: 'attendance',
    path: '/admin/attendance',
    label: 'navAttendance' as AdminTextKey
  },
  {
    page: 'fieldSchedule',
    path: '/admin/fields',
    label: 'navFieldSchedule' as AdminTextKey
  }
];

const navigationGroups: ReadonlyArray<{
  id: string;
  label: AdminTextKey;
  pages: readonly AdminPage[];
}> = [
  {
    id: 'reports',
    label: 'navGroupReports',
    pages: ['overview', 'leaderboard', 'achievements', 'methods', 'attendance']
  },
  { id: 'learners', label: 'navGroupLearners', pages: ['review', 'learners', 'invites'] },
  { id: 'journal', label: 'navGroupJournal', pages: ['journal', 'shared', 'tags'] },
  {
    id: 'settings',
    label: 'navGroupSettings',
    pages: ['access', 'privacy', 'notifications', 'achievementManagement', 'fieldSchedule']
  }
];
const deferredNavigation = (page: AdminPage) =>
  [
    'journal',
    'tags',
    'learners',
    'shared',
    'privacy',
    'invites',
    'achievements',
    'achievementManagement',
    'fieldSchedule',
    'attendance'
  ].includes(page);
// All shell inputs come from source-controlled page definitions, never user data.
export const renderAdminShell = (
  page: AdminPage,
  content: string,
  script: string,
  locale: AdminLocale = 'zh_TW',
  canManageAdmins = false,
  canManageFields = false
) => {
  const text = adminTexts(locale);
  const resolveText = (key: string) =>
    (text as Record<string, string>)[key] ?? nfcNavLabels[locale]?.[key] ?? key;
  const pageLabel = resolveText(page);
  const languageSwitcher = uiTemplate(
    locale
  )`<div class="languages"><select id="admin-language" aria-label="${text.language}">${languageOptions(locale)}</select></div>`;
  const navigationMarkup = navigationGroups
    .map((group) => {
      const items = group.pages
        .flatMap((p) => navigation.filter((item) => item.page === p))
        .filter(
          (item) =>
            (item.page !== 'access' || canManageAdmins) &&
            ((item.page !== 'fieldSchedule' && item.page !== 'attendance') ||
              canManageFields ||
              page === 'fieldSchedule' ||
              page === 'attendance')
        );
      if (!items.length) return '';
      const visible = items.some((item) => !deferredNavigation(item.page));
      return `<details class="nav-group" name="admin-navigation-groups" data-nav-group="${group.id}"${group.pages.includes(page) ? ' data-current-group="true"' : ''} aria-labelledby="nav-group-${group.id}"${visible ? '' : ' hidden'}><summary class="nav-group-title" id="nav-group-${group.id}">${text[group.label]}</summary><div class="nav-group-links">${items.map((item) => `<a href="${item.path + adminLocaleQuery(locale)}"${item.page === 'achievementManagement' ? ' class="journal-nav" data-achievement-management-nav hidden' : item.page === 'achievements' ? ' class="journal-nav" data-achievements-nav hidden' : item.page === 'invites' ? ' class="journal-nav" data-line-invites-nav hidden' : item.page === 'fieldSchedule' ? ' class="journal-nav" data-fields-nav hidden' : item.page === 'attendance' ? ' class="journal-nav" data-attendance-nav hidden' : ['journal', 'tags', 'learners', 'shared', 'privacy'].includes(item.page) ? ` class="journal-nav" data-journal-nav="${item.page}" hidden` : ''}${item.page === page ? ' aria-current="page"' : ''}>${resolveText(item.label)}</a>${item.page === 'invites' ? '<a href="/admin/channel-invites' + adminLocaleQuery(locale) + '" class="journal-nav" data-channel-invites-nav hidden>' + (locale === 'en' ? 'Telegram / WhatsApp invitations' : uiText(locale, 'Telegram／WhatsApp邀請')) + '</a>' : ''}`).join('')}</div></details>`;
    })
    .join('');
  return `<!doctype html>
<html lang="${htmlLocale(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${pageLabel}｜${text.siteTitle}</title>
<style>
${adminBrandStyles}
${adminLayoutStyles}
</style></head><body><a class="skip" href="#main">${text.skip}</a><div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-title">${renderAdminLogo(locale)}<span class="brand-title-text">${text.brand}</span></div><small>${text.brandSubtitle}</small></div>${languageSwitcher}<details id="admin-nav-disclosure" class="nav-disclosure" open><summary>${text.navigation}<span>${pageLabel}</span></summary><nav id="admin-navigation" aria-label="${text.navigation}">${navigationMarkup}</nav></details><button id="logout" type="button">${text.logout}</button></aside>
<div class="workspace"><header><div><h1>${pageLabel}</h1><span class="muted">${text.scope}</span></div></header><div id="main">${content}</div><footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer></div></div>
<script>
(() => {
  ${adminLocaleScript(locale)}
  const language=document.getElementById('admin-language');
  language.value=locale;
  const navigationGroups=()=>typeof document.querySelectorAll==='function'?Array.from(document.querySelectorAll('[data-nav-group]')):[];
  const refreshNavigationGroups=()=>{for(const group of navigationGroups()){group.hidden=!Array.from(group.querySelectorAll('a')).some(link=>!link.hidden);if(group.hidden)group.open=false;}};
  for(const group of navigationGroups())group.addEventListener('toggle',()=>{if(group.hidden){group.open=false;return;}if(!group.open)return;for(const other of navigationGroups())if(other!==group)other.open=false;});
  refreshNavigationGroups();
  const disclosure=document.getElementById('admin-nav-disclosure');
  if(disclosure&&typeof matchMedia==='function'){const mobile=matchMedia('(max-width:760px)');const adaptNavigation=()=>{disclosure.open=!mobile.matches;};adaptNavigation();mobile.addEventListener?.('change',adaptNavigation);}
  if(typeof document.querySelectorAll==='function'&&document.querySelectorAll('[data-journal-nav]').length)fetch('/admin/api/journal/capabilities?lang='+locale,{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(c=>{for(const a of document.querySelectorAll('[data-journal-nav]'))a.hidden=!(c&&c[({journal:'canReadJournal',tags:'canManageTags',learners:'canManageLearners',shared:'canReadShared',privacy:'canPublishPrivacy'})[a.dataset.journalNav]]===true);refreshNavigationGroups();}).catch(refreshNavigationGroups);
  if(typeof document.querySelectorAll==='function'&&document.querySelectorAll('[data-line-invites-nav]').length)fetch('/admin/api/line-invites/capabilities',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(c=>{for(const a of document.querySelectorAll('[data-line-invites-nav]'))a.hidden=c?.canManage!==true;refreshNavigationGroups();}).catch(refreshNavigationGroups);
  if(typeof document.querySelectorAll==='function'&&document.querySelectorAll('[data-channel-invites-nav]').length)fetch('/admin/api/channel-invites/capabilities',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(c=>{for(const a of document.querySelectorAll('[data-channel-invites-nav]'))a.hidden=c?.canManage!==true;refreshNavigationGroups();}).catch(refreshNavigationGroups);
  if(typeof document.querySelectorAll==='function'&&document.querySelectorAll('[data-achievements-nav]').length)fetch('/admin/api/achievements/capabilities',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(c=>{for(const a of document.querySelectorAll('[data-achievements-nav]'))a.hidden=c?.canReadAchievements!==true;refreshNavigationGroups();}).catch(refreshNavigationGroups);
  if(typeof document.querySelectorAll==='function'&&document.querySelectorAll('[data-achievement-management-nav]').length)fetch('/admin/api/achievement-management/capabilities',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(c=>{for(const a of document.querySelectorAll('[data-achievement-management-nav]'))a.hidden=c?.canManage!==true;refreshNavigationGroups();}).catch(refreshNavigationGroups);
  if(typeof document.querySelectorAll==='function'&&document.querySelectorAll('[data-fields-nav]').length)fetch('/admin/api/fields/capabilities',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(c=>{for(const a of document.querySelectorAll('[data-fields-nav]'))a.hidden=c?.canManage!==true;refreshNavigationGroups();}).catch(refreshNavigationGroups);
  if(typeof document.querySelectorAll==='function'&&document.querySelectorAll('[data-attendance-nav]').length)fetch('/admin/api/attendance/capabilities',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(c=>{for(const a of document.querySelectorAll('[data-attendance-nav]'))a.hidden=c?.canRead!==true;refreshNavigationGroups();}).catch(refreshNavigationGroups);
  const mayLeave=()=>typeof window==='undefined'||!window.qigongJournalMayLeave||window.qigongJournalMayLeave();
  language.addEventListener('change',() => {
    const next=language.value;
    if(next!=='en' && next!=='zh_TW' && next!=='zh_CN') {language.value=locale;return;}
    if(next === locale) return;
    if(${JSON.stringify(page === 'review' || page === 'access')} && !confirm(t.${page === 'access' ? 'accessSwitchConfirm' : 'reviewSwitchConfirm'})) {language.value=locale;return;}
    if(!mayLeave()){language.value=locale;return;}
    const url=new URL(location.href); url.searchParams.set('lang',next);
    document.cookie='${adminLocaleCookie}='+next+'; Path=/; Max-Age=31536000; Secure; SameSite=Lax';
    location.assign(url.pathname+url.search+url.hash);
  });
  document.getElementById('admin-navigation')?.addEventListener('click',event=>{if(event.target.closest('a')&&!mayLeave())event.preventDefault();});
  document.getElementById('logout').addEventListener('click',async () => {
    if(!mayLeave())return;
    const csrf = document.cookie.split('; ').find(part => part.startsWith('__Host-qigong-admin-csrf='))?.split('=')[1] || '';
    try {
      const response = await fetch('/admin/auth/logout',{ method:'POST',credentials:'same-origin',headers:{'x-csrf-token':csrf} });
      if (response.ok || response.status===401) location.assign('/admin/auth/login');
      else throw new Error(t.logoutFailed);
    } catch { if(typeof window!=='undefined')window.qigongJournalLeaveCancelled?.();const status=document.getElementById('status')||document.getElementById('journal-status');if(status)status.textContent=t.logoutFailed; }
  });
})();
${script}
</script></body></html>`;
};

export const renderAdminDashboard = (
  page: Exclude<AdminPage, 'review' | 'access'>,
  locale: AdminLocale = 'zh_TW',
  canManageAdmins = false
) => {
  const text = adminTexts(locale);
  return renderAdminShell(
    page,
    `
<form id="filters" class="card filters">
<label>${text.period}<select id="period"><option value="week">${text.week}</option><option value="month">${text.month}</option><option value="quarter">${text.quarter}</option><option value="year">${text.year}</option><option value="30d">${text.days30}</option><option value="90d">${text.days90}</option></select></label>
<label>${text.region}<select id="region"><option value="">${text.allRegions}</option></select></label>
<label>${text.platform}<select id="platform"><option value="">${text.allPlatforms}</option><option value="telegram">Telegram</option><option value="line">LINE</option><option value="whatsapp">WhatsApp</option></select></label>
<label>${text.learnerName}<input id="q" maxlength="100" placeholder="${text.searchName}"></label>
${page === 'overview' ? `<label>${text.checkinDate}<input id="date" type="date"></label>` : ''}
${page === 'leaderboard' ? `<label>${text.periodRanking}<select id="top"><option value="10">Top 10</option><option value="20">Top 20</option><option value="30">Top 30</option></select></label>` : ''}
<button type="submit">${text.applyFilters}</button></form>
<p id="status" role="status" aria-live="polite">${text.loading}</p><p id="range" class="muted"></p><main id="report"></main>`,
    `
(() => {
  ${adminLocaleScript(locale)}
  const mode=${JSON.stringify(page)};
  const $=id => document.getElementById(id);
  const params=new URLSearchParams(location.search);
  for (const key of ['period','platform','q','date','top']) if ($(key) && params.has(key)) $(key).value=params.get(key);
  let regionWanted=params.get('region') || '';
  let selectedPerson=params.get('personId');
  let currentPage=1,checkedPage=1,pendingPage=1,historyPage=1,generation=0;
  const node=(tag,text,cls) => { const el=document.createElement(tag); if(text!==undefined) el.textContent=String(text ?? '—'); if(cls) el.className=cls; return el; };
  const card=title => { const el=node('section',undefined,'card'); el.append(node('h2',title)); return el; };
  const personLink=row => { const a=node('a',row.display_name || t.unnamedLearner); a.href='/admin/method-analysis?lang='+locale+'&personId='+encodeURIComponent(row.id); return a; };
  function table(headers,rows) {
    const wrap=node('div',undefined,'table-wrap'),t=node('table'),head=node('thead'),tr=node('tr'),body=node('tbody');
    for(const title of headers) { const th=node('th',title); th.scope='col'; tr.append(th); } head.append(tr);
    for(const cells of rows) { const row=node('tr'); for(const cell of cells) { const td=node('td'); td.append(typeof cell==='object' && cell!==null ? cell : node('span',cell)); row.append(td); } body.append(row); }
    if(!rows.length) { const row=node('tr'),td=node('td',t.noData); td.colSpan=headers.length; row.append(td); body.append(row); }
    t.append(head,body); wrap.append(t); return wrap;
  }
  function pager(target,data,change) {
    const controls=node('div',undefined,'pager'),previous=node('button',t.previous,'secondary'),next=node('button',t.next,'secondary'); previous.type=next.type='button';
    previous.disabled=data.page<=1; next.disabled=data.page>=data.totalPages;
    previous.addEventListener('click',()=>change(data.page-1)); next.addEventListener('click',()=>change(data.page+1));
    controls.append(previous,node('span',message('pager',{page:data.page,pages:data.totalPages,total:data.total})),next); target.append(controls);
  }
  async function api(view,query) {
    const response=await fetch('/admin/api/reports/'+view+'?'+query.toString(),{credentials:'same-origin',cache:'no-store'}).catch(()=>{throw new Error(t.loadFailed);});
    if(response.status===401) { location.assign('/admin/auth/login'); throw new Error(t.loginExpired); }
    if(!response.ok) throw new Error(response.status===403 ? t.permissionDenied : response.status===404 ? t.learnerNotFound : response.status===400 ? t.invalidFilter : t.loadFailed);
    return response.json().catch(()=>{throw new Error(t.loadFailed);});
  }
  function query() {
    const value=new URLSearchParams({lang:locale});
    for(const key of ['period','region','platform','q','top']) if($(key)?.value) value.set(key,$(key).value);
    return value;
  }
  const withValues=(query,values) => { const copy=new URLSearchParams(query); for(const [key,value] of Object.entries(values)) if(value) copy.set(key,String(value)); return copy; };
  function chart(rows) {
    const ns='http://www.w3.org/2000/svg'; const svg=document.createElementNS(ns,'svg'); svg.setAttribute('viewBox','0 0 900 210'); svg.setAttribute('class','chart'); svg.setAttribute('role','img'); svg.setAttribute('aria-label',t.trendAccessible);
    const actualMax=Math.max(0,...rows.map(row=>row.count)),max=Math.max(1,actualMax),width=880/Math.max(1,rows.length);
    rows.forEach((row,index)=>{ const rect=document.createElementNS(ns,'rect'),title=document.createElementNS(ns,'title'); rect.setAttribute('x',String(10+index*width)); rect.setAttribute('y',String(185-row.count/max*165)); rect.setAttribute('width',String(Math.max(1,width-2))); rect.setAttribute('height',String(row.count/max*165)); rect.setAttribute('fill','${adminBrandColors.secondary}'); title.textContent=message('chartPoint',{date:row.date,count:row.count}); rect.append(title); svg.append(rect); });
    const label=document.createElementNS(ns,'text'); label.setAttribute('x','10'); label.setAttribute('y','205'); label.textContent=message('trendLabel',{start:rows[0]?.date || '',end:rows.at(-1)?.date || '',max:actualMax}); svg.append(label); return svg;
  }
  function methodTable(methods,personal=false,total=0) {
    return table([t.method,t.category,personal ? t.practiceDays : t.personDays,personal ? t.personalShare : t.selectionShare],methods.map(row=>{
      const percentage=personal ? (total ? row.days*100/total : 0) : row.share;
      const bar=node('div',undefined,'bar'),fill=node('span'); fill.style.width=Math.min(100,percentage)+'%'; bar.append(fill);
      const share=node('div',personal ? percentage.toFixed(1)+'%' : percentage+'%'); share.append(bar);
      return [row.name,row.parent_name || '—',row.days,share];
    }));
  }
  async function load() {
    const own=++generation,q=query(); $('status').textContent=t.loading; $('status').dataset.error='false';
    const root=node('div');
    try {
      const overview=await api('overview',q);
      if(own!==generation) return;
      $('range').textContent=message('range',{start:overview.range.start,end:overview.range.today,timezone:overview.range.timezone});
      const regionSelect=$('region'); const wanted=regionSelect.value || regionWanted; regionSelect.replaceChildren();
      const all=node('option',t.allRegions); all.value=''; regionSelect.append(all);
      for(const region of overview.regions) { const option=node('option',region.name); option.value=region.id; regionSelect.append(option); }
      if(wanted && !overview.regions.some(region=>region.id===wanted)) { const unavailable=node('option',t.unavailableRegion); unavailable.value=wanted; regionSelect.append(unavailable); }
      regionSelect.value=wanted; regionWanted='';
      if(mode==='overview') {
        const kpis=node('div',undefined,'kpis');
        for(const [label,value] of [[t.checkinPersonDays,overview.kpis.total_checkins],[t.practicingLearners,overview.kpis.active_users],[t.averageDaily,overview.kpis.average_daily],[t.activeLearners,overview.kpis.learners]]) { const item=node('section',undefined,'card kpi'); item.append(node('span',label),node('strong',value)); kpis.append(item); } root.append(kpis);
        const trend=card(t.dailyTrend),details=node('details'); details.append(node('summary',t.dailyValues),table([t.date,t.checkinCount],overview.trend.map(row=>[row.date,row.count]))); trend.append(chart(overview.trend),details); root.append(trend);
        const date=$('date').value || overview.range.today; $('date').value=date; $('date').max=overview.range.today;
        const lists=await Promise.all(['checked','pending'].map(state=>api('status',withValues(q,{date,state,page:state==='checked'?checkedPage:pendingPage}))));
        const grid=node('div',undefined,'grid'); lists.forEach((data,index)=>{ const panel=card(message(index===0?'checkedTitle':'pendingTitle',{count:data.total})); panel.append(table([t.learner,t.region,t.platform],data.rows.map(row=>[personLink(row),row.region_name,row.platforms]))); pager(panel,data,page=>{ if(index===0) checkedPage=page; else pendingPage=page; void load(); }); grid.append(panel); }); root.append(grid);
      } else if(mode==='leaderboard') {
        const data=await api('leaderboard',withValues(q,{page:currentPage})); const grid=node('div',undefined,'grid');
        for(const [title,rows,field] of [[t.periodTotals,data.top,'period_days'],[t.periodStreaks,data.streaks,'max_streak']]) { const panel=card(title); panel.append(table([t.rank,t.learner,t.days],rows.map((row,index)=>[index+1,personLink(row),row[field]]))); grid.append(panel); } root.append(grid);
        const all=card(t.lifetimeList); all.append(table([t.learner,t.region,t.platform,t.totalDays,t.currentStreak,t.lastCheckin],data.rows.map(row=>[personLink(row),row.region_name,row.platforms,row.total_days,row.current_streak,row.last_checkin]))); pager(all,data,page=>{currentPage=page; void load();}); root.append(all);
      } else {
        const [data,people]=await Promise.all([api('methods',q),api('search',withValues(q,{page:currentPage}))]);
        const summary=card(t.methodDistribution); summary.append(node('p',t.selectionExplanation,'muted'),methodTable(data.methods)); root.append(summary);
        const search=card(t.selectLearner);
        const choices=people.rows.map(row=>{ const button=node('button',row.display_name,'secondary'); button.type='button'; button.addEventListener('click',()=>{ selectedPerson=row.id; historyPage=1; const url=new URL(location.href); url.searchParams.set('personId',row.id); history.replaceState(null,'',url.pathname+url.search); void load(); }); return [button,row.region_name,row.platforms]; });
        search.append(table([t.learner,t.region,t.platform],choices)); pager(search,people,page=>{currentPage=page; void load();}); root.append(search);
        if(selectedPerson) {
          const data=await api('person',withValues(q,{personId:selectedPerson,page:historyPage})); const detail=card(message('personalTitle',{name:data.person.display_name})); detail.append(node('p',message('personalNotice',{timezone:data.person.practice_timezone}),'muted'));
          for(const analysis of data.analyses) { detail.append(node('h3',message('personalPeriod',{days:analysis.days,total:analysis.totalDays})),methodTable(analysis.methods,true,analysis.totalDays)); }
          detail.append(node('p',t.personalExplanation,'muted')); root.append(detail);
          const historyPanel=card(t.history); historyPanel.append(table([t.practiceDate,t.practiceTimezone,t.entryType,t.platform,t.method],data.history.rows.map(row=>[row.practice_date,row.practice_timezone,row.entry_kind==='makeup'?t.makeup:t.regular,row.platform,row.methods.join(t.listSeparator)]))); pager(historyPanel,data.history,page=>{historyPage=page; void load();}); root.append(historyPanel);
        }
      }
      if(own!==generation) return;
      $('report').replaceChildren(root); $('status').textContent=t.loaded;
    } catch(error) { if(own!==generation) return; $('report').replaceChildren(); $('status').textContent=localizedFailure(error,t.loadFailed); $('status').dataset.error='true'; }
  }
  $('filters').addEventListener('submit',event=>{event.preventDefault(); currentPage=checkedPage=pendingPage=historyPage=1; selectedPerson=null; const url=new URL(location.href); url.search=query().toString(); if($('date')?.value) url.searchParams.set('date',$('date').value); history.replaceState(null,'',url.pathname+url.search); void load();});
  // Preserve a requested region for the initial fetch, before options arrive.
  if(regionWanted) { const initial=node('option',t.specifiedRegion); initial.value=regionWanted; $('region').append(initial); $('region').value=regionWanted; }
  void load();
})();`,
    locale,
    canManageAdmins
  );
};
