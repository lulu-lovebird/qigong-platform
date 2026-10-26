/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { withRequestContext, type Pool } from '@qigong/database';
import {
  decodeVenuePeopleResult,
  type VenuePeopleQuery,
  type VenuePeopleResult
} from './venue-people-helpers.js';

export const venuePeopleMigrationVersion = '0054_venue_people_read.sql';
/** Server dependency, NOT a capability derived from browser input. */
export interface VenuePeopleService {
  read(
    requestId: string,
    session: string,
    query: VenuePeopleQuery,
    exporting: boolean
  ): Promise<VenuePeopleResult>;
}
export const createVenuePeopleService = (pool: Pool): VenuePeopleService =>
  Object.freeze({
    read: (requestId: string, session: string, query: VenuePeopleQuery, exporting: boolean) =>
      withRequestContext(pool, 'qigong_api_runtime', { requestId }, async (client) => {
        // No caller-supplied actor/principal/person context. SQL resolves session every time.
        const result = await client.query<{ data: unknown }>(
          'SELECT admin.venue_people_read($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS data',
          [
            session,
            query.regionId,
            query.from,
            query.until,
            query.fieldId,
            query.personId,
            query.search,
            query.mode,
            query.sort,
            query.direction,
            query.page,
            query.limit,
            exporting
          ]
        );
        if (result.rows.length !== 1) throw new Error('invalid venue people result');
        return decodeVenuePeopleResult(result.rows[0]?.data, query, exporting);
      })
  });
