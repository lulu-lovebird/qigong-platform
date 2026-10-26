import type { Pool, PoolClient } from '@qigong/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLineLearnerIdentityAdapter } from '../src/line-learner-identity.js';
import { verifyLineIdentity, type VerifiedLineIdentity } from '../src/line-profile.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const personId = '22222222-2222-4222-8222-222222222222';
const identityId = '33333333-3333-4333-8333-333333333333';
const subject = 'U' + 'a'.repeat(32);
const token = 'synthetic-id-token';
const channelId = '123';
// Test-only resolver SQL, NOT an existing or newly shipped production function.
const mappingSql = 'SELECT test_only.resolve_line_learner($1) AS data';
const privacySql = 'SELECT platform.privacy_usage($1,$2) AS data';
const eligible = {
  subject,
  personId,
  identityId,
  revoked: false,
  learnerActive: true,
  channelActive: true,
  applicationApproved: true
};
const consent = {
  active: true,
  required: false,
  unavailable: false,
  reflectionConsent: false,
  version: 'current-test-policy',
  hash: 'a'.repeat(64)
};
const fixture = () => {
  const state: { mapping: unknown; privacy: unknown } = { mapping: eligible, privacy: consent };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === mappingSql) {
      expect(values).toEqual([subject]);
      return { rows: [{ data: state.mapping }] };
    }
    if (sql === privacySql) {
      expect(values).toEqual(['line', subject]);
      return { rows: [{ data: state.privacy }] };
    }
    return { rows: [] };
  });
  const release = vi.fn<PoolClient['release']>();
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const poolQuery = vi.fn(() => {
    throw new Error('Direct pool access forbidden');
  });
  const pool = { connect, query: poolQuery } as unknown as Pool;
  const verify = vi.fn(async (_token: string, _channel: string): Promise<VerifiedLineIdentity> => {
    expect(_token).toBe(token);
    expect(_channel).toBe(channelId);
    expect(connect).not.toHaveBeenCalled();
    return { subject, displayName: 'Private provider name' };
  });
  const resolveLearner = vi.fn(async (runtime: PoolClient, verifiedSubject: string) => {
    expect(runtime).toBe(client);
    return (await runtime.query<{ data: unknown }>(mappingSql, [verifiedSubject])).rows[0]?.data;
  });
  const options = { loginChannelId: channelId, verifyIdentity: verify, resolveLearner };
  const authenticate = createLineLearnerIdentityAdapter(pool, options);
  return {
    state,
    query,
    release,
    connect,
    poolQuery,
    pool,
    verify,
    resolveLearner,
    options,
    authenticate
  };
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('External API forbidden');
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Trusted LINE identity adapter (mock DB, no production resolver)', () => {
  it.each([
    undefined,
    null,
    {},
    { idToken: '' },
    { idToken: ' ' },
    { idToken: 42 },
    { idToken: 'a'.repeat(4097) },
    { personId },
    { idToken: token, personId },
    { idToken: token, volunteerId: personId },
    { idToken: token, subject },
    { idToken: token, principalId: personId }
  ])('does not verify or connect for missing/invalid/self-claimed credential %j', async (input) => {
    const f = fixture();
    expect(await f.authenticate(requestId, input)).toEqual({
      ok: false,
      statusCode: 401,
      error: 'invalid_line_identity'
    });
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.resolveLearner).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['expired', 'wrong channel', 'wrong issuer', 'forged JWT'])(
    'stops before DB when the injected verifier rejects %s',
    async (reason) => {
      const f = fixture();
      f.verify.mockRejectedValue(new Error(`${reason}: ${token}`));
      expect(await f.authenticate(requestId, { idToken: token })).toEqual({
        ok: false,
        statusCode: 401,
        error: 'invalid_line_identity'
      });
      expect(f.verify).toHaveBeenCalledWith(token, channelId);
      expect(f.connect).not.toHaveBeenCalled();
      expect(f.resolveLearner).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it.each([
    { exp: 0 },
    { aud: 'other' },
    { iss: 'https://wrong.example.invalid' },
    { iss: undefined }
  ])('also rejects real verifier claim failures with mocked fetch: %j', async (patch) => {
    const f = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          sub: subject,
          exp: Math.floor(Date.now() / 1000) + 600,
          aud: channelId,
          iss: 'https://access.line.me',
          ...patch
        })
      )
    );
    const authenticate = createLineLearnerIdentityAdapter(f.pool, {
      ...f.options,
      verifyIdentity: verifyLineIdentity
    });
    expect(await authenticate(requestId, { idToken: token })).toEqual({
      ok: false,
      statusCode: 401,
      error: 'invalid_line_identity'
    });
    expect(f.connect).not.toHaveBeenCalled();
  });

  it('defaults to the existing LINE verifier, with only an offline endpoint response', async () => {
    const f = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          sub: subject,
          exp: Math.floor(Date.now() / 1000) + 600,
          aud: channelId,
          iss: 'https://access.line.me'
        })
      )
    );
    const authenticate = createLineLearnerIdentityAdapter(f.pool, {
      loginChannelId: channelId,
      resolveLearner: f.resolveLearner
    });
    expect((await authenticate(requestId, { idToken: token })).ok).toBe(true);
    expect(f.verify).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed verifier output before DB access', async () => {
    const f = fixture();
    f.verify.mockResolvedValue({ subject: personId });
    expect((await f.authenticate(requestId, { idToken: token })).ok).toBe(false);
    expect(f.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', null],
    ['revoked', { ...eligible, revoked: true }],
    ['suspended', { ...eligible, learnerActive: false }],
    ['inactive/expired/future channel', { ...eligible, channelActive: false }],
    ['unapproved application', { ...eligible, applicationApproved: false }],
    ['different subject', { ...eligible, subject: 'U' + 'b'.repeat(32) }]
  ])(
    'denies %s mapping without reading privacy or returning a person',
    async (_reason, mapping) => {
      const f = fixture();
      f.state.mapping = mapping;
      expect(await f.authenticate(requestId, { idToken: token })).toEqual({
        ok: false,
        statusCode: 403,
        error: 'learner_identity_unavailable'
      });
      expect(f.query.mock.calls.some(([sql]) => sql === privacySql)).toBe(false);
      expect(f.release).toHaveBeenCalledOnce();
      expect(f.poolQuery).not.toHaveBeenCalled();
    }
  );

  it.each([
    {},
    { ...eligible, personId: 'forged' },
    { ...eligible, identityId: null },
    { ...eligible, revoked: undefined },
    { ...eligible, volunteerId: personId }
  ])('fails closed on malformed DB mapping %j', async (mapping) => {
    const f = fixture();
    f.state.mapping = mapping;
    expect(await f.authenticate(requestId, { idToken: token })).toEqual({
      ok: false,
      statusCode: 503,
      error: 'line_identity_unavailable'
    });
    expect(f.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(f.release).toHaveBeenCalledOnce();
  });

  it.each([
    [{ ...consent, required: true }, 'privacy_acceptance_required'],
    [{ ...consent, unavailable: true }, 'learner_identity_unavailable']
  ])('denies current privacy/eligibility status %j', async (privacy, error) => {
    const f = fixture();
    f.state.privacy = privacy;
    expect(await f.authenticate(requestId, { idToken: token })).toEqual({
      ok: false,
      statusCode: 403,
      error
    });
  });

  it.each([
    null,
    {},
    { active: true },
    { ...consent, hash: null },
    { active: false, reflectionConsent: true, required: true },
    { active: false, reflectionConsent: true, unavailable: true }
  ])('does not interpret malformed/missing privacy as consent: %j', async (privacy) => {
    const f = fixture();
    f.state.privacy = privacy;
    expect(await f.authenticate(requestId, { idToken: token })).toEqual({
      ok: false,
      statusCode: 503,
      error: 'line_identity_unavailable'
    });
    expect(f.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it.each([
    ['privacy acceptance required', 403, 'privacy_acceptance_required'],
    ['learner eligibility unavailable', 403, 'learner_identity_unavailable'],
    [`DB diagnostics ${token} ${subject}`, 503, 'line_identity_unavailable']
  ])('sanitizes controlled DB errors: %s', async (message, statusCode, error) => {
    const f = fixture();
    f.query.mockImplementation(async (sql) => {
      if (sql === privacySql) throw new Error(String(message));
      return { rows: [{ data: eligible }] };
    });
    expect(await f.authenticate(requestId, { idToken: token })).toEqual({
      ok: false,
      statusCode,
      error
    });
    expect(f.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(f.release).toHaveBeenCalledOnce();
  });

  it('returns only an identity snapshot and existing privacy under a cleared runtime context', async () => {
    const f = fixture();
    expect(await f.authenticate(requestId, { idToken: token })).toEqual({
      ok: true,
      identity: { platform: 'line', subject, identityId, personId },
      privacy: {
        active: true,
        reflectionConsent: false,
        version: consent.version,
        hash: consent.hash
      }
    });
    expect(f.query.mock.calls).toEqual([
      ['BEGIN'],
      ['SET LOCAL ROLE qigong_api_runtime'],
      ["SELECT set_config('qigong.request_id', $1, TRUE)", [requestId]],
      ["SELECT set_config('qigong.person_id', $1, TRUE)", ['']],
      ["SELECT set_config('qigong.principal_id', $1, TRUE)", ['']],
      [mappingSql, [subject]],
      [privacySql, ['line', subject]],
      ['COMMIT']
    ]);
    expect(f.resolveLearner).toHaveBeenCalledOnce();
    expect(f.poolQuery).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledExactlyOnceWith();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves the existing no-active-policy state without inventing an acceptance', async () => {
    const f = fixture();
    f.state.privacy = { active: false, reflectionConsent: true };
    const result = await f.authenticate(requestId, { idToken: token });
    expect(result.ok && result.privacy).toEqual({
      active: false,
      reflectionConsent: true,
      version: null,
      hash: null
    });
  });

  it('does not cache mapping or eligibility across requests', async () => {
    const f = fixture();
    f.verify.mockImplementation(async () => ({ subject }));
    expect((await f.authenticate(requestId, { idToken: token })).ok).toBe(true);
    f.state.mapping = { ...eligible, revoked: true };
    expect(await f.authenticate(requestId, { idToken: token })).toEqual({
      ok: false,
      statusCode: 403,
      error: 'learner_identity_unavailable'
    });
    expect(f.resolveLearner).toHaveBeenCalledTimes(2);
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(f.release).toHaveBeenCalledTimes(2);
  });

  it('never returns success if COMMIT fails', async () => {
    const f = fixture();
    const original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, values) => {
      if (sql === 'COMMIT') throw new Error('Commit failed');
      return original(sql, values);
    });
    expect(await f.authenticate(requestId, { idToken: token })).toEqual({
      ok: false,
      statusCode: 503,
      error: 'line_identity_unavailable'
    });
    expect(f.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(f.release).toHaveBeenCalledOnce();
  });

  it('discards the runtime client when rollback fails without leaking diagnostics', async () => {
    const f = fixture();
    const original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, values) => {
      if (sql === privacySql || sql === 'ROLLBACK') throw new Error(`DB failure ${token}`);
      return original(sql, values);
    });
    expect(await f.authenticate(requestId, { idToken: token })).toEqual({
      ok: false,
      statusCode: 503,
      error: 'line_identity_unavailable'
    });
    expect(f.release).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
    expect(f.poolQuery).not.toHaveBeenCalled();
  });

  it('does not use an invalid server request ID as a context', async () => {
    const f = fixture();
    expect(await f.authenticate('untrusted-request-id', { idToken: token })).toEqual({
      ok: false,
      statusCode: 503,
      error: 'line_identity_unavailable'
    });
    expect(f.connect).not.toHaveBeenCalled();
  });

  it('fails closed on connection failure without retrying through pool.query', async () => {
    const f = fixture();
    f.connect.mockRejectedValue(new Error('Connection denied'));
    expect(await f.authenticate(requestId, { idToken: token })).toEqual({
      ok: false,
      statusCode: 503,
      error: 'line_identity_unavailable'
    });
    expect(f.poolQuery).not.toHaveBeenCalled();
  });
});
