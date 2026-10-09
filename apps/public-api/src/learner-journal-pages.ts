import type { LearnerLocale } from './learner-locale.js';
import { journalTexts } from './journal-locale.js';
import { telegramWorkspaceBootstrap } from './telegram-workspace-pages.js';
export const renderLearnerJournalPage = (locale: LearnerLocale) => {
  const t = journalTexts(locale);
  return `<!DOCTYPE html><html lang="${locale === 'en' ? 'en' : 'zh-Hant'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${t.feed}</title><style>
*{box-sizing:border-box}body{font:16px/1.6 system-ui,sans-serif;margin:0;background:#f3f6f4;color:#203027}main{max-width:760px;padding:16px;margin:auto}h1{font-size:24px}h2{font-size:18px}button,input,select{font:inherit;max-width:100%}button{padding:10px 14px;background:#285c3b;border:0;border-radius:8px;color:white;cursor:pointer}button:disabled{opacity:.5}input:not([type=checkbox]),select{padding:8px;border:1px solid #b9cbbd;border-radius:6px;width:100%}label{display:block;margin:10px 0}input[type=checkbox]{width:18px;height:18px;margin-right:8px}article{padding:18px;border:1px solid #dce6df;background:white;border-radius:12px;margin:16px 0;overflow-wrap:anywhere}p{white-space:pre-wrap;overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:8px}.muted{color:#61746b}.pill{display:inline-block;background:#edf3ee;border-radius:1rem;padding:4px 10px;margin:4px}.preview{padding:12px;background:#f5f7f6;border-radius:6px}fieldset{border:0;margin:0;padding:0;min-width:0}[hidden]{display:none!important}#journal-status[data-error=true]{color:#a12c24}footer{font-size:12px;margin:24px 0;overflow-wrap:anywhere}@media(max-width:500px){.actions>button{flex:1 1 auto}article{padding:14px}}
</style></head><body><main><h1>${t.feed}</h1><p>${t.shareHelp}</p><p>${t.withdrawHelp}</p><nav class="actions"><button id="back" type="button">${t.back}</button><button id="show-feed" type="button">${t.feed}</button><button id="show-mine" type="button">${t.mine}</button><label>${t.language}<select id="language"><option value="zh_TW"${locale === 'zh_TW' ? ' selected' : ''}>繁體中文</option><option value="en"${locale === 'en' ? ' selected' : ''}>English</option></select></label></nav><p id="mine-help" hidden>${t.mineHelp}</p><p id="journal-status" role="status" aria-live="polite">${t.loading}</p><fieldset id="journal-editor"><div id="journal-entries"></div></fieldset><div class="actions"><button id="reload" type="button">${t.reload}</button><button id="previous" type="button">${t.previous}</button><span id="journal-page"></span><button id="next" type="button">${t.next}</button></div><footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer></main>
<script>const journalLocale=${JSON.stringify(locale)},journalUI=${JSON.stringify(t)};${telegramWorkspaceBootstrap}</script><script src="https://telegram.org/js/telegram-web-app.js"></script><script>${learnerJournalScript}</script></body></html>`;
};
export const learnerJournalScript = String.raw`
(()=>{
  const $=id=>document.getElementById(id),t=journalUI,locale=journalLocale,token=workspaceCredential;
  history.replaceState(null,'',location.pathname+location.search);
  let mode='feed',page=1,total=0,busy=false,leaving=false,loaded=false,generation=0,drafts=new Map(),baseline='';
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const signature=()=>JSON.stringify([...drafts]);const dirty=()=>loaded&&signature()!==baseline;
  const closing=()=>{const app=window.Telegram?.WebApp;if(!app)return;if(!leaving&&(busy||dirty()))app.enableClosingConfirmation?.();else app.disableClosingConfirmation?.();};
  const mayLeave=()=>!busy&&(!dirty()||confirm(t.discard));
  const status=(text,error=false)=>{$('journal-status').textContent=text;$('journal-status').dataset.error=String(error);};
  const pager=()=>{$('previous').disabled=busy||page<=1;$('next').disabled=busy||page*20>=total;$('journal-page').textContent=page+' / '+Math.max(1,Math.ceil(total/20));};
  const lock=value=>{busy=value;$('journal-editor').disabled=value;for(const id of ['back','show-feed','show-mine','language','reload'])$(id).disabled=value;pager();closing();};
  const api=async(path,values)=>{const r=await fetch(path,{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({token,locale,...values}),signal:AbortSignal.timeout(15000)});if(!r.ok){const e=new Error('journal');e.status=r.status;throw e;}return r.json();};
  const failure=e=>status(e.status===401||e.status===403?t.denied:e.status===409?t.conflict:t.failed,true);
  const preview=(card,note,tags,methods=[])=>{if(methods.length)card.append(node('p',t.methods+': '+methods.join('、')));if(note)card.append(node('p',note));const pills=node('div');for(const tag of tags)pills.append(node('span',typeof tag==='string'?tag:tag.name,'pill'));card.append(pills);};
  const load=async()=>{
    const own=++generation;status(t.loading);lock(true);
    try{const data=await api('/telegram/journal/'+(mode==='feed'?'feed':'own'),{page});if(own!==generation)return;
      total=data.total;drafts.clear();$('journal-entries').replaceChildren();$('mine-help').hidden=mode!=='mine';
      if(!data.entries.length)$('journal-entries').append(node('p',t.empty));
      for(const entry of data.entries){const card=node('article');card.append(node('h2',(mode==='feed'?entry.alias+' · ':'')+entry.date));
        if(mode==='feed'){preview(card,entry.practiceNote,entry.feelingTags,entry.methods);}else{
          const visibility=node('p',entry.active?t.published:t.unpublished);card.append(visibility);preview(card,entry.practiceNote,entry.feelingTags,entry.methods||[]);
          if(entry.active){const old=node('div',undefined,'preview');old.append(node('strong',t.publishedPreview));preview(old,entry.publishedNote,(entry.publishedTags||[]).map(v=>v[locale]),(entry.publishedMethods||[]).map(v=>v[locale]));card.append(old);}
          const draft={alias:entry.alias,shareNote:entry.shareNote,shareFeelings:entry.shareFeelings,externalEnabled:entry.externalEnabled};drafts.set(entry.checkinId,draft);
          const label=node('label',t.alias),input=node('input');input.maxLength=80;input.value=draft.alias;input.oninput=()=>{draft.alias=input.value;closing();};label.append(input);card.append(label);
          for(const [key,title]of [['shareNote',t.shareNote],['shareFeelings',t.shareFeelings],['externalEnabled',t.external]]){const label=node('label'),input=node('input');input.type='checkbox';input.checked=draft[key];input.onchange=()=>{draft[key]=input.checked;closing();};label.append(input,node('span',title));card.append(label);}
          const buttons=node('div',undefined,'actions'),publish=node('button',t.publish);publish.type='button';
          const mutate=async active=>{if(busy)return;if(active&&(!draft.alias.trim()||[...draft.alias.trim()].length>40||(!draft.shareNote&&!draft.shareFeelings))){status(t.invalid,true);return;}if(!confirm(active?t.confirmPublish:t.confirmWithdraw))return;lock(true);
            try{const result=await api('/telegram/journal/publish',{checkinId:entry.checkinId,sourceHash:entry.sourceHash,version:entry.version,active,shareNote:active?draft.shareNote:entry.shareNote,shareFeelings:active?draft.shareFeelings:entry.shareFeelings,externalEnabled:active?draft.externalEnabled:false,alias:active?draft.alias.trim():entry.alias});
              entry.version=result.version;entry.active=result.active;entry.alias=active?draft.alias.trim():entry.alias;
              // Reset only this card. Other unsaved sharing selections remain intact.
              const oldBaseline=new Map(JSON.parse(baseline));oldBaseline.set(entry.checkinId,{...draft});baseline=JSON.stringify([...oldBaseline]);status(t.saved+' '+t.reload);visibility.textContent=result.active?t.published:t.unpublished;
              for(const input of card.querySelectorAll('input'))input.disabled=true;
              publish.disabled=true;withdraw.disabled=true;card.prepend(node('p',t.saved+' '+(result.active?t.published:t.unpublished)));card.dataset.saved='true';
            }catch(e){failure(e);}finally{lock(false);if(card.dataset.saved==='true'){publish.disabled=true;withdraw.disabled=true;}}
          };
          publish.onclick=()=>mutate(true);buttons.append(publish);const withdraw=node('button',t.withdraw);withdraw.type='button';withdraw.hidden=!entry.active;withdraw.onclick=()=>mutate(false);buttons.append(withdraw);card.append(buttons);
        }$('journal-entries').append(card);
      }loaded=true;baseline=signature();status('');
    }catch(e){failure(e);if(mode==='feed')$('journal-entries').replaceChildren();}finally{lock(false);}
  };
  const change=(nextMode,nextPage)=>{if(!mayLeave())return;mode=nextMode;page=nextPage;load();};
  $('show-feed').onclick=()=>change('feed',1);$('show-mine').onclick=()=>change('mine',1);$('previous').onclick=()=>change(mode,page-1);$('next').onclick=()=>change(mode,page+1);$('reload').onclick=()=>{if(mayLeave())load();};
  $('back').onclick=()=>{if(!mayLeave())return;leaving=true;closing();location.href='/telegram/checkin?lang='+locale+'#'+token;};
  $('language').onchange=async()=>{const next=$('language').value;if(!mayLeave()){$('language').value=locale;return;}lock(true);try{await api('/telegram/preferences/language',{locale:next});leaving=true;closing();location.href='/telegram/journal?lang='+next+'#'+token;}catch(e){$('language').value=locale;failure(e);lock(false);}};
  window.addEventListener('beforeunload',e=>{if(!leaving&&(busy||dirty())){e.preventDefault();e.returnValue='';}});
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)){status(t.denied,true);lock(true);return;}
  window.Telegram?.WebApp?.ready();window.Telegram?.WebApp?.expand();load();
})();
`;
