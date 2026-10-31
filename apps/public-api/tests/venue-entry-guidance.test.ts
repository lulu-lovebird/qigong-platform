/** Standalone Fastify + mocked SQL/LINE only; no DB, provider or app wiring.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import type { Pool, PoolClient } from '@qigong/database';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LineConfig } from '../src/line-onboarding.js';
import type { VerifiedLineIdentity } from '../src/line-profile.js';
import {
  createVenueEntryAvailability,
  createVenueEntrySelfStatus,
  registerVenueEntryGuidanceRoutes,
  venueEntryAvailabilitySchema,
  venueEntrySelfStatusSchema,
  type VenueEntryAvailability,
  type VenueEntryAvailabilityDto,
  type VenueEntryGuidanceOptions,
  type VenueEntryMode,
  type VenueEntryModeResolver
} from '../src/venue-entry-guidance.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const subject = 'U' + 'a'.repeat(32);
const forgedPerson = '22222222-2222-4222-8222-222222222222';
const token = 'synthetic-id-token';
const secretMarker = 'PRIVATE_SENTINEL_NEVER_ECHO';
const origin = 'https://app.example.invalid';
const code = 'tw-test-venue';
const getUrl = '/api/venue-entry/availability';
const postUrl = '/api/line/venue-entry-status';
const headers = { origin, 'x-venue-entry': '1', 'content-type': 'application/json' };
const availabilitySql = 'SELECT platform.venue_entry_availability($1) AS data';
const statusSql = 'SELECT platform.venue_entry_learner_status($1) AS data';
const privacySql = 'SELECT platform.privacy_usage($1,$2) AS data';
const unavailable = { status: 503, body: { error: 'venue_entry_unavailable' } };
const invalidRequest = { status: 400, body: { error: 'invalid_venue_entry_request' } };
const session = {
  startsAt: '2026-10-26T01:00:00+00:00',
  endsAt: '2026-10-26T03:00:00+00:00',
  opensAt: '2026-10-26T00:30:00+00:00'
};
const nextSession = {
  startsAt: '2026-11-02T01:00:00+00:00',
  endsAt: '2026-11-02T03:00:00+00:00',
  opensAt: '2026-11-02T00:30:00+00:00'
};
const canonical = (availability: VenueEntryAvailability = 'open'): VenueEntryAvailabilityDto => ({
  version: 1,
  availability,
  venue:
    availability === 'not_found' || availability === 'unavailable'
      ? null
      : { code, name: '合成場地', timezone: 'Asia/Taipei' },
  observedAt: '2026-10-26T00:45:00+00:00',
  relevantSession: ['open', 'before_open', 'ended'].includes(availability) ? session : null,
  nextSession: ['disabled', 'not_found', 'unavailable'].includes(availability) ? null : nextSession
});
const activePrivacy = {
  active: true,
  required: false,
  unavailable: false,
  reflectionConsent: false,
  version: 'synthetic-policy',
  hash: 'a'.repeat(64)
};
interface Row {
  data: unknown;
}
const fixture = () => {
  const state: {
    availability: Row[];
    learner: Row[];
    privacy: Row[];
    failSql: string | null;
  } = {
    availability: [{ data: canonical() }],
    learner: [{ data: { version: 1, status: 'needs_application' } }],
    privacy: [{ data: activePrivacy }],
    failSql: null
  };
  const query = vi.fn(
    async (sql: string, values?: readonly unknown[]): Promise<{ rows: Row[] }> => {
      if (sql === availabilitySql) expect(values).toEqual([code]);
      if (sql === statusSql) expect(values).toEqual([subject]);
      if (sql === privacySql) expect(values).toEqual(['line', subject]);
      if (sql === state.failSql) throw new Error(secretMarker);
      if (sql === availabilitySql) return { rows: state.availability };
      if (sql === statusSql) return { rows: state.learner };
      if (sql === privacySql) return { rows: state.privacy };
      if (
        ['BEGIN', 'COMMIT', 'ROLLBACK', 'SET LOCAL ROLE qigong_api_runtime'].includes(sql) ||
        sql.startsWith('SELECT set_config(')
      )
        return { rows: [] };
      throw new Error('Unexpected SQL: ' + sql);
    }
  );
  const release = vi.fn<PoolClient['release']>();
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const poolQuery = vi.fn(() => {
    throw new Error('Direct pool query forbidden');
  });
  const pool = { connect, query: poolQuery } as unknown as Pool;
  const verifyIdentity = vi.fn(async (credential: string): Promise<VerifiedLineIdentity> => {
    expect(credential).toBe(token);
    return { subject, displayName: secretMarker };
  });
  const line: LineConfig = {
    channelSecret: 'synthetic-secret',
    channelAccessToken: 'synthetic-access',
    loginChannelId: '123',
    liffId: '123-synthetic',
    verifyIdentity
  };
  return {
    state,
    pool,
    connect,
    query,
    release,
    poolQuery,
    verifyIdentity,
    line,
    lookup: createVenueEntryAvailability(pool),
    self: createVenueEntrySelfStatus(pool, line)
  };
};
type Fixture = ReturnType<typeof fixture>;
const businessQueries = (m: Fixture) =>
  m.query.mock.calls.filter(([sql]) => [availabilitySql, statusSql, privacySql].includes(sql));
const untouched = (m: Fixture) => {
  expect(m.connect).not.toHaveBeenCalled();
  expect(m.poolQuery).not.toHaveBeenCalled();
  expect(m.verifyIdentity).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
};
const privateHeaders = (response: { headers: Record<string, unknown> }) => {
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['referrer-policy']).toBe('no-referrer');
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.headers['access-control-allow-origin']).toBeUndefined();
};
const withApp = async <T>(
  m: Fixture,
  run: (app: FastifyInstance) => Promise<T>,
  options?: VenueEntryGuidanceOptions
): Promise<T> => {
  const app = Fastify({ logger: false, genReqId: () => requestId });
  registerVenueEntryGuidanceRoutes(app, m.pool, m.line, origin, options);
  try {
    return await run(app);
  } finally {
    await app.close();
  }
};
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Live provider access forbidden: ' + secretMarker);
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('lazy read-only factories and canonical public DTO', () => {
  it('constructs and registers without any DB, verifier or schema/capability probes', async () => {
    const m = fixture();
    await withApp(m, async (app) => {
      await app.ready();
      untouched(m);
      expect(app.hasRoute({ method: 'GET', url: getUrl })).toBe(true);
      expect(app.hasRoute({ method: 'POST', url: postUrl })).toBe(true);
      expect(app.hasRoute({ method: 'GET', url: '/venue-checkin' })).toBe(false);
      expect(app.hasRoute({ method: 'POST', url: '/api/line/venue-checkin' })).toBe(false);
    });
  });
  it.each([
    ['open', 200],
    ['not_activity_day', 200],
    ['before_open', 200],
    ['ended', 200],
    ['disabled', 410],
    ['not_found', 404],
    ['unavailable', 503]
  ] as const)(
    'decodes DB %s and maps HTTP %i without computing a new window',
    async (state, status) => {
      const m = fixture();
      const data = canonical(state);
      // A calendar state is supplied by PG; the adapter does not use Node's date
      // to recalculate it, even though this fixture is intentionally historical.
      m.state.availability = [{ data }];
      expect(await m.lookup(requestId, code)).toEqual(
        state === 'unavailable' ? unavailable : { status, body: data }
      );
      expect(businessQueries(m)).toEqual([[availabilitySql, [code]]]);
      expect(m.verifyIdentity).not.toHaveBeenCalled();
      expect(m.poolQuery).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it.each([canonical('unavailable'), { ...canonical('unavailable'), venue: canonical().venue }])(
    'accepts either SQL unavailable shape but emits a fixed 503 without invented clock: %j',
    async (data) => {
      const m = fixture();
      expect(venueEntryAvailabilitySchema.safeParse(data).success).toBe(true);
      m.state.availability = [{ data }];
      expect(await m.lookup(requestId, code)).toEqual(unavailable);
    }
  );
  it('uses only requestId and the exact runtime transaction, never caller identity context', async () => {
    const m = fixture();
    await m.lookup(requestId, code);
    expect(m.query.mock.calls).toEqual([
      ['BEGIN'],
      ['SET LOCAL ROLE qigong_api_runtime'],
      ["SELECT set_config('qigong.request_id', $1, TRUE)", [requestId]],
      ["SELECT set_config('qigong.person_id', $1, TRUE)", ['']],
      ["SELECT set_config('qigong.principal_id', $1, TRUE)", ['']],
      [availabilitySql, [code]],
      ['COMMIT']
    ]);
    expect(m.release).toHaveBeenCalledOnce();
  });
  it.each([
    undefined,
    null,
    {},
    '',
    'x',
    'UPPER-case',
    'nohyphen',
    'a-'.repeat(33),
    'tw-venue\n',
    'tw-venue\r\n',
    ' tw-venue',
    'tw-venue ',
    'tw-venue/other'
  ])('rejects invalid public selector without DB %j', async (value) => {
    const m = fixture();
    expect(await m.lookup(requestId, value)).toEqual(invalidRequest);
    untouched(m);
  });
  const malformed: readonly (readonly [string, unknown])[] = [
    ['null', null],
    ['missing keys', {}],
    ['version', { ...canonical(), version: 2 }],
    ['state', { ...canonical(), availability: 'approved' }],
    ['root ID', { ...canonical(), personId: forgedPerson }],
    ['venue ID', { ...canonical(), venue: { ...canonical().venue, id: forgedPerson } }],
    ['region ID', { ...canonical(), venue: { ...canonical().venue, regionId: forgedPerson } }],
    ['coordinate', { ...canonical(), venue: { ...canonical().venue, latitude: 25 } }],
    ['address', { ...canonical(), venue: { ...canonical().venue, address: secretMarker } }],
    ['radius', { ...canonical(), venue: { ...canonical().venue, radiusMeters: 100 } }],
    ['contact', { ...canonical(), phone: secretMarker }],
    ['venue binding', { ...canonical(), venue: { ...canonical().venue, code: 'tw-other-venue' } }],
    ['bad zone', { ...canonical(), venue: { ...canonical().venue, timezone: 'Bad/Timezone' } }],
    ['blank name', { ...canonical(), venue: { ...canonical().venue, name: ' ' } }],
    ['long name', { ...canonical(), venue: { ...canonical().venue, name: 'x'.repeat(121) } }],
    ['control name', { ...canonical(), venue: { ...canonical().venue, name: 'name\nprivate' } }],
    ['time only', { ...canonical(), observedAt: '08:45' }],
    ['invalid date', { ...canonical(), observedAt: '2026-02-30T08:45:00Z' }],
    ['unbounded date', { ...canonical(), observedAt: 'infinity' }],
    ['no offset', { ...canonical(), observedAt: '2026-10-26T08:45:00' }],
    ['open venue null', { ...canonical(), venue: null }],
    ['open relevant null', { ...canonical(), relevantSession: null }],
    ['before relevant null', { ...canonical('before_open'), relevantSession: null }],
    ['ended relevant null', { ...canonical('ended'), relevantSession: null }],
    ['not-day session', { ...canonical('not_activity_day'), relevantSession: session }],
    ['not-found venue', { ...canonical('not_found'), venue: canonical().venue }],
    ['disabled session', { ...canonical('disabled'), relevantSession: session }],
    ['unavailable session', { ...canonical('unavailable'), nextSession }],
    [
      'inverted session',
      { ...canonical(), relevantSession: { ...session, endsAt: session.startsAt } }
    ],
    [
      'late opening',
      { ...canonical(), relevantSession: { ...session, opensAt: session.startsAt } }
    ],
    [
      'session unknown key',
      { ...canonical(), relevantSession: { ...session, personId: forgedPerson } }
    ],
    [
      'next not future',
      { ...canonical(), nextSession: { ...session, opensAt: canonical().observedAt } }
    ]
  ];
  it.each(malformed)('fails malformed/badly-bound backend DTO closed: %s', async (_label, data) => {
    const m = fixture();
    m.state.availability = [{ data }];
    expect(await m.lookup(requestId, code)).toEqual(unavailable);
  });
  it.each([{ rows: [] }, { rows: [{ data: canonical() }, { data: canonical() }] }])(
    'rejects missing/ambiguous public rows: %j',
    async ({ rows }) => {
      const m = fixture();
      m.state.availability = rows;
      expect(await m.lookup(requestId, code)).toEqual(unavailable);
    }
  );
  it.each(['BEGIN', availabilitySql, 'COMMIT'])(
    'sanitizes public DB failures at %s',
    async (sql) => {
      const m = fixture();
      m.state.failSql = sql;
      expect(await m.lookup(requestId, code)).toEqual(unavailable);
      expect(m.query).toHaveBeenCalledWith('ROLLBACK');
    }
  );
  it('sanitizes connection failure without querying schema or leaking diagnostics', async () => {
    const m = fixture();
    m.connect.mockRejectedValueOnce(new Error(secretMarker));
    expect(await m.lookup(requestId, code)).toEqual(unavailable);
    expect(m.query).not.toHaveBeenCalled();
  });
});

describe('token-verified own coarse status, with privacy only for approved', () => {
  it.each(['needs_application', 'pending', 'blocked'] as const)(
    'preserves %s and makes no privacy/profile/consent/attendance calls',
    async (status) => {
      const m = fixture();
      m.state.learner = [{ data: { version: 1, status } }];
      expect(await m.self(requestId, { idToken: token })).toEqual({
        status: 200,
        body: { version: 1, status, privacy: null }
      });
      expect(m.verifyIdentity).toHaveBeenCalledWith(token);
      expect(m.verifyIdentity.mock.invocationCallOrder[0]).toBeLessThan(
        m.connect.mock.invocationCallOrder[0]!
      );
      expect(businessQueries(m)).toEqual([[statusSql, [subject]]]);
      expect(m.poolQuery).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it.each([
    [{ active: false, reflectionConsent: false }, 'clear'],
    [activePrivacy, 'clear'],
    [{ ...activePrivacy, required: true }, 'required']
  ] as const)(
    'approved decodes necessary privacy without exposing source fields %j',
    async (privacy, expected) => {
      const m = fixture();
      m.state.learner = [{ data: { version: 1, status: 'approved' } }];
      m.state.privacy = [{ data: privacy }];
      const result = await m.self(requestId, { idToken: token });
      expect(result).toEqual({
        status: 200,
        body: { version: 1, status: 'approved', privacy: expected }
      });
      expect(businessQueries(m)).toEqual([
        [statusSql, [subject]],
        [privacySql, ['line', subject]]
      ]);
      expect(JSON.stringify(result)).not.toContain(subject);
      expect(JSON.stringify(result)).not.toContain(activePrivacy.hash);
      expect(JSON.stringify(result)).not.toContain(secretMarker);
      expect(m.connect).toHaveBeenCalledOnce();
      expect(m.query).toHaveBeenCalledWith("SELECT set_config('qigong.person_id', $1, TRUE)", ['']);
      expect(m.query).toHaveBeenCalledWith("SELECT set_config('qigong.principal_id', $1, TRUE)", [
        ''
      ]);
    }
  );
  it.each([
    null,
    {},
    { active: false },
    { active: false, reflectionConsent: false, personId: forgedPerson },
    { ...activePrivacy, unavailable: true },
    { ...activePrivacy, required: true, unavailable: true },
    { ...activePrivacy, reflectionConsent: 'yes' },
    { ...activePrivacy, hash: 'bad' },
    { ...activePrivacy, hash: activePrivacy.hash + '\n' },
    { ...activePrivacy, version: '' },
    { ...activePrivacy, phone: secretMarker }
  ])(
    'approved privacy invalid/unavailable is generic 503, never new application: %j',
    async (data) => {
      const m = fixture();
      m.state.learner = [{ data: { version: 1, status: 'approved' } }];
      m.state.privacy = [{ data }];
      expect(await m.self(requestId, { idToken: token })).toEqual(unavailable);
    }
  );
  it.each([{ rows: [] }, { rows: [{ data: activePrivacy }, { data: activePrivacy }] }])(
    'approved privacy row count is exact: %j',
    async ({ rows }) => {
      const m = fixture();
      m.state.learner = [{ data: { version: 1, status: 'approved' } }];
      m.state.privacy = rows;
      expect(await m.self(requestId, { idToken: token })).toEqual(unavailable);
    }
  );
  it.each([
    null,
    {},
    { version: 2, status: 'pending' },
    { version: 1, status: 'unknown' },
    { version: 1, status: 'pending', personId: forgedPerson },
    { version: 1, status: 'approved', subject },
    { version: 1, status: 'pending', applicationId: forgedPerson },
    { version: 1, status: 'approved', privacy: 'clear' }
  ])('does not reinterpret invalid learner DTO as needs_application: %j', async (data) => {
    const m = fixture();
    m.state.learner = [{ data }];
    expect(await m.self(requestId, { idToken: token })).toEqual(unavailable);
    expect(businessQueries(m)).toEqual([[statusSql, [subject]]]);
  });
  it.each([
    { rows: [] },
    {
      rows: [
        { data: { version: 1, status: 'pending' } },
        { data: { version: 1, status: 'pending' } }
      ]
    }
  ])('requires exactly one learner row %j', async ({ rows }) => {
    const m = fixture();
    m.state.learner = rows;
    expect(await m.self(requestId, { idToken: token })).toEqual(unavailable);
  });
  it.each([statusSql, privacySql, 'COMMIT'])('sanitizes self DB failure at %s', async (sql) => {
    const m = fixture();
    m.state.learner = [{ data: { version: 1, status: 'approved' } }];
    m.state.failSql = sql;
    expect(await m.self(requestId, { idToken: token })).toEqual(unavailable);
  });
  const badCredentials: readonly unknown[] = [
    undefined,
    null,
    {},
    { idToken: '' },
    { idToken: ' ' },
    { idToken: 42 },
    { idToken: 'x'.repeat(4097) },
    ...[
      'subject',
      'userId',
      'personId',
      'principalId',
      'venue',
      'source',
      'at_time',
      'privacy',
      'token',
      'name',
      'email',
      'phone'
    ].map((key) => ({ idToken: token, [key]: secretMarker }))
  ];
  it.each(badCredentials)(
    'rejects malformed/self-claimed credential before verifier or DB %j',
    async (input) => {
      const m = fixture();
      expect(await m.self(requestId, input)).toEqual(invalidRequest);
      untouched(m);
    }
  );
  it.each(['invalid signature', 'expired token', 'provider outage', 'network timeout'])(
    'verification failure %s is 401, not a learner state',
    async (reason) => {
      const m = fixture();
      m.verifyIdentity.mockRejectedValueOnce(new Error(reason + secretMarker));
      expect(await m.self(requestId, { idToken: token })).toEqual({
        status: 401,
        body: { error: 'invalid_line_identity' }
      });
      expect(m.connect).not.toHaveBeenCalled();
    }
  );
  it.each([
    { subject: forgedPerson },
    { subject: subject + '\n' },
    { subject, personId: forgedPerson },
    { subject, displayName: '' }
  ])('strictly validates provider output before DB %j', async (value) => {
    const m = fixture();
    m.verifyIdentity.mockResolvedValueOnce(value);
    expect(await m.self(requestId, { idToken: token })).toEqual({
      status: 401,
      body: { error: 'invalid_line_identity' }
    });
    expect(m.connect).not.toHaveBeenCalled();
  });
  it('defaults to the pure issuer/audience/expiry verifier with fully mocked HTTP', async () => {
    const m = fixture();
    const provider = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      expect(url).toBe('https://api.line.me/oauth2/v2.1/verify');
      expect(options?.method).toBe('POST');
      return Response.json({
        sub: subject,
        aud: m.line.loginChannelId,
        exp: Date.now() / 1000 + 600,
        iss: 'https://access.line.me',
        name: secretMarker
      });
    });
    vi.stubGlobal('fetch', provider);
    const self = createVenueEntrySelfStatus(m.pool, { loginChannelId: m.line.loginChannelId });
    expect(await self(requestId, { idToken: token })).toEqual({
      status: 200,
      body: { version: 1, status: 'needs_application', privacy: null }
    });
    expect(provider).toHaveBeenCalledOnce();
    const [url, options] = provider.mock.calls[0]!;
    expect(url).toBe('https://api.line.me/oauth2/v2.1/verify');
    expect(options?.method).toBe('POST');
    expect(options?.body).toBeInstanceOf(URLSearchParams);
    expect(options?.body instanceof URLSearchParams ? options.body.toString() : null).toBe(
      new URLSearchParams({ id_token: token, client_id: m.line.loginChannelId }).toString()
    );
    expect(m.verifyIdentity).not.toHaveBeenCalled();
    expect(businessQueries(m)).toEqual([[statusSql, [subject]]]);
  });
  it.each([
    { iss: 'https://wrong.invalid' },
    { aud: 'another-channel' },
    { exp: 0 },
    { sub: 'forged-subject' }
  ])('default verifier rejects mocked claims %j before DB', async (patch) => {
    const m = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          sub: subject,
          aud: m.line.loginChannelId,
          exp: Date.now() / 1000 + 600,
          iss: 'https://access.line.me',
          ...patch
        })
      )
    );
    const self = createVenueEntrySelfStatus(m.pool, { loginChannelId: m.line.loginChannelId });
    expect(await self(requestId, { idToken: token })).toEqual({
      status: 401,
      body: { error: 'invalid_line_identity' }
    });
    expect(m.connect).not.toHaveBeenCalled();
  });
  it('legacy subject-only verifier cannot bypass the default token verifier', async () => {
    const m = fixture();
    const legacy = vi.fn(async () => subject);
    const line: LineConfig = {
      channelSecret: 'synthetic',
      channelAccessToken: 'synthetic',
      liffId: '123-synthetic',
      loginChannelId: '123',
      verifyIdToken: legacy
    };
    const self = createVenueEntrySelfStatus(m.pool, line);
    expect(await self(requestId, { idToken: token })).toEqual({
      status: 401,
      body: { error: 'invalid_line_identity' }
    });
    expect(legacy).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(m.connect).not.toHaveBeenCalled();
  });
  it('self response decoder forbids IDs/contact data and approved/null privacy', () => {
    expect(
      venueEntrySelfStatusSchema.safeParse({ version: 1, status: 'approved', privacy: null })
        .success
    ).toBe(false);
    expect(
      venueEntrySelfStatusSchema.safeParse({ version: 1, status: 'pending', privacy: 'required' })
        .success
    ).toBe(false);
    expect(
      venueEntrySelfStatusSchema.safeParse({
        version: 1,
        status: 'blocked',
        privacy: null,
        phone: secretMarker
      }).success
    ).toBe(false);
  });
});

describe('server-owned lazy mode guards (no catalog resolver or app composition)', () => {
  const unsupported = { status: 404, body: unavailable.body };
  const invalidIdentity = { status: 401, body: { error: 'invalid_line_identity' } };
  const badModes: readonly unknown[] = [
    undefined,
    null,
    '',
    'GUIDED',
    'unknown',
    secretMarker,
    true,
    60,
    {},
    { mode: 'guided' },
    { ready: true, version: 60, entryCapability: true },
    ['guided']
  ];
  const noData = (m: Fixture) => {
    expect(m.connect).not.toHaveBeenCalled();
    expect(m.query).not.toHaveBeenCalled();
    expect(m.poolQuery).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  };
  const ordered = (m: Fixture, resolveMode: ReturnType<typeof vi.fn<VenueEntryModeResolver>>) => {
    expect(m.verifyIdentity).toHaveBeenCalledExactlyOnceWith(token);
    expect(resolveMode).toHaveBeenCalledExactlyOnceWith(requestId);
    expect(m.verifyIdentity.mock.invocationCallOrder[0]).toBeLessThan(
      resolveMode.mock.invocationCallOrder[0]!
    );
  };
  it('constructs factories and registers with options without mode, verifier, DB or fetch calls', async () => {
    const m = fixture();
    const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
    const options = { resolveMode };
    createVenueEntrySelfStatus(m.pool, m.line, options);
    createVenueEntryAvailability(m.pool);
    await withApp(
      m,
      async (app) => {
        await app.ready();
        untouched(m);
        expect(m.query).not.toHaveBeenCalled();
        expect(resolveMode).not.toHaveBeenCalled();
      },
      options
    );
  });
  it.each([
    undefined,
    null,
    {},
    { idToken: '' },
    { idToken: ' ' },
    { idToken: 42 },
    { idToken: 'x'.repeat(4097) },
    ...[
      'subject',
      'userId',
      'personId',
      'principalId',
      'venue',
      'source',
      'at_time',
      'privacy',
      'token',
      'name',
      'email',
      'phone',
      'mode',
      'resolveMode',
      'meta'
    ].map((key) => ({ idToken: token, [key]: secretMarker }))
  ])('parses credentials before verification and mode %j', async (credential) => {
    const m = fixture();
    const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
    const self = createVenueEntrySelfStatus(m.pool, m.line, { resolveMode });
    expect(await self(requestId, credential)).toEqual(invalidRequest);
    untouched(m);
    expect(resolveMode).not.toHaveBeenCalled();
    expect(m.query).not.toHaveBeenCalled();
  });
  it.each(['invalid signature', 'expired token', 'provider outage', 'network timeout'])(
    'rejects %s after one pure verification with zero mode/DB calls',
    async (reason) => {
      const m = fixture();
      m.verifyIdentity.mockRejectedValueOnce(new Error(reason + secretMarker));
      const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
      const self = createVenueEntrySelfStatus(m.pool, m.line, { resolveMode });
      expect(await self(requestId, { idToken: token })).toEqual(invalidIdentity);
      expect(m.verifyIdentity).toHaveBeenCalledExactlyOnceWith(token);
      expect(resolveMode).not.toHaveBeenCalled();
      noData(m);
    }
  );
  it.each([
    null,
    {},
    { subject: forgedPerson },
    { subject: subject + '\n' },
    { subject, personId: forgedPerson },
    { subject, displayName: '' }
  ])('rejects invalid verified subject schema before mode %j', async (value) => {
    const m = fixture();
    m.verifyIdentity.mockResolvedValueOnce(value as unknown as VerifiedLineIdentity);
    const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
    expect(
      await createVenueEntrySelfStatus(m.pool, m.line, { resolveMode })(requestId, {
        idToken: token
      })
    ).toEqual(invalidIdentity);
    expect(m.verifyIdentity).toHaveBeenCalledExactlyOnceWith(token);
    expect(resolveMode).not.toHaveBeenCalled();
    noData(m);
  });
  it.each(['legacy', 'unavailable'] as const)(
    'verified subject then %s returns a fixed rejection before private SQL',
    async (mode) => {
      const m = fixture();
      const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue(mode);
      const self = createVenueEntrySelfStatus(m.pool, m.line, { resolveMode });
      expect(await self(requestId, { idToken: token })).toEqual(
        mode === 'legacy' ? unsupported : unavailable
      );
      ordered(m, resolveMode);
      noData(m);
    }
  );
  it.each(badModes)(
    'fails runtime mode %j closed after verification, never default guided',
    async (value) => {
      const m = fixture();
      const resolveMode = vi
        .fn<VenueEntryModeResolver>()
        .mockResolvedValue(value as VenueEntryMode);
      const self = createVenueEntrySelfStatus(m.pool, m.line, { resolveMode });
      expect(await self(requestId, { idToken: token })).toEqual(unavailable);
      ordered(m, resolveMode);
      noData(m);
    }
  );
  it('keeps a resolver exception outside the verifier 401 boundary and sanitizes it', async () => {
    const m = fixture();
    const resolveMode = vi
      .fn<VenueEntryModeResolver>()
      .mockRejectedValue(new Error(secretMarker + subject + token));
    expect(
      await createVenueEntrySelfStatus(m.pool, m.line, { resolveMode })(requestId, {
        idToken: token
      })
    ).toEqual(unavailable);
    ordered(m, resolveMode);
    noData(m);
  });
  it.each(['needs_application', 'pending', 'blocked'] as const)(
    'guided %s queries only coarse status after exactly one verification and mode',
    async (status) => {
      const m = fixture();
      m.state.learner = [{ data: { version: 1, status } }];
      const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
      const self = createVenueEntrySelfStatus(m.pool, m.line, { resolveMode });
      expect(await self(requestId, { idToken: token })).toEqual({
        status: 200,
        body: { version: 1, status, privacy: null }
      });
      ordered(m, resolveMode);
      expect(resolveMode.mock.invocationCallOrder[0]).toBeLessThan(
        m.connect.mock.invocationCallOrder[0]!
      );
      expect(m.query.mock.calls).toEqual([
        ['BEGIN'],
        ['SET LOCAL ROLE qigong_api_runtime'],
        ["SELECT set_config('qigong.request_id', $1, TRUE)", [requestId]],
        ["SELECT set_config('qigong.person_id', $1, TRUE)", ['']],
        ["SELECT set_config('qigong.principal_id', $1, TRUE)", ['']],
        [statusSql, [subject]],
        ['COMMIT']
      ]);
      expect(m.poolQuery).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it.each([
    [{ active: false, reflectionConsent: false }, 'clear'],
    [activePrivacy, 'clear'],
    [{ ...activePrivacy, required: true }, 'required']
  ] as const)('guided approved preserves minimal privacy %j', async (privacy, expected) => {
    const m = fixture();
    m.state.learner = [{ data: { version: 1, status: 'approved' } }];
    m.state.privacy = [{ data: privacy }];
    const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
    const result = await createVenueEntrySelfStatus(m.pool, m.line, { resolveMode })(requestId, {
      idToken: token
    });
    expect(result).toEqual({
      status: 200,
      body: { version: 1, status: 'approved', privacy: expected }
    });
    ordered(m, resolveMode);
    expect(resolveMode.mock.invocationCallOrder[0]).toBeLessThan(
      m.connect.mock.invocationCallOrder[0]!
    );
    expect(businessQueries(m)).toEqual([
      [statusSql, [subject]],
      [privacySql, ['line', subject]]
    ]);
    expect(m.connect).toHaveBeenCalledOnce();
    expect(m.query).toHaveBeenCalledWith("SELECT set_config('qigong.person_id', $1, TRUE)", ['']);
    expect(m.query).toHaveBeenCalledWith("SELECT set_config('qigong.principal_id', $1, TRUE)", [
      ''
    ]);
    for (const privateValue of [
      subject,
      token,
      secretMarker,
      activePrivacy.hash,
      activePrivacy.version
    ]) {
      expect(JSON.stringify(result)).not.toContain(privateValue);
    }
    expect(m.poolQuery).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('awaits the resolver before opening a private transaction', async () => {
    const m = fixture();
    let releaseMode: ((mode: VenueEntryMode) => void) | undefined;
    const mode = new Promise<VenueEntryMode>((resolve) => {
      releaseMode = resolve;
    });
    const resolveMode = vi.fn<VenueEntryModeResolver>(() => mode);
    const pending = createVenueEntrySelfStatus(m.pool, m.line, { resolveMode })(requestId, {
      idToken: token
    });
    await vi.waitFor(() => expect(resolveMode).toHaveBeenCalledOnce());
    noData(m);
    expect(releaseMode).toBeTypeOf('function');
    releaseMode?.('guided');
    expect((await pending).status).toBe(200);
    ordered(m, resolveMode);
  });
  it('resolves each operation anew without caching identity or mode', async () => {
    const m = fixture();
    const resolveMode = vi
      .fn<VenueEntryModeResolver>()
      .mockResolvedValueOnce('legacy')
      .mockResolvedValueOnce('guided');
    const self = createVenueEntrySelfStatus(m.pool, m.line, { resolveMode });
    expect(await self(requestId, { idToken: token })).toEqual(unsupported);
    noData(m);
    expect((await self(requestId, { idToken: token })).status).toBe(200);
    expect(resolveMode.mock.calls).toEqual([[requestId], [requestId]]);
    expect(m.verifyIdentity.mock.calls).toEqual([[token], [token]]);
    expect(businessQueries(m)).toEqual([[statusSql, [subject]]]);
  });
  it('default pure verifier binds the channel once, then mode, then private SQL', async () => {
    const m = fixture();
    const provider = vi.fn(async () =>
      Response.json({
        sub: subject,
        aud: m.line.loginChannelId,
        exp: Date.now() / 1000 + 600,
        iss: 'https://access.line.me',
        name: secretMarker
      })
    );
    vi.stubGlobal('fetch', provider);
    const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
    const self = createVenueEntrySelfStatus(
      m.pool,
      { loginChannelId: m.line.loginChannelId },
      { resolveMode }
    );
    expect(await self(requestId, { idToken: token })).toEqual({
      status: 200,
      body: { version: 1, status: 'needs_application', privacy: null }
    });
    expect(provider).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenCalledWith(
      'https://api.line.me/oauth2/v2.1/verify',
      expect.objectContaining({
        method: 'POST',
        body: new URLSearchParams({ id_token: token, client_id: m.line.loginChannelId })
      })
    );
    expect(resolveMode).toHaveBeenCalledExactlyOnceWith(requestId);
    expect(provider.mock.invocationCallOrder[0]).toBeLessThan(
      resolveMode.mock.invocationCallOrder[0]!
    );
    expect(resolveMode.mock.invocationCallOrder[0]).toBeLessThan(
      m.connect.mock.invocationCallOrder[0]!
    );
    expect(m.verifyIdentity).not.toHaveBeenCalled();
    expect(businessQueries(m)).toEqual([[statusSql, [subject]]]);
  });
  it.each([
    { iss: 'https://wrong.invalid' },
    { aud: 'another-channel' },
    { exp: 0 },
    { sub: 'forged-subject' }
  ])('default verifier rejects claims %j before mode and DB', async (patch) => {
    const m = fixture();
    const provider = vi.fn(async () =>
      Response.json({
        sub: subject,
        aud: m.line.loginChannelId,
        exp: Date.now() / 1000 + 600,
        iss: 'https://access.line.me',
        ...patch
      })
    );
    vi.stubGlobal('fetch', provider);
    const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
    const self = createVenueEntrySelfStatus(
      m.pool,
      { loginChannelId: m.line.loginChannelId },
      { resolveMode }
    );
    expect(await self(requestId, { idToken: token })).toEqual(invalidIdentity);
    expect(provider).toHaveBeenCalledOnce();
    expect(resolveMode).not.toHaveBeenCalled();
    expect(m.connect).not.toHaveBeenCalled();
    expect(m.query).not.toHaveBeenCalled();
    expect(m.poolQuery).not.toHaveBeenCalled();
  });
  it.each(['signature rejection', 'network rejection'] as const)(
    'default verifier %s is 401 with zero mode calls',
    async (reason) => {
      const m = fixture();
      const provider = vi.fn(async () => {
        if (reason === 'network rejection') throw new Error(secretMarker);
        return Response.json({ error: secretMarker }, { status: 400 });
      });
      vi.stubGlobal('fetch', provider);
      const legacy = vi.fn(async () => subject);
      const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
      const legacyLine: LineConfig = {
        channelSecret: m.line.channelSecret,
        channelAccessToken: m.line.channelAccessToken,
        loginChannelId: m.line.loginChannelId,
        liffId: m.line.liffId,
        verifyIdToken: legacy
      };
      const self = createVenueEntrySelfStatus(m.pool, legacyLine, { resolveMode });
      expect(await self(requestId, { idToken: token })).toEqual(invalidIdentity);
      expect(provider).toHaveBeenCalledOnce();
      expect(legacy).not.toHaveBeenCalled();
      expect(m.verifyIdentity).not.toHaveBeenCalled();
      expect(resolveMode).not.toHaveBeenCalled();
      expect(m.connect).not.toHaveBeenCalled();
      expect(m.query).not.toHaveBeenCalled();
      expect(m.poolQuery).not.toHaveBeenCalled();
    }
  );
  it.each([
    'http://app.example.invalid',
    'https://app.example.invalid/',
    'https://app.example.invalid/path',
    'https://user:pass@app.example.invalid',
    'not a URL'
  ])('still rejects invalid origin configuration without mode calls %s', async (value) => {
    const m = fixture();
    const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
    const app = Fastify({ logger: false, genReqId: () => requestId });
    try {
      expect(() =>
        registerVenueEntryGuidanceRoutes(app, m.pool, m.line, value, { resolveMode })
      ).toThrow();
      expect(resolveMode).not.toHaveBeenCalled();
      untouched(m);
    } finally {
      await app.close();
    }
  });
  it.each([
    'open',
    'before_open',
    'not_activity_day',
    'ended',
    'disabled',
    'not_found',
    'unavailable'
  ] as const)(
    'public GET guided %s calls mode once before the unchanged availability facade',
    async (state) => {
      const m = fixture();
      m.state.availability = [{ data: canonical(state) }];
      const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
      await withApp(
        m,
        async (app) => {
          const response = await app.inject(getUrl + '?venue=' + code);
          expect(response.statusCode).toBe(
            state === 'not_found'
              ? 404
              : state === 'disabled'
                ? 410
                : state === 'unavailable'
                  ? 503
                  : 200
          );
          expect(response.json<unknown>()).toEqual(
            state === 'unavailable' ? unavailable.body : canonical(state)
          );
          privateHeaders(response);
          expect(resolveMode).toHaveBeenCalledExactlyOnceWith(requestId);
          expect(resolveMode.mock.invocationCallOrder[0]).toBeLessThan(
            m.connect.mock.invocationCallOrder[0]!
          );
          expect(businessQueries(m)).toEqual([[availabilitySql, [code]]]);
          expect(m.connect).toHaveBeenCalledOnce();
          expect(m.verifyIdentity).not.toHaveBeenCalled();
          expect(fetch).not.toHaveBeenCalled();
        },
        { resolveMode }
      );
    }
  );
  it.each(['needs_application', 'pending', 'blocked', 'approved'] as const)(
    'HTTP self guided %s verifies once before mode and facade',
    async (status) => {
      const m = fixture();
      m.state.learner = [{ data: { version: 1, status } }];
      const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
      await withApp(
        m,
        async (app) => {
          const response = await app.inject({
            method: 'POST',
            url: postUrl,
            headers,
            payload: { idToken: token }
          });
          expect(response.statusCode).toBe(200);
          expect(response.json<unknown>()).toEqual({
            version: 1,
            status,
            privacy: status === 'approved' ? 'clear' : null
          });
          privateHeaders(response);
          ordered(m, resolveMode);
          expect(resolveMode.mock.invocationCallOrder[0]).toBeLessThan(
            m.connect.mock.invocationCallOrder[0]!
          );
          expect(businessQueries(m)).toEqual(
            status === 'approved'
              ? [
                  [statusSql, [subject]],
                  [privacySql, ['line', subject]]
                ]
              : [[statusSql, [subject]]]
          );
          expect(m.connect).toHaveBeenCalledOnce();
          expect(fetch).not.toHaveBeenCalled();
        },
        { resolveMode }
      );
    }
  );
  it.each([
    ['GET', 'legacy', 404],
    ['GET', 'unavailable', 503],
    ['POST', 'legacy', 404],
    ['POST', 'unavailable', 503]
  ] as const)(
    'HTTP %s %s is fixed %i without facade SQL or a legacy sentinel',
    async (method, mode, status) => {
      const m = fixture();
      const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue(mode);
      await withApp(
        m,
        async (app) => {
          const response = await app.inject(
            method === 'GET'
              ? { url: getUrl + '?venue=' + code }
              : { method, url: postUrl, headers, payload: { idToken: token } }
          );
          expect(response.statusCode).toBe(status);
          expect(response.json<unknown>()).toEqual(unavailable.body);
          privateHeaders(response);
          expect(resolveMode).toHaveBeenCalledExactlyOnceWith(requestId);
          if (method === 'POST') ordered(m, resolveMode);
          else expect(m.verifyIdentity).not.toHaveBeenCalled();
          noData(m);
        },
        { resolveMode }
      );
    }
  );
  it.each(badModes)(
    'HTTP rejects runtime mode %j on both routes without DTOs or diagnostics',
    async (value) => {
      const m = fixture();
      const resolveMode = vi
        .fn<VenueEntryModeResolver>()
        .mockResolvedValue(value as VenueEntryMode);
      await withApp(
        m,
        async (app) => {
          const get = await app.inject(getUrl + '?venue=' + code);
          const post = await app.inject({
            method: 'POST',
            url: postUrl,
            headers,
            payload: { idToken: token }
          });
          for (const response of [get, post]) {
            expect(response.statusCode).toBe(503);
            expect(response.json<unknown>()).toEqual(unavailable.body);
            privateHeaders(response);
          }
          expect(resolveMode.mock.calls).toEqual([[requestId], [requestId]]);
          expect(m.verifyIdentity).toHaveBeenCalledExactlyOnceWith(token);
          noData(m);
        },
        { resolveMode }
      );
    }
  );
  it.each([
    '',
    '?venue=',
    '?venue=UPPER-case',
    '?venue=nohyphen',
    '?venue=tw-test%0A',
    '?venue=tw-test%ZZ',
    '?venue=tw-test%FF',
    '?venue=' + code + '&venue=' + code,
    '?venue=' + code + '&source=nfc',
    '?venue=' + code + '&at_time=now',
    '?venue=' + code + '&subject=' + subject,
    '?venue=' + code + '&personId=' + forgedPerson,
    '?venue=' + code + '&idToken=' + secretMarker,
    '?venue=' + 'x'.repeat(513),
    '?other=' + code,
    '?venue=' + code + '&',
    '?venue=' + code + '?clock=1',
    '?venue=' + code + '&mode=guided',
    '?venue=' + code + '&resolveMode=guided'
  ])('HTTP invalid public query runs before mode %s', async (query) => {
    const m = fixture();
    const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
    await withApp(
      m,
      async (app) => {
        const response = await app.inject(getUrl + query);
        expect(response.statusCode).toBe(400);
        expect(response.json<unknown>()).toEqual(invalidRequest.body);
        privateHeaders(response);
        expect(resolveMode).not.toHaveBeenCalled();
        untouched(m);
      },
      { resolveMode }
    );
  });
  const badPosts: readonly {
    readonly label: string;
    readonly url?: string;
    readonly headers?: Record<string, string>;
    readonly payload?: string;
    readonly status: number;
  }[] = [
    ...[
      { origin: '' },
      { origin: 'https://evil.invalid' },
      { origin: origin + '/' },
      { origin: 'null' },
      { 'x-venue-entry': '' },
      { 'x-venue-entry': 'true' }
    ].map((patch) => ({ label: JSON.stringify(patch), headers: patch, status: 403 })),
    ...['application/jsonp', 'text/plain', ''].map((mime) => ({
      label: 'MIME ' + mime,
      headers: { 'content-type': mime },
      status: 400
    })),
    ...[
      'subject=' + subject,
      'personId=' + forgedPerson,
      'source=nfc',
      'at_time=now',
      'venue=' + code,
      '=',
      'mode=guided'
    ].map((query) => ({ label: query, url: postUrl + '?' + query, status: 400 })),
    ...[
      'subject',
      'personId',
      'principalId',
      'userId',
      'venue',
      'source',
      'at_time',
      'privacy',
      'name',
      'email',
      'phone',
      'mode',
      'resolveMode',
      'meta'
    ].map((key) => ({
      label: 'body ' + key,
      payload: JSON.stringify({ idToken: token, [key]: secretMarker }),
      status: 400
    })),
    { label: 'malformed JSON', payload: '{"idToken":"' + secretMarker + '",', status: 400 },
    {
      label: '6144 body limit',
      payload: JSON.stringify({ idToken: 'x'.repeat(7000) }),
      status: 413
    },
    {
      label: '4096 token limit',
      payload: JSON.stringify({ idToken: 'x'.repeat(4097) }),
      status: 400
    },
    ...['{}', 'null', '{"idToken":""}', '{"idToken":" "}', '{"idToken":42}'].map((payload) => ({
      label: payload,
      payload,
      status: 400
    }))
  ];
  it.each(badPosts)('HTTP rejects $label before mode, provider and DB', async (input) => {
    const m = fixture();
    const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
    await withApp(
      m,
      async (app) => {
        const response = await app.inject({
          method: 'POST',
          url: input.url ?? postUrl,
          headers: { ...headers, ...input.headers },
          payload: input.payload ?? JSON.stringify({ idToken: token })
        });
        expect(response.statusCode).toBe(input.status);
        expect(response.json<unknown>()).toEqual(
          input.status === 403 ? { error: 'invalid_venue_entry_origin' } : invalidRequest.body
        );
        privateHeaders(response);
        expect(resolveMode).not.toHaveBeenCalled();
        untouched(m);
      },
      { resolveMode }
    );
  });
  it('HTTP rejects invalid identity once before calling mode', async () => {
    const m = fixture();
    m.verifyIdentity.mockRejectedValueOnce(new Error(secretMarker));
    const resolveMode = vi.fn<VenueEntryModeResolver>().mockResolvedValue('guided');
    await withApp(
      m,
      async (app) => {
        const response = await app.inject({
          method: 'POST',
          url: postUrl,
          headers,
          payload: { idToken: token }
        });
        expect(response.statusCode).toBe(401);
        expect(response.json<unknown>()).toEqual(invalidIdentity.body);
        privateHeaders(response);
        expect(m.verifyIdentity).toHaveBeenCalledExactlyOnceWith(token);
        expect(resolveMode).not.toHaveBeenCalled();
        noData(m);
      },
      { resolveMode }
    );
  });
  it('HTTP resolver errors stay silent and fixed 503 on both routes without private SQL', async () => {
    const m = fixture();
    const logs: string[] = [];
    const resolveMode = vi
      .fn<VenueEntryModeResolver>()
      .mockRejectedValue(new Error(secretMarker + subject + token));
    const app = Fastify({
      logger: {
        level: 'trace',
        stream: {
          write: (value: string) => {
            logs.push(value);
          }
        }
      },
      genReqId: () => requestId
    });
    registerVenueEntryGuidanceRoutes(app, m.pool, m.line, origin, { resolveMode });
    try {
      const get = await app.inject(getUrl + '?venue=' + code);
      const post = await app.inject({
        method: 'POST',
        url: postUrl,
        headers,
        payload: { idToken: token }
      });
      for (const response of [get, post]) {
        expect(response.statusCode).toBe(503);
        expect(response.json<unknown>()).toEqual(unavailable.body);
        privateHeaders(response);
      }
      for (const privateValue of [secretMarker, subject, token])
        expect(logs.join('\n')).not.toContain(privateValue);
      expect(resolveMode.mock.calls).toEqual([[requestId], [requestId]]);
      expect(m.verifyIdentity).toHaveBeenCalledExactlyOnceWith(token);
      noData(m);
    } finally {
      await app.close();
    }
  });
});

describe('standalone HTTP boundaries (no buildApp or readiness integration)', () => {
  it.each([
    'open',
    'before_open',
    'not_activity_day',
    'ended',
    'disabled',
    'not_found',
    'unavailable'
  ] as const)('anonymous public GET %s has truthful status and privacy headers', async (state) => {
    const m = fixture();
    m.state.availability = [{ data: canonical(state) }];
    await withApp(m, async (app) => {
      const response = await app.inject(getUrl + '?venue=' + code);
      expect(response.statusCode).toBe(
        state === 'not_found'
          ? 404
          : state === 'disabled'
            ? 410
            : state === 'unavailable'
              ? 503
              : 200
      );
      expect(response.json<unknown>()).toEqual(
        state === 'unavailable' ? unavailable.body : canonical(state)
      );
      privateHeaders(response);
      expect(m.verifyIdentity).not.toHaveBeenCalled();
    });
  });
  it.each([
    '',
    '?venue=',
    '?venue=UPPER-case',
    '?venue=nohyphen',
    '?venue=tw-test%0A',
    '?venue=tw-test%ZZ',
    '?venue=tw-test%FF',
    '?venue=' + code + '&venue=' + code,
    '?venue=' + code + '&source=nfc',
    '?venue=' + code + '&at_time=2026-10-26',
    '?venue=' + code + '&subject=' + subject,
    '?venue=' + code + '&personId=' + forgedPerson,
    '?venue=' + code + '&idToken=' + secretMarker,
    '?venue=' + 'x'.repeat(513),
    '?other=' + code,
    '?venue=' + code + '&',
    '?venue=' + code + '?clock=1'
  ])('bad public query %s does no DB or verification', async (query) => {
    const m = fixture();
    await withApp(m, async (app) => {
      const response = await app.inject(getUrl + query);
      expect(response.statusCode).toBe(400);
      expect(response.json<unknown>()).toEqual(invalidRequest.body);
      privateHeaders(response);
      untouched(m);
    });
  });
  it('GET never treats Origin or Host as authorization for public calendar data', async () => {
    const m = fixture();
    await withApp(m, async (app) => {
      const response = await app.inject({
        url: getUrl + '?venue=' + code,
        headers: { origin: 'https://another.invalid', host: 'another.invalid' }
      });
      expect(response.statusCode).toBe(200);
      privateHeaders(response);
    });
  });
  it.each(['needs_application', 'pending', 'blocked', 'approved'] as const)(
    'POST returns only minimal own %s and necessary privacy',
    async (status) => {
      const m = fixture();
      m.state.learner = [{ data: { version: 1, status } }];
      await withApp(m, async (app) => {
        const response = await app.inject({
          method: 'POST',
          url: postUrl,
          headers,
          payload: { idToken: token }
        });
        expect(response.statusCode).toBe(200);
        expect(response.json<unknown>()).toEqual({
          version: 1,
          status,
          privacy: status === 'approved' ? 'clear' : null
        });
        privateHeaders(response);
        expect(response.body).not.toContain(secretMarker);
        expect(businessQueries(m)).toEqual(
          status === 'approved'
            ? [
                [statusSql, [subject]],
                [privacySql, ['line', subject]]
              ]
            : [[statusSql, [subject]]]
        );
      });
    }
  );
  it.each([
    { origin: '' },
    { origin: 'https://evil.invalid' },
    { origin: origin + '/' },
    { origin: 'null' },
    { 'x-venue-entry': '' },
    { 'x-venue-entry': 'true' },
    { 'content-type': 'application/jsonp' },
    { 'content-type': 'text/plain' }
  ])('rejects untrusted headers before provider/DB %j', async (patch) => {
    const m = fixture();
    await withApp(m, async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: postUrl,
        headers: { ...headers, ...patch },
        payload: JSON.stringify({ idToken: token })
      });
      expect([400, 403]).toContain(response.statusCode);
      privateHeaders(response);
      untouched(m);
    });
  });
  it('Host/Forwarded cannot substitute for missing trusted Origin or marker', async () => {
    const m = fixture();
    await withApp(m, async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: postUrl,
        headers: {
          host: 'app.example.invalid',
          forwarded: 'host=app.example.invalid;proto=https',
          'x-forwarded-host': 'app.example.invalid',
          'x-venue-entry': '1',
          'content-type': 'application/json'
        },
        payload: { idToken: token }
      });
      expect(response.statusCode).toBe(403);
      privateHeaders(response);
      untouched(m);
    });
  });
  it.each([
    '?subject=' + subject,
    '?personId=' + forgedPerson,
    '?source=nfc',
    '?at_time=now',
    '?venue=' + code,
    '?='
  ])('rejects any POST query before verification %s', async (query) => {
    const m = fixture();
    await withApp(m, async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: postUrl + query,
        headers,
        payload: { idToken: token }
      });
      expect(response.statusCode).toBe(400);
      privateHeaders(response);
      untouched(m);
    });
  });
  it.each([
    'subject',
    'personId',
    'principalId',
    'userId',
    'venue',
    'source',
    'at_time',
    'privacy',
    'name',
    'email',
    'phone'
  ])('rejects body forgery %s before verification', async (key) => {
    const m = fixture();
    await withApp(m, async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: postUrl,
        headers,
        payload: { idToken: token, [key]: secretMarker }
      });
      expect(response.statusCode).toBe(400);
      privateHeaders(response);
      untouched(m);
    });
  });
  it.each([
    ['{"idToken":"' + secretMarker + '",', 400],
    ['{"idToken":"' + 'x'.repeat(7000) + '"}', 413],
    [JSON.stringify({ idToken: 'x'.repeat(4097) }), 400],
    ['{}', 400],
    ['null', 400]
  ] as const)(
    'sanitizes parser/limit/body errors before verifier and DB, case %#',
    async (payload, status) => {
      const m = fixture();
      await withApp(m, async (app) => {
        const response = await app.inject({ method: 'POST', url: postUrl, headers, payload });
        expect(response.statusCode).toBe(status);
        expect(response.json<unknown>()).toEqual(invalidRequest.body);
        expect(response.body).not.toContain(secretMarker);
        privateHeaders(response);
        untouched(m);
      });
    }
  );
  it('accepts JSON MIME with charset, not a startsWith lookalike', async () => {
    const m = fixture();
    await withApp(m, async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: postUrl,
        headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
        payload: { idToken: token }
      });
      expect(response.statusCode).toBe(200);
      privateHeaders(response);
    });
  });
  it.each([
    'http://app.example.invalid',
    'https://app.example.invalid/',
    'https://app.example.invalid/path',
    'https://user:pass@app.example.invalid',
    'not a URL'
  ])('rejects untrusted server Origin config before DB %s', async (value) => {
    const m = fixture();
    const app = Fastify({ logger: false });
    try {
      expect(() => registerVenueEntryGuidanceRoutes(app, m.pool, m.line, value)).toThrow();
      untouched(m);
    } finally {
      await app.close();
    }
  });
  it('sanitizes backend and verifier exceptions on HTTP without converting them into a learner state', async () => {
    const m = fixture();
    m.verifyIdentity.mockRejectedValueOnce(new Error(secretMarker));
    await withApp(m, async (app) => {
      const auth = await app.inject({
        method: 'POST',
        url: postUrl,
        headers,
        payload: { idToken: token }
      });
      expect(auth.statusCode).toBe(401);
      expect(auth.json<unknown>()).toEqual({ error: 'invalid_line_identity' });
      privateHeaders(auth);
      expect(auth.body).not.toContain(secretMarker);
      m.state.failSql = statusSql;
      const db = await app.inject({
        method: 'POST',
        url: postUrl,
        headers,
        payload: { idToken: token }
      });
      expect(db.statusCode).toBe(503);
      expect(db.json<unknown>()).toEqual(unavailable.body);
      privateHeaders(db);
      expect(db.body).not.toContain(secretMarker);
    });
  });
  it('does not log hostile query, malformed body, token, provider profile or raw SQL diagnostics', async () => {
    const m = fixture();
    const logs: string[] = [];
    const app = Fastify({
      logger: {
        level: 'trace',
        stream: {
          write: (value: string) => {
            logs.push(value);
          }
        }
      },
      genReqId: () => requestId
    });
    registerVenueEntryGuidanceRoutes(app, m.pool, m.line, origin);
    try {
      await app.inject(getUrl + '?idToken=' + secretMarker);
      await app.inject({
        method: 'POST',
        url: postUrl,
        headers,
        payload: '{"idToken":"' + secretMarker
      });
      m.state.failSql = statusSql;
      const response = await app.inject({
        method: 'POST',
        url: postUrl,
        headers,
        payload: { idToken: token }
      });
      expect(response.statusCode).toBe(503);
      privateHeaders(response);
      expect(logs.join('\n')).not.toContain(secretMarker);
      expect(logs.join('\n')).not.toContain(token);
      expect(logs.join('\n')).not.toContain(subject);
      expect(response.body).not.toContain(secretMarker);
    } finally {
      await app.close();
    }
  });
});
