/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { withRequestContext, type Pool } from '@qigong/database';
import { trustedVenueOrigin } from './venue-management.js';
import { venueDebugMigrationVersion } from './venue-debug.js';

export const venueSuiteMigrationVersion = '0054_venue_people_read.sql';
export interface VenueFeatureConfig {
  readonly enabled: true;
  readonly publicOrigin: string;
}
export interface VenueSuiteConfig {
  readonly history?: VenueFeatureConfig;
  readonly management?: VenueFeatureConfig;
  readonly people?: VenueFeatureConfig;
}
export type VenueSuiteFeature = keyof VenueSuiteConfig;
export const validateVenueSuiteConfig = (config: VenueSuiteConfig): VenueSuiteConfig => {
  const result: VenueSuiteConfig = Object.fromEntries(
    Object.entries(config).map(([key, value]: [string, VenueFeatureConfig]) => {
      if (!['history', 'management', 'people'].includes(key) || value.enabled !== true)
        throw new Error('invalid venue feature configuration');
      return [
        key,
        Object.freeze({ enabled: true, publicOrigin: trustedVenueOrigin(value.publicOrigin) })
      ];
    })
  );
  return Object.freeze(result);
};

const contracts = {
  debug: {
    functions: [
      'platform.venue_debug_checkin(text,text,double precision,double precision,bigint,text)',
      'platform.venue_debug_history(text,text,text,text,bigint)'
    ],
    owners: ['qigong_venue_debug'],
    tables: [
      'core.field_attendance',
      'core.practice_fields',
      'audit.events',
      'platform.venue_debug_config',
      'platform.venue_debug_context'
    ]
  },
  history: {
    functions: ['platform.venue_personal_history(text,text,text,text,bigint)'],
    owners: ['qigong_venue_history_reader'],
    tables: ['core.field_attendance', 'core.practice_fields', 'platform.venue_history_context']
  },
  management: {
    functions: [
      'admin.venue_management(text,text,uuid,uuid,integer,jsonb,text)',
      'admin.venue_management_lookup(text)'
    ],
    owners: ['qigong_venue_manager', 'qigong_venue_config_guard'],
    tables: ['core.practice_fields', 'core.field_attendance', 'admin.sessions', 'audit.events']
  },
  people: {
    functions: [
      'admin.venue_people_read(text,uuid,date,date,uuid,uuid,text,text,text,text,integer,integer,boolean)'
    ],
    owners: ['qigong_venue_people_reader'],
    tables: ['core.practice_fields', 'core.field_attendance', 'identity.people', 'audit.events']
  }
} as const;

/** Version compatibility is not capability. Probe each enabled feature separately
 * as runtime, never by executing learner/admin operations or selecting PII. */
export const checkVenueFeatureReadiness = async (
  pool: Pool,
  feature: VenueSuiteFeature | 'debug'
) => {
  const contract = contracts[feature];
  try {
    const ready = await withRequestContext(
      pool,
      'qigong_api_runtime',
      { requestId: crypto.randomUUID() },
      async (client) => {
        const result = await client.query<{ ready: boolean }>(
          `SELECT
            (SELECT (count(*)=54 AND max(version)=$4 AND NOT $6)
              OR (count(*)=55 AND max(version)=$5) FROM public.schema_migrations)
            AND (SELECT count(*)=cardinality($1::text[]) AND bool_and(
              p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog','row_security=on']
              AND pg_get_userbyid(p.proowner)=ANY($2::text[])
              AND has_function_privilege(current_user,p.oid,'EXECUTE')
              AND NOT has_function_privilege('qigong_worker_runtime',p.oid,'EXECUTE')
              AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))
              FROM pg_proc p WHERE p.oid IN (SELECT to_regprocedure(signature) FROM unnest($1::text[]) signature))
            AND (SELECT count(*)=cardinality($2::text[]) AND bool_and(
              NOT (r.rolsuper OR r.rolcanlogin OR r.rolinherit OR r.rolcreatedb
                OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
              AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid=r.oid OR m.member=r.oid)
              AND NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner=r.oid))
              FROM pg_roles r WHERE r.rolname=ANY($2::text[]))
            AND (SELECT count(*)=cardinality($3::text[]) AND bool_and(c.relrowsecurity AND c.relforcerowsecurity)
              FROM pg_class c WHERE c.oid IN (SELECT to_regclass(name) FROM unnest($3::text[]) name)) AS ready`,
          [
            contract.functions,
            contract.owners,
            contract.tables,
            venueSuiteMigrationVersion,
            venueDebugMigrationVersion,
            feature === 'debug'
          ]
        );
        return result.rows[0]?.ready === true;
      }
    );
    return { feature, ready };
  } catch {
    return { feature, ready: false };
  }
};
