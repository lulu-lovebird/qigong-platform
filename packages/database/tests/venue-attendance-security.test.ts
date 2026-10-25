import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from '../src/index.js';
import {
  VENUE_ATTENDANCE_PERMISSIONS,
  VENUE_ATTENDANCE_TIME_ZONE,
  countVenueAttendanceDays,
  parseVenueAttendanceAdminOperation,
  resolveLineLearnerIdentity,
  runVenueAttendanceAdminOperation
} from '../src/index.js';

// Pure/static/mock tests ONLY. No env loading, pool construction, migration or network.
const migration = readFileSync(
  new URL('../../../migrations/0049_venue_attendance_security_contract.sql', import.meta.url),
  'utf8'
);
const normalize = (source: string) =>
  source
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const functionBody = (source: string, name: string) => {
  const start = source.indexOf(`CREATE FUNCTION ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = source.indexOf('$$;', start);
  assert.ok(end > start);
  return normalize(source.slice(start, end));
};
const guardNames = [
  'admin.venue_attendance_read_fields',
  'admin.venue_attendance_write_field',
  'admin.venue_attendance_read_attendance'
] as const;
const assertSecurityContract = (source: string) => {
  const sql = normalize(source);
  assert.ok(sql.startsWith('SET LOCAL search_path = pg_catalog;'));
  assert.doesNotMatch(
    sql,
    /\b(BYPASSRLS|SUPERUSER|SET ROLE|ALTER ROLE|DROP POLICY|ALTER POLICY)\b/
  );
  assert.doesNotMatch(sql, /\b(ALTER TABLE|DELETE FROM|UPDATE|TRUNCATE|CREATE TABLE)\b/);
  assert.doesNotMatch(sql, /core\.(practice_fields|field_attendance|checkins)\b/);
  assert.doesNotMatch(sql, /GRANT (?:ALL|SELECT ON|INSERT|UPDATE|DELETE)|ALL TABLES|ALL FUNCTIONS/);
  assert.equal((sql.match(/SECURITY DEFINER/g) ?? []).length, 1);
  assert.equal((sql.match(/CREATE FUNCTION/g) ?? []).length, 5);
  assert.equal((sql.match(/CREATE POLICY/g) ?? []).length, 4);
  assert.ok(sql.includes('CREATE ROLE qigong_venue_identity NOLOGIN NOINHERIT NOSUPERUSER'));
  assert.ok(sql.includes('NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'));
  assert.ok(
    sql.includes('NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls')
  );
  assert.ok(sql.includes('WHERE roleid = resolver_role OR member = resolver_role'));
  assert.ok(sql.includes("refobjid = resolver_role AND deptype IN ('a', 'o')"));
  assert.ok(sql.includes("RAISE EXCEPTION 'unsafe venue identity function owner'"));
  assert.ok(sql.includes('SET search_path = pg_catalog SET row_security = on'));
  assert.ok(
    sql.includes(
      'ALTER FUNCTION platform.resolve_line_learner_identity(TEXT) OWNER TO qigong_venue_identity;'
    )
  );
  assert.ok(sql.includes('pg_catalog.aclexplode(routine.proacl)'));
  assert.ok(sql.includes('acl.grantee <> target.proowner'));
  assert.ok(sql.includes('FROM PUBLIC CASCADE'));
  assert.ok(sql.includes('FROM %I CASCADE'));
  assert.ok(sql.endsWith('TO qigong_api_runtime;'));
  const grants = sql.match(/GRANT [^;]+;/g) ?? [];
  assert.equal(grants.length, 6);
  assert.ok(grants.slice(0, 5).every((grant) => grant.endsWith('TO qigong_venue_identity;')));
  assert.equal((sql.match(/INSERT INTO/g) ?? []).length, 1);
  assert.ok(sql.includes('INSERT INTO admin.permissions (code, description)'));
  assert.doesNotMatch(sql, /INSERT INTO admin\.(role_grants|role_permissions)/);
  for (const name of guardNames) {
    const body = functionBody(source, name);
    assert.ok(body.includes('SECURITY INVOKER SET search_path = pg_catalog'));
    assert.ok(body.includes('IF NOT admin.venue_attendance_authorized('));
    assert.ok(body.includes("ERRCODE = '42501', MESSAGE = 'venue_attendance_forbidden'"));
    assert.ok(body.endsWith("ERRCODE = '55000', MESSAGE = 'venue_attendance_quarantined'; END;"));
    assert.doesNotMatch(body, /RETURN QUERY|RETURN NULL|RETURN '\[\]'|EXECUTE/);
  }
  const authorization = functionBody(source, 'admin.venue_attendance_authorized');
  for (const clause of [
    'SECURITY INVOKER',
    'admin.request_id() IS NULL',
    'admin.request_person_id() IS NOT NULL',
    'session_principal := admin.session_principal(input_session_token)',
    'admin.request_principal_id() IS DISTINCT FROM session_principal',
    'admin.can_access_region(operational.id, required_permission)',
    "operational.region_type = 'operational'",
    'AND operational.active',
    'AND country.active',
    'AND global_region.active',
    'IF required_permission IS NULL THEN RETURN FALSE'
  ])
    assert.ok(authorization.includes(clause), clause);
  assert.doesNotMatch(authorization, /can_access_person|has_permission|request_person_id\(\)\s*=/);
};

const requestId = '10000000-0000-4000-8000-000000000001';
const regionId = '20000000-0000-4000-8000-000000000002';
const principalId = '30000000-0000-4000-8000-000000000003';
const fieldId = '40000000-0000-4000-8000-000000000004';
const personId = '50000000-0000-4000-8000-000000000005';
const identityId = '60000000-0000-4000-8000-000000000006';
const subject = `U${'a'.repeat(32)}`;
const token = 'test_only_session_credential_1234567890';
const read = { operation: 'field.read', regionId };
const write = {
  operation: 'field.write',
  regionId,
  fieldId,
  change: { nameZhTw: '甲場', isActive: true }
};
const attendance = {
  operation: 'attendance.read',
  regionId,
  from: '2026-10-01',
  until: '2026-11-01'
};
const mapping = {
  subject,
  identityId,
  personId,
  revoked: false,
  learnerActive: true,
  channelActive: true,
  applicationApproved: true
};
const dbError = (code: string, message: string) => Object.assign(new Error(message), { code });

interface HarnessOptions {
  readonly session?: unknown;
  readonly operationError?: Error | null;
  readonly commitError?: boolean;
  readonly rollbackError?: boolean;
}
const harness = (options: HarnessOptions = {}) => {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === 'SELECT admin.session_principal($1) AS principal_id' && values?.[0] === token)
      return {
        rows: [{ principal_id: Object.hasOwn(options, 'session') ? options.session : principalId }]
      };
    if (sql.startsWith('SELECT admin.venue_attendance_')) {
      const error = Object.hasOwn(options, 'operationError')
        ? options.operationError
        : dbError('55000', 'venue_attendance_quarantined');
      if (error) throw error;
      return { rows: [{ data: { shouldNeverEscape: true } }] };
    }
    if (sql === 'COMMIT' && options.commitError) throw new Error('private commit diagnostic');
    if (sql === 'ROLLBACK' && options.rollbackError) throw new Error('private rollback diagnostic');
    return { rows: [] };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const poolQuery = vi.fn(() => {
    throw new Error('pool.query is prohibited');
  });
  return {
    pool: { connect, query: poolQuery } as unknown as Pool,
    client,
    query,
    connect,
    poolQuery,
    release
  };
};
const resolverClient = (rows: readonly { data: unknown }[]) => {
  const query = vi.fn().mockResolvedValue({ rows });
  return { client: { query } as unknown as Pick<PoolClient, 'query'>, query };
};

describe('團練場出席管理: static SQL contracts, NOT PostgreSQL evidence', () => {
  it('uses the previously vacant 0049 number exactly once', () => {
    expect(
      readdirSync(new URL('../../../migrations/', import.meta.url)).filter((file) =>
        file.startsWith('0049_')
      )
    ).toEqual(['0049_venue_attendance_security_contract.sql']);
  });
  it('preserves 0047 and 0048 byte-for-byte', () => {
    for (const [file, hash] of [
      [
        '0047_practice_fields_and_nfc_attendance.sql',
        'dc76f54c1815dd0fce115c0bf8f9ab2126ca18044cc35a26d237a1afee2974b4'
      ],
      [
        '0048_nfc_attendance_security_quarantine.sql',
        '2eda67d88dfb6655e92271592af7780954d93c59289becbf07de1f946465b251'
      ]
    ]) {
      expect(
        createHash('sha256')
          .update(readFileSync(new URL(`../../../migrations/${file}`, import.meta.url)))
          .digest('hex')
      ).toBe(hash);
    }
  });
  it('keeps every table quarantined and uses explicit non-owner identity RLS', () => {
    assertSecurityContract(migration);
  });
  it('requires every identity relationship and active interval, not just a matching UUID', () => {
    const sql = functionBody(migration, 'platform.resolve_line_learner_identity');
    for (const clause of [
      "input_subject ~ '^U[0-9a-f]{32}$'",
      "person.status = 'active'",
      "linked.platform = 'line'",
      'linked.external_subject_id = input_subject',
      'linked.revoked_at IS NULL',
      'linked.verified_at <= CURRENT_TIMESTAMP',
      'application.person_id = person.id',
      "application.platform = 'line'",
      'application.external_subject_id = input_subject',
      "application.status = 'approved'",
      'channel.person_id = person.id',
      'channel.platform_identity_id = linked.id',
      'channel.valid_from <= CURRENT_TIMESTAMP',
      '(channel.valid_to IS NULL OR channel.valid_to > CURRENT_TIMESTAMP)'
    ])
      expect(sql).toContain(clause);
    expect(sql).not.toMatch(
      /request_person_id|request_principal_id|set_config|display_name|legal_name|phone|email|LIMIT 1/
    );
  });
  it('separates all four RBAC operations without automatic role grants', () => {
    for (const [action, permission] of Object.entries(VENUE_ATTENDANCE_PERMISSIONS)) {
      expect(functionBody(migration, 'admin.venue_attendance_authorized')).toContain(
        `WHEN '${action}' THEN '${permission}'`
      );
    }
    expect(
      Object.values(VENUE_ATTENDANCE_PERMISSIONS).some((permission) =>
        /checkin|private_note/.test(permission)
      )
    ).toBe(false);
  });
  it('bounds write payloads and read/export date windows at the SQL boundary', () => {
    const sql = normalize(migration);
    expect(sql).toContain("input_change ?& ARRAY['nameZhTw', 'isActive']");
    expect(sql).toContain(
      "(input_change - ARRAY['nameZhTw', 'isActive']) <> '{}'::pg_catalog.jsonb"
    );
    expect(sql).toContain('input_field_id IS NULL');
    expect(sql).toContain('input_until <= input_from OR input_until - input_from > 366');
    expect(sql).toContain(
      "CASE WHEN input_export THEN 'attendance.export' ELSE 'attendance.read' END"
    );
  });
  it('retains atomic per-person/per-field/Taipei-day uniqueness, with no cross-field index', () => {
    const baseline = normalize(
      readFileSync(
        new URL('../../../migrations/0047_practice_fields_and_nfc_attendance.sql', import.meta.url),
        'utf8'
      )
    );
    expect(baseline).toContain(
      "ON core.field_attendance(person_id, field_id, ((checkin_at AT TIME ZONE 'Asia/Taipei')::date))"
    );
  });
  it.each([
    ['owner bypass', '\nALTER TABLE core.field_attendance NO FORCE ROW LEVEL SECURITY;'],
    ['broad grant', '\nGRANT SELECT ON identity.people TO qigong_api_runtime;'],
    [
      'quarantine table grant',
      '\nGRANT SELECT (id) ON core.practice_fields TO qigong_api_runtime;'
    ],
    ['membership escalation', '\nGRANT qigong_venue_identity TO qigong_api_runtime;'],
    ['automatic role promotion', '\nINSERT INTO admin.role_permissions SELECT NULL, NULL;'],
    ['daily practice coupling', '\nUPDATE core.checkins SET updated_at = CURRENT_TIMESTAMP;']
  ])('detects appended %s', (_name, addition) => {
    expect(() => assertSecurityContract(migration + addition)).toThrow();
  });
  it.each([
    'SET row_security = on',
    'WHERE roleid = resolver_role OR member = resolver_role',
    "refobjid = resolver_role AND deptype IN ('a', 'o')",
    'admin.request_person_id() IS NOT NULL',
    'admin.request_principal_id() IS DISTINCT FROM session_principal',
    'admin.can_access_region(operational.id, required_permission)',
    'AND country.active',
    'pg_catalog.aclexplode(routine.proacl)',
    'FROM %I CASCADE'
  ])('detects removal of %s', (clause) => {
    expect(() => assertSecurityContract(migration.replace(clause, 'TRUE'))).toThrow();
  });
  it.each(guardNames)('detects falsely successful quarantine guard %s', (name) => {
    const start = migration.indexOf(`CREATE FUNCTION ${name}(`);
    const before = migration.slice(0, start);
    const after = migration
      .slice(start)
      .replace(
        "RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'venue_attendance_quarantined';",
        'RETURN NULL;'
      );
    expect(() => assertSecurityContract(before + after)).toThrow();
  });
});

describe('strict data-minimized operation contract', () => {
  it.each([read, write, attendance, { ...attendance, operation: 'attendance.export' }])(
    'accepts bounded operation $operation',
    (input) => {
      expect(parseVenueAttendanceAdminOperation(input)).toEqual(input);
      expect(Object.isFrozen(parseVenueAttendanceAdminOperation(input))).toBe(true);
    }
  );
  it('clones and freezes metadata instead of retaining mutable request state', () => {
    const change = { nameZhTw: '  甲場  ', isActive: false };
    const parsed = parseVenueAttendanceAdminOperation({ ...write, change });
    expect(parsed.operation).toBe('field.write');
    if (parsed.operation !== 'field.write') throw new Error('wrong fixture');
    expect(parsed.change).toEqual({ nameZhTw: '甲場', isActive: false });
    expect(Object.isFrozen(parsed.change)).toBe(true);
    change.nameZhTw = 'changed';
    expect(parsed.change.nameZhTw).toBe('甲場');
  });
  it.each([
    'personId',
    'volunteerPersonId',
    'principalId',
    'subject',
    'checkinId',
    'idToken',
    'user_latitude',
    'user_longitude',
    'student_note'
  ])('rejects identity/private field %s before DB', (key) => {
    expect(() => parseVenueAttendanceAdminOperation({ ...read, [key]: 'untrusted' })).toThrow(
      'invalid venue attendance input'
    );
    expect(() =>
      parseVenueAttendanceAdminOperation({
        ...write,
        change: { ...write.change, [key]: 'untrusted' }
      })
    ).toThrow();
  });
  it.each([
    null,
    [],
    {},
    { ...read, regionId: 'not-uuid' },
    { ...read, operation: 'attendance.manual' },
    { ...write, fieldId: personId, volunteerPersonId: personId },
    { ...write, change: { isActive: true } },
    { ...write, change: { nameZhTw: ' ', isActive: true } },
    { ...write, change: { nameZhTw: 'x'.repeat(121), isActive: true } },
    { ...write, change: { nameZhTw: 'x\u0000', isActive: true } },
    { ...write, change: { nameZhTw: '甲', isActive: 'true' } },
    { ...attendance, from: '0000-01-01' },
    { ...attendance, from: '2026-02-30' },
    { ...attendance, from: '2026-10-1' },
    { ...attendance, from: '2026-11-01' },
    { ...attendance, until: 'infinity' },
    { ...attendance, until: '2027-11-01' }
  ])('rejects malformed/overbroad input %#', (input) => {
    expect(() => parseVenueAttendanceAdminOperation(input)).toThrow();
  });
  it('accepts leap days and the exact 366-day upper bound', () => {
    expect(
      parseVenueAttendanceAdminOperation({ ...attendance, from: '2024-02-29', until: '2025-03-01' })
    ).toMatchObject({ from: '2024-02-29' });
  });
});

describe('adapter-compatible LINE resolver: mock DB only', () => {
  it('calls only the dedicated parameterized function; returns the minimal immutable mapping', async () => {
    const { client, query } = resolverClient([{ data: mapping }]);
    const result = await resolveLineLearnerIdentity(client, subject);
    expect(result).toEqual(mapping);
    expect(Object.isFrozen(result)).toBe(true);
    expect(query).toHaveBeenCalledExactlyOnceWith(
      'SELECT platform.resolve_line_learner_identity($1) AS data',
      [subject]
    );
  });
  it('returns null for the SQL null mapping, not fabricated identity flags', async () => {
    const { client } = resolverClient([{ data: null }]);
    expect(await resolveLineLearnerIdentity(client, subject)).toBeNull();
  });
  it.each(['', 'Ubad', `U${'A'.repeat(32)}`, personId, "' OR TRUE --"])(
    'rejects unverified-shape subject %s before query',
    async (invalid) => {
      const { client, query } = resolverClient([{ data: mapping }]);
      await expect(resolveLineLearnerIdentity(client, invalid)).rejects.toThrow(
        'invalid venue attendance input'
      );
      expect(query).not.toHaveBeenCalled();
    }
  );
  it.each([
    undefined,
    {},
    [],
    { ...mapping, subject: `U${'b'.repeat(32)}` },
    { ...mapping, identityId: 'bad' },
    { ...mapping, personId: null },
    { ...mapping, revoked: true },
    { ...mapping, learnerActive: false },
    { ...mapping, channelActive: false },
    { ...mapping, applicationApproved: false },
    { ...mapping, displayName: 'private' },
    { ...mapping, revoked: 'false' }
  ])('rejects malformed/ineligible mapping %# without data echo', async (data) => {
    const { client } = resolverClient([{ data }]);
    await expect(resolveLineLearnerIdentity(client, subject)).rejects.toThrow(
      'invalid venue attendance database contract'
    );
  });
  it.each([{ rows: [] }, { rows: [{ data: mapping }, { data: mapping }] }])(
    'rejects missing/ambiguous SQL row contract %#',
    async ({ rows }) => {
      const { client } = resolverClient(rows);
      await expect(resolveLineLearnerIdentity(client, subject)).rejects.toThrow(
        'invalid venue attendance database contract'
      );
    }
  );
});

describe('credential-bound admin transaction: mock SQL order, not RLS evidence', () => {
  it.each([
    [read, 'SELECT admin.venue_attendance_read_fields($1, $2) AS data', [token, regionId]],
    [
      write,
      'SELECT admin.venue_attendance_write_field($1, $2, $3, $4) AS data',
      [token, regionId, fieldId, JSON.stringify(write.change)]
    ],
    [
      attendance,
      'SELECT admin.venue_attendance_read_attendance($1, $2, $3, $4, $5) AS data',
      [token, regionId, attendance.from, attendance.until, false]
    ],
    [
      { ...attendance, operation: 'attendance.export' },
      'SELECT admin.venue_attendance_read_attendance($1, $2, $3, $4, $5) AS data',
      [token, regionId, attendance.from, attendance.until, true]
    ]
  ])('keeps $operation quarantined and parameterized', async (input, sql, values) => {
    const db = harness();
    expect(await runVenueAttendanceAdminOperation(db.pool, requestId, token, input)).toEqual({
      ok: false,
      error: 'quarantined'
    });
    expect(db.query.mock.calls).toEqual([
      ['BEGIN'],
      ['SET LOCAL ROLE qigong_api_runtime'],
      ["SELECT set_config('qigong.request_id', $1, TRUE)", [requestId]],
      ["SELECT set_config('qigong.person_id', $1, TRUE)", ['']],
      ["SELECT set_config('qigong.principal_id', $1, TRUE)", ['']],
      ['SELECT admin.session_principal($1) AS principal_id', [token]],
      ["SELECT set_config('qigong.principal_id', $1, TRUE)", [principalId]],
      [sql, values],
      ['ROLLBACK']
    ]);
    expect(db.poolQuery).not.toHaveBeenCalled();
    expect(db.release).toHaveBeenCalledExactlyOnceWith();
  });
  it.each(['personId', 'principalId', 'volunteerPersonId', 'subject'])(
    'does not connect for forged %s in request',
    async (key) => {
      const db = harness();
      expect(
        await runVenueAttendanceAdminOperation(db.pool, requestId, token, {
          ...read,
          [key]: principalId
        })
      ).toEqual({ ok: false, error: 'invalid_request' });
      expect(db.connect).not.toHaveBeenCalled();
    }
  );
  it.each(['', 'short', 'x'.repeat(129), ' '.repeat(40), 'a'.repeat(40) + "'"])(
    'does not connect for malformed credential %#',
    async (credential) => {
      const db = harness();
      expect(await runVenueAttendanceAdminOperation(db.pool, requestId, credential, read)).toEqual({
        ok: false,
        error: 'unauthenticated'
      });
      expect(db.connect).not.toHaveBeenCalled();
    }
  );
  it('rejects invalid request IDs before connect', async () => {
    const db = harness();
    expect(await runVenueAttendanceAdminOperation(db.pool, 'forged', token, read)).toEqual({
      ok: false,
      error: 'invalid_request'
    });
    expect(db.connect).not.toHaveBeenCalled();
  });
  it('does not install a principal or call operations for missing/expired/revoked session', async () => {
    const db = harness({ session: null });
    expect(await runVenueAttendanceAdminOperation(db.pool, requestId, token, read)).toEqual({
      ok: false,
      error: 'unauthenticated'
    });
    expect(
      db.query.mock.calls.some(([sql]) => sql.startsWith('SELECT admin.venue_attendance_'))
    ).toBe(false);
    expect(db.query.mock.calls.at(-1)).toEqual(['COMMIT']);
  });
  it.each([undefined, 'bad', 123, { principalId }])(
    'fails closed for malformed session DB response %#',
    async (session) => {
      const db = harness({ session });
      expect(await runVenueAttendanceAdminOperation(db.pool, requestId, token, read)).toEqual({
        ok: false,
        error: 'unavailable'
      });
      expect(db.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
    }
  );
  it.each([
    [dbError('42501', 'venue_attendance_forbidden'), 'forbidden'],
    [dbError('22023', 'venue_attendance_invalid_input'), 'invalid_request'],
    [dbError('42501', 'private table/credential diagnostic'), 'unavailable'],
    [dbError('55000', 'private diagnostic'), 'unavailable'],
    [new Error('private diagnostic'), 'unavailable'],
    [null, 'unavailable']
  ])('never exposes diagnostics or unexpected DB success %#', async (operationError, error) => {
    const db = harness({ operationError });
    expect(await runVenueAttendanceAdminOperation(db.pool, requestId, token, read)).toEqual({
      ok: false,
      error
    });
    expect(db.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
  });
  it('does not return an apparent result after COMMIT fails', async () => {
    const db = harness({ session: null, commitError: true });
    expect(await runVenueAttendanceAdminOperation(db.pool, requestId, token, read)).toEqual({
      ok: false,
      error: 'unavailable'
    });
    expect(db.query.mock.calls.slice(-2)).toEqual([['COMMIT'], ['ROLLBACK']]);
  });
  it('destroys the client and returns unavailable when rollback fails', async () => {
    const db = harness({ rollbackError: true });
    expect(await runVenueAttendanceAdminOperation(db.pool, requestId, token, read)).toEqual({
      ok: false,
      error: 'unavailable'
    });
    expect(db.release).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
  });
  it('explicitly clears prior person/principal claims for each transaction', async () => {
    const db = harness();
    await runVenueAttendanceAdminOperation(db.pool, requestId, token, read);
    await runVenueAttendanceAdminOperation(db.pool, requestId, token, read);
    for (const claim of ['person_id', 'principal_id'])
      expect(
        db.query.mock.calls.filter(
          ([sql, values]) =>
            sql === `SELECT set_config('qigong.${claim}', $1, TRUE)` && values?.[0] === ''
        )
      ).toHaveLength(2);
  });
});

describe('independent attendance-day rule: pure function only', () => {
  it('uses the existing authoritative Taipei day, not client/session timezone', () => {
    expect(VENUE_ATTENDANCE_TIME_ZONE).toBe('Asia/Taipei');
    expect(countVenueAttendanceDays(['2026-10-24T15:59:59Z', '2026-10-24T16:00:00Z'])).toBe(2);
  });
  it('counts same-day visits to different fields as one day; empty input is zero', () => {
    expect(
      countVenueAttendanceDays([
        '2026-10-24T22:00:00Z',
        '2026-10-25T01:00:00Z',
        '2026-10-25T01:00:00Z'
      ])
    ).toBe(1);
    expect(countVenueAttendanceDays([])).toBe(0);
  });
  it.each([
    'bad',
    '2026-02-30T01:00:00Z',
    '2026-10-25',
    '2026-10-25T01:00:00+08:00',
    '2026-10-25T24:00:00Z',
    '2026-10-25T25:00:00Z',
    '2026-10-25T12:60:00Z',
    '2026-10-25T12:00:60Z'
  ])('rejects noncanonical timestamp %s', (instant) => {
    expect(() => countVenueAttendanceDays([instant])).toThrow();
  });
});

describe.skip('PostgreSQL verification PENDING: fixtures/environment not supplied; never connect in this batch', () => {
  it.each([
    'migration execution/rollback and preexisting data preservation',
    'non-superuser/non-owner resolver, forced RLS and unsafe preexisting roles',
    'unknown/revoked/suspended LINE identity, expired/switched channel and mismatched application',
    'PUBLIC/session/worker/default-ACL access denial and resolver column ACLs',
    'forged/missing context vs real session; expired/revoked session/principal/grant',
    'same grant action+region; cross-region/country/global/cohort and export separation',
    'search_path/pg_temp shadowing, pooled cleanup and transaction failures',
    'quarantine denies authorized management/read/export even for ordinary table owner',
    'parallel duplicate person+field+Taipei-day writes and cross-field/day aggregation',
    'privacy version/revocation/concurrency before any future attendance write'
  ])('%s', () => {
    throw new Error(
      'Pending real isolated PostgreSQL test implementation and approval; static/mock tests are not evidence.'
    );
  });
});
