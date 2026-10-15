import { uiText } from './ui-localization.js';
import type { AdminLocale } from './admin-locale.js';
import { renderAdminShell } from './admin-dashboard.js';
export const renderReviewNotificationPage = (locale: AdminLocale, canManageAdmins = false) => {
  const en = locale === 'en',
    t = {
      intro: en
        ? 'Private Telegram alerts contain only counts and authorized region, never applicant personal details. Binding does not grant permissions.'
        : uiText(
            locale,
            'Telegram私聊通知只含筆數與有權審核的地區，不含申請人個資；綁定不授予任何權限。'
          ),
      begin: en ? 'Begin Telegram binding' : uiText(locale, '產生Telegram綁定指令'),
      instructions: en
        ? 'Copy this command to the new platform Bot in a private chat. Enter the returned6-digit code here, then confirm. Never forward either secret.'
        : uiText(
            locale,
            '把以下指令複製到新平台Bot私聊，將Bot回覆的6位確認碼輸入此頁再確認。不要轉傳指令或確認碼。'
          ),
      confirm: en ? 'Confirm my Telegram account' : uiText(locale, '確認綁定本人的Telegram'),
      admin: en ? 'Notify new administrator applications' : uiText(locale, '通知新的管理員申請'),
      learner: en ? 'Notify new learner applications' : uiText(locale, '通知新的學員申請'),
      save: en ? 'Save notification preferences' : uiText(locale, '儲存通知偏好'),
      test: en
        ? 'Send a private test (worker required)'
        : uiText(locale, '排入本人測試通知（需排程啟用）'),
      disconnect: en
        ? 'Disconnect and stop pending notifications'
        : uiText(locale, '解除綁定並停止待送通知'),
      reload: en ? 'Refresh' : uiText(locale, '重新整理'),
      off: en
        ? 'Not bound; no outbound notifications.'
        : uiText(locale, '尚未綁定，不會發送通知。'),
      bound: en ? 'Bound account' : uiText(locale, '已綁定帳號'),
      pending: en ? 'Pending applications in your scope' : uiText(locale, '你可審核的待審申請'),
      unrouted: en ? 'No active notification delivery route' : uiText(locale, '尚無可用通知路由'),
      failed: en ? 'Failed deliveries' : uiText(locale, '發送失敗'),
      failure: en
        ? 'Operation unavailable or data changed. Refresh before retrying.'
        : uiText(locale, '操作未完成或資料已變更，請重新整理後再試。'),
      saved: en
        ? 'Saved. Outbound delivery requires operator-enabled worker.'
        : uiText(locale, '已儲存；實際發送需營運者啟用通知排程。'),
      invalidCode: en
        ? 'Confirmation failed. Check the code; at most5 attempts before a new link is required.'
        : uiText(locale, '確認失敗，請核對本人Bot確認碼；最多5次，之後需產生新連結。'),
      cancel: en
        ? 'Disconnect this account? Unsent alerts will be cancelled.'
        : uiText(locale, '解除此帳號綁定？尚未送出的通知將取消。'),
      privacy: en
        ? 'Open the secure admin portal to inspect applications and review. Chats do not approve applications.'
        : uiText(locale, '請登入安全後台檢視並審核申請，聊天不直接核准。')
    };
  return renderAdminShell(
    'notifications',
    `<style>#notify-preferences .notify-option{display:flex;align-items:flex-start;gap:.5rem;min-height:var(--admin-control-height);margin:.25rem 0;font-size:inherit;cursor:pointer}#notify-preferences .notify-option input[type="checkbox"]{flex:0 0 1rem;width:1rem;height:1rem;margin:.15rem 0 0}#notify-preferences .notify-option span{min-width:0;flex:1;overflow-wrap:anywhere}</style><section class="card"><p>${t.intro}</p><p>${t.privacy}</p><p id="notify-bound"></p><div class="actions"><button id="notify-begin" type="button">${t.begin}</button><button id="notify-disconnect" class="secondary" type="button">${t.disconnect}</button></div><section id="notify-link" hidden><p>${t.instructions}</p><textarea id="notify-command" readonly aria-label="Private binding command"></textarea><form id="notify-confirm" class="filters"><label>${en ? 'Telegram confirmation code' : uiText(locale, 'Telegram確認碼')}<input name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="off" required></label><button type="submit">${t.confirm}</button></form><p id="notify-expiry"></p></section></section><section class="card"><form id="notify-preferences"><label class="notify-option"><input name="adminEnabled" type="checkbox"><span>${t.admin}</span></label><label class="notify-option"><input name="learnerEnabled" type="checkbox"><span>${t.learner}</span></label><button type="submit">${t.save}</button></form><p><button id="notify-test" type="button">${t.test}</button></p></section><p id="status" role="status" aria-live="polite"></p><section class="card"><div id="notify-counts"></div><div id="notify-events"></div><button id="notify-reload" type="button">${t.reload}</button></section>`,
    String.raw`
(()=>{const locale=` +
      JSON.stringify(locale) +
      String.raw`;
const ui=` +
      JSON.stringify(t) +
      uiText(
        locale,
        String.raw`;const $=id=>document.getElementById(id);let current=null,link=null,busy=false;
const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e;};
const csrf=()=>document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-qigong-admin-csrf='))?.slice('__Host-qigong-admin-csrf='.length)||'';
const api=async(path,body)=>{const r=await fetch('/admin/api/notifications'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'content-type':'application/json','x-csrf-token':csrf()}:undefined,body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error==='invalid_notification_confirmation'?ui.invalidCode:ui.failure);return data;};
const lock=value=>{busy=value;for(const button of document.querySelectorAll('#main button'))button.disabled=value;};
const load=async()=>{current=await api('/state');$('notify-bound').textContent=current.bound?ui.bound+': '+current.recipientHint:ui.off;$('notify-preferences').elements.adminEnabled.checked=current.adminEnabled;$('notify-preferences').elements.learnerEnabled.checked=current.learnerEnabled;link=current.link;$('notify-link').hidden=!link;$('notify-expiry').textContent=link?link.expiresAt:'';$('notify-disconnect').disabled=!current.bound;$('notify-test').disabled=!current.bound;$('notify-counts').replaceChildren();for(const [title,count]of [[ui.pending,current.pendingCount],[ui.unrouted,current.unroutedCount],[ui.failed,current.failedCount]])$('notify-counts').append(node('p',title+': '+count));$('notify-events').replaceChildren();for(const event of current.events){const article=node('article');article.append(node('p',(event.kind==='admin'?ui.admin:ui.learner)+' · '+event.createdAt+(event.region?' · '+event.region:'')));const a=node('a',locale==='en'?'Review in admin portal':'登入後台審核');a.href=event.kind==='admin'?'/admin/administrators':'/admin/applications';article.append(a);$('notify-events').append(article);}};
const action=async fn=>{if(busy)return;lock(true);try{await fn();}catch(error){$('status').textContent=error.message;}finally{lock(false);if(current){$('notify-disconnect').disabled=!current.bound;$('notify-test').disabled=!current.bound;}}};
$('notify-begin').onclick=()=>action(async()=>{const result=await api('/link',{locale});$('notify-command').value='/admin_notify '+result.token;$('notify-confirm').reset();await load();$('status').textContent=ui.instructions;});
$('notify-confirm').onsubmit=event=>{event.preventDefault();void action(async()=>{if(!link||!current)return;const code=event.target.elements.code.value;await api('/confirm',{id:link.id,code,version:current.revision});$('notify-command').value='';event.target.reset();await load();$('status').textContent=ui.saved;});};
$('notify-preferences').onsubmit=event=>{event.preventDefault();void action(async()=>{if(!current)return;await api('/preferences',{version:current.revision,adminEnabled:event.target.elements.adminEnabled.checked,learnerEnabled:event.target.elements.learnerEnabled.checked,locale});await load();$('status').textContent=ui.saved;});};
$('notify-disconnect').onclick=()=>action(async()=>{if(!current||!confirm(ui.cancel))return;await api('/preferences',{version:current.revision,adminEnabled:false,learnerEnabled:false,locale,disconnect:true});$('notify-command').value='';await load();});
$('notify-test').onclick=()=>action(async()=>{await api('/test',{});$('status').textContent=ui.saved;});$('notify-reload').onclick=()=>action(load);void action(load);
})();
`
      ),
    locale,
    canManageAdmins
  );
};
