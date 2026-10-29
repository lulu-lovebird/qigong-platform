/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import type { Pool } from '@qigong/database';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adminContentSecurityPolicy, adminLogoUrl } from './admin-branding.js';
import { encodeVenueQr } from './venue-management-qr.js';
import { resolveAdminLocale } from './admin-locale.js';
import { localeSchema } from './ui-localization.js';
import { readVenueManagementRegions } from './venue-admin-capabilities.js';
import { renderVenueManagementPage } from './venue-management-page.js';
import {
  runVenueManagement,
  trustedVenueOrigin,
  venueManagementOperationSchema,
  venueManagementUrls
} from './venue-management.js';

export interface VenueManagementRouteOptions {
  /** Omitted/false registers nothing. Parent must deliberately mount after review. */
  readonly enabled?: boolean;
  readonly publicOrigin: string;
  /** Exact trusted admin origin; defaults to publicOrigin. Never derive from Host. */
  readonly adminOrigin?: string;
  /** Private cookie accessor: reject duplicates; never use body/query principal claims. */
  readonly sessionFor: (request: FastifyRequest) => string | null;
  readonly validCsrf: (request: FastifyRequest) => boolean;
  /** Fresh session check for HTML only. API independently resolves the credential. */
  readonly principalFor: (request: FastifyRequest) => Promise<string | null>;
}
const headers = (reply: FastifyReply) =>
  reply
    .header('cache-control', 'no-store')
    .header('pragma', 'no-cache')
    .header('referrer-policy', 'no-referrer')
    .header('x-content-type-options', 'nosniff');
export const venueManagementError = (error: unknown): { status: number; error: string } => {
  if (error instanceof z.ZodError) return { status: 400, error: 'invalid_request' };
  if (error instanceof Error && error.message === 'unauthenticated')
    return { status: 401, error: 'unauthenticated' };
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
  if (code === '42501') return { status: 403, error: 'forbidden' };
  if (code === 'P0002') return { status: 404, error: 'venue_not_found' };
  if (code === '23505') return { status: 409, error: 'venue_code_reserved' };
  if (code === '40001' || code === '40P01' || code === '55P03')
    return { status: 409, error: 'venue_conflict_reload' };
  if (
    typeof code === 'string' &&
    (code.startsWith('22') || code === '23514' || code === '23502' || code === '23503')
  )
    return { status: 400, error: 'invalid_request' };
  return { status: 503, error: 'venue_management_unavailable' };
};
export const registerVenueManagementRoutes = (
  app: FastifyInstance,
  pool: Pool,
  options: VenueManagementRouteOptions
): void => {
  if (options.enabled !== true) return;
  const origin = trustedVenueOrigin(options.publicOrigin);
  const adminOrigin = trustedVenueOrigin(options.adminOrigin ?? origin);
  app.get('/admin/venue-management', async (request, reply) => {
    headers(reply);
    if (!(await options.principalFor(request).catch(() => null)))
      return reply.code(401).send({ error: 'unauthenticated' });
    return reply
      .header(
        'content-security-policy',
        adminContentSecurityPolicy.replace(
          `img-src ${adminLogoUrl}`,
          `img-src ${adminLogoUrl} data:`
        )
      )
      .type('text/html; charset=utf-8')
      .send(renderVenueManagementPage(resolveAdminLocale(request.query, request.headers.cookie)));
  });
  app.post(
    '/admin/api/venue-management/:action',
    {
      bodyLimit: 16384,
      errorHandler: (error, _request, reply) => {
        headers(reply);
        const status =
          typeof error.statusCode === 'number' && [400, 413, 415].includes(error.statusCode)
            ? error.statusCode
            : 503;
        void reply
          .code(status)
          .send({ error: status === 503 ? 'venue_management_unavailable' : 'invalid_request' });
      }
    },
    async (request, reply) => {
      headers(reply);
      if (
        request.headers.origin !== adminOrigin ||
        !options.validCsrf(request) ||
        (request.headers['sec-fetch-site'] !== undefined &&
          request.headers['sec-fetch-site'] !== 'same-origin')
      )
        return reply.code(403).send({ error: 'invalid_csrf_or_origin' });
      const session = options.sessionFor(request);
      if (!session || !/^[A-Za-z0-9_-]{43}$/.test(session))
        return reply.code(401).send({ error: 'unauthenticated' });
      const action = z
        .object({
          action: z.enum(['regions', 'list', 'get', 'qr', 'capabilities', 'create', 'update'])
        })
        .strict()
        .safeParse(request.params);
      // Strict input prevents client action/principal/version ambiguity.
      if (
        !action.success ||
        (action.data.action === 'qr' && !z.object({}).strict().safeParse(request.query).success) ||
        typeof request.body !== 'object' ||
        request.body === null ||
        Array.isArray(request.body) ||
        'action' in request.body
      )
        return reply.code(400).send({ error: 'invalid_request' });
      if (action.data.action === 'regions') {
        const parsed = z.object({ lang: localeSchema.optional() }).strict().safeParse(request.body);
        if (!parsed.success || !z.object({}).strict().safeParse(request.query).success)
          return reply.code(400).send({ error: 'invalid_request' });
        try {
          return await readVenueManagementRegions(
            pool,
            request.id,
            session,
            parsed.data.lang ?? resolveAdminLocale({}, request.headers.cookie)
          );
        } catch (error) {
          const failure = venueManagementError(error);
          return reply.code(failure.status).send({ error: failure.error });
        }
      }
      const parsed = venueManagementOperationSchema.safeParse({
        ...request.body,
        action: action.data.action === 'qr' ? 'get' : action.data.action
      });
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const data = await runVenueManagement(pool, request.id, session, parsed.data);
        const linkRow = <T extends { code: string }>(row: T) => ({
          ...row,
          urls: venueManagementUrls(row.code, origin)
        });
        if (action.data.action === 'qr') {
          if (!('field' in data)) throw new Error('venue_qr_unavailable');
          // Fresh session + read scope + venue validation already ran through get.
          const image = await encodeVenueQr(data.field.code, origin).catch(() => {
            throw new Error('venue_qr_unavailable');
          });
          return reply.send({ field: linkRow(data.field), ...image });
        }
        return reply
          .code(action.data.action === 'create' ? 201 : 200)
          .send(
            'fields' in data
              ? { fields: data.fields.map(linkRow) }
              : 'field' in data
                ? { field: linkRow(data.field) }
                : data
          );
      } catch (error) {
        const failure = venueManagementError(error);
        return reply.code(failure.status).send({ error: failure.error });
      }
    }
  );
};
