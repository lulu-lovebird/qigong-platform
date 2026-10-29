/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { renderAdminShell } from './admin-dashboard.js';
import type { AdminLocale } from './admin-locale.js';
import type { VenueManagementRegion } from './venue-admin-capabilities.js';
import type { VenueManagementRow, VenueManagementField } from './venue-management.js';
import type { VenueQrImage } from './venue-management-qr.js';
type LinkedVenue = VenueManagementRow & { urls: Record<'nfc' | 'qr' | 'link', string> };

// Compiled before serialization. Never insert API text with innerHTML.
function venueManagementController(locale: AdminLocale) {
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
  let regions: VenueManagementRegion[] = [];
  let directoryReady = false;
  let directoryBusy = false;
  let sessionExpired = false;
  let editorOpen = false;
  let busy = false;
  let listBusy = false;
  let listGeneration = 0;
  const manages = (id: string) => directoryReady && regions.some((r) => r.id === id && r.canManage);
  const anyManage = () => directoryReady && regions.some((r) => r.canManage);
  const editable = () => (selected ? manages(selected.region_id) : anyManage());
  const writable = () => editable() && manages(value('vm-region_id'));
  let rows: LinkedVenue[] = [];
  let loaded = false;
  let loadedRegion = '';
  let requiresReload = false;
  let qrSequence = 0;
  let qrBusy = false;
  let qrReady: { key: string; image: HTMLImageElement; data: VenueQrImage } | null = null;
  const qrKey = (venue: LinkedVenue) =>
    JSON.stringify([venue.region_id, venue.id, venue.version, venue.code, venue.urls.qr]);
  const canQr = () =>
    !!selected &&
    directoryReady &&
    !directoryBusy &&
    !sessionExpired &&
    !requiresReload &&
    !busy &&
    !listBusy &&
    regions.some((r) => r.id === selected?.region_id && r.canRead);
  const matchingQr = () =>
    canQr() &&
    !!selected &&
    !!qrReady &&
    qrReady.key === qrKey(selected) &&
    qrReady.image.complete &&
    qrReady.image.naturalWidth > 0;
  function qrControls() {
    get<HTMLButtonElement>('vm-qr').disabled = !canQr() || qrBusy;
    get<HTMLButtonElement>('vm-download').disabled = !matchingQr();
    get<HTMLButtonElement>('vm-print').disabled = !matchingQr();
  }
  function clearQr() {
    ++qrSequence;
    qrBusy = false;
    qrReady = null;
    get('vm-sign').replaceChildren();
    get('vm-sign').hidden = true;
    get('vm-qr-status').textContent = '尚未產生並載入 QR 圖片。';
    qrControls();
  }
  function editorState() {
    const locked = busy || directoryBusy || requiresReload || sessionExpired || !directoryReady;
    editor.disabled = locked || !editorOpen;
    get<HTMLButtonElement>('vm-add').disabled = locked || !anyManage();
    get<HTMLButtonElement>('vm-load').disabled =
      busy || directoryBusy || listBusy || sessionExpired || !directoryReady;
    get<HTMLButtonElement>('vm-regions-retry').disabled = busy || directoryBusy;
    get<HTMLSelectElement>('vm-region').disabled =
      busy || directoryBusy || sessionExpired || !directoryReady;
    get<HTMLSelectElement>('vm-region_id').disabled = locked || !editable();
    for (const key of [
      'code',
      'name_zh_tw',
      'name_en',
      'address',
      'latitude',
      'longitude',
      'radius_meters',
      'timezone',
      'start',
      'end',
      'reason'
    ])
      get<HTMLInputElement>('vm-' + key).readOnly = !editable() || (key === 'code' && !!selected);
    for (const key of ['active', ...Array.from({ length: 7 }, (_, day) => 'day-' + day)])
      get<HTMLInputElement>('vm-' + key).disabled = locked || !editable();
    get<HTMLButtonElement>('vm-save').disabled = locked || !writable();
    qrControls();
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
      // QR owns its sequence-scoped cleanup and status; stale failures must not reset a newer QR.
      if (action !== 'qr') clearQr();
      if (action === 'update' && response.status === 409) requiresReload = true;
      if (response.status === 401) {
        sessionExpired = true;
        directoryReady = false;
      }
      if (['create', 'update'].includes(action) && [403, 404, 503].includes(response.status)) {
        requiresReload = true;
        if (response.status === 403) directoryReady = false;
      }
      editorState();
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
    clearQr();
    links.replaceChildren();
    if (!venue) return;
    for (const [key, label] of [
      ['nfc', 'NFC 燒錄網址'],
      ['qr', 'QR 目標網址'],
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
  function board(venue: LinkedVenue, image: HTMLImageElement) {
    const rules = venue.active_time_rules;
    const weekday = (day: number) => '週' + '日一二三四五六'[day];
    const minutes =
      Number(rules.start_time.slice(0, 2)) * 60 + Number(rules.start_time.slice(3)) - 30;
    const clock = (total: number) =>
      String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
    const checkin = rules.day_of_week
      .map((day) =>
        minutes < 0
          ? '前一天' +
            weekday((day + 6) % 7) +
            ' ' +
            clock(minutes + 1440) +
            '–' +
            weekday(day) +
            ' ' +
            rules.end_time
          : weekday(day) + ' ' + clock(minutes) + '–' + rules.end_time
      )
      .join('、');
    const signboard = get('vm-sign');
    signboard.replaceChildren(
      node('h2', locale === 'en' ? (venue.name_en ?? venue.name_zh_tw) : venue.name_zh_tw),
      node('p', venue.code + '｜' + venue.timezone),
      node(
        'p',
        venue.is_active ? '場地已啟用；仍須符合簽到條件' : '場地已停用：此 QR 網址不能簽到'
      ),
      node(
        'p',
        '團練：' +
          rules.day_of_week.map(weekday).join('、') +
          ' ' +
          rules.start_time +
          '–' +
          rules.end_time
      ),
      node('p', '可打卡（提前 30 分鐘）：' + checkin),
      node('p', '簽到半徑：' + venue.radius_meters + ' m'),
      image,
      node('p', venue.urls.qr),
      node('p', '掃描後請點 LINE 繼續；仍須登入與現場定位驗證。source 可轉傳，不是出席證明。'),
      node('p', 'Developed with ❤️ by Bean, Bird & Badminton Tech Consulting')
    );
    signboard.hidden = false;
  }
  async function generateQr() {
    if (!canQr() || !selected || qrBusy) return;
    const venue = selected;
    clearQr();
    const sequence = qrSequence;
    const key = qrKey(venue);
    const current = () =>
      sequence === qrSequence && !!selected && qrKey(selected) === key && canQr();
    qrBusy = true;
    qrControls();
    get('vm-qr-status').textContent = '重新驗證讀取權限並產生 QR 圖片中…';
    try {
      const data = (await api('qr', {
        regionId: venue.region_id,
        id: venue.id
      })) as Partial<VenueQrImage> & { field?: unknown };
      if (!current()) return;
      if (
        !row(data?.field) ||
        qrKey(data.field) !== key ||
        data.target !== venue.urls.qr ||
        data.filename !== 'venue-' + venue.code + '-qr.png' ||
        typeof data.pngDataUrl !== 'string' ||
        data.pngDataUrl.length > 200000 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.pngDataUrl)
      )
        throw new Error('QR 回應與已儲存場地不符，請重新載入。');
      const imageData: VenueQrImage = {
        target: data.target,
        filename: data.filename,
        pngDataUrl: data.pngDataUrl
      };
      const image = document.createElement('img');
      image.alt = '場地簽到 QR：' + venue.code;
      image.width = 768;
      image.height = 768;
      const loaded = new Promise<void>((resolve, reject) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => reject(new Error('QR 圖片載入失敗，請重試。')), {
          once: true
        });
      });
      image.src = imageData.pngDataUrl;
      get('vm-qr-status').textContent = 'QR 圖片載入與解碼中；尚不可下載／列印。';
      await loaded;
      if (typeof image.decode === 'function') await image.decode();
      if (!current()) return;
      if (!image.complete || image.naturalWidth < 1) throw new Error('QR 圖片解碼失敗。');
      qrReady = { key, image, data: imageData };
      board(data.field, image);
      get('vm-qr-status').textContent = 'QR 圖片已載入，可下載 PNG 或列印 A4 場地牌。';
    } catch (error) {
      if (sequence === qrSequence) {
        clearQr();
        get('vm-qr-status').textContent =
          'QR 未就緒：' + (error instanceof Error ? error.message : '請重試。');
      }
    } finally {
      if (sequence === qrSequence) {
        qrBusy = false;
        qrControls();
      }
    }
  }
  function options(
    id: string,
    choices: VenueManagementRegion[],
    preferred: string,
    placeholder: string
  ) {
    const select = get<HTMLSelectElement>(id);
    select.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = placeholder;
    select.append(blank);
    for (const region of choices) {
      const option = document.createElement('option');
      option.value = region.id;
      option.textContent =
        region.displayName + '｜' + region.countryName + '（' + region.code + '）';
      select.append(option);
    }
    select.value = choices.some((r) => r.id === preferred)
      ? preferred
      : choices.length === 1
        ? choices[0]!.id
        : '';
  }
  function targets(preferred: string) {
    const choices = regions.filter((r) => r.canManage || r.id === selected?.region_id);
    options('vm-region_id', choices, preferred, '請選擇可管理的目標地區');
  }
  function previewSchedule() {
    const start = value('vm-start');
    const end = value('vm-end');
    const zone = value('vm-timezone').trim();
    const days = Array.from({ length: 7 }, (_, day) => day).filter(
      (day) => get<HTMLInputElement>('vm-day-' + day).checked
    );
    const preview = get('vm-checkin-preview');
    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
      !/^(?:([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(end) ||
      start >= end ||
      !days.length ||
      !zone
    ) {
      preview.textContent = '可打卡：無法計算，請確認團練日、開始／結束時間與時區。';
      return;
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
    } catch {
      preview.textContent = '可打卡：無法計算，請確認時區。';
      return;
    }
    const minutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) - 30;
    const clock = (total: number) =>
      String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
    const weekday = (day: number) => '週' + '日一二三四五六'[day];
    preview.textContent =
      '可打卡：' +
      days
        .map((day) =>
          minutes < 0
            ? '前一天' +
              weekday((day + 6) % 7) +
              ' ' +
              clock(minutes + 1440) +
              '–' +
              weekday(day) +
              ' ' +
              end
            : weekday(day) + ' ' + clock(minutes) + '–' + end
        )
        .join('、') +
      '（' +
      zone +
      '）';
  }
  function edit(venue: LinkedVenue | null) {
    selected = venue;
    targets(venue?.region_id ?? (manages(value('vm-region')) ? value('vm-region') : ''));
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
      'timezone'
    ] as const)
      set(
        'vm-' + key,
        venue?.[key] ?? (key === 'radius_meters' ? 50 : key === 'timezone' ? 'Asia/Taipei' : '')
      );
    get<HTMLInputElement>('vm-code').readOnly = !editable() || !!venue;
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
    previewSchedule();
    sign(venue);
    editorState();
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
      button.textContent = manages(venue.region_id) ? '編輯／網址' : '檢視／網址';
      button.disabled =
        busy || directoryBusy || requiresReload || !directoryReady || sessionExpired;
      button.addEventListener('click', () => {
        if (!busy && !directoryBusy && !requiresReload && directoryReady && !sessionExpired) {
          editorOpen = true;
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
  async function init() {
    if (busy || directoryBusy) return;
    directoryBusy = true;
    directoryReady = false;
    clearQr();
    ++listGeneration;
    listBusy = false;
    editorState();
    say('載入已授權地區中…');
    try {
      const data = (await api('regions', { lang: locale })) as { regions?: unknown };
      const valid = (v: unknown): v is VenueManagementRegion => {
        if (!v || typeof v !== 'object') return false;
        const r = v as Partial<VenueManagementRegion>;
        return (
          typeof r.id === 'string' &&
          /^[0-9a-f-]{36}$/i.test(r.id) &&
          [r.displayName, r.countryName, r.code].every(
            (s) => typeof s === 'string' && s.length > 0
          ) &&
          typeof r.canRead === 'boolean' &&
          typeof r.canManage === 'boolean' &&
          (r.canRead || r.canManage)
        );
      };
      if (
        !Array.isArray(data?.regions) ||
        !data.regions.every(valid) ||
        new Set(data.regions.map((r) => r.id)).size !== data.regions.length
      )
        throw new Error('地區目錄回應無效，請重試或重新登入。');
      regions = data.regions;
      directoryReady = true;
      sessionExpired = false;
      options(
        'vm-region',
        regions.filter((r) => r.canRead),
        value('vm-region'),
        '請選擇查詢地區'
      );
      targets(value('vm-region_id'));
      say(
        !regions.length
          ? '目前沒有可用的授權地區，請聯絡管理員、重試或重新登入。'
          : anyManage()
            ? '已載入授權地區，可直接新增；不需先查詢場地。'
            : '唯讀：可查詢場地，但不能新增或修改。'
      );
    } catch (error) {
      say('地區目錄載入失敗：' + (error instanceof Error ? error.message : '請重試或重新登入。'));
    } finally {
      directoryBusy = false;
      editorState();
      renderList();
    }
  }
  async function load() {
    if (busy || directoryBusy || !directoryReady || sessionExpired) return;
    clearQr();
    const regionId = value('vm-region');
    if (!regions.some((r) => r.id === regionId && r.canRead)) {
      ++listGeneration;
      listBusy = false;
      rows = [];
      loaded = false;
      loadedRegion = '';
      renderList();
      editorState();
      say('請選擇查詢地區；仍可直接新增至有管理權限的地區。');
      return;
    }
    const generation = ++listGeneration;
    listBusy = true;
    rows = [];
    loaded = false;
    loadedRegion = regionId;
    renderList();
    editorState();
    say('重新驗證登入與查詢地區權限中…');
    try {
      const data = (await api('list', { regionId })) as { fields?: unknown };
      if (generation !== listGeneration) return;
      if (
        !Array.isArray(data?.fields) ||
        !data.fields.every(row) ||
        data.fields.some((r) => r.region_id !== regionId)
      )
        throw new Error('資料回應無效，停止查詢；可重試。');
      rows = data.fields;
      loaded = true;
      if (requiresReload) {
        requiresReload = false;
        editorOpen = false;
        edit(null);
      }
      say(
        manages(regionId)
          ? '可管理此地區。新增不需先查詢；更新採版本檢查。'
          : '此地區唯讀：不包含建立／修改。'
      );
    } catch (error) {
      if (generation === listGeneration)
        say('場地清單載入失敗：' + (error instanceof Error ? error.message : '請重試。'));
    } finally {
      if (generation === listGeneration) {
        listBusy = false;
        editorState();
        renderList();
      }
    }
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (
      !editorOpen ||
      !directoryReady ||
      directoryBusy ||
      sessionExpired ||
      !writable() ||
      busy ||
      requiresReload
    )
      return;
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
    clearQr();
    ++listGeneration;
    listBusy = false;
    editorState();
    say('驗證與儲存中…');
    try {
      const data = (await api(selected ? 'update' : 'create', {
        regionId: selected?.region_id ?? field.region_id,
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
      renderList();
    }
  }
  get('vm-load').addEventListener('click', () => {
    void load();
  });
  get('vm-add').addEventListener('click', () => {
    if (anyManage() && !busy && !directoryBusy && !sessionExpired && !requiresReload) {
      editorOpen = true;
      edit(null);
      get('vm-version').focus();
    }
  });
  get('vm-regions-retry').addEventListener('click', () => {
    void init();
  });
  get('vm-region').addEventListener('change', () => {
    if (busy || directoryBusy) return;
    if (editorOpen && !selected && manages(value('vm-region'))) {
      set('vm-region_id', value('vm-region'));
      editorState();
    }
    void load();
  });
  get('vm-region_id').addEventListener('change', () => {
    if (busy || directoryBusy) return;
    editorState();
    if (!selected && manages(value('vm-region_id'))) {
      set('vm-region', value('vm-region_id'));
      void load();
    }
  });
  for (const id of [
    'vm-start',
    'vm-end',
    'vm-timezone',
    ...Array.from({ length: 7 }, (_, day) => 'vm-day-' + day)
  ]) {
    get(id).addEventListener('input', previewSchedule);
    get(id).addEventListener('change', previewSchedule);
  }
  get('vm-search').addEventListener('input', () => {
    clearQr();
    renderList();
  });
  get('vm-filter').addEventListener('change', () => {
    clearQr();
    renderList();
  });
  get('vm-form').addEventListener('submit', (event) => {
    void save(event);
  });
  get('vm-qr').addEventListener('click', () => {
    void generateQr();
  });
  get('vm-download').addEventListener('click', () => {
    if (!matchingQr() || !qrReady) return;
    const download = document.createElement('a');
    download.href = qrReady.data.pngDataUrl;
    download.download = qrReady.data.filename;
    download.hidden = true;
    links.append(download);
    download.click();
    download.remove();
  });
  get('vm-print').addEventListener('click', () => {
    if (matchingQr()) window.print();
  });
  void init();
}

export const renderVenueManagementPage = (locale: AdminLocale = 'zh_TW'): string => {
  return renderAdminShell(
    'fieldSchedule',
    `<style>
#vm-root,#vm-root *{box-sizing:border-box}
#vm-root{display:flex;flex-direction:column;gap:1.25rem;min-width:0;min-inline-size:0;max-width:100%;overflow-wrap:anywhere;color:var(--brand-primary,#082850)}
#vm-root label{display:block;min-width:0;margin:0}
#vm-root fieldset,#vm-editor,.vm-editor-card{min-width:0;min-inline-size:0}
.vm-header{border-bottom:2px solid var(--border,#98C0D8);padding-bottom:.75rem}
.vm-header h1{font-size:1.35rem;line-height:1.3;margin:0 0 .5rem;color:var(--brand-deep,#002048);overflow-wrap:anywhere}
.vm-intro{margin:0;font-size:.875rem;color:var(--muted,#305888);line-height:1.5;overflow-wrap:anywhere}
.vm-card{background:var(--surface,#fff);border:1px solid var(--border,#98C0D8);border-radius:.5rem;padding:1.1rem;box-shadow:0 1px 3px rgba(8,40,80,.05);min-width:0;min-inline-size:0}
.vm-toolbar-card{display:flex;flex-direction:column;gap:.75rem}
.vm-toolbar-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:.75rem}
.vm-region-group{display:flex;flex-direction:column;gap:.35rem;min-width:0;min-inline-size:0}
.vm-btn-group{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.vm-btn{font:inherit;font-size:.875rem;font-weight:600;min-height:44px;padding:.5rem 1rem;border-radius:.375rem;border:1px solid transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:.35rem;white-space:nowrap;transition:background-color .15s ease,border-color .15s ease;box-sizing:border-box}
.vm-btn-primary{background:var(--brand-primary,#082850);color:#fff;border-color:var(--brand-deep,#002048)}
.vm-btn-primary:hover:not(:disabled){background:var(--brand-deep,#002048)}
.vm-btn-secondary{background:var(--surface,#fff);color:var(--brand-primary,#082850);border-color:var(--brand-secondary,#305888)}
.vm-btn-secondary:hover:not(:disabled){background:var(--surface-muted,#eef4f8)}
.vm-btn:disabled{opacity:.45;cursor:not-allowed}
.vm-btn:focus-visible{outline:3px solid var(--brand-secondary,#305888);outline-offset:2px}
.vm-status{min-height:1.5rem;margin:0;padding:.65rem .85rem;border-radius:.375rem;background:var(--surface-muted,#eef4f8);border-left:4px solid var(--brand-secondary,#305888);font-size:.875rem;line-height:1.45;overflow-wrap:anywhere}
.vm-status:empty{display:none}
.vm-workspace{display:grid;grid-template-columns:minmax(280px,340px) minmax(0,1fr);gap:1.25rem;align-items:start;min-width:0;min-inline-size:0}
.vm-list-panel{display:flex;flex-direction:column;gap:.75rem;min-width:0;min-inline-size:0}
.vm-panel-title{font-size:1.05rem;margin:0;color:var(--brand-deep,#002048);font-weight:700}
.vm-filter-bar{display:flex;flex-direction:column;gap:.5rem}
.vm-filter-group{display:flex;flex-direction:column;gap:.25rem;min-width:0}
.vm-list-container{display:flex;flex-direction:column;gap:.65rem;max-height:680px;overflow-y:auto;overscroll-behavior:contain;padding-right:.25rem;min-width:0}
.vm-list-container article{background:var(--surface,#fff);border:1px solid var(--border,#98C0D8);border-radius:.375rem;padding:.75rem .85rem;margin:0;display:flex;flex-direction:column;gap:.45rem;transition:border-color .15s ease,box-shadow .15s ease;min-width:0;overflow-wrap:anywhere}
.vm-list-container article:hover{border-color:var(--brand-secondary,#305888);box-shadow:0 2px 6px rgba(8,40,80,.08)}
.vm-list-container article h3{font-size:.95rem;margin:0;color:var(--brand-deep,#002048);overflow-wrap:anywhere}
.vm-list-container article p{font-size:.8125rem;color:var(--muted,#305888);margin:0;overflow-wrap:anywhere}
.vm-list-container article button{align-self:flex-start;min-height:38px;padding:.3rem .75rem;font-size:.8125rem;border-radius:.3rem;background:var(--surface-muted,#eef4f8);color:var(--brand-primary,#082850);border:1px solid var(--brand-secondary,#305888);font-weight:600;cursor:pointer}
.vm-list-container article button:hover:not(:disabled){background:var(--brand-secondary,#305888);color:#fff}
.vm-editor-panel{min-width:0;min-inline-size:0}
.vm-editor-card{border:1px solid var(--border,#98C0D8);border-radius:.5rem;padding:1.25rem;margin:0;background:var(--surface,#fff);min-width:0;min-inline-size:0}
.vm-editor-card:disabled{opacity:.7}
.vm-legend{font-size:1.1rem;font-weight:700;color:var(--brand-deep,#002048);padding:0 .5rem}
.vm-version-banner{background:var(--surface-muted,#eef4f8);border:1px solid var(--border,#98C0D8);border-radius:.375rem;padding:.65rem .85rem;margin:0 0 1rem;font-size:.875rem;font-weight:600;color:var(--brand-primary,#082850);outline:none;overflow-wrap:anywhere}
.vm-version-banner:focus-visible{outline:3px solid var(--brand-secondary,#305888);outline-offset:2px}
.vm-form-table{display:flex;flex-direction:column;gap:.85rem;margin-bottom:1.25rem;min-width:0;min-inline-size:0}
.vm-form-row{display:grid;grid-template-columns:180px minmax(0,1fr);gap:1rem;align-items:start;padding-bottom:.85rem;border-bottom:1px solid var(--surface-muted,#eef4f8);min-width:0;min-inline-size:0}
.vm-form-row:last-child{border-bottom:none;padding-bottom:0}
.vm-label-col{padding-top:.5rem;min-width:0;min-inline-size:0}
#vm-root .vm-field-label,#vm-root .vm-sublabel{display:inline-flex;flex-direction:row;align-items:baseline;flex-wrap:wrap;column-gap:.2rem;row-gap:0;font-weight:600;font-size:.875rem;color:var(--brand-deep,#002048);line-height:1.35;min-width:0}
#vm-root .vm-sublabel{font-size:.8125rem;font-weight:500;color:var(--brand-secondary,#305888)}
#vm-root .vm-field-hint{display:block;font-size:.75rem;color:var(--muted,#305888);margin-top:.2rem;line-height:1.3;overflow-wrap:anywhere}
#vm-root .vm-req{color:#c02020;font-weight:700;margin-left:.15rem;white-space:nowrap;display:inline-block}
#vm-root .vm-opt{font-size:.75rem;font-weight:400;color:var(--muted,#305888)}
.vm-control-col{display:flex;flex-direction:column;gap:.35rem;min-width:0;min-inline-size:0}
#vm-root .vm-input{width:100%;box-sizing:border-box;font:inherit;font-size:.875rem;min-height:44px;padding:.45rem .75rem;border:1px solid var(--brand-secondary,#305888);border-radius:.35rem;background:#fff;color:var(--brand-primary,#082850);max-width:100%}
#vm-root .vm-input:focus-visible,#vm-filter:focus-visible,.vm-checkbox:focus-visible{outline:3px solid var(--brand-secondary,#305888);outline-offset:2px}
#vm-root .vm-input[readonly]{background:var(--surface-muted,#eef4f8);border-color:var(--border,#98C0D8);color:var(--brand-primary,#082850);cursor:default}
#vm-root .vm-input:disabled{background:#f1f5f9;border-color:#cbd5e1;color:#64748b;cursor:not-allowed}
.vm-pair-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;min-width:0;min-inline-size:0}
.vm-subfield{display:flex;flex-direction:column;gap:.25rem;min-width:0;min-inline-size:0}
.vm-days-group{display:flex;flex-wrap:wrap;gap:.4rem;min-width:0}
.vm-day-pill{display:inline-flex;align-items:center;gap:.35rem;padding:.4rem .65rem;min-height:44px;background:var(--surface-muted,#eef4f8);border:1px solid var(--border,#98C0D8);border-radius:.35rem;cursor:pointer;font-size:.875rem;user-select:none;box-sizing:border-box}
.vm-day-pill:hover{border-color:var(--brand-secondary,#305888)}
.vm-day-pill:has(input:checked){background:#e0ecf6;border-color:var(--brand-secondary,#305888);font-weight:600}
.vm-checkbox{width:1.15rem;height:1.15rem;min-height:0;cursor:pointer;accent-color:var(--brand-primary,#082850);margin:0;flex-shrink:0}
.vm-toggle-label{display:inline-flex;align-items:center;gap:.5rem;min-height:44px;cursor:pointer;font-size:.875rem;font-weight:500;box-sizing:border-box}
.vm-form-actions{display:flex;justify-content:flex-end;padding-top:.75rem;border-top:1px solid var(--border,#98C0D8)}
.vm-btn-save{min-width:140px}
.vm-links-panel{display:flex;flex-direction:column;gap:.75rem;min-width:0;min-inline-size:0}
.vm-links-grid{display:flex;flex-direction:column;gap:.75rem;min-width:0;min-inline-size:0}
.vm-links-grid label{display:flex;flex-direction:column;gap:.35rem;font-weight:600;font-size:.875rem;min-width:0}
.vm-links-grid input{font:inherit;font-size:.875rem;min-height:44px;padding:.45rem .75rem;border:1px solid var(--border,#98C0D8);border-radius:.35rem;background:var(--surface-muted,#eef4f8);max-width:100%;box-sizing:border-box}
.vm-links-grid button{align-self:flex-start;min-height:44px;padding:.4rem .85rem;font-size:.8125rem;font-weight:600;background:var(--surface,#fff);color:var(--brand-primary,#082850);border:1px solid var(--brand-secondary,#305888);border-radius:.35rem;cursor:pointer;box-sizing:border-box}
.vm-links-grid button:hover{background:var(--surface-muted,#eef4f8)}
.vm-signboard{border:2px dashed var(--brand-secondary,#305888);border-radius:.5rem;padding:1.25rem;background:#fff;min-width:0;min-inline-size:0;overflow-wrap:anywhere}
.vm-signboard h2{font-size:1.2rem;margin:0 0 .5rem;color:var(--brand-deep,#002048);overflow-wrap:anywhere}
.vm-signboard p{margin:.35rem 0;font-size:.9rem;overflow-wrap:anywhere}
.vm-signboard img{display:block;width:min(100%,384px);height:auto;margin:1rem auto;background:#fff}
#vm-sign[hidden]{display:none!important}
@media(max-width:1024px){.vm-workspace{grid-template-columns:1fr}}
@media(max-width:768px){
.vm-toolbar-row{grid-template-columns:1fr;grid-auto-rows:min-content;align-items:stretch;gap:.75rem}
.vm-region-group{width:100%;min-height:0}
.vm-btn-group{display:flex;flex-direction:column;gap:.5rem;width:100%}
.vm-form-row{grid-template-columns:1fr;gap:.35rem;padding-bottom:.75rem}
.vm-label-col{padding-top:0}
.vm-pair-grid{grid-template-columns:1fr}
#vm-root .vm-btn{width:100%;min-height:48px;font-size:1rem}
#vm-root .vm-input,#vm-root #vm-filter{font-size:1rem;min-height:48px}
#vm-root .vm-day-pill{min-height:48px;flex:1 1 42%;justify-content:center}
#vm-root .vm-toggle-label{min-height:48px}
.vm-form-actions{justify-content:stretch}
#vm-root .vm-btn-save{width:100%}
.vm-links-grid button{width:100%;min-height:48px}
}
@page{size:A4 portrait;margin:12mm}
@media print{
body>*:not(.shell),.shell>*:not(.workspace),.workspace>*:not(#main),#main>*:not(#vm-root),#vm-root>*:not(.vm-links-panel),.vm-links-panel>*:not(#vm-sign){display:none!important}
html,body,.shell,.workspace,#main,#vm-root,.vm-links-panel{display:block!important;position:static!important;width:auto!important;max-width:none!important;min-width:0!important;min-height:0!important;height:auto!important;margin:0!important;padding:0!important;border:0!important;box-shadow:none!important;background:#fff!important;color:#000!important}
#vm-sign{break-inside:avoid;page-break-inside:avoid;width:100%;margin:0;padding:4mm;border:1px solid #000;border-radius:0;color:#000;background:#fff}
#vm-sign h2{font-size:24pt;line-height:1.2;color:#000;margin:0 0 3mm}
#vm-sign p{font-size:10pt;line-height:1.3;color:#000;margin:2mm 0;overflow-wrap:anywhere}
#vm-sign img{width:100mm;height:100mm;margin:3mm auto;max-width:100%;object-fit:contain}
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
        <label for="vm-region" class="vm-field-label">查詢地區<span class="vm-req" aria-hidden="true">*</span></label>
        <select id="vm-region" class="vm-input" aria-describedby="vm-status" disabled><option value="">載入授權地區中…</option></select>
      </div>
      <div class="vm-btn-group">
        <button id="vm-load" type="button" class="vm-btn vm-btn-primary" disabled>查詢／重新載入</button>
        <button id="vm-regions-retry" type="button" class="vm-btn vm-btn-secondary">重試授權地區</button>
        <a href="/admin/auth/login" class="vm-btn vm-btn-secondary">重新登入</a>
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
              <label for="vm-code" class="vm-field-label">永久唯一代碼<span class="vm-req" aria-hidden="true">*</span></label>
              <span class="vm-field-hint">如 tw-tpe-daan，建立後不可更改</span>
            </div>
            <div class="vm-control-col">
              <input id="vm-code" type="text" required class="vm-input" autocomplete="off" placeholder="例如 tw-tpe-daan">
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <label for="vm-name_zh_tw" class="vm-field-label">場地名稱（繁中）<span class="vm-req" aria-hidden="true">*</span></label>
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
              <label for="vm-region_id" class="vm-field-label">目標地區<span class="vm-req" aria-hidden="true">*</span></label>
              <span class="vm-field-hint">僅列出可管理地區；新增不需先查詢</span>
            </div>
            <div class="vm-control-col">
              <select id="vm-region_id" required class="vm-input" aria-describedby="vm-status"><option value="">請選擇可管理的目標地區</option></select>
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <span class="vm-field-label">中心座標 GPS<span class="vm-req" aria-hidden="true">*</span></span>
              <span class="vm-field-hint">WGS84 座標，打卡距離基準</span>
            </div>
            <div class="vm-control-col">
              <div class="vm-pair-grid">
                <div class="vm-subfield">
                  <label for="vm-latitude" class="vm-sublabel">中心緯度（-90～90）<span class="vm-req" aria-hidden="true">*</span></label>
                  <input id="vm-latitude" type="number" step="any" required class="vm-input" placeholder="例如 25.032969">
                </div>
                <div class="vm-subfield">
                  <label for="vm-longitude" class="vm-sublabel">中心經度（-180～180）<span class="vm-req" aria-hidden="true">*</span></label>
                  <input id="vm-longitude" type="number" step="any" required class="vm-input" placeholder="例如 121.534838">
                </div>
              </div>
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <span class="vm-field-label">半徑與時區<span class="vm-req" aria-hidden="true">*</span></span>
              <span class="vm-field-hint">簽到有效範圍與當地時區</span>
            </div>
            <div class="vm-control-col">
              <div class="vm-pair-grid">
                <div class="vm-subfield">
                  <label for="vm-radius_meters" class="vm-sublabel">半徑（1～5000 公尺）<span class="vm-req" aria-hidden="true">*</span></label>
                  <input id="vm-radius_meters" type="number" step="any" required class="vm-input" placeholder="50">
                </div>
                <div class="vm-subfield">
                  <label for="vm-timezone" class="vm-sublabel">IANA 時區<span class="vm-req" aria-hidden="true">*</span></label>
                  <input id="vm-timezone" type="text" required class="vm-input" placeholder="Asia/Taipei">
                </div>
              </div>
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <span class="vm-field-label">每週團練日<span class="vm-req" aria-hidden="true">*</span></span>
              <span class="vm-field-hint">以場地時區計算開團日</span>
            </div>
            <div class="vm-control-col">
              <div class="vm-days-group" role="group" aria-label="每週團練日選擇">
                ${['日', '一', '二', '三', '四', '五', '六'].map((label, day) => `<label class="vm-day-pill"><input id="vm-day-${day}" type="checkbox" class="vm-checkbox"><span>週${label}</span></label>`).join('')}
              </div>
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col">
              <span class="vm-field-label">團練時段<span class="vm-req" aria-hidden="true">*</span></span>
              <span class="vm-field-hint">保留團練原時間；當日結束可用 24:00，不支援一般跨夜團練</span>
            </div>
            <div class="vm-control-col">
              <div class="vm-pair-grid">
                <div class="vm-subfield">
                  <label for="vm-start" class="vm-sublabel">團練開始 HH:mm<span class="vm-req" aria-hidden="true">*</span></label>
                  <input id="vm-start" required pattern="([01][0-9]|2[0-3]):[0-5][0-9]" class="vm-input" placeholder="06:30">
                </div>
                <div class="vm-subfield">
                  <label for="vm-end" class="vm-sublabel">團練結束 HH:mm<span class="vm-req" aria-hidden="true">*</span></label>
                  <input id="vm-end" required pattern="(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)" class="vm-input" placeholder="09:00">
                </div>
              </div>
            </div>
          </div>

          <div class="vm-form-row">
            <div class="vm-label-col"><span class="vm-field-label">打卡時段（唯讀預覽）</span></div>
            <div class="vm-control-col">
              <p id="vm-checkin-preview" class="vm-intro" aria-live="polite">可打卡：請選擇場地或填入團練時段。</p>
              <p class="vm-field-hint">團練開始前30分鐘開放打卡，結束即停止。一般週例預覽；日光節約切換依資料庫實際時刻判定。出席日期仍為打卡當下的場地當地日期。</p>
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
              <label for="vm-reason" class="vm-field-label">設定異動原因<span class="vm-req" aria-hidden="true">*</span></label>
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
    <p class="vm-intro">選取已儲存場地後，重新驗證讀取權限並在本機服務產生 QR；不外送第三方。圖片載入後才可下載 PNG／列印 A4。掃描後仍須點 LINE 繼續登入與現場定位；source 可轉傳，不是出席證明。停用場地的 QR 牌會清楚標示不能簽到；產生圖片不會開啟任何簽到功能。</p>
    <div class="vm-btn-group">
      <button id="vm-qr" type="button" class="vm-btn vm-btn-secondary" disabled>產生選取場地 QR</button>
      <button id="vm-download" type="button" class="vm-btn vm-btn-secondary" disabled>下載 QR PNG</button>
      <button id="vm-print" type="button" class="vm-btn vm-btn-secondary" disabled>列印 A4 QR 場地牌</button>
    </div>
    <p id="vm-qr-status" role="status" aria-live="polite">尚未產生並載入 QR 圖片。</p>
    <div id="vm-links" class="vm-links-grid"></div>
    <section id="vm-sign" class="vm-signboard" hidden></section>
  </section>
</section>`,
    `(${venueManagementController.toString()})(${JSON.stringify(locale)});`,
    locale
  );
};
