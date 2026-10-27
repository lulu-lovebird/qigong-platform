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
      button.disabled = busy;
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
  const fields = [
    ['code', '永久唯一代碼（如 tw-tpe-daan）', 'text'],
    ['name_zh_tw', '場地名稱', 'text'],
    ['name_en', '英文名稱（選填）', 'text'],
    ['address', '地址（選填）', 'text'],
    ['region_id', '目標區域 UUID', 'text'],
    ['latitude', '中心緯度 -90～90', 'number'],
    ['longitude', '中心經度 -180～180', 'number'],
    ['radius_meters', '半徑 1～5000 公尺', 'number'],
    ['timezone', 'IANA 時區', 'text']
  ]
    .map(
      ([key, label, type]) =>
        `<label>${label}<input id="vm-${key}" type="${type}" ${['name_en', 'address'].includes(key!) ? '' : 'required'} ${type === 'number' ? 'step="any"' : ''}></label>`
    )
    .join('');
  return renderAdminShell(
    'fieldSchedule',
    `<style>
#vm-root{min-width:0;overflow-wrap:anywhere}#vm-root fieldset{min-width:0}#vm-root label{display:block;margin:.5rem 0}#vm-root input,#vm-root select,#vm-root button{font:inherit;min-height:44px;max-width:100%}#vm-root article{border:1px solid #bbb;padding:1rem;margin:1rem 0}#vm-sign{overflow-wrap:anywhere;border:2px solid #555;padding:1rem}#vm-root :focus-visible{outline:3px solid #185}
@media print{body *{visibility:hidden}#vm-sign,#vm-sign *{visibility:visible}#vm-sign{position:absolute;left:0;top:0;width:90%;font-size:24px}#vm-sign::after{content:'Developed with ❤️ by Bean, Bird & Badminton Tech Consulting';display:block;font-size:12px}}
</style><section id="vm-root"><h1>團練場出席管理 · 場地設定與 NFC／QR 網址</h1>
<p>UUID 與代碼建立後不可變更；停用而非刪除。已有出席不可改區域／時區。更動中心、半徑或時段需明確原因並記錄前後版本。</p>
<label>查詢區域 UUID <input id="vm-region" autocomplete="off"></label><button id="vm-load" type="button">查詢／重新載入</button><button id="vm-add" type="button" disabled>新增場地</button>
<p id="vm-status" role="status" aria-live="polite"></p><label>搜尋名稱／代碼 <input id="vm-search"></label><label>狀態 <select id="vm-filter"><option value="">全部</option><option value="true">啟用</option><option value="false">停用</option></select></label><div id="vm-list"></div>
<form id="vm-form"><fieldset id="vm-editor" disabled><legend>場地資料</legend><p id="vm-version" tabindex="-1"></p>${fields}
<p>每週時段（以場地時區計算，結束時間不含；同日，可用 24:00）</p>${['日', '一', '二', '三', '四', '五', '六'].map((label, day) => `<label><input id="vm-day-${day}" type="checkbox">週${label}</label>`).join('')}
<label>開始 HH:mm <input id="vm-start" required pattern="([01][0-9]|2[0-3]):[0-5][0-9]"></label><label>結束 HH:mm <input id="vm-end" required pattern="(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)"></label>
<label><input id="vm-active" type="checkbox">啟用（取消即停用，保留舊網址與出席）</label><label>本次修改原因（必要，寫入稽核） <input id="vm-reason" required maxlength="500"></label><button id="vm-save" type="submit" disabled>儲存場地</button></fieldset></form>
<h2>NFC／QR URL 管理</h2><div id="vm-links"></div><p>QR 圖片待編碼套件核准：尚無已核准本地 QR 編碼器，因此沒有 QR 圖片／下載功能。僅提供 QR 目標網址及可列印場地牌，不外送第三方；source 可轉傳，不是出席證明。啟用場地管理時，停用場地的公開入口會拒絕簽到；功能尚未開啟不代表網址已可簽到。</p><button id="vm-print" type="button" disabled>列印選取場地牌（網址，非 QR 圖）</button><section id="vm-sign"></section></section>`,
    `(${venueManagementController.toString()})();`,
    locale
  );
};
