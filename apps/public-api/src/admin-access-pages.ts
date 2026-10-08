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
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text ?? '');if(cls)n.className=cls;return n;};
let edits=[];
const track=(...fields)=>{edits.push(...fields.map(field=>({field,value:field.value})));};
const mayDiscard=message=>!edits.some(({field,value})=>field.value!==value)||confirm(message);
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
 document.getElementById('role').value=snapshot.requestedRole ?? 'regional_admin';document.getElementById('scope').value=snapshot.scopeDescription;document.getElementById('reason').value=snapshot.applicantReason;edits=[];track(...['role','scope','reason'].map(id=>document.getElementById(id)));
 }catch(error){form.hidden=true;status.textContent=error.message;}
};
form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await call('/admin/access/request',{version:snapshot.version,role:document.getElementById('role').value,scopeDescription:document.getElementById('scope').value,reason:document.getElementById('reason').value});await load();}catch(error){status.textContent=error.message;}finally{button.disabled=false;}});
document.getElementById('refresh').addEventListener('click',()=>{if(!form.hidden && !mayDiscard(ui.reloadConfirm))return;load();});
const language=document.getElementById('pending-language');language.value=locale;
language.addEventListener('change',()=>{if(!['en','zh_TW'].includes(language.value)||language.value===locale){language.value=locale;return;}if(!form.hidden && !mayDiscard(ui.switchConfirm)){language.value=locale;return;}document.cookie='${adminLocaleCookie}='+language.value+'; Path=/; Max-Age=31536000; Secure; SameSite=Lax';location.assign('/admin/access?lang='+language.value);});
document.getElementById('logout').addEventListener('click',async()=>{try{await call('/admin/auth/logout',{});location.assign('/admin/auth/login');}catch(error){status.textContent=error.message;}});
load();
})();</script></body></html>`;
};
export const renderAdminAccessPage = (locale: AdminLocale) => {
  const ui = adminAccessTexts(locale);
  return renderAdminShell(
    'access',
    `<p>${ui.manageIntro}</p><div class="grid" role="group" aria-label="${ui.filter}"><div class="card"><button type="button" id="show-pending" aria-describedby="pending-purpose">${ui.reviewRequests}</button><p id="pending-purpose">${ui.reviewRequestsHelp}</p></div><div class="card"><button type="button" id="show-authorized" aria-describedby="authorized-purpose">${ui.manageGrants}</button><p id="authorized-purpose">${ui.manageGrantsHelp}</p></div></div><form id="filter" class="filters"><label>${ui.filter}<select id="access-filter">${(['pending', 'authorized', 'all', 'draft', 'approved', 'rejected', 'provisioned'] as const).map((s) => `<option value="${s}">${ui[s]}</option>`).join('')}</select></label><button>${ui.refresh}</button></form><p id="status" role="status" aria-live="polite"></p><div id="accounts"></div><div class="pager"><button id="previous">${ui.previous}</button><button id="next">${ui.next}</button></div>`,
    `
(()=>{
${commonScript(locale)}
let page=1;let generation=0;let actor=null;let model=null;let activePanel=null;let busy=false;
const initial=new URL(location.href);const modes=['pending','authorized','all','draft','approved','rejected','provisioned'];
let view=modes.includes(initial.searchParams.get('status'))?initial.searchParams.get('status'):'pending';
const requestedPage=Number(initial.searchParams.get('page'));if(Number.isInteger(requestedPage)&&requestedPage>=1&&requestedPage<=100000)page=requestedPage;
document.getElementById('access-filter').value=view;
const permissionLabels={'learner.read':ui.learnerRead,'learner.manage_profile':ui.profileManage,'learner.transfer_request':ui.transferRequest,'checkin.read':ui.checkinRead,'checkin.read_private_note':ui.privateNoteRead,'stats.read':ui.statsRead,'admin_access.manage':ui.accessManage};
const run=async(url,body,button,panel,error,message=ui.confirm)=>{
 if(busy||!confirm(message))return;busy=true;panel.disabled=true;button.disabled=true;error.textContent='';
 try{await call(url,body);await load();status.textContent=ui.saved;}catch(failure){error.textContent=failure.message;status.textContent=failure.message;}finally{busy=false;panel.disabled=false;button.disabled=false;}
};
const render=()=>{
 const root=document.getElementById('accounts');root.replaceChildren();edits=[];activePanel=null;let panelIndex=0;
 const labeled=(text,control)=>{const label=node('label');label.append(node('span',text),control);return label;};
 const button=(text,cls='secondary')=>{const b=node('button',text,cls);b.type='button';return b;};
 const panelFor=(parent,options)=>{
  const trigger=button(options.title,options.danger?'access-danger-button':'secondary');
  const panel=node('fieldset',undefined,'access-action-panel');panel.hidden=true;panel.id='access-action-'+(++panelIndex);trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-expanded','false');
  panel.append(node('legend',options.title),node('p',ui.target+': '+options.target,'access-target'),node('p',options.help,'muted'));
  let role=null,scope=null,update=null;const controls=[];let baselineRole='',baselineScope='';
  if(options.withRole){
   const fields=node('div',undefined,'access-form-grid');role=node('select');role.setAttribute('aria-label',ui.role);role.required=true;
   for(const {code} of model.roles){const o=node('option',ui[code]);o.value=code;role.append(o);}role.value=options.role ?? 'regional_admin';
   scope=node('select');scope.setAttribute('aria-label',ui.scope);const scopeLabel=labeled(ui.region,scope);const summary=node('p',undefined,'access-permissions');
   update=()=>{scope.replaceChildren();scope.value='';scope.hidden=role.value!=='regional_admin';scope.disabled=scope.hidden;scope.required=!scope.hidden;scopeLabel.hidden=scope.hidden;const blank=node('option',ui.selectScope);blank.value='';scope.append(blank);if(!scope.hidden)for(const region of model.regions){const o=node('option',locale==='en'?region.nameEn:region.nameZhTw);o.value=region.id;scope.append(o);}summary.textContent=(scope.hidden?ui.scope+': '+ui.global+' · ':'')+ui.permissions+': '+(model.roles.find(r=>r.code===role.value)?.permissions ?? []).map(p=>permissionLabels[p] ?? p).join('、');};
   role.addEventListener('change',update);update();if(options.regionId&&!scope.hidden)scope.value=options.regionId;baselineRole=role.value;baselineScope=scope.value;
   controls.push(role,scope);fields.append(labeled(ui.role,role),scopeLabel);panel.append(fields,summary);
  }
  const reason=node('textarea');reason.setAttribute('aria-label',ui.changeReasonLabel);reason.required=true;reason.rows=3;reason.maxLength=1000;reason.placeholder=ui.reasonPlaceholder;
  const help=node('p',ui.changeReasonHelp,'muted');help.id=panel.id+'-reason-help';reason.setAttribute('aria-describedby',help.id);
  const error=node('p',undefined,'access-error');error.setAttribute('role','alert');controls.push(reason);track(...controls);panel.append(labeled(ui.changeReasonLabel,reason),help,error);
  const reset=()=>{if(role){role.value=baselineRole;update();scope.value=baselineScope;}reason.value='';error.textContent='';panel.hidden=true;trigger.setAttribute('aria-expanded','false');};
  const actions=node('div',undefined,'actions');const cancel=button(ui.cancel);cancel.addEventListener('click',()=>{if(busy)return;if(controls.some(field=>edits.some(e=>e.field===field&&field.value!==e.value))&&!confirm(ui.cancelEditsConfirm))return;reset();activePanel=null;trigger.focus?.();});actions.append(cancel);
  const submitAction=(label,decision)=>{const save=button(label,options.danger||decision==='rejected'?'access-danger-button':'');save.addEventListener('click',()=>{
   if(busy||panel.hidden)return;
   if(!reason.value.trim()||[...reason.value.trim()].length>500||reason.value.includes('\\0')){error.textContent=ui.reasonRequired;status.textContent=ui.reasonRequired;reason.focus?.();return;}
   if(options.withRole&&decision!=='rejected'&&(!role.value||(role.value==='regional_admin'&&!scope.value))){error.textContent=ui.required;status.textContent=ui.required;(role.value==='regional_admin'?scope:role).focus?.();return;}
   const selection={reason:reason.value,...(options.withRole&&decision!=='rejected'?{role:role.value,...(role.value==='regional_admin'?{regionId:scope.value}:{})}:{})};
   run(options.url,options.body(selection,decision),save,panel,error,(options.message ?? ui.confirm)+'\\n'+options.target);
  });actions.append(save);};
  submitAction(options.submit,options.decision);if(options.review)submitAction(ui.reject,'rejected');panel.append(actions);
  trigger.addEventListener('click',()=>{if(busy)return;if(activePanel?.panel===panel){(role ?? reason).focus?.();return;}if(activePanel&&!mayDiscard(ui.actionSwitchConfirm))return;activePanel?.reset();panel.hidden=false;trigger.setAttribute('aria-expanded','true');activePanel={panel,reset};(role ?? reason).focus?.();});
  parent.append(trigger,panel);
 };
 for(const account of model.entries){
  const card=node('article',undefined,'access-account');const header=node('div',undefined,'access-account-header');
  const identity=node('div');identity.append(node('h2',account.name+' · '+account.principalId.slice(0,8)),node('p',ui.emailLabel+': '+(account.email ?? ui.emailUnavailable),'access-email'));
  const states=node('div',undefined,'access-statuses');states.append(node('span',ui.accountStatusLabel+': '+(ui[account.accountStatus] ?? account.accountStatus),'access-badge'),node('span',ui.applicationStatusLabel+': '+(ui[account.status] ?? account.status),'access-badge'));header.append(identity,states);card.append(header);
  const details=node('details',undefined,'access-details');details.append(node('summary',ui.details));
  for(const [label,value] of [[ui.identity,account.issuer+' / '+account.subject],[ui.scopeDescription,account.scopeDescription],[ui.reason,account.applicantReason],[ui.decisionReason,account.decisionReason]])if(value)details.append(node('p',label+': '+value));card.append(details);
  const grants=node('section',undefined,'access-grants');grants.append(node('h3',ui.currentGrants));if(!account.grants.length)grants.append(node('p',ui.noGrants,'muted'));
  for(const g of account.grants){
   const region=model.regions.find(r=>r.id===g.regionId);const scopeName=region?(locale==='en'?region.nameEn:region.nameZhTw):g.scopeName ?? ui[g.scopeType] ?? g.scopeType;const context=(ui[g.role] ?? g.role)+' · '+scopeName;const target=account.name+' · '+context;
   const line=node('div',undefined,'access-grant');const heading=node('div',undefined,'access-grant-header');heading.append(node('strong',context),node('span',g.scheduled?ui.scheduled:g.effective===false||!g.active?ui.inactive:ui.active,'access-badge'));line.append(heading);
   const dates=node('p',ui.validFrom+': '+g.validFrom+' · '+ui.validTo+': '+(g.validTo ?? ui.noEndDate),'muted');line.append(dates);const actions=node('div',undefined,'access-grant-actions');
   if(g.active&&g.canEdit===true&&account.principalId!==actor)panelFor(actions,{title:ui.edit,target,help:ui.editHelp,withRole:true,role:g.role,regionId:g.regionId,submit:ui.saveEdit,url:'/admin/api/access/grants/'+g.id+'/edit',body:selection=>({version:account.grantVersion,...selection})});
   if(g.active&&g.canRevoke===true&&account.principalId!==actor)panelFor(actions,{title:ui.revoke,target,help:ui.removeGrantHelp,danger:true,submit:ui.confirmRemoval,url:'/admin/api/access/grants/'+g.id+'/revoke',body:selection=>({version:account.grantVersion,...selection})});
   line.append(actions);grants.append(line);
  }card.append(grants);
  if(account.principalId===actor){card.append(node('p',ui.self,'access-notice'));root.append(card);continue;}
  if(account.canManage!==true){card.append(node('p',ui.protected,'access-notice'));root.append(card);continue;}
  if(account.accountStatus==='active'&&['pending','approved','provisioned'].includes(account.status)){
   const actions=node('section',undefined,'access-account-actions');const reviewing=account.status==='pending';
   panelFor(actions,{title:reviewing?ui.reviewRequests:ui.grant,target:account.name,help:reviewing?ui.reviewRequestsHelp:ui.addHelp,withRole:true,role:model.roles.some(r=>r.code===account.requestedRole)?account.requestedRole:'regional_admin',review:reviewing,decision:reviewing?'approved':undefined,submit:reviewing?ui.approve:ui.grant,url:'/admin/api/access/accounts/'+account.principalId+(reviewing?'/decision':'/grants'),body:(selection,decision)=>reviewing?{version:account.version,decision,...selection}:selection});card.append(actions);
  }
  if(account.canRevokeAll===true){const danger=node('section',undefined,'access-danger-zone');danger.append(node('h3',ui.dangerTitle),node('p',ui.dangerHelp));panelFor(danger,{title:ui.revokeAll,target:account.name+' · '+ui.currentGrants,help:ui.dangerHelp,danger:true,submit:ui.confirmAllRemoval,message:ui.revokeAllConfirm,url:'/admin/api/access/accounts/'+account.principalId+'/revoke-all',body:selection=>({version:account.grantVersion,...selection})});card.append(danger);}
  root.append(card);
 }
 if(!model.entries.length)root.textContent=ui.empty;
 document.getElementById('previous').disabled=page===1;document.getElementById('next').disabled=page*20>=model.total;
 for(const [id,v] of [['show-pending','pending'],['show-authorized','authorized']])document.getElementById(id).setAttribute('aria-pressed',String(view===v));
 status.textContent=ui.count+': '+model.total+' · '+page;
};
const load=async()=>{const current=++generation;document.getElementById('accounts').replaceChildren();edits=[];try{const response=await call('/admin/api/access/accounts?page='+page+'&status='+view);if(current!==generation)return;model=response;render();if(typeof history!=='undefined'){const u=new URL(location.href);u.searchParams.set('status',view);u.searchParams.set('page',String(page));history.replaceState(null,'',u);}}catch(error){if(current===generation)status.textContent=error.message;}};
document.getElementById('filter').addEventListener('submit',e=>{e.preventDefault();if(busy)return;const filter=document.getElementById('access-filter');if(!mayDiscard(filter.value===view?ui.reloadConfirm:ui.listSwitchConfirm)){filter.value=view;return;}view=filter.value;page=1;load();});
for(const [id,v] of [['show-pending','pending'],['show-authorized','authorized']])document.getElementById(id).addEventListener('click',()=>{if(busy||view===v)return;if(!mayDiscard(ui.listSwitchConfirm))return;view=v;document.getElementById('access-filter').value=v;page=1;load();});
for(const [id,delta] of [['previous',-1],['next',1]])document.getElementById(id).addEventListener('click',()=>{if(busy||document.getElementById(id).disabled||!mayDiscard(ui.pageSwitchConfirm))return;page+=delta;load();});
call('/admin/auth/me').then(me=>{actor=me.principalId;return load();}).catch(error=>{status.textContent=error.message;});
})();`,
    locale,
    true
  );
};
