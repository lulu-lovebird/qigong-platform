import {
  venueManualConfirmationSchema,
  venueManualCsrfToken,
  venueManualDraftSchema,
  venueManualLookupSchema,
  venueManualOutcomeSchema,
  venueManualRecordsSchema,
  venueManualRequestSchema,
  venueManualSearchSchema,
  venueManualSelectionSchema,
  venueManualServerModelSchema,
  venueManualVoidDraftSchema
} from './venue-manual-contract.js';
import type {
  TrustedVenueManualAdapter,
  VenueManualLearner,
  VenueManualRecord,
  VenueManualRequest,
  VenueManualSelection
} from './venue-manual-contract.js';

export interface VenueManualOptions {
  /** Must originate in the server composition root, not request/query/localStorage capability flags. */
  readonly serverModel?: unknown;
  readonly transport?: TrustedVenueManualAdapter;
  readonly readCookie?: () => string;
  readonly newIdempotencyKey?: () => string;
}

type Phase = 'edit' | 'review' | 'submitting' | 'applied' | 'blocked';
const escape = (value: string | number): string =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  );
const sameSelection = (a: VenueManualSelection, b: VenueManualSelection) =>
  a.learnerId === b.learnerId && a.venueId === b.venueId && a.attendanceDate === b.attendanceDate;
const unavailable = '未接線：團練場出席管理尚未開放，查詢與操作均需受信任後端 adapter。';
const denied = '權限不足或登入已失效；請重新登入，原操作不會自動重送。';

/** No imports with side effects, default fetch, routes, storage, learner creation or daily-practice writes. */
export const createVenueManualController = (options: VenueManualOptions = {}) => {
  const parsedModel = venueManualServerModelSchema.safeParse(options.serverModel);
  const model = parsedModel.success ? parsedModel.data : null;
  const adapter =
    options.transport?.kind === 'trusted-venue-manual-adapter' &&
    typeof options.transport.searchLearners === 'function' &&
    typeof options.transport.readRecords === 'function' &&
    typeof options.transport.operate === 'function'
      ? options.transport
      : null;
  let available = model !== null && adapter !== null;
  let phase: Phase = 'edit';
  let busy = false;
  let message = available
    ? '受信任 adapter 已注入；前端 capability 僅控制顯示，不構成授權。'
    : unavailable;
  let learners: VenueManualLearner[] = [];
  let records: VenueManualRecord[] = [];
  let selection: VenueManualSelection | null = null;
  let pending: VenueManualRequest | null = null;
  let draftReason = '';
  const listeners = new Set<() => void>();
  const usedKeys = new Set<string>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const fail = (text: string) => {
    message = text;
    notify();
    return false;
  };
  const canEdit = () => available && !busy && phase === 'edit';
  const canLookup = () =>
    canEdit() &&
    model?.capabilities.canSearchLearners === true &&
    model.capabilities.canReadRecords === true;
  const validSelection = (value: VenueManualSelection) =>
    model !== null &&
    learners.some((learner) => learner.id === value.learnerId) &&
    model.venues.some((venue) => venue.id === value.venueId) &&
    value.attendanceDate >= model.minDate &&
    value.attendanceDate <= model.maxDate;

  const searchLearners = async (raw: unknown): Promise<boolean> => {
    if (!canLookup() || !adapter) return false;
    const query = venueManualSearchSchema.safeParse(raw);
    if (!query.success) return fail('請輸入 2–80 字的學員搜尋條件；必須明確選擇既有學員。');
    // Invalidate prior selections immediately, including when the new search fails.
    learners = [];
    selection = null;
    pending = null;
    draftReason = '';
    busy = true;
    message = '搜尋中…';
    notify();
    try {
      const result = venueManualLookupSchema.safeParse(await adapter.searchLearners(query.data));
      if (!result.success) return fail('查詢不可用；沒有選取任何學員。');
      learners = result.data.learners;
      message = learners.length
        ? '請核對地區與學員 ID，明確選擇既有學員；不依姓名自動歸戶。'
        : '找不到既有學員；本模組不建立或自動歸戶。';
      return true;
    } catch {
      message = '查詢不可用；沒有選取任何學員。';
      return false;
    } finally {
      busy = false;
      notify();
    }
  };

  const readRecords = async (raw: unknown): Promise<boolean> => {
    if (!canLookup() || !adapter) return false;
    const parsed = venueManualSelectionSchema.safeParse(raw);
    selection = null;
    draftReason = '';
    if (!parsed.success || !validSelection(parsed.data))
      return fail('請選擇搜尋結果中的學員、可用場地與允許日期。');
    busy = true;
    message = '核對既有紀錄中…';
    notify();
    try {
      const result = venueManualRecordsSchema.safeParse(await adapter.readRecords(parsed.data));
      if (
        !result.success ||
        result.data.records.some((record) => !sameSelection(record, parsed.data))
      )
        return fail('紀錄查詢不可用；不得補簽或作廢。');
      const merged = new Map(records.map((record) => [record.id, record]));
      for (const record of result.data.records) merged.set(record.id, record);
      records = [...merged.values()];
      selection = parsed.data;
      message = '已核對選擇。補簽或作廢前須填寫原因並進入確認頁；後端仍須重新授權與檢查版本。';
      return true;
    } catch {
      message = '紀錄查詢不可用；不得補簽或作廢。';
      return false;
    } finally {
      busy = false;
      notify();
    }
  };

  const prepare = (raw: unknown, operation: 'manual' | 'void'): boolean => {
    if (!canEdit() || !selection || !model) return false;
    if (
      (operation === 'manual' && !model.capabilities.canManual) ||
      (operation === 'void' && !model.capabilities.canVoid)
    )
      return false;
    const parsed =
      operation === 'manual'
        ? venueManualDraftSchema.safeParse(raw)
        : venueManualVoidDraftSchema.safeParse(raw);
    if (!parsed.success)
      return fail('表單無效：原因必填且最多 1000 字；識別碼、日期及版本須正確。');
    const data = parsed.data;
    const selected = selection;
    if ('learnerId' in data) {
      if (!validSelection(data) || !sameSelection(data, selected))
        return fail('選擇已變更；請重新核對紀錄。');
      if (records.some((record) => sameSelection(record, data)))
        return fail('同人同場同日已有紀錄（含作廢歷史），不可重複補簽；同日跨場允許。');
    } else if (
      !records.some(
        (record) =>
          record.id === data.recordId &&
          record.version === data.expectedVersion &&
          record.status === 'active' &&
          sameSelection(record, selected)
      )
    )
      return fail('作廢須使用剛核對的有效紀錄與原版本；請重新查詢。');
    let idempotencyKey: string;
    try {
      idempotencyKey = (options.newIdempotencyKey ?? (() => crypto.randomUUID()))();
    } catch {
      return fail('無法建立操作識別碼；未送出。');
    }
    const request = venueManualRequestSchema.safeParse({ ...data, operation, idempotencyKey });
    if (!request.success || usedKeys.has(idempotencyKey))
      return fail('無法建立唯一操作識別碼；未送出。');
    usedKeys.add(idempotencyKey);
    pending = Object.freeze(request.data);
    draftReason = parsed.data.reason;
    phase = 'review';
    message = '確認頁：請逐項核對。此步尚未寫入。';
    notify();
    return true;
  };

  const confirm = async (raw: unknown): Promise<boolean> => {
    if (!available || busy || phase !== 'review' || !pending || !adapter || !model) return false;
    const confirmation = venueManualConfirmationSchema.safeParse(raw);
    if (
      !confirmation.success ||
      (pending.operation === 'void' && !confirmation.data.secondConfirmed)
    )
      return fail('請完成確認；作廢另外需要二次確認，歷史不會刪除。');
    const request = pending;
    if (
      (request.operation === 'manual' && !model.capabilities.canManual) ||
      (request.operation === 'void' && !model.capabilities.canVoid)
    )
      return fail(denied);
    let csrf: string | null;
    try {
      csrf = venueManualCsrfToken((options.readCookie ?? (() => ''))());
    } catch {
      return fail('無法讀取 CSRF token；未送出，請重新登入。');
    }
    if (!csrf) return fail('缺少有效 CSRF token；未送出，請重新登入。');
    busy = true;
    phase = 'submitting';
    message = '送出中，請勿重複操作。';
    notify();
    try {
      const result = venueManualOutcomeSchema.safeParse(
        await adapter.operate(request, {
          credentials: 'same-origin',
          headers: { 'x-csrf-token': csrf }
        })
      );
      if (!result.success) throw new Error('Unverifiable outcome');
      const outcome = result.data;
      if (outcome.status === 'rejected') {
        phase = 'blocked';
        if (outcome.code === 'unauthenticated' || outcome.code === 'forbidden') {
          available = false;
          learners = [];
          records = [];
          selection = null;
          pending = null;
          draftReason = '';
          message = denied;
        } else
          message =
            outcome.code === 'conflict'
              ? '紀錄重複或版本已變更；未確認成功，請重新查詢。'
              : '操作遭拒或服務不可用；未確認成功，請重新查詢，不會自動重送。';
        return false;
      }
      const record = outcome.record;
      if (
        outcome.operation !== request.operation ||
        outcome.idempotencyKey !== request.idempotencyKey ||
        (request.operation === 'manual'
          ? !sameSelection(record, request) ||
            record.status !== 'active' ||
            records.some((item) => item.id === record.id) ||
            record.attendanceTimezone !==
              model.venues.find((venue) => venue.id === request.venueId)?.timezone
          : record.id !== request.recordId ||
            record.version !== request.expectedVersion + 1 ||
            record.status !== 'voided' ||
            !selection ||
            !sameSelection(record, selection) ||
            record.attendanceTimezone !==
              records.find((item) => item.id === request.recordId)?.attendanceTimezone)
      )
        throw new Error('Mismatched receipt');
      records = [...records.filter((item) => item.id !== record.id), record];
      phase = 'applied';
      message =
        request.operation === 'manual'
          ? '後端已確認補簽。只影響團練場出席，不修改日課。'
          : '後端已確認作廢。原紀錄與稽核歷史保留，不修改日課。';
      pending = null;
      draftReason = '';
      return true;
    } catch {
      phase = 'blocked';
      message = '結果不明：尚未確認成功。保留操作識別碼，請由受信任後端查核；禁止自動或盲目重送。';
      return false;
    } finally {
      busy = false;
      notify();
    }
  };

  const render = (): string => {
    const selected = selection;
    const disabled = !canEdit() ? ' disabled' : '';
    const lookupDisabled = !canLookup() ? ' disabled' : '';
    const chosenLearner = learners.find((learner) => learner.id === selection?.learnerId);
    const chosenVenue = model?.venues.find((venue) => venue.id === selection?.venueId);
    const reviewRequest = pending;
    const reviewTimezone =
      reviewRequest?.operation === 'void'
        ? records.find((record) => record.id === reviewRequest.recordId)?.attendanceTimezone
        : chosenVenue?.timezone;
    const summary =
      selection && chosenLearner && chosenVenue
        ? `<dl><dt>學員</dt><dd>${escape(chosenLearner.displayName)} · ${escape(chosenLearner.regionLabel)} · ${escape(chosenLearner.id)}</dd><dt>場地</dt><dd>${escape(chosenVenue.displayName)} · ${escape(chosenVenue.id)}</dd><dt>場地當地日期／時區</dt><dd>${escape(selection.attendanceDate)} · ${escape(reviewTimezone ?? chosenVenue.timezone)}</dd></dl>`
        : '';
    const selectionFields = `<label>既有學員（先搜尋，再明確選擇）<select name="learnerId" id="vm-learner" required><option value="">請選擇</option>${learners.map((learner) => `<option value="${escape(learner.id)}"${selection?.learnerId === learner.id ? ' selected' : ''}>${escape(learner.displayName)} · ${escape(learner.regionLabel)} · ${escape(learner.id)}</option>`).join('')}</select></label><label>場地<select name="venueId" required><option value="">請選擇</option>${(model?.venues ?? []).map((venue) => `<option value="${escape(venue.id)}"${selection?.venueId === venue.id ? ' selected' : ''}>${escape(venue.displayName)} · ${escape(venue.timezone)}</option>`).join('')}</select></label><label>場地當地出席日期<input name="attendanceDate" type="date" min="${escape(model?.minDate ?? '')}" max="${escape(model?.maxDate ?? '')}" value="${escape(selection?.attendanceDate ?? '')}" required></label>`;
    const reasonField = `<label>原因（必填，勿填私人資訊）<textarea name="reason" required maxlength="1000">${escape(draftReason)}</textarea></label>`;
    const review =
      pending && (phase === 'review' || phase === 'submitting' || phase === 'blocked')
        ? `<section aria-labelledby="vm-review-title"><h2 id="vm-review-title" tabindex="-1">${pending.operation === 'manual' ? '人工補簽確認頁' : '作廢確認頁'}</h2>${summary}<p>操作：${pending.operation === 'manual' ? '人工補簽' : '作廢（不刪歷史）'}</p>${pending.operation === 'void' ? `<p>紀錄 ${escape(pending.recordId)} ／原版本 ${pending.expectedVersion}</p>` : ''}<p>原因：${escape(pending.reason)}</p><p>操作識別碼：${escape(pending.idempotencyKey)}</p><form id="vm-confirm"><fieldset${phase !== 'review' || busy ? ' disabled' : ''}><label class="check"><input name="confirmed" type="checkbox" required>我已核對學員、場地、當地日期與原因</label>${pending.operation === 'void' ? '<label class="check"><input name="secondConfirmed" type="checkbox" required>二次確認：我要作廢此原版本，保留歷史</label>' : ''}<button type="submit">${pending.operation === 'manual' ? '確認補簽' : '二次確認作廢'}</button></fieldset></form><form id="vm-back"><button type="submit"${phase !== 'review' || busy ? ' disabled' : ''}>返回修改（未送出）</button></form></section>`
        : '';
    return `<h1>團練場出席管理</h1><p id="vm-status" role="status" aria-live="polite" tabindex="-1">${escape(message)}</p><p>查詢與操作端點尚未安全接通；此獨立模組未掛載。前端 capability 不是授權。</p><p>同人同場同日一次，同日跨場允許。作廢不刪歷史；不得修改日課。</p>${
      phase === 'edit'
        ? `<form id="vm-search"><fieldset${lookupDisabled}><legend>搜尋既有學員</legend><label>搜尋條件<input name="query" minlength="2" maxlength="80" required autocomplete="off"></label><button type="submit">搜尋學員</button></fieldset></form><form id="vm-records"><fieldset${lookupDisabled}><legend>選擇並核對紀錄</legend>${selectionFields}<button type="submit">核對既有紀錄</button></fieldset></form>${summary}${
            selection
              ? `<form id="vm-manual"><fieldset${disabled || !model?.capabilities.canManual ? ' disabled' : ''}><legend>人工補簽</legend>${reasonField}<button type="submit">進入補簽確認頁</button></fieldset></form><h2>既有紀錄（包含作廢歷史）</h2>${records
                  .filter((record) => selected !== null && sameSelection(record, selected))
                  .map(
                    (record) =>
                      `<article><p>紀錄 ${escape(record.id)} ／版本 ${record.version} ／${escape(record.attendanceDate)} · ${escape(record.attendanceTimezone)} ／${record.status === 'active' ? '有效' : '已作廢（歷史保留）'}</p>${record.status === 'active' ? `<form id="vm-void-${escape(record.id)}" data-void-form><fieldset${disabled || !model?.capabilities.canVoid ? ' disabled' : ''}><legend>作廢既有紀錄</legend><input name="recordId" type="hidden" value="${escape(record.id)}"><input name="expectedVersion" type="hidden" value="${record.version}">${reasonField}<button type="submit">進入作廢確認頁</button></fieldset></form>` : ''}</article>`
                  )
                  .join('')}`
              : ''
          }`
        : ''
    }${review}${phase === 'applied' ? `<form id="vm-next"><button type="submit">選擇下一筆（重新核對）</button></form>` : ''}`;
  };

  return {
    searchLearners,
    readRecords,
    prepareManual: (raw: unknown) => prepare(raw, 'manual'),
    prepareVoid: (raw: unknown) => prepare(raw, 'void'),
    confirm,
    back: () => {
      if (busy || phase !== 'review') return false;
      pending = null;
      phase = 'edit';
      message = '已返回修改；尚未送出。';
      notify();
      return true;
    },
    next: () => {
      if (busy || phase !== 'applied') return false;
      selection = null;
      phase = 'edit';
      message = '請重新選擇並核對紀錄。';
      notify();
      return true;
    },
    render,
    state: () =>
      structuredClone({ phase, busy, available, message, selection, pending, learners, records }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
};

export type VenueManualController = ReturnType<typeof createVenueManualController>;

/** No inline scripts or event attributes. Static CSS is hash-authorized, not unsafe-inline. */
export const venueManualContentSecurityPolicy =
  "default-src 'none'; script-src 'self'; style-src 'sha256-jwVfB/sFUDZdpvmWFn7iOjx7W/lS9Etj5kpBmuYh3II='; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const styles =
  'body{font:1.125rem/1.6 system-ui;margin:auto;padding:1rem;max-width:58rem}button,input,select,textarea{font:inherit;max-width:100%;box-sizing:border-box;min-height:48px}button{padding:.6rem 1rem;margin:.5rem 0}label{display:grid;gap:.4rem;margin:.8rem 0}input,textarea,select{width:100%}.check{display:flex;align-items:center}.check input{width:auto;min-width:24px}fieldset{min-width:0;margin:1rem 0}dd,p,option{overflow-wrap:anywhere}dd{margin-inline-start:1rem}textarea{min-height:7rem}:focus-visible{outline:3px solid #305888;outline-offset:3px}footer{margin-top:2rem}';
// Keep these bytes synchronized with the CSP hash; the UI test checks the exact digest.
export const venueManualStyles = styles;
export const renderAdminVenueManualPage = (options: VenueManualOptions = {}): string =>
  `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>團練場出席管理</title><style>${venueManualStyles}</style></head><body><a href="#venue-manual">跳至團練場出席管理</a><main id="venue-manual">${createVenueManualController(options).render()}</main><noscript>未接線，且未載入受信任控制器；不能提交。</noscript><footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer></body></html>`;

/** Bind from a reviewed external module only; no global adapter discovery. Unmount removes all listeners. */
export const mountVenueManualPage = (
  root: HTMLElement,
  controller: VenueManualController
): (() => void) => {
  const paint = () => {
    root.innerHTML = controller.render(); // Every dynamic value is escaped by the renderer.
    root
      .querySelector<HTMLElement>(
        controller.state().phase === 'review' ? '#vm-review-title' : '#vm-status'
      )
      ?.focus();
  };
  const submit = (event: SubmitEvent) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !root.contains(form)) return;
    event.preventDefault();
    const fields = new FormData(form);
    const selection = () => ({
      learnerId: fields.get('learnerId'),
      venueId: fields.get('venueId'),
      attendanceDate: fields.get('attendanceDate')
    });
    switch (form.id) {
      case 'vm-search':
        void controller.searchLearners({ query: fields.get('query') });
        break;
      case 'vm-records':
        void controller.readRecords(selection());
        break;
      case 'vm-manual': {
        const selected = controller.state().selection;
        if (selected) controller.prepareManual({ ...selected, reason: fields.get('reason') });
        break;
      }
      case 'vm-confirm':
        void controller.confirm({
          confirmed: fields.get('confirmed') === 'on',
          secondConfirmed: fields.get('secondConfirmed') === 'on'
        });
        break;
      case 'vm-back':
        controller.back();
        break;
      case 'vm-next':
        controller.next();
        break;
      default:
        if (form.hasAttribute('data-void-form'))
          controller.prepareVoid({
            recordId: fields.get('recordId'),
            expectedVersion: Number(fields.get('expectedVersion')),
            reason: fields.get('reason')
          });
    }
  };
  root.addEventListener('submit', submit);
  const unsubscribe = controller.subscribe(paint);
  paint();
  return () => {
    root.removeEventListener('submit', submit);
    unsubscribe();
    root.replaceChildren();
  };
};
