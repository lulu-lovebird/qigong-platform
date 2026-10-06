export const reviewPage = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>待審核學員｜氣功小幫手</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; color: #203027; background: #f8faf8; }
    header, article { background: white; padding: 1rem 1.5rem; margin-bottom: 1rem; border-radius: .7rem; border: 1px solid #dae5db; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
    h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; }
    button { cursor: pointer; padding: .55rem .9rem; border-radius: .4rem; border: 1px solid #51745b; background: #285c3b; color: white; }
    button:disabled { opacity: .5; cursor: wait; }
    button.reject { background: white; color: #82352f; border-color: #82352f; }
    input { padding: .5rem; width: min(25rem, 100%); box-sizing: border-box; }
    .actions { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }
    #status { min-height: 1.5rem; } .meta { color: #516557; }
    .batch { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; margin-bottom: 1rem; }
    .batch label { display: inline-flex; align-items: center; gap: .4rem; }
    .batch input, .select-application { width: auto; }
    .select-application { margin-right: .5rem; }
  </style>
</head>
<body>
  <header><h1>待審核學員</h1><button id="logout" type="button">登出</button></header>
  <p id="status" role="status" aria-live="polite">載入中…</p>
  <div class="batch">
    <label><input id="select-all" type="checkbox"> 全選目前顯示</label>
    <button id="approve-selected" type="button" disabled>核准已選（0）</button>
  </div>
  <main id="applications"></main>
  <footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer>
  <script>
    const list = document.getElementById('applications');
    const status = document.getElementById('status');
    const selectAll = document.getElementById('select-all');
    const approveSelected = document.getElementById('approve-selected');
    const selections = new Map();
    const csrf = () => document.cookie.split('; ').find(part => part.startsWith('__Host-qigong-admin-csrf='))?.split('=')[1];
    function updateSelection() {
      const checked = [...selections.values()].filter(box => box.checked).length;
      approveSelected.textContent = '核准已選（' + checked + '）';
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
      if (!ids.length || !confirm('確定核准已勾選的 ' + ids.length + ' 筆申請？請先逐筆核對學員資料。')) return;
      approveSelected.disabled = true;
      status.textContent = '批次核准處理中…';
      try {
        const response = await fetch('/admin/api/applications/batch-approve', {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() || '' },
          body: JSON.stringify({ ids })
        });
        if (response.status === 401) { location.assign('/admin/auth/login'); return; }
        if (!response.ok) throw new Error('批次核准失敗，請稍後重試。');
        const { results } = await response.json();
        await load();
        const approved = results.filter(item => item.status === 'approved').length;
        const failed = results.filter(item => item.status !== 'approved');
        status.textContent = '已核准 ' + approved + ' 筆；失敗 ' + failed.length + ' 筆。' +
          (failed.length ? '失敗申請 ID：' + failed.map(item => item.id + '（' + (item.status === 'conflict' ? '狀態或權限變更' : '服務暫時不可用') + '）').join('、') : '');
      } catch (error) { status.textContent = error.message; updateSelection(); }
    });
    async function load() {
      const response = await fetch('/admin/api/applications', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { location.assign('/admin/auth/login'); return; }
      if (!response.ok) throw new Error('無法載入待審名單，請稍後重試。');
      const { applications } = await response.json();
      list.replaceChildren();
      selections.clear();
      status.textContent = applications.length ? '待審核：' + applications.length + ' 筆（最多顯示 100 筆）' : '目前沒有待審核申請。';
      for (const application of applications) {
        const card = document.createElement('article');
        const select = document.createElement('input');
        select.type = 'checkbox';
        select.className = 'select-application';
        select.setAttribute('aria-label', '選取 ' + (application.learner_name || application.display_name || '申請'));
        select.addEventListener('change', updateSelection);
        selections.set(application.id, select);
        const title = document.createElement('h2');
        title.textContent = application.display_name || '未提供名稱';
        const meta = document.createElement('p');
        meta.className = 'meta';
        meta.textContent = '平台：' + application.platform + ' / 地區：' + (application.region_name || '未分派') + ' / 申請時間：' + new Date(application.created_at).toLocaleString('zh-TW');
        const identity = document.createElement('p');
        identity.textContent = '學員姓名：' + (application.learner_name || '未填寫') + ' / 官網 Email：' + (application.website_email || '未填寫') + ' / 含國碼電話：' + (application.phone_e164 || '未填寫');
        const actions = document.createElement('div');
        actions.className = 'actions';
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.textContent = '核准';
        const reason = document.createElement('input');
        reason.placeholder = '拒絕理由（必填）';
        reason.setAttribute('aria-label', '拒絕理由');
        reason.maxLength = 1000;
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'reject';
        reject.textContent = '拒絕';
        async function decide(decision) {
          if (decision === 'rejected' && !reason.value.trim()) { status.textContent = '請填寫拒絕理由。'; reason.focus(); return; }
          approve.disabled = reject.disabled = true;
          try {
            const response = await fetch('/admin/api/applications/' + encodeURIComponent(application.id) + '/decision', {
              method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() || '' },
              body: JSON.stringify({ decision, ...(decision === 'rejected' ? { reason: reason.value.trim() } : {}) })
            });
            if (response.status === 401) { location.assign('/admin/auth/login'); return; }
            if (!response.ok) throw new Error(response.status === 409 ? '申請狀態或權限已變更，請重新整理。' : '操作失敗，請稍後重試。');
            await load();
          } catch (error) { status.textContent = error.message; approve.disabled = reject.disabled = false; }
        }
        approve.addEventListener('click', () => decide('approved'));
        reject.addEventListener('click', () => decide('rejected'));
        actions.append(approve, reason, reject);
        card.append(select, title, meta, identity, actions);
        list.append(card);
      }
      updateSelection();
    }
    document.getElementById('logout').addEventListener('click', async () => {
      const response = await fetch('/admin/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': csrf() || '' } });
      if (response.ok) location.assign('/admin/auth/login');
      else status.textContent = '登出失敗，請稍後重試。';
    });
    load().catch(error => { status.textContent = error.message; });
  </script>
</body>
</html>`;
