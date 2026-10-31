/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved. */
import { renderAdminShell } from './admin-dashboard.js';
import { adminLocaleScript, adminTexts, type AdminLocale } from './admin-locale.js';

export const renderVenueLearnerPage = (
  locale: AdminLocale = 'zh_TW',
  canManageAdmins = false
): string => {
  const text = adminTexts(locale);

  const body = `
  <section class="card" aria-labelledby="learner-rep-heading">
    <h1 id="learner-rep-heading">學員團練出席歷程</h1>
    <p class="muted">從學員個人角度出發，搜尋特定學員姓名並以電話／Email 區隔同名學員。點入後可查閱學員歷年團練出席總次數（分年度）及詳細打卡歷史流水紀錄。</p>

    <div class="filter-bar" style="display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-end;margin-bottom:1.5rem;">
      <label style="display:flex;flex-direction:column;gap:.3rem;min-width:180px;">
        <strong>所屬大地區</strong>
        <select id="learner-region-select" style="min-height:40px;padding:.4rem;">
          <option value="">載入中…</option>
        </select>
      </label>

      <label style="display:flex;flex-direction:column;gap:.3rem;flex:1;min-width:240px;">
        <strong>搜尋學員姓名</strong>
        <input type="search" id="learner-search-input" placeholder="輸入學員姓名關鍵字…" style="min-height:40px;padding:.4rem;">
      </label>

      <button type="button" id="btn-search-learners" class="button" style="min-height:40px;padding:0 1.2rem;background:var(--brand-primary);color:white;">搜尋學員</button>
      <button type="button" id="btn-back-to-list" class="button" style="min-height:40px;padding:0 1.2rem;display:none;">回搜尋清單</button>
    </div>

    <p id="learner-status-bar" role="status" aria-live="polite" style="padding:.6rem;background:var(--surface-muted);border-radius:.4rem;">請先選擇地區並輸入姓名關鍵字進行搜尋。</p>

    <!-- 1. Search Results Container -->
    <div id="search-results-section" style="margin-top:1.5rem;">
      <div class="table-scroll" style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;background:white;">
          <thead>
            <tr style="border-bottom:2px solid var(--border);text-align:left;">
              <th style="padding:.75rem;">學員姓名</th>
              <th style="padding:.75rem;">聯絡電話（同名辨識）</th>
              <th style="padding:.75rem;">電子郵件</th>
              <th style="padding:.75rem;text-align:right;">累積團練次數</th>
              <th style="padding:.75rem;text-align:right;">去重出席日</th>
              <th style="padding:.75rem;">最近出席日期／場地</th>
              <th style="padding:.75rem;text-align:center;">操作</th>
            </tr>
          </thead>
          <tbody id="learners-tbody">
            <tr><td colspan="7" style="padding:1.5rem;text-align:center;color:var(--muted);">尚未執行搜尋</td></tr>
          </tbody>
        </table>
      </div>
      <div id="search-pagination" style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;"></div>
    </div>

    <!-- 2. Learner Detail & History Container -->
    <div id="learner-detail-section" style="display:none;margin-top:1.5rem;">
      <div class="card" style="background:#fcfdfc;border:1px solid #c8d8cf;border-radius:.6rem;padding:1.2rem;margin-bottom:1.5rem;">
        <h2 id="detail-learner-name" style="margin-top:0;">學員姓名</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.8rem;font-size:.95rem;">
          <div><strong>電話：</strong><span id="detail-learner-phone">—</span></div>
          <div><strong>Email：</strong><span id="detail-learner-email">—</span></div>
          <div><strong>LINE ID：</strong><span id="detail-learner-line">—</span></div>
          <div><strong>Telegram ID：</strong><span id="detail-learner-tg">—</span></div>
          <div><strong>WhatsApp ID：</strong><span id="detail-learner-wa">—</span></div>
        </div>
      </div>

      <h3>歷年團練出席總次數（分年度統計）</h3>
      <div id="annual-summary-cards" style="display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem;"></div>

      <h3>詳細打卡歷史紀錄</h3>
      <div class="table-scroll" style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;background:white;">
          <thead>
            <tr style="border-bottom:2px solid var(--border);text-align:left;">
              <th style="padding:.75rem;">打卡日期</th>
              <th style="padding:.75rem;">打卡時間 (UTC)</th>
              <th style="padding:.75rem;">團練場地</th>
              <th style="padding:.75rem;">時區</th>
              <th style="padding:.75rem;">簽到方式</th>
            </tr>
          </thead>
          <tbody id="history-tbody"></tbody>
        </table>
      </div>
      <div id="history-pagination" style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;"></div>
    </div>
  </section>
  `;

  const script = `
    ${adminLocaleScript(locale)}
    const regionSelect = document.getElementById('learner-region-select');
    const searchInput = document.getElementById('learner-search-input');
    const btnSearch = document.getElementById('btn-search-learners');
    const btnBack = document.getElementById('btn-back-to-list');
    const statusBar = document.getElementById('learner-status-bar');

    const searchSection = document.getElementById('search-results-section');
    const learnersTbody = document.getElementById('learners-tbody');
    const searchPagination = document.getElementById('search-pagination');

    const detailSection = document.getElementById('learner-detail-section');
    const detailName = document.getElementById('detail-learner-name');
    const detailPhone = document.getElementById('detail-learner-phone');
    const detailEmail = document.getElementById('detail-learner-email');
    const detailLine = document.getElementById('detail-learner-line');
    const detailTg = document.getElementById('detail-learner-tg');
    const detailWa = document.getElementById('detail-learner-wa');
    const annualCards = document.getElementById('annual-summary-cards');
    const historyTbody = document.getElementById('history-tbody');
    const historyPagination = document.getElementById('history-pagination');

    const csrf = () => document.cookie.split('; ').find(part => part.startsWith('__Host-qigong-admin-csrf='))?.split('=')[1] || '';

    let currentPersonId = null;
    let searchPage = 1;
    let historyPage = 1;

    btnSearch.addEventListener('click', () => {
      searchPage = 1;
      searchLearners();
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        searchPage = 1;
        searchLearners();
      }
    });

    btnBack.addEventListener('click', () => {
      currentPersonId = null;
      detailSection.style.display = 'none';
      btnBack.style.display = 'none';
      searchSection.style.display = 'block';
      statusBar.textContent = '已返回學員搜尋列表。';
    });

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

        if (regionSelect.value) {
          searchLearners();
        }
      } catch (err) {
        statusBar.textContent = '載入地區清單失敗。';
      }
    }

    async function searchLearners() {
      const regionId = regionSelect.value;
      const search = searchInput.value.trim();

      if (!regionId) {
        statusBar.textContent = '請先選擇地區。';
        return;
      }

      statusBar.textContent = '搜尋學員出席紀錄中…';
      try {
        const res = await fetch('/admin/api/venue-reporting/learner-search', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() },
          body: JSON.stringify({ regionId, search, page: searchPage, limit: 20 })
        });

        if (res.status === 401) { location.assign('/admin/auth/login'); return; }
        if (res.status === 403) { statusBar.textContent = '權限不足：您未獲授權查閱此地區學員資料。'; return; }
        if (!res.ok) throw new Error('search_failed');

        const data = await res.json();
        learnersTbody.replaceChildren();

        if (!data.rows || !data.rows.length) {
          learnersTbody.innerHTML = '<tr><td colspan="7" style="padding:1.5rem;text-align:center;color:var(--muted);">查無符合關鍵字的學員出席紀錄</td></tr>';
          statusBar.textContent = '搜尋完成：無相符結果。';
          searchPagination.replaceChildren();
          return;
        }

        for (const row of data.rows) {
          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid var(--border)';

          const tdName = document.createElement('td');
          tdName.style.padding = '.75rem';
          tdName.style.fontWeight = 'bold';
          tdName.textContent = row.learnerName;

          const tdPhone = document.createElement('td');
          tdPhone.style.padding = '.75rem';
          tdPhone.style.color = row.phone ? 'inherit' : 'var(--muted)';
          tdPhone.textContent = row.phone || '—';

          const tdEmail = document.createElement('td');
          tdEmail.style.padding = '.75rem';
          tdEmail.style.color = row.email ? 'inherit' : 'var(--muted)';
          tdEmail.textContent = row.email || '—';

          const tdCount = document.createElement('td');
          tdCount.style.padding = '.75rem';
          tdCount.style.textAlign = 'right';
          tdCount.textContent = row.attendanceCount;

          const tdDays = document.createElement('td');
          tdDays.style.padding = '.75rem';
          tdDays.style.textAlign = 'right';
          tdDays.textContent = row.attendanceDays;

          const tdLatest = document.createElement('td');
          tdLatest.style.padding = '.75rem';
          tdLatest.textContent = (row.latestDate || '') + (row.latestFieldName ? ' (' + row.latestFieldName + ')' : '');

          const tdAction = document.createElement('td');
          tdAction.style.padding = '.75rem';
          tdAction.style.textAlign = 'center';

          const viewBtn = document.createElement('button');
          viewBtn.type = 'button';
          viewBtn.className = 'button';
          viewBtn.style.padding = '0 .8rem';
          viewBtn.style.minHeight = '32px';
          viewBtn.textContent = '查看歷程';
          viewBtn.addEventListener('click', () => {
            currentPersonId = row.personId;
            historyPage = 1;
            loadLearnerDetail(row.personId);
          });
          tdAction.append(viewBtn);

          tr.append(tdName, tdPhone, tdEmail, tdCount, tdDays, tdLatest, tdAction);
          learnersTbody.append(tr);
        }

        statusBar.textContent = '搜尋完成：找到 ' + data.total + ' 位符合學員。';
      } catch (err) {
        statusBar.textContent = '搜尋學員失敗，請重試。';
      }
    }

    async function loadLearnerDetail(personId) {
      const regionId = regionSelect.value;
      statusBar.textContent = '載入學員歷年出席總結與歷史流水紀錄中…';

      try {
        const res = await fetch('/admin/api/venue-reporting/learner-history', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() },
          body: JSON.stringify({ regionId, personId, page: historyPage, limit: 50 })
        });

        if (res.status === 401) { location.assign('/admin/auth/login'); return; }
        if (!res.ok) throw new Error('detail_failed');

        const data = await res.json();
        searchSection.style.display = 'none';
        btnBack.style.display = 'inline-block';
        detailSection.style.display = 'block';

        const l = data.learner;
        detailName.textContent = l.learnerName;
        detailPhone.textContent = l.phone || '未登記';
        detailEmail.textContent = l.email || '未登記';
        detailLine.textContent = l.lineId || '—';
        detailTg.textContent = l.telegramId || '—';
        detailWa.textContent = l.whatsappId || '—';

        // Render annual cards
        annualCards.replaceChildren();
        if (data.annualSummary && data.annualSummary.length) {
          for (const yr of data.annualSummary) {
            const card = document.createElement('div');
            card.style.cssText = 'background:white;border:1px solid var(--border);border-radius:.5rem;padding:1rem;min-width:140px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.05);';
            card.innerHTML = '<div style="font-size:1.1rem;font-weight:bold;color:var(--brand-primary);">' + yr.year + ' 年</div>' +
                             '<div style="font-size:1.6rem;font-weight:bold;margin:.4rem 0;">' + yr.attendanceCount + ' 次</div>' +
                             '<div style="font-size:.85rem;color:var(--muted);">' + yr.attendanceDays + ' 個出席日</div>';
            annualCards.append(card);
          }
        } else {
          annualCards.innerHTML = '<p class="muted">尚無年度數據</p>';
        }

        // Render history table
        historyTbody.replaceChildren();
        if (data.history && data.history.length) {
          for (const h of data.history) {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border)';

            const tdDate = document.createElement('td');
            tdDate.style.padding = '.75rem';
            tdDate.textContent = h.attendanceDate;

            const tdTime = document.createElement('td');
            tdTime.style.padding = '.75rem';
            tdTime.textContent = h.checkinAt;

            const tdField = document.createElement('td');
            tdField.style.padding = '.75rem';
            tdField.textContent = (h.fieldName || '') + ' (' + (h.fieldCode || '') + ')';

            const tdTz = document.createElement('td');
            tdTz.style.padding = '.75rem';
            tdTz.textContent = h.timezone;

            const tdMethod = document.createElement('td');
            tdMethod.style.padding = '.75rem';
            tdMethod.textContent = h.checkinMethod;

            tr.append(tdDate, tdTime, tdField, tdTz, tdMethod);
            historyTbody.append(tr);
          }
        } else {
          historyTbody.innerHTML = '<tr><td colspan="5" style="padding:1.5rem;text-align:center;color:var(--muted);">查無出席紀錄</td></tr>';
        }

        statusBar.textContent = '學員歷程載入完成：共 ' + data.total + ' 筆打卡紀錄。';
      } catch (err) {
        statusBar.textContent = '載入學員歷程失敗。';
      }
    }

    regionSelect.addEventListener('change', () => {
      if (detailSection.style.display !== 'none') {
        loadLearnerDetail(currentPersonId);
      } else {
        searchLearners();
      }
    });

    loadRegions();
  `;

  return renderAdminShell('venueLearnerAttendance', body, script, locale, canManageAdmins);
};
