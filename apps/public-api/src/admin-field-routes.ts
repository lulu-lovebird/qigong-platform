/**
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from '@qigong/database';
import { z } from 'zod';
import { adminContentSecurityPolicy } from './admin-branding.js';
import { resolveAdminLocale } from './admin-locale.js';
import { renderVenueFieldsPage, venueEntryUrl } from './admin-venue-fields-page.js';

export interface ActiveTimeRules {
  readonly day_of_week: readonly number[];
  readonly start_time: string;
  readonly end_time: string;
}

export const activeTimeRulesSchema = z
  .object({
    day_of_week: z
      .array(z.number().int().min(0).max(6))
      .min(1, 'At least one day of week is required'),
    start_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'start_time must be in HH:mm 24-hour format'),
    end_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'end_time must be in HH:mm 24-hour format')
  })
  .refine(
    (data) => {
      const [sh, sm] = data.start_time.split(':').map((v) => Number.parseInt(v, 10));
      const [eh, em] = data.end_time.split(':').map((v) => Number.parseInt(v, 10));
      return (eh ?? 0) * 60 + (em ?? 0) > (sh ?? 0) * 60 + (sm ?? 0);
    },
    { message: 'end_time must be strictly after start_time' }
  );

export const defaultActiveTimeRules: {
  day_of_week: number[];
  start_time: string;
  end_time: string;
} = {
  day_of_week: [0, 6],
  start_time: '06:30',
  end_time: '09:00'
};

export const createFieldInputSchema = z.object({
  region_id: z.string().uuid(),
  code: z
    .string()
    .trim()
    .min(2, 'code must be at least 2 characters')
    .max(50, 'code must be at most 50 characters')
    .regex(/^[A-Za-z0-9_-]+$/, 'code may only contain letters, numbers, hyphens, and underscores'),
  name_zh_tw: z.string().trim().min(1, 'Traditional Chinese name is required').max(100),
  name_en: z.string().trim().max(100).nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_meters: z.number().int().min(5).max(5000).default(50),
  active_time_rules: activeTimeRulesSchema.default(defaultActiveTimeRules),
  is_active: z.boolean().default(true)
});

export type CreateFieldInput = z.infer<typeof createFieldInputSchema>;

export const updateFieldInputSchema = createFieldInputSchema.partial();
export type UpdateFieldInput = z.infer<typeof updateFieldInputSchema>;

// Retain exported helper names for callers, but never return a remote QR image.
// baseUrl/qrCodeSize are legacy options; neither can redirect venue data to a third party.
export interface FieldUrlOptions {
  readonly baseUrl?: string | undefined;
  readonly liffId?: string | undefined;
  readonly qrCodeSize?: number | undefined;
}
export const generateFieldNfcUrl = (code: string, options: FieldUrlOptions = {}) =>
  venueEntryUrl(code.trim(), 'nfc', options.liffId);
/** QR target URL only; no image has been generated. */
export const generateFieldQrCodeUrl = (code: string, options: FieldUrlOptions = {}) =>
  venueEntryUrl(code.trim(), 'qr', options.liffId);
export interface FieldUrls {
  readonly nfc_url: string;
  /** Legacy key: now a copyable target URL, NOT an image URL. */
  readonly qrcode_url: string;
  readonly target_url: string;
}
export const buildFieldUrls = (code: string, options: FieldUrlOptions = {}): FieldUrls =>
  Object.freeze({
    nfc_url: generateFieldNfcUrl(code, options),
    qrcode_url: generateFieldQrCodeUrl(code, options),
    target_url: venueEntryUrl(code.trim(), 'link', options.liffId)
  });

export interface PracticeFieldRow {
  readonly id: string;
  readonly region_id: string;
  readonly region_name?: string | null;
  readonly code: string;
  readonly name_zh_tw: string;
  readonly name_en: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly radius_meters: number;
  readonly active_time_rules: ActiveTimeRules;
  readonly is_active: boolean;
  readonly created_at: string;
  readonly updated_at: string;
  readonly nfc_url?: string;
  readonly qrcode_url?: string;
}

export const registerAdminFieldRoutes = (
  app: FastifyInstance,
  _pool: Pool,
  principalFor: (request: FastifyRequest) => Promise<string | null>,
  validCsrf: (request: FastifyRequest) => boolean,
  liffId?: string
) => {
  const headers = (reply: FastifyReply) =>
    reply
      .header('cache-control', 'no-store')
      .header('pragma', 'no-cache')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff');
  // No permission probe, table access or privileged fallback: field.manage is not an
  // implemented scoped DB contract. checkin.read/admin-access management are NOT substitutes.
  const principal = (request: FastifyRequest) => principalFor(request).catch(() => null);
  app.get('/admin/api/fields/capabilities', async (request, reply) => {
    headers(reply);
    if (!(await principal(request))) return reply.code(401).send({ error: 'unauthenticated' });
    return { canManage: false, reason: 'field_authorization_unavailable' };
  });
  const unavailable = async (request: FastifyRequest, reply: FastifyReply) => {
    headers(reply);
    if (!(await principal(request))) return reply.code(401).send({ error: 'unauthenticated' });
    if (request.method !== 'GET' && !validCsrf(request))
      return reply.code(403).send({ error: 'invalid_csrf' });
    return reply.code(503).send({ error: 'field_authorization_unavailable' });
  };
  app.get('/admin/api/fields', unavailable);
  app.get('/admin/api/fields/:id', unavailable);
  app.post('/admin/api/fields', unavailable);
  app.put('/admin/api/fields/:id', unavailable);
  app.patch('/admin/api/fields/:id', unavailable);
  app.get('/admin/fields', async (request, reply) => {
    headers(reply);
    if (!(await principal(request))) return reply.redirect('/admin/auth/login');
    const locale = resolveAdminLocale(request.query, request.headers.cookie);
    return reply
      .header('content-security-policy', adminContentSecurityPolicy)
      .type('text/html; charset=utf-8')
      .send(renderVenueFieldsPage(locale, liffId));
  });
};
