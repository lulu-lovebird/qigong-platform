/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { withRequestContext, type Pool } from '@qigong/database';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  acceptsVenueDebugToken,
  validateVenueDebugConfig,
  venueDebugProof,
  type VenueDebugConfig
} from './venue-debug.js';
import { createLineLearnerIdentityAdapter } from './line-learner-identity.js';
import type { LineConfig } from './line-onboarding.js';
import {
  decodeVenueReadResult,
  type VenueReadRequest,
  type VenueReadResult
} from './venue-admin-read-contract.js';

export const venueQrMigrationVersion = '0051_venue_qr_attendance.sql';
/** Composition-root configuration only. Never read query/body/storage for enablement. */
export interface VenueQrConfig {
  readonly enabled: true;
  readonly publicOrigin: string;
  readonly debug?: VenueDebugConfig;
}
export const validateVenueQrConfig = (config: VenueQrConfig): VenueQrConfig => {
  const origin = new URL(config.publicOrigin);
  if (
    config.enabled !== true ||
    origin.origin !== config.publicOrigin ||
    origin.protocol !== 'https:'
  )
    throw new Error('venue QR requires an explicit HTTPS public origin');
  return Object.freeze({
    enabled: true,
    publicOrigin: origin.origin,
    ...(config.debug ? { debug: validateVenueDebugConfig(config.debug) } : {})
  });
};
export const venueQrInputSchema = z.strictObject({
  idToken: z.string().min(1).max(4096),
  venue: z
    .string()
    .max(64)
    .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180)
});
const formalSuccessSchema = z.strictObject({
  ok: z.literal(true),
  venue: z.strictObject({
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    timezone: z.string().min(1).max(100)
  }),
  checkedInAt: z.iso.datetime({ offset: true }),
  attendanceDate: z.iso.date(),
  replayed: z.boolean()
});
export const venueQrSuccessSchema = z.union([
  formalSuccessSchema,
  formalSuccessSchema.extend({
    isTest: z.literal(true),
    verificationMode: z.literal('distance_debug')
  })
]);
export type VenueQrSuccess = z.infer<typeof venueQrSuccessSchema>;
export type VenueQrOutcome =
  | { readonly status: 200; readonly body: VenueQrSuccess }
  | {
      readonly status: 400 | 401 | 403 | 409 | 503;
      readonly body: { readonly ok: false; readonly error: string };
    };
const denied = (status: 400 | 401 | 403 | 409 | 503, error: string): VenueQrOutcome => ({
  status,
  body: { ok: false, error }
});

export const createVenueQrCheckin = (pool: Pool, line: LineConfig, debug?: VenueDebugConfig) => {
  const trustedDebug = debug ? validateVenueDebugConfig(debug) : undefined;
  // The legacy verifyIdToken subject-only adapter is deliberately not used here.
  const identity = createLineLearnerIdentityAdapter(pool, {
    loginChannelId: line.loginChannelId,
    ...(line.verifyIdentity
      ? { verifyIdentity: (token: string) => line.verifyIdentity!(token) }
      : {})
  });
  return async (
    requestId: string,
    input: unknown,
    debugToken?: unknown
  ): Promise<VenueQrOutcome> => {
    const parsed = venueQrInputSchema.safeParse(input);
    if (!parsed.success) return denied(400, 'invalid_input');
    const isDebug = debugToken !== undefined;
    if (isDebug && !acceptsVenueDebugToken(trustedDebug, debugToken, parsed.data.venue))
      return denied(403, 'venue_debug_denied');
    const verified = await identity(requestId, { idToken: parsed.data.idToken });
    if (!verified.ok) return denied(verified.statusCode, verified.error);
    try {
      const body = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId },
        async (client) => {
          // Recheck expiry after identity lookup; the DB rechecks its own enablement
          // after serialization too. No client boolean can select the debug function.
          if (isDebug && !acceptsVenueDebugToken(trustedDebug, debugToken, parsed.data.venue))
            throw Object.assign(new Error('venue_debug_denied'), { code: '42501' });
          const issued = Math.floor(Date.now() / 1000);
          const params: unknown[] = [
            verified.identity.subject,
            parsed.data.venue,
            parsed.data.latitude,
            parsed.data.longitude
          ];
          if (isDebug && trustedDebug)
            params.push(
              issued,
              venueDebugProof(
                trustedDebug,
                requestId,
                verified.identity.subject,
                parsed.data.venue,
                issued
              )
            );
          const result = await client.query<{ data: unknown }>(
            isDebug
              ? 'SELECT platform.venue_debug_checkin($1,$2,$3,$4,$5,$6) AS data'
              : 'SELECT platform.venue_qr_checkin($1,$2,$3,$4) AS data',
            params
          );
          if (result.rows.length !== 1) throw new Error('invalid venue database result');
          const success = venueQrSuccessSchema.parse(result.rows[0]?.data);
          if (success.venue.code !== parsed.data.venue || 'isTest' in success !== isDebug)
            throw new Error('invalid venue binding');
          const localDate = new Intl.DateTimeFormat('en-CA', {
            timeZone: success.venue.timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(new Date(success.checkedInAt));
          if (localDate !== success.attendanceDate) throw new Error('invalid venue date');
          return success;
        }
      );
      return { status: 200, body };
    } catch (error) {
      // No GPS, credentials, SQL diagnostics or arbitrary exception messages in responses/logs.
      if (error instanceof Error && 'code' in error) {
        if (error.code === '42501' && error.message === 'venue_debug_denied')
          return denied(403, 'venue_debug_denied');
        if (error.code === '42501') return denied(403, 'identity_consent_or_venue_unavailable');
        if (error.code === 'P0001' && error.message === 'venue_outside_window')
          return denied(409, 'outside_window');
        if (error.code === 'P0001' && error.message === 'venue_outside_radius')
          return denied(409, 'outside_radius');
      }
      return denied(503, 'venue_unavailable');
    }
  };
};

/** Every call verifies session anew. The session token originates only in admin-auth. */
export const readVenueQrAttendance = async (
  pool: Pool,
  requestId: string,
  session: string,
  request: VenueReadRequest
): Promise<VenueReadResult> => {
  if (request.operation === 'field.read') throw new Error('unsupported venue read');
  return withRequestContext(pool, 'qigong_api_runtime', { requestId }, async (client) => {
    const principal = (
      await client.query<{ principal_id: string | null }>(
        'SELECT admin.session_principal($1) AS principal_id',
        [session]
      )
    ).rows[0]?.principal_id;
    if (!principal || !z.uuid().safeParse(principal).success) throw new Error('unauthenticated');
    await client.query("SELECT set_config('qigong.principal_id', $1, TRUE)", [principal]);
    const result = await client.query<{ data: unknown }>(
      'SELECT admin.venue_qr_read($1,$2,$3,$4,$5,$6,$7,$8,$9) AS data',
      [
        session,
        request.regionId,
        request.from,
        request.until,
        request.operation === 'attendance.read' ? request.page : 1,
        request.operation === 'attendance.read' ? request.limit : 100,
        request.operation === 'attendance.export',
        request.filters.fieldId,
        request.filters.method
      ]
    );
    const data = decodeVenueReadResult(result.rows[0]?.data, request);
    if (result.rows.length !== 1 || data.state !== 'available')
      throw new Error('invalid venue read result');
    return data;
  });
};

/** Parser/body-limit exceptions must not echo request fragments or reach diagnostic logs. */
export const venueQrRouteErrorHandler = (
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply
): void => {
  void reply
    .header('cache-control', 'no-store')
    .header('referrer-policy', 'no-referrer')
    .code(error.statusCode === 413 ? 413 : error.statusCode && error.statusCode < 500 ? 400 : 503)
    .send({ ok: false, error: 'invalid_or_unavailable_request' });
};

export const registerVenueQrCheckinRoutes = (
  app: FastifyInstance,
  pool: Pool,
  line: LineConfig,
  config: VenueQrConfig
): void => {
  const checkin = createVenueQrCheckin(pool, line, config.debug);
  app.post(
    '/api/line/venue-checkin',
    { bodyLimit: 6144, errorHandler: venueQrRouteErrorHandler },
    async (request, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff');
      if (
        request.headers.origin !== config.publicOrigin ||
        request.headers['x-venue-checkin'] !== '1' ||
        !request.headers['content-type']?.startsWith('application/json')
      )
        return reply.code(403).send({ ok: false, error: 'invalid_origin' });
      const result = await checkin(
        request.id,
        request.body,
        request.headers['x-venue-debug-token']
      );
      return reply.code(result.status).send(result.body);
    }
  );
};
