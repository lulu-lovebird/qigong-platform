import type { LearnerLocale } from './learner-locale.js';
import {
  learnerPrivacyDocument,
  learnerPrivacyHash,
  learnerPrivacyVersion,
  learnerPrivacyContact,
  officialPrivacyUrl
} from './learner-privacy-policy.js';
import { learnerPrivacyTexts } from './learner-privacy-locale.js';
export const escapePrivacyHtml = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
export const renderPrivacyDocument = (locale: LearnerLocale): string =>
  learnerPrivacyDocument(locale)
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const h = /^(#{1,3}) (.+)$/.exec(block);
      return h
        ? '<h' + h[1]!.length + '>' + escapePrivacyHtml(h[2]!) + '</h' + h[1]!.length + '>'
        : '<p>' + escapePrivacyHtml(block).replaceAll('\n', '<br>') + '</p>';
    })
    .join('');
export const renderLearnerPrivacyPage = (
  locale: LearnerLocale,
  platform: 'telegram' | 'line' | 'whatsapp',
  active: boolean
) => {
  const t = learnerPrivacyTexts(locale),
    config = { locale, platform, active, version: learnerPrivacyVersion, hash: learnerPrivacyHash };
  return `<!doctype html><html lang="${locale === 'en' ? 'en' : 'zh-Hant'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${t.title}</title><style>*{box-sizing:border-box}body{font:16px/1.7 system-ui,sans-serif;margin:0;color:#203027;background:#f3f6f4}main{max-width:860px;margin:auto;padding:18px}article{background:white;border:1px solid #dce6df;border-radius:12px;padding:20px}h1{font-size:24px}h2{font-size:20px}p{overflow-wrap:anywhere}label{display:block;margin:18px 0}label input{margin-right:10px;width:20px;height:20px;vertical-align:middle}button,select{font:inherit;padding:10px;max-width:100%}button{background:#285c3b;color:white;border:0;border-radius:8px;margin:8px 8px 8px 0}button:disabled{opacity:.5}fieldset{border:0;padding:0;min-width:0}#privacy-status[data-error=true]{color:#a12c24}footer{margin:24px 0;font-size:13px}a{color:#285c3b}[hidden]{display:none!important}</style></head><body><main><label>${t.language}<select id="privacy-language"><option value="zh_TW"${locale === 'zh_TW' ? ' selected' : ''}>繁體中文</option><option value="en"${locale === 'en' ? ' selected' : ''}>English</option></select></label><p><a href="${officialPrivacyUrl}" target="_blank" rel="noopener noreferrer">${t.official}</a></p><p id="privacy-draft">${active ? t.published : t.draft}</p><article>${renderPrivacyDocument(locale)}</article><p id="privacy-status" role="status" aria-live="polite"></p><form id="privacy-form"><fieldset id="privacy-fields"${active ? '' : ' disabled'}><label><input id="privacy-accepted" type="checkbox" required>${t.accept}</label><label><input id="privacy-reflections" type="checkbox">${t.reflections}</label><button id="privacy-submit" type="submit" disabled>${t.submit}</button><button id="privacy-decline" type="button">${t.decline}</button></fieldset></form><footer>${t.brand}｜${t.contact}：${learnerPrivacyContact.name} <a href="mailto:${learnerPrivacyContact.email}">${learnerPrivacyContact.email}</a></footer></main><script>const privacyConfig=${JSON.stringify(config)},privacyUI=${JSON.stringify(t)};${learnerPrivacyScript}</script></body></html>`;
};
export const learnerPrivacyScript = String.raw`
(()=>{const $=id=>document.getElementById(id),t=privacyUI,c=privacyConfig,fragment=location.hash.slice(1).split('?')[0]||'',token=/^[A-Za-z0-9_-]{43}$/.test(fragment)?fragment:'';history.replaceState(null,'',location.pathname+location.search);let busy=false,saved=false,leaving=false;
 const dirty=()=>!saved&&($('privacy-accepted').checked||$('privacy-reflections').checked);
 const status=(text,error=false)=>{$('privacy-status').textContent=text;$('privacy-status').dataset.error=String(error);};
 const update=()=>{$('privacy-submit').disabled=busy||saved||!c.active||!$('privacy-accepted').checked;};
 $('privacy-accepted').onchange=update;$('privacy-reflections').onchange=update;
 $('privacy-form').onsubmit=async e=>{e.preventDefault();if(busy||saved||!c.active||!$('privacy-accepted').checked)return;busy=true;$('privacy-fields').disabled=true;update();try{const r=await fetch('/learner/privacy/accept',{method:'POST',headers:{'content-type':'application/json'},cache:'no-store',signal:AbortSignal.timeout(15000),body:JSON.stringify({platform:c.platform,token,version:c.version,hash:c.hash,locale:c.locale,accepted:true,reflectionConsent:$('privacy-reflections').checked})});if(!r.ok){status(r.status===409?t.conflict:r.status===403?t.unavailable:t.failed,true);return;}saved=true;status(t.accepted);}catch{status(t.failed,true);}finally{busy=false;$('privacy-fields').disabled=saved;update();}};
 $('privacy-decline').onclick=()=>{if(busy)return;$('privacy-accepted').checked=false;$('privacy-reflections').checked=false;update();status(t.unavailable);};
 $('privacy-language').onchange=()=>{if(busy||(dirty()&&!confirm(t.discard))){$('privacy-language').value=c.locale;return;}const next=$('privacy-language').value;if(!['zh_TW','en'].includes(next))return;leaving=true;location.href='/privacy?lang='+next+'&platform='+c.platform+(token?'#'+token:'');};
 window.addEventListener('beforeunload',e=>{if(!leaving&&(busy||dirty())){e.preventDefault();e.returnValue='';}});
 if(!c.active)return;if(!/^[A-Za-z0-9_-]{43}$/.test(token)){$('privacy-fields').disabled=true;status(t.unavailable,true);}update();})();
`;
