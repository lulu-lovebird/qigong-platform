import {
  channelInviteTexts,
  channelInviteTransportUrl,
  type InvitePlatform
} from './channel-invites.js';
import { htmlLocale, languageOptions, supportedLocales, type Locale } from './ui-localization.js';
import { officialPrivacyUrl } from './learner-privacy-policy.js';

export const renderChannelInvitePage = (
  platform: InvitePlatform,
  locale: Locale,
  landing: boolean,
  target?: string
): string => {
  const texts = channelInviteTexts(locale);
  const safeTarget = channelInviteTransportUrl(platform, target, 'x'.repeat(43)) ? target : null;
  const dictionaries = Object.fromEntries(
    supportedLocales.map((lang) => [lang, channelInviteTexts(lang)])
  );
  return `<!doctype html><html lang="${htmlLocale(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${texts.title}</title><style>*{box-sizing:border-box}body{font:16px/1.6 system-ui,sans-serif;background:#f4f7fa;color:#203247;margin:0;padding:18px}main{max-width:560px;margin:auto;background:white;border:1px solid #dce4ec;border-radius:14px;padding:20px}label{display:block;margin:14px 0}input,select{font:inherit;padding:10px;max-width:100%}input:not([type=checkbox]){display:block;width:100%}input[type=checkbox]{width:20px;height:20px;vertical-align:middle}button,.primary{display:inline-flex;align-items:center;justify-content:center;min-height:44px;font:inherit;padding:10px 16px;background:#285c3b;color:white;border:0;border-radius:8px;text-decoration:none;white-space:normal}button:disabled{opacity:.5}a{color:#164e83;overflow-wrap:anywhere}#status{min-height:2em;overflow-wrap:anywhere}.notice{background:#fff6df;padding:12px;border-left:4px solid #b9770e}[hidden]{display:none!important}</style></head><body><main><h1 data-copy="title">${texts.title}</h1><p data-copy="intro">${texts.intro}</p><label><span data-copy="language">${texts.language}</span> <select id="language">${languageOptions(locale)}</select></label><section id="entry" hidden><p data-copy="action">${texts.action}</p><a id="open" class="primary" target="_blank" rel="noopener noreferrer" data-copy="open">${texts.open}</a></section><section id="privacy" hidden><p data-copy="notice">${texts.notice}</p><p><a href="${officialPrivacyUrl}" target="_blank" rel="noopener noreferrer" data-copy="privacy">${texts.privacy}</a> · <a id="supplement" href="/privacy?platform=${platform}&amp;lang=${locale}" target="_blank" rel="noopener noreferrer" data-copy="supplement">${texts.supplement}</a></p><label><input id="accepted" type="checkbox"><span data-copy="accept">${texts.accept}</span></label><button id="accept" type="button" data-copy="agree">${texts.agree}</button></section><form id="details" hidden><p><strong data-copy="region">${texts.region}</strong>：<span id="region"></span></p><p id="pending" class="notice" data-copy="pending" hidden>${texts.pending}</p><label><span data-copy="name">${texts.name}</span><input name="name" autocomplete="name" maxlength="150" required></label><label><span data-copy="email">${texts.email}</span><input name="email" type="email" autocomplete="email" maxlength="254" required></label><label><span data-copy="phone">${texts.phone}</span><div style="display:flex;gap:6px;align-items:center;"><select id="channel-country-code" style="min-width:130px;min-height:44px;padding:6px;border:1px solid #dce4ec;border-radius:6px;background:white;"><option value="+886">🇹🇼 台灣 (+886)</option><option value="+852">🇭🇰 香港 (+852)</option><option value="+60">🇲🇾 馬來西亞 (+60)</option><option value="+65">🇸🇬 新加坡 (+65)</option><option value="other">🌐 其它</option></select><input name="phone" id="channel-phone" type="tel" autocomplete="tel" placeholder="0912345678" style="flex:1;" required></div></label>${platform === 'whatsapp' ? `<label><input id="notification" type="checkbox" required><span data-copy="notification">${texts.notification}</span></label>` : ''}<button id="submit" type="submit" data-copy="join">${texts.join}</button></form><p id="status" role="status" aria-live="polite"></p><p data-copy="warning">${texts.warning}</p></main><script>
const platform=${JSON.stringify(platform)},landing=${landing},target=${JSON.stringify(safeTarget)},copies=${JSON.stringify(dictionaries).replaceAll('<', '\\u003c')};
let locale=${JSON.stringify(locale)},token=location.hash.slice(1),busy=false,data=null,completed=false;
history.replaceState(null,'',location.pathname+'?lang='+locale);
const $=id=>document.getElementById(id),t=()=>copies[locale],form=$('details');
const show=(message)=>{$('status').textContent=message;};
const setBusy=value=>{busy=value;for(const button of document.querySelectorAll('button,input,select'))button.disabled=value;$('language').disabled=value;};
const render=()=>{document.documentElement.lang=locale==='en'?'en':locale==='zh_CN'?'zh-Hans':'zh-Hant';document.title=t().title;for(const element of document.querySelectorAll('[data-copy]'))element.textContent=t()[element.dataset.copy];$('supplement').href='/privacy?platform='+platform+'&lang='+locale;};
const api=async(path,body)=>{const r=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('request');return r.json();};
const load=async(preserveAcceptance=false)=>{const previous=data;data=await api('/'+platform+'/invite/status',{token,locale});const samePolicy=previous?.privacy?.version===data.privacy?.version&&previous?.privacy?.hash===data.privacy?.hash;for(const id of ['entry','privacy','details'])$(id).hidden=true;
 if(data.status==='privacy'){$('privacy').hidden=false;if(!preserveAcceptance||!samePolicy)$('accepted').checked=false;show(t().notice);}
 else if(data.status==='form'){form.hidden=false;$('region').textContent=data.regionName||data.region;$('pending').hidden=!data.pendingApplication;show('');}
 else if(data.status==='approved'){completed=true;form.reset();token='';show(t().success);}
 else show(t().unavailable);
};
$('language').value=locale;$('language').onchange=async()=>{const next=$('language').value;if(busy||!['zh_TW','zh_CN','en'].includes(next)){$('language').value=locale;return;}locale=next;render();history.replaceState(null,'',location.pathname+'?lang='+locale);if(completed){show(t().success);return;}if(!/^[A-Za-z0-9_-]{43}$/.test(token)){show(t().unavailable);return;}if(landing){show(target?'':t().unavailable);return;}setBusy(true);try{await load(true);}catch{show(t().failure);}finally{setBusy(false);}};
$('accept').onclick=async()=>{if(busy||!$('accepted').checked||!data?.privacy)return;setBusy(true);try{await api('/learner/privacy/accept',{platform,token:data.privacy.token,version:data.privacy.version,hash:data.privacy.hash,locale,accepted:true,reflectionConsent:false});await load();}catch{show(t().failure);}finally{setBusy(false);}};
if($('channel-country-code'))$('channel-country-code').onchange=()=>{const c=$('channel-country-code').value,p=$('channel-phone');if(!p)return;p.placeholder=c==='+886'?'0912345678':c==='+852'?'91234567':c==='+60'?'0123456789':c==='+65'?'81234567':'+886912345678';};
form.onsubmit=async event=>{event.preventDefault();if(busy||!token||data?.status!=='form')return;
const p=$('channel-phone'),c=$('channel-country-code');if(p&&c){let val=p.value.trim().replace(/[\\s\\-\\(\\)\\.]+/g,'');const code=c.value;if(code==='+886'){if(val.startsWith('+8860'))val='+886'+val.slice(5);else if(val.startsWith('0'))val='+886'+val.slice(1);else if(!val.startsWith('+'))val='+886'+val;}else if(code==='+60'){if(val.startsWith('+600'))val='+60'+val.slice(4);else if(val.startsWith('0'))val='+60'+val.slice(1);else if(!val.startsWith('+'))val='+60'+val;}else if(code==='+852'){if(!val.startsWith('+'))val='+852'+val;}else if(code==='+65'){if(!val.startsWith('+'))val='+65'+val;}else if(!val.startsWith('+'))val='+'+val;p.value=val;}
setBusy(true);show(t().busy);try{const result=await api('/'+platform+'/invite/redeem',{token,locale,name:form.elements.namedItem('name').value,email:form.elements.namedItem('email').value,phone:form.elements.namedItem('phone').value,${platform === 'whatsapp' ? "notificationConsent:$('notification').checked" : 'notificationConsent:false'}});if(result.status!=='approved')throw Error('unconfirmed');completed=true;form.hidden=true;form.reset();token='';show(t().success);}catch{show(t().failure);}finally{setBusy(false);}};
if(!/^[A-Za-z0-9_-]{43}$/.test(token)){show(t().unavailable);}else if(landing){
 const valid=platform==='telegram'?typeof target==='string'&&/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(target):typeof target==='string'&&/^[1-9][0-9]{6,14}$/.test(target);
 if(!valid)show(t().unavailable);else{$('entry').hidden=false;$('open').href=platform==='telegram'?'https://t.me/'+target+'?start=inv_'+token:'https://wa.me/'+target+'?text='+encodeURIComponent('join inv_'+token);}
}else{setBusy(true);load().catch(()=>show(t().unavailable)).finally(()=>setBusy(false));}
</script></body></html>`;
};
