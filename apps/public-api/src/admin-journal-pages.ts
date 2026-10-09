import { renderAdminShell } from './admin-dashboard.js';
import type { AdminLocale } from './admin-locale.js';
import { journalTexts } from './journal-locale.js';

export const renderAdminJournalPage = (
  kind: 'journal' | 'tags',
  locale: AdminLocale,
  canManageAdmins: boolean
) => {
  const t = journalTexts(locale);
  return renderAdminShell(
    kind,
    `<p>${kind === 'journal' ? t.privateHelp : t.tagHelp}</p><p id="journal-status" role="status" aria-live="polite">${t.loading}</p>
${kind === 'journal' ? `<form id="journal-filter" class="filters"><label>${t.person}<input id="journal-person" maxlength="36" autocomplete="off"></label><button type="submit">${t.apply}</button><button id="journal-all" type="button" class="secondary">${t.all}</button></form>` : `<fieldset id="tag-editor"><div id="tag-rows"></div><div class="actions"><button id="tag-add" type="button">${t.add}</button><button id="tag-save" type="button">${t.save}</button><button id="tag-reset" class="secondary" type="button">${t.cancel}</button></div></fieldset>`}
<button id="journal-reload" class="secondary" type="button">${t.reload}</button><div id="journal-entries"></div>
${kind === 'journal' ? `<div class="pager"><button id="journal-prev" type="button">${t.previous}</button><span id="journal-page"></span><button id="journal-next" type="button">${t.next}</button></div>` : ''}
<style>.journal-card p{white-space:pre-wrap;overflow-wrap:anywhere}.journal-card{overflow-wrap:anywhere}.journal-tags{display:flex;flex-wrap:wrap;gap:.5rem}.journal-tag{background:#edf3ee;padding:.25rem .6rem;border-radius:1rem}.journal-tag-row{display:grid;grid-template-columns:1fr 1fr auto;gap:.8rem;margin-bottom:1rem;min-width:0}#tag-editor{border:0;padding:0;margin:0;min-width:0}#tag-editor input{width:100%}#tag-editor input[type=checkbox]{width:auto}@media(max-width:760px){.journal-tag-row{grid-template-columns:1fr}.journal-tag-row .actions{flex-wrap:wrap}}</style>`,
    `const journalKind=${JSON.stringify(kind)},journalLocale=${JSON.stringify(locale)},journalUI=${JSON.stringify(t)};${adminJournalScript}`,
    locale,
    canManageAdmins
  );
};
export const adminJournalScript = String.raw`
(()=>{
  const $=id=>document.getElementById(id),t=journalUI,locale=journalLocale,node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  let busy=false,leaving=false,generation=0,page=1,person='',catalog={version:0,tags:[]},baseline='[]';
  const status=(text,error=false)=>{$('journal-status').textContent=text;$('journal-status').dataset.error=String(error);};
  const signature=()=>JSON.stringify(catalog.tags.map(({id,name_zh_tw,name_en,active})=>({id,name_zh_tw,name_en,active})));
  const dirty=()=>journalKind==='tags'&&signature()!==baseline;
  const mayDiscard=()=>!busy&&(!dirty()||confirm(t.discard));
  window.qigongJournalMayLeave=()=>{if(!mayDiscard())return false;leaving=true;return true;};
  window.qigongJournalLeaveCancelled=()=>{leaving=false;};
  window.addEventListener('beforeunload',e=>{if(!leaving&&(busy||dirty())){e.preventDefault();e.returnValue='';}});
  const lock=value=>{busy=value;if($('tag-editor'))$('tag-editor').disabled=value;for(const id of ['journal-reload','journal-prev','journal-next','journal-all'])if($(id))$(id).disabled=value;};
  const api=async(path,method='GET',body)=>{const csrf=document.cookie.split('; ').find(p=>p.startsWith('__Host-qigong-admin-csrf='))?.split('=')[1]||'';const r=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:method==='GET'?{}:{'content-type':'application/json','x-csrf-token':csrf},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok){const e=new Error('journal');e.status=r.status;throw e;}return r.json();};
  const failure=e=>status(e.status===401||e.status===403?t.denied:e.status===409?t.conflict:t.failed,true);
  const renderTags=()=>{
    $('tag-rows').replaceChildren();catalog.tags.forEach((tag,index)=>{
      const row=node('div',undefined,'journal-tag-row');
      for(const [key,title,max]of [['name_zh_tw',t.zh,80],['name_en',t.en,160]]){const label=node('label',title),input=node('input');input.value=tag[key];input.maxLength=max;input.oninput=()=>{tag[key]=input.value;};label.append(input);row.append(label);}
      const controls=node('div'),label=node('label',t.active),check=node('input');check.type='checkbox';check.checked=tag.active;check.onchange=()=>{tag.active=check.checked;};label.append(check);controls.append(label);
      const actions=node('div',undefined,'actions');for(const [delta,text]of [[-1,t.up],[1,t.down]]){const b=node('button',text);b.type='button';b.disabled=index+delta<0||index+delta>=catalog.tags.length;b.onclick=()=>{[catalog.tags[index],catalog.tags[index+delta]]=[catalog.tags[index+delta],catalog.tags[index]];renderTags();};actions.append(b);}
      if(!tag.id){const b=node('button',t.removeDraft,'secondary');b.type='button';b.onclick=()=>{catalog.tags.splice(index,1);renderTags();};actions.append(b);}controls.append(actions);row.append(controls);$('tag-rows').append(row);
    });$('tag-add').disabled=catalog.tags.length>=30;
  };
  const renderEntries=data=>{
    $('journal-entries').replaceChildren();if(!data.entries.length)$('journal-entries').append(node('p',t.empty));
    for(const entry of data.entries){const card=node('article',undefined,'journal-card');card.append(node('h2',entry.name),node('p',entry.practiceDate+' · '+t.updated+': '+new Date(entry.updatedAt).toLocaleString(locale==='en'?'en':'zh-TW')));if(entry.methodsVisible)card.append(node('p',t.methods+': '+entry.methods.join('、')));if(entry.practiceNote)card.append(node('p',entry.practiceNote));const tags=node('div',undefined,'journal-tags');for(const tag of entry.feelingTags)tags.append(node('span',tag.name,'journal-tag'));card.append(tags);$('journal-entries').append(card);}
    $('journal-page').textContent=data.page+' / '+Math.max(1,Math.ceil(data.total/20));$('journal-prev').disabled=page<=1;$('journal-next').disabled=page*20>=data.total;
  };
  const load=async()=>{
    const own=++generation;status(t.loading);if(journalKind==='tags')lock(true);if(journalKind==='journal')$('journal-entries').replaceChildren();
    try{const data=await api(journalKind==='tags'?'/admin/api/practice-feeling-tags':'/admin/api/journal?'+new URLSearchParams({lang:locale,page:String(page),...(person?{personId:person}:{})}));if(own!==generation)return;
      if(journalKind==='tags'){catalog=data;baseline=signature();renderTags();}else renderEntries(data);status('');
    }catch(e){if(own===generation)failure(e);}finally{if(journalKind==='tags'&&own===generation)lock(false);}
  };
  $('journal-reload').onclick=()=>{if(mayDiscard())load();};
  if(journalKind==='journal'){
    const initial=new URL(location.href).searchParams;person=initial.get('personId')||'';page=Number(initial.get('page')||1);if(!Number.isInteger(page)||page<1||page>100000)page=1;$('journal-person').value=person;
    const apply=()=>{const url=new URL(location.href);url.searchParams.set('page',String(page));if(person)url.searchParams.set('personId',person);else url.searchParams.delete('personId');history.replaceState(null,'',url.pathname+url.search);load();};
    $('journal-filter').onsubmit=e=>{e.preventDefault();person=$('journal-person').value.trim();page=1;apply();};$('journal-all').onclick=()=>{person='';$('journal-person').value='';page=1;apply();};$('journal-prev').onclick=()=>{if(page>1){page--;apply();}};$('journal-next').onclick=()=>{page++;apply();};
  }else{
    $('tag-add').onclick=()=>{if(!busy&&catalog.tags.length<30){catalog.tags.push({name_zh_tw:'',name_en:'',active:true});renderTags();}};
    $('tag-reset').onclick=()=>{if(mayDiscard()){catalog.tags=JSON.parse(baseline);renderTags();status('');}};
    $('tag-save').onclick=async()=>{
      if(busy||!dirty())return;const names=new Map();for(const tag of catalog.tags)for(const [key,max]of [['name_zh_tw',40],['name_en',80]]){const value=tag[key].trim(),label=value.toLowerCase();if(!value||[...value].length>max||value.includes('\0')||(names.has(label)&&names.get(label)!==tag)){status(t.invalid,true);return;}names.set(label,tag);}
      lock(true);try{const data=await api('/admin/api/practice-feeling-tags','PUT',{version:catalog.version,tags:catalog.tags.map(({id,name_zh_tw,name_en,active})=>({... (id?{id}:{}),name_zh_tw:name_zh_tw.trim(),name_en:name_en.trim(),active}))});catalog=data;baseline=signature();renderTags();status(t.saved);}catch(e){failure(e);}finally{lock(false);}
    };
  }
  load();
})();
`;
