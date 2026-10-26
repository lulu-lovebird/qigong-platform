/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  decodeVenuePeopleResult,
  encodeVenuePeopleCsv,
  parseVenuePeopleQuery
} from './venue-people-helpers.js';
import { renderVenuePeoplePage, venuePeopleContentSecurityPolicy } from './venue-people-page.js';
import type { VenuePeopleService } from './venue-people-service.js';
import { venueQrRouteErrorHandler } from './venue-qr.js';

/** Composition-root configuration only, never a query/body/browser capability. */
export interface VenuePeopleConfig {
  readonly enabled: true;
  readonly publicOrigin: string;
}
export interface VenuePeopleRouteOptions {
  readonly config: VenuePeopleConfig;
  readonly service: VenuePeopleService;
  /** Existing admin-auth principalFor: revalidate session for shell navigation, no cached principal. */
  readonly pagePrincipalFor: (request: FastifyRequest) => Promise<string | null>;
}
export const validateVenuePeopleConfig = (config: VenuePeopleConfig): VenuePeopleConfig => {
  const origin = new URL(config.publicOrigin);
  if (
    config.enabled !== true ||
    origin.protocol !== 'https:' ||
    origin.origin !== config.publicOrigin
  )
    throw new Error('venue people requires explicit HTTPS origin');
  return Object.freeze({ enabled: true, publicOrigin: origin.origin });
};
const cookieToken = (request: FastifyRequest, name: string): string | null => {
  const matches = (request.headers.cookie ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(name + '='));
  if (matches.length !== 1) return null;
  const token = matches[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
};

/** Not auto-mounted. Parent owns route registration and navigation after integration review. */
export const registerVenuePeopleRoutes = (
  app: FastifyInstance,
  options: VenuePeopleRouteOptions
): void => {
  const config = validateVenuePeopleConfig(options.config);
  app.get(
    '/admin/venue-people',
    { errorHandler: venueQrRouteErrorHandler },
    async (request, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff');
      if (!cookieToken(request, '__Host-qigong-admin'))
        return reply.code(401).send({ error: 'unauthenticated' });
      if (Object.keys(request.query as Record<string, unknown>).length !== 0)
        return reply.code(400).send({ error: 'invalid_query' });
      try {
        if (!(await options.pagePrincipalFor(request)))
          return reply.code(401).send({ error: 'unauthenticated' });
        // Shell has no names or data; read and export independently authorize in SQL.
        return reply
          .header('content-security-policy', venuePeopleContentSecurityPolicy)
          .type('text/html; charset=utf-8')
          .send(renderVenuePeoplePage());
      } catch {
        return reply.code(503).send({ error: 'venue_people_unavailable' });
      }
    }
  );
  for (const exporting of [false, true]) {
    app.post(
      '/admin/venue-people/api/' + (exporting ? 'export' : 'read'),
      { bodyLimit: 4096, errorHandler: venueQrRouteErrorHandler },
      async (request, reply) => {
        reply
          .header('cache-control', 'no-store')
          .header('referrer-policy', 'no-referrer')
          .header('x-content-type-options', 'nosniff');
        const session = cookieToken(request, '__Host-qigong-admin');
        if (!session) return reply.code(401).send({ error: 'unauthenticated' });
        const saved = cookieToken(request, '__Host-qigong-admin-csrf'),
          csrf = request.headers['x-csrf-token'];
        if (
          request.headers.origin !== config.publicOrigin ||
          (request.headers['sec-fetch-site'] !== undefined &&
            request.headers['sec-fetch-site'] !== 'same-origin') ||
          request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json' ||
          !saved ||
          typeof csrf !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(csrf) ||
          !timingSafeEqual(Buffer.from(saved), Buffer.from(csrf))
        )
          return reply.code(403).send({ error: 'invalid_origin_or_csrf' });
        let query;
        try {
          query = parseVenuePeopleQuery(request.body);
        } catch {
          return reply.code(400).send({ error: 'invalid_selector' });
        }
        try {
          const data = decodeVenuePeopleResult(
            await options.service.read(request.id, session, query, exporting),
            query,
            exporting
          );
          if (!exporting) return reply.send(data);
          return reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', 'attachment; filename="venue-people.csv"')
            .send(encodeVenuePeopleCsv(data));
        } catch (error) {
          if (error instanceof Error && 'code' in error) {
            if (error.code === '28000') return reply.code(401).send({ error: 'unauthenticated' });
            if (error.code === '42501') return reply.code(403).send({ error: 'forbidden' });
            if (error.code === '22023') return reply.code(400).send({ error: 'invalid_selector' });
            if (error.code === '54000')
              return reply.code(413).send({ error: 'export_too_large', maximumRows: 1000 });
          }
          // Never emit SQL diagnostics, search text, names, cookies or arbitrary exception messages.
          return reply.code(503).send({ error: 'venue_people_unavailable' });
        }
      }
    );
  }
};
