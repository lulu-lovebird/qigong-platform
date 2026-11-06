/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved. */
import { renderAdminShell } from './admin-dashboard.js';
import { type AdminLocale } from './admin-locale.js';

export const renderAdminGuidancePage = (
  locale: AdminLocale = 'zh_TW',
  canManageAdmins = false
): string => {
  const isEn = locale === 'en';
  const isCn = locale === 'zh_CN';
  const t = {
    title: isEn ? 'Practice Guidance Management' : isCn ? '练功指引管理' : '練功指引管理',
    desc: isEn
      ? 'Configure date ranges and daily instructions. Practicing learners will receive these instructions in their daily check-in receipts.'
      : isCn
        ? '设置特定活动区间与每日练功指引。学员于该期间成功打卡后，系统会自动在打卡回条中附上当日说明文字。'
        : '設定特定活動區間與每日練功指引。學員於該期間成功打卡後，系統會自動在打卡回條中附上當日說明文字。',
    campaignsHeading: isEn ? 'Guidance Campaigns' : isCn ? '活动列表' : '活動列表',
    createBtn: isEn ? '+ New Campaign' : isCn ? '+ 新增活动' : '+ 新增活動',
    campaignTitle: isEn ? 'Campaign Title' : isCn ? '活动名称' : '活動名稱',
    startDate: isEn ? 'Start Date' : isCn ? '起始日期' : '起始日期',
    endDate: isEn ? 'End Date' : isCn ? '结束日期' : '結束日期',
    status: isEn ? 'Status' : isCn ? '状态' : '狀態',
    active: isEn ? 'Active' : isCn ? '进行中' : '進行中',
    inactive: isEn ? 'Inactive' : isCn ? '已停用' : '已停用',
    actions: isEn ? 'Actions' : isCn ? '操作' : '操作',
    editEntries: isEn ? 'Daily Instructions' : isCn ? '维护每日指引' : '維護每日指引',
    daysCount: isEn ? 'Days Set' : isCn ? '已设定天数' : '已設定天數',
    save: isEn ? 'Save' : isCn ? '保存' : '儲存',
    cancel: isEn ? 'Cancel' : isCn ? '取消' : '取消',
    delete: isEn ? 'Delete' : isCn ? '删除' : '刪除',
    exportCsv: isEn ? 'Export CSV' : isCn ? '导出 CSV 模版' : '匯出 CSV 範本',
    importCsv: isEn ? 'Batch Upload CSV' : isCn ? '批量上传 CSV' : '整批上傳 CSV',
    loading: isEn ? 'Loading...' : isCn ? '载入中...' : '載入中...',
    guideDate: isEn ? 'Date' : isCn ? '日期' : '日期',
    dayTitle: isEn
      ? 'Daily Theme / Subtitle (optional)'
      : isCn
        ? '当日主题（选填）'
        : '當日主題（選填）',
    content: isEn
      ? 'Instruction Content (max 500 chars)'
      : isCn
        ? '说明文字（最多500字）'
        : '說明文字（最多500字）',
    previewReceipt: isEn ? 'Preview Receipt' : isCn ? '打卡回条预览' : '打卡回條預覽'
  };

  const body = `
  <section class="card" aria-labelledby="guidance-heading">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:1rem;">
      <div>
        <h1 id="guidance-heading" style="margin:0;">${t.title}</h1>
        <p class="muted" style="margin:.5rem 0 0;">${t.desc}</p>
      </div>
      <button type="button" id="btn-new-campaign" class="button" style="background:var(--brand-primary);color:white;min-height:40px;padding:0 1.2rem;">${t.createBtn}</button>
    </div>

    <p id="status-bar" role="status" aria-live="polite" style="padding:.6rem;background:var(--surface-muted);border-radius:.4rem;">${t.loading}</p>

    <!-- Campaigns List Table -->
    <div class="table-scroll" style="margin-top:1.5rem;overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;background:white;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);text-align:left;">
            <th style="padding:.75rem;">${t.campaignTitle}</th>
            <th style="padding:.75rem;">${t.startDate}</th>
            <th style="padding:.75rem;">${t.endDate}</th>
            <th style="padding:.75rem;">${t.daysCount}</th>
            <th style="padding:.75rem;">${t.status}</th>
            <th style="padding:.75rem;text-align:right;">${t.actions}</th>
          </tr>
        </thead>
        <tbody id="campaigns-tbody">
          <tr><td colspan="6" style="padding:1.5rem;text-align:center;color:var(--muted);">${t.loading}</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- Campaign Edit Dialog Modal -->
  <dialog id="campaign-dialog" style="padding:1.5rem;border:1px solid var(--border);border-radius:.8rem;max-width:500px;width:90%;">
    <form id="campaign-form" method="dialog">
      <h2 id="dialog-title" style="margin-top:0;">${t.createBtn}</h2>
      <input type="hidden" id="form-campaign-id">
      <label style="display:block;margin-bottom:1rem;">
        <span>${t.campaignTitle}</span>
        <input type="text" id="form-title" required maxlength="150" style="width:100%;min-height:38px;padding:.4rem;margin-top:.3rem;">
      </label>
      <div style="display:flex;gap:1rem;margin-bottom:1rem;">
        <label style="flex:1;">
          <span>${t.startDate}</span>
          <input type="date" id="form-start-date" required style="width:100%;min-height:38px;padding:.4rem;margin-top:.3rem;">
        </label>
        <label style="flex:1;">
          <span>${t.endDate}</span>
          <input type="date" id="form-end-date" required style="width:100%;min-height:38px;padding:.4rem;margin-top:.3rem;">
        </label>
      </div>
      <label style="display:flex;align-items:center;gap:.5rem;margin-bottom:1.5rem;">
        <input type="checkbox" id="form-is-active" checked style="width:18px;height:18px;">
        <span>${t.active}</span>
      </label>
      <div style="display:flex;justify-content:flex-end;gap:.8rem;">
        <button type="button" id="btn-dialog-cancel" class="button" style="min-height:36px;padding:0 1rem;">${t.cancel}</button>
        <button type="submit" id="btn-dialog-save" class="button" style="background:var(--brand-primary);color:white;min-height:36px;padding:0 1.2rem;">${t.save}</button>
      </div>
    </form>
  </dialog>

  <!-- Daily Entries Drawer Section (Shown when a campaign is selected) -->
  <section id="entries-section" class="card" style="margin-top:1.5rem;" hidden>
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:1rem;">
      <div>
        <h2 id="entries-campaign-title" style="margin:0;"></h2>
        <p id="entries-campaign-dates" class="muted" style="margin:.3rem 0 0;"></p>
      </div>
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
        <button type="button" id="btn-export-csv" class="button" style="min-height:36px;padding:0 .8rem;background:#176b53;color:white;">${t.exportCsv}</button>
        <label class="button" style="min-height:36px;padding:0 .8rem;background:#164e83;color:white;display:inline-flex;align-items:center;cursor:pointer;">
          ${t.importCsv}
          <input type="file" id="input-import-csv" accept=".csv" style="display:none;">
        </label>
        <button type="button" id="btn-save-all-entries" class="button" style="min-height:36px;padding:0 1rem;background:var(--brand-primary);color:white;">${t.save}</button>
      </div>
    </div>

    <div class="table-scroll" style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;background:white;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);text-align:left;">
            <th style="padding:.6rem;width:120px;">${t.guideDate}</th>
            <th style="padding:.6rem;width:200px;">${t.dayTitle}</th>
            <th style="padding:.6rem;">${t.content}</th>
          </tr>
        </thead>
        <tbody id="entries-tbody">
        </tbody>
      </table>
    </div>
  </section>

  <script>
  (() => {
    const csrf = () => (document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-qigong-admin-csrf='))||'').slice(26);
    const statusBar = document.getElementById('status-bar');
    const campaignsTbody = document.getElementById('campaigns-tbody');
    const dialog = document.getElementById('campaign-dialog');
    const form = document.getElementById('campaign-form');
    const entriesSection = document.getElementById('entries-section');
    const entriesTbody = document.getElementById('entries-tbody');

    let currentCampaign = null;
    let campaigns = [];

    async function api(action, payload = {}) {
      const res = await fetch('/admin/api/practice-guidance/' + action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() },
        body: JSON.stringify(payload)
      });
      if (res.status === 401) { location.assign('/admin/auth/login'); return null; }
      if (!res.ok) throw new Error('API failed: ' + res.status);
      return res.json();
    }

    async function loadCampaigns() {
      try {
        statusBar.textContent = '${t.loading}';
        const data = await api('list');
        if (!data) return;
        campaigns = data;
        campaignsTbody.replaceChildren();

        if (!campaigns.length) {
          campaignsTbody.innerHTML = '<tr><td colspan="6" style="padding:1.5rem;text-align:center;color:var(--muted);">尚無建立之練功指引活動</td></tr>';
          statusBar.textContent = '就緒：目前無活動。';
          return;
        }

        for (const c of campaigns) {
          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid var(--border)';

          const tdTitle = document.createElement('td');
          tdTitle.style.padding = '.75rem';
          tdTitle.innerHTML = '<strong>' + c.title + '</strong>';

          const tdStart = document.createElement('td');
          tdStart.style.padding = '.75rem';
          tdStart.textContent = c.startDate;

          const tdEnd = document.createElement('td');
          tdEnd.style.padding = '.75rem';
          tdEnd.textContent = c.endDate;

          const tdDays = document.createElement('td');
          tdDays.style.padding = '.75rem';
          tdDays.textContent = c.entryCount + ' / ' + c.totalDays + ' 天';

          const tdStatus = document.createElement('td');
          tdStatus.style.padding = '.75rem';
          tdStatus.innerHTML = c.isActive ? '<span style="color:#176b53;font-weight:bold;">${t.active}</span>' : '<span style="color:var(--muted);">${t.inactive}</span>';

          const tdActions = document.createElement('td');
          tdActions.style.padding = '.75rem';
          tdActions.style.textAlign = 'right';

          const btnEntries = document.createElement('button');
          btnEntries.className = 'button';
          btnEntries.textContent = '${t.editEntries}';
          btnEntries.style.cssText = 'padding:.3rem .6rem;margin-right:.5rem;min-height:30px;';
          btnEntries.onclick = () => openEntries(c.id);

          const btnEdit = document.createElement('button');
          btnEdit.className = 'button';
          btnEdit.textContent = '編輯';
          btnEdit.style.cssText = 'padding:.3rem .6rem;margin-right:.5rem;min-height:30px;';
          btnEdit.onclick = () => openEditDialog(c);

          const btnDelete = document.createElement('button');
          btnDelete.className = 'button';
          btnDelete.textContent = '${t.delete}';
          btnDelete.style.cssText = 'padding:.3rem .6rem;color:#b91c1c;min-height:30px;';
          btnDelete.onclick = async () => {
            if (!confirm('確定要刪除「' + c.title + '」活動與其所有每日指引嗎？')) return;
            await api('delete', { id: c.id });
            if (currentCampaign?.id === c.id) entriesSection.hidden = true;
            await loadCampaigns();
          };

          tdActions.append(btnEntries, btnEdit, btnDelete);
          tr.append(tdTitle, tdStart, tdEnd, tdDays, tdStatus, tdActions);
          campaignsTbody.append(tr);
        }

        statusBar.textContent = '就緒：已載入 ' + campaigns.length + ' 個活動。';
      } catch (err) {
        statusBar.textContent = '載入活動失敗，請稍後重試。';
      }
    }

    function openEditDialog(c = null) {
      document.getElementById('dialog-title').textContent = c ? '編輯活動' : '${t.createBtn}';
      document.getElementById('form-campaign-id').value = c ? c.id : '';
      document.getElementById('form-title').value = c ? c.title : '';
      document.getElementById('form-start-date').value = c ? c.startDate : '';
      document.getElementById('form-end-date').value = c ? c.endDate : '';
      document.getElementById('form-is-active').checked = c ? c.isActive : true;
      dialog.showModal();
    }

    document.getElementById('btn-new-campaign').onclick = () => openEditDialog();
    document.getElementById('btn-dialog-cancel').onclick = () => dialog.close();

    form.onsubmit = async (e) => {
      e.preventDefault();
      const id = document.getElementById('form-campaign-id').value;
      const title = document.getElementById('form-title').value;
      const startDate = document.getElementById('form-start-date').value;
      const endDate = document.getElementById('form-end-date').value;
      const isActive = document.getElementById('form-is-active').checked;

      dialog.close();
      if (id) {
        await api('update', { id, title, startDate, endDate, isActive });
      } else {
        await api('create', { title, startDate, endDate, isActive });
      }
      await loadCampaigns();
    };

    async function openEntries(campaignId) {
      statusBar.textContent = '正在載入活動指引內容…';
      const c = await api('get', { id: campaignId });
      if (!c) return;
      currentCampaign = c;

      document.getElementById('entries-campaign-title').textContent = c.title;
      document.getElementById('entries-campaign-dates').textContent = c.startDate + ' 至 ' + c.endDate;
      entriesSection.hidden = false;
      entriesSection.scrollIntoView({ behavior: 'smooth' });

      // Build date list from startDate to endDate
      const entriesMap = new Map();
      for (const e of c.entries) {
        entriesMap.set(e.guideDate, e);
      }

      entriesTbody.replaceChildren();
      const curr = new Date(c.startDate + 'T00:00:00Z');
      const end = new Date(c.endDate + 'T00:00:00Z');

      while (curr <= end) {
        const dStr = curr.toISOString().slice(0, 10);
        const entry = entriesMap.get(dStr) || { title: '', content: '' };

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border)';
        tr.dataset.guideDate = dStr;

        const tdDate = document.createElement('td');
        tdDate.style.padding = '.6rem';
        tdDate.innerHTML = '<strong>' + dStr.slice(5) + '</strong><br><small class="muted">' + dStr.slice(0, 4) + '</small>';

        const tdTitle = document.createElement('td');
        tdTitle.style.padding = '.6rem';
        const inTitle = document.createElement('input');
        inTitle.type = 'text';
        inTitle.maxLength = 100;
        inTitle.value = entry.title || '';
        inTitle.placeholder = '當日主題…';
        inTitle.style.cssText = 'width:100%;padding:.3rem;min-height:34px;';
        inTitle.className = 'entry-title';
        tdTitle.append(inTitle);

        const tdContent = document.createElement('td');
        tdContent.style.padding = '.6rem';
        const inContent = document.createElement('textarea');
        inContent.rows = 2;
        inContent.maxLength = 500;
        inContent.value = entry.content || '';
        inContent.placeholder = '當日練功指引／激勵文字（最多 500 字）…';
        inContent.style.cssText = 'width:100%;padding:.4rem;resize:vertical;font-family:inherit;';
        inContent.className = 'entry-content';
        tdContent.append(inContent);

        tr.append(tdDate, tdTitle, tdContent);
        entriesTbody.append(tr);

        curr.setUTCDate(curr.getUTCDate() + 1);
      }

      statusBar.textContent = '已載入「' + c.title + '」每日指引。';
    }

    // Save all entries
    document.getElementById('btn-save-all-entries').onclick = async () => {
      if (!currentCampaign) return;
      const rows = entriesTbody.querySelectorAll('tr[data-guide-date]');
      const entries = [];
      for (const row of rows) {
        const guide_date = row.dataset.guideDate;
        const title = row.querySelector('.entry-title').value;
        const content = row.querySelector('.entry-content').value;
        entries.push({ guide_date, title, content });
      }

      statusBar.textContent = '正在儲存每日指引…';
      await api('upsert_entries', { campaignId: currentCampaign.id, entries });
      statusBar.textContent = '儲存完成！';
      await loadCampaigns();
    };

    // CSV Export Template
    document.getElementById('btn-export-csv').onclick = () => {
      if (!currentCampaign) return;
      const rows = entriesTbody.querySelectorAll('tr[data-guide-date]');
      let csv = '\\uFEFFdate,title,content\\r\\n';
      for (const row of rows) {
        const d = row.dataset.guideDate;
        const t = (row.querySelector('.entry-title').value || '').replace(/"/g, '""');
        const c = (row.querySelector('.entry-content').value || '').replace(/"/g, '""');
        csv += d + ',"' + t + '","' + c + '"\\r\\n';
      }
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'guidance-' + currentCampaign.startDate + '-' + currentCampaign.endDate + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    // CSV Batch Import
    document.getElementById('input-import-csv').onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const text = evt.target.result;
          const lines = text.split(/\\r?\\n/).filter(line => line.trim().length > 0);
          if (lines.length < 2) return;

          const entriesMap = new Map();
          for (let i = 1; i < lines.length; i++) {
            // Simple CSV line parser
            const match = lines[i].match(/^"?([^",]+)"?,(?:^"?|"?)([^",]*)(?:"?,|",?)(?:^"?|"?)(.*)$/);
            if (match) {
              const d = match[1].trim();
              const t = match[2].trim().replace(/^"|"$/g, '').replace(/""/g, '"');
              const c = match[3].trim().replace(/^"|"$/g, '').replace(/""/g, '"');
              entriesMap.set(d, { title: t, content: c });
            }
          }

          // Apply to existing table inputs
          const rows = entriesTbody.querySelectorAll('tr[data-guide-date]');
          let matched = 0;
          for (const row of rows) {
            const d = row.dataset.guideDate;
            if (entriesMap.has(d)) {
              const item = entriesMap.get(d);
              row.querySelector('.entry-title').value = item.title;
              row.querySelector('.entry-content').value = item.content;
              matched++;
            }
          }
          statusBar.textContent = 'CSV 解析完成，已填入 ' + matched + ' 天的指引內容，請確認後點選「儲存」。';
        } catch {
          alert('CSV 格式解析失敗，請確認檔案格式是否與範本相符。');
        } finally {
          e.target.value = '';
        }
      };
      reader.readAsText(file, 'utf-8');
    };

    loadCampaigns();
  })();
  </script>
  `;

  return renderAdminShell('guidance', body, '', locale, canManageAdmins);
};
