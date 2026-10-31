/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved. */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { adminContentSecurityPolicy } from './admin-branding.js';
import { resolveAdminLocale } from './admin-locale.js';
import { renderVenueWeekendPage } from './admin-venue-weekend-page.js';
import { renderVenueLearnerPage } from './admin-venue-learner-page.js';
import { formatAttendeeCsv, type VenueReportingService } from './venue-reporting-service.js';
import { venueQrRouteErrorHandler } from './venue-qr.js';

export interface VenueReportingConfig {
  readonly enabled: true;
  readonly publicOrigin: string;
}

export interface VenueReportingRouteOptions {
  readonly config: VenueReportingConfig;
  readonly service: VenueReportingService;
  readonly pagePrincipalFor: (request: FastifyRequest) => Promise<string | null>;
}

export const validateVenueReportingConfig = (
  config: VenueReportingConfig
): VenueReportingConfig => {
  const origin = new URL(config.publicOrigin);
  if (
    config.enabled !== true ||
    origin.protocol !== 'https:' ||
    origin.origin !== config.publicOrigin
  )
    throw new Error('venue reporting requires explicit HTTPS origin');
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

const verifyAdminRequest = (
  request: FastifyRequest,
  publicOrigin: string
): { session: string } | { errorStatus: number; error: string } => {
  const session = cookieToken(request, '__Host-qigong-admin');
  if (!session) return { errorStatus: 401, error: 'unauthenticated' };

  const saved = cookieToken(request, '__Host-qigong-admin-csrf');
  const csrf = request.headers['x-csrf-token'];
  if (
    request.headers.origin !== publicOrigin ||
    (request.headers['sec-fetch-site'] !== undefined &&
      request.headers['sec-fetch-site'] !== 'same-origin') ||
    request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json' ||
    !saved ||
    typeof csrf !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(csrf) ||
    !timingSafeEqual(Buffer.from(saved), Buffer.from(csrf))
  ) {
    return { errorStatus: 403, error: 'invalid_origin_or_csrf' };
  }

  return { session };
};

export const registerVenueReportingRoutes = (
  app: FastifyInstance,
  options: VenueReportingRouteOptions
): void => {
  const config = validateVenueReportingConfig(options.config);

  // GET: Weekend Attendance Page
  app.get(
    '/admin/venue-weekend-attendance',
    { errorHandler: venueQrRouteErrorHandler },
    async (request, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff');
      if (!cookieToken(request, '__Host-qigong-admin'))
        return reply.code(401).send({ error: 'unauthenticated' });
      try {
        if (!(await options.pagePrincipalFor(request)))
          return reply.code(401).send({ error: 'unauthenticated' });
        const locale = resolveAdminLocale(request);
        return reply
          .header('content-security-policy', adminContentSecurityPolicy)
          .type('text/html; charset=utf-8')
          .send(renderVenueWeekendPage(locale, false));
      } catch {
        return reply.code(503).send({ error: 'venue_reporting_unavailable' });
      }
    }
  );

  // GET: Learner Attendance Page
  app.get(
    '/admin/venue-learner-attendance',
    { errorHandler: venueQrRouteErrorHandler },
    async (request, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff');
      if (!cookieToken(request, '__Host-qigong-admin'))
        return reply.code(401).send({ error: 'unauthenticated' });
      try {
        if (!(await options.pagePrincipalFor(request)))
          return reply.code(401).send({ error: 'unauthenticated' });
        const locale = resolveAdminLocale(request);
        return reply
          .header('content-security-policy', adminContentSecurityPolicy)
          .type('text/html; charset=utf-8')
          .send(renderVenueLearnerPage(locale, false));
      } catch {
        return reply.code(503).send({ error: 'venue_reporting_unavailable' });
      }
    }
  );

  // 1. Weekend Attendance Summary API
  app.post(
    '/admin/api/venue-reporting/weekend-summary',
    { bodyLimit: 4096, errorHandler: venueQrRouteErrorHandler },
    async (request, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff');

      const auth = verifyAdminRequest(request, config.publicOrigin);
      if ('errorStatus' in auth) {
        return reply.code(auth.errorStatus).send({ error: auth.error });
      }

      const body = request.body as Record<string, unknown> | null;
      const regionId = typeof body?.regionId === 'string' ? body.regionId.trim() : '';
      const dateFrom = typeof body?.dateFrom === 'string' ? body.dateFrom.trim() : '';
      const dateUntil = typeof body?.dateUntil === 'string' ? body.dateUntil.trim() : '';
      const fieldId =
        typeof body?.fieldId === 'string' && body.fieldId.trim() ? body.fieldId.trim() : null;

      if (!regionId || !dateFrom || !dateUntil) {
        return reply.code(400).send({ error: 'invalid_parameters' });
      }

      try {
        const result = await options.service.getWeekendAttendanceSummary(
          request.id,
          auth.session,
          regionId,
          dateFrom,
          dateUntil,
          fieldId,
          false
        );
        return reply.code(200).send(result);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === '28000') return reply.code(401).send({ error: 'unauthenticated' });
        if (code === '42501') return reply.code(403).send({ error: 'forbidden' });
        if (code === '22023') return reply.code(400).send({ error: 'invalid_parameters' });
        return reply.code(503).send({ error: 'reporting_unavailable' });
      }
    }
  );

  // 2. Weekend Attendance Export CSV API
  app.post(
    '/admin/api/venue-reporting/weekend-export',
    { bodyLimit: 4096, errorHandler: venueQrRouteErrorHandler },
    async (request, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff');

      const auth = verifyAdminRequest(request, config.publicOrigin);
      if ('errorStatus' in auth) {
        return reply.code(auth.errorStatus).send({ error: auth.error });
      }

      const body = request.body as Record<string, unknown> | null;
      const regionId = typeof body?.regionId === 'string' ? body.regionId.trim() : '';
      const dateFrom = typeof body?.dateFrom === 'string' ? body.dateFrom.trim() : '';
      const dateUntil = typeof body?.dateUntil === 'string' ? body.dateUntil.trim() : '';
      const fieldId =
        typeof body?.fieldId === 'string' && body.fieldId.trim() ? body.fieldId.trim() : null;

      if (!regionId || !dateFrom || !dateUntil) {
        return reply.code(400).send({ error: 'invalid_parameters' });
      }

      try {
        const result = await options.service.getWeekendAttendanceExport(
          request.id,
          auth.session,
          regionId,
          dateFrom,
          dateUntil,
          fieldId
        );
        const csvContent = formatAttendeeCsv(result.rows);
        const filename = `venue-attendance-${dateFrom}-${dateUntil}.csv`;

        return reply
          .code(200)
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(csvContent);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === '28000') return reply.code(401).send({ error: 'unauthenticated' });
        if (code === '42501') return reply.code(403).send({ error: 'forbidden' });
        if (code === '54000') return reply.code(413).send({ error: 'export_too_large' });
        if (code === '22023') return reply.code(400).send({ error: 'invalid_parameters' });
        return reply.code(503).send({ error: 'export_unavailable' });
      }
    }
  );

  // 3. Learner Search API
  app.post(
    '/admin/api/venue-reporting/learner-search',
    { bodyLimit: 4096, errorHandler: venueQrRouteErrorHandler },
    async (request, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff');

      const auth = verifyAdminRequest(request, config.publicOrigin);
      if ('errorStatus' in auth) {
        return reply.code(auth.errorStatus).send({ error: auth.error });
      }

      const body = request.body as Record<string, unknown> | null;
      const regionId = typeof body?.regionId === 'string' ? body.regionId.trim() : '';
      const search = typeof body?.search === 'string' ? body.search.trim() : '';
      const page = typeof body?.page === 'number' && body.page >= 1 ? Math.floor(body.page) : 1;
      const limit =
        typeof body?.limit === 'number' && body.limit >= 1 && body.limit <= 100
          ? Math.floor(body.limit)
          : 20;

      if (!regionId) {
        return reply.code(400).send({ error: 'region_required' });
      }

      try {
        const result = await options.service.searchLearners(
          request.id,
          auth.session,
          regionId,
          search,
          page,
          limit
        );
        return reply.code(200).send(result);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === '28000') return reply.code(401).send({ error: 'unauthenticated' });
        if (code === '42501') return reply.code(403).send({ error: 'forbidden' });
        if (code === '22023') return reply.code(400).send({ error: 'invalid_parameters' });
        return reply.code(503).send({ error: 'reporting_unavailable' });
      }
    }
  );

  // 4. Learner Detail History API
  app.post(
    '/admin/api/venue-reporting/learner-history',
    { bodyLimit: 4096, errorHandler: venueQrRouteErrorHandler },
    async (request, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff');

      const auth = verifyAdminRequest(request, config.publicOrigin);
      if ('errorStatus' in auth) {
        return reply.code(auth.errorStatus).send({ error: auth.error });
      }

      const body = request.body as Record<string, unknown> | null;
      const regionId = typeof body?.regionId === 'string' ? body.regionId.trim() : '';
      const personId = typeof body?.personId === 'string' ? body.personId.trim() : '';
      const page = typeof body?.page === 'number' && body.page >= 1 ? Math.floor(body.page) : 1;
      const limit =
        typeof body?.limit === 'number' && body.limit >= 1 && body.limit <= 100
          ? Math.floor(body.limit)
          : 20;

      if (!regionId || !personId) {
        return reply.code(400).send({ error: 'person_and_region_required' });
      }

      try {
        const result = await options.service.getLearnerHistory(
          request.id,
          auth.session,
          regionId,
          personId,
          page,
          limit
        );
        return reply.code(200).send(result);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === '28000') return reply.code(401).send({ error: 'unauthenticated' });
        if (code === '42501') return reply.code(403).send({ error: 'forbidden' });
        if (code === 'P0002') return reply.code(404).send({ error: 'learner_not_found' });
        if (code === '22023') return reply.code(400).send({ error: 'invalid_parameters' });
        return reply.code(503).send({ error: 'reporting_unavailable' });
      }
    }
  );
};
