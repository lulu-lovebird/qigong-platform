import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient, VenueAttendanceAdminOperation } from '@qigong/database';
import { registerAdminRoutes, type AdminAuthProvider } from '../src/admin-auth.js';
import {
  createVenueAdminService,
  type VenueAdminDenial,
  type VenueAdminExecute
} from '../src/venue-admin-service.js';

// Pure/mock only. No pg.Pool, env files, migration, DB or external API.
const requestId = '10000000-0000-4000-8000-000000000001';
const regionId = '20000000-0000-4000-8000-000000000002';
const principalId = '30000000-0000-4000-8000-000000000003';
const fieldId = '40000000-0000-4000-8000-000000000004';
const otherRegion = '50000000-0000-4000-8000-000000000005';
const session = 's'.repeat(43);
const csrf = 'c'.repeat(43);
const sessionCookie = '__Host-qigong-admin';
const csrfCookie = '__Host-qigong-admin-csrf';
const read = { operation: 'field.read', regionId } as const;
const write = {
  operation: 'field.write',
  regionId,
  fieldId,
  change: { nameZhTw: '甲場', isActive: true }
} as const;
const attendance = {
  operation: 'attendance.read',
  regionId,
  from: '2026-10-01',
  until: '2026-11-01'
} as const;
const exportOperation = { ...attendance, operation: 'attendance.export' } as const;
const authHeaders = {
  cookie: `${sessionCookie}=${session}; ${csrfCookie}=${csrf}`,
  'x-csrf-token': csrf
};
const dbError = (code: string, message: string) => Object.assign(new Error(message), { code });

afterEach(() => vi.unstubAllEnvs());

describe('venue admin service dependency boundary', () => {
  it.each([
    ['invalid_request', 400],
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['invalid_csrf', 403],
    ['quarantined', 503],
    ['unavailable', 503]
  ] as const)('maps %s without exposing dependency data', async (error, status) => {
    const execute = vi.fn(async (): Promise<VenueAdminDenial> => ({ ok: false, error }));
    const service = createVenueAdminService(execute);
    expect(await service.execute(read)).toEqual({ status, body: { error } });
    expect(execute).toHaveBeenCalledExactlyOnceWith(read);
    expect(Object.isFrozen(service)).toBe(true);
  });

  it.each([
    null,
    {},
    { ...read, principalId },
    { ...read, personId: principalId },
    { ...read, sessionToken: session },
    { ...read, volunteerId: principalId },
    { ...read, subject: 'self-asserted' },
    { ...read, idToken: 'self-asserted' },
    { ...read, user_latitude: 25, user_longitude: 121 },
    { ...read, student_note: 'private reflection' },
    { ...read, checkinId: fieldId },
    { ...read, operation: 'field.create' },
    { ...write, change: { ...write.change, latitude: 25 } },
    { ...attendance, until: attendance.from }
  ])('rejects unsupported input without executing: %j', async (input) => {
    const execute = vi.fn<VenueAdminExecute>();
    expect(await createVenueAdminService(execute).execute(input)).toEqual({
      status: 400,
      body: { error: 'invalid_request' }
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes a new immutable canonical operation to the injected closure', async () => {
    const execute = vi.fn(async (operation: VenueAttendanceAdminOperation) => {
      expect(Object.isFrozen(operation)).toBe(true);
      if (operation.operation === 'field.write')
        expect(Object.isFrozen(operation.change)).toBe(true);
      return { ok: false, error: 'quarantined' } as const;
    });
    await createVenueAdminService(execute).execute({
      ...write,
      change: { nameZhTw: '  甲場  ', isActive: true }
    });
    expect(execute).toHaveBeenCalledExactlyOnceWith(write);
  });

  it.each([
    { ok: true, data: { session, principalId } },
    { ok: false, error: 'unexpected', diagnostic: session },
    null
  ])('fails closed for unexpected dependency output: %j', async (result) => {
    const execute = (async () => result) as unknown as VenueAdminExecute;
    expect(await createVenueAdminService(execute).execute(read)).toEqual({
      status: 503,
      body: { error: 'unavailable' }
    });
  });

  it('does not forward exception diagnostics', async () => {
    const service = createVenueAdminService(async () => {
      throw new Error(`private DB diagnostic ${session}`);
    });
    expect(await service.execute(read)).toEqual({ status: 503, body: { error: 'unavailable' } });
  });
});

interface DbState {
  principal: unknown;
  operationError: Error | null;
  failAt: string | undefined;
  rollbackFails: boolean;
}

const fixture = () => {
  vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', 'false');
  const state: DbState = {
    principal: principalId,
    operationError: dbError('55000', 'venue_attendance_quarantined'),
    failAt: undefined,
    rollbackFails: false
  };
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    if (sql === state.failAt || (sql === 'ROLLBACK' && state.rollbackFails))
      throw new Error(`private DB failure ${session}`);
    if (sql === 'SELECT admin.session_principal($1) AS principal_id')
      return { rows: [{ principal_id: values?.[0] === session ? state.principal : null }] };
    if (sql.startsWith('SELECT admin.venue_attendance_')) {
      if (state.operationError) throw state.operationError;
      return { rows: [{ data: { secret: session, personId: principalId } }] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const poolQuery = vi.fn(() => {
    throw new Error('pool.query is forbidden');
  });
  const pool = { connect, query: poolQuery } as unknown as Pool;
  const logs: string[] = [];
  const app = Fastify({
    genReqId: () => requestId,
    logger: { level: 'info', stream: { write: (line: string) => logs.push(line) } }
  });
  const provider: AdminAuthProvider = {
    callbackUrl: 'https://admin.example.test/admin/auth/callback',
    begin: async () => {
      throw new Error('external authentication prohibited in this fixture');
    },
    complete: async () => {
      throw new Error('external authentication prohibited in this fixture');
    }
  };
  const { venueAdminServiceFor } = registerAdminRoutes(app, pool, provider);
  // Test-only transport. No such route is registered by production code.
  app.route({
    method: ['GET', 'POST', 'PATCH'],
    url: '/__test/venue',
    handler: async (request, reply) => {
      const result = await venueAdminServiceFor(request).execute(request.body ?? read);
      return reply.code(result.status).send(result.body);
    }
  });
  app.post('/__test/revoke-between-calls', async (request) => {
    const service = venueAdminServiceFor(request);
    const first = await service.execute(read);
    state.principal = null;
    const second = await service.execute(read);
    return [first, second];
  });
  return { app, state, query, connect, poolQuery, release, logs };
};

describe('admin-auth private cookie → service → real 0050 runner (mock pool)', () => {
  it.each([
    [read, 'SELECT admin.venue_attendance_read_fields($1, $2) AS data', [session, regionId]],
    [
      write,
      'SELECT admin.venue_attendance_write_field($1, $2, $3, $4) AS data',
      [session, regionId, fieldId, JSON.stringify(write.change)]
    ],
    [
      attendance,
      'SELECT admin.venue_attendance_read_attendance($1, $2, $3, $4, $5) AS data',
      [session, regionId, attendance.from, attendance.until, false]
    ],
    [
      exportOperation,
      'SELECT admin.venue_attendance_read_attendance($1, $2, $3, $4, $5) AS data',
      [session, regionId, attendance.from, attendance.until, true]
    ]
  ] as const)(
    'executes %j using runtime context and rolls back quarantine',
    async (input, sql, values) => {
      const h = fixture();
      try {
        const result = await h.app.inject({
          method: 'POST',
          url: '/__test/venue',
          headers: authHeaders,
          payload: input
        });
        expect(result.statusCode).toBe(503);
        expect(result.json()).toEqual({ error: 'quarantined' });
        expect(h.query.mock.calls).toEqual([
          ['BEGIN'],
          ['SET LOCAL ROLE qigong_api_runtime'],
          ["SELECT set_config('qigong.request_id', $1, TRUE)", [requestId]],
          ["SELECT set_config('qigong.person_id', $1, TRUE)", ['']],
          ["SELECT set_config('qigong.principal_id', $1, TRUE)", ['']],
          ['SELECT admin.session_principal($1) AS principal_id', [session]],
          ["SELECT set_config('qigong.principal_id', $1, TRUE)", [principalId]],
          [sql, [...values]],
          ['ROLLBACK']
        ]);
        expect(h.release).toHaveBeenCalledExactlyOnceWith();
        expect(h.poolQuery).not.toHaveBeenCalled();
        expect(h.logs.join('')).not.toContain(session);
        expect(h.logs.join('')).not.toContain(principalId);
      } finally {
        await h.app.close();
      }
    }
  );

  it.each([
    {},
    { authorization: `Bearer ${session}`, 'x-principal-id': principalId },
    { 'x-session-token': session },
    { cookie: `${sessionCookie}=${principalId}` },
    { cookie: `${sessionCookie}=${'x'.repeat(129)}` },
    { cookie: `${sessionCookie}=bad%20credential` },
    { cookie: `${sessionCookie}=${session}; ${sessionCookie}=${'t'.repeat(43)}` },
    { cookie: `__Host-qigong-admin-access=${session}` }
  ])('rejects missing, ambiguous or asserted credentials: %j', async (headers) => {
    const h = fixture();
    try {
      const result = await h.app.inject({
        method: 'POST',
        url: '/__test/venue',
        headers,
        payload: read
      });
      expect(result.statusCode).toBe(401);
      expect(result.json()).toEqual({ error: 'unauthenticated' });
      expect(h.connect).not.toHaveBeenCalled();
    } finally {
      await h.app.close();
    }
  });

  it.each([
    { cookie: `${sessionCookie}=${session}` },
    { cookie: authHeaders.cookie },
    { ...authHeaders, 'x-csrf-token': 'z'.repeat(43) },
    { ...authHeaders, 'x-csrf-token': ['c'.repeat(43), 'c'.repeat(43)] },
    { ...authHeaders, cookie: `${authHeaders.cookie}; ${csrfCookie}=${csrf}` }
  ])('blocks writes with invalid CSRF before DB: %j', async (headers) => {
    const h = fixture();
    try {
      const result = await h.app.inject({
        method: 'POST',
        url: '/__test/venue',
        headers,
        payload: write
      });
      expect(result.statusCode).toBe(403);
      expect(result.json()).toEqual({ error: 'invalid_csrf' });
      expect(h.connect).not.toHaveBeenCalled();
    } finally {
      await h.app.close();
    }
  });

  it('permits a read without CSRF, but never a write over GET', async () => {
    const h = fixture();
    try {
      const result = await h.app.inject({
        method: 'GET',
        url: '/__test/venue',
        headers: { cookie: `${sessionCookie}=${session}` }
      });
      expect(result.statusCode).toBe(503);
      expect(h.connect).toHaveBeenCalledTimes(1);
      // The server-only factory still enforces mutation method even without a route.
      const bare = Fastify({ genReqId: () => requestId });
      const factory = registerAdminRoutes(bare, { connect: h.connect } as unknown as Pool, {
        callbackUrl: 'https://admin.example.test/callback',
        begin: async () => new URL('https://admin.example.test'),
        complete: async () => ({ iss: '', sub: '' })
      });
      bare.get('/__test/write', async (request, reply) => {
        const response = await factory.venueAdminServiceFor(request).execute(write);
        return reply.code(response.status).send(response.body);
      });
      try {
        const denied = await bare.inject({
          method: 'GET',
          url: '/__test/write',
          headers: authHeaders
        });
        expect(denied.statusCode).toBe(403);
        expect(denied.json()).toEqual({ error: 'invalid_csrf' });
        expect(h.connect).toHaveBeenCalledTimes(1);
      } finally {
        await bare.close();
      }
    } finally {
      await h.app.close();
    }
  });

  it('revalidates an expired/revoked session on every call, not a cached principal', async () => {
    const h = fixture();
    try {
      const result = await h.app.inject({
        method: 'POST',
        url: '/__test/revoke-between-calls',
        headers: authHeaders
      });
      expect(result.json()).toEqual([
        { status: 503, body: { error: 'quarantined' } },
        { status: 401, body: { error: 'unauthenticated' } }
      ]);
      expect(h.connect).toHaveBeenCalledTimes(2);
      expect(
        h.query.mock.calls.filter(([sql]) => sql.includes('admin.session_principal'))
      ).toHaveLength(2);
      expect(
        h.query.mock.calls.filter(([sql]) => sql.startsWith('SELECT admin.venue_attendance_'))
      ).toHaveLength(1);
      // Null-session path is a read-only COMMIT in the existing runner, not a write.
      expect(h.query.mock.calls.at(-1)).toEqual(['COMMIT']);
      expect(h.release).toHaveBeenCalledTimes(2);
    } finally {
      await h.app.close();
    }
  });

  it('passes action/export and region anew on every operation without capability fallback', async () => {
    const h = fixture();
    try {
      for (const input of [
        read,
        write,
        attendance,
        exportOperation,
        { ...read, regionId: otherRegion }
      ]) {
        h.state.operationError =
          input.operation === 'attendance.export' || input.regionId === otherRegion
            ? dbError('42501', 'venue_attendance_forbidden')
            : dbError('55000', 'venue_attendance_quarantined');
        const result = await h.app.inject({
          method: 'POST',
          url: '/__test/venue',
          headers: authHeaders,
          payload: input
        });
        expect(result.statusCode).toBe(
          input.operation === 'attendance.export' || input.regionId === otherRegion ? 403 : 503
        );
      }
      expect(
        h.query.mock.calls.filter(([sql]) => sql.includes('admin.session_principal'))
      ).toHaveLength(5);
      const operations = h.query.mock.calls.filter(([sql]) =>
        sql.startsWith('SELECT admin.venue_attendance_')
      );
      expect(operations).toHaveLength(5);
      expect(operations[2]?.[1]?.[4]).toBe(false);
      expect(operations[3]?.[1]?.[4]).toBe(true);
      expect(operations[4]?.[1]).toEqual([session, otherRegion]);
      expect(
        h.query.mock.calls.some(([sql]) =>
          /has_permission|can_manage_admin_access|FROM core\./.test(sql)
        )
      ).toBe(false);
    } finally {
      await h.app.close();
    }
  });

  it.each([
    ['42501', 'venue_attendance_forbidden', 403, 'forbidden'],
    ['22023', 'venue_attendance_invalid_input', 400, 'invalid_request'],
    ['55000', 'venue_attendance_quarantined', 503, 'quarantined'],
    ['42501', `sensitive diagnostic ${session}`, 503, 'unavailable'],
    ['08006', `connection failure ${session}`, 503, 'unavailable']
  ] as const)(
    'sanitizes DB %s/%s with rollback + release',
    async (code, message, status, error) => {
      const h = fixture();
      h.state.operationError = dbError(code, message);
      try {
        const result = await h.app.inject({
          method: 'POST',
          url: '/__test/venue',
          headers: authHeaders,
          payload: read
        });
        expect(result.statusCode).toBe(status);
        expect(result.json()).toEqual({ error });
        expect(h.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
        expect(h.release).toHaveBeenCalledExactlyOnceWith();
        expect(h.logs.join('')).not.toContain(session);
        expect(h.logs.join('')).not.toContain(message);
      } finally {
        await h.app.close();
      }
    }
  );

  it('discards a client when rollback fails and allows a clean next operation', async () => {
    const h = fixture();
    h.state.rollbackFails = true;
    try {
      const first = await h.app.inject({
        method: 'POST',
        url: '/__test/venue',
        headers: authHeaders,
        payload: read
      });
      expect(first.statusCode).toBe(503);
      expect(first.json()).toEqual({ error: 'unavailable' });
      expect(h.release).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
      h.state.rollbackFails = false;
      h.query.mockClear();
      const second = await h.app.inject({
        method: 'POST',
        url: '/__test/venue',
        headers: authHeaders,
        payload: read
      });
      expect(second.json()).toEqual({ error: 'quarantined' });
      expect(h.query.mock.calls.slice(0, 5)).toEqual([
        ['BEGIN'],
        ['SET LOCAL ROLE qigong_api_runtime'],
        ["SELECT set_config('qigong.request_id', $1, TRUE)", [requestId]],
        ["SELECT set_config('qigong.person_id', $1, TRUE)", ['']],
        ["SELECT set_config('qigong.principal_id', $1, TRUE)", ['']]
      ]);
      expect(h.release).toHaveBeenCalledTimes(2);
      expect(h.logs.join('')).not.toContain(session);
    } finally {
      await h.app.close();
    }
  });

  it('treats unexpected SQL success as unavailable and rolls back without leaking data', async () => {
    const h = fixture();
    h.state.operationError = null;
    try {
      const result = await h.app.inject({
        method: 'PATCH',
        url: '/__test/venue',
        headers: authHeaders,
        payload: write
      });
      expect(result.statusCode).toBe(503);
      expect(result.json()).toEqual({ error: 'unavailable' });
      expect(h.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
      expect(h.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
      expect(h.release).toHaveBeenCalledExactlyOnceWith();
      expect(h.logs.join('')).not.toContain(session);
    } finally {
      await h.app.close();
    }
  });

  it.each(['connect', 'BEGIN', 'COMMIT', 'malformed_principal'] as const)(
    'sanitizes %s failure',
    async (failure) => {
      const h = fixture();
      if (failure === 'connect') h.connect.mockRejectedValueOnce(new Error(`private ${session}`));
      else if (failure === 'malformed_principal') h.state.principal = 'self-asserted';
      else {
        h.state.failAt = failure;
        if (failure === 'COMMIT') h.state.principal = null;
      }
      try {
        const result = await h.app.inject({
          method: 'POST',
          url: '/__test/venue',
          headers: authHeaders,
          payload: read
        });
        expect(result.statusCode).toBe(503);
        expect(result.json()).toEqual({ error: 'unavailable' });
        if (failure !== 'connect') {
          expect(h.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
          expect(h.release).toHaveBeenCalledExactlyOnceWith();
        }
        expect(h.logs.join('')).not.toContain(session);
      } finally {
        await h.app.close();
      }
    }
  );

  it('does not authenticate with body/query/header identity or retain/log private input', async () => {
    const h = fixture();
    try {
      const secretNote = `private-reflection-${randomUUID()}`;
      const result = await h.app.inject({
        method: 'POST',
        url: `/__test/venue?principalId=${principalId}`,
        headers: { ...authHeaders, 'x-principal-id': otherRegion },
        payload: {
          ...read,
          principalId: otherRegion,
          user_latitude: 25.123456789,
          student_note: secretNote
        }
      });
      expect(result.statusCode).toBe(400);
      expect(result.json()).toEqual({ error: 'invalid_request' });
      expect(h.connect).not.toHaveBeenCalled();
      expect(h.logs.join('')).not.toContain(secretNote);
      expect(h.logs.join('')).not.toContain('25.123456789');
      const clean = await h.app.inject({
        method: 'POST',
        url: `/__test/venue?principalId=${otherRegion}`,
        headers: { ...authHeaders, 'x-principal-id': otherRegion },
        payload: read
      });
      expect(clean.json()).toEqual({ error: 'quarantined' });
      expect(h.query).toHaveBeenCalledWith('SELECT admin.session_principal($1) AS principal_id', [
        session
      ]);
      expect(h.query).toHaveBeenCalledWith("SELECT set_config('qigong.principal_id', $1, TRUE)", [
        principalId
      ]);
    } finally {
      await h.app.close();
    }
  });

  it('does not register production venue routes or manual UI with NFC default-off', async () => {
    const h = fixture();
    try {
      for (const url of [
        '/admin/api/fields',
        '/admin/api/attendance',
        '/admin/attendance/export.csv',
        '/admin/venue-manual'
      ]) {
        expect((await h.app.inject({ method: 'GET', url, headers: authHeaders })).statusCode).toBe(
          404
        );
      }
      expect(h.connect).not.toHaveBeenCalled();
    } finally {
      await h.app.close();
    }
  });
});
