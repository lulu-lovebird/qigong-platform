import { renderAdminShell } from './admin-dashboard.js';
import { adminTexts, type AdminLocale } from './admin-locale.js';
import { achievementTexts } from './admin-achievement-locale.js';
import { badgeIcons, fallbackBadgeIcon } from './badge-icons.js';
import { legacyBadgeAliasNotice } from './legacy-badge-names.js';

export const renderAdminAchievementsPage = (locale: AdminLocale, canManageAdmins = false) => {
  const text = { ...adminTexts(locale), ...achievementTexts(locale) };
  return renderAdminShell(
    'achievements',
    `
<style>
.achievements-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:.65rem}.achievement-card{min-width:0}.achievement-card h3{overflow-wrap:anywhere}.achievement-icon{font-size:1.7rem;margin-right:.4rem}.achievement-card p{margin:.4rem 0}#achievements-year{width:10rem;max-width:100%}.achievement-table{overflow:auto;max-width:100%}.achievement-table td{vertical-align:top;overflow-wrap:anywhere}.achievement-records{padding-left:1.2rem;margin:0}.achievement-pager{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem;margin-top:.6rem}.achievement-export-actions{display:flex;align-items:end;flex-wrap:wrap;gap:.6rem;margin:.6rem 0}.achievement-export-link{display:inline-flex;align-items:center;min-height:var(--admin-control-height);padding:.4rem .6rem;text-decoration:underline}@media(max-width:600px){.achievements-grid{grid-template-columns:minmax(0,1fr)}}
</style>
<section class="card"><p>${text.intro}</p><p class="muted" id="achievements-readonly">${text.readOnly}</p>
<form id="achievements-filters" class="filters">
<label>${text.region}<select id="achievements-region"><option value="">${text.allRegions}</option></select></label>
<label>${text.currentChannel}<select id="achievements-platform"><option value="">${text.allChannels}</option><option value="line">LINE</option><option value="telegram">Telegram</option><option value="whatsapp">WhatsApp</option></select></label>
<label>${text.learnerName}<input id="achievements-q" type="search" maxlength="100" autocomplete="off"></label>
<label>${text.category}<select id="achievements-category"><option value="">${text.allCategories}</option>${(['streak', 'total', 'time', 'seasonal', 'combo', 'method', 'event', 'challenge'] as const).map((key) => `<option value="${key}">${text[key]}</option>`).join('')}</select></label>
<label>${text.seasonalYear}<input id="achievements-year" type="number" min="2000" max="2200" placeholder="${text.allYears}"></label>
<button type="submit">${text.applyFilters}</button></form><p class="muted">${text.yearHelp}</p>
<p id="achievements-status" role="status" aria-live="polite"></p><button id="achievements-retry" type="button" hidden>${text.retry}</button></section>
<p id="achievements-observed" class="muted"></p><div id="achievements-catalog"></div>
<section id="achievements-recipients" class="card" tabindex="-1" aria-live="polite"><p>${text.selectBadge}</p></section>`,
    `
(() => {
 const legacyAliasText=${JSON.stringify(legacyBadgeAliasNotice(locale))};
 const t=${JSON.stringify(text)}, icons=${JSON.stringify(badgeIcons)}, fallback=${JSON.stringify(fallbackBadgeIcon)}, locale=${JSON.stringify(locale)};
 const $=id=>document.getElementById(id), node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;};
 const message=(text,values={})=>text.replace(/\\{([a-zA-Z]+)\\}/g,(_,key)=>String(values[key]??''));
 const initial=new URL(location.href);let selected=initial.searchParams.get('badge'),selectedVersion=initial.searchParams.get('version'),page=1,category=initial.searchParams.get('category')||'',catalog=[],applied=new URLSearchParams(),catalogGeneration=0,recipientGeneration=0,canExport=false,catalogController,recipientController,exportController;
 for(const key of ['region','platform','q','year']){const value=initial.searchParams.get(key)||'';if(key==='region'&&value){const option=node('option',t.specifiedRegion);option.value=value;$('achievements-region').append(option);} $('achievements-'+key).value=value;}
 $('achievements-category').value=category;
 const group=kind=>kind==='morning'||kind==='night'?'time':kind==='summer'||kind==='winter'?'seasonal':kind;
 const timestamp=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat(locale==='en'?'en':locale==='zh_CN'?'zh-CN':'zh-TW',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(date):'—';};
 const period=value=>value==='lifetime'?t.lifetime:value;
 const failure=status=>status===401?t.loginExpired:status===403?t.permissionDenied:status===400?t.invalidFilter:t.unavailable;
 const setStatus=(text,error=false)=>{$('achievements-status').textContent=text;$('achievements-status').dataset.error=String(error);$('achievements-retry').hidden=!error;};
 const clear=()=>{$('achievements-catalog').replaceChildren();$('achievements-recipients').replaceChildren();$('achievements-observed').textContent='';};
 const clearAuthorization=()=>{catalogGeneration++;recipientGeneration++;catalogController?.abort();recipientController?.abort();exportController?.abort();exportController=undefined;canExport=false;catalog=[];clear();};
 const get=async(path,params,signal)=>{const response=await fetch(path+'?'+params,{credentials:'same-origin',cache:'no-store',signal});if(!response.ok){const error=new Error('Achievement request failed');error.status=response.status;throw error;}return response.json();};
 const updateUrl=()=>{const url=new URL(location.href);url.search=applied.toString();if(selected)url.searchParams.set('badge',selected);if(selectedVersion)url.searchParams.set('version',selectedVersion);if(category)url.searchParams.set('category',category);history.replaceState(null,'',url.pathname+url.search);};
 const condition=badge=>badge.configurationKnown===false?t.unknownCondition:['event','challenge'].includes(badge.kind)?message(badge.kind==='event'?t.conditionEvent:t.conditionChallenge,{mode:badge.continuous?t.consecutive:t.cumulative,days:badge.threshold,start:badge.progressStartDate||badge.effectiveDate||badge.startDate||'—',end:badge.endDate||'—',match:badge.methodMatch==='all'?t.matchAll:t.matchAny}):message(t[({streak:'conditionStreak',total:'conditionTotal',method:'conditionMethod',combo:'conditionCombo',morning:'conditionMorning',night:'conditionNight',summer:'conditionSummer',winter:'conditionWinter'})[badge.kind]],{days:badge.threshold});
 const csrf=()=>((document.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith('__Host-qigong-admin-csrf='))||'').slice('__Host-qigong-admin-csrf='.length);
 const post=async(path,values,signal)=>{const response=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','x-csrf-token':csrf()},body:JSON.stringify(values),signal});if(!response.ok){const error=new Error('Export refused');error.status=response.status;throw error;}return response;};
 async function exportRecipients(purpose,link){
  if(!canExport||exportController)return;const code=selected,version=selectedVersion,values={...Object.fromEntries(applied.entries()),...(version?{version}:{})},own=recipientGeneration,controller=new AbortController();exportController=controller;const signal=controller.signal;
  const current=()=>!signal.aborted&&own===recipientGeneration&&selected===code&&selectedVersion===version;
  link.setAttribute('aria-disabled','true');link.textContent=t.exportPreparing;
  try{
   const preview=await(await post('/admin/api/achievements/'+encodeURIComponent(code)+'/export/preview',values,signal)).json();if(!current())return;
   if(version&&preview.ruleVersion!==Number(version)){const e=new Error('Export version mismatch');e.status=409;throw e;}if(preview.overLimit){setStatus(t.exportTooLarge,true);return;}
   if(!confirm(message(version?t.exportVersionConfirm:t.exportConfirm,{name:preview.name,count:preview.count,version:preview.ruleVersion}))||!current())return;
   const response=await post('/admin/api/achievements/'+encodeURIComponent(code)+'/export',{...values,purpose,confirmed:true},signal),blob=await response.blob();if(!current())return;
   let filename='achievement-'+code+'.csv';const encoded=(response.headers.get('content-disposition')||'').split("filename*=UTF-8''")[1]?.split(';')[0];try{if(encoded)filename=decodeURIComponent(encoded);}catch{ /* Keep the safe fallback. */ }
   const objectUrl=URL.createObjectURL(blob),anchor=node('a');anchor.href=objectUrl;anchor.download=filename;document.body.append(anchor);try{anchor.click();}finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}setStatus(t.exportPrepared);
  }catch(error){if(!current())return;if(error.status===401||error.status===403)clearAuthorization();setStatus(error.status===429?t.exportRateLimited:error.status===413?t.exportTooLarge:error.status===401||error.status===403?failure(error.status):t.exportFailure,true);}
  finally{if(exportController===controller)exportController=undefined;link.setAttribute('aria-disabled','false');link.textContent=t.csvExport;}
 }
 function renderCatalog(){
  const root=node('div');let count=0;
  for(const kind of ['streak','total','time','seasonal','combo','method','event','challenge']){
   const badges=catalog.filter(b=>group(b.kind)===kind&&(!category||category===kind));if(!badges.length)continue;
   root.append(node('h2',t[kind]));const grid=node('div',undefined,'achievements-grid');
   for(const badge of badges){count++;const card=node('article',undefined,'card achievement-card'),heading=node('h3');
    heading.append(node('span',Object.hasOwn(icons,badge.code)?icons[badge.code]:fallback,'achievement-icon'),document.createTextNode(badge.displayName??badge.name));card.append(heading,node('p',condition(badge)),node('p',message(t.ruleVersion,{version:badge.ruleVersion}),'muted'));if(badge.displayName)card.append(node('p',message(legacyAliasText,{name:badge.name}),'muted'));
    if(badge.activationState)card.append(node('p',t[badge.activationState],'muted'));if(badge.versions?.length)card.append(node('p',message(t.versionsAvailable,{count:badge.versions.length}),'muted'));if(!badge.configured)card.append(node('p',t.unconfigured,'muted'));
    for(const season of badge.seasons)card.append(node('p',message(t.seasonDates,{year:season.year,start:season.startDate,end:season.endDate,zone:season.timezone,days:season.requiredDays}),'muted'));
    const button=node('button',message(t.recipientCount,{count:badge.recipientCount}),'secondary');button.type='button';button.dataset.badgeCode=badge.code;button.setAttribute('aria-label',(badge.displayName??badge.name)+' · '+button.textContent);button.addEventListener('click',()=>{selected=badge.code;selectedVersion=badge.versions?.length?String(badge.ruleVersion):null;page=1;updateUrl();void loadRecipients(true);});card.append(button);grid.append(card);
   }root.append(grid);
  }
  if(!count)root.append(node('p',t.noBadges));$('achievements-catalog').replaceChildren(root);
 }
 async function loadRecipients(reveal=false){
  exportController?.abort();exportController=undefined;
  recipientController?.abort();recipientController=new AbortController();const own=++recipientGeneration,signal=recipientController.signal;
  const target=catalog.find(b=>b.code===selected);if(!target){$('achievements-recipients').replaceChildren(node('p',t.selectBadge));return;}
  const versions=target.versions||[];if(selectedVersion&&!versions.length){$('achievements-recipients').replaceChildren();setStatus(t.invalidFilter,true);return;}if(versions.length&&!selectedVersion){selectedVersion=String(target.ruleVersion);updateUrl();}const selectedMeta=versions.find(v=>String(v.ruleVersion)===selectedVersion);if(versions.length&&!selectedMeta){$('achievements-recipients').replaceChildren();setStatus(t.invalidFilter,true);return;}
  $('achievements-recipients').replaceChildren(node('p',t.loading));
  const query=new URLSearchParams(applied);query.set('page',String(page));query.set('limit','20');if(selectedVersion)query.set('version',selectedVersion);
  try{
   const data=await get('/admin/api/achievements/'+encodeURIComponent(selected)+'/recipients',query,signal);if(own!==recipientGeneration)return;if(selectedVersion&&data.ruleVersion!==Number(selectedVersion)){$('achievements-recipients').replaceChildren();setStatus(t.invalidFilter,true);return;}
   const root=node('div'),back=node('a',t.backToCatalog),shown=selectedMeta||target;back.href='#achievements-catalog';root.append(back,node('h2',(shown.displayName??shown.name)+' · '+t.recipients));if(shown.displayName)root.append(node('p',message(legacyAliasText,{name:shown.name}),'muted'));
   if(versions.length){const label=node('label',t.versionSelect),select=node('select');select.id='achievement-version';for(const v of versions){const option=node('option',message(t.ruleVersion,{version:v.ruleVersion})+(v.isCurrent?' · '+t.versionCurrent:'')+(!v.configurationKnown?' · '+t.versionUnknown:''));option.value=String(v.ruleVersion);select.append(option);}select.value=selectedVersion;select.addEventListener('change',()=>{selectedVersion=select.value;page=1;updateUrl();void loadRecipients();});label.append(select);root.append(label,node('p',condition(selectedMeta),'muted'));for(const s of selectedMeta.seasons||[])root.append(node('p',message(t.seasonDates,{year:s.year,start:s.startDate,end:s.endDate,zone:s.timezone,days:s.requiredDays}),'muted'));}
   if(canExport){const actions=node('div',undefined,'achievement-export-actions'),label=node('label',t.exportPurpose),purpose=node('select');purpose.id='achievement-export-purpose';for(const [value,title]of [['award_contact',t.purposeAwardContact],['internal_review',t.purposeInternalReview]]){const option=node('option',title);option.value=value;purpose.append(option);}purpose.value='award_contact';label.append(purpose);const link=node('a',t.csvExport,'achievement-export-link');link.href='#achievements-recipients';link.dataset.exportCsv='true';link.addEventListener('click',event=>{event.preventDefault();void exportRecipients(purpose.value,link);});actions.append(label,link);root.append(actions,node('p',t.exportPrivacy,'muted'),node('p',t.exportTextNote,'muted'));}
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
  catalogController?.abort();recipientController?.abort();exportController?.abort();exportController=undefined;recipientGeneration++;catalogController=new AbortController();const own=++catalogGeneration,signal=catalogController.signal;clear();setStatus(t.loading);
  applied=new URLSearchParams({lang:locale});for(const key of ['region','platform','q','year']){const value=$('achievements-'+key).value.trim();if(value)applied.set(key,value);}category=$('achievements-category').value;updateUrl();
  try{
   const [data,capabilities]=await Promise.all([get('/admin/api/achievements',applied,signal),get('/admin/api/achievements/capabilities',new URLSearchParams(),signal).catch(error=>{if(error.status===401||error.status===403)throw error;return {canExportAchievements:false};})]);if(own!==catalogGeneration)return;catalog=data.badges;canExport=capabilities.canExportAchievements===true;
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
