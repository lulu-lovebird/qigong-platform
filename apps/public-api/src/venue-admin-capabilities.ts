/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import type { VenueSuiteConfig } from './venue-suite.js';
import type { AdminLocale } from './admin-locale.js';

const managementRegionSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string().min(1),
    countryName: z.string().min(1),
    code: z.string().min(1),
    canRead: z.boolean(),
    canManage: z.boolean()
  })
  .strict();
export type VenueManagementRegion = z.infer<typeof managementRegionSchema>;

/** Read-only directory, resolved inside the private session boundary. SQL filters
 * eligibility BEFORE returning names; no client role allowlist or cached grants.
 * 0003 already grants runtime SELECT on core.regions (not the 0053 function owner).
 * Use the same action authorizer and active hierarchy as management writes. */
export const readVenueManagementRegions = async (
  pool: Pool,
  requestId: string,
  session: string,
  locale: AdminLocale
): Promise<{ regions: VenueManagementRegion[] }> => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(session)) throw new Error('unauthenticated');
  return withRequestContext(pool, 'qigong_api_runtime', { requestId }, async (client) => {
    const identity = await client.query<{ principal_id: string | null }>(
      'SELECT admin.session_principal($1) AS principal_id',
      [session]
    );
    const principal = identity.rows[0]?.principal_id;
    if (!principal) throw new Error('unauthenticated');
    await client.query("SELECT set_config('qigong.principal_id',$1,TRUE)", [principal]);
    const result = await client.query<Record<string, unknown>>(
      `WITH eligible AS (
        SELECT region.id, region.code,
          COALESCE(NULLIF(CASE $2::text WHEN 'en' THEN region.name_en
            WHEN 'zh_CN' THEN region.name_zh_cn ELSE region.name_zh_tw END,''),
            NULLIF(region.name_zh_tw,''), NULLIF(region.name_en,''), region.code) AS "displayName",
          COALESCE(NULLIF(CASE $2::text WHEN 'en' THEN country.name_en
            WHEN 'zh_CN' THEN country.name_zh_cn ELSE country.name_zh_tw END,''),
            NULLIF(country.name_zh_tw,''), NULLIF(country.name_en,''), country.code) AS "countryName",
          (admin.can_access_region(region.id,'checkin.read')
            OR admin.venue_attendance_authorized($1,region.id,'field.read')
            OR admin.venue_attendance_authorized($1,region.id,'field.write')) AS "canRead",
          admin.venue_attendance_authorized($1,region.id,'field.write') AS "canManage"
        FROM core.regions region
        JOIN core.regions country ON country.id=region.parent_region_id
          AND country.active AND country.region_type='country'
        JOIN core.regions global_region ON global_region.id=country.parent_region_id
          AND global_region.active AND global_region.region_type='global'
        WHERE region.active AND region.region_type='operational'
      ) SELECT * FROM eligible WHERE "canRead" OR "canManage" ORDER BY "countryName","displayName",code`,
      [session, locale]
    );
    return { regions: z.array(managementRegionSchema).parse(result.rows) };
  });
};

const capabilitiesSchema = z
  .object({
    management: z.boolean(),
    canReadPeople: z.boolean(),
    canExportPeople: z.boolean()
  })
  .strict();

/** UI hints only. Existing data functions still recheck session/action/region on every call.
 * Uses published authorizers, not direct grants/people table reads or a new DB contract. */
export const readVenueAdminCapabilities = async (
  pool: Pool,
  requestId: string,
  session: string,
  config: VenueSuiteConfig,
  regionId?: string
) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(session)) throw new Error('unauthenticated');
  if (regionId !== undefined) z.uuid().parse(regionId);
  return withRequestContext(pool, 'qigong_api_runtime', { requestId }, async (client) => {
    const identity = await client.query<{ principal_id: string | null }>(
      'SELECT admin.session_principal($1) AS principal_id',
      [session]
    );
    const principal = identity.rows[0]?.principal_id;
    if (!principal) throw new Error('unauthenticated');
    await client.query("SELECT set_config('qigong.principal_id',$1,TRUE)", [principal]);
    const probe = (permission: string) =>
      `EXISTS (SELECT 1 FROM core.regions WHERE active AND region_type='operational'
        ${regionId === undefined ? '' : 'AND id=$1::uuid'} AND admin.can_access_region(id,'${permission}'))`;
    // Permission strings are server literals, never request input.
    const result = await client.query<Record<string, unknown>>(
      `SELECT (${probe('checkin.read')} OR ${probe('venue_attendance.field.read')} OR ${probe('venue_attendance.field.manage')}) AS management,
        ${probe('checkin.read')} AS "canReadPeople", ${probe('stats.export')} AS "canExportPeople"`,
      regionId === undefined ? [] : [regionId]
    );
    const allowed = capabilitiesSchema.parse(result.rows[0]);
    const canReadPeople = config.people?.enabled === true && allowed.canReadPeople;
    const canExportPeople = config.people?.enabled === true && allowed.canExportPeople;
    return {
      management: config.management?.enabled === true && allowed.management,
      people: canReadPeople || canExportPeople,
      canReadPeople,
      canExportPeople
    };
  });
};
