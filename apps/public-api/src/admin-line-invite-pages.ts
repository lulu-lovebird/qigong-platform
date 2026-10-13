import { renderAdminShell } from './admin-dashboard.js';
import type { AdminLocale } from './admin-locale.js';
export const renderAdminLineInvites = (locale: AdminLocale) => {
  const en = locale === 'en',
    t = {
      label: en ? 'Invitation label' : '邀請名稱',
      region: en ? 'Region' : '核准地區',
      days: en ? 'Valid days (1–30)' : '有效天數（1–30）',
      limit: en ? 'Maximum new learners' : '新加入人數上限',
      reason: en ? 'Reason (required)' : '原因（必填）',
      create: en ? 'Create invitation' : '建立邀請',
      revoke: en ? 'Revoke' : '撤銷',
      warning: en
        ? 'Anyone holding this link can be automatically approved. Do not publish it. No name/email/phone match proves the intended learner.'
        : '任何持有此連結的人都可能自動核准。請勿公開張貼；姓名／Email／電話不能證明是指定學員。',
      once: en ? 'Copy this link now; it is shown only once.' : '請立即複製此網址；只顯示這一次。',
      confirm: en
        ? 'Revoke this invitation? Existing approved learners retain their access.'
        : '撤銷此邀請？已核准學員仍保留既有資格。',
      failure: en
        ? 'Request failed. Refresh and verify current permissions/data before retrying.'
        : '操作失敗，請重新整理並確認目前權限／資料後再試。',
      noItems: en ? 'No invitations yet.' : '尚無邀請。',
      counts: en ? 'Used / limit' : '已使用／上限',
      expiry: en ? 'Expires' : '期限',
      status: en ? 'State' : '狀態',
      active: en ? 'Active' : '有效',
      inactive: en ? 'Revoked, expired or issuer unavailable' : '已撤銷／到期／建立者權限失效',
      next: en ? 'Next' : '下一頁',
      prev: en ? 'Previous' : '上一頁'
    };
  return renderAdminShell(
    'invites',
    `<section class="card"><p>${t.warning}</p><form id="invite-create" class="filters"><label>${t.label}<input name="label" required maxlength="100"></label><label>${t.region}<select id="invite-region" name="region" required></select></label><label>${t.days}<input name="days" type="number" min="1" max="30" value="7" required></label><label>${t.limit}<input name="maxUses" type="number" min="1" max="10000" value="100" required></label><label>${t.reason}<input name="reason" required maxlength="500"></label><button type="submit">${t.create}</button></form><section id="invite-result" hidden><p>${t.once}</p><textarea id="invite-url" readonly aria-label="Invitation URL"></textarea></section></section><p id="status" role="status" aria-live="polite"></p><section class="card"><div id="invite-list"></div><div class="pager"><button id="invite-prev" type="button">${t.prev}</button><span id="invite-page"></span><button id="invite-next" type="button">${t.next}</button></div></section>`,
    String.raw`
const labels=` +
      JSON.stringify(t) +
      String.raw`;let page=1,pages=1,busy=false;
const $=id=>document.getElementById(id),node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e;};
const csrf=()=>document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-qigong-admin-csrf='))?.split('=')[1]||'';
const request=async(path,body)=>{const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'content-type':'application/json','x-csrf-token':csrf()}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(labels.failure);return r.json();};
const markBusy=value=>{busy=value;for(const e of document.querySelectorAll('#invite-create button,#invite-list button,#invite-prev,#invite-next'))e.disabled=value;$('invite-prev').disabled=value||page<=1;$('invite-next').disabled=value||page>=pages;};
const load=async()=>{const data=await request('/admin/api/line-invites?page='+page);const select=$('invite-region'),previous=select.value;select.replaceChildren();for(const region of data.regions){const o=node('option',region.name);o.value=region.code;select.append(o);}select.value=previous||'tw-general';$('invite-list').replaceChildren();for(const item of data.items){const article=node('article'),heading=node('h2',item.label),meta=node('p',item.region+' · '+labels.counts+': '+item.uses+'/'+item.maxUses+' · '+labels.expiry+': '+item.expiresAt),state=node('p',(item.revoked||!item.issuerActive||new Date(item.expiresAt)<=new Date())?labels.inactive:labels.active);article.append(heading,meta,state);if(!item.revoked){const button=node('button',labels.revoke);button.type='button';button.onclick=async()=>{if(busy||!confirm(labels.confirm))return;const reason=prompt(labels.reason);if(!reason?.trim())return;markBusy(true);try{await request('/admin/api/line-invites/'+item.id+'/revoke',{version:item.revision,reason:reason.trim()});$('invite-url').value='';$('invite-result').hidden=true;await load();}catch(error){$('status').textContent=error.message;}finally{markBusy(false);}};article.append(button);}$('invite-list').append(article);}if(!data.items.length)$('invite-list').append(node('p',labels.noItems));pages=Math.max(1,Math.ceil(data.total/50));$('invite-page').textContent=page+' / '+pages;$('invite-prev').disabled=page<=1;$('invite-next').disabled=page*50>=data.total;};
$('invite-create').onsubmit=async event=>{event.preventDefault();if(busy)return;const data=Object.fromEntries(new FormData(event.target));markBusy(true);$('invite-url').value='';$('invite-result').hidden=true;try{const created=await request('/admin/api/line-invites',{label:data.label,region:data.region,days:Number(data.days),maxUses:Number(data.maxUses),reason:data.reason});$('invite-url').value=created.url;$('invite-result').hidden=false;await load();}catch(error){$('status').textContent=error.message;}finally{markBusy(false);}};
$('invite-prev').onclick=async()=>{if(busy||page<=1)return;page--;await load();};$('invite-next').onclick=async()=>{if(busy)return;page++;await load();};
void load().catch(error=>{$('status').textContent=error.message;});
`,
    locale,
    true
  );
};
