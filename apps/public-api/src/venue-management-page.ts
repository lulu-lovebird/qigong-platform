/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { renderAdminShell } from './admin-dashboard.js';
import type { AdminLocale } from './admin-locale.js';
import type { VenueManagementRow, VenueManagementField } from './venue-management.js';
type LinkedVenue = VenueManagementRow & { urls: Record<'nfc' | 'qr' | 'link', string> };

// Compiled before serialization. Never insert API text with innerHTML.
function venueManagementController() {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const value = (id: string) => get<HTMLInputElement>(id).value;
  const set = (id: string, value: string | number) => {
    get<HTMLInputElement>(id).value = String(value);
  };
  const status = get('vm-status');
  const editor = get<HTMLFieldSetElement>('vm-editor');
  const list = get('vm-list');
  const links = get('vm-links');
  let selected: LinkedVenue | null = null;
  let canManage = false;
  let busy = false;
  let rows: LinkedVenue[] = [];
  let loaded = false;
  let loadedRegion = '';
  let requiresReload = false;
  function editorState() {
    editor.disabled = busy || requiresReload || (!selected && !canManage);
    for (const key of [
      'code',
      'name_zh_tw',
      'name_en',
      'address',
      'latitude',
      'longitude',
      'radius_meters',
      'timezone',
      'region_id',
      'start',
      'end',
      'reason'
    ])
      get<HTMLInputElement>('vm-' + key).readOnly = !canManage || (key === 'code' && !!selected);
    for (const key of ['active', ...Array.from({ length: 7 }, (_, day) => 'day-' + day)])
      get<HTMLInputElement>('vm-' + key).disabled = !canManage;
    get<HTMLButtonElement>('vm-save').disabled = !canManage || busy || requiresReload;
  }
  const say = (message: string) => {
    status.textContent = message;
  };
  const node = (tag: string, text: string) => {
    const n = document.createElement(tag);
    n.textContent = text;
    return n;
  };
  const failure = (status: number) =>
    ({
      400: '欄位或時區不合法，尚未儲存。',
      401: '登入失效，請重新登入。尚未儲存。',
      403: '區域、管理權限或 CSRF 驗證失敗。尚未儲存。',
      404: '場地／後端尚未提供。尚未儲存。',
      409: '代碼已保留、版本衝突，或已有出席而不能改區域／時區。請重新載入確認；尚未儲存。',
      503: '場地後端尚未設定或暫時無法使用。尚未儲存。'
    })[status] ?? '服務錯誤。未確認儲存，請重新載入查核。';
  async function api(action: string, data: object): Promise<unknown> {
    const cookies = document.cookie
      .split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith('__Host-qigong-admin-csrf='));
    if (cookies.length !== 1) throw new Error('CSRF 憑證遺失或重複，請重新登入。');
    const response = await fetch('/admin/api/venue-management/' + action, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': cookies[0]!.slice('__Host-qigong-admin-csrf='.length)
      },
      body: JSON.stringify(data)
    }).catch(() => {
      if (action === 'create' || action === 'update') requiresReload = true;
      throw new Error('連線中斷，結果未確認；請重新載入查核後再操作。');
    });
    if (!response.ok) {
      if (action === 'update' && response.status === 409) requiresReload = true;
      if ([401, 403, 404, 503].includes(response.status)) {
        canManage = false;
        editor.disabled = true;
        get<HTMLButtonElement>('vm-add').disabled = true;
      }
      throw new Error(failure(response.status));
    }
    return response.json().catch(() => {
      if (action === 'create' || action === 'update') requiresReload = true;
      throw new Error('回應無效，結果未確認；請重新載入查核後再操作。');
    });
  }
  const row = (v: unknown): v is LinkedVenue => {
    if (!v || typeof v !== 'object') return false;
    const r = v as Partial<LinkedVenue>;
    return (
      typeof r.id === 'string' &&
      typeof r.code === 'string' &&
      typeof r.name_zh_tw === 'string' &&
      typeof r.region_id === 'string' &&
      typeof r.version === 'number' &&
      typeof r.is_active === 'boolean' &&
      !!r.active_time_rules &&
      Array.isArray(r.active_time_rules.day_of_week) &&
      !!r.urls &&
      ['nfc', 'qr', 'link'].every(
        (k) => typeof r.urls?.[k as keyof LinkedVenue['urls']] === 'string'
      )
    );
  };
  function sign(venue: LinkedVenue | null) {
    links.replaceChildren();
    const board = get('vm-sign');
    board.replaceChildren();
    get<HTMLButtonElement>('vm-print').disabled = !venue;
    if (!venue) return;
    board.append(
      node('h2', venue.name_zh_tw),
      node('p', venue.code),
      node('p', venue.is_active ? '場地已啟用' : '場地已停用：舊網址不能簽到'),
      node('p', '網址文字牌（非 QR 圖片）'),
      node('p', venue.urls.link)
    );
    for (const [key, label] of [
      ['nfc', 'NFC 燒錄網址'],
      ['qr', 'QR 目標網址（非圖片）'],
      ['link', '一般網址']
    ] as const) {
      const container = node('label', label);
      const target = document.createElement('input');
      target.readOnly = true;
      target.value = venue.urls[key];
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = '複製 ' + label;
      const copyTarget = async () => {
        try {
          await navigator.clipboard.writeText(target.value);
          say('網址已複製；source 不是出席證明。');
        } catch {
          target.focus();
          target.select();
          say('無法自動複製，請手動複製。');
        }
      };
      copy.addEventListener('click', () => {
        void copyTarget();
      });
      container.append(target, copy);
      links.append(container);
    }
  }
  function edit(venue: LinkedVenue | null) {
    selected = venue;
    editorState();
    get('vm-version').textContent = venue
      ? '場地 UUID：' + venue.id + '／版本 ' + venue.version
      : '新增：由系統產生 UUID，代碼建立後永久保留。';
    for (const key of [
      'code',
      'name_zh_tw',
      'name_en',
      'address',
      'latitude',
      'longitude',
      'radius_meters',
      'timezone',
      'region_id'
    ] as const)
      set(
        'vm-' + key,
        venue?.[key] ??
          (key === 'region_id'
            ? loadedRegion
            : key === 'radius_meters'
              ? 50
              : key === 'timezone'
                ? 'Asia/Taipei'
                : '')
      );
    get<HTMLInputElement>('vm-code').readOnly = !canManage || !!venue;
    get<HTMLInputElement>('vm-active').checked = venue?.is_active ?? true;
    const rules = venue?.active_time_rules ?? {
      day_of_week: [0, 6],
      start_time: '06:30',
      end_time: '09:00'
    };
    for (let day = 0; day < 7; day++)
      get<HTMLInputElement>('vm-day-' + day).checked = rules.day_of_week.includes(day);
    set('vm-start', rules.start_time);
    set('vm-end', rules.end_time);
    set('vm-reason', '');
    sign(venue);
  }
  function renderList() {
    list.replaceChildren();
    const query = value('vm-search').trim().toLowerCase();
    const active = value('vm-filter');
    for (const venue of rows.filter(
      (r) =>
        (!query || (r.name_zh_tw + ' ' + r.code).toLowerCase().includes(query)) &&
        (!active || String(r.is_active) === active)
    )) {
      const item = node('article', '');
      item.append(
        node('h3', venue.name_zh_tw),
        node('p', venue.code + '｜' + (venue.is_active ? '啟用' : '停用') + '｜' + venue.timezone)
      );
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = canManage ? '編輯／網址' : '檢視／網址';
      button.disabled = busy || requiresReload;
      button.addEventListener('click', () => {
        if (!busy && !requiresReload) {
          edit(venue);
          get('vm-version').focus();
        }
      });
      item.append(button);
      list.append(item);
    }
    if (!list.childNodes.length)
      list.append(
        node('p', loaded ? '沒有符合條件的場地。' : '尚未成功載入場地；請確認區域與權限後重試。')
      );
  }
  async function load() {
    if (busy) return;
    busy = true;
    canManage = false;
    rows = [];
    loaded = false;
    requiresReload = false;
    loadedRegion = value('vm-region').trim();
    edit(null);
    list.replaceChildren();
    get<HTMLButtonElement>('vm-add').disabled = true;
    get<HTMLButtonElement>('vm-load').disabled = true;
    say('重新驗證登入與區域權限中…');
    try {
      const regionId = loadedRegion;
      const caps = (await api('capabilities', { regionId })) as {
        canRead?: unknown;
        canManage?: unknown;
      };
      if (caps?.canRead !== true || typeof caps.canManage !== 'boolean')
        throw new Error('權限回應無效，停止操作。');
      const data = (await api('list', { regionId })) as { fields?: unknown };
      if (!Array.isArray(data?.fields) || !data.fields.every(row))
        throw new Error('資料回應無效，停止操作。');
      rows = data.fields;
      loaded = true;
      canManage = caps.canManage;
      get<HTMLButtonElement>('vm-add').disabled = !canManage;
      say(
        canManage
          ? '可管理此區域。位置／時段修改需填寫原因；更新採版本檢查。'
          : '唯讀：現有 view 權限不包含建立／修改。'
      );
    } catch (error) {
      say(error instanceof Error ? error.message : '載入失敗，請重試。');
    } finally {
      busy = false;
      get<HTMLButtonElement>('vm-load').disabled = false;
      renderList();
    }
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!canManage || busy || requiresReload) return;
    if (
      selected?.is_active &&
      !get<HTMLInputElement>('vm-active').checked &&
      !window.confirm('確認停用此場地？舊 NFC／QR／連結將無法簽到；既有出席紀錄保留，不會刪除。')
    ) {
      say('已取消停用，尚未儲存。');
      return;
    }
    const number = (id: string) => (value(id).trim() ? Number(value(id)) : Number.NaN);
    const field: VenueManagementField = {
      region_id: value('vm-region_id').trim(),
      code: value('vm-code').trim(),
      name_zh_tw: value('vm-name_zh_tw').trim(),
      name_en: value('vm-name_en').trim() || null,
      address: value('vm-address').trim(),
      latitude: number('vm-latitude'),
      longitude: number('vm-longitude'),
      radius_meters: number('vm-radius_meters'),
      timezone: value('vm-timezone').trim(),
      active_time_rules: {
        day_of_week: Array.from({ length: 7 }, (_, day) => day).filter(
          (day) => get<HTMLInputElement>('vm-day-' + day).checked
        ),
        start_time: value('vm-start'),
        end_time: value('vm-end')
      },
      is_active: get<HTMLInputElement>('vm-active').checked
    };
    busy = true;
    editor.disabled = true;
    get<HTMLButtonElement>('vm-add').disabled = true;
    say('驗證與儲存中…');
    try {
      const data = (await api(selected ? 'update' : 'create', {
        regionId: selected?.region_id ?? loadedRegion,
        field,
        reason: value('vm-reason').trim(),
        ...(selected ? { id: selected.id, version: selected.version } : {})
      })) as { field?: unknown };
      if (!row(data?.field)) {
        requiresReload = true;
        throw new Error('未收到有效儲存結果，請重新載入查核；不能確認儲存。');
      }
      selected = data.field;
      rows = rows.filter((r) => r.id !== selected?.id);
      if (selected.region_id === loadedRegion) rows = rows.concat(selected);
      edit(selected);
      say('已儲存，版本 ' + selected.version + '。網址代碼未變；若跨區移動請重新查詢目標區域。');
    } catch (error) {
      say(error instanceof Error ? error.message : '儲存失敗，請重新載入查核。');
    } finally {
      busy = false;
      editorState();
      get<HTMLButtonElement>('vm-add').disabled = !canManage || requiresReload;
      renderList();
    }
  }
  get('vm-load').addEventListener('click', () => {
    void load();
  });
  get('vm-add').addEventListener('click', () => {
    if (canManage && !busy && !requiresReload) {
      edit(null);
      get('vm-version').focus();
    }
  });
  get('vm-search').addEventListener('input', renderList);
  get('vm-filter').addEventListener('change', renderList);
  get('vm-form').addEventListener('submit', (event) => {
    void save(event);
  });
  get('vm-print').addEventListener('click', () => {
    if (selected && !busy) window.print();
  });
  say('請輸入場地所屬區域 UUID，按「查詢」。未接線／未授權不會模擬成功。');
}

export const renderVenueManagementPage = (locale: AdminLocale = 'zh_TW'): string => {
  return renderAdminShell(
    'fieldSchedule',
    `<style>
#vm-root{display:flex;flex-direction:column;gap:1.25rem;min-width:0;max-width:100%;overflow-wrap:anywhere;color:var(--brand-primary,#082850)}
.vm-header{border-bottom:2px solid var(--border,#98C0D8);padding-bottom:.75rem}
.vm-header h1{font-size:1.35rem;line-height:1.3;margin:0 0 .5rem;color:var(--brand-deep,#002048)}
.vm-intro{margin:0;font-size:.875rem;color:var(--muted,#305888);line-height:1.5}
.vm-card{background:var(--surface,#fff);border:1px solid var(--border,#98C0D8);border-radius:.5rem;padding:1.1rem;box-shadow:0 1px 3px rgba(8,40,80,.05)}
.vm-toolbar-card{display:flex;flex-direction:column;gap:.75rem}
.vm-toolbar-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:.75rem}
.vm-region-group{display:flex;flex-direction:column;gap:.35rem;flex:1 1 20rem;min-width:0}
.vm-btn-group{display:flex;flex-wrap:wrap;gap:.5rem}
.vm-btn{font:inherit;font-size:.875rem;font-weight:600;min-height:44px;padding:.5rem 1rem;border-radius:.375rem;border:1px solid transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:.35rem;white-space:nowrap;transition:background-color .15s ease,border-color .15s ease}
.vm-btn-primary{background:var(--brand-primary,#082850);color:#fff;border-color:var(--brand-deep,#002048)}
.vm-btn-primary:hover:not(:disabled){background:var(--brand-deep,#002048)}
.vm-btn-secondary{background:var(--surface,#fff);color:var(--brand-primary,#082850);border-color:var(--brand-secondary,#305888)}
.vm-btn-secondary:hover:not(:disabled){background:var(--surface-muted,#eef4f8)}
.vm-btn:disabled{opacity:.45;cursor:not-allowed}
.vm-btn:focus-visible{outline:3px solid var(--brand-secondary,#305888);outline-offset:2px}
.vm-status{min-height:1.5rem;margin:0;padding:.65rem .85rem;border-radius:.375rem;background:var(--surface-muted,#eef4f8);border-left:4px solid var(--brand-secondary,#305888);font-size:.875rem;line-height:1.45;overflow-wrap:anywhere}
.vm-status:empty{display:none}
.vm-workspace{display:grid;grid-template-columns:minmax(280px,340px) minmax(0,1fr);gap:1.25rem;align-items:start}
.vm-list-panel{display:flex;flex-direction:column;gap:.75rem}
.vm-panel-title{font-size:1.05rem;margin:0;color:var(--brand-deep,#002048);font-weight:700}
.vm-filter-bar{display:flex;flex-direction:column;gap:.5rem}
.vm-filter-group{display:flex;flex-direction:column;gap:.25rem}
.vm-list-container{display:flex;flex-direction:column;gap:.65rem;max-height:680px;overflow-y:auto;overscroll-behavior:contain;padding-right:.25rem}
.vm-list-container article{background:var(--surface,#fff);border:1px solid var(--border,#98C0D8);border-radius:.375rem;padding:.75rem .85rem;margin:0;display:flex;flex-direction:column;gap:.45rem;transition:border-color .15s ease,box-shadow .15s ease}
.vm-list-container article:hover{border-color:var(--brand-secondary,#305888);box-shadow:0 2px 6px rgba(8,40,80,.08)}
.vm-list-container article h3{font-size:.95rem;margin:0;color:var(--brand-deep,#002048)}
.vm-list-container article p{font-size:.8125rem;color:var(--muted,#305888);margin:0}
.vm-list-container article button{align-self:flex-start;min-height:38px;padding:.3rem .75rem;font-size:.8125rem;border-radius:.3rem;background:var(--surface-muted,#eef4f8);color:var(--brand-primary,#082850);border:1px solid var(--brand-secondary,#305888);font-weight:600;cursor:pointer}
.vm-list-container article button:hover:not(:disabled){background:var(--brand-secondary,#305888);color:#fff}
.vm-editor-card{border:1px solid var(--border,#98C0D8);border-radius:.5rem;padding:1.25rem;margin:0;background:var(--surface,#fff)}
.vm-editor-card:disabled{opacity:.7}
.vm-legend{font-size:1.1rem;font-weight:700;color:var(--brand-deep,#002048);padding:0 .5rem}
.vm-version-banner{background:var(--surface-muted,#eef4f8);border:1px solid var(--border,#98C0D8);border-radius:.375rem;padding:.65rem .85rem;margin:0 0 1rem;font-size:.875rem;font-weight:600;color:var(--brand-primary,#082850);outline:none}
.vm-version-banner:focus-visible{outline:3px solid var(--brand-secondary,#305888);outline-offset:2px}
.vm-form-table{display:flex;flex-direction:column;gap:.85rem;margin-bottom:1.25rem}
.vm-form-row{display:grid;grid-template-columns:180px minmax(0,1fr);gap:1rem;align-items:start;padding-bottom:.85rem;border-bottom:1px solid var(--surface-muted,#eef4f8)}
.vm-form-row:last-child{border-bottom:none;padding-bottom:0}
.vm-label-col{padding-top:.5rem}
.vm-field-label{display:block;font-weight:600;font-size:.875rem;color:var(--brand-deep,#002048);line-height:1.35}
.vm-field-hint{display:block;font-size:.75rem;color:var(--muted,#305888);margin-top:.2rem;line-height:1.3}
.vm-req{color:#c02020;font-weight:700;margin-left:.15rem}
.vm-opt{font-size:.75rem;font-weight:400;color:var(--muted,#305888)}
.vm-control-col{display:flex;flex-direction:column;gap:.35rem;min-width:0}
.vm-input{width:100%;box-sizing:border-box;font:inherit;font-size:.875rem;min-height:44px;padding:.45rem .75rem;border:1px solid var(--brand-secondary,#305888);border-radius:.35rem;background:#fff;color:var(--brand-primary,#082850)}
.vm-input:focus-visible,#vm-filter:focus-visible,.vm-checkbox:focus-visible{outline:3px solid var(--brand-secondary,#305888);outline-offset:2px}
.vm-input[readonly]{background:var(--surface-muted,#eef4f8);border-color:var(--border,#98C0D8);color:var(--brand-primary,#082850);cursor:default}
.vm-input:disabled{background:#f1f5f9;border-color:#cbd5e1;color:#64748b;cursor:not-allowed}
.vm-pair-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
.vm-subfield{display:flex;flex-direction:column;gap:.25rem;min-width:0}
.vm-sublabel{font-size:.8125rem;font-weight:500;color:var(--brand-secondary,#305888)}
.vm-days-group{display:flex;flex-wrap:wrap;gap:.4rem}
.vm-day-pill{display:inline-flex;align-items:center;gap:.35rem;padding:.4rem .65rem;min-height:44px;background:var(--surface-muted,#eef4f8);border:1px solid var(--border,#98C0D8);border-radius:.35rem;cursor:pointer;font-size:.875rem;user-select:none}
.vm-day-pill:hover{border-color:var(--brand-secondary,#305888)}
.vm-day-pill:has(input:checked){background:#e0ecf6;border-color:var(--brand-secondary,#305888);font-weight:600}
.vm-checkbox{width:1.15rem;height:1.15rem;min-height:0;cursor:pointer;accent-color:var(--brand-primary,#082850);margin:0}
.vm-toggle-label{display:inline-flex;align-items:center;gap:.5rem;min-height:44px;cursor:pointer;font-size:.875rem;font-weight:500}
.vm-form-actions{display:flex;justify-content:flex-end;padding-top:.75rem;border-top:1px solid var(--border,#98C0D8)}
.vm-btn-save{min-width:140px}
.vm-links-panel{display:flex;flex-direction:column;gap:.75rem}
.vm-links-grid{display:flex;flex-direction:column;gap:.75rem}
.vm-links-grid label{display:flex;flex-direction:column;gap:.35rem;font-weight:600;font-size:.875rem}
.vm-links-grid input{font:inherit;font-size:.875rem;min-height:44px;padding:.45rem .75rem;border:1px solid var(--border,#98C0D8);border-radius:.35rem;background:var(--surface-muted,#eef4f8)}
.vm-links-grid button{align-self:flex-start;min-height:44px;padding:.4rem .85rem;font-size:.8125rem;font-weight:600;background:var(--surface,#fff);color:var(--brand-primary,#082850);border:1px solid var(--brand-secondary,#305888);border-radius:.35rem;cursor:pointer}
.vm-links-grid button:hover{background:var(--surface-muted,#eef4f8)}
.vm-signboard{border:2px dashed var(--brand-secondary,#305888);border-radius:.5rem;padding:1.25rem;background:#fff}
.vm-signboard h2{font-size:1.2rem;margin:0 0 .5rem;color:var(--brand-deep,#002048)}
.vm-signboard p{margin:.35rem 0;font-size:.9rem}
@media(max-width:1024px){.vm-workspace{grid-template-columns:1fr}}
@media(max-width:768px){
.vm-form-row{grid-template-columns:1fr;gap:.35rem;padding-bottom:.75rem}
.vm-label-col{padding-top:0}
.vm-pair-grid{grid-template-columns:1fr}
.vm-toolbar-row{flex-direction:column;align-items:stretch}
.vm-btn-group{flex-direction:column}
.vm-btn{width:100%;min-height:48px;font-size:1rem}
.vm-input,#vm-filter{font-size:1rem;min-height:48px}
.vm-day-pill{min-height:48px;flex:1 1 42%;justify-content:center}
.vm-toggle-label{min-height:48px}
.vm-form-actions{justify-content:stretch}
.vm-btn-save{width:100%}
.vm-links-grid button{width:100%;min-height:48px}
}
@media print{
body *{visibility:hidden}
#vm-sign,#vm-sign *{visibility:visible}
#vm-sign{position:absolute;left:0;top:0;width:90%;font-size:24px;border:2px solid #000}
#vm-sign::after{content:'Developed with ❤️ by Bean, Bird & Badminton Tech Consulting';display:block;font-size:12px;margin-top:1rem}
}
</style>
<section id="vm-root">
  <div class="vm-header">
    <h1>團練場出席管理 · 場地設定與 NFC／QR 網址</h1>
    <p class="vm-intro">UUID 與代碼建立後不可變更；停用而非刪除。已有出席不可改區域／時區。更動中心、半徑或時段需明確原因並記錄前後版本。</p>
  </div>

  <div class="vm-card vm-toolbar-card">
    <div class="vm-toolbar-row">
      <div class="vm-region-group">
        <label for="vm-region" class="vm-field-label">查詢區域 UUID <span class="vm-req" aria-hidden="true">*</span></label>
        <input id="vm-region" autocomplete="off" class="vm-input" placeholder="請輸入 36 字元區域 UUID">
      </div>
      <div class="vm-btn-group">
        <button id="vm-load" type="button" class="vm-btn vm-btn-primary">查詢／重新載入</button>
        <button id="vm-add" type="button" class="vm-btn vm-btn-secondary" disabled>新增場地</button>
      </div>
    </div>
    <p id="vm-status" role="status" aria-live="polite" class="vm-status"></p>
  </div>

  <div class="vm-workspace">
    <section class="vm-card vm-list-panel" aria-labelledby="vm-list-heading">
      <h2 id="vm-list-heading" class="vm-panel-title">場地清單</h2>
      <div class="vm-filter-bar">
        <div class="vm-filter-group">
          <label for="vm-search" class="vm-field-label">搜尋名稱／代碼</label>
          <input id="vm-search" class="vm-input" placeholder="依名稱或代碼過濾...">
        </div>
        <div class="vm-filter-group">
          <label for="vm-filter" class="vm-field-label">狀態篩選</label>
          <select id="vm-filter" class="vm-input">
            <option value="">全部狀態</option>
            <option value="true">啟用</option>
            <option value="false">停用</option>
          </select>
        </div>
      </div>
      <div id="vm-list" class="vm-list-container" role="region" aria-label="場地列表"></div>
    </section>

    <form id="vm-form" class="vm-editor-panel">
      <fieldset id="vm-editor" class="vm-card vm-editor-card" disabled>
        <legend class="vm-legend">場地資料編輯</legend>
        <p id="vm-version" class="vm-version-banner" tabindex="-1"></p>

        <div class="vm-form-table" role="presentation">
          <div class="vm-form-row">
            <div class="vm-label-col">
              <label for="vm-code" class="vm-field-label">永久唯一代碼 <span class="vm-req" aria-hidden="true">*</span></label>
              <span class="vm-field-hint">如 tw-tpe-daan，建立後不可更改</span>
            </div>
            <div class="vm-control-col">
              <input id="vm-code" type="text" required class="vm-input" autocomplete="off" placeholder="例如 tw-tpe-daan">
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <label for="vm-name_zh_tw" class="vm-field-label">場地名稱（繁中） <span class="vm-req" aria-hidden="true">*</span></label>
              <span class="vm-field-hint">顯示於打卡與簽到頁面</span>
            </div>
            <div class="vm-control-col">
              <input id="vm-name_zh_tw" type="text" required class="vm-input" placeholder="例如 大安森林公園團練場">
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <label for="vm-name_en" class="vm-field-label">英文名稱 <span class="vm-opt">（選填）</span></label>
              <span class="vm-field-hint">供英文介面或外籍學員辨識</span>
            </div>
            <div class="vm-control-col">
              <input id="vm-name_en" type="text" class="vm-input" placeholder="例如 Daan Forest Park Practice Field">
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <label for="vm-address" class="vm-field-label">地址 <span class="vm-opt">（選填）</span></label>
              <span class="vm-field-hint">實體練習場地說明或街道地址</span>
            </div>
            <div class="vm-control-col">
              <input id="vm-address" type="text" class="vm-input" placeholder="例如 台北市大安區新生南路二段1號">
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <label for="vm-region_id" class="vm-field-label">目標區域 UUID <span class="vm-req" aria-hidden="true">*</span></label>
              <span class="vm-field-hint">場地所屬之區域 UUID</span>
            </div>
            <div class="vm-control-col">
              <input id="vm-region_id" type="text" required class="vm-input" autocomplete="off" placeholder="36 字元 UUID">
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <span class="vm-field-label">中心座標 GPS <span class="vm-req" aria-hidden="true">*</span></span>
              <span class="vm-field-hint">WGS84 座標，打卡距離基準</span>
            </div>
            <div class="vm-control-col">
              <div class="vm-pair-grid">
                <div class="vm-subfield">
                  <label for="vm-latitude" class="vm-sublabel">中心緯度（-90～90） <span class="vm-req" aria-hidden="true">*</span></label>
                  <input id="vm-latitude" type="number" step="any" required class="vm-input" placeholder="例如 25.032969">
                </div>
                <div class="vm-subfield">
                  <label for="vm-longitude" class="vm-sublabel">中心經度（-180～180） <span class="vm-req" aria-hidden="true">*</span></label>
                  <input id="vm-longitude" type="number" step="any" required class="vm-input" placeholder="例如 121.534838">
                </div>
              </div>
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <span class="vm-field-label">半徑與時區 <span class="vm-req" aria-hidden="true">*</span></span>
              <span class="vm-field-hint">簽到有效範圍與當地時區</span>
            </div>
            <div class="vm-control-col">
              <div class="vm-pair-grid">
                <div class="vm-subfield">
                  <label for="vm-radius_meters" class="vm-sublabel">半徑（1～5000 公尺） <span class="vm-req" aria-hidden="true">*</span></label>
                  <input id="vm-radius_meters" type="number" step="any" required class="vm-input" placeholder="50">
                </div>
                <div class="vm-subfield">
                  <label for="vm-timezone" class="vm-sublabel">IANA 時區 <span class="vm-req" aria-hidden="true">*</span></label>
                  <input id="vm-timezone" type="text" required class="vm-input" placeholder="Asia/Taipei">
                </div>
              </div>
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <span class="vm-field-label">每週開放日 <span class="vm-req" aria-hidden="true">*</span></span>
              <span class="vm-field-hint">以場地時區計算開團日</span>
            </div>
            <div class="vm-control-col">
              <div class="vm-days-group" role="group" aria-label="每週開放日選擇">
                ${['日', '一', '二', '三', '四', '五', '六'].map((label, day) => `<label class="vm-day-pill"><input id="vm-day-${day}" type="checkbox" class="vm-checkbox"><span>週${label}</span></label>`).join('')}
              </div>
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <span class="vm-field-label">開放時段 <span class="vm-req" aria-hidden="true">*</span></span>
              <span class="vm-field-hint">結束時間不含；跨日可用 24:00</span>
            </div>
            <div class="vm-control-col">
              <div class="vm-pair-grid">
                <div class="vm-subfield">
                  <label for="vm-start" class="vm-sublabel">開始 HH:mm <span class="vm-req" aria-hidden="true">*</span></label>
                  <input id="vm-start" required pattern="([01][0-9]|2[0-3]):[0-5][0-9]" class="vm-input" placeholder="06:30">
                </div>
                <div class="vm-subfield">
                  <label for="vm-end" class="vm-sublabel">結束 HH:mm <span class="vm-req" aria-hidden="true">*</span></label>
                  <input id="vm-end" required pattern="(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)" class="vm-input" placeholder="09:00">
                </div>
              </div>
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <span class="vm-field-label">場地狀態</span>
              <span class="vm-field-hint">停用而非刪除；保留舊紀錄</span>
            </div>
            <div class="vm-control-col">
              <label class="vm-toggle-label">
                <input id="vm-active" type="checkbox" class="vm-checkbox">
                <span>啟用此場地（取消即停用，保留舊網址與出席紀錄）</span>
              </label>
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <label for="vm-reason" class="vm-field-label">設定異動原因 <span class="vm-req" aria-hidden="true">*</span></label>
              <span class="vm-field-hint">寫入稽核紀錄；勿填個資</span>
            </div>
            <div class="vm-control-col">
              <input id="vm-reason" required maxlength="500" class="vm-input" placeholder="請詳述本次異動原因（必填，上限 500 字）">
            </div>
          </div>
        </div>

        <div class="vm-form-actions">
          <button id="vm-save" type="submit" class="vm-btn vm-btn-primary vm-btn-save" disabled>儲存場地</button>
        </div>
      </fieldset>
    </form>
  </div>

  <section class="vm-card vm-links-panel" aria-labelledby="vm-links-heading">
    <h2 id="vm-links-heading" class="vm-panel-title">NFC／QR URL 管理</h2>
    <p class="vm-intro">QR 圖片待編碼套件核准：尚無已核准本地 QR 編碼器，因此沒有 QR 圖片／下載功能。僅提供 QR 目標網址及可列印場地牌，不外送第三方；source 可轉傳，不是出席證明。啟用場地管理時，停用場地的公開入口會拒絕簽到；功能尚未開啟不代表網址已可簽到。</p>
    <div class="vm-btn-group">
      <button id="vm-print" type="button" class="vm-btn vm-btn-secondary" disabled>列印選取場地牌（網址，非 QR 圖）</button>
    </div>
    <div id="vm-links" class="vm-links-grid"></div>
    <section id="vm-sign" class="vm-signboard"></section>
  </section>
</section>`,
    `(${venueManagementController.toString()})();`,
    locale
  );
};
