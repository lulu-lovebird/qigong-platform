/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { renderAdminShell } from './admin-dashboard.js';
import type { AdminLocale } from './admin-locale.js';
import type { CreateFieldInput, PracticeFieldRow } from './admin-field-routes.js';

/** Preview links are not attendance credentials. No remote QR service is used. */
export const venueEntryUrl = (
  venue: string,
  source: 'nfc' | 'qr' | 'link',
  liffId = ''
): string => {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(venue) || venue.length > 50) return '';
  if (!/^[A-Za-z0-9-]+$/.test(liffId)) return '';
  const query = new URLSearchParams({ venue, source });
  return `https://liff.line.me/${encodeURIComponent(liffId)}/venue-checkin?${query}`;
};

// Serialized into the shell after TypeScript compilation; all API text uses DOM text/value.
function venueFieldsController(liffId: string) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const input = (id: string) => get<HTMLInputElement>(id);
  const status = get('venue-status');
  const editor = get<HTMLFieldSetElement>('venue-editor');
  const form = get<HTMLFormElement>('venue-form');
  const list = get('venue-list');
  const add = get<HTMLButtonElement>('venue-add');
  const refresh = get<HTMLButtonElement>('venue-refresh');
  let allowed = false;
  let saving = false;
  let loading = false;
  let selected = '';
  let rows: PracticeFieldRow[] = [];
  const say = (message: string, error = false) => {
    status.textContent = message;
    status.dataset.error = String(error);
  };
  const node = (tag: string, text: string) => {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  };
  const failure = (code: number) =>
    ({
      400: '欄位格式不正確，請檢查輸入；尚未儲存。',
      401: '登入已過期，請重新登入；尚未儲存。',
      403: '沒有權限或安全驗證失敗；尚未儲存。',
      404: '場地或後端路由尚未提供；尚未儲存。',
      409: '場地代碼重複，請更換代碼；尚未儲存。',
      503: '場地授權與資料庫尚未開放（quarantine）；尚未儲存。'
    })[code] ?? '服務失敗，請稍後重試；尚未儲存。';
  async function api(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch('/admin/api/fields' + path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store'
    }).catch(() => {
      throw new Error('網路連線失敗，請重試；尚未儲存。');
    });
    if (!response.ok) {
      if ([401, 403, 404, 503].includes(response.status)) lock();
      throw new Error(failure(response.status));
    }
    return response.json().catch(() => {
      throw new Error('伺服器回應格式錯誤；請重新載入確認，未確認儲存。');
    });
  }
  function lock() {
    allowed = false;
    editor.disabled = add.disabled = true;
    rows = [];
    list.replaceChildren();
    get('venue-links').replaceChildren();
  }
  const validRow = (row: unknown): row is PracticeFieldRow => {
    if (typeof row !== 'object' || row === null) return false;
    const r = row as Partial<PracticeFieldRow>;
    const rules = r.active_time_rules;
    return (
      typeof r.id === 'string' &&
      /^[0-9a-f-]{36}$/i.test(r.id) &&
      typeof r.code === 'string' &&
      typeof r.region_id === 'string' &&
      typeof r.name_zh_tw === 'string' &&
      typeof r.is_active === 'boolean' &&
      typeof r.latitude === 'number' &&
      Number.isFinite(r.latitude) &&
      typeof r.longitude === 'number' &&
      Number.isFinite(r.longitude) &&
      typeof r.radius_meters === 'number' &&
      Number.isFinite(r.radius_meters) &&
      !!rules &&
      Array.isArray(rules.day_of_week) &&
      rules.day_of_week.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
      typeof rules.start_time === 'string' &&
      typeof rules.end_time === 'string'
    );
  };
  function links(code: string) {
    const root = get('venue-links');
    root.replaceChildren();
    if (!venueEntryUrl(code, 'link', liffId)) {
      root.append(
        node(
          'p',
          '未產生網址：需設定 LIFF ID，且 venue 代碼須為小寫連字號格式（如 tw-tpe-daan）。不會自動改寫舊代碼。'
        )
      );
      return;
    }
    for (const [source, title] of [
      ['nfc', 'NFC 燒錄網址'],
      ['qr', 'QR 目標網址'],
      ['link', '一般入口網址']
    ] as const) {
      const label = document.createElement('label');
      label.textContent = title;
      const value = document.createElement('input');
      value.readOnly = true;
      value.value = venueEntryUrl(code, source, liffId);
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = '複製 ' + title;
      const copyUrl = async () => {
        try {
          await navigator.clipboard.writeText(value.value);
          say('網址已複製；這是入口預覽，不代表已啟用簽到。');
        } catch {
          value.focus();
          value.select();
          say('無法自動複製，請選取網址手動複製。', true);
        }
      };
      copy.addEventListener('click', () => {
        void copyUrl();
      });
      label.append(value, copy);
      root.append(label);
    }
    root.append(
      node(
        'p',
        '未生成 QR 圖片：目前沒有本地 QR 產生器；請複製 QR 目標網址。不會外送第三方 QR 服務。靜態連結可轉傳，source 不是防偽或出席證明。'
      )
    );
  }
  function edit(row?: PracticeFieldRow) {
    if (!allowed || saving) return;
    selected = row?.id ?? '';
    get('venue-editor-title').textContent = row ? '編輯場地' : '新增場地';
    for (const key of [
      'code',
      'name_zh_tw',
      'name_en',
      'region_id',
      'latitude',
      'longitude',
      'radius_meters'
    ] as const) {
      input('venue-' + key).value = String(row?.[key] ?? (key === 'radius_meters' ? 50 : ''));
    }
    input('venue-is_active').checked = row?.is_active ?? true;
    const rules = row?.active_time_rules ?? {
      day_of_week: [0, 6],
      start_time: '06:30',
      end_time: '09:00'
    };
    for (let day = 0; day <= 6; day++)
      input('venue-day-' + day).checked = rules.day_of_week.includes(day);
    input('venue-start').value = rules.start_time;
    input('venue-end').value = rules.end_time;
    links(row?.code ?? '');
  }
  function renderList() {
    list.replaceChildren();
    const query = input('venue-search').value.trim().toLowerCase();
    const region = input('venue-region-filter').value.trim();
    const active = get<HTMLSelectElement>('venue-active-filter').value;
    const visible = rows.filter(
      (row) =>
        (!query || (row.code + ' ' + row.name_zh_tw).toLowerCase().includes(query)) &&
        (!region || row.region_id === region) &&
        (!active || String(row.is_active) === active)
    );
    if (!visible.length)
      list.append(node('p', rows.length ? '沒有符合篩選的場地。' : '目前沒有場地。'));
    for (const row of visible) {
      const card = node('article', '');
      card.className = 'card';
      card.append(node('h3', row.name_zh_tw + '（' + row.code + '）'));
      card.append(node('p', 'Region：' + (row.region_name ?? row.region_id)));
      card.append(
        node(
          'p',
          (row.is_active ? '啟用' : '停用') +
            '｜中心 ' +
            row.latitude +
            ', ' +
            row.longitude +
            '｜半徑 ' +
            row.radius_meters +
            ' m'
        )
      );
      card.append(
        node(
          'p',
          '週期（0=週日）：' +
            row.active_time_rules.day_of_week.join(', ') +
            '｜' +
            row.active_time_rules.start_time +
            '–' +
            row.active_time_rules.end_time
        )
      );
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '編輯／入口網址';
      button.disabled = !allowed || saving;
      button.addEventListener('click', () => edit(row));
      card.append(button);
      list.append(card);
    }
  }
  async function load(message?: string) {
    if (saving || loading) return;
    loading = true;
    lock();
    refresh.disabled = true;
    say('正在檢查場地管理權限…');
    try {
      const caps = (await api('/capabilities')) as { canManage?: unknown } | null;
      if (caps?.canManage !== true) {
        say('場地設定尚未開放：授權／資料庫隔離未完成，或您沒有場地管理權限。', true);
        return;
      }
      const data = (await api('')) as { fields?: unknown } | null;
      if (!Array.isArray(data?.fields) || !data.fields.every(validRow))
        throw new Error('場地資料格式不正確，已停止操作。');
      rows = data.fields;
      allowed = true;
      editor.disabled = add.disabled = false;
      renderList();
      edit();
      say(message ?? '場地已載入。入口網址僅供預覽，出席功能仍受安全 gate 控制。');
    } catch (error) {
      lock();
      say(error instanceof Error ? error.message : '無法載入場地，請檢查連線後重試。', true);
    } finally {
      loading = false;
      refresh.disabled = false;
    }
  }
  const save = async (event: Event) => {
    event.preventDefault();
    if (!allowed || saving || !form.reportValidity()) return;
    const day_of_week = Array.from({ length: 7 }, (_, day) => day).filter(
      (day) => input('venue-day-' + day).checked
    );
    const start_time = input('venue-start').value,
      end_time = input('venue-end').value;
    if (!day_of_week.length || end_time <= start_time) {
      say('請選擇至少一天，結束時間必須晚於開始時間（不支援跨夜）。尚未儲存。', true);
      return;
    }
    const csrf = document.cookie
      .split('; ')
      .find((part) => part.startsWith('__Host-qigong-admin-csrf='))
      ?.slice('__Host-qigong-admin-csrf='.length);
    if (!csrf) {
      say('缺少安全驗證，請重新登入；尚未儲存。', true);
      return;
    }
    const payload: CreateFieldInput = {
      code: input('venue-code').value.trim(),
      name_zh_tw: input('venue-name_zh_tw').value.trim(),
      name_en: input('venue-name_en').value.trim() || null,
      region_id: input('venue-region_id').value.trim(),
      latitude: Number(input('venue-latitude').value),
      longitude: Number(input('venue-longitude').value),
      radius_meters: Number(input('venue-radius_meters').value),
      active_time_rules: { day_of_week, start_time, end_time },
      is_active: input('venue-is_active').checked
    };
    saving = true;
    editor.disabled = add.disabled = refresh.disabled = true;
    renderList();
    say('正在儲存，請勿重複送出…');
    let saved = false;
    try {
      const response = (await api(selected ? '/' + encodeURIComponent(selected) : '', {
        method: selected ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify(payload)
      })) as { ok?: unknown; field?: unknown } | null;
      if (response?.ok !== true || !validRow(response.field))
        throw new Error('伺服器未確認儲存；請重新載入確認，不會假裝成功。');
      saved = true;
    } catch (error) {
      // Only fixed local messages; never render an upstream response body/diagnostic.
      say(error instanceof Error ? error.message : '儲存未完成，請重試；未確認儲存。', true);
    } finally {
      saving = false;
      editor.disabled = add.disabled = !allowed;
      refresh.disabled = false;
      renderList();
    }
    if (saved) await load('伺服器已確認儲存，列表已重新載入。');
  };
  form.addEventListener('submit', (event) => {
    void save(event);
  });
  add.addEventListener('click', () => edit());
  refresh.addEventListener('click', () => {
    void load();
  });
  for (const id of ['venue-search', 'venue-region-filter', 'venue-active-filter'])
    get(id).addEventListener('input', renderList);
  input('venue-code').addEventListener('input', () => links(input('venue-code').value));
  void load();
}

const scriptJson = (value: string) =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');

export const renderVenueFieldsPage = (locale: AdminLocale = 'zh_TW', liffId = '') => {
  const content = `<style>
#venue-settings{font-size:1.25rem;line-height:1.65}#venue-settings input,#venue-settings select,#venue-settings button{font:inherit;min-height:48px;max-width:100%}#venue-settings label{display:block;margin:.6rem 0;font-size:inherit}#venue-settings h2,#venue-settings h3{font-size:1.3em}.sidebar :is(a,button,select,summary){min-height:48px}#venue-settings input:not([type=checkbox]),#venue-settings select{display:block;width:100%}#venue-settings input[type=checkbox]{width:48px;vertical-align:middle}#venue-settings fieldset{min-width:0}#venue-settings [data-error=true]{color:#8c240f;font-weight:bold}#venue-settings p{overflow-wrap:anywhere}#venue-settings :focus-visible{outline:3px solid #ad5100;outline-offset:3px}
</style><section id="venue-settings" lang="zh-Hant"><h2>場地設定</h2>
<p>團練場出席管理：此介面不代表後端已接通。NFC 預設關閉，安全隔離及逐區授權尚未完成時不能讀寫；也不會新增日課或處理學員原始 GPS。</p>
<p id="venue-status" role="status" aria-live="polite">正在檢查場地管理權限…</p>
<button id="venue-refresh" type="button">重新載入</button> <button id="venue-add" type="button" disabled>新增場地</button>
<section class="card" aria-label="場地列表篩選"><label>搜尋代碼／名稱<input id="venue-search" type="search"></label><label>Region UUID 篩選<input id="venue-region-filter"></label><label>啟停篩選<select id="venue-active-filter"><option value="">全部</option><option value="true">啟用</option><option value="false">停用</option></select></label></section>
<div id="venue-list" aria-live="polite"></div>
<form id="venue-form" class="card"><fieldset id="venue-editor" disabled><legend id="venue-editor-title">新增場地</legend>
<label>Venue 代碼（如 tw-tpe-daan）<input id="venue-code" required minlength="2" maxlength="50" pattern="[A-Za-z0-9_-]+" autocomplete="off"></label>
<p>入口預覽使用小寫連字號代碼。可保留舊代碼編輯設定，但格式不符時不產生網址；不自動轉換。改代碼後須重新燒錄 NFC／更新連結。</p>
<label>場地名稱<input id="venue-name_zh_tw" required maxlength="100"></label><label>英文名稱（選填）<input id="venue-name_en" maxlength="100"></label>
<label>Region UUID<input id="venue-region_id" required pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" aria-describedby="venue-region-help"></label>
<p id="venue-region-help">目前沒有已授權的 region 選項 API；請填已核准區域 UUID。輸入 UUID 不會授予跨區權限。</p>
<label>中心緯度<input id="venue-latitude" type="number" required min="-90" max="90" step="any"></label><label>中心經度<input id="venue-longitude" type="number" required min="-180" max="180" step="any"></label>
<label>Radius 半徑（公尺）<input id="venue-radius_meters" type="number" required min="5" max="5000" step="1" value="50"></label>
<fieldset><legend>每週時段（0=週日，不支援跨夜）</legend>${['週日', '週一', '週二', '週三', '週四', '週五', '週六'].map((label, day) => `<label><input id="venue-day-${day}" type="checkbox"${day === 0 || day === 6 ? ' checked' : ''}>${label}</label>`).join('')}<label>開始時間<input id="venue-start" type="time" required value="06:30"></label><label>結束時間<input id="venue-end" type="time" required value="09:00"></label></fieldset>
<p>時區由後端既有契約決定；本 UI 未定義新的 timezone，不可用來推論可簽到時間。</p>
<label><input id="venue-is_active" type="checkbox" checked>啟用場地</label><button type="submit">儲存場地</button></fieldset></form>
<section class="card" aria-label="入口網址"><h2>NFC／QR／Link</h2><div id="venue-links"><p>選擇場地後提供入口預覽網址；未生成 QR 圖片。</p></div></section></section>`;
  return renderAdminShell(
    'fieldSchedule',
    content,
    `const venueEntryUrl=${venueEntryUrl.toString()};\n(${venueFieldsController.toString()})(${scriptJson(liffId)});`,
    locale,
    false,
    false
  );
};
