/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved. */
import { renderAdminShell } from './admin-dashboard.js';
import { adminLocaleScript, type AdminLocale } from './admin-locale.js';

export const renderVenueWeekendPage = (
  locale: AdminLocale = 'zh_TW',
  canManageAdmins = false
): string => {
  const body = `
  <section class="card" aria-labelledby="weekend-heading">
    <h1 id="weekend-heading">週末團練出席報表</h1>
    <p class="muted">查看各場地團練出席規模，支援依大地區與週週期（本週／上週／自選區間）快速檢視今日與週期出席總量，並可一鍵下載含通訊身分與聯絡方式之 CSV 名冊。</p>

    <div class="filter-bar" style="display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-end;margin-bottom:1.5rem;">
      <label style="display:flex;flex-direction:column;gap:.3rem;min-width:180px;">
        <strong>所屬大地區</strong>
        <select id="region-select" style="min-height:40px;padding:.4rem;">
          <option value="">載入中…</option>
        </select>
      </label>

      <div style="display:flex;gap:.5rem;align-items:center;">
        <button type="button" id="btn-today" class="button" style="min-height:40px;padding:0 .8rem;">今日</button>
        <button type="button" id="btn-this-week" class="button" style="min-height:40px;padding:0 .8rem;">本週週末</button>
        <button type="button" id="btn-last-week" class="button" style="min-height:40px;padding:0 .8rem;">上週週末</button>
      </div>

      <label style="display:flex;flex-direction:column;gap:.3rem;">
        <span>起日（含）</span>
        <input type="date" id="date-from" style="min-height:40px;padding:.4rem;">
      </label>

      <label style="display:flex;flex-direction:column;gap:.3rem;">
        <span>迄日（不含）</span>
        <input type="date" id="date-until" style="min-height:40px;padding:.4rem;">
      </label>

      <button type="button" id="btn-query" class="button" style="min-height:40px;padding:0 1.2rem;background:var(--brand-primary);color:white;">查詢</button>
      <button type="button" id="btn-export" class="button" style="min-height:40px;padding:0 1.2rem;background:#176b53;color:white;" disabled>匯出全區 CSV</button>
    </div>

    <p id="status-bar" role="status" aria-live="polite" style="padding:.6rem;background:var(--surface-muted);border-radius:.4rem;">請先選擇地區以載入團練場出席數據。</p>

    <div class="table-scroll" style="margin-top:1.5rem;overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;background:white;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);text-align:left;">
            <th style="padding:.75rem;">場地代碼</th>
            <th style="padding:.75rem;">場地名稱</th>
            <th style="padding:.75rem;">時區</th>
            <th style="padding:.75rem;">狀態</th>
            <th style="padding:.75rem;text-align:right;">所選區間人次</th>
            <th style="padding:.75rem;text-align:right;">去重學員數</th>
            <th style="padding:.75rem;text-align:center;">操作</th>
          </tr>
        </thead>
        <tbody id="venues-tbody">
          <tr><td colspan="7" style="padding:1.5rem;text-align:center;color:var(--muted);">尚未載入場地資料</td></tr>
        </tbody>
      </table>
    </div>
  </section>
  `;

  const script = `
    ${adminLocaleScript(locale)}
    const regionSelect = document.getElementById('region-select');
    const btnToday = document.getElementById('btn-today');
    const btnThisWeek = document.getElementById('btn-this-week');
    const btnLastWeek = document.getElementById('btn-last-week');
    const dateFromInput = document.getElementById('date-from');
    const dateUntilInput = document.getElementById('date-until');
    const btnQuery = document.getElementById('btn-query');
    const btnExport = document.getElementById('btn-export');
    const statusBar = document.getElementById('status-bar');
    const tbody = document.getElementById('venues-tbody');

    const csrf = () => document.cookie.split('; ').find(part => part.startsWith('__Host-qigong-admin-csrf='))?.split('=')[1] || '';

    function formatLocalDate(d) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return year + '-' + month + '-' + day;
    }

    function setToday() {
      const now = new Date();
      dateFromInput.value = formatLocalDate(now);
      const tomorrow = new Date(now.getTime() + 86400000);
      dateUntilInput.value = formatLocalDate(tomorrow);
    }

    function setWeekend(weeksAgo) {
      const now = new Date();
      const day = now.getDay(); // 0 is Sunday, 6 is Saturday
      // Target Saturday
      const diffSat = (day === 0 ? -1 : 6 - day) - (weeksAgo * 7);
      const sat = new Date(now.getTime() + diffSat * 86400000);
      const mon = new Date(sat.getTime() + 2 * 86400000); // Mon 00:00 is exclusive end of weekend
      dateFromInput.value = formatLocalDate(sat);
      dateUntilInput.value = formatLocalDate(mon);
    }

    setToday();

    btnToday.addEventListener('click', () => { setToday(); loadSummary(); });
    btnThisWeek.addEventListener('click', () => { setWeekend(0); loadSummary(); });
    btnLastWeek.addEventListener('click', () => { setWeekend(1); loadSummary(); });
    btnQuery.addEventListener('click', () => { loadSummary(); });

    btnExport.addEventListener('click', () => { exportCsv(null); });

    async function loadRegions() {
      try {
        const res = await fetch('/admin/api/venue-suite/regions', { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) throw new Error('regions_failed');
        const data = await res.json();
        regionSelect.replaceChildren();
        if (!data.regions || !data.regions.length) {
          regionSelect.innerHTML = '<option value="">無授權地區</option>';
          statusBar.textContent = '查無您被授權存取的團練場地區。';
          return;
        }

        // Region list sorting: Taiwan first, then HK, MY, SG, others
        const order = ['tw-general', 'hk-general', 'my-general', 'sg-general'];
        const sorted = [...data.regions].sort((a, b) => {
          const ai = order.indexOf(a.code);
          const bi = order.indexOf(b.code);
          if (ai !== -1 && bi !== -1) return ai - bi;
          if (ai !== -1) return -1;
          if (bi !== -1) return 1;
          return a.displayName.localeCompare(b.displayName);
        });

        for (const reg of sorted) {
          const opt = document.createElement('option');
          opt.value = reg.id;
          opt.textContent = reg.displayName || reg.countryName || reg.code;
          regionSelect.append(opt);
        }

        // Auto select first and load
        if (regionSelect.value) {
          loadSummary();
        }
      } catch (err) {
        statusBar.textContent = '載入地區清單失敗，請重新登入或稍後再試。';
      }
    }

    async function loadSummary() {
      const regionId = regionSelect.value;
      const dateFrom = dateFromInput.value;
      const dateUntil = dateUntilInput.value;

      if (!regionId || !dateFrom || !dateUntil) {
        statusBar.textContent = '請完整選擇地區、起日與迄日。';
        return;
      }

      statusBar.textContent = '載入團練場出席統計中…';
      btnExport.disabled = true;

      try {
        const res = await fetch('/admin/api/venue-reporting/weekend-summary', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() },
          body: JSON.stringify({ regionId, dateFrom, dateUntil })
        });

        if (res.status === 401) { location.assign('/admin/auth/login'); return; }
        if (res.status === 403) { statusBar.textContent = '權限不足：您未獲授權查閱此地區出席數據。'; return; }
        if (!res.ok) throw new Error('summary_failed');

        const data = await res.json();
        tbody.replaceChildren();

        if (!data.fields || !data.fields.length) {
          tbody.innerHTML = '<tr><td colspan="7" style="padding:1.5rem;text-align:center;color:var(--muted);">此地區尚無登記的團練場</td></tr>';
          statusBar.textContent = '查詢完成：此地區無場地資料。';
          return;
        }

        let totalAttendance = 0;
        let totalLearners = 0;

        for (const f of data.fields) {
          totalAttendance += f.attendanceCount;
          totalLearners += f.learnerCount;

          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid var(--border)';

          const tdCode = document.createElement('td');
          tdCode.style.padding = '.75rem';
          tdCode.innerHTML = '<code>' + (f.fieldCode || '') + '</code>';

          const tdName = document.createElement('td');
          tdName.style.padding = '.75rem';
          tdName.textContent = f.fieldName || '';

          const tdTz = document.createElement('td');
          tdTz.style.padding = '.75rem';
          tdTz.textContent = f.timezone || '';

          const tdStatus = document.createElement('td');
          tdStatus.style.padding = '.75rem';
          tdStatus.innerHTML = f.isActive ? '<span style="color:#176b53;">啟用中</span>' : '<span style="color:#888;">停用</span>';

          const tdCount = document.createElement('td');
          tdCount.style.padding = '.75rem';
          tdCount.style.textAlign = 'right';
          tdCount.style.fontWeight = 'bold';
          tdCount.textContent = f.attendanceCount;

          const tdLearner = document.createElement('td');
          tdLearner.style.padding = '.75rem';
          tdLearner.style.textAlign = 'right';
          tdLearner.textContent = f.learnerCount;

          const tdAction = document.createElement('td');
          tdAction.style.padding = '.75rem';
          tdAction.style.textAlign = 'center';

          const exportBtn = document.createElement('button');
          exportBtn.type = 'button';
          exportBtn.className = 'button';
          exportBtn.style.padding = '0 .6rem';
          exportBtn.style.minHeight = '32px';
          exportBtn.style.fontSize = '.85rem';
          exportBtn.textContent = '匯出名冊';
          exportBtn.addEventListener('click', () => { exportCsv(f.fieldId); });
          tdAction.append(exportBtn);

          tr.append(tdCode, tdName, tdTz, tdStatus, tdCount, tdLearner, tdAction);
          tbody.append(tr);
        }

        statusBar.textContent = '區間合計：' + data.fields.length + ' 個場地，出席共 ' + totalAttendance + ' 人次（去重 ' + totalLearners + ' 位學員）。';
        btnExport.disabled = totalAttendance === 0;
      } catch (err) {
        statusBar.textContent = '查詢出席統計失敗，請確認網路與登入狀態。';
      }
    }

    async function exportCsv(fieldId) {
      const regionId = regionSelect.value;
      const dateFrom = dateFromInput.value;
      const dateUntil = dateUntilInput.value;

      if (!regionId || !dateFrom || !dateUntil) return;
      statusBar.textContent = '產生 CSV 匯出檔中…';

      try {
        const res = await fetch('/admin/api/venue-reporting/weekend-export', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() },
          body: JSON.stringify({ regionId, dateFrom, dateUntil, fieldId })
        });

        if (res.status === 401) { location.assign('/admin/auth/login'); return; }
        if (res.status === 403) { statusBar.textContent = '匯出遭拒：您未獲授權匯出此地區個資（需 stats.export 權限）。'; return; }
        if (res.status === 413) { statusBar.textContent = '匯出筆數超過 5,000 筆上限，請縮小日期範圍後重試。'; return; }
        if (!res.ok) throw new Error('export_failed');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'venue-attendance-' + dateFrom + '-' + dateUntil + '.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        statusBar.textContent = 'CSV 檔案已成功下載。';
      } catch (err) {
        statusBar.textContent = '匯出失敗，請確認權限或稍後重試。';
      }
    }

    regionSelect.addEventListener('change', () => { loadSummary(); });
    loadRegions();
  `;

  return renderAdminShell('venueWeekendAttendance', body, script, locale, canManageAdmins);
};
