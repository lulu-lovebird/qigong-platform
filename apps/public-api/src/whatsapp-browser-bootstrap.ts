import type { LearnerLocale } from './learner-locale.js';
import { whatsappCsrfCookie } from './whatsapp-browser-session.js';
export const whatsappLoginMarkup = (locale: LearnerLocale) =>
  `<section id="wa-login-panel" class="card" hidden><h2>${locale === 'en' ? 'Sign in to this device' : '登入此裝置'}</h2><p>${locale === 'en' ? 'Use the private link received after sending checkin in WhatsApp.' : '請使用在 WhatsApp 輸入 checkin 後收到的私人連結。'}</p><label><input id="wa-remember" type="checkbox" checked>${locale === 'en' ? 'This is my device. Remember me for 30 days.' : '這是我的裝置，記住30天。'}</label><p class="muted">${locale === 'en' ? 'Uncheck on a shared or public device.' : '共用或公共裝置請取消勾選。'}</p><button id="wa-login" type="button">${locale === 'en' ? 'Sign in and start' : '登入並開始打卡'}</button><p id="wa-login-status" role="status" aria-live="polite"></p></section><section id="wa-session-panel" class="card" hidden><p id="wa-session-status"></p><p>${locale === 'en' ? 'Bookmark this fixed link:' : '請將此固定網址加入書籤：'} <a id="wa-bookmark" href="/whatsapp/checkin?lang=${locale}">https://checkin.baiyinqigong.org/whatsapp/checkin</a></p><button id="wa-logout" type="button">${locale === 'en' ? 'Sign out this device' : '登出此裝置'}</button></section>`;
export const whatsappBrowserBootstrap = (locale: LearnerLocale) => {
  const text = {
    needLink:
      locale === 'en'
        ? 'No valid login. Send checkin in WhatsApp and open the new private link.'
        : '尚無有效登入。請回 WhatsApp 輸入 checkin 並開啟新的私人連結。',
    failed:
      locale === 'en'
        ? 'Login unavailable. Get a new private link in WhatsApp; do not share it.'
        : '登入未完成，請回 WhatsApp 取得新的私人連結，勿轉傳。',
    saved:
      locale === 'en'
        ? 'This device is signed in. Check-ins are saved on the website; no chat summary is sent.'
        : '此裝置已登入。打卡結果只儲存在網頁，不回傳聊天摘要。',
    loggingIn: locale === 'en' ? 'Signing in…' : '登入中…',
    expired:
      locale === 'en'
        ? 'Login expired or access unavailable. Get a new private link in WhatsApp.'
        : '登入已到期或資格／同意無法使用，請回 WhatsApp 取得新連結。',
    logoutFailed:
      locale === 'en'
        ? 'Sign out failed. Your current login is retained; try again.'
        : '登出失敗，目前登入仍保留，請再試。'
  };
  return (
    `const whatsappLoginText=${JSON.stringify(text)};` +
    String.raw`
const whatsappLink=/^([A-Za-z0-9_-]{43})(?:[?&]|$)/.exec(location.hash.slice(1))?.[1]||'';
history.replaceState(null,'',location.pathname+location.search);
const workspaceCredential='';
let whatsappAuthenticated=false,whatsappRelease;
let whatsappReady=new Promise(resolve=>{whatsappRelease=resolve;});
const whatsappCsrf=()=>{const value=(document.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('` +
    whatsappCsrfCookie +
    String.raw`='))?.slice('` +
    whatsappCsrfCookie +
    String.raw`='.length)||'';return /^[A-Za-z0-9_-]{43}$/.test(value)?value:'';};
const workspaceAuthorization=async()=>{await whatsappReady;return '';};
const whatsappLoginNode=id=>document.getElementById(id);
window.addEventListener?.('hashchange',()=>{if(/^[A-Za-z0-9_-]{43}$/.test(location.hash.slice(1))){if(whatsappAuthenticated&&typeof window.whatsappMayLeave==='function'&&!window.whatsappMayLeave()){history.replaceState(null,'',location.pathname+location.search);return;}location.reload();}else history.replaceState(null,'',location.pathname+location.search);});
const whatsappShowLogin=message=>{whatsappLoginNode('wa-login-panel').hidden=false;whatsappLoginNode('wa-session-panel').hidden=true;whatsappLoginNode('wa-login').disabled=!whatsappLink;whatsappLoginNode('wa-login-status').textContent=message;};
const whatsappFinish=()=>{whatsappAuthenticated=true;whatsappLoginNode('wa-login-panel').hidden=true;whatsappLoginNode('wa-session-panel').hidden=false;whatsappLoginNode('wa-session-status').textContent=whatsappLoginText.saved;whatsappRelease();};
const whatsappAuthExpired=()=>{if(!whatsappAuthenticated)return;whatsappAuthenticated=false;whatsappReady=new Promise(resolve=>{whatsappRelease=resolve;});whatsappShowLogin(whatsappLoginText.expired);void fetch('/whatsapp/auth/session',{method:'GET',cache:'no-store',credentials:'same-origin'}).catch(()=>{});};
whatsappLoginNode('wa-remember').checked=true;
whatsappLoginNode('wa-login').onclick=async()=>{const button=whatsappLoginNode('wa-login');if(button.disabled||!whatsappLink)return;button.disabled=true;whatsappLoginNode('wa-login-status').textContent=whatsappLoginText.loggingIn;
 try{const response=await fetch('/whatsapp/auth/session',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({token:whatsappLink,remember:whatsappLoginNode('wa-remember').checked})});if(!response.ok)throw Error('Browser login unavailable');const result=await response.json();if(result.authenticated!==true||!whatsappCsrf())throw Error('Browser login unavailable');whatsappFinish();}catch{whatsappShowLogin(whatsappLoginText.failed);}};
whatsappLoginNode('wa-logout').onclick=async()=>{if(!whatsappAuthenticated)return;if(typeof window.whatsappMayLeave==='function'&&!window.whatsappMayLeave())return;const button=whatsappLoginNode('wa-logout');button.disabled=true;
 try{const response=await fetch('/whatsapp/auth/logout',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'content-type':'application/json','x-whatsapp-csrf-token':whatsappCsrf()},body:'{}'});if(!response.ok)throw Error('Logout unavailable');location.replace(location.pathname+location.search);}catch{window.whatsappLeaveCancelled?.();whatsappLoginNode('wa-session-status').textContent=whatsappLoginText.logoutFailed;button.disabled=false;}};
void(async()=>{try{const response=await fetch('/whatsapp/auth/session',{method:'GET',cache:'no-store',credentials:'same-origin'});if(response.ok){const result=await response.json();if(result.authenticated===true&&whatsappCsrf()){whatsappFinish();return;}}whatsappShowLogin(whatsappLink?'':whatsappLoginText.needLink);}catch{whatsappShowLogin(whatsappLoginText.failed);}})();
`
  );
};
