import { renderAdminShell } from './admin-dashboard.js';
import type { AdminLocale } from './admin-locale.js';
import { learnerPrivacyTexts } from './learner-privacy-locale.js';
import { renderPrivacyDocument } from './learner-privacy-pages.js';
import { learnerPrivacyHash, learnerPrivacyVersion } from './learner-privacy-policy.js';
export type AdminLearnerPage = 'learners' | 'shared' | 'privacy';
export const renderAdminLearnerPage = (
  kind: AdminLearnerPage,
  locale: AdminLocale,
  canManageAdmins: boolean
) => {
  const t = learnerPrivacyTexts(locale);
  const content =
    '<p>' +
    { learners: t.suspendHelp, shared: t.staffHelp, privacy: t.policyHelp }[kind] +
    '</p><p id="status" role="status" aria-live="polite"></p>' +
    (kind === 'learners'
      ? '<form id="learner-filter" class="filters"><label>' +
        t.query +
        '<input id="learner-query" maxlength="100"></label><button type="submit">' +
        t.apply +
        '</button></form>'
      : '') +
    (kind === 'privacy'
      ? '<article>' +
        renderPrivacyDocument(locale) +
        '</article><fieldset id="policy-fields"><label>' +
        t.publishReason +
        '<textarea id="policy-reason" maxlength="1000"></textarea></label><button id="policy-publish" type="button">' +
        t.publish +
        '</button></fieldset>'
      : '<div id="learner-entries"></div>') +
    '<button id="learner-reload" type="button" class="secondary">' +
    t.reload +
    '</button>' +
    (kind === 'privacy'
      ? ''
      : '<div class="pager"><button id="learner-prev" type="button">' +
        t.previous +
        '</button><span id="learner-page"></span><button id="learner-next" type="button">' +
        t.next +
        '</button></div>') +
    '<style>textarea{font:inherit;width:100%;min-height:6rem;max-width:100%;padding:.6rem}fieldset{min-width:0}article p{white-space:pre-wrap;overflow-wrap:anywhere}.eligibility-panel[hidden]{display:none!important}</style>';
  return renderAdminShell(
    kind,
    content,
    'const learnerAdminConfig=' +
      JSON.stringify({ kind, locale, version: learnerPrivacyVersion, hash: learnerPrivacyHash }) +
      ',learnerAdminUI=' +
      JSON.stringify(t) +
      ';' +
      adminLearnerScript,
    locale,
    canManageAdmins
  );
};
export const adminLearnerScript = String.raw`
(()=>{const $=id=>document.getElementById(id),c=learnerAdminConfig,t=learnerAdminUI;let page=1,total=0,q='',busy=false,leaving=false,generation=0,panel=null,reason=null;
 const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};const dirty=()=>!!(reason&&reason.value)||!!($('policy-reason')&&$('policy-reason').value);
 const mayDiscard=()=>!busy&&(!dirty()||confirm(t.discard));window.qigongJournalMayLeave=()=>{if(!mayDiscard())return false;leaving=true;return true;};window.qigongJournalLeaveCancelled=()=>{leaving=false;};window.addEventListener('beforeunload',e=>{if(!leaving&&(busy||dirty())){e.preventDefault();e.returnValue='';}});
 const status=(text,error=false)=>{$('status').textContent=text;$('status').dataset.error=String(error);};
 const pager=()=>{if(!$('learner-prev'))return;$('learner-prev').disabled=busy||page<=1;$('learner-next').disabled=busy||page*20>=total;$('learner-page').textContent=page+' / '+Math.max(1,Math.ceil(total/20));};
 const lock=value=>{busy=value;for(const id of ['learner-reload','learner-query','policy-fields'])if($(id))$(id).disabled=value;if(panel)panel.disabled=value;pager();};
 const api=async(path,values)=>{const csrf=document.cookie.split('; ').find(x=>x.startsWith('__Host-qigong-admin-csrf='))?.split('=')[1]||'';const r=await fetch(path,{method:values?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000),headers:values?{'content-type':'application/json','x-csrf-token':csrf}:{},...(values?{body:JSON.stringify(values)}:{})});if(!r.ok){const e=new Error('learner');e.status=r.status;throw e;}return r.json();};
 const failure=e=>status(e.status===409?t.conflict:e.status===403||e.status===401?t.suspended:t.failed,true);
 const render=data=>{total=data.total;$('learner-entries').replaceChildren();panel=null;reason=null;if(!data.entries.length)$('learner-entries').append(node('p',t.empty));
 for(const entry of data.entries){const card=node('article');if(c.kind==='shared'){card.append(node('h2',entry.alias+' · '+entry.date),node('p',entry.methods.join('、')),node('p',entry.practiceNote),node('p',entry.feelingTags.join('、')));}else{card.append(node('h2',entry.name||entry.id),node('p',entry.status==='active'?t.active:t.inactive));if(entry.status==='active'){const open=node('button',t.suspend);open.type='button';open.onclick=()=>{if(!mayDiscard())return;if(panel)panel.remove();const fields=node('fieldset');fields.className='eligibility-panel';const label=node('label',t.reason),input=node('textarea');input.maxLength=1000;label.append(input);fields.append(node('legend',t.suspend),label);panel=fields;reason=input;const submit=node('button',t.suspend),cancel=node('button',t.cancel);submit.type=cancel.type='button';cancel.onclick=()=>{if(!mayDiscard())return;fields.remove();panel=null;reason=null;open.focus();};submit.onclick=async()=>{if(busy)return;const value=input.value.trim();if(!value||[...value].length>500||value.includes('\0')){status(t.invalid,true);input.focus();return;}if(!confirm(t.confirmSuspend))return;lock(true);try{const saved=await api('/admin/api/learners/'+entry.id+'/suspend',{version:entry.version,reason:value});entry.version=saved.version;entry.status=saved.status;card.replaceChildren(node('h2',entry.name||entry.id),node('p',t.inactive));panel=null;reason=null;status(t.saved);}catch(e){failure(e);}finally{lock(false);}};fields.append(submit,cancel);card.append(fields);input.focus();};card.append(open);}}$('learner-entries').append(card);}pager();};
 const load=async()=>{const own=++generation;lock(true);status(t.loading);try{const data=await api(c.kind==='privacy'?'/admin/api/privacy-policy':c.kind==='shared'?'/admin/api/shared-journal?lang='+c.locale+'&page='+page:'/admin/api/learners?'+new URLSearchParams({page:String(page),q}));if(own!==generation)return;if(c.kind==='privacy'){status(data.active?t.published:t.draft);$('policy-publish').disabled=data.active;}else{render(data);status('');}}catch(e){failure(e);}finally{if(own===generation)lock(false);}};
 $('learner-reload').onclick=()=>{if(mayDiscard())load();};
 if(c.kind==='privacy')$('policy-publish').onclick=async()=>{if(busy)return;const input=$('policy-reason'),value=input.value.trim();if(!value||[...value].length>500||value.includes('\0')){status(t.invalid,true);return;}if(!confirm(t.confirmPublish))return;lock(true);try{await api('/admin/api/privacy-policy/publish',{version:c.version,hash:c.hash,reason:value});input.value='';$('policy-publish').disabled=true;status(t.published);}catch(e){failure(e);}finally{lock(false);}};
 else{$('learner-prev').onclick=()=>{if(page>1&&mayDiscard()){page--;load();}};$('learner-next').onclick=()=>{if(mayDiscard()){page++;load();}};if(c.kind==='learners')$('learner-filter').onsubmit=e=>{e.preventDefault();if(!mayDiscard())return;q=$('learner-query').value.trim();page=1;load();};}load();})();
`;
