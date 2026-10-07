import { renderAdminShell } from './admin-dashboard.js';
import { adminLocaleScript, adminTexts, type AdminLocale } from './admin-locale.js';

export const renderReviewPage = (locale: AdminLocale = 'zh_TW') => {
  const text = adminTexts(locale);
  return renderAdminShell(
    'review',
    `  <p id="status" role="status" aria-live="polite">${text.loading}</p>
  <div class="batch">
    <label><input id="select-all" type="checkbox"> ${text.selectAll}</label>
    <button id="approve-selected" type="button" disabled>${text.approveSelected.replace('{count}', '0')}</button>
  </div>
  <main id="applications"></main>
`,
    `
    ${adminLocaleScript(locale)}
    const list = document.getElementById('applications');
    const status = document.getElementById('status');
    const selectAll = document.getElementById('select-all');
    const approveSelected = document.getElementById('approve-selected');
    const selections = new Map();
    const csrf = () => document.cookie.split('; ').find(part => part.startsWith('__Host-qigong-admin-csrf='))?.split('=')[1];
    function updateSelection() {
      const checked = [...selections.values()].filter(box => box.checked).length;
      approveSelected.textContent = message('approveSelected',{count:checked});
      approveSelected.disabled = checked === 0;
      selectAll.checked = selections.size > 0 && checked === selections.size;
      selectAll.indeterminate = checked > 0 && checked < selections.size;
      selectAll.disabled = selections.size === 0;
    }
    selectAll.addEventListener('change', () => {
      for (const box of selections.values()) box.checked = selectAll.checked;
      updateSelection();
    });
    approveSelected.addEventListener('click', async () => {
      const ids = [...selections].filter(([, box]) => box.checked).map(([id]) => id);
      if (!ids.length || !confirm(message('batchConfirm',{count:ids.length}))) return;
      approveSelected.disabled = true;
      status.textContent = t.batchProcessing;
      try {
        const response = await fetch('/admin/api/applications/batch-approve', {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() || '' },
          body: JSON.stringify({ ids })
        }).catch(()=>{throw new Error(t.batchFailed);});
        if (response.status === 401) { location.assign('/admin/auth/login'); return; }
        if (!response.ok) throw new Error(t.batchFailed);
        const { results } = await response.json().catch(()=>{throw new Error(t.batchFailed);});
        await load();
        const approved = results.filter(item => item.status === 'approved').length;
        const failed = results.filter(item => item.status !== 'approved');
        status.textContent = message('batchResult',{approved,failed:failed.length}) +
          (failed.length ? t.failedIds + failed.map(item => item.id + (locale === 'en' ? ' (' : '（') + (item.status === 'conflict' ? t.reviewConflict : t.unavailable) + (locale === 'en' ? ')' : '）')).join(t.listSeparator) : '');
      } catch (error) { status.textContent = localizedFailure(error,t.batchFailed); updateSelection(); }
    });
    async function load() {
      const response = await fetch('/admin/api/applications?lang='+locale, { credentials: 'same-origin', cache: 'no-store' }).catch(()=>{throw new Error(t.applicationsFailed);});
      if (response.status === 401) { location.assign('/admin/auth/login'); return; }
      if (!response.ok) throw new Error(t.applicationsFailed);
      const { applications } = await response.json().catch(()=>{throw new Error(t.applicationsFailed);});
      list.replaceChildren();
      selections.clear();
      status.textContent = applications.length ? message('pendingCount',{count:applications.length}) : t.noApplications;
      for (const application of applications) {
        const card = document.createElement('article');
        const select = document.createElement('input');
        select.type = 'checkbox';
        select.className = 'select-application';
        select.setAttribute('aria-label', message('selectApplication',{name:application.learner_name || application.display_name || t.application}));
        select.addEventListener('change', updateSelection);
        selections.set(application.id, select);
        const title = document.createElement('h2');
        title.textContent = application.display_name || t.noName;
        const meta = document.createElement('p');
        meta.className = 'meta';
        meta.textContent = message('applicationMeta',{platform:application.platform,region:application.region_name || t.unassigned,date:new Date(application.created_at).toLocaleString(locale === 'en' ? 'en' : 'zh-TW')});
        const identity = document.createElement('p');
        identity.textContent = message('identityDetails',{name:application.learner_name || t.notProvided,email:application.website_email || t.notProvided,phone:application.phone_e164 || t.notProvided});
        const actions = document.createElement('div');
        actions.className = 'actions';
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.textContent = t.approve;
        const reason = document.createElement('input');
        reason.placeholder = t.rejectionPlaceholder;
        reason.setAttribute('aria-label', t.rejectionReason);
        reason.maxLength = 1000;
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'reject';
        reject.textContent = t.reject;
        async function decide(decision) {
          if (decision === 'rejected' && !reason.value.trim()) { status.textContent = t.reasonRequired; reason.focus(); return; }
          approve.disabled = reject.disabled = true;
          try {
            const response = await fetch('/admin/api/applications/' + encodeURIComponent(application.id) + '/decision', {
              method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() || '' },
              body: JSON.stringify({ decision, ...(decision === 'rejected' ? { reason: reason.value.trim() } : {}) })
            }).catch(()=>{throw new Error(t.decisionFailed);});
            if (response.status === 401) { location.assign('/admin/auth/login'); return; }
            if (!response.ok) throw new Error(response.status === 409 ? t.decisionConflict : t.decisionFailed);
            await load();
          } catch (error) { status.textContent = localizedFailure(error,t.decisionFailed); approve.disabled = reject.disabled = false; }
        }
        approve.addEventListener('click', () => decide('approved'));
        reject.addEventListener('click', () => decide('rejected'));
        actions.append(approve, reason, reject);
        card.append(select, title, meta, identity, actions);
        list.append(card);
      }
      updateSelection();
    }
    load().catch(error => { status.textContent = localizedFailure(error,t.applicationsFailed); });
`,
    locale
  );
};

export const reviewPage = renderReviewPage();
