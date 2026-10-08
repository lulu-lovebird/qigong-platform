import { adminAccessTexts } from './admin-access-locale.js';
import { renderAdminShell } from './admin-dashboard.js';
import { adminLocaleCookie, type AdminLocale } from './admin-locale.js';
const vocabulary = (locale: AdminLocale) =>
  JSON.stringify(adminAccessTexts(locale)).replaceAll('<', '\\u003c');
const commonScript = (locale: AdminLocale) => `
const ui=${vocabulary(locale)};
const locale=${JSON.stringify(locale)};
const status=document.getElementById('status');
const csrf=()=>document.cookie.split('; ').find(p=>p.startsWith('__Host-qigong-admin-csrf='))?.split('=')[1] || '';
const call=async(url,body)=>{
  const response=await fetch(url,{credentials:'same-origin',...(body?{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf()},body:JSON.stringify(body)}:{})});
  if(!response.ok)throw new Error(response.status===409?ui.conflict:response.status===401||response.status===403?ui.denied:ui.failed);
  return response.json();
};
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text ?? '');return n;};
`;
export const renderAccessPendingPage = (locale: AdminLocale) => {
  const ui = adminAccessTexts(locale);
  return `<!doctype html><html lang="${locale === 'en' ? 'en' : 'zh-Hant'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${ui.pendingTitle}</title><style>body{font-family:system-ui,sans-serif;max-width:38rem;margin:2rem auto;padding:1rem;color:#203027}label{display:grid;gap:.4rem;margin:1rem 0}input,textarea,select,button{font:inherit;padding:.6rem}textarea{min-height:5rem}button{cursor:pointer;margin:.3rem}.actions{display:flex;flex-wrap:wrap}#status{white-space:pre-wrap;overflow-wrap:anywhere}footer{font-size:.75rem;margin-top:2rem}</style></head><body><h1>${ui.pendingTitle}</h1><p>${ui.pendingIntro}</p><select id="pending-language" aria-label="${locale === 'en' ? 'Interface language' : '介面語言'}"><option value="zh_TW">繁體中文</option><option value="en">English</option></select><p id="status" role="status" aria-live="polite"></p><p id="identity"></p><p id="decision"></p><form id="request" hidden><label>${ui.role}<select id="role"><option value="regional_admin">${ui.regional_admin}</option><option value="global_viewer">${ui.global_viewer}</option><option value="coach_admin">${ui.coach_admin}</option><option value="master_admin">${ui.master_admin}</option></select></label><label>${ui.scopeDescription}<textarea id="scope" required></textarea></label><label>${ui.reason}<textarea id="reason" required></textarea></label><button type="submit">${ui.submit}</button></form><div class="actions"><button id="refresh">${ui.refresh}</button><a href="/admin/auth/login" id="login" hidden>${ui.login}</a><button id="logout">${ui.logout}</button></div><footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer><script>
(()=>{
${commonScript(locale)}
let snapshot=null;
const form=document.getElementById('request');
const load=async()=>{
 try {snapshot=await call('/admin/access/status');document.getElementById('identity').textContent=ui.account+': '+snapshot.name+' ('+snapshot.principalId.slice(0,8)+')';status.textContent=ui[snapshot.status] ?? ui.failed;document.getElementById('decision').textContent=snapshot.decisionReason ?? '';form.hidden=!['draft','rejected'].includes(snapshot.status);document.getElementById('login').hidden=snapshot.status!=='approved';
 if(snapshot.status==='approved')status.textContent+=' — '+ui.approvedHint;
 document.getElementById('role').value=snapshot.requestedRole ?? 'regional_admin';document.getElementById('scope').value=snapshot.scopeDescription;document.getElementById('reason').value=snapshot.applicantReason;
 }catch(error){form.hidden=true;status.textContent=error.message;}
};
form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await call('/admin/access/request',{version:snapshot.version,role:document.getElementById('role').value,scopeDescription:document.getElementById('scope').value,reason:document.getElementById('reason').value});await load();}catch(error){status.textContent=error.message;}finally{button.disabled=false;}});
document.getElementById('refresh').addEventListener('click',()=>{if(!form.hidden && !confirm(ui.switchConfirm))return;load();});
const language=document.getElementById('pending-language');language.value=locale;
language.addEventListener('change',()=>{if(!['en','zh_TW'].includes(language.value)||language.value===locale){language.value=locale;return;}if(!form.hidden && !confirm(ui.switchConfirm)){language.value=locale;return;}document.cookie='${adminLocaleCookie}='+language.value+'; Path=/; Max-Age=31536000; Secure; SameSite=Lax';location.assign('/admin/access?lang='+language.value);});
document.getElementById('logout').addEventListener('click',async()=>{try{await call('/admin/auth/logout',{});location.assign('/admin/auth/login');}catch(error){status.textContent=error.message;}});
load();
})();</script></body></html>`;
};
export const renderAdminAccessPage = (locale: AdminLocale) => {
  const ui = adminAccessTexts(locale);
  return renderAdminShell(
    'access',
    `<p>${ui.manageIntro}</p><form id="filter" class="filters"><label>${ui.filter}<select id="access-filter">${(['pending', 'all', 'draft', 'approved', 'rejected', 'provisioned'] as const).map((s) => `<option value="${s}">${ui[s]}</option>`).join('')}</select></label><button>${ui.refresh}</button></form><p id="status" role="status" aria-live="polite"></p><div id="accounts"></div><div class="pager"><button id="previous">${ui.previous}</button><button id="next">${ui.next}</button></div>`,
    `
(()=>{
${commonScript(locale)}
let page=1;let generation=0;let actor=null;let model=null;
const permissionLabels={'learner.read':ui.learnerRead,'learner.manage_profile':ui.profileManage,'learner.transfer_request':ui.transferRequest,'checkin.read':ui.checkinRead,'checkin.read_private_note':ui.privateNoteRead,'stats.read':ui.statsRead,'admin_access.manage':ui.accessManage};
const run=async(url,body,button)=>{if(!confirm(ui.confirm))return;button.disabled=true;try{await call(url,body);await load();status.textContent=ui.saved;}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
const render=()=>{
 const root=document.getElementById('accounts');root.replaceChildren();
 for(const account of model.entries){
  const card=node('article');card.style.overflowWrap='anywhere';card.append(node('h2',account.name+' · '+account.principalId.slice(0,8)),node('p',ui[account.status]+' · '+(ui[account.accountStatus] ?? account.accountStatus)),node('p',account.email ?? ''),node('p',ui.identity+': '+account.issuer+' / '+account.subject),node('p',account.scopeDescription ?? ''),node('p',account.applicantReason ?? ''),node('p',account.decisionReason ?? ''));
  for(const g of account.grants){const grantRegion=model.regions.find(r=>r.id===g.regionId);const scopeName=grantRegion?(locale==='en'?grantRegion.nameEn:grantRegion.nameZhTw):g.scopeName ?? ui[g.scopeType] ?? g.scopeType;const line=node('div');line.append(node('span',(ui[g.role] ?? g.role)+' · '+scopeName+' · '+(g.active?g.validFrom:ui.inactive)));
   if(g.active && g.canRevoke===true && account.principalId!==actor){const revoke=node('button',ui.revoke);revoke.type='button';const reason=node('input');reason.setAttribute('aria-label',ui.decisionReason);revoke.addEventListener('click',()=>{if(!reason.value.trim()){status.textContent=ui.required;return;}run('/admin/api/access/grants/'+g.id+'/revoke',{reason:reason.value},revoke);});line.append(reason,revoke);}card.append(line);
  }
  if(account.principalId===actor){card.append(node('p',ui.self));root.append(card);continue;}
  if(account.canManage!==true){card.append(node('p',ui.protected));root.append(card);continue;}
  if(account.accountStatus!=='active'){root.append(card);continue;}
  if(!['pending','approved','provisioned'].includes(account.status)){root.append(card);continue;}
  const role=node('select');role.setAttribute('aria-label',ui.role);for(const {code} of model.roles){const o=node('option',ui[code]);o.value=code;role.append(o);}role.value=model.roles.some(r=>r.code===account.requestedRole)?account.requestedRole:'regional_admin';
  const scope=node('select');scope.setAttribute('aria-label',ui.scope);const summary=node('p');
  const update=()=>{scope.replaceChildren();scope.value='';scope.hidden=role.value!=='regional_admin';scope.disabled=scope.hidden;const blank=node('option',ui.selectScope);blank.value='';scope.append(blank);if(!scope.hidden)for(const entry of model.regions){const o=node('option',locale==='en'?entry.nameEn:entry.nameZhTw);o.value=entry.id;scope.append(o);}summary.textContent=(scope.hidden?ui.scope+': '+ui.global+' · ':'')+ui.permissions+': '+(model.roles.find(r=>r.code===role.value)?.permissions ?? []).map(p=>permissionLabels[p] ?? p).join('、');};role.addEventListener('change',update);update();
  const reason=node('input');reason.setAttribute('aria-label',ui.decisionReason);
  const action=node('button',account.status==='pending'?ui.approve:ui.grant);action.type='button';action.addEventListener('click',()=>{
   if(!role.value||(role.value==='regional_admin'&&!scope.value)||!reason.value.trim()){status.textContent=ui.required;return;}
   const body={role:role.value,...(role.value==='regional_admin'?{regionId:scope.value}:{}),reason:reason.value};
   if(account.status==='pending')run('/admin/api/access/accounts/'+account.principalId+'/decision',{...body,version:account.version,decision:'approved'},action);else run('/admin/api/access/accounts/'+account.principalId+'/grants',body,action);
  });card.append(role,scope,summary,reason,action);
  if(account.status==='pending'){const reject=node('button',ui.reject);reject.type='button';reject.addEventListener('click',()=>{if(!reason.value.trim()){status.textContent=ui.required;return;}run('/admin/api/access/accounts/'+account.principalId+'/decision',{version:account.version,decision:'rejected',reason:reason.value},reject);});card.append(reject);}
  root.append(card);
 }
 if(!model.entries.length)root.textContent=ui.empty;
 document.getElementById('previous').disabled=page===1;document.getElementById('next').disabled=page*20>=model.total;
 status.textContent=ui.count+': '+model.total+' · '+page;
};
const load=async()=>{const current=++generation;document.getElementById('accounts').replaceChildren();try{const response=await call('/admin/api/access/accounts?page='+page+'&status='+document.getElementById('access-filter').value);if(current!==generation)return;model=response;render();}catch(error){if(current===generation)status.textContent=error.message;}};
document.getElementById('filter').addEventListener('submit',e=>{e.preventDefault();if(!confirm(ui.switchConfirm))return;page=1;load();});
for(const [id,delta] of [['previous',-1],['next',1]])document.getElementById(id).addEventListener('click',()=>{if(!confirm(ui.switchConfirm))return;page+=delta;load();});
call('/admin/auth/me').then(me=>{actor=me.principalId;return load();}).catch(error=>{status.textContent=error.message;});
})();`,
    locale,
    true
  );
};
