/** Read-only guidance, never identity/attendance authority or an invitation.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { withRequestContext, type Pool } from '@qigong/database';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { LineConfig } from './line-onboarding.js';
import { verifiedLineIdentitySchema, verifyLineIdentity } from './line-profile.js';
import { trustedVenueOrigin } from './venue-management.js';

export const venueEntryCodeSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/)
  .refine((value) => value.trim() === value); // JS $ alone also matches before a final newline.
const timestamp = z
  .string()
  .max(64)
  .pipe(z.iso.datetime({ offset: true }))
  .refine(
    (value) =>
      /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      Number.isFinite(Date.parse(value))
  );
const publicText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        value.trim().length > 0 &&
        [...value].every((character) => {
          const point = character.codePointAt(0) ?? 0;
          return point >= 32 && point !== 127;
        })
    );
const timezone = publicText(100).refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
});
export const venueEntrySessionSchema = z
  .strictObject({
    startsAt: timestamp,
    endsAt: timestamp,
    opensAt: timestamp
  })
  .refine(
    (value) =>
      Date.parse(value.endsAt) > Date.parse(value.startsAt) &&
      Date.parse(value.opensAt) < Date.parse(value.startsAt)
  );
export type VenueEntrySession = z.infer<typeof venueEntrySessionSchema>;

/** Schema60 canonical public DTO. Only PostgreSQL decides the availability state.
 * Date parsing below checks transport coherence, not local weekdays or permission.
 * unavailable may carry a bounded venue (bad schedule) or null (lookup failure). */
export const venueEntryAvailabilitySchema = z
  .strictObject({
    version: z.literal(1),
    availability: z.enum([
      'open',
      'not_activity_day',
      'before_open',
      'ended',
      'disabled',
      'not_found',
      'unavailable'
    ]),
    venue: z
      .strictObject({ code: venueEntryCodeSchema, name: publicText(120), timezone })
      .nullable(),
    observedAt: timestamp,
    relevantSession: venueEntrySessionSchema.nullable(),
    nextSession: venueEntrySessionSchema.nullable()
  })
  .superRefine((value, context) => {
    const fail = () => context.addIssue({ code: 'custom', message: 'invalid venue entry context' });
    switch (value.availability) {
      case 'open':
      case 'before_open':
      case 'ended':
        if (!value.venue || !value.relevantSession) fail();
        break;
      case 'not_activity_day':
        if (!value.venue || value.relevantSession !== null) fail();
        break;
      case 'disabled':
        if (!value.venue || value.relevantSession !== null || value.nextSession !== null) fail();
        break;
      case 'not_found':
        if (value.venue !== null || value.relevantSession !== null || value.nextSession !== null)
          fail();
        break;
      case 'unavailable':
        if (value.relevantSession !== null || value.nextSession !== null) fail();
    }
    if (value.nextSession && Date.parse(value.nextSession.opensAt) <= Date.parse(value.observedAt))
      fail();
  });
export type VenueEntryAvailabilityDto = z.infer<typeof venueEntryAvailabilitySchema>;
export type VenueEntryAvailability = VenueEntryAvailabilityDto['availability'];

export const venueEntryLearnerStatusSchema = z.strictObject({
  version: z.literal(1),
  status: z.enum(['needs_application', 'pending', 'approved', 'blocked'])
});
export type VenueEntryLearnerStatusDto = z.infer<typeof venueEntryLearnerStatusSchema>;
export const venueEntrySelfStatusSchema = z.discriminatedUnion('status', [
  z.strictObject({
    version: z.literal(1),
    status: z.literal('approved'),
    privacy: z.enum(['clear', 'required'])
  }),
  z.strictObject({
    version: z.literal(1),
    status: z.enum(['needs_application', 'pending', 'blocked']),
    privacy: z.null()
  })
]);
export type VenueEntrySelfStatusDto = z.infer<typeof venueEntrySelfStatusSchema>;
export const venueEntryCredentialSchema = z.strictObject({
  idToken: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => value.trim().length > 0)
});
// Equivalent to the existing strict write adapter's privacy decoder; do not
// return its policy hash, reflection choice, or any other private source fields.
const privacySchema = z.discriminatedUnion('active', [
  z.strictObject({ active: z.literal(false), reflectionConsent: z.boolean() }),
  z.strictObject({
    active: z.literal(true),
    required: z.boolean(),
    unavailable: z.boolean(),
    reflectionConsent: z.boolean(),
    version: z.string().min(1),
    hash: z
      .string()
      .length(64)
      .regex(/^[0-9a-f]{64}$/)
  })
]);
const invalidRequest = () => ({ error: 'invalid_venue_entry_request' as const });
const unavailable = () => ({ error: 'venue_entry_unavailable' as const });
export type VenueEntryAvailabilityResult =
  | { readonly status: 200 | 404 | 410; readonly body: VenueEntryAvailabilityDto }
  | { readonly status: 400; readonly body: ReturnType<typeof invalidRequest> }
  | { readonly status: 503; readonly body: ReturnType<typeof unavailable> };
export type VenueEntrySelfStatusResult =
  | { readonly status: 200; readonly body: VenueEntrySelfStatusDto }
  | { readonly status: 400; readonly body: ReturnType<typeof invalidRequest> }
  | { readonly status: 401; readonly body: { readonly error: 'invalid_line_identity' } }
  | { readonly status: 503; readonly body: ReturnType<typeof unavailable> };

/** Lazy construction: no connection, schema probe or default-off readiness claim.
 * 503 is deliberately a fixed error, not a DTO with an invented observedAt. */
export const createVenueEntryAvailability =
  (pool: Pool) =>
  async (requestId: string, code: unknown): Promise<VenueEntryAvailabilityResult> => {
    const input = venueEntryCodeSchema.safeParse(code);
    if (!input.success) return { status: 400, body: invalidRequest() };
    try {
      const body = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId },
        async (client) => {
          const result = await client.query<{ data: unknown }>(
            'SELECT platform.venue_entry_availability($1) AS data',
            [input.data]
          );
          if (result.rows.length !== 1) throw new Error('invalid venue entry result');
          const data = venueEntryAvailabilitySchema.parse(result.rows[0]?.data);
          if (data.venue && data.venue.code !== input.data)
            throw new Error('invalid venue binding');
          return data;
        }
      );
      if (body.availability === 'unavailable') return { status: 503, body: unavailable() };
      return {
        status:
          body.availability === 'not_found' ? 404 : body.availability === 'disabled' ? 410 : 200,
        body
      };
    } catch {
      return { status: 503, body: unavailable() };
    }
  };

export type VenueEntryLineConfig = Pick<LineConfig, 'loginChannelId' | 'verifyIdentity'>;
/** Pure token verification only: never reuse onboarding's nickname-refresh wrapper
 * or the approved-only write resolver (which cannot distinguish pending/unknown).
 * clear means no current necessary gate, not proof of historic consent. */
export const createVenueEntrySelfStatus = (pool: Pool, line: VenueEntryLineConfig) => {
  const channelId = z.string().trim().min(1).max(100).parse(line.loginChannelId);
  // Deliberately ignore legacy verifyIdToken, even if a full LineConfig is supplied.
  const verify = line.verifyIdentity ?? ((token: string) => verifyLineIdentity(token, channelId));
  return async (requestId: string, credential: unknown): Promise<VenueEntrySelfStatusResult> => {
    const input = venueEntryCredentialSchema.safeParse(credential);
    if (!input.success) return { status: 400, body: invalidRequest() };
    let subject: string;
    try {
      subject = verifiedLineIdentitySchema.parse(await verify(input.data.idToken)).subject;
      if (subject.length !== 33) throw new Error('invalid LINE subject');
    } catch {
      // Provider/network rejection is an authentication retry, never needs_application.
      return { status: 401, body: { error: 'invalid_line_identity' } };
    }
    try {
      const body = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId },
        async (client) => {
          const result = await client.query<{ data: unknown }>(
            'SELECT platform.venue_entry_learner_status($1) AS data',
            [subject]
          );
          if (result.rows.length !== 1) throw new Error('invalid learner status result');
          const data = venueEntryLearnerStatusSchema.parse(result.rows[0]?.data);
          if (data.status !== 'approved')
            return venueEntrySelfStatusSchema.parse({ ...data, privacy: null });
          const privacyResult = await client.query<{ data: unknown }>(
            'SELECT platform.privacy_usage($1,$2) AS data',
            ['line', subject]
          );
          if (privacyResult.rows.length !== 1) throw new Error('invalid privacy result');
          const privacy = privacySchema.parse(privacyResult.rows[0]?.data);
          if (privacy.active && privacy.unavailable) throw new Error('privacy unavailable');
          return venueEntrySelfStatusSchema.parse({
            ...data,
            privacy: privacy.active && privacy.required ? 'required' : 'clear'
          });
        }
      );
      return { status: 200, body };
    } catch {
      return { status: 503, body: unavailable() };
    }
  };
};

const responseHeaders = (reply: FastifyReply) =>
  reply
    .header('cache-control', 'no-store')
    .header('referrer-policy', 'no-referrer')
    .header('x-content-type-options', 'nosniff');
const routeErrorHandler = (error: FastifyError, _request: unknown, reply: FastifyReply): void => {
  const status =
    error.statusCode === 413 ? 413 : error.statusCode && error.statusCode < 500 ? 400 : 503;
  void responseHeaders(reply)
    .code(status)
    .send(status === 503 ? unavailable() : invalidRequest());
};
const availabilityCode = (rawUrl: string): string | null => {
  if (rawUrl.length > 512 || rawUrl.includes('#')) return null;
  const query = rawUrl.split('?');
  if (query.length !== 2 || !query[1] || query[1].includes('&')) return null;
  try {
    decodeURIComponent(query[1]); // Reject malformed percent encoding / UTF-8.
    const entries = [...new URLSearchParams(query[1])];
    if (entries.length !== 1 || entries[0]?.[0] !== 'venue') return null;
    const code = venueEntryCodeSchema.safeParse(entries[0][1]);
    return code.success ? code.data : null;
  } catch {
    return null;
  }
};

/** Composition root must call ONLY after existing QR+LINE configuration and new
 * capability readiness pass. No automatic registration, flags, UI or health gate.
 * request.id must be the server UUID used by the existing request-context adapter.
 * Public GET is intentionally anonymous; source markers confer no authority. */
export const registerVenueEntryGuidanceRoutes = (
  app: FastifyInstance,
  pool: Pool,
  line: VenueEntryLineConfig,
  publicOrigin: string
): void => {
  const origin = trustedVenueOrigin(publicOrigin);
  const lookup = createVenueEntryAvailability(pool);
  const selfStatus = createVenueEntrySelfStatus(pool, line);
  app.get(
    '/api/venue-entry/availability',
    {
      logLevel: 'silent',
      bodyLimit: 6144,
      errorHandler: routeErrorHandler,
      onRequest: async (_request, reply) => {
        responseHeaders(reply);
      }
    },
    async (request, reply) => {
      const code = availabilityCode(request.url);
      if (code === null) return reply.code(400).send(invalidRequest());
      const result = await lookup(request.id, code);
      return reply.code(result.status).send(result.body);
    }
  );
  app.post(
    '/api/line/venue-entry-status',
    {
      logLevel: 'silent',
      bodyLimit: 6144,
      errorHandler: routeErrorHandler,
      onRequest: async (request, reply) => {
        responseHeaders(reply);
        if (request.url.length > 512 || request.url.includes('?') || request.url.includes('#'))
          return reply.code(400).send(invalidRequest());
        if (request.headers.origin !== origin || request.headers['x-venue-entry'] !== '1')
          return reply.code(403).send({ error: 'invalid_venue_entry_origin' });
        if (
          request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !==
          'application/json'
        )
          return reply.code(400).send(invalidRequest());
      }
    },
    async (request, reply) => {
      const result = await selfStatus(request.id, request.body);
      return reply.code(result.status).send(result.body);
    }
  );
};
