/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { withRequestContext, type Pool } from '@qigong/database';
import { trustedVenueOrigin } from './venue-management.js';
import { venueDebugMigrationVersion } from './venue-debug.js';

export const venueEntryGuidanceMigrationVersion = '0060_venue_entry_guidance.sql';
const telegramLearnerReviewMigrationVersion = '0059_telegram_learner_review.sql';

// Input-only helper is never executed here. Bind the exact ACL to the ledger:
// schema58/59 require two nonowner grants, schema60 exactly three. OID overloads
// are null-safe when the entry role does not exist on a historical schema.
const windowCapabilityPredicate = `EXISTS(
              SELECT 1 FROM pg_proc h CROSS JOIN (
                SELECT CASE
                  WHEN (count(*)=58 AND max(version)='0058_venue_early_checkin_window.sql')
                    OR (count(*)=59 AND max(version)='0059_telegram_learner_review.sql'
                      AND bool_or(version='0058_venue_early_checkin_window.sql')) THEN 2
                  WHEN count(*)=60 AND max(version)='0060_venue_entry_guidance.sql'
                    AND bool_or(version='0058_venue_early_checkin_window.sql')
                    AND bool_or(version='0059_telegram_learner_review.sql') THEN 3
                  WHEN count(*)=61 AND max(version)='0061_venue_attendance_reporting.sql'
                    AND bool_or(version='0058_venue_early_checkin_window.sql')
                    AND bool_or(version='0059_telegram_learner_review.sql')
                    AND bool_or(version='0060_venue_entry_guidance.sql') THEN 3
                  ELSE 0 END AS expected_grantees FROM public.schema_migrations
              ) window_ledger
              WHERE h.oid=to_regprocedure('platform.venue_checkin_window(jsonb,text,timestamptz)')
                AND window_ledger.expected_grantees IN (2,3)
                AND NOT h.prosecdef AND h.proconfig=ARRAY['search_path=pg_catalog']
                AND h.provolatile='s' AND h.prokind='f' AND h.prorettype='boolean'::regtype
                AND h.proowner=(SELECT nspowner FROM pg_namespace WHERE nspname='platform')
                AND has_function_privilege(to_regrole('qigong_venue_qr_writer')::oid,h.oid,'EXECUTE')
                AND has_function_privilege(to_regrole('qigong_venue_debug')::oid,h.oid,'EXECUTE')
                AND (window_ledger.expected_grantees=2 OR
                  has_function_privilege(to_regrole('qigong_venue_entry_reader')::oid,h.oid,'EXECUTE'))
                AND NOT has_function_privilege(to_regrole('qigong_api_runtime')::oid,h.oid,'EXECUTE')
                AND NOT has_function_privilege(to_regrole('qigong_worker_runtime')::oid,h.oid,'EXECUTE')
                AND (SELECT count(*) FROM aclexplode(coalesce(h.proacl,acldefault('f',h.proowner))) a
                  WHERE a.grantee<>h.proowner)=window_ledger.expected_grantees
                AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(h.proacl,acldefault('f',h.proowner))) a
                  WHERE a.grantee<>h.proowner AND (a.grantee=0 OR a.is_grantable
                    OR a.privilege_type<>'EXECUTE' OR a.grantee NOT IN
                    (SELECT oid FROM pg_roles WHERE rolname IN ('qigong_venue_qr_writer','qigong_venue_debug')
                      OR (rolname='qigong_venue_entry_reader' AND window_ledger.expected_grantees=3)))))`;
export const checkVenueWindowReadiness = async (pool: Pool) => {
  try {
    const ready = await withRequestContext(
      pool,
      'qigong_api_runtime',
      { requestId: crypto.randomUUID() },
      async (client) => {
        const result = await client.query<{ ready: boolean }>(
          `SELECT ${windowCapabilityPredicate} AS ready`
        );
        return result.rows[0]?.ready === true;
      }
    );
    return { feature: 'window' as const, ready };
  } catch {
    return { feature: 'window' as const, ready: false };
  }
};

const entryOwnerNames = [
  'qigong_venue_entry_reader',
  'qigong_venue_entry_identity_reader'
] as const;
const entryFunctionContracts = [
  {
    signature: 'platform.venue_entry_availability(text)',
    owner: entryOwnerNames[0],
    definer: true,
    configuration: ['search_path=pg_catalog', 'row_security=on'],
    volatility: 'v',
    api_execute: true
  },
  {
    signature: 'platform.venue_entry_learner_status(text)',
    owner: entryOwnerNames[1],
    definer: true,
    configuration: ['search_path=pg_catalog', 'row_security=on', 'qigong.venue_entry_subject='],
    volatility: 'v',
    api_execute: true
  },
  {
    signature: 'platform.venue_entry_schedule_context(jsonb,text,timestamptz)',
    owner: entryOwnerNames[0],
    definer: false,
    configuration: ['search_path=pg_catalog', 'row_security=on'],
    volatility: 's',
    api_execute: false
  }
] as const;
// Expected expressions use canonical pg_get_expr case and schema qualification.
// Strip formatting whitespace only outside single-quoted SQL literals, preserving
// literal case/spaces (including doubled-quote parity). These are fixed catalog
// expressions, not user input or function-source hashes.
const entryRelationContracts = [
  {
    relation: 'core.practice_fields',
    owner: entryOwnerNames[0],
    column_names: [
      'code',
      'name_zh_tw',
      'name_en',
      'is_active',
      'timezone',
      'active_time_rules',
      'region_id'
    ],
    force_rls: true,
    policy_name: 'venue_entry_public_fields',
    qual: 'true'
  },
  {
    relation: 'core.regions',
    owner: entryOwnerNames[0],
    column_names: ['id', 'parent_region_id', 'region_type', 'active'],
    force_rls: false,
    policy_name: 'venue_entry_public_regions',
    qual: 'true'
  },
  {
    relation: 'identity.people',
    owner: entryOwnerNames[1],
    column_names: ['id', 'status'],
    force_rls: true,
    policy_name: 'venue_entry_subject_person',
    qual: '(EXISTS(SELECT1FROMidentity.platform_identitiesiWHERE(i.person_id=people.id)))'
  },
  {
    relation: 'identity.platform_identities',
    owner: entryOwnerNames[1],
    column_names: [
      'id',
      'person_id',
      'platform',
      'external_subject_id',
      'revoked_at',
      'verified_at'
    ],
    force_rls: true,
    policy_name: 'venue_entry_subject_identity',
    qual: "((platform='line'::text)AND(external_subject_id=current_setting('qigong.venue_entry_subject'::text,true)))"
  },
  {
    relation: 'identity.person_interaction_channels',
    owner: entryOwnerNames[1],
    column_names: ['person_id', 'platform_identity_id', 'valid_from', 'valid_to'],
    force_rls: true,
    policy_name: 'venue_entry_subject_channel',
    qual: '(EXISTS(SELECT1FROMidentity.platform_identitiesiWHERE(i.person_id=person_interaction_channels.person_id)))'
  },
  {
    relation: 'identity.onboarding_applications',
    owner: entryOwnerNames[1],
    column_names: ['person_id', 'platform', 'external_subject_id', 'status'],
    force_rls: true,
    policy_name: 'venue_entry_subject_application',
    qual: "((platform='line'::text)AND(external_subject_id=current_setting('qigong.venue_entry_subject'::text,true)))"
  }
] as const;
const entryProjectSchemas = [
  'core',
  'identity',
  'platform',
  'admin',
  'audit',
  'ops',
  'reporting'
] as const;

/** Catalog evidence only, never an invocation of entry, identity or clock helpers.
 * core.regions deliberately retains its preexisting RLS setting. The other five
 * inputs must FORCE RLS. PUBLIC schema_migrations SELECT is unrelated to PII.
 * This probe is a release gate, not formal proof of function bodies/SQL semantics. */
export const checkVenueEntryGuidanceReadiness = async (pool: Pool) => {
  try {
    const ready = await withRequestContext(
      pool,
      'qigong_api_runtime',
      { requestId: crypto.randomUUID() },
      async (client) => {
        // pg_get_expr qualification must not depend on the caller's ambient path.
        // SET LOCAL is restored by this existing transaction's COMMIT/ROLLBACK;
        // never change the migration pool, role defaults or session settings.
        await client.query('SET LOCAL search_path=pg_catalog');
        const result = await client.query<{ ready: boolean }>(
          `WITH entry_functions AS (
          SELECT * FROM jsonb_to_recordset($3::jsonb) AS e(signature text,owner text,definer boolean,configuration text[],volatility text,api_execute boolean)
        ), entry_relations AS (
          SELECT e.*,to_regclass(e.relation)::oid AS relation_oid,to_regrole(e.owner)::oid AS owner_oid
          FROM jsonb_to_recordset($4::jsonb) AS e(relation text,owner text,column_names text[],force_rls boolean,policy_name text,qual text)
        ), entry_roles AS (
          SELECT * FROM pg_roles WHERE rolname=ANY($2::text[])
        ) SELECT
          (SELECT ((count(*)=60 AND max(version)=$6)
                OR (count(*)=61 AND max(version)='0061_venue_attendance_reporting.sql'))
            AND bool_or(version=$7) AND bool_or(version=$8) FROM public.schema_migrations)
          AND ${windowCapabilityPredicate}
          AND (SELECT count(*)=cardinality($2::text[]) AND bool_and(
            NOT(r.rolsuper OR r.rolcanlogin OR r.rolinherit OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
            AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid=r.oid OR m.member=r.oid)
            AND NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner=r.oid)
            AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE has_schema_privilege(r.oid,n.oid,'CREATE')))
            FROM entry_roles r)
          AND (SELECT count(*)=cardinality($1::text[]) AND bool_and(
            p.proowner=to_regrole(e.owner)::oid AND p.prosecdef=e.definer
            AND p.proconfig IS NOT NULL AND p.proconfig=e.configuration AND p.provolatile::text=e.volatility
            AND p.prokind='f' AND p.prorettype='jsonb'::regtype
            AND has_schema_privilege(p.proowner,p.pronamespace,'USAGE')
            AND has_function_privilege(p.proowner,p.oid,'EXECUTE')
            AND has_function_privilege(to_regrole('qigong_api_runtime')::oid,p.oid,'EXECUTE')=e.api_execute
            AND NOT has_function_privilege(to_regrole('qigong_worker_runtime')::oid,p.oid,'EXECUTE')
            AND (SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
              WHERE a.grantee<>p.proowner)=CASE WHEN e.api_execute THEN 1 ELSE 0 END
            AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
              WHERE a.grantee<>p.proowner AND (NOT e.api_execute OR a.grantee<>to_regrole('qigong_api_runtime')::oid
                OR a.is_grantable OR a.privilege_type<>'EXECUTE')))
            FROM entry_functions e JOIN pg_proc p ON p.oid=to_regprocedure(e.signature))
          AND (SELECT count(*)=6 AND bool_and(c.relkind IN ('r','p') AND c.relowner<>e.owner_oid
            AND has_schema_privilege(e.owner_oid,c.relnamespace,'USAGE')
            AND (NOT e.force_rls OR (c.relrowsecurity AND c.relforcerowsecurity)))
            FROM entry_relations e JOIN pg_class c ON c.oid=e.relation_oid)
          AND NOT EXISTS(SELECT 1 FROM entry_relations e CROSS JOIN LATERAL unnest(e.column_names) col(name)
            LEFT JOIN pg_attribute a ON a.attrelid=e.relation_oid AND a.attname=col.name AND a.attnum>0 AND NOT a.attisdropped
            WHERE a.attnum IS NULL OR NOT has_column_privilege(e.owner_oid,e.relation_oid,a.attnum,'SELECT'))
          AND NOT EXISTS(SELECT 1 FROM entry_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            JOIN pg_attribute a ON a.attrelid=c.oid
            WHERE n.nspname=ANY($5::text[]) AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
              AND has_column_privilege(r.oid,c.oid,a.attnum,'SELECT')
              AND NOT EXISTS(SELECT 1 FROM entry_relations e WHERE e.owner_oid=r.oid AND e.relation_oid=c.oid AND a.attname=ANY(e.column_names)))
          AND NOT EXISTS(SELECT 1 FROM entry_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname=ANY($5::text[]) AND c.relkind IN ('r','p','v','m','f')
              AND (has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                OR has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES')))
          AND NOT EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN entry_relations e
            WHERE r.rolname IN ('qigong_api_runtime','qigong_worker_runtime') AND e.relation=$9
              AND has_any_column_privilege(r.oid,e.relation_oid,'SELECT'))
          AND (SELECT count(*)=6 AND bool_and(p.polcmd='r' AND p.polpermissive
            AND p.polroles=ARRAY[e.owner_oid] AND p.polwithcheck IS NULL AND p.polqual IS NOT NULL
            AND regexp_replace(pg_get_expr(p.polqual,p.polrelid),'[[:space:]]+(?=(?:[^'']*''[^'']*'')*[^'']*$)','','g')=e.qual)
            FROM entry_relations e JOIN pg_policy p ON p.polrelid=e.relation_oid AND p.polname=e.policy_name)
          AND NOT EXISTS(SELECT 1 FROM entry_relations e JOIN pg_policy p ON p.polrelid=e.relation_oid
            WHERE p.polcmd IN ('r','*') AND (0=ANY(p.polroles) OR e.owner_oid=ANY(p.polroles)) AND p.polname<>e.policy_name)
          AS ready`,
          [
            entryFunctionContracts.map((f) => f.signature),
            entryOwnerNames,
            JSON.stringify(entryFunctionContracts),
            JSON.stringify(entryRelationContracts),
            entryProjectSchemas,
            venueEntryGuidanceMigrationVersion,
            venueDebugMigrationVersion,
            telegramLearnerReviewMigrationVersion,
            entryRelationContracts[0].relation
          ]
        );
        return result.rows.length === 1 && result.rows[0]?.ready === true;
      }
    );
    return { feature: 'entry' as const, ready };
  } catch {
    return { feature: 'entry' as const, ready: false };
  }
};

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
      'platform.venue_debug_checkin(text,text,double precision,double precision,bigint,bigint,text)',
      'platform.venue_debug_history(text,text,text,text,bigint)'
    ],
    owners: ['qigong_venue_debug', 'qigong_venue_debug_region_guard'],
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
              OR (count(*)=55 AND max(version)='0055_venue_distance_debug.sql' AND NOT $6)
              OR (count(*)=56 AND max(version)='0056_venue_cks_distance_debug.sql' AND NOT $6)
              OR (count(*)=57 AND max(version)='0057_venue_test_scope.sql' AND NOT $6)
              OR (count(*)=58 AND max(version)=$5)
              OR (count(*)=59 AND max(version)='0059_telegram_learner_review.sql')
              OR (count(*)=60 AND max(version)='0060_venue_entry_guidance.sql')
              OR (count(*)=61 AND max(version)='0061_venue_attendance_reporting.sql') FROM public.schema_migrations)
            AND (NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version=$5) OR ${windowCapabilityPredicate})
            AND (NOT $6 OR EXISTS(SELECT 1 FROM pg_proc g
              WHERE g.oid=to_regprocedure('platform.venue_debug_region_active(uuid)')
                AND g.prosecdef AND g.proconfig @> ARRAY['search_path=pg_catalog','row_security=on']
                AND pg_get_userbyid(g.proowner)='qigong_venue_debug_region_guard'
                AND has_function_privilege('qigong_venue_debug',g.oid,'EXECUTE')
                AND has_column_privilege('qigong_venue_debug_region_guard','core.regions','id','SELECT')
                AND has_column_privilege('qigong_venue_debug_region_guard','core.regions','parent_region_id','SELECT')
                AND has_column_privilege('qigong_venue_debug_region_guard','core.regions','region_type','SELECT')
                AND has_column_privilege('qigong_venue_debug_region_guard','core.regions','active','SELECT')
                AND NOT has_table_privilege('qigong_venue_debug_region_guard','core.regions','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                AND NOT has_function_privilege('qigong_api_runtime',g.oid,'EXECUTE')
                AND NOT has_function_privilege('qigong_worker_runtime',g.oid,'EXECUTE')
                AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(g.proacl,acldefault('f',g.proowner))) a
                  WHERE a.grantee=0 AND a.privilege_type='EXECUTE')))
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
