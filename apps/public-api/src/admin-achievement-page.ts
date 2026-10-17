import { renderAdminShell } from './admin-dashboard.js';
import { adminTexts, type AdminLocale } from './admin-locale.js';
import { achievementTexts } from './admin-achievement-locale.js';
import { badgeIcons, fallbackBadgeIcon } from './badge-icons.js';

export const renderAdminAchievementsPage = (locale: AdminLocale, canManageAdmins = false) => {
  const text = { ...adminTexts(locale), ...achievementTexts(locale) };
  return renderAdminShell(
    'achievements',
    `
<style>
.achievements-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:.65rem}.achievement-card{min-width:0}.achievement-card h3{overflow-wrap:anywhere}.achievement-icon{font-size:1.7rem;margin-right:.4rem}.achievement-card p{margin:.4rem 0}#achievements-year{width:10rem;max-width:100%}.achievement-table{overflow:auto;max-width:100%}.achievement-table td{vertical-align:top;overflow-wrap:anywhere}.achievement-records{padding-left:1.2rem;margin:0}.achievement-pager{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem;margin-top:.6rem}@media(max-width:600px){.achievements-grid{grid-template-columns:minmax(0,1fr)}}
</style>
<section class="card"><p>${text.intro}</p><p class="muted" id="achievements-readonly">${text.readOnly}</p>
<form id="achievements-filters" class="filters">
<label>${text.region}<select id="achievements-region"><option value="">${text.allRegions}</option></select></label>
<label>${text.currentChannel}<select id="achievements-platform"><option value="">${text.allChannels}</option><option value="line">LINE</option><option value="telegram">Telegram</option><option value="whatsapp">WhatsApp</option></select></label>
<label>${text.learnerName}<input id="achievements-q" type="search" maxlength="100" autocomplete="off"></label>
<label>${text.category}<select id="achievements-category"><option value="">${text.allCategories}</option>${(['streak', 'total', 'time', 'seasonal', 'combo', 'method'] as const).map((key) => `<option value="${key}">${text[key]}</option>`).join('')}</select></label>
<label>${text.seasonalYear}<input id="achievements-year" type="number" min="2000" max="2200" placeholder="${text.allYears}"></label>
<button type="submit">${text.applyFilters}</button></form><p class="muted">${text.yearHelp}</p>
<p id="achievements-status" role="status" aria-live="polite"></p><button id="achievements-retry" type="button" hidden>${text.retry}</button></section>
<p id="achievements-observed" class="muted"></p><div id="achievements-catalog"></div>
<section id="achievements-recipients" class="card" tabindex="-1" aria-live="polite"><p>${text.selectBadge}</p></section>`,
    `
(() => {
 const t=${JSON.stringify(text)}, icons=${JSON.stringify(badgeIcons)}, fallback=${JSON.stringify(fallbackBadgeIcon)}, locale=${JSON.stringify(locale)};
 const $=id=>document.getElementById(id), node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;};
 const message=(text,values={})=>text.replace(/\\{([a-zA-Z]+)\\}/g,(_,key)=>String(values[key]??''));
 const initial=new URL(location.href);let selected=initial.searchParams.get('badge'),page=1,category=initial.searchParams.get('category')||'',catalog=[],applied=new URLSearchParams(),catalogGeneration=0,recipientGeneration=0,catalogController,recipientController;
 for(const key of ['region','platform','q','year']){const value=initial.searchParams.get(key)||'';if(key==='region'&&value){const option=node('option',t.specifiedRegion);option.value=value;$('achievements-region').append(option);} $('achievements-'+key).value=value;}
 $('achievements-category').value=category;
 const group=kind=>kind==='morning'||kind==='night'?'time':kind==='summer'||kind==='winter'?'seasonal':kind;
 const timestamp=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat(locale==='en'?'en':locale==='zh_CN'?'zh-CN':'zh-TW',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(date):'—';};
 const period=value=>value==='lifetime'?t.lifetime:value;
 const failure=status=>status===401?t.loginExpired:status===403?t.permissionDenied:status===400?t.invalidFilter:t.unavailable;
 const setStatus=(text,error=false)=>{$('achievements-status').textContent=text;$('achievements-status').dataset.error=String(error);$('achievements-retry').hidden=!error;};
 const clear=()=>{$('achievements-catalog').replaceChildren();$('achievements-recipients').replaceChildren();$('achievements-observed').textContent='';};
 const clearAuthorization=()=>{catalogGeneration++;recipientGeneration++;catalogController?.abort();recipientController?.abort();catalog=[];clear();};
 const get=async(path,params,signal)=>{const response=await fetch(path+'?'+params,{credentials:'same-origin',cache:'no-store',signal});if(!response.ok){const error=new Error('Achievement request failed');error.status=response.status;throw error;}return response.json();};
 const updateUrl=()=>{const url=new URL(location.href);url.search=applied.toString();if(selected)url.searchParams.set('badge',selected);if(category)url.searchParams.set('category',category);history.replaceState(null,'',url.pathname+url.search);};
 const condition=badge=>message(t[({streak:'conditionStreak',total:'conditionTotal',method:'conditionMethod',combo:'conditionCombo',morning:'conditionMorning',night:'conditionNight',summer:'conditionSummer',winter:'conditionWinter'})[badge.kind]],{days:badge.threshold});
 function renderCatalog(){
  const root=node('div');let count=0;
  for(const kind of ['streak','total','time','seasonal','combo','method']){
   const badges=catalog.filter(b=>group(b.kind)===kind&&(!category||category===kind));if(!badges.length)continue;
   root.append(node('h2',t[kind]));const grid=node('div',undefined,'achievements-grid');
   for(const badge of badges){count++;const card=node('article',undefined,'card achievement-card'),heading=node('h3');
    heading.append(node('span',Object.hasOwn(icons,badge.code)?icons[badge.code]:fallback,'achievement-icon'),document.createTextNode(badge.name));card.append(heading,node('p',condition(badge)),node('p',message(t.ruleVersion,{version:badge.ruleVersion}),'muted'));
    if(!badge.configured)card.append(node('p',t.unconfigured,'muted'));
    for(const season of badge.seasons)card.append(node('p',message(t.seasonDates,{year:season.year,start:season.startDate,end:season.endDate,zone:season.timezone,days:season.requiredDays}),'muted'));
    const button=node('button',message(t.recipientCount,{count:badge.recipientCount}),'secondary');button.type='button';button.dataset.badgeCode=badge.code;button.setAttribute('aria-label',badge.name+' · '+button.textContent);button.addEventListener('click',()=>{selected=badge.code;page=1;updateUrl();void loadRecipients(true);});card.append(button);grid.append(card);
   }root.append(grid);
  }
  if(!count)root.append(node('p',t.noBadges));$('achievements-catalog').replaceChildren(root);
 }
 async function loadRecipients(reveal=false){
  recipientController?.abort();recipientController=new AbortController();const own=++recipientGeneration,signal=recipientController.signal;
  const target=catalog.find(b=>b.code===selected);if(!target){$('achievements-recipients').replaceChildren(node('p',t.selectBadge));return;}
  $('achievements-recipients').replaceChildren(node('p',t.loading));
  const query=new URLSearchParams(applied);query.set('page',String(page));query.set('limit','20');
  try{
   const data=await get('/admin/api/achievements/'+encodeURIComponent(selected)+'/recipients',query,signal);if(own!==recipientGeneration)return;
   const root=node('div'),back=node('a',t.backToCatalog);back.href='#achievements-catalog';root.append(back,node('h2',target.name+' · '+t.recipients));
   if(!data.rows.length)root.append(node('p',t.noRecipients));
   else{
    const table=node('table'),head=node('thead'),headRow=node('tr');for(const label of [t.learner,t.region,t.currentChannel,t.awardPeriods,t.recordedAt])headRow.append(node('th',label));head.append(headRow);table.append(head);const body=node('tbody');
    for(const person of data.rows){const row=node('tr'),name=node('td'),link=node('a',person.displayName||t.unnamedLearner);link.href='/admin/method-analysis?'+new URLSearchParams({personId:person.personId,lang:locale});name.append(link);row.append(name,node('td',person.regionName||'—'),node('td',person.platform==='line'?'LINE':person.platform==='telegram'?'Telegram':person.platform==='whatsapp'?'WhatsApp':'—'));
     const periods=node('td'),recorded=node('td');for(const award of person.awards){periods.append(node('div',period(award.period)+' · '+message(t.ruleVersion,{version:award.ruleVersion})));recorded.append(node('div',timestamp(award.earnedAt)));}row.append(periods,recorded);body.append(row);
    }table.append(body);const wrap=node('div',undefined,'achievement-table');wrap.append(table);root.append(wrap);
   }
   const pager=node('div',undefined,'achievement-pager');pager.append(node('span',message(t.pager,{page:data.page,pages:data.totalPages,total:data.total})));
   for(const [label,next,disabled] of [[t.previous,page-1,page<=1],[t.next,page+1,page>=data.totalPages]]){const button=node('button',label,'secondary');button.type='button';button.disabled=disabled;button.addEventListener('click',()=>{page=next;void loadRecipients(true);});pager.append(button);}root.append(pager);$('achievements-recipients').replaceChildren(root);if(reveal){$('achievements-recipients').scrollIntoView({block:'start',behavior:'smooth'});$('achievements-recipients').focus({preventScroll:true});}
  }catch(error){if(signal.aborted||own!==recipientGeneration)return;if(error.status===401||error.status===403)clearAuthorization();else $('achievements-recipients').replaceChildren();setStatus(failure(error.status),true);}
 }
 async function loadCatalog(){
  catalogController?.abort();recipientController?.abort();recipientGeneration++;catalogController=new AbortController();const own=++catalogGeneration,signal=catalogController.signal;clear();setStatus(t.loading);
  applied=new URLSearchParams({lang:locale});for(const key of ['region','platform','q','year']){const value=$('achievements-'+key).value.trim();if(value)applied.set(key,value);}category=$('achievements-category').value;updateUrl();
  try{
   const data=await get('/admin/api/achievements',applied,signal);if(own!==catalogGeneration)return;catalog=data.badges;
   const wanted=applied.get('region')||'',select=$('achievements-region');select.replaceChildren();const all=node('option',t.allRegions);all.value='';select.append(all);for(const region of data.regions){const option=node('option',region.name);option.value=region.id;select.append(option);}if(wanted&&!data.regions.some(r=>r.id===wanted)){const option=node('option',t.unavailableRegion);option.value=wanted;select.append(option);}select.value=wanted;
   renderCatalog();$('achievements-observed').textContent=message(t.observedAt,{time:timestamp(data.observedAt)});setStatus(t.loaded);await loadRecipients();
  }catch(error){if(signal.aborted||own!==catalogGeneration)return;clearAuthorization();setStatus(failure(error.status),true);}
 }
 $('achievements-filters').addEventListener('submit',event=>{event.preventDefault();page=1;void loadCatalog();});
 $('achievements-retry').addEventListener('click',()=>{page=1;void loadCatalog();});
 void loadCatalog();
})();`,
    locale,
    canManageAdmins
  );
};
