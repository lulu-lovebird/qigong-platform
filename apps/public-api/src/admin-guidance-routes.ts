/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { adminContentSecurityPolicy } from './admin-branding.js';
import { resolveAdminLocale } from './admin-locale.js';
import { renderAdminGuidancePage } from './admin-guidance-page.js';
import { withRequestContext, type Pool } from '@qigong/database';
import { venueQrRouteErrorHandler } from './venue-qr.js';

export interface GuidanceRouteOptions {
  readonly pool: Pool;
  readonly adminOrigin: string;
  readonly sessionFor: (request: FastifyRequest) => string | null;
  readonly validCsrf: (request: FastifyRequest) => boolean;
  readonly principalFor: (request: FastifyRequest) => Promise<string | null>;
}

export const registerAdminGuidanceRoutes = (
  app: FastifyInstance,
  options: GuidanceRouteOptions
): void => {
  // 1. Guidance Admin Page
  app.get(
    '/admin/practice-guidance',
    { errorHandler: venueQrRouteErrorHandler },
    async (request, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff');

      const session = options.sessionFor(request);
      if (!session) return reply.code(401).send({ error: 'unauthenticated' });

      try {
        const principal = await options.principalFor(request);
        if (!principal) return reply.code(401).send({ error: 'unauthenticated' });

        const locale = resolveAdminLocale(request);
        return reply
          .header('content-security-policy', adminContentSecurityPolicy)
          .type('text/html; charset=utf-8')
          .send(renderAdminGuidancePage(locale, false));
      } catch {
        return reply.code(503).send({ error: 'guidance_page_unavailable' });
      }
    }
  );

  // 2. Guidance Action API
  app.post(
    '/admin/api/practice-guidance/:action',
    { bodyLimit: 65536, errorHandler: venueQrRouteErrorHandler },
    async (request, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff');

      const session = options.sessionFor(request);
      if (!session) return reply.code(401).send({ error: 'unauthenticated' });

      if (!options.validCsrf(request)) {
        return reply.code(403).send({ error: 'invalid_csrf_or_origin' });
      }

      const params = request.params as { action?: string };
      const action = params?.action;
      if (!['list', 'get', 'create', 'update', 'upsert_entries', 'delete'].includes(action ?? '')) {
        return reply.code(400).send({ error: 'invalid_action' });
      }

      try {
        return await withRequestContext(
          options.pool,
          'qigong_api_runtime',
          { requestId: request.id },
          async (client) => {
            const res = await client.query<{ data: unknown }>(
              'SELECT admin.manage_guidance_campaign($1, $2, $3::jsonb) AS data',
              [action, session, JSON.stringify(request.body ?? {})]
            );
            return res.rows[0]?.data;
          }
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'unauthorized') return reply.code(403).send({ error: 'unauthorized' });
        if (msg === 'unauthenticated') return reply.code(401).send({ error: 'unauthenticated' });
        if (msg === 'campaign_not_found')
          return reply.code(404).send({ error: 'campaign_not_found' });
        if (msg.includes('invalid_')) return reply.code(400).send({ error: msg });
        return reply.code(503).send({ error: 'guidance_service_unavailable' });
      }
    }
  );
};
