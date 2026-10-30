/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import type { Pool } from '@qigong/database';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  checkVenueFeatureReadiness,
  checkVenueWindowReadiness,
  checkVenueEntryGuidanceReadiness,
  venueEntryGuidanceMigrationVersion,
  validateVenueSuiteConfig
} from '../src/venue-suite.js';

// SQL is captured, NOT executed. Negative booleans below test adapter/composition
// behavior; source assertions check the intended guards, not PostgreSQL semantics.
const catalogFixture = (rows: { ready: unknown }[] = [{ ready: true }], fail = false) => {
  const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
    void parameters;
    if (sql.includes(' AS ready')) {
      if (fail) throw new Error('PRIVATE_CATALOG_ERROR');
      return { rows };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const direct = vi.fn(() => {
    throw new Error('Direct pool query forbidden');
  });
  return { pool: { connect, query: direct } as unknown as Pool, query, release, connect, direct };
};
const captured = (f: ReturnType<typeof catalogFixture>) => {
  const call = f.query.mock.calls.find(([sql]) => sql.includes(' AS ready'));
  if (!call) throw new Error('Missing catalog probe');
  return { sql: call[0], parameters: call[1] ?? [] };
};
const functionRows = z.array(
  z.strictObject({
    signature: z.string(),
    owner: z.string(),
    definer: z.boolean(),
    configuration: z.array(z.string()),
    volatility: z.string(),
    api_execute: z.boolean()
  })
);
const relationRows = z.array(
  z.strictObject({
    relation: z.string(),
    owner: z.string(),
    column_names: z.array(z.string()),
    force_rls: z.boolean(),
    policy_name: z.string(),
    qual: z.string()
  })
);
const jsonParameter = (value: unknown): unknown => {
  if (typeof value !== 'string') throw new Error('Expected JSON contract parameter');
  return JSON.parse(value) as unknown;
};

describe('version-bound window catalog SQL (STATIC guards, not PG execution)', () => {
  it('requires exactly two historical grants or three schema60 grants, never a shared loose allowlist', async () => {
    const f = catalogFixture();
    expect(await checkVenueWindowReadiness(f.pool)).toEqual({ feature: 'window', ready: true });
    const { sql } = captured(f);
    expect(sql).toContain("count(*)=58 AND max(version)='0058_venue_early_checkin_window.sql'");
    expect(sql).toContain("count(*)=59 AND max(version)='0059_telegram_learner_review.sql'");
    expect(sql).toContain("AND bool_or(version='0058_venue_early_checkin_window.sql')) THEN 2");
    expect(sql).toContain("count(*)=60 AND max(version)='0060_venue_entry_guidance.sql'");
    expect(sql).toContain("AND bool_or(version='0059_telegram_learner_review.sql') THEN 3");
    expect(sql).toContain('ELSE 0 END AS expected_grantees');
    expect(sql).toContain('WHERE a.grantee<>h.proowner)=window_ledger.expected_grantees');
    expect(sql).toContain(
      "rolname='qigong_venue_entry_reader' AND window_ledger.expected_grantees=3"
    );
    expect(sql).toContain('window_ledger.expected_grantees=2 OR');
    expect(sql).toContain("h.proconfig=ARRAY['search_path=pg_catalog']");
    expect(sql).toContain('AND NOT h.prosecdef');
    expect(sql).toContain("h.provolatile='s'");
    expect(sql).toContain('a.is_grantable');
    expect(sql).toContain('a.grantee=0');
    expect(sql).toContain("a.privilege_type<>'EXECUTE'");
    for (const role of [
      'qigong_venue_qr_writer',
      'qigong_venue_debug',
      'qigong_venue_entry_reader',
      'qigong_api_runtime',
      'qigong_worker_runtime'
    ])
      expect(sql).toContain(`to_regrole('${role}')::oid`);
    expect(sql).not.toMatch(/has_function_privilege\('qigong_/);
    expect(sql).not.toMatch(/SELECT\s+platform\.venue_checkin_window/);
  });
  it.each([false, null, 'true', 1])('does not trust non-true window evidence %j', async (ready) => {
    const f = catalogFixture([{ ready }]);
    expect(await checkVenueWindowReadiness(f.pool)).toEqual({ feature: 'window', ready: false });
  });
  it('fails window metadata errors closed without diagnostics', async () => {
    const f = catalogFixture([], true);
    expect(await checkVenueWindowReadiness(f.pool)).toEqual({ feature: 'window', ready: false });
  });
});

// Decode the captured SQL literal, then use an explicitly JS-only equivalent of
// its POSIX-space ARE. This checks wire encoding and literal semantics; it does
// NOT execute the PostgreSQL SQL parser/ARE or prove the ambient-path PG fix.
const capturedPolicyNormalizer = (sql: string) => {
  const match =
    /regexp_replace\(pg_get_expr\(p\.polqual,p\.polrelid\),'((?:''|[^'])*)','','g'\)=e\.qual/.exec(
      sql
    );
  expect(match?.[1]).toBe("[[:space:]]+(?=(?:[^'']*''[^'']*'')*[^'']*$)");
  if (!match?.[1]) throw new Error('Missing literal-aware policy normalization');
  const pgPattern = match[1].replaceAll("''", "'");
  expect(pgPattern).toBe("[[:space:]]+(?=(?:[^']*'[^']*')*[^']*$)");
  const regexp = new RegExp(pgPattern.replace('[[:space:]]', '\\s'), 'g');
  expect(sql).not.toMatch(/\blower\(/);
  return (expression: string) => expression.replace(regexp, '');
};
const policyFixture = async () => {
  const f = catalogFixture();
  await checkVenueEntryGuidanceReadiness(f.pool);
  const { sql, parameters } = captured(f);
  const expected = relationRows
    .parse(jsonParameter(parameters[3]))
    .find((r) => r.policy_name === 'venue_entry_subject_identity')?.qual;
  if (!expected) throw new Error('Missing exact identity policy contract');
  const formatted =
    "(\n (platform = 'line'::text)\tAND (external_subject_id = current_setting('qigong.venue_entry_subject'::text, true))\n)";
  return { normalize: capturedPolicyNormalizer(sql), expected, formatted };
};

describe('entry readiness catalog contract (mock results + STATIC guards only)', () => {
  it('pins metadata qualification only inside the runtime transaction, before the catalog SELECT', async () => {
    const f = catalogFixture();
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
    expect(await checkVenueEntryGuidanceReadiness(f.pool)).toEqual({
      feature: 'entry',
      ready: true
    });
    const statements = f.query.mock.calls.map(([sql]) => sql);
    expect(statements.slice(0, 6)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE qigong_api_runtime',
      "SELECT set_config('qigong.request_id', $1, TRUE)",
      "SELECT set_config('qigong.person_id', $1, TRUE)",
      "SELECT set_config('qigong.principal_id', $1, TRUE)",
      'SET LOCAL search_path=pg_catalog'
    ]);
    expect(statements[6]).toBe(captured(f).sql);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements.filter((sql) => sql.startsWith('SET LOCAL search_path'))).toHaveLength(1);
    expect(statements).not.toContain('SET search_path=pg_catalog');
    expect(f.connect).toHaveBeenCalledOnce();
    expect(f.direct).not.toHaveBeenCalled();
    // Actual caller-path restoration is for the parent's PG matrix. Here we
    // verify the existing transaction closes after the LOCAL-only statement.
  });
  it('rolls back and fails closed if the local metadata pin fails, without running its SELECT', async () => {
    const f = catalogFixture();
    f.query.mockImplementation(async (sql) => {
      if (sql === 'SET LOCAL search_path=pg_catalog') throw new Error('PRIVATE_PATH_ERROR');
      return { rows: [] };
    });
    expect(await checkVenueEntryGuidanceReadiness(f.pool)).toEqual({
      feature: 'entry',
      ready: false
    });
    const statements = f.query.mock.calls.map(([sql]) => sql);
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(statements.some((sql) => sql.includes('WITH entry_functions AS'))).toBe(false);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it('does not change standalone historical window or existing feature probe paths', async () => {
    const window = catalogFixture();
    const feature = catalogFixture();
    await checkVenueWindowReadiness(window.pool);
    await checkVenueFeatureReadiness(feature.pool, 'history');
    for (const f of [window, feature])
      expect(f.query.mock.calls.some(([sql]) => sql.includes('SET LOCAL search_path'))).toBe(false);
  });
  it('normalizes formatting outside literals without changing expected policy bytes (JS equivalent only)', async () => {
    const { normalize, expected, formatted } = await policyFixture();
    expect(normalize(formatted)).toBe(expected);
    expect(normalize(expected)).toBe(expected);
  });
  it.each([
    ['literal case', "'line'", "'LINE'"],
    ['platform space', "'line'", "'li ne'"],
    ['leading literal space', "'line'", "' line'"],
    ['trailing literal space', "'line'", "'line '"],
    ['GUC key space', "'qigong.venue_entry_subject'", "'qigong.venue_entry_ subject'"],
    ['doubled quote parity', "'line'", "'li'' ne'"],
    ['literal tab', "'line'", "'li\tne'"],
    ['literal newline', "'line'", "'li\nne'"]
  ] as const)(
    'preserves %s instead of accepting a different policy literal (JS equivalent, NOT PG proof)',
    async (_label, original, replacement) => {
      const { normalize, expected, formatted } = await policyFixture();
      const changed = formatted.replace(original, replacement);
      expect(changed).not.toBe(formatted);
      expect(normalize(changed)).toContain(replacement);
      expect(normalize(changed)).not.toBe(expected);
    }
  );
  it('requires exact schema60, three function contracts, six minimal relation/policy contracts', async () => {
    const f = catalogFixture();
    expect(await checkVenueEntryGuidanceReadiness(f.pool)).toEqual({
      feature: 'entry',
      ready: true
    });
    const { sql, parameters } = captured(f);
    expect(venueEntryGuidanceMigrationVersion).toBe('0060_venue_entry_guidance.sql');
    expect(sql).toContain('count(*)=60 AND max(version)=$6');
    expect(sql).toContain('AND bool_or(version=$7) AND bool_or(version=$8)');
    expect(parameters.slice(5, 8)).toEqual([
      venueEntryGuidanceMigrationVersion,
      '0058_venue_early_checkin_window.sql',
      '0059_telegram_learner_review.sql'
    ]);
    const functions = functionRows.parse(jsonParameter(parameters[2]));
    expect(functions).toHaveLength(3);
    expect(parameters[0]).toEqual(functions.map((f) => f.signature));
    expect(parameters[1]).toEqual([
      'qigong_venue_entry_reader',
      'qigong_venue_entry_identity_reader'
    ]);
    expect(functions.find((f) => f.signature.includes('learner_status'))).toEqual({
      signature: 'platform.venue_entry_learner_status(text)',
      owner: 'qigong_venue_entry_identity_reader',
      definer: true,
      configuration: ['search_path=pg_catalog', 'row_security=on', 'qigong.venue_entry_subject='],
      volatility: 'v',
      api_execute: true
    });
    expect(functions.find((f) => f.signature.includes('schedule_context'))).toMatchObject({
      owner: 'qigong_venue_entry_reader',
      definer: false,
      volatility: 's',
      api_execute: false,
      configuration: ['search_path=pg_catalog', 'row_security=on']
    });
    expect(functions.find((f) => f.signature.includes('availability'))).toMatchObject({
      owner: 'qigong_venue_entry_reader',
      definer: true,
      volatility: 'v',
      api_execute: true
    });
    const relations = relationRows.parse(jsonParameter(parameters[3]));
    expect(relations).toHaveLength(6);
    expect(relations.filter((r) => r.force_rls)).toHaveLength(5);
    expect(relations.map((r) => [r.relation, r.column_names.toSorted()])).toEqual([
      [
        'core.practice_fields',
        ['active_time_rules', 'code', 'is_active', 'name_en', 'name_zh_tw', 'region_id', 'timezone']
      ],
      ['core.regions', ['active', 'id', 'parent_region_id', 'region_type']],
      ['identity.people', ['id', 'status']],
      [
        'identity.platform_identities',
        ['external_subject_id', 'id', 'person_id', 'platform', 'revoked_at', 'verified_at']
      ],
      [
        'identity.person_interaction_channels',
        ['person_id', 'platform_identity_id', 'valid_from', 'valid_to']
      ],
      [
        'identity.onboarding_applications',
        ['external_subject_id', 'person_id', 'platform', 'status']
      ]
    ]);
    expect(relations.find((r) => r.relation === 'core.regions')).toMatchObject({
      force_rls: false,
      qual: 'true',
      owner: 'qigong_venue_entry_reader'
    });
    expect(
      relations
        .filter((r) => r.relation.startsWith('identity.'))
        .every((r) => r.owner === 'qigong_venue_entry_identity_reader')
    ).toBe(true);
    expect(
      relations
        .filter((r) => r.policy_name.endsWith('identity') || r.policy_name.endsWith('application'))
        .every((r) => r.qual.includes('qigong.venue_entry_subject'))
    ).toBe(true);
    expect(parameters[4]).toEqual([
      'core',
      'identity',
      'platform',
      'admin',
      'audit',
      'ops',
      'reporting'
    ]);
    expect(parameters[8]).toBe('core.practice_fields');
    expect(sql).toContain('NOT e.force_rls OR (c.relrowsecurity AND c.relforcerowsecurity)');
    expect(sql).not.toMatch(/(?:FROM|JOIN)\s+(?:core|identity|platform)\./i);
    expect(sql).not.toMatch(/SELECT\s+platform\.(?:venue_entry_|privacy_usage)/);
    expect(sql).not.toMatch(/INSERT\s+INTO|DELETE\s+FROM|ALTER\s+TABLE/i);
    expect(f.direct).not.toHaveBeenCalled();
    expect(f.query).toHaveBeenCalledWith('SET LOCAL ROLE qigong_api_runtime');
    expect(f.query).toHaveBeenCalledWith("SELECT set_config('qigong.person_id', $1, TRUE)", ['']);
    expect(f.query).toHaveBeenCalledWith("SELECT set_config('qigong.principal_id', $1, TRUE)", [
      ''
    ]);
  });
  it.each([
    ['wrong owner', 'p.proowner=to_regrole(e.owner)::oid'],
    ['wrong definer', 'p.prosecdef=e.definer'],
    ['wrong config', 'p.proconfig=e.configuration'],
    ['null config', 'p.proconfig IS NOT NULL'],
    ['wrong volatility', 'p.provolatile::text=e.volatility'],
    ['wrong return type', "p.prorettype='jsonb'::regtype"],
    ['unsafe login', 'r.rolcanlogin'],
    ['BYPASSRLS', 'r.rolbypassrls'],
    ['inheritance', 'r.rolinherit'],
    ['membership', 'm.roleid=r.oid OR m.member=r.oid'],
    ['table ownership', 'c.relowner=r.oid'],
    ['schema CREATE', "has_schema_privilege(r.oid,n.oid,'CREATE')"],
    [
      'required relation namespace USAGE',
      "has_schema_privilege(e.owner_oid,c.relnamespace,'USAGE')"
    ],
    [
      'required function namespace USAGE',
      "has_schema_privilege(p.proowner,p.pronamespace,'USAGE')"
    ],
    ['ordinary owner EXECUTE', "has_function_privilege(p.proowner,p.oid,'EXECUTE')"],
    [
      'worker EXECUTE',
      "NOT has_function_privilege(to_regrole('qigong_worker_runtime')::oid,p.oid,'EXECUTE')"
    ],
    [
      'API helper EXECUTE',
      "has_function_privilege(to_regrole('qigong_api_runtime')::oid,p.oid,'EXECUTE')=e.api_execute"
    ],
    ['extra/PUBLIC/default ACL', "a.grantee<>to_regrole('qigong_api_runtime')::oid"],
    ['grant option', 'a.is_grantable'],
    ['exact ACL cardinality', 'CASE WHEN e.api_execute THEN 1 ELSE 0 END'],
    [
      'missing column',
      "a.attnum IS NULL OR NOT has_column_privilege(e.owner_oid,e.relation_oid,a.attnum,'SELECT')"
    ],
    ['extra SELECT', 'a.attname=ANY(e.column_names)'],
    ['table DML', "'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'"],
    ['column DML', "has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES')"],
    ['runtime raw venue SELECT', "has_any_column_privilege(r.oid,e.relation_oid,'SELECT')"],
    ['FORCE RLS', 'c.relrowsecurity AND c.relforcerowsecurity'],
    ['policy role', 'p.polroles=ARRAY[e.owner_oid]'],
    ['policy command', "p.polcmd='r'"],
    ['null policy scope', 'p.polqual IS NOT NULL'],
    ['changed policy scope', 'pg_get_expr(p.polqual,p.polrelid)'],
    ['extra SELECT policy', "p.polcmd IN ('r','*')"]
  ] as const)(
    'contains the %s guard and rejects reported-negative catalog evidence (NOT executing SQL)',
    async (_fault, guard) => {
      const f = catalogFixture([{ ready: false }]);
      expect(await checkVenueEntryGuidanceReadiness(f.pool)).toEqual({
        feature: 'entry',
        ready: false
      });
      expect(captured(f).sql).toContain(guard);
    }
  );
  it.each([
    { rows: [] },
    { rows: [{ ready: false }] },
    { rows: [{ ready: null }] },
    { rows: [{ ready: 'true' }] },
    { rows: [{ ready: 1 }] },
    { rows: [{ ready: true }, { ready: true }] }
  ])('fails missing/malformed/ambiguous evidence closed: %j', async ({ rows }) => {
    const f = catalogFixture(rows);
    expect(await checkVenueEntryGuidanceReadiness(f.pool)).toEqual({
      feature: 'entry',
      ready: false
    });
  });
  it('suppresses connection and catalog errors', async () => {
    const f = catalogFixture([], true);
    expect(await checkVenueEntryGuidanceReadiness(f.pool)).toEqual({
      feature: 'entry',
      ready: false
    });
    const statements = f.query.mock.calls.map(([sql]) => sql);
    expect(statements.indexOf('SET LOCAL search_path=pg_catalog')).toBeLessThan(
      statements.indexOf(captured(f).sql)
    );
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    f.connect.mockRejectedValueOnce(new Error('PRIVATE_CATALOG_ERROR'));
    expect(await checkVenueEntryGuidanceReadiness(f.pool)).toEqual({
      feature: 'entry',
      ready: false
    });
  });
});

describe('independent venue capability evidence', () => {
  it.each(['history', 'management', 'people', 'debug'] as const)(
    'probes %s without reading PII or invoking operations',
    async (feature) => {
      const query = vi.fn(async (sql: string) => ({
        rows: sql.includes(' AS ready') ? [{ ready: true }] : []
      }));
      const pool = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool;
      expect(await checkVenueFeatureReadiness(pool, feature)).toEqual({ feature, ready: true });
      const probe = query.mock.calls.find(([sql]) => sql.includes(' AS ready'))?.[0];
      expect(probe).toContain('count(*)=54');
      expect(probe).toContain('count(*)=55');
      expect(probe).toContain(
        "count(*)=56 AND max(version)='0056_venue_cks_distance_debug.sql' AND NOT $6"
      );
      expect(probe).toContain(
        "count(*)=57 AND max(version)='0057_venue_test_scope.sql' AND NOT $6"
      );
      expect(probe).toContain('count(*)=58 AND max(version)=$5');
      expect(probe).toContain("count(*)=59 AND max(version)='0059_telegram_learner_review.sql'");
      expect(probe).toContain("count(*)=60 AND max(version)='0060_venue_entry_guidance.sql'");
      expect(probe).toContain('platform.venue_checkin_window(jsonb,text,timestamptz)');
      expect(probe).toContain('AND NOT h.prosecdef');
      expect(probe).toContain('a.is_grantable');
      expect(probe).toContain('relforcerowsecurity');
      expect(probe).toContain('pg_auth_members');
      expect(probe).not.toMatch(/SELECT .* FROM (core|identity)\./);
    }
  );
  it('does not treat missing evidence or database errors as readiness', async () => {
    const pool = {
      connect: async () => {
        throw new Error('private SQL diagnostics');
      }
    } as unknown as Pool;
    expect(await checkVenueFeatureReadiness(pool, 'history')).toEqual({
      feature: 'history',
      ready: false
    });
  });
  it('requires exact trusted HTTPS origins and explicit enablement', () => {
    expect(validateVenueSuiteConfig({})).toEqual({});
    expect(
      validateVenueSuiteConfig({
        history: { enabled: true, publicOrigin: 'https://synthetic.invalid' }
      })
    ).toEqual({ history: { enabled: true, publicOrigin: 'https://synthetic.invalid' } });
    for (const publicOrigin of [
      'http://synthetic.invalid',
      'https://synthetic.invalid/',
      'https://user@synthetic.invalid'
    ])
      expect(() =>
        validateVenueSuiteConfig({ history: { enabled: true, publicOrigin } })
      ).toThrow();
  });
});
