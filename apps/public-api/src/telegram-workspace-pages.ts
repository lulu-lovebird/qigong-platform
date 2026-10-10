import type { LearnerLocale } from './learner-locale.js';
import { journalTexts } from './journal-locale.js';
import { telegramMiniappBootstrap } from './telegram-miniapp-bootstrap.js';
import { learnerPrivacyTexts } from './learner-privacy-locale.js';
import { telegramWorkspaceTexts } from './telegram-workspace-locale.js';

export type TelegramWorkspacePage = 'checkin' | 'leaderboard' | 'methods' | 'achievements';
export const telegramWorkspacePaths: Record<TelegramWorkspacePage, string> = {
  checkin: '/telegram/checkin',
  leaderboard: '/telegram/leaderboard',
  methods: '/telegram/method-analysis',
  achievements: '/telegram/achievements'
};
// Remove our capability before the official SDK caches its own init parameters.
// Telegram appends service parameters after either '?' or '&' in the fragment.
export const telegramWorkspaceBootstrap = telegramMiniappBootstrap;
export const renderTelegramWorkspacePage = (page: TelegramWorkspacePage, locale: LearnerLocale) => {
  const t = telegramWorkspaceTexts(locale);
  const sharing = journalTexts(locale);
  return `<!DOCTYPE html><html lang="${locale === 'en' ? 'en' : 'zh-Hant'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${t[page]} · ${t.title}</title>
<style>
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f6f7fb;color:#1f2937}main{max-width:760px;margin:auto;padding:20px}h1{font-size:24px;margin:0 0 10px}h2{font-size:18px;margin:0 0 12px}h3{font-size:16px;margin:0 0 8px}.card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 8px 24px #0000000d;margin-bottom:16px;min-width:0}.muted,.hint{color:#6b7280;font-size:14px;line-height:1.6}.hint{background:#eff6ff;color:#1d4ed8;padding:12px;border-radius:10px}.warning{background:#fffbeb;color:#92400e}.settings,.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.settings{justify-content:space-between;margin-bottom:14px}button,select,input,textarea{font:inherit}button{background:#0d6efd;color:white;border:0;border-radius:10px;padding:11px 15px;cursor:pointer;font-weight:600;white-space:nowrap}button:disabled{opacity:.5;cursor:not-allowed}.secondary{background:#e5e7eb;color:#1f2937}select,input[type=month]{padding:10px;border:1px solid #d1d5db;border-radius:10px;background:#fff;max-width:100%}textarea{width:100%;min-height:110px;padding:12px;border:1px solid #d1d5db;border-radius:10px;resize:vertical}nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:16px}nav a{text-align:center;display:block;border-radius:10px;padding:11px 6px;background:#e5e7eb;color:#374151;text-decoration:none;font-size:14px}nav a[aria-current]{background:#0d6efd;color:#fff}.tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;background:#f3f4f6;padding:4px;border-radius:12px;margin:12px 0}.tabs button{background:transparent;color:#374151}.tabs button[aria-selected=true]{background:#0d6efd;color:#fff}.tabs button small{display:block;font-size:12px;margin-top:4px;font-weight:500}.tabs button.makeup[aria-selected=true]{background:#b45309}.makeup-mode{border:2px solid #f59e0b}.methods-group{border-bottom:1px solid #f3f4f6;padding:6px 0}.method-head{display:flex;align-items:center;gap:10px}.method-head label{display:flex;gap:8px;align-items:center;flex:1}.toggle{width:32px;padding:5px;background:#fff;color:#374151;border:1px solid #d1d5db}.children{margin-left:40px;padding-bottom:8px}.children label{display:flex;align-items:center;gap:10px;padding:8px 0}input[type=checkbox]{width:18px;height:18px;flex-shrink:0}.tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.tag{background:#eff6ff;color:#1d4ed8;border:1px solid #93c5fd;border-radius:999px;font-size:14px;padding:8px 12px}.tag[aria-pressed=true]{background:#0d6efd;color:white}.pill{display:inline-block;border-radius:999px;padding:5px 10px;background:#eef2ff;color:#3730a3;font-size:13px;margin:4px 6px 4px 0}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.stat{background:#f8fafc;border-radius:12px;padding:14px}.stat strong{display:block;font-size:24px;margin-top:6px}.wide{width:100%}.error{color:#b91c1c}.success{color:#166534}#status{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0}fieldset{border:0;padding:0;margin:0;min-width:0}[hidden]{display:none!important}.entry{border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin-top:12px}.entry p{white-space:pre-wrap;overflow-wrap:anywhere}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:12px 8px;border-bottom:1px solid #e5e7eb}tr.self{background:#eff6ff}.bar{height:12px;background:#e5e7eb;border-radius:999px;overflow:hidden;margin:9px 0 16px}.bar>span{display:block;height:100%;background:linear-gradient(90deg,#0d6efd,#7c3aed)}.badge-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.badge{border:1px solid #e5e7eb;border-radius:14px;padding:14px;overflow-wrap:anywhere}.badge.earned{border-color:#93c5fd;background:#eff6ff}footer{text-align:center;font-size:12px;color:#6b7280;padding:20px 0;overflow-wrap:anywhere}
@media(max-width:640px){main{padding:14px}.card{padding:16px}.stats{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.stat{padding:10px}.stat .muted{font-size:12px}.stat strong{font-size:20px;overflow-wrap:anywhere}.month-nav{display:grid;grid-template-columns:1fr 1fr}.month-nav>label{grid-column:1/-1;grid-row:1;text-align:center}.month-nav>button{min-width:0}nav{grid-template-columns:repeat(2,minmax(0,1fr))}.settings{align-items:stretch}.settings>button{flex:1;min-width:0}.row>button{flex:1}.badge-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:360px){.badge-grid{grid-template-columns:1fr}}
</style></head><body><main>
<div class="settings"><button type="button" id="changeZone" class="secondary" aria-controls="zoneCard" aria-expanded="false">🌐 ${t.timezone}</button><label>${t.language} <select id="language"><option value="zh_TW"${locale === 'zh_TW' ? ' selected' : ''}>繁體中文</option><option value="en"${locale === 'en' ? ' selected' : ''}>English</option></select></label></div>
<nav aria-label="${t.title}">${(Object.keys(telegramWorkspacePaths) as TelegramWorkspacePage[]).map((item) => `<a href="${telegramWorkspacePaths[item]}?lang=${locale}" data-page="${item}"${item === page ? ' aria-current="page"' : ''}>${t[item]}</a>`).join('')}<a href="/telegram/journal?lang=${locale}" data-page="journal">${sharing.feed}</a></nav>
<section class="card" id="zoneCard" hidden><h2>${t.timezone}</h2><p class="muted">${t.zoneHelp}</p><div class="row"><label>${t.timezone} <select id="zone"></select></label><button id="confirmZone" type="button">${t.confirmZone}</button></div></section>
<section class="card"><h1>${t[page]}</h1><p class="muted">${page === 'checkin' ? t.intro : page === 'leaderboard' ? t.rankingPrivacy : page === 'methods' ? t.mixHelp : t.badgeHelp}</p><div id="stats" class="stats"></div></section>
<div id="status" role="status" aria-live="polite">${t.loading}</div><button id="reload" class="secondary" type="button">${t.reload}</button><button id="return-chat" class="secondary" type="button" hidden>${locale === 'en' ? 'Return to chat' : '返回聊天'}</button>
${page === 'checkin' ? `<fieldset id="editor" disabled><section class="card" id="dateCard"><div class="tabs" role="tablist" aria-label="${t.date}"><button id="todayTab" type="button" role="tab" aria-controls="methodsCard" aria-selected="true">${t.today}</button><button id="yesterdayTab" class="makeup" type="button" role="tab" aria-controls="methodsCard" aria-selected="false">${t.yesterday}</button></div><p id="dateStatus" class="hint"></p></section><section class="card" id="methodsCard" role="tabpanel"><h2>${t.methodHeading}</h2><div id="methodsList"></div></section><section class="card"><label for="note"><h2>${t.note}</h2></label><textarea id="note" maxlength="2000" placeholder="${t.notePlaceholder}"></textarea><p id="noteCount" class="muted"></p><h3>${t.feelings}</h3><div id="feelingTags" class="tags"></div><p id="workspace-sharing-help" class="muted">${t.privateHelp}</p><p id="workspace-reflection-help" class="muted" hidden></p></section><button id="submit" class="wide" type="button">${t.complete}</button></fieldset>` : page === 'leaderboard' ? `<section class="card"><label>${t.period} <select id="period">${(['week', 'month', 'quarter', 'year', 'all'] as const).map((period) => `<option value="${period}"${period === 'month' ? ' selected' : ''}>${t[period]}</option>`).join('')}</select></label><p id="range" class="muted"></p><p id="ownRank"></p><div id="ranking"></div></section>` : page === 'methods' ? `<section class="card"><label>${t.period} <select id="days"><option value="30">${t.days30}</option><option value="90">${t.days90}</option></select></label><p id="range" class="muted"></p><div id="mix"></div></section><section class="card"><h2>${t.journal}</h2><div id="journal"></div></section>` : `<div class="tabs" role="tablist"><button id="overviewTab" type="button" role="tab" aria-controls="overview" aria-selected="true">${t.overview}</button><button id="historyTab" type="button" role="tab" aria-controls="monthly" aria-selected="false">${t.history}</button></div><section id="overview" role="tabpanel"><div class="card"><h2>${t.level}</h2><div id="level"></div></div><div class="card"><h2>${t.badges}</h2><div id="badges" class="badge-grid"></div></div></section><section id="monthly" class="card" role="tabpanel" hidden><div class="row month-nav"><button type="button" id="previous" class="secondary">${t.previous}</button><label>${t.history} <input id="month" type="month" min="2000-01"></label><button type="button" id="next" class="secondary">${t.next}</button></div><p id="monthSummary" class="muted"></p><div id="historyEntries"></div></section>`}
<footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer></main>
<script>const workspacePage=${JSON.stringify(page)},workspaceLocale=${JSON.stringify(locale)},workspacePaths=${JSON.stringify(telegramWorkspacePaths)},workspaceText=${JSON.stringify(t)},workspacePrivacyText=${JSON.stringify(learnerPrivacyTexts(locale))};${telegramWorkspaceBootstrap}</script><script src="https://telegram.org/js/telegram-web-app.js"></script><script>${telegramWorkspaceScript}</script></body></html>`;
};

// String.raw keeps browser-script escapes intact; source is syntax-tested independently.
export const telegramWorkspaceScript = String.raw`
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = workspaceText, page = workspacePage, locale = workspaceLocale;
  let token = workspaceCredential;
  history.replaceState(null, '', location.pathname + location.search);
  const validToken = /^[A-Za-z0-9_-]{43}$/.test(token)||!!window.Telegram?.WebApp?.initData;
  let profile = null, selectedDate = null, busy = false, writing = false, leaving = false, loadSequence = 0, needsRefresh = false;
  const drafts = new Map(), baselines = new Map();
  const node = (tag, text, className) => { const element=document.createElement(tag); if(text!==undefined)element.textContent=text; if(className)element.className=className; return element; };
  const status = (text, error=false) => { $('status').textContent=text; $('status').className=error?'error':'success'; };
  const signature = draft => JSON.stringify({methods:[...draft.methods].sort(),practiceNote:draft.practiceNote,feelingTagIds:[...draft.feelingTagIds].sort()});
  const blank = entry => ({methods:(entry?.methods||[]).map(m=>m.code),practiceNote:entry?.practiceNote||'',feelingTagIds:(entry?.feelingTags||[]).map(tag=>tag.id),version:entry?.version||0,requestId:null});
  const syncClosing = () => {
    const app=window.Telegram?.WebApp;if(!app?.enableClosingConfirmation||!app?.disableClosingConfirmation)return;
    const changed=Array.from(drafts).some(([date,draft])=>signature(draft)!==baselines.get(date))||(profile&&$('zone').value!==profile.timezone);
    if(!leaving&&(writing||changed))app.enableClosingConfirmation();else app.disableClosingConfirmation();
  };
  const capture = () => {
    if(page!=='checkin'||!selectedDate||!drafts.has(selectedDate))return;
    const draft=drafts.get(selectedDate), previous=signature(draft);
    draft.methods=Array.from(document.querySelectorAll('[data-method]:checked')).map(input=>input.dataset.method);
    draft.practiceNote=$('note').value;
    draft.feelingTagIds=Array.from(document.querySelectorAll('[data-feeling][aria-pressed="true"]')).map(button=>button.dataset.feeling);
    if(previous!==signature(draft))draft.requestId=null;syncClosing();
  };
  const dirty = (includeZone=true) => { capture(); return Array.from(drafts).some(([date,draft])=>signature(draft)!==baselines.get(date))||(includeZone&&profile&&$('zone').value!==profile.timezone); };
  const mayLeave = (includeZone=true) => !busy && (!dirty(includeZone)||window.confirm(t.discard));
  const api = async (path, values={}) => {
    token=await workspaceAuthorization();
    const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,locale,...values}),cache:'no-store',signal:typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(15000):undefined});
    const body=await response.json();
    if(!response.ok) { const error=new Error(body.error||'workspace_unavailable'); error.status=response.status; throw error; }
    return body;
  };
  const showError = error => status(error.status===401||error.status===403?t.expired:error.status===409?t.conflict:t.failed,true);
  const setBusy = value => {
    busy=value;syncClosing();
    if($('editor'))$('editor').disabled=value||!profile?.confirmed;
    for(const id of ['language','changeZone','confirmZone','reload','todayTab','yesterdayTab','period','days','month','previous','next','overviewTab','historyTab','return-chat'])if($(id))$(id).disabled=value;
    if(!value&&profile&&$('month')){$('previous').disabled=$('month').value<='2000-01';$('next').disabled=$('month').value>=profile.today.slice(0,7);}
  };
  const earlier = date => { const value=new Date(date+'T00:00:00Z');value.setUTCDate(value.getUTCDate()-1);return value.toISOString().slice(0,10); };
  const metrics = data => {
    $('stats').replaceChildren();
    for(const [key,label]of [['totalDays','total'],['currentStreak','streak'],['longestStreak','longest']]) {
      const card=node('div',undefined,'stat');card.append(node('span',t[label],'muted'),node('strong',String(data[key])+' '+t.day));$('stats').append(card);
    }
  };
  const zones = data => {
    const options=typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):[];
    const names=[...new Set([data.timezone,'UTC','Asia/Taipei','Asia/Kuala_Lumpur','Asia/Singapore','Asia/Hong_Kong',...options])].sort();
    $('zone').replaceChildren();for(const name of names){const option=node('option',name);option.value=name;$('zone').append(option);}
    $('zone').value=data.timezone;$('changeZone').textContent='🌐 '+data.timezone+' · '+t.change;
    $('zoneCard').hidden=data.confirmed;$('changeZone').setAttribute('aria-expanded',String(!data.confirmed));
  };
  const initializeDrafts = data => {
    drafts.clear();baselines.clear();
    for(const date of [data.today,earlier(data.today)]) { const draft=blank(data.entries.find(entry=>entry.date===date));drafts.set(date,draft);baselines.set(date,signature(draft)); }
    selectedDate=selectedDate&&drafts.has(selectedDate)?selectedDate:data.today;
  };
  const entryFor = date => profile.entries.find(entry=>entry.date===date);
  const editOpen = () => selectedDate===profile.today||(selectedDate===earlier(profile.today)&&profile.makeupOpen);
  const refreshGroups = () => {
    for(const parent of document.querySelectorAll('[data-group]')) {
      const children=Array.from(document.querySelectorAll('[data-method]')).filter(input=>input.dataset.groupCode===parent.dataset.group);
      const selected=children.filter(input=>input.checked).length;parent.checked=children.length>0&&selected===children.length;parent.indeterminate=selected>0&&selected<children.length;
    }
  };
  const renderEditor = () => {
    if(page!=='checkin')return;
    const draft=drafts.get(selectedDate),entry=entryFor(selectedDate),open=editOpen(),reflectionOpen=profile.privacy?.reflectionConsent!==false;
    if($('workspace-sharing-help'))$('workspace-sharing-help').textContent=profile.privacy?.active?workspacePrivacyText.sharing:t.privateHelp;
    if($('workspace-reflection-help')){$('workspace-reflection-help').hidden=reflectionOpen;$('workspace-reflection-help').textContent=workspacePrivacyText.reflectionRequired;}
    $('todayTab').replaceChildren(node('span',t.today),node('small',profile.today));$('yesterdayTab').replaceChildren(node('span',t.yesterday),node('small',earlier(profile.today)));
    $('todayTab').setAttribute('aria-selected',String(selectedDate===profile.today));$('yesterdayTab').setAttribute('aria-selected',String(selectedDate!==profile.today));
    $('dateCard').className='card'+(selectedDate!==profile.today?' makeup-mode':'');
    $('dateStatus').textContent=!profile.confirmed?t.zoneRequired:!open?t.closed:entry?t.recorded:t.intro;
    $('methodsList').replaceChildren();
    const groups=new Map();for(const method of profile.methods){if(!groups.has(method.groupCode))groups.set(method.groupCode,[]);groups.get(method.groupCode).push(method);}
    for(const [code,methods]of groups) {
      const wrapper=node('div',undefined,'methods-group'),head=node('div',undefined,'method-head'),children=node('div',undefined,'children');
      if(methods.length===1&&code===methods[0].code){const method=methods[0],label=node('label'),input=node('input');input.type='checkbox';input.dataset.method=method.code;input.dataset.groupCode=code;input.checked=draft.methods.includes(method.code);input.disabled=!open;input.onchange=()=>{capture();refreshGroups();};label.append(input,node('span',method.name));head.append(label);wrapper.append(head);$('methodsList').append(wrapper);continue;}
      const label=node('label'),parent=node('input');parent.type='checkbox';parent.dataset.group=code;parent.disabled=!open;
      label.append(parent,node('span',methods[0].group+' · '+t.selectAll));head.append(label);
      const toggle=node('button','−','toggle');toggle.type='button';toggle.setAttribute('aria-label',t.expand+' '+methods[0].group);toggle.setAttribute('aria-expanded','true');
      toggle.onclick=()=>{children.hidden=!children.hidden;toggle.textContent=children.hidden?'+':'−';toggle.setAttribute('aria-expanded',String(!children.hidden));};head.prepend(toggle);
      parent.onchange=()=>{for(const input of children.querySelectorAll('input'))input.checked=parent.checked;capture();refreshGroups();};
      for(const method of methods){const row=node('label'),input=node('input');input.type='checkbox';input.dataset.method=method.code;input.dataset.groupCode=code;input.checked=draft.methods.includes(method.code);input.disabled=!open;input.onchange=()=>{capture();refreshGroups();};row.append(input,node('span',method.name));children.append(row);}
      wrapper.append(head,children);$('methodsList').append(wrapper);
    }
    if(!profile.methods.length)$('methodsList').append(node('p',t.noMethods,'muted'));
    $('note').value=draft.practiceNote;$('note').disabled=!open||!reflectionOpen;
    $('noteCount').textContent=[...draft.practiceNote].length+'/1000 '+t.characters;
    $('feelingTags').replaceChildren();
    const tags=new Map(profile.feelingTags.map(tag=>[tag.id,tag]));for(const tag of entry?.feelingTags||[])if(!tags.has(tag.id))tags.set(tag.id,tag);
    for(const tag of tags.values()){const button=node('button',tag.name,'tag');button.type='button';button.dataset.feeling=tag.id;button.setAttribute('aria-pressed',String(draft.feelingTagIds.includes(tag.id)));button.disabled=!open||!reflectionOpen;
      button.onclick=()=>{button.setAttribute('aria-pressed',String(button.getAttribute('aria-pressed')!=='true'));capture();};$('feelingTags').append(button);}
    $('submit').textContent=entry?t.correct:selectedDate===profile.today?t.complete:t.makeup;$('submit').disabled=needsRefresh||!open||!profile.confirmed||!profile.methods.length;
    $('editor').disabled=!profile.confirmed||busy;refreshGroups();
  };
  const entries = (root, values, journal=false) => {
    root.replaceChildren();
    const list=journal?values.filter(entry=>entry.practiceNote||entry.feelingTags.length):values;
    if(!list.length){root.append(node('p',journal?t.noJournal:t.noData,'muted'));return;}
    for(const entry of list){const card=node('article',undefined,'entry');card.append(node('h3',entry.date+(entry.kind==='makeup'?' · '+t.makeupLabel:'')),node('span',entry.timezone,'muted'));
      const methodList=node('div',undefined,'tags');for(const method of entry.methods)methodList.append(node('span',method.name,'pill'));card.append(methodList);
      if(entry.practiceNote){card.append(node('h3',t.note),node('p',entry.practiceNote));}
      if(entry.feelingTags.length){const tags=node('div',undefined,'tags');for(const tag of entry.feelingTags)tags.append(node('span',tag.name,'pill'));card.append(tags);}
      root.append(card);}
  };
  const loadReport = async () => {
    const sequence=++loadSequence;
    if(page==='checkin'){renderEditor();return;}
    const values=page==='leaderboard'?{view:'leaderboard',period:$('period').value}:page==='methods'?{view:'methods',days:Number($('days').value)}:{view:'achievements'};
    if(page==='leaderboard'){$('ranking').replaceChildren();$('ownRank').textContent='';$('range').textContent=t.loading;}
    if(page==='methods'){$('mix').replaceChildren();$('range').textContent=t.loading;}
    let data;try{data=await api('/telegram/workspace/report',values);}catch(error){if(sequence!==loadSequence)return;throw error;}if(sequence!==loadSequence)return;status('');
    if(page==='leaderboard'){
      $('range').textContent=t.range+': '+data.start+' – '+data.end;$('ownRank').textContent=t.ownRank+': '+(data.ownRank||'—')+' · '+data.ownDays+' '+t.day;
      $('ranking').replaceChildren();if(!data.rows.length){$('ranking').append(node('p',t.noData,'muted'));return;}
      const wrap=node('div',undefined,'table-wrap'),table=node('table'),head=node('tr');for(const label of [t.rank,t.learner,t.total])head.append(node('th',label));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
      for(const row of data.rows){const tr=node('tr',undefined,row.self?'self':'');for(const value of [row.rank,row.label,row.days])tr.append(node('td',String(value)));body.append(tr);}table.append(body);wrap.append(table);$('ranking').append(wrap);
    }else if(page==='methods'){
      $('range').textContent=t.range+': '+data.start+' – '+data.end;$('mix').replaceChildren();const total=data.mix.reduce((sum,item)=>sum+item.days,0);
      if(!total)$('mix').append(node('p',t.noData,'muted'));
      for(const item of data.mix){const percent=Math.round(item.days/total*1000)/10;$('mix').append(node('p',item.name+' · '+item.days+' '+t.day+' · '+percent+'%'));const bar=node('div',undefined,'bar'),fill=node('span');fill.style.width=percent+'%';bar.append(fill);$('mix').append(bar);}entries($('journal'),data.entries,true);
    }else{
      metrics(data);const levels=[0,30,90,200],index=levels.filter(threshold=>data.totalDays>=threshold).length-1,next=levels[index+1];$('level').replaceChildren(node('h3',t['level'+(index+1)]));
      if(next){$('level').append(node('p',t.nextLevel+' '+next+' '+t.day));const bar=node('div',undefined,'bar'),fill=node('span');fill.style.width=Math.min(100,(data.totalDays-levels[index])/(next-levels[index])*100)+'%';bar.append(fill);$('level').append(bar);}
      $('badges').replaceChildren();for(const badge of data.badges){const active=badge.awards.filter(award=>!award.revoked),card=node('article',undefined,'badge'+(active.length?' earned':''));card.append(node('h3',(active.length?'🏆 ':'🔒 ')+badge.name));
        const rules={streak:t.streakRule,total:t.totalRule,method:t.methodRule,combo:t.comboRule,morning:t.morningRule,night:t.nightRule,summer:t.seasonalRule,winter:t.seasonalRule};card.append(node('p',rules[badge.kind]+(['streak','total','method'].includes(badge.kind)?' · '+badge.threshold+' '+t.day:''),'muted'));
        card.append(node('p',!badge.configured?t.unavailable:active.length?t.earned:t.locked));for(const award of badge.awards)card.append(node('p',(award.period==='lifetime'?'':award.period+' · ')+(award.revoked?t.revoked:award.earnedAt.slice(0,10)),'muted'));$('badges').append(card);}
    }
  };
  const loadMonthly = async () => {
    const sequence=++loadSequence,month=$('month').value;
    $('historyEntries').replaceChildren();$('monthSummary').textContent=t.loading;
    let data;try{data=await api('/telegram/workspace/report',{view:'history',month});}catch(error){if(sequence!==loadSequence)return;throw error;}if(sequence!==loadSequence)return;status('');
    entries($('historyEntries'),data.entries);$('monthSummary').textContent=data.month+' · '+data.entries.length+' '+t.day;
    $('previous').disabled=busy||month<='2000-01';$('next').disabled=busy||month>=profile.today.slice(0,7);
  };
  const reload = async () => {
    const sequence=++loadSequence,statusBefore=$('status').textContent;setBusy(true);status(t.loading);
    try {const data=await api('/telegram/workspace/profile');if(sequence!==loadSequence)return;profile=data;metrics(data);zones(data);
      if(page==='checkin')initializeDrafts(data);
      if(page==='achievements'){$('month').max=data.today.slice(0,7);if(!$('month').value)$('month').value=data.today.slice(0,7);}
      if(page==='achievements'&&!$('monthly').hidden)await loadMonthly();else await loadReport();
      needsRefresh=false;if(page==='checkin'&&!data.confirmed)status(t.zoneRequired);else status('');
    }catch(error){if(profile&&statusBefore===t.saved)status(t.savedRefresh,true);else showError(error);}
    finally{setBusy(false);if(page==='checkin'&&profile)renderEditor();}
  };
  const closeMiniapp=()=>{const app=window.Telegram?.WebApp;if(!app?.initData||typeof app.close!=='function')return false;leaving=true;syncClosing();try{app.close();return true;}catch{leaving=false;syncClosing();return false;}};
  if($('return-chat')){$('return-chat').hidden=!window.Telegram?.WebApp?.initData;$('return-chat').onclick=()=>{if(mayLeave())closeMiniapp();};}
  $('reload').onclick=()=>{if(mayLeave())void reload();};
  for(const link of document.querySelectorAll('nav a'))link.onclick=event=>{event.preventDefault();if(mayLeave()){leaving=true;syncClosing();location.href=(link.dataset.page==='journal'?'/telegram/journal':workspacePaths[link.dataset.page])+'?lang='+locale+'#'+token;}};
  $('language').onchange=async()=>{
    const selected=$('language').value;if(!mayLeave()){$('language').value=locale;return;}setBusy(true);
    try{await api('/telegram/preferences/language',{locale:selected});leaving=true;syncClosing();location.href=workspacePaths[page]+'?lang='+selected+'#'+token;}catch(error){$('language').value=locale;showError(error);setBusy(false);if(page==='checkin'&&profile)renderEditor();}
  };
  $('changeZone').onclick=()=>{if(busy)return;$('zoneCard').hidden=!$('zoneCard').hidden;$('changeZone').setAttribute('aria-expanded',String(!$('zoneCard').hidden));if(!$('zoneCard').hidden)$('zone').focus();};
  $('zone').onchange=syncClosing;
  $('confirmZone').onclick=async()=>{
    if(!profile||!mayLeave(false))return;setBusy(true);
    try{await api('/telegram/preferences/timezone',{timezone:$('zone').value});await reload();status(t.timezoneSaved);}catch(error){status(error.status===409?t.timezoneConflict:error.status===403?t.expired:t.failed,true);setBusy(false);if(page==='checkin')renderEditor();}
  };
  if(page==='checkin'){
    const selectDate=date=>{if(busy||!profile)return;capture();selectedDate=date;renderEditor();};
    $('todayTab').onclick=()=>selectDate(profile.today);$('yesterdayTab').onclick=()=>selectDate(earlier(profile.today));
    $('note').oninput=()=>{capture();$('noteCount').textContent=[...$('note').value].length+'/1000 '+t.characters;};
    $('submit').onclick=async()=>{
      if(busy||needsRefresh||!profile?.confirmed||!editOpen())return;capture();const draft=drafts.get(selectedDate);
      if(!draft.methods.length){status(t.choose,true);return;}if([...draft.practiceNote].length>1000||draft.practiceNote.includes('\0')){status(t.tooLong,true);return;}
      draft.requestId=draft.requestId||crypto.randomUUID();writing=true;setBusy(true);$('submit').textContent=t.busy;
      try{const result=await api('/telegram/workspace/save',{requestId:draft.requestId,date:selectedDate,version:draft.version,methods:draft.methods,...(profile.privacy?.reflectionConsent===false?{}:{practiceNote:draft.practiceNote,feelingTagIds:draft.feelingTagIds})});
        draft.version=result.version;draft.requestId=null;baselines.set(selectedDate,signature(draft));status(t.saved);
        writing=false;setBusy(false);if(!dirty()&&closeMiniapp())return;
        try{const data=await api('/telegram/workspace/profile');profile=data;metrics(data);zones(data);const savedDate=selectedDate;
          // Refresh only the saved date. Other date drafts and their baselines survive.
          const fresh=blank(data.entries.find(entry=>entry.date===savedDate));drafts.set(savedDate,fresh);baselines.set(savedDate,signature(fresh));renderEditor();}
        catch{needsRefresh=true;status(t.savedRefresh,true);}
      }catch(error){showError(error);}finally{writing=false;setBusy(false);renderEditor();}
    };
  }
  if(page==='leaderboard')$('period').onchange=()=>{if(!busy)void loadReport().catch(showError);};
  if(page==='methods')$('days').onchange=()=>{if(!busy)void loadReport().catch(showError);};
  if(page==='achievements'){
    const overview=show=>{if(busy)return;$('overview').hidden=!show;$('monthly').hidden=show;$('overviewTab').setAttribute('aria-selected',String(show));$('historyTab').setAttribute('aria-selected',String(!show));if(profile)void(show?loadReport():loadMonthly()).catch(showError);};
    $('overviewTab').onclick=()=>overview(true);$('historyTab').onclick=()=>overview(false);
    $('month').onchange=()=>{if(!busy)void loadMonthly().catch(showError);};
    const shift=direction=>{if(busy||!profile)return;const date=new Date($('month').value+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+direction);const month=date.toISOString().slice(0,7);if(month<'2000-01'||month>profile.today.slice(0,7))return;$('month').value=month;void loadMonthly().catch(showError);};
    $('previous').onclick=()=>shift(-1);$('next').onclick=()=>shift(1);
  }
  window.addEventListener('beforeunload',event=>{if(!leaving&&(writing||dirty())){event.preventDefault();event.returnValue='';}});
  if(!validToken){status(t.expired,true);$('reload').disabled=true;return;}
  if(window.Telegram?.WebApp){window.Telegram.WebApp.ready();window.Telegram.WebApp.expand();}
  void reload();
})();
`;
