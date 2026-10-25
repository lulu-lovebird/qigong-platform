/**
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */
import { adminBrandStyles } from './admin-branding.js';
import type { AdminLocale } from './admin-locale.js';
import {
  attendanceQueryString,
  formatAttendanceDate,
  formatCheckinMethod,
  venueAttendanceTitle,
  type AttendanceExportQuery,
  type AttendanceExportRecord,
  type AttendanceRange,
  type AttendanceSummary,
  type AttendanceMonthSummary
} from './venue-attendance-report.js';

export type VenueAttendancePageState =
  | { readonly status: 'unavailable' | 'invalid' | 'denied' }
  | {
      readonly status: 'ready';
      readonly rows: readonly AttendanceExportRecord[];
      readonly total: number;
      readonly summary: AttendanceSummary;
      readonly months: readonly AttendanceMonthSummary[];
      readonly canExport: boolean;
    };

const escape = (value: string | number): string =>
  String(value).replace(/[&<>"']/g, (char) => {
    const entities: Readonly<Record<string, string>> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entities[char] ?? '';
  });

// CSP has form-action 'none': handle navigation locally, never loosen CSP for GET filters.
// No user data is interpolated into this script; no write/CSRF bypass endpoints are added.
export const venueAttendancePageScript = `
(() => {
  const form = document.getElementById('attendance-filters');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
    }
    if (params.has('startDate') || params.has('endDate')) params.delete('month');
    params.set('page', '1');
    location.assign('/admin/attendance?' + params.toString());
  });
})();`;

export const renderVenueAttendanceReportPage = (
  query: AttendanceExportQuery,
  range: AttendanceRange,
  state: VenueAttendancePageState,
  locale: AdminLocale = 'zh_TW'
): string => {
  const ready = state.status === 'ready';
  const start = query.startDate ?? query.start_date ?? '';
  const end = query.endDate ?? query.end_date ?? '';
  const month = query.month ?? (start || end ? '' : range.startDate.slice(0, 7));
  const input = (label: string, name: string, type: string, value: string) =>
    `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}"${type === 'text' ? ' maxlength="36" autocomplete="off"' : ''}></label>`;
  const link = (label: string, page: number) =>
    `<a href="/admin/attendance?${escape(attendanceQueryString(query, page))}">${label}</a>`;
  const totalPages = ready ? Math.max(1, Math.ceil(state.total / query.limit)) : 0;
  const status =
    state.status === 'unavailable'
      ? '受控出席查詢／匯出待接線（503）。尚未讀取資料；NFC 安全隔離維持中。'
      : state.status === 'invalid'
        ? '篩選條件無效（400），請檢查真實日期、起訖順序、月份及場地 ID。'
        : state.status === 'denied'
          ? '沒有此操作或地區的存取權限（403）。'
          : '已載入授權範圍內的資料。';
  const rows = ready
    ? state.rows
        .map(
          (record) => `<tr>
<td data-label="時間">${escape(formatAttendanceDate(record.checkin_at))}</td>
<td data-label="學員">${escape(record.student_name)}</td>
<td data-label="場地">${escape(record.field_name)}<small>${escape(record.field_code)}</small></td>
<td data-label="方式">${escape(formatCheckinMethod(record.checkin_method, locale))}</td>
<td data-label="紀錄距離">${record.distance_meters === undefined || record.distance_meters === null ? '—' : `${escape(record.distance_meters)} 公尺`}</td>
<td data-label="核實志工">${escape(record.volunteer_name?.trim() ? record.volunteer_name : '—')}</td></tr>`
        )
        .join('')
    : '';
  const summary = (label: string, value: number | undefined) =>
    `<div class="metric"><dt>${label}</dt><dd>${value === undefined ? '—' : escape(value)}</dd></div>`;
  const exportQuery = new URLSearchParams(attendanceQueryString(query));
  exportQuery.delete('page');
  exportQuery.delete('limit');
  const exportControl =
    ready && state.canExport
      ? `<a class="button" download href="/admin/attendance/export.csv?${escape(exportQuery.toString())}">下載 CSV</a>`
      : '<button type="button" disabled>下載 CSV（未授權或待接線）</button>';
  return `<!doctype html><html lang="${locale === 'en' ? 'en' : locale === 'zh_CN' ? 'zh-CN' : 'zh-TW'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${venueAttendanceTitle}｜白雁氣功管理平台</title><style>${adminBrandStyles}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--brand-primary);font:16px/1.6 system-ui,sans-serif}main,header,footer{max-width:1100px;margin:auto;padding:1rem}h1{font-size:1.65rem}h2{font-size:1.25rem}a{color:var(--brand-secondary)}.card{background:var(--surface);border:1px solid var(--border);border-radius:.7rem;padding:1rem;margin-bottom:1rem}form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem}label{display:flex;flex-direction:column;gap:.3rem}input,select,button,.button{font:inherit;min-height:44px;max-width:100%;padding:.5rem;border:1px solid var(--border);border-radius:.4rem}button,.button{background:var(--brand-primary);color:white;cursor:pointer}button:disabled{opacity:.6;cursor:not-allowed}.button{display:inline-block;text-decoration:none}.metrics{display:flex;flex-wrap:wrap;gap:1rem}.metric{flex:1;min-width:150px;background:var(--surface-muted);padding:1rem;border-radius:.5rem}dd{margin:0;font-size:1.6rem;font-weight:bold}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:.65rem;border-bottom:1px solid var(--border);overflow-wrap:anywhere}small{display:block}.pagination{display:flex;align-items:center;flex-wrap:wrap;gap:1rem;margin-top:1rem}.pagination a{padding:.5rem}.muted,footer{color:var(--muted)}#attendance-status{padding:.75rem;background:var(--surface-muted)}.skip{position:absolute;left:-10000px}.skip:focus{position:static}
@media(max-width:600px){main,header,footer{padding:.65rem}.attendance-list thead{display:none}.attendance-list tr{display:block;margin-bottom:1rem;border:1px solid var(--border)}.attendance-list td{display:grid;grid-template-columns:6rem minmax(0,1fr);gap:.5rem}.attendance-list td::before{content:attr(data-label);font-weight:bold}.attendance-list small{grid-column:2}.metrics{gap:.5rem}}
</style></head><body><a class="skip" href="#main">跳至內容</a><header><nav aria-label="管理導覽"><a href="/admin?lang=${escape(locale)}">返回管理首頁</a></nav><h1>${venueAttendanceTitle}</h1></header><main id="main">
<section class="card" aria-labelledby="filters-heading"><h2 id="filters-heading">出席查詢</h2>
<p>時間以 Asia/Taipei（UTC+08:00）計算。可選月份或日期範圍；填入日期時以日期為準。</p>
<form id="attendance-filters"><input type="hidden" name="lang" value="${escape(locale)}">
${input('月份', 'month', 'month', month)}${input('起日（含）', 'startDate', 'date', start)}${input('迄日（含）', 'endDate', 'date', end)}
${input('地區 ID（選填）', 'regionId', 'text', query.regionId ?? '')}
${input('場地 ID（選填；清單待接線）', 'fieldId', 'text', query.fieldId ?? query.field_id ?? '')}
<label>簽到方式<select name="method"><option value="">全部方式</option><option value="nfc_gps"${query.method === 'nfc_gps' ? ' selected' : ''}>NFC_GPS</option><option value="volunteer_manual"${query.method === 'volunteer_manual' ? ' selected' : ''}>志工補簽</option></select></label>
<label>每頁筆數<select name="limit">${[...new Set([20, 50, 100, query.limit])]
    .sort((a, b) => a - b)
    .map(
      (limit) =>
        `<option value="${limit}"${query.limit === limit ? ' selected' : ''}>${limit}</option>`
    )
    .join('')}</select></label><button type="submit">查詢</button></form>
<noscript>此頁篩選需要 JavaScript；不會放寬既有安全政策以提交表單。</noscript>
<p id="attendance-status" role="status" aria-live="polite">${status}</p>
<p class="muted">查詢區間：${escape(range.startDate)} 至 ${escape(range.endDate)}（含迄日；資料查詢採次日零時之前的半開區間）。</p></section>
<section class="card" aria-labelledby="summary-heading"><h2 id="summary-heading">月份統計／所選區間統計</h2>
<dl class="metrics">${summary('團練次數（學員人次）', ready ? state.summary.practiceCount : undefined)}${summary('不重複出席日數', ready ? state.summary.attendanceDays : undefined)}${summary('不重複學員數', ready ? state.summary.learnerCount : undefined)}</dl>
<p class="muted">每位學員同場同日計一次；同日跨場計兩次，但出席日數按日期去重。統計涵蓋完整授權篩選結果，不是單頁筆數。未連動日課。</p>
${ready ? `<div class="table-scroll"><table><caption>依月份彙總</caption><thead><tr><th scope="col">月份</th><th scope="col">團練次數</th><th scope="col">出席日數</th><th scope="col">學員數</th></tr></thead><tbody>${state.months.map((row) => `<tr><th scope="row">${escape(row.month)}</th><td>${escape(row.practiceCount)}</td><td>${escape(row.attendanceDays)}</td><td>${escape(row.learnerCount)}</td></tr>`).join('')}</tbody></table></div>` : '<p>月份統計待接線，尚無可顯示數據。</p>'}</section>
<section class="card" aria-labelledby="list-heading"><h2 id="list-heading">出席紀錄</h2>${exportControl}
<p class="muted">CSV 僅下載完整授權篩選範圍，與列表分頁無關。僅顯示紀錄距離，不推定定位或身份驗證成功。</p>
${ready && state.rows.length ? `<div class="table-scroll"><table class="attendance-list"><caption>團練場出席管理紀錄</caption><thead><tr>${['時間', '學員', '場地', '方式', '紀錄距離', '核實志工'].map((name) => `<th scope="col">${name}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>` : `<p>${ready ? '查無符合條件的授權出席紀錄。' : '尚未查詢，不代表沒有出席紀錄。'}</p>`}
<nav class="pagination" aria-label="出席紀錄分頁">${ready ? `${query.page > 1 ? link('上一頁', query.page - 1) : ''}<span>第 ${query.page} 頁／共 ${totalPages} 頁，${state.total} 筆</span>${query.page < totalPages ? link('下一頁', query.page + 1) : ''}` : '<span>分頁待接線</span>'}</nav></section>
<section class="card"><h2>後續功能</h2><p>人工補簽／作廢需另外審核操作權限、地區範圍、原因及稽核紀錄；目前未提供寫入操作。</p></section>
</main><footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer><script>${venueAttendancePageScript}</script></body></html>`;
};
