/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { withRequestContext, type Pool } from '@qigong/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createLineLearnerIdentityAdapter,
  type LineLearnerIdentityOptions
} from './line-learner-identity.js';

/** Server-owned composition only; never accept channel/verifier/resolver from HTTP. */
export interface VenueHistoryConfig {
  readonly publicOrigin: string;
  readonly loginChannelId: string;
  readonly verifyIdentity?: LineLearnerIdentityOptions['verifyIdentity'];
}
const venueCode = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/);
export const venueHistoryInputSchema = z.strictObject({
  idToken: z.string().trim().min(1).max(4096),
  view: z.enum(['formal', 'test']).optional(),
  month: z
    .string()
    .regex(/^(?!0000)[0-9]{4}-(?:0[1-9]|1[0-2])$/)
    .optional(),
  venue: venueCode.optional(),
  page: z.number().int().positive().optional()
});
const count = z.number().int().nonnegative();
export const venueHistorySuccessSchema = z.strictObject({
  ok: z.literal(true),
  timezone: z.literal('Asia/Taipei'),
  totals: z.strictObject({ attendanceCount: count, attendanceDays: count, monthCount: count }),
  page: z.number().int().positive(),
  pageSize: z.literal(20),
  hasMore: z.boolean(),
  entries: z
    .array(
      z.strictObject({
        id: z.uuid(),
        venueCode,
        venueName: z.string().min(1).max(120),
        checkedInAt: z.iso.datetime({ offset: true }),
        venueLocalDate: z.iso.date(),
        isTest: z.literal(true).optional(),
        verificationMode: z.literal('distance_debug').optional(),
        venueTimezone: z
          .string()
          .min(1)
          .max(100)
          .refine((timezone) => {
            try {
              new Intl.DateTimeFormat('en', { timeZone: timezone });
              return true;
            } catch {
              return false;
            }
          })
      })
    )
    .max(20)
});
export type VenueHistorySuccess = z.infer<typeof venueHistorySuccessSchema>;
export type VenueHistoryOutcome =
  | { readonly status: 200; readonly body: VenueHistorySuccess }
  | {
      readonly status: 400 | 401 | 403 | 503;
      readonly body: { readonly ok: false; readonly error: string };
    };
const denied = (status: 400 | 401 | 403 | 503, error: string): VenueHistoryOutcome => ({
  status,
  body: { ok: false, error }
});

/** No mock fallback. Verify every request, then reauthorize inside the DB read. */
export const createVenueHistory = (pool: Pool, config: VenueHistoryConfig) => {
  const identity = createLineLearnerIdentityAdapter(pool, {
    loginChannelId: config.loginChannelId,
    ...(config.verifyIdentity ? { verifyIdentity: config.verifyIdentity } : {})
  });
  return async (requestId: string, input: unknown): Promise<VenueHistoryOutcome> => {
    const parsed = venueHistoryInputSchema.safeParse(input);
    if (!parsed.success) return denied(400, 'invalid_input');
    const verified = await identity(requestId, { idToken: parsed.data.idToken });
    if (!verified.ok) return denied(verified.statusCode, verified.error);
    try {
      const body = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId },
        async (client) => {
          const result = await client.query<{ data: unknown }>(
            parsed.data.view === 'test'
              ? 'SELECT platform.venue_debug_history($1,$2,$3,$4,$5) AS data'
              : 'SELECT platform.venue_personal_history($1,$2,$3,$4,$5) AS data',
            [
              'line',
              verified.identity.subject,
              parsed.data.month ?? null,
              parsed.data.venue ?? null,
              parsed.data.page ?? 1
            ]
          );
          if (result.rows.length !== 1) throw new Error('invalid venue history result');
          const success = venueHistorySuccessSchema.parse(result.rows[0]?.data);
          if (
            success.page !== (parsed.data.page ?? 1) ||
            success.totals.attendanceDays > success.totals.attendanceCount ||
            success.totals.monthCount > success.totals.attendanceCount ||
            (parsed.data.view === 'test' && Object.values(success.totals).some((n) => n !== 0)) ||
            success.entries.some((entry) =>
              parsed.data.view === 'test'
                ? entry.isTest !== true || entry.verificationMode !== 'distance_debug'
                : entry.isTest !== undefined || entry.verificationMode !== undefined
            ) ||
            success.entries.some(
              (entry) =>
                (parsed.data.venue !== undefined && entry.venueCode !== parsed.data.venue) ||
                (parsed.data.month !== undefined &&
                  !entry.venueLocalDate.startsWith(parsed.data.month + '-'))
            )
          )
            throw new Error('invalid venue history binding');
          return success;
        }
      );
      return { status: 200, body };
    } catch (error) {
      // Only stable SQLSTATEs; no token, subject, person, query or diagnostics.
      if (error instanceof Error && 'code' in error) {
        if (error.code === '42501') return denied(403, 'identity_consent_or_venue_unavailable');
        if (error.code === '22023') return denied(400, 'invalid_input');
      }
      return denied(503, 'venue_unavailable');
    }
  };
};

export const registerVenueHistoryRoutes = (
  app: FastifyInstance,
  pool: Pool,
  config: VenueHistoryConfig
): void => {
  const origin = new URL(config.publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== config.publicOrigin)
    throw new Error('venue history requires an explicit HTTPS public origin');
  const history = createVenueHistory(pool, config);
  app.post(
    '/api/line/venue-history',
    {
      bodyLimit: 6144,
      errorHandler: (error, request, reply) => {
        // Reuse no request fragments, including malformed JSON/body-limit errors.
        void request;
        void reply
          .header('cache-control', 'no-store')
          .header('referrer-policy', 'no-referrer')
          .header('x-content-type-options', 'nosniff')
          .code(error.statusCode && error.statusCode < 500 ? 400 : 503)
          .send({ ok: false, error: 'invalid_or_unavailable_request' });
      }
    },
    async (request, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff');
      if (
        request.headers.origin !== origin.origin ||
        request.headers['x-venue-history'] !== '1' ||
        request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
      )
        return reply.code(403).send({ ok: false, error: 'invalid_origin' });
      const result = await history(request.id, request.body);
      return reply.code(result.status).send(result.body);
    }
  );
};
