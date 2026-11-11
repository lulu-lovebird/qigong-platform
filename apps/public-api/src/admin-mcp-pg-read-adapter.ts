/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { withRequestContext } from '@qigong/database';
import type { Pool } from 'pg';
import { z } from 'zod';
import { adminMcpLimits, adminMcpReadRowSchemas } from './admin-mcp-contract.js';
import { adminMcpReadContextSchema, type AdminMcpReadContext } from './admin-mcp-dispatch.js';
import {
  decodeAdminMcpReadPage,
  parseAdminMcpReadRequest,
  type AdminMcpReadQuery
} from './admin-mcp-read-model.js';
import {
  adminMcpReadRequiredScopes,
  type AdminMcpReadAdapterResult,
  type TrustedAdminMcpReadAdapter
} from './admin-mcp-read-service.js';

const campaignSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    timezone: z.string(),
    isActive: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true })
  })
  .strict()
  .readonly();
const entrySchema = z
  .object({
    id: z.uuid(),
    guideDate: z.iso.date(),
    title: z.string().nullable(),
    content: z.string(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true })
  })
  .strict();
const venueSchema = z
  .object({
    id: z.uuid(),
    regionId: z.uuid(),
    code: z.string(),
    name: z.string(),
    isActive: z.boolean()
  })
  .strict();

/**
 * 0063 has no publication lifecycle. A reviewed, trusted policy must supply it;
 * the adapter never equates isActive with published/draft/archived. Without a policy,
 * guidance reads fail closed. This is not an OAuth verifier or production wiring.
 */
export type AdminMcpCampaignStatusPolicy = (
  campaign: z.infer<typeof campaignSchema>
) => z.infer<typeof adminMcpReadRowSchemas.campaign>['status'] | null;

const project = (
  input: unknown,
  query: AdminMcpReadQuery,
  campaignStatus: AdminMcpCampaignStatusPolicy | undefined
): unknown => {
  const campaign = (raw: z.infer<typeof campaignSchema>) => {
    if (campaignStatus === undefined) throw new Error('guidance mapping unavailable');
    // 0063 explicitly includes end_date in receipt lookup; convert that documented
    // inclusive local date to the canonical exclusive local end (not elapsed zoned time).
    const until = new Date(Date.parse(raw.endDate) + 86_400_000).toISOString().slice(0, 10);
    return adminMcpReadRowSchemas.campaign.parse({
      campaignId: raw.id,
      title: raw.title,
      status: campaignStatus(raw),
      from: raw.startDate,
      until,
      timezone: raw.timezone
    });
  };
  switch (query.operation) {
    case 'guidance_list':
      return {
        items: z.array(campaignSchema).max(query.fetchLimit).parse(input).map(campaign)
      };
    case 'guidance_get': {
      const raw = z
        .object({ campaign: campaignSchema, entries: z.array(entrySchema).max(query.fetchLimit) })
        .strict()
        .parse(input);
      return {
        campaign: campaign(raw.campaign),
        entries: raw.entries.map((entry) =>
          adminMcpReadRowSchemas.entry.parse({ date: entry.guideDate, content: entry.content })
        )
      };
    }
    case 'venues_list':
      return {
        items: z
          .array(venueSchema)
          .max(query.fetchLimit)
          .parse(input)
          .map((venue) =>
            adminMcpReadRowSchemas.venue.parse({
              venueId: venue.id,
              regionId: venue.regionId,
              name: venue.name,
              active: venue.isActive
            })
          )
      };
  }
};

// Return promptly on cancellation, but retain ownership of the transaction until its
// bounded statement finishes and rolls back. No release/double-release or owner query.
const abortable = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T | undefined> =>
  new Promise((resolve, reject) => {
    const abort = () => resolve(undefined);
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error instanceof Error ? error : new Error('read unavailable'));
      }
    );
    if (signal.aborted) abort();
  });

export const createAdminMcpPgReadAdapter = (
  pool: Pool,
  campaignStatus?: AdminMcpCampaignStatusPolicy
): TrustedAdminMcpReadAdapter =>
  Object.freeze({
    async read(
      query: AdminMcpReadQuery,
      context: AdminMcpReadContext
    ): Promise<AdminMcpReadAdapterResult> {
      const parsed = adminMcpReadContextSchema.safeParse(context);
      if (!parsed.success) return { status: 'permission_denied' };
      context = parsed.data;
      const { authorization: auth, signal } = context;
      const permitted = () => {
        const scope = adminMcpReadRequiredScopes[query.operation];
        return (
          auth.principalActive &&
          auth.isSuperAdmin &&
          auth.clientAuthorized &&
          Date.parse(auth.expiresAt) > Date.now() &&
          scope !== undefined &&
          auth.scopes.includes(scope)
        );
      };
      if (!permitted()) return { status: 'permission_denied' };
      if (signal.aborted) return { status: 'unavailable' };
      try {
        const { operation, after, fetchLimit, ...selectors } = query;
        parseAdminMcpReadRequest({
          tool: operation,
          arguments: { ...selectors, cursor: null, limit: fetchLimit - 1 }
        });
        if (after !== null) (operation === 'guidance_get' ? z.iso.date() : z.uuid()).parse(after);
        if (operation !== 'venues_list' && campaignStatus === undefined)
          return { status: 'unavailable' };
        const transaction = withRequestContext(
          pool,
          'qigong_api_runtime',
          { requestId: context.requestId, principalId: auth.principalId },
          async (client) => {
            signal.throwIfAborted();
            // Use server-side deadlines, not a client-only timeout that leaves SQL running.
            const deadline = Math.max(
              1,
              Math.min(adminMcpLimits.timeoutMs, Date.parse(auth.expiresAt) - Date.now())
            );
            await client.query(`SELECT set_config('statement_timeout', $1, TRUE)`, [
              String(deadline)
            ]);
            let result;
            switch (query.operation) {
              case 'guidance_list':
                await client.query(
                  `SELECT set_config('qigong.mcp_read_from', $1, TRUE),
                          set_config('qigong.mcp_read_until', $2, TRUE),
                          set_config('qigong.mcp_read_timezone', $3, TRUE)`,
                  [query.from, query.until, query.timezone]
                );
                signal.throwIfAborted();
                result = await client.query<{ data: unknown }>(
                  'SELECT admin.mcp_read_guidance_campaigns($1::uuid, $2::integer) AS data',
                  [query.after, query.fetchLimit]
                );
                break;
              case 'guidance_get':
                result = await client.query<{ data: unknown }>(
                  'SELECT admin.mcp_read_guidance_entries($1::uuid, $2::date, $3::integer) AS data',
                  [query.campaignId, query.after, query.fetchLimit]
                );
                break;
              case 'venues_list':
                result = await client.query<{ data: unknown }>(
                  'SELECT admin.mcp_read_venues($1::uuid, $2::uuid, $3::integer) AS data',
                  [query.regionId, query.after, query.fetchLimit]
                );
                break;
            }
            signal.throwIfAborted();
            if (!permitted()) throw new Error('authorization expired');
            if (result.rows.length !== 1) throw new Error('invalid read result');
            const data = project(result.rows[0]?.data, query, campaignStatus);
            // Validate selectors, ordering and lookahead too; return the entire bounded
            // page so the service remains the sole owner of public cursor generation.
            decodeAdminMcpReadPage(data, query, auth);
            return data;
          }
        );
        const data = await abortable(transaction, signal);
        if (signal.aborted || data === undefined) return { status: 'unavailable' };
        if (!permitted()) return { status: 'permission_denied' };
        return { status: 'ok', data };
      } catch (error) {
        if (signal.aborted) return { status: 'unavailable' };
        if (typeof error === 'object' && error !== null && 'code' in error) {
          if (error.code === '42501') return { status: 'permission_denied' };
          if (error.code === 'P0002') return { status: 'not_found' };
        }
        return { status: 'unavailable' };
      }
    }
  });
