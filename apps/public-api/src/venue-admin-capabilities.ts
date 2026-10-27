/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import type { VenueSuiteConfig } from './venue-suite.js';

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
