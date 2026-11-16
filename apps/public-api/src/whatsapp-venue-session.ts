/** Session-only HTTP boundary for the planned WhatsApp venue adapter.
 * Does not authorize a person or prove a save. SQL must revalidate in its write transaction.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { whatsappCsrfCookie, whatsappSessionCookie } from './whatsapp-browser-session.js';
import { trustedVenueOrigin } from './venue-management.js';

const opaque = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]{43}$/);
const jsonBody = z.record(z.string(), z.unknown());
const forbiddenBodyKeys = [
  'token',
  'session',
  'csrf',
  'idToken',
  'subject',
  'personId',
  'identityId',
  'platform',
  'channel'
];
export interface WhatsAppVenueSession {
  readonly session: string;
  readonly csrf: string;
}
export type WhatsAppVenueSessionResult =
  | { readonly ok: true; readonly credential: WhatsAppVenueSession }
  | {
      readonly ok: false;
      readonly status: 400 | 401 | 403 | 405 | 415;
      readonly error:
        | 'invalid_request'
        | 'venue_session_required'
        | 'invalid_csrf'
        | 'invalid_origin'
        | 'method_not_allowed'
        | 'json_required';
    };
const cookie = (request: FastifyRequest, name: string): string | null => {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return null;
  const matches = header
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(name + '='));
  if (matches.length !== 1) return null;
  const value = opaque.safeParse(matches[0]!.slice(name.length + 1));
  return value.success ? value.data : null;
};

/** Unlike the existing daily-practice resolver, this NEVER falls back to a body token.
 * publicOrigin is fixed server configuration, not Host/forwarded headers or request JSON.
 * Returned secrets remain server-side and must never be logged or included in HTTP JSON.
 * An ok result validates transport only: Session expiry, identity, eligibility and consent
 * must still be checked authoritatively by the dedicated SQL facade in the same transaction. */
export const readWhatsAppVenueSession = (
  request: FastifyRequest,
  publicOrigin: string
): WhatsAppVenueSessionResult => {
  const origin = trustedVenueOrigin(publicOrigin);
  if (request.method !== 'POST') return { ok: false, status: 405, error: 'method_not_allowed' };
  if (request.headers.origin !== origin || request.headers['sec-fetch-site'] === 'cross-site')
    return { ok: false, status: 403, error: 'invalid_origin' };
  const contentType = request.headers['content-type'];
  if (
    typeof contentType !== 'string' ||
    contentType.split(';', 1)[0]!.trim().toLowerCase() !== 'application/json'
  )
    return { ok: false, status: 415, error: 'json_required' };
  const body = jsonBody.safeParse(request.body);
  if (!body.success || forbiddenBodyKeys.some((key) => Object.hasOwn(body.data, key)))
    return { ok: false, status: 400, error: 'invalid_request' };
  const session = cookie(request, whatsappSessionCookie);
  if (!session) return { ok: false, status: 401, error: 'venue_session_required' };
  const csrf = cookie(request, whatsappCsrfCookie);
  const header = request.headers['x-whatsapp-csrf-token'];
  if (
    !csrf ||
    typeof header !== 'string' ||
    !opaque.safeParse(header).success ||
    !timingSafeEqual(Buffer.from(csrf), Buffer.from(header))
  )
    return { ok: false, status: 403, error: 'invalid_csrf' };
  return { ok: true, credential: { session, csrf } };
};
