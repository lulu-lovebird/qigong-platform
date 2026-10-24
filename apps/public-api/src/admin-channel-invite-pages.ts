import { channelInviteTexts } from './channel-invites.js';
import { htmlLocale, languageOptions, uiText, type Locale } from './ui-localization.js';
export const renderAdminChannelInvites = (locale: Locale): string => {
  const t = (zh: string, en: string) => (locale === 'en' ? en : uiText(locale, zh));
  const labels = {
    title: t('Telegram／WhatsApp邀請', 'Telegram / WhatsApp invitations'),
    platform: t('平台', 'Platform'),
    label: t('邀請名稱', 'Invitation label'),
    region: t('核准地區', 'Region'),
    days: t('有效天數（1–30）', 'Valid days (1–30)'),
    limit: t('新加入人數上限', 'Maximum new learners'),
    reason: t('原因（必填）', 'Reason (required)'),
    create: t('建立邀請', 'Create invitation'),
    revoke: t('撤銷', 'Revoke'),
    next: t('下一頁', 'Next'),
    prev: t('上一頁', 'Previous'),
    once: t('請立即複製網址；只顯示這一次。', 'Copy the URL now; it is shown only once.'),
    warning: t(
      '任何持有邀請的人都可能自動核准，請只發給已確認學員，勿公開張貼。預設單次使用，不必手填邀請碼。',
      'Anyone holding the invitation can be approved. Send only to confirmed learners, never publish it. Single-use by default; no code to type.'
    ),
    missing: t(
      '此渠道尚未設定公開Bot帳號／對外電話，不能建立可用邀請網址。',
      'The public bot account / chat phone is not configured; usable invitations cannot be created.'
    ),
    failure: t(
      '操作失敗，請確認權限與目前資料後再試。',
      'Request failed. Verify permissions and current data before retrying.'
    ),
    confirm: t(
      '撤銷此邀請？已核准學員仍保留既有資格。',
      'Revoke this invitation? Existing learners retain their access.'
    ),
    switchConfirm: t(
      '切換語言會清除未送出的資料，確定繼續？',
      'Switching language discards unsent input. Continue?'
    ),
    active: t('有效', 'Active'),
    inactive: t('已撤銷／到期／額滿／發行者失效', 'Revoked / expired / full / issuer unavailable'),
    empty: t('尚無邀請。', 'No invitations yet.'),
    back: t('返回後台', 'Back to administration')
  };
  return `<!doctype html><html lang="${htmlLocale(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${labels.title}｜白雁氣功</title><style>*{box-sizing:border-box}body{font:16px/1.65 system-ui,sans-serif;background:#f4f7fa;color:#203247;margin:0;padding:18px}main{max-width:760px;margin:auto}section,article{background:white;border:1px solid #dce4ec;border-radius:12px;padding:18px;margin:14px 0;overflow-wrap:anywhere}label{display:block;margin:12px 0}input,select,textarea{font:inherit;padding:10px;max-width:100%}input,textarea{display:block;width:100%}button,a{min-height:44px;padding:10px;display:inline-flex;align-items:center}button{font:inherit;border:0;border-radius:8px;background:#082850;color:white;white-space:normal}button:disabled{opacity:.5}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:#164e83}#status{min-height:2em}[hidden]{display:none!important}</style></head><body><main><nav><a href="/admin/">${labels.back}</a><a href="/admin/line-invites">LINE</a><select id="language" aria-label="${channelInviteTexts(locale).language}">${languageOptions(locale)}</select></nav><h1>${labels.title}</h1><p>${labels.warning}</p><label>${labels.platform}<select id="platform"><option value="telegram">Telegram</option><option value="whatsapp">WhatsApp</option></select></label><p id="status" role="status" aria-live="polite"></p><section><form id="create"><label>${labels.label}<input name="label" maxlength="100" required></label><label>${labels.region}<select name="region" id="region" required></select></label><label>${labels.days}<input name="days" type="number" min="1" max="30" value="7" required></label><label>${labels.limit}<input name="maxUses" type="number" min="1" max="10000" value="1" required></label><label>${labels.reason}<input name="reason" maxlength="500" required></label><button id="create-button" type="submit" disabled>${labels.create}</button></form></section><section id="result" hidden><p>${labels.once}</p><textarea id="url" readonly aria-label="Invitation URL"></textarea></section><div id="list"></div><nav><button id="prev" type="button">${labels.prev}</button><span id="page"></span><button id="next" type="button">${labels.next}</button></nav></main><script>
const labels=${JSON.stringify(labels).replaceAll('<', '\\u003c')},locale=${JSON.stringify(locale)},$=id=>document.getElementById(id),form=$('create');let platform='telegram',page=1,pages=1,busy=false,configured=false;
const csrf=()=>document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-qigong-admin-csrf='))?.split('=')[1]||'';
const request=async(path,body)=>{const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'content-type':'application/json','x-csrf-token':csrf()}:undefined,...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('request');return r.json();};
const markBusy=value=>{busy=value;for(const e of document.querySelectorAll('button,input,select'))e.disabled=value;$('create-button').disabled=value||!configured;$('prev').disabled=value||page<=1;$('next').disabled=value||page>=pages;};
const clearResult=()=>{$('url').value='';$('result').hidden=true;};const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=String(text);return e;};
const load=async()=>{const data=await request('/admin/api/channel-invites/'+platform+'?page='+page);configured=data.configured===true;const previous=$('region').value;$('region').replaceChildren();for(const r of data.regions){const option=node('option',r.name);option.value=r.code;$('region').append(option);}$('region').value=previous||'tw-general';$('list').replaceChildren();for(const item of data.items){const card=document.createElement('article');card.append(node('h2',item.label),node('p',item.region+' · '+item.uses+'/'+item.maxUses+' · '+item.expiresAt),node('p',item.revoked||!item.issuerActive||new Date(item.expiresAt)<=new Date()||item.uses>=item.maxUses?labels.inactive:labels.active));if(!item.revoked){const revoke=node('button',labels.revoke);revoke.type='button';revoke.onclick=async()=>{if(busy||!confirm(labels.confirm))return;const reason=prompt(labels.reason);if(!reason?.trim())return;markBusy(true);clearResult();try{await request('/admin/api/channel-invites/'+platform+'/'+item.id+'/revoke',{version:item.revision,reason:reason.trim()});await load();}catch{$('status').textContent=labels.failure;}finally{markBusy(false);}};card.append(revoke);}$('list').append(card);}if(!data.items.length)$('list').append(node('p',labels.empty));pages=Math.max(1,Math.ceil(data.total/50));$('page').textContent=page+' / '+pages;$('status').textContent=configured?'':labels.missing;};
form.onsubmit=async event=>{event.preventDefault();if(busy||!configured)return;const values=Object.fromEntries(new FormData(form));markBusy(true);clearResult();try{const result=await request('/admin/api/channel-invites/'+platform,{label:values.label,region:values.region,days:Number(values.days),maxUses:Number(values.maxUses),reason:values.reason});$('url').value=result.url;$('result').hidden=false;await load();}catch{$('status').textContent=labels.failure;}finally{markBusy(false);}};
$('platform').onchange=async()=>{if(busy)return;platform=$('platform').value==='whatsapp'?'whatsapp':'telegram';page=1;clearResult();markBusy(true);try{await load();}catch{$('status').textContent=labels.failure;}finally{markBusy(false);}};
for(const [id,delta]of[['prev',-1],['next',1]])$(id).onclick=async()=>{if(busy||page+delta<1||page+delta>pages)return;page+=delta;markBusy(true);clearResult();try{await load();}catch{$('status').textContent=labels.failure;}finally{markBusy(false);}};
$('language').value=locale;$('language').onchange=()=>{const next=$('language').value;if(busy||!['zh_TW','zh_CN','en'].includes(next))return;if(Array.from(new FormData(form)).some(([key,value])=>['label','reason'].includes(key)&&String(value).trim())&&!confirm(labels.switchConfirm)){$('language').value=locale;return;}clearResult();location.assign(location.pathname+'?lang='+next);};
markBusy(true);load().catch(()=>{$('status').textContent=labels.failure;}).finally(()=>markBusy(false));
</script></body></html>`;
};
