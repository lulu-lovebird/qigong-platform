import type { Pool, PoolClient } from 'pg';

export type RuntimeRole = 'qigong_api_runtime' | 'qigong_worker_runtime';

export interface RequestSecurityContext {
  requestId: string;
  personId?: string;
  principalId?: string;
}

export interface RuntimePreflightResult {
  sessionUser: string;
  ready: boolean;
  reason?: string;
}

const runtimeRoleSql: Record<RuntimeRole, string> = {
  qigong_api_runtime: 'SET LOCAL ROLE qigong_api_runtime',
  qigong_worker_runtime: 'SET LOCAL ROLE qigong_worker_runtime'
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validateUuid = (name: string, value: string | undefined, required = false) => {
  if (value === undefined) {
    if (required) throw new Error(`${name} is required`);
    return;
  }
  if (!uuidPattern.test(value)) throw new Error(`${name} must be a UUID`);
};

export const checkApiRuntimePreflight = async (pool: Pool): Promise<RuntimePreflightResult> => {
  const client = await pool.connect();
  let sessionUser = '';
  let released = false;
  try {
    const role = await client.query<{
      session_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      rolinherit: boolean;
    }>(
      `SELECT role.rolname AS session_user, role.rolsuper, role.rolbypassrls,
              role.rolcreatedb, role.rolcreaterole, role.rolreplication, role.rolinherit
       FROM pg_roles role WHERE role.rolname = SESSION_USER`
    );
    const attributes = role.rows[0];
    if (!attributes) return { sessionUser, ready: false, reason: 'session_role_missing' };
    sessionUser = attributes.session_user;
    if (
      attributes.rolsuper ||
      attributes.rolbypassrls ||
      attributes.rolcreatedb ||
      attributes.rolcreaterole ||
      attributes.rolreplication ||
      attributes.rolinherit
    ) {
      return { sessionUser, ready: false, reason: 'unsafe_session_role' };
    }
    const directDependencies = await client.query<{ unsafe: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_shdepend dependency
         JOIN pg_roles session_role ON session_role.oid = dependency.refobjid
         WHERE dependency.refclassid = 'pg_authid'::regclass
           AND dependency.dbid IN (
             0,
             (SELECT oid FROM pg_database WHERE datname = CURRENT_DATABASE())
           )
           AND session_role.rolname = SESSION_USER
           AND dependency.deptype IN ('a', 'o')
       ) AS unsafe`
    );
    if (directDependencies.rows[0]?.unsafe) {
      return { sessionUser, ready: false, reason: 'session_role_has_direct_privileges' };
    }
    const memberships = await client.query<{ role_name: string }>(
      `SELECT granted_role.rolname AS role_name
       FROM pg_auth_members membership
       JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
       JOIN pg_roles member_role ON member_role.oid = membership.member
       WHERE member_role.rolname = SESSION_USER
       ORDER BY granted_role.rolname`
    );
    if (memberships.rows.length !== 1 || memberships.rows[0]?.role_name !== 'qigong_api_runtime') {
      return { sessionUser, ready: false, reason: 'unexpected_session_memberships' };
    }

    await client.query('BEGIN');
    await client.query(runtimeRoleSql.qigong_api_runtime);
    const protectedRows = await client.query(`SELECT id FROM identity.people LIMIT 1`);
    await client.query('ROLLBACK');
    if (protectedRows.rowCount !== 0) {
      return { sessionUser, ready: false, reason: 'rls_missing_context_not_denied' };
    }

    return { sessionUser, ready: true };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      client.release(error instanceof Error ? error : new Error(String(error)));
      released = true;
      return { sessionUser, ready: false, reason: 'preflight_rollback_failed' };
    }
    return {
      sessionUser,
      ready: false,
      reason: error instanceof Error ? error.message : 'runtime_preflight_failed'
    };
  } finally {
    if (!released) client.release();
  }
};

export const withRequestContext = async <Result>(
  pool: Pool,
  role: RuntimeRole,
  context: RequestSecurityContext,
  callback: (client: PoolClient) => Promise<Result>
): Promise<Result> => {
  if (!Object.hasOwn(runtimeRoleSql, role)) throw new Error('unsupported runtime role');
  validateUuid('requestId', context.requestId, true);
  validateUuid('personId', context.personId);
  validateUuid('principalId', context.principalId);

  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    await client.query(runtimeRoleSql[role]);
    await client.query(`SELECT set_config('qigong.request_id', $1, TRUE)`, [context.requestId]);
    await client.query(`SELECT set_config('qigong.person_id', $1, TRUE)`, [context.personId ?? '']);
    await client.query(`SELECT set_config('qigong.principal_id', $1, TRUE)`, [
      context.principalId ?? ''
    ]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      client.release(
        rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError))
      );
      released = true;
      throw new AggregateError([error, rollbackError], 'request transaction and rollback failed', {
        cause: error
      });
    }
    throw error;
  } finally {
    if (!released) client.release();
  }
};
