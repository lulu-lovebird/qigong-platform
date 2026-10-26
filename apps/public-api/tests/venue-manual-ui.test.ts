import { createHash, randomBytes } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createVenueManualController,
  mountVenueManualPage,
  renderAdminVenueManualPage,
  venueManualContentSecurityPolicy,
  venueManualStyles
} from '../src/admin-venue-manual-page.js';
import {
  venueManualCsrfToken,
  venueManualDateSchema,
  venueManualDraftSchema,
  venueManualLookupSchema,
  venueManualOutcomeSchema,
  venueManualRequestSchema,
  venueManualServerModelSchema,
  venueManualVoidDraftSchema
} from '../src/venue-manual-contract.js';
import type {
  TrustedVenueManualAdapter,
  VenueManualRecord,
  VenueManualRequest,
  VenueManualServerModel
} from '../src/venue-manual-contract.js';

const csrfToken = randomBytes(32).toString('base64url');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const learnerId = uuid(1),
  venueId = uuid(2),
  otherVenue = uuid(3),
  recordId = uuid(4);
const selection = { learnerId, venueId, attendanceDate: '2026-10-25' };
const draft = { ...selection, reason: '  志工核對紙本簽到  ' };
const voidDraft = { recordId, expectedVersion: 3, reason: '重複登錄，核對後作廢' };
const confirmation = { confirmed: true, secondConfirmed: false };
const active: VenueManualRecord = {
  id: recordId,
  version: 3,
  ...selection,
  attendanceTimezone: 'Asia/Taipei',
  status: 'active'
};
const hostile = '</option><script>alert(1)</script><img src=x onerror="x">&\'"';
const learners = [
  { id: learnerId, displayName: hostile, regionLabel: '北區 <literal>' },
  { id: uuid(5), displayName: hostile, regionLabel: '南區' }
];
const serverModel: VenueManualServerModel = {
  capabilities: { canSearchLearners: true, canReadRecords: true, canManual: true, canVoid: true },
  venues: [
    { id: venueId, displayName: hostile, timezone: 'Asia/Taipei' },
    { id: otherVenue, displayName: '第二場地', timezone: 'America/Los_Angeles' }
  ],
  minDate: '2026-01-01',
  maxDate: '2026-12-31'
};

const fixture = (
  initialRecords: VenueManualRecord[] = [],
  model: unknown = serverModel,
  cookie = `__Host-qigong-admin-csrf=${csrfToken}`
) => {
  let key = 100;
  let recordNumber = 200;
  const stored = [...initialRecords];
  const searchLearners = vi.fn<TrustedVenueManualAdapter['searchLearners']>(async () => ({
    learners
  }));
  const readRecords = vi.fn<TrustedVenueManualAdapter['readRecords']>(async (value) => ({
    records: stored.filter(
      (row) =>
        row.learnerId === value.learnerId &&
        row.venueId === value.venueId &&
        row.attendanceDate === value.attendanceDate
    )
  }));
  const operate = vi.fn<TrustedVenueManualAdapter['operate']>(async (request) => {
    const record: VenueManualRecord =
      request.operation === 'manual'
        ? {
            id: uuid(recordNumber++),
            version: 1,
            learnerId: request.learnerId,
            venueId: request.venueId,
            attendanceDate: request.attendanceDate,
            attendanceTimezone: serverModel.venues.find((venue) => venue.id === request.venueId)!
              .timezone,
            status: 'active'
          }
        : {
            ...active,
            id: request.recordId,
            version: request.expectedVersion + 1,
            status: 'voided'
          };
    stored.splice(0, stored.length, ...stored.filter((item) => item.id !== record.id), record);
    return {
      status: 'applied',
      operation: request.operation,
      idempotencyKey: request.idempotencyKey,
      record
    };
  });
  const transport: TrustedVenueManualAdapter = {
    kind: 'trusted-venue-manual-adapter',
    searchLearners,
    readRecords,
    operate
  };
  const options = {
    serverModel: model,
    transport,
    readCookie: () => cookie,
    newIdempotencyKey: () => uuid(key++)
  };
  const controller = createVenueManualController(options);
  return { controller, transport, options, searchLearners, readRecords, operate };
};
const select = async (f: ReturnType<typeof fixture>, value = selection) => {
  expect(await f.controller.searchLearners({ query: '同名學員' })).toBe(true);
  expect(f.controller.state().selection).toBeNull();
  expect(await f.controller.readRecords(value)).toBe(true);
};
const prepareManual = async (f: ReturnType<typeof fixture>) => {
  await select(f);
  expect(f.controller.prepareManual(draft)).toBe(true);
};
const receipt = (request: VenueManualRequest, record: VenueManualRecord) => ({
  status: 'applied',
  operation: request.operation,
  idempotencyKey: request.idempotencyKey,
  record
});
afterEach(() => vi.unstubAllGlobals());

describe('strict 團練場出席管理 contracts', () => {
  it('accepts only exact manual/void requests, with trimmed mandatory reasons and no claimed actor', () => {
    expect(
      venueManualRequestSchema.parse({ ...draft, operation: 'manual', idempotencyKey: uuid(10) })
        .reason
    ).toBe('志工核對紙本簽到');
    expect(
      venueManualRequestSchema.safeParse({
        ...voidDraft,
        operation: 'void',
        idempotencyKey: uuid(10)
      }).success
    ).toBe(true);
    for (const extra of [
      'principalId',
      'volunteerId',
      'actorId',
      'identity',
      'regionId',
      'phone',
      'gps',
      'journal',
      'timezone',
      'canManual',
      '__proto__'
    ]) {
      expect(
        venueManualRequestSchema.safeParse({
          ...draft,
          operation: 'manual',
          idempotencyKey: uuid(10),
          [extra]: 'untrusted'
        }).success,
        extra
      ).toBe(false);
    }
    for (const value of [
      null,
      [],
      'name',
      1,
      { ...draft, reason: '' },
      { ...draft, reason: ' \n ' },
      { ...draft, reason: 'x'.repeat(1001) },
      { ...draft, learnerId: '同名學員' },
      { ...draft, venueId: 'unknown' }
    ]) {
      expect(venueManualDraftSchema.safeParse(value).success).toBe(false);
    }
  });

  it('rejects missing/coerced/stale-shaped record versions and malformed calendar dates', () => {
    for (const expectedVersion of [
      undefined,
      '3',
      0,
      -1,
      1.1,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1
    ])
      expect(venueManualVoidDraftSchema.safeParse({ ...voidDraft, expectedVersion }).success).toBe(
        false
      );
    for (const attendanceDate of [
      '2026-02-29',
      '2026-04-31',
      '2026-13-01',
      '2026-10-25T00:00:00Z',
      '10/25/2026',
      '2026-1-01'
    ])
      expect(venueManualDateSchema.safeParse(attendanceDate).success, attendanceDate).toBe(false);
    expect(venueManualDateSchema.parse('2024-02-29')).toBe('2024-02-29');
  });

  it('accepts minimal search data only, rejects PII, duplicate identities and unsafe model shapes', () => {
    expect(venueManualLookupSchema.safeParse({ learners }).success).toBe(true);
    for (const extra of ['phone', 'phone_e164', 'latitude', 'longitude', 'privateNotes'])
      expect(
        venueManualLookupSchema.safeParse({ learners: [{ ...learners[0], [extra]: 'private' }] })
          .success
      ).toBe(false);
    expect(
      venueManualLookupSchema.safeParse({ learners: [learners[0], learners[0]] }).success
    ).toBe(false);
    expect(
      venueManualServerModelSchema.safeParse({ ...serverModel, capabilities: { canManual: true } })
        .success
    ).toBe(false);
    expect(
      venueManualServerModelSchema.safeParse({ ...serverModel, minDate: '2027-01-01' }).success
    ).toBe(false);
    expect(
      venueManualServerModelSchema.safeParse({
        ...serverModel,
        venues: [{ ...serverModel.venues[0], timezone: 'not/a/timezone' }]
      }).success
    ).toBe(false);
    expect(
      venueManualServerModelSchema.safeParse({
        ...serverModel,
        venues: [serverModel.venues[0], serverModel.venues[0]]
      }).success
    ).toBe(false);
    expect(venueManualOutcomeSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });

  it('uses the existing CSRF cookie and rejects missing, duplicate or invalid values', () => {
    expect(venueManualCsrfToken(`x=1; __Host-qigong-admin-csrf=${csrfToken}; y=2`)).toBe(csrfToken);
    for (const cookie of [
      '',
      '__Host-qigong-admin-csrf=',
      '__Host-qigong-admin-csrf=x; __Host-qigong-admin-csrf=y',
      '__Host-qigong-admin-csrf=bad%20value',
      '__Host-qigong-admin-csrf=' + 'a'.repeat(129)
    ])
      expect(venueManualCsrfToken(cookie)).toBeNull();
  });
});

describe('renderer and capability/transport boundaries', () => {
  it('defaults unavailable, performs no networking and never treats browser capabilities as authorization', async () => {
    const fetch = vi.fn(() => {
      throw new Error('Unexpected network');
    });
    vi.stubGlobal('fetch', fetch);
    for (const options of [{}, { serverModel }, { serverModel: { canManual: true } }]) {
      const controller = createVenueManualController(options);
      expect(controller.state().available).toBe(false);
      expect(await controller.searchLearners({ query: '學員' })).toBe(false);
      expect(controller.prepareManual(draft)).toBe(false);
      expect(await controller.confirm(confirmation)).toBe(false);
      expect(controller.render()).toContain('<fieldset disabled>');
      expect(controller.render()).toContain('未接線');
    }
    const f = fixture();
    const onlyTransport = createVenueManualController({ transport: f.transport });
    expect(await onlyTransport.readRecords(selection)).toBe(false);
    expect(f.readRecords).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('has no executable inline script, scales, has hashed styles, accessible status/focus and corporate footer', () => {
    const html = renderAdminVenueManualPage();
    expect(html).toContain('<title>團練場出席管理</title>');
    expect(html).toContain('width=device-width,initial-scale=1');
    expect(html).not.toMatch(/user-scalable|maximum-scale|<script|\son\w+=|action=|javascript:/i);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting');
    expect(html).not.toMatch(/phone|latitude|longitude|privateNotes|GPS/);
    expect(venueManualStyles).toContain('min-height:48px');
    expect(venueManualStyles).toContain(':focus-visible');
    expect(venueManualContentSecurityPolicy).not.toContain('unsafe-inline');
    expect(venueManualContentSecurityPolicy).toContain(
      `style-src 'sha256-${createHash('sha256').update(venueManualStyles).digest('base64')}'`
    );
    expect(html).toContain(`<style>${venueManualStyles}</style>`);
    expect(venueManualContentSecurityPolicy).toContain("form-action 'none'");
  });

  it('escapes learner/venue names and reasons through search, edit and confirmation, without auto-selection', async () => {
    const f = fixture();
    await select(f);
    expect(f.controller.render()).not.toContain(hostile);
    expect(f.controller.render()).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(f.controller.render()).toContain('北區 &lt;literal&gt;');
    expect(f.controller.render()).toContain(learners[1]!.id);
    expect(f.controller.prepareManual({ ...draft, reason: hostile })).toBe(true);
    expect(f.controller.render()).toContain('人工補簽確認頁');
    expect(f.controller.render()).toContain('Asia/Taipei');
    expect(f.controller.render()).not.toContain('<script>');
    expect(f.controller.render()).toContain('&amp;&#39;&quot;');
    expect(f.operate).not.toHaveBeenCalled();
  });

  it('requires permission for each operation, plus searched identity and record lookup', async () => {
    const f = fixture();
    expect(await f.controller.readRecords(selection)).toBe(false);
    expect(f.controller.prepareManual(draft)).toBe(false);
    await f.controller.searchLearners({ query: '學員' });
    for (const value of [
      { ...selection, learnerId: uuid(99) },
      { ...selection, venueId: uuid(99) },
      { ...selection, attendanceDate: '2027-01-01' }
    ])
      expect(await f.controller.readRecords(value)).toBe(false);
    expect(f.readRecords).not.toHaveBeenCalled();
    expect(f.controller.prepareManual(draft)).toBe(false);
    const noWrite = fixture([active], {
      ...serverModel,
      capabilities: { ...serverModel.capabilities, canManual: false, canVoid: false }
    });
    await select(noWrite);
    expect(noWrite.controller.prepareManual(draft)).toBe(false);
    expect(noWrite.controller.prepareVoid(voidDraft)).toBe(false);
    expect(noWrite.operate).not.toHaveBeenCalled();
    const noSearch = fixture([], {
      ...serverModel,
      capabilities: { ...serverModel.capabilities, canSearchLearners: false }
    });
    expect(await noSearch.controller.searchLearners({ query: '學員' })).toBe(false);
    expect(noSearch.searchLearners).not.toHaveBeenCalled();
  });
});

describe('manual workflow and duplicate submission protection', () => {
  it('reviews immutable selection/reason, supports back, then sends only strict fields and current CSRF', async () => {
    const f = fixture();
    await prepareManual(f);
    expect(f.controller.state().phase).toBe('review');
    expect(await f.controller.confirm({ confirmed: false, secondConfirmed: false })).toBe(false);
    const snapshot = f.controller.state();
    if (snapshot.pending) snapshot.pending.reason = 'changed externally';
    expect(f.controller.state().pending?.reason).toBe('志工核對紙本簽到');
    expect(f.controller.back()).toBe(true);
    expect(f.controller.render()).toContain('志工核對紙本簽到');
    expect(f.controller.prepareManual(draft)).toBe(true);
    expect(f.controller.state().pending?.idempotencyKey).toBe(uuid(101));
    expect(await f.controller.confirm(confirmation)).toBe(true);
    expect(f.operate).toHaveBeenCalledExactlyOnceWith(
      { ...selection, reason: '志工核對紙本簽到', operation: 'manual', idempotencyKey: uuid(101) },
      {
        credentials: 'same-origin',
        headers: { 'x-csrf-token': csrfToken }
      }
    );
    expect(f.controller.state().phase).toBe('applied');
    expect(f.controller.render()).toContain('後端已確認補簽');
    expect(await f.controller.confirm(confirmation)).toBe(false);
    expect(f.operate).toHaveBeenCalledTimes(1);
  });

  it('locks synchronously while submitting, ignores repeated clicks/edits and checks a matching backend receipt', async () => {
    const f = fixture();
    await prepareManual(f);
    let finish: (value: unknown) => void = () => {
      throw new Error('Not initialized');
    };
    f.operate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const first = f.controller.confirm(confirmation);
    expect(f.controller.state().phase).toBe('submitting');
    expect(f.controller.render()).toContain('<fieldset disabled>');
    expect(await f.controller.confirm(confirmation)).toBe(false);
    expect(await f.controller.searchLearners({ query: 'other' })).toBe(false);
    expect(await f.controller.readRecords(selection)).toBe(false);
    expect(f.controller.prepareManual(draft)).toBe(false);
    expect(f.controller.back()).toBe(false);
    expect(f.controller.next()).toBe(false);
    finish(receipt(f.controller.state().pending!, { ...active, version: 1 }));
    expect(await first).toBe(true);
    expect(f.operate).toHaveBeenCalledTimes(1);
  });

  it.each(['active', 'voided'] as const)(
    'rejects a duplicate including %s history but allows another venue on the same day',
    async (status) => {
      const f = fixture([{ ...active, status }]);
      await select(f);
      expect(f.controller.prepareManual(draft)).toBe(false);
      expect(f.controller.render()).toContain('不可重複補簽');
      const other = { ...selection, venueId: otherVenue };
      expect(await f.controller.readRecords(other)).toBe(true);
      expect(f.controller.prepareManual({ ...other, reason: '跨場出席核對' })).toBe(true);
      expect(f.controller.render()).toContain('America/Los_Angeles');
      expect(await f.controller.confirm(confirmation)).toBe(true);
    }
  );

  it('retains applied records to block repeats even if a later read omits the record', async () => {
    const f = fixture();
    await prepareManual(f);
    expect(await f.controller.confirm(confirmation)).toBe(true);
    expect(f.controller.next()).toBe(true);
    f.readRecords.mockResolvedValueOnce({ records: [] });
    expect(await f.controller.readRecords(selection)).toBe(true);
    expect(f.controller.prepareManual(draft)).toBe(false);
  });

  it('requires CSRF and a unique valid operation key; absence never calls transport', async () => {
    const f = fixture([], serverModel, '');
    await prepareManual(f);
    expect(await f.controller.confirm(confirmation)).toBe(false);
    expect(f.controller.state().phase).toBe('review');
    expect(f.operate).not.toHaveBeenCalled();
    const controller = createVenueManualController({
      ...f.options,
      newIdempotencyKey: () => uuid(100)
    });
    await controller.searchLearners({ query: '學員' });
    await controller.readRecords(selection);
    expect(controller.prepareManual(draft)).toBe(true);
    controller.back();
    expect(controller.prepareManual(draft)).toBe(false);
    for (const generator of [
      () => 'bad-key',
      (): string => {
        throw Error('unavailable');
      }
    ]) {
      const c = createVenueManualController({ ...f.options, newIdempotencyKey: generator });
      await c.searchLearners({ query: '學員' });
      await c.readRecords(selection);
      expect(c.prepareManual(draft)).toBe(false);
    }
  });
});

describe('void, unavailable and unverifiable outcomes', () => {
  it('requires an existing active record/version, reason, review and separate second confirmation; retains history', async () => {
    const f = fixture([active]);
    await select(f);
    for (const value of [
      { ...voidDraft, recordId: uuid(99) },
      { ...voidDraft, expectedVersion: 2 },
      { ...voidDraft, reason: '  ' }
    ])
      expect(f.controller.prepareVoid(value)).toBe(false);
    expect(f.controller.prepareVoid(voidDraft)).toBe(true);
    expect(f.controller.render()).toContain('作廢確認頁');
    expect(f.controller.render()).toContain('原版本 3');
    expect(f.controller.render()).toContain('name="secondConfirmed"');
    expect(await f.controller.confirm(confirmation)).toBe(false);
    expect(f.operate).not.toHaveBeenCalled();
    expect(await f.controller.confirm({ confirmed: true, secondConfirmed: true })).toBe(true);
    expect(f.operate.mock.calls[0]![0]).toEqual({
      ...voidDraft,
      operation: 'void',
      idempotencyKey: uuid(100)
    });
    expect(f.controller.state().records).toEqual([{ ...active, version: 4, status: 'voided' }]);
    expect(f.controller.render()).toContain('後端已確認作廢');
    f.controller.next();
    await f.controller.readRecords(selection);
    expect(f.controller.render()).toContain('已作廢（歷史保留）');
    expect(f.controller.prepareVoid({ ...voidDraft, expectedVersion: 4 })).toBe(false);
  });

  it.each(['unauthenticated', 'forbidden', 'conflict', 'unavailable', 'invalid'] as const)(
    'handles %s without fake success, automatic retry or rebase',
    async (code) => {
      const f = fixture();
      await prepareManual(f);
      f.operate.mockResolvedValueOnce({ status: 'rejected', code });
      expect(await f.controller.confirm(confirmation)).toBe(false);
      expect(f.controller.state().phase).toBe('blocked');
      expect(f.controller.render()).not.toContain('後端已確認補簽');
      expect(await f.controller.confirm(confirmation)).toBe(false);
      expect(f.controller.back()).toBe(false);
      expect(f.controller.next()).toBe(false);
      expect(f.operate).toHaveBeenCalledTimes(1);
      if (code === 'unauthenticated' || code === 'forbidden') {
        expect(f.controller.state().pending).toBeNull();
        expect(f.controller.state().learners).toEqual([]);
        expect(f.controller.render()).not.toContain('&lt;script&gt;');
      }
    }
  );

  it.each([
    'throw',
    'malformed',
    'wrong-key',
    'wrong-learner',
    'wrong-date',
    'wrong-status',
    'wrong-operation'
  ] as const)(
    'blocks ambiguous %s results and preserves the operation key for reconciliation',
    async (kind) => {
      const f = fixture();
      await prepareManual(f);
      const request = f.controller.state().pending!;
      const result = { ...receipt(request, { ...active, version: 1 }) };
      if (kind === 'throw') f.operate.mockRejectedValueOnce(Error('may already have committed'));
      else {
        if (kind === 'wrong-key') result.idempotencyKey = uuid(999);
        if (kind === 'wrong-learner') result.record.learnerId = uuid(999);
        if (kind === 'wrong-date') result.record.attendanceDate = '2026-10-24';
        if (kind === 'wrong-status') result.record.status = 'voided';
        if (kind === 'wrong-operation') result.operation = 'void';
        f.operate.mockResolvedValueOnce(kind === 'malformed' ? { status: 'success' } : result);
      }
      expect(await f.controller.confirm(confirmation)).toBe(false);
      expect(f.controller.state().pending?.idempotencyKey).toBe(request.idempotencyKey);
      expect(f.controller.render()).toContain('結果不明');
      expect(await f.controller.confirm(confirmation)).toBe(false);
      expect(f.operate).toHaveBeenCalledTimes(1);
    }
  );

  it('rejects a void receipt with wrong record or wrong next version', async () => {
    for (const record of [
      { ...active, version: 5, status: 'voided' as const },
      { ...active, id: uuid(99), version: 4, status: 'voided' as const }
    ]) {
      const f = fixture([active]);
      await select(f);
      f.controller.prepareVoid(voidDraft);
      f.operate.mockResolvedValueOnce(receipt(f.controller.state().pending!, record));
      expect(await f.controller.confirm({ confirmed: true, secondConfirmed: true })).toBe(false);
      expect(f.controller.state().phase).toBe('blocked');
    }
  });

  it('invalidates old selection on re-search and rejects cross-selection or private record data', async () => {
    const f = fixture();
    await select(f);
    f.searchLearners.mockRejectedValueOnce(Error('unavailable'));
    expect(await f.controller.searchLearners({ query: 'other' })).toBe(false);
    expect(f.controller.prepareManual(draft)).toBe(false);
    expect(f.controller.state().learners).toEqual([]);
    await f.controller.searchLearners({ query: '學員' });
    for (const record of [
      { ...active, venueId: otherVenue },
      { ...active, phone: 'private' }
    ]) {
      f.readRecords.mockResolvedValueOnce({ records: [record] });
      expect(await f.controller.readRecords(selection)).toBe(false);
      expect(f.controller.state().selection).toBeNull();
    }
    f.readRecords.mockRejectedValueOnce(Error('unavailable'));
    expect(await f.controller.readRecords(selection)).toBe(false);
    expect(f.operate).not.toHaveBeenCalled();
  });
});

describe('additional fail-closed transport and timezone boundaries', () => {
  it('fails closed if the cookie reader throws before any operation is attempted', async () => {
    const f = fixture();
    const controller = createVenueManualController({
      ...f.options,
      readCookie: () => {
        throw Error('cookie blocked');
      }
    });
    await controller.searchLearners({ query: '學員' });
    await controller.readRecords(selection);
    expect(controller.prepareManual(draft)).toBe(true);
    expect(await controller.confirm(confirmation)).toBe(false);
    expect(controller.render()).toContain('未送出');
    expect(f.operate).not.toHaveBeenCalled();
  });

  it('shows and preserves the historical record timezone when the venue setting has changed', async () => {
    const model = {
      ...serverModel,
      venues: serverModel.venues.map((venue) => ({ ...venue, timezone: 'Asia/Tokyo' }))
    };
    const f = fixture([active], model);
    await select(f);
    expect(f.controller.prepareVoid(voidDraft)).toBe(true);
    expect(f.controller.render()).toContain('2026-10-25 · Asia/Taipei');
    expect(await f.controller.confirm({ confirmed: true, secondConfirmed: true })).toBe(true);
    expect(f.controller.state().records[0]?.attendanceTimezone).toBe('Asia/Taipei');
    const changed = fixture([active], model);
    await select(changed);
    changed.controller.prepareVoid(voidDraft);
    changed.operate.mockResolvedValueOnce(
      receipt(changed.controller.state().pending!, {
        ...active,
        version: 4,
        status: 'voided',
        attendanceTimezone: 'Asia/Tokyo'
      })
    );
    expect(await changed.controller.confirm({ confirmed: true, secondConfirmed: true })).toBe(
      false
    );
    expect(changed.controller.render()).toContain('結果不明');
  });

  it('rejects manual receipts in a different timezone or colliding with another known record ID', async () => {
    const f = fixture();
    await prepareManual(f);
    f.operate.mockResolvedValueOnce(
      receipt(f.controller.state().pending!, { ...active, attendanceTimezone: 'Asia/Tokyo' })
    );
    expect(await f.controller.confirm(confirmation)).toBe(false);
    const collision = fixture([
      { ...active, venueId: otherVenue, attendanceTimezone: 'America/Los_Angeles' }
    ]);
    await select(collision, { ...selection, venueId: otherVenue });
    await collision.controller.readRecords(selection);
    expect(collision.controller.prepareManual(draft)).toBe(true);
    collision.operate.mockResolvedValueOnce(receipt(collision.controller.state().pending!, active));
    expect(await collision.controller.confirm(confirmation)).toBe(false);
    expect(collision.controller.state().records[0]?.venueId).toBe(otherVenue);
  });

  it('validates query and draft unknown values without invoking adapters or accepting claimed identity', async () => {
    const f = fixture();
    for (const value of [
      null,
      { query: ' ' },
      { query: 'x'.repeat(81) },
      { query: '學員', principalId: uuid(99) }
    ])
      expect(await f.controller.searchLearners(value)).toBe(false);
    expect(f.searchLearners).not.toHaveBeenCalled();
    await select(f);
    expect(f.controller.prepareManual({ ...draft, volunteerId: uuid(99) })).toBe(false);
    expect(f.controller.prepareManual({ ...draft, attendanceDate: '2026-10-24' })).toBe(false);
    expect(f.operate).not.toHaveBeenCalled();
  });
});

// Minimal DOM port: drive the real delegated submit binding without adding a browser dependency.
class TestForm {
  constructor(
    readonly id: string,
    readonly fields: Record<string, string>,
    readonly isVoid = false
  ) {}
  hasAttribute(name: string) {
    return this.isVoid && name === 'data-void-form';
  }
}
class TestFormData {
  constructor(private readonly form: TestForm) {}
  get(name: string) {
    return this.form.fields[name] ?? null;
  }
}
const dom = () => {
  const handlers = new Map<string, (event: SubmitEvent) => void>();
  const focus = vi.fn();
  const root = {
    innerHTML: '',
    contains: () => true,
    querySelector: () => ({ focus }),
    addEventListener: (name: string, handler: (event: SubmitEvent) => void) =>
      handlers.set(name, handler),
    removeEventListener: (name: string) => handlers.delete(name),
    replaceChildren: () => {
      root.innerHTML = '';
    }
  };
  vi.stubGlobal('HTMLFormElement', TestForm);
  vi.stubGlobal('FormData', TestFormData);
  const submit = async (id: string, fields: Record<string, string> = {}, isVoid = false) => {
    const preventDefault = vi.fn();
    handlers.get('submit')?.({
      target: new TestForm(id, fields, isVoid),
      preventDefault
    } as unknown as SubmitEvent);
    await setImmediate();
    return preventDefault;
  };
  return { root, focus, handlers, submit };
};

describe('mounted form controller', () => {
  it('binds search → choose → lookup → review → back → confirm → next, prevents native submission and unmounts', async () => {
    const f = fixture();
    const d = dom();
    const unmount = mountVenueManualPage(d.root as unknown as HTMLElement, f.controller);
    expect(d.root.innerHTML).toContain('vm-search');
    expect(await d.submit('vm-search', { query: '學員' })).toHaveBeenCalledOnce();
    expect(f.searchLearners).toHaveBeenCalledExactlyOnceWith({ query: '學員' });
    await d.submit('vm-records', selection);
    expect(d.root.innerHTML).toContain('vm-manual');
    await d.submit('vm-manual', { reason: draft.reason });
    expect(d.root.innerHTML).toContain('人工補簽確認頁');
    expect(f.operate).not.toHaveBeenCalled();
    await d.submit('vm-back');
    await d.submit('vm-manual', { reason: draft.reason });
    await d.submit('vm-confirm', { confirmed: 'on' });
    expect(d.root.innerHTML).toContain('後端已確認補簽');
    await d.submit('vm-next');
    expect(d.root.innerHTML).toContain('vm-records');
    expect(d.focus).toHaveBeenCalled();
    unmount();
    expect(d.handlers.size).toBe(0);
    expect(d.root.innerHTML).toBe('');
  });

  it('binds void to its original record/version and requires both checkboxes', async () => {
    const f = fixture([active]);
    const d = dom();
    const unmount = mountVenueManualPage(d.root as unknown as HTMLElement, f.controller);
    await d.submit('vm-search', { query: '學員' });
    await d.submit('vm-records', selection);
    await d.submit(
      'vm-void-' + recordId,
      { recordId, expectedVersion: '3', reason: voidDraft.reason },
      true
    );
    expect(d.root.innerHTML).toContain('作廢確認頁');
    await d.submit('vm-confirm', { confirmed: 'on' });
    expect(f.operate).not.toHaveBeenCalled();
    await d.submit('vm-confirm', { confirmed: 'on', secondConfirmed: 'on' });
    expect(d.root.innerHTML).toContain('後端已確認作廢');
    unmount();
  });
});
