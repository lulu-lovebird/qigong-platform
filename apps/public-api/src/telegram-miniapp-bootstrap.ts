// Keep native signed initData for the SDK; never cache platform capabilities.
export const telegramMiniappBootstrap = String.raw`
const workspaceFragment=location.hash.slice(1);
const workspacePrefix=/^([A-Za-z0-9_-]{43})(?:[?&]|$)/.exec(workspaceFragment);
let workspaceCredential=workspacePrefix?.[1]||new URLSearchParams(workspaceFragment).get('token')||'';
const workspaceNativeFragment=(workspacePrefix?workspaceFragment.slice(workspacePrefix[1].length).replace(/^[?&]/,''):workspaceFragment).split('&').filter(part=>part.startsWith('tgWebApp')).join('&');
history.replaceState(null,'',location.pathname+location.search+(workspaceNativeFragment?'#'+workspaceNativeFragment:''));
let workspaceSessionExpires=0,workspaceSessionPending=null;
const workspaceAuthorization=async()=>{
 const proof=window.Telegram?.WebApp?.initData||'';
 if(!proof){if(/^[A-Za-z0-9_-]{43}$/.test(workspaceCredential))return workspaceCredential;const e=new Error('Mini App launch required');e.status=403;throw e;}
 if(workspaceCredential&&Date.now()+30000<workspaceSessionExpires)return workspaceCredential;
 if(!workspaceSessionPending)workspaceSessionPending=(async()=>{
  const locale=typeof workspaceLocale!=='undefined'?workspaceLocale:journalLocale;
  const response=await fetch('/telegram/workspace/session',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({initData:proof,locale}),signal:AbortSignal.timeout(15000)});
  const body=await response.json();if(!response.ok){const e=new Error('Mini App session unavailable');e.status=response.status;throw e;}
  if(body.status==='consent_required'){if(typeof body.privacyUrl==='string'&&body.privacyUrl.startsWith('/privacy?platform=telegram&'))location.href=body.privacyUrl;const e=new Error('Privacy acceptance required');e.status=403;throw e;}
  if(body.status!=='ready'||!/^[A-Za-z0-9_-]{43}$/.test(body.token)||!Number.isFinite(body.expiresIn)||body.expiresIn<1||body.expiresIn>900)throw new Error('Invalid Mini App session');
  workspaceCredential=body.token;workspaceSessionExpires=Date.now()+body.expiresIn*1000;return workspaceCredential;
 })().finally(()=>{workspaceSessionPending=null;});
 return workspaceSessionPending;
};
`;
