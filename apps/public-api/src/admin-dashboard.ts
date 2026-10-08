import {
  adminLocaleCookie,
  adminLocaleQuery,
  adminLocaleScript,
  adminTexts,
  type AdminLocale,
  type AdminTextKey
} from './admin-locale.js';
export type AdminPage = 'overview' | 'leaderboard' | 'methods' | 'review';
const navigation: ReadonlyArray<{ page: AdminPage; path: string; label: AdminTextKey }> = [
  { page: 'overview', path: '/admin/', label: 'navOverview' },
  { page: 'leaderboard', path: '/admin/leaderboard', label: 'navLeaderboard' },
  { page: 'methods', path: '/admin/method-analysis', label: 'navMethods' },
  { page: 'review', path: '/admin/applications', label: 'navReview' }
];

// All shell inputs come from source-controlled page definitions, never user data.
export const renderAdminShell = (
  page: AdminPage,
  content: string,
  script: string,
  locale: AdminLocale = 'zh_TW'
) => {
  const text = adminTexts(locale);
  const languageSwitcher = `<div class="languages" role="group" aria-label="${text.language}"><button id="language-zh-TW" type="button" lang="zh-Hant" class="${locale === 'zh_TW' ? '' : 'secondary'}" aria-pressed="${locale === 'zh_TW'}">繁體中文</button><button id="language-en" type="button" lang="en" class="${locale === 'en' ? '' : 'secondary'}" aria-pressed="${locale === 'en'}">English</button></div>`;
  return `<!doctype html>
<html lang="${locale === 'en' ? 'en' : 'zh-Hant'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${text[page]}｜${text.siteTitle}</title>
<style>
:root { color-scheme: light; --green:#285c3b; --muted:#61746b; --border:#dce6df; }
* { box-sizing:border-box; } body { margin:0; color:#203027; background:#f3f6f4; font-family:system-ui,sans-serif; line-height:1.6; }
a { color:var(--green); } .shell { display:grid; grid-template-columns:15rem minmax(0,1fr); min-height:100vh; }
.sidebar { background:#193e2b; color:#edf7ef; padding:2rem 1.25rem; } .brand { font-size:1.3rem; font-weight:700; margin-bottom:1.25rem; } .brand small { display:block; font-size:.8rem; opacity:.7; font-weight:400; }
nav { display:grid; gap:.6rem; } nav a { color:#d9eadd; padding:.7rem 1rem; text-decoration:none; border-radius:.5rem; } nav a:hover,nav a[aria-current="page"] { background:#366448; color:white; }
.workspace { padding:1.5rem clamp(1rem,3vw,3rem); min-width:0; } header { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem; margin-bottom:1.5rem; } h1 { font-size:1.7rem; margin:0; } h2 { font-size:1.15rem; margin:0 0 1rem; } h3 { font-size:1rem; }
 .header-actions,.languages { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; } .header-actions { margin-left:auto; }
.sidebar .languages { margin-bottom:1.25rem; } .sidebar .languages button { flex:1 1 auto; border-color:#93bfa0; background:#edf7ef; color:#193e2b; padding:.45rem .6rem; font-size:.875rem; } .sidebar .languages button.secondary { background:transparent; color:#edf7ef; } .sidebar .languages button:focus-visible { outline:2px solid #edf7ef; outline-offset:3px; }
button { cursor:pointer; padding:.55rem .9rem; border-radius:.45rem; border:1px solid var(--green); background:var(--green); color:white; font:inherit; } button:disabled { opacity:.45; cursor:default; } button.secondary,button.reject { background:white; color:var(--green); } button.reject { color:#82352f; border-color:#82352f; }
input,select { font:inherit; padding:.5rem; border:1px solid #b9cbbd; border-radius:.35rem; max-width:100%; background:white; } input[type="checkbox"] { width:auto; }
.filters { display:flex; flex-wrap:wrap; align-items:end; gap:.85rem; margin-bottom:1rem; } label { display:grid; gap:.3rem; font-size:.85rem; } .filters input { width:12rem; } .filters select { min-width:8rem; }
.card,article { background:white; border:1px solid var(--border); border-radius:.75rem; padding:1.25rem; margin-bottom:1.2rem; } .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1.2rem; } .kpis { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:1rem; } .kpi strong { display:block; font-size:2rem; color:var(--green); } .muted,.meta { color:var(--muted); } #status { min-height:1.6rem; } #status[data-error="true"] { color:#a12c24; }
.table-wrap { overflow:auto; } table { width:100%; border-collapse:collapse; font-size:.9rem; } th,td { text-align:left; padding:.65rem; border-bottom:1px solid var(--border); vertical-align:top; white-space:nowrap; } th { color:var(--muted); background:#f8faf8; } .pager { display:flex; flex-wrap:wrap; align-items:center; gap:.7rem; margin-top:1rem; }
.chart { width:100%; height:210px; } .bar { background:#e7eee8; height:.5rem; border-radius:.25rem; } .bar span { display:block; height:100%; background:#62976e; border-radius:inherit; } .actions,.batch { display:flex; flex-wrap:wrap; align-items:center; gap:.6rem; } .batch { margin-bottom:1rem; } .batch label { display:flex; align-items:center; } .select-application { margin-right:.5rem; } .actions input { width:min(25rem,100%); }
footer { font-size:.75rem; color:var(--muted); margin-top:2rem; } details summary { cursor:pointer; } .skip { position:absolute; left:-9999px; } .skip:focus { left:1rem; top:1rem; background:white; padding:1rem; z-index:2; }
@media(max-width:1000px) { .kpis { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:760px) { .shell { display:block; } .sidebar { padding:1rem; } .brand { margin-bottom:.7rem; } nav { display:flex; flex-wrap:wrap; gap:.3rem; } nav a { padding:.4rem .7rem; } .grid { grid-template-columns:1fr; } .workspace { padding:1rem; } h1 { font-size:1.35rem; } }
</style></head><body><a class="skip" href="#main">${text.skip}</a><div class="shell"><aside class="sidebar"><div class="brand">${text.brand}<small>${text.brandSubtitle}</small></div>${languageSwitcher}<nav aria-label="${text.navigation}">${navigation.map((item) => `<a href="${item.path + adminLocaleQuery(locale)}"${item.page === page ? ' aria-current="page"' : ''}>${text[item.label]}</a>`).join('')}</nav></aside>
<div class="workspace"><header><div><h1>${text[page]}</h1><span class="muted">${text.scope}</span></div><div class="header-actions"><button id="logout" class="secondary" type="button">${text.logout}</button></div></header><div id="main">${content}</div><footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer></div></div>
<script>
(() => {
  ${adminLocaleScript(locale)}
  for (const [id,next] of [['language-zh-TW','zh_TW'],['language-en','en']]) document.getElementById(id).addEventListener('click',() => {
    if(next === locale) return;
    if(${JSON.stringify(page === 'review')} && !confirm(t.reviewSwitchConfirm)) return;
    const url=new URL(location.href); url.searchParams.set('lang',next);
    document.cookie='${adminLocaleCookie}='+next+'; Path=/; Max-Age=31536000; Secure; SameSite=Lax';
    location.assign(url.pathname+url.search+url.hash);
  });
  document.getElementById('logout').addEventListener('click',async () => {
    const csrf = document.cookie.split('; ').find(part => part.startsWith('__Host-qigong-admin-csrf='))?.split('=')[1] || '';
    try {
      const response = await fetch('/admin/auth/logout',{ method:'POST',credentials:'same-origin',headers:{'x-csrf-token':csrf} });
      if (response.ok || response.status===401) location.assign('/admin/auth/login');
      else throw new Error(t.logoutFailed);
    } catch { document.getElementById('status').textContent=t.logoutFailed; }
  });
})();
${script}
</script></body></html>`;
};

export const renderAdminDashboard = (
  page: Exclude<AdminPage, 'review'>,
  locale: AdminLocale = 'zh_TW'
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
    rows.forEach((row,index)=>{ const rect=document.createElementNS(ns,'rect'),title=document.createElementNS(ns,'title'); rect.setAttribute('x',String(10+index*width)); rect.setAttribute('y',String(185-row.count/max*165)); rect.setAttribute('width',String(Math.max(1,width-2))); rect.setAttribute('height',String(row.count/max*165)); rect.setAttribute('fill','#62976e'); title.textContent=message('chartPoint',{date:row.date,count:row.count}); rect.append(title); svg.append(rect); });
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
    locale
  );
};
