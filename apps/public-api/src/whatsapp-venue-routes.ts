/** Dedicated WhatsApp venue API adapter. Composition root must explicitly enable it
 * only after the reviewed SQL authority is installed. No production wiring in this batch.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { trustedVenueOrigin } from './venue-management.js';
import { createVenueEntryAvailability, venueEntryCodeSchema } from './venue-entry-guidance.js';
import { readWhatsAppVenueSession } from './whatsapp-venue-session.js';
import {
  whatsappVenueCheckinInputSchema,
  whatsappVenueHistoryInputSchema,
  whatsappVenueHistorySchema,
  whatsappVenueReceiptSchema
} from './whatsapp-venue-contract.js';

export const checkWhatsAppVenueReadiness = async (pool: Pool) => {
  try {
    const ready = await withRequestContext(
      pool,
      'qigong_api_runtime',
      { requestId: crypto.randomUUID() },
      async (c) => {
        const result = await c.query<{ ready: boolean }>(
          `WITH venue_functions(signature,owner_name,extra_grantee) AS (VALUES
        ('platform.whatsapp_venue_session_status(text,text)','qigong_whatsapp_venue_session_reader','qigong_whatsapp_venue_history_reader'),
        ('platform.whatsapp_venue_checkin(text,text,text,double precision,double precision)','qigong_whatsapp_venue_writer',NULL),
        ('platform.whatsapp_venue_history(text,text,text,text,integer)','qigong_whatsapp_venue_history_reader',NULL)
      ) SELECT
        (SELECT count(*)=3 AND bool_and(p.oid IS NOT NULL AND p.proowner=to_regrole(f.owner_name)
          AND p.prosecdef AND p.prokind='f' AND p.provolatile='v' AND p.prorettype='jsonb'::regtype
          AND p.proconfig=ARRAY['search_path=pg_catalog','row_security=on']
          AND has_function_privilege('qigong_api_runtime',p.oid,'EXECUTE')
          AND NOT has_function_privilege('qigong_worker_runtime',p.oid,'EXECUTE')
          AND (SELECT count(*) FROM aclexplode(p.proacl) a WHERE a.grantee<>p.proowner)=CASE WHEN f.extra_grantee IS NULL THEN 1 ELSE 2 END
          AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee<>p.proowner AND
            (a.is_grantable OR a.privilege_type<>'EXECUTE' OR a.grantee=0 OR
             NOT(a.grantee='qigong_api_runtime'::regrole OR (f.extra_grantee IS NOT NULL AND a.grantee=to_regrole(f.extra_grantee))))))
         FROM venue_functions f LEFT JOIN pg_proc p ON p.oid=to_regprocedure(f.signature))
        AND (SELECT count(*)=3 AND bool_and(NOT(r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
          AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid=r.oid OR m.member=r.oid)
          AND NOT EXISTS(SELECT 1 FROM pg_class t WHERE t.relowner=r.oid)
          AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE has_schema_privilege(r.oid,n.oid,'CREATE')))
          FROM pg_roles r WHERE rolname IN ('qigong_whatsapp_venue_session_reader','qigong_whatsapp_venue_writer','qigong_whatsapp_venue_history_reader'))
        AND (SELECT count(*)=cardinality($1::text[]) AND bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class
          WHERE oid IN (SELECT to_regclass(name) FROM unnest($1::text[]) name))
        AND (SELECT count(*)=6 AND bool_and(NOT polpermissive AND polcmd='w' AND pg_get_expr(polwithcheck,polrelid)='false')
          FROM pg_policy WHERE polname='wa_venue_never_update' AND polroles=ARRAY['qigong_whatsapp_venue_writer'::regrole]::oid[])
        AS ready`,
          [
            [
              'platform.whatsapp_browser_sessions',
              'identity.people',
              'identity.platform_identities',
              'identity.person_interaction_channels',
              'identity.onboarding_applications',
              'platform.learner_privacy_acceptances',
              'core.practice_fields',
              'core.field_attendance'
            ]
          ]
        );
        return result.rows[0]?.ready === true;
      }
    );
    return { feature: 'whatsappVenue' as const, ready };
  } catch {
    return { feature: 'whatsappVenue' as const, ready: false };
  }
};

const configSchema = z.strictObject({ enabled: z.literal(true), publicOrigin: z.string() });
const statusSchema = z.strictObject({
  version: z.literal(1),
  status: z.literal('approved'),
  privacy: z.literal('clear')
});
const databaseError = z.object({ code: z.string(), message: z.string().optional() });
const headers = (reply: FastifyReply) =>
  reply
    .header('cache-control', 'no-store')
    .header('referrer-policy', 'no-referrer')
    .header('x-content-type-options', 'nosniff');
const failure = (reply: FastifyReply, error: unknown, writing: boolean) => {
  const parsed = databaseError.safeParse(error);
  if (parsed.success) {
    if (parsed.data.code === '42501')
      return reply
        .code(parsed.data.message === 'WhatsApp venue session unavailable' ? 401 : 403)
        .send({ ok: false, error: 'venue_access_unavailable' });
    if (parsed.data.code === 'P0001' && parsed.data.message === 'venue_outside_window')
      return reply.code(409).send({ ok: false, error: 'outside_window' });
    if (parsed.data.code === 'P0001' && parsed.data.message === 'venue_outside_radius')
      return reply.code(403).send({ ok: false, error: 'outside_radius' });
  }
  // No raw SQL, credential, subject, coordinates or diagnostics in the response.
  // Transport/commit failure may be ambiguous: never report a confirmed failed save.
  return reply.code(503).send({
    ok: false,
    error: writing ? 'venue_result_unconfirmed' : 'venue_service_unavailable'
  });
};
export const registerWhatsAppVenueRoutes = (
  app: FastifyInstance,
  pool: Pool,
  config: { readonly enabled: true; readonly publicOrigin: string }
) => {
  const origin = trustedVenueOrigin(configSchema.parse(config).publicOrigin);
  const availability = createVenueEntryAvailability(pool);
  app.get(
    '/api/whatsapp/venue-availability',
    { logLevel: 'silent', config: { rateLimit: { max: 30, timeWindow: 60000 } } },
    async (request, reply) => {
      headers(reply).header('permissions-policy', 'geolocation=(), camera=(), microphone=()');
      const input = z.strictObject({ venue: venueEntryCodeSchema }).safeParse(request.query);
      if (!input.success) return reply.code(400).send({ error: 'invalid_venue_entry_request' });
      const result = await availability(request.id, input.data.venue);
      return reply.code(result.status).send(result.body);
    }
  );
  app.post(
    '/api/whatsapp/venue-entry-status',
    { bodyLimit: 1024, config: { rateLimit: { max: 20, timeWindow: 60000 } } },
    async (request, reply) => {
      headers(reply);
      const transport = readWhatsAppVenueSession(request, origin);
      if (!transport.ok)
        return reply.code(transport.status).send({ ok: false, error: transport.error });
      if (!z.strictObject({}).safeParse(request.body).success)
        return reply.code(400).send({ ok: false, error: 'invalid_input' });
      try {
        return await withRequestContext(
          pool,
          'qigong_api_runtime',
          { requestId: request.id },
          async (c) => {
            const result = await c.query<{ data: unknown }>(
              'SELECT platform.whatsapp_venue_session_status($1,$2) data',
              [transport.credential.session, transport.credential.csrf]
            );
            if (result.rows.length !== 1) throw Error('Invalid status result');
            return statusSchema.parse(result.rows[0]?.data);
          }
        );
      } catch (error) {
        return failure(reply, error, false);
      }
    }
  );
  app.post(
    '/api/whatsapp/venue-checkin',
    { bodyLimit: 4096, config: { rateLimit: { max: 10, timeWindow: 60000 } } },
    async (request, reply) => {
      headers(reply);
      const transport = readWhatsAppVenueSession(request, origin);
      if (!transport.ok)
        return reply.code(transport.status).send({ ok: false, error: transport.error });
      const input = whatsappVenueCheckinInputSchema.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ ok: false, error: 'invalid_input' });
      try {
        return await withRequestContext(
          pool,
          'qigong_api_runtime',
          { requestId: request.id },
          async (c) => {
            // SQL must validate Session, CSRF, identity, consent, locks and venue itself.
            // No call to the informational status facade can authorize this write.
            const result = await c.query<{ data: unknown }>(
              'SELECT platform.whatsapp_venue_checkin($1,$2,$3,$4,$5) data',
              [
                transport.credential.session,
                transport.credential.csrf,
                input.data.venue,
                input.data.latitude,
                input.data.longitude
              ]
            );
            if (result.rows.length !== 1) throw Error('Invalid check-in result');
            const receipt = whatsappVenueReceiptSchema.parse(result.rows[0]?.data);
            if (receipt.venue.code !== input.data.venue) throw Error('Venue result binding failed');
            // Validate before commit so malformed/test/wrong-venue results roll back.
            return receipt;
          }
        );
      } catch (error) {
        return failure(reply, error, true);
      }
    }
  );
  app.post(
    '/api/whatsapp/venue-history',
    { bodyLimit: 4096, config: { rateLimit: { max: 20, timeWindow: 60000 } } },
    async (request, reply) => {
      headers(reply);
      const transport = readWhatsAppVenueSession(request, origin);
      if (!transport.ok)
        return reply.code(transport.status).send({ ok: false, error: transport.error });
      const input = whatsappVenueHistoryInputSchema.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ ok: false, error: 'invalid_input' });
      try {
        return await withRequestContext(
          pool,
          'qigong_api_runtime',
          { requestId: request.id },
          async (c) => {
            const result = await c.query<{ data: unknown }>(
              'SELECT platform.whatsapp_venue_history($1,$2,$3,$4,$5) data',
              [
                transport.credential.session,
                transport.credential.csrf,
                input.data.month ?? null,
                input.data.venue ?? null,
                input.data.page
              ]
            );
            if (result.rows.length !== 1) throw Error('Invalid history result');
            const history = whatsappVenueHistorySchema.parse(result.rows[0]?.data);
            if (
              history.page !== input.data.page ||
              history.totals.attendanceCount < history.entries.length ||
              (history.hasMore && history.entries.length !== 20)
            )
              throw Error('History pagination binding failed');
            for (let index = 0; index < history.entries.length; index++) {
              const entry = history.entries[index]!;
              if (
                (input.data.venue !== undefined && entry.venueCode !== input.data.venue) ||
                (input.data.month !== undefined &&
                  !entry.venueLocalDate.startsWith(input.data.month + '-'))
              )
                throw Error('History filter binding failed');
              const previous = history.entries[index - 1];
              if (
                previous &&
                (Date.parse(previous.checkedInAt) < Date.parse(entry.checkedInAt) ||
                  (previous.checkedInAt === entry.checkedInAt && previous.id < entry.id))
              )
                throw Error('History ordering binding failed');
            }
            return history;
          }
        );
      } catch (error) {
        return failure(reply, error, false);
      }
    }
  );
};
