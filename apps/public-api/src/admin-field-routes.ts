/**
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { adminContentSecurityPolicy } from './admin-branding.js';
import { resolveAdminLocale } from './admin-locale.js';
import { renderAdminShell } from './admin-dashboard.js';

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

export interface FieldUrlOptions {
  readonly baseUrl?: string | undefined;
  readonly liffId?: string | undefined;
  readonly qrCodeSize?: number | undefined;
}

export const generateFieldNfcUrl = (
  fieldCode: string,
  options: FieldUrlOptions = {}
): string => {
  const code = encodeURIComponent(fieldCode.trim());
  if (options.liffId) {
    return `https://liff.line.me/${encodeURIComponent(options.liffId)}?field=${code}`;
  }
  const base = (options.baseUrl ?? 'https://checkin.baiyinqigong.org').replace(/\/+$/, '');
  return `${base}/checkin?field=${code}`;
};

export const generateFieldQrCodeUrl = (
  fieldCode: string,
  options: FieldUrlOptions = {}
): string => {
  const targetUrl = generateFieldNfcUrl(fieldCode, options);
  const size = options.qrCodeSize ?? 300;
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(targetUrl)}`;
};

export interface FieldUrls {
  readonly nfc_url: string;
  readonly qrcode_url: string;
  readonly target_url: string;
}

export const buildFieldUrls = (
  fieldCode: string,
  options: FieldUrlOptions = {}
): FieldUrls => {
  const nfcUrl = generateFieldNfcUrl(fieldCode, options);
  const qrcodeUrl = generateFieldQrCodeUrl(fieldCode, options);
  return Object.freeze({
    nfc_url: nfcUrl,
    qrcode_url: qrcodeUrl,
    target_url: nfcUrl
  });
};

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
  pool: Pool,
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

  const canManageFields = async (principalId: string, requestId: string): Promise<boolean> =>
    withRequestContext(
      pool,
      'qigong_api_runtime',
      { principalId, requestId },
      async (client) => {
        const result = await client.query<{ allowed: boolean }>(
          "SELECT (admin.can_manage_admin_access() OR admin.has_permission('field.manage') OR admin.has_permission('checkin.read')) AS allowed"
        );
        return result.rows[0]?.allowed === true;
      }
    ).catch(() => true);

  app.get('/admin/api/fields/capabilities', async (request, reply) => {
    headers(reply);
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });
    const canManage = await canManageFields(principalId, request.id);
    return { canManage };
  });

  app.get('/admin/api/fields', async (request, reply) => {
    headers(reply);
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });

    const querySchema = z.object({
      region_id: z.string().uuid().optional(),
      is_active: z
        .string()
        .optional()
        .transform((v) => (v === undefined ? undefined : v === 'true'))
    });
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });

    try {
      const rows = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { principalId, requestId: request.id },
        async (client) => {
          const conditions: string[] = [];
          const params: unknown[] = [];

          if (parsed.data.region_id) {
            params.push(parsed.data.region_id);
            conditions.push(`pf.region_id = $${params.length}`);
          }
          if (parsed.data.is_active !== undefined) {
            params.push(parsed.data.is_active);
            conditions.push(`pf.is_active = $${params.length}`);
          }

          const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
          const sql = `
            SELECT
              pf.id,
              pf.region_id,
              r.name_zh_tw AS region_name,
              pf.code,
              pf.name_zh_tw,
              pf.name_en,
              pf.latitude::float AS latitude,
              pf.longitude::float AS longitude,
              pf.radius_meters,
              pf.active_time_rules,
              pf.is_active,
              pf.created_at,
              pf.updated_at
            FROM core.practice_fields pf
            LEFT JOIN core.regions r ON r.id = pf.region_id
            ${whereClause}
            ORDER BY pf.code ASC
          `;
          const result = await client.query<PracticeFieldRow>(sql, params);
          return result.rows;
        }
      );

      const fields = rows.map((row) => ({
        ...row,
        nfc_url: generateFieldNfcUrl(row.code, { liffId }),
        qrcode_url: generateFieldQrCodeUrl(row.code, { liffId })
      }));

      return { fields };
    } catch (err) {
      request.log.error({ err }, 'failed to list practice fields');
      return reply.code(500).send({ error: 'failed_to_list_fields' });
    }
  });

  app.get('/admin/api/fields/:id', async (request, reply) => {
    headers(reply);
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });

    const paramsSchema = z.object({ id: z.string().uuid() });
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_field_id' });

    try {
      const field = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { principalId, requestId: request.id },
        async (client) => {
          const sql = `
            SELECT
              pf.id,
              pf.region_id,
              r.name_zh_tw AS region_name,
              pf.code,
              pf.name_zh_tw,
              pf.name_en,
              pf.latitude::float AS latitude,
              pf.longitude::float AS longitude,
              pf.radius_meters,
              pf.active_time_rules,
              pf.is_active,
              pf.created_at,
              pf.updated_at
            FROM core.practice_fields pf
            LEFT JOIN core.regions r ON r.id = pf.region_id
            WHERE pf.id = $1
          `;
          const result = await client.query<PracticeFieldRow>(sql, [parsed.data.id]);
          return result.rows[0] ?? null;
        }
      );

      if (!field) return reply.code(404).send({ error: 'field_not_found' });

      return {
        field: {
          ...field,
          nfc_url: generateFieldNfcUrl(field.code, { liffId }),
          qrcode_url: generateFieldQrCodeUrl(field.code, { liffId })
        }
      };
    } catch (err) {
      request.log.error({ err }, 'failed to get practice field');
      return reply.code(500).send({ error: 'failed_to_get_field' });
    }
  });

  app.post('/admin/api/fields', async (request, reply) => {
    headers(reply);
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });
    if (!validCsrf(request)) return reply.code(403).send({ error: 'invalid_csrf' });

    const parsed = createFieldInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_field_data', details: parsed.error.issues });
    }

    const {
      region_id,
      code,
      name_zh_tw,
      name_en,
      latitude,
      longitude,
      radius_meters,
      active_time_rules,
      is_active
    } = parsed.data;

    try {
      const inserted = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { principalId, requestId: request.id },
        async (client) => {
          const sql = `
            INSERT INTO core.practice_fields (
              region_id,
              code,
              name_zh_tw,
              name_en,
              latitude,
              longitude,
              radius_meters,
              active_time_rules,
              is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
            RETURNING
              id,
              region_id,
              code,
              name_zh_tw,
              name_en,
              latitude::float AS latitude,
              longitude::float AS longitude,
              radius_meters,
              active_time_rules,
              is_active,
              created_at,
              updated_at
          `;
          const result = await client.query<PracticeFieldRow>(sql, [
            region_id,
            code,
            name_zh_tw,
            name_en ?? null,
            latitude,
            longitude,
            radius_meters,
            JSON.stringify(active_time_rules),
            is_active
          ]);
          return result.rows[0];
        }
      );

      if (!inserted) {
        return reply.code(500).send({ error: 'failed_to_create_field' });
      }

      return reply.code(201).send({
        ok: true,
        field: {
          ...inserted,
          nfc_url: generateFieldNfcUrl(inserted.code, { liffId }),
          qrcode_url: generateFieldQrCodeUrl(inserted.code, { liffId })
        }
      });
    } catch (err: unknown) {
      const isDuplicate =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505';
      if (isDuplicate) {
        return reply.code(409).send({ error: 'field_code_conflict' });
      }
      request.log.error({ err }, 'failed to create practice field');
      return reply.code(500).send({ error: 'failed_to_create_field' });
    }
  });

  const handleUpdate = async (request: FastifyRequest, reply: FastifyReply) => {
    headers(reply);
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });
    if (!validCsrf(request)) return reply.code(403).send({ error: 'invalid_csrf' });

    const paramsSchema = z.object({ id: z.string().uuid() });
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) return reply.code(400).send({ error: 'invalid_field_id' });

    const parsedBody = updateFieldInputSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: 'invalid_field_data', details: parsedBody.error.issues });
    }

    const updates = parsedBody.data;
    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'no_updates_provided' });
    }

    try {
      const updated = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { principalId, requestId: request.id },
        async (client) => {
          const sets: string[] = ['updated_at = clock_timestamp()'];
          const params: unknown[] = [parsedParams.data.id];

          if (updates.region_id !== undefined) {
            params.push(updates.region_id);
            sets.push(`region_id = $${params.length}`);
          }
          if (updates.code !== undefined) {
            params.push(updates.code);
            sets.push(`code = $${params.length}`);
          }
          if (updates.name_zh_tw !== undefined) {
            params.push(updates.name_zh_tw);
            sets.push(`name_zh_tw = $${params.length}`);
          }
          if (updates.name_en !== undefined) {
            params.push(updates.name_en);
            sets.push(`name_en = $${params.length}`);
          }
          if (updates.latitude !== undefined) {
            params.push(updates.latitude);
            sets.push(`latitude = $${params.length}`);
          }
          if (updates.longitude !== undefined) {
            params.push(updates.longitude);
            sets.push(`longitude = $${params.length}`);
          }
          if (updates.radius_meters !== undefined) {
            params.push(updates.radius_meters);
            sets.push(`radius_meters = $${params.length}`);
          }
          if (updates.active_time_rules !== undefined) {
            params.push(JSON.stringify(updates.active_time_rules));
            sets.push(`active_time_rules = $${params.length}::jsonb`);
          }
          if (updates.is_active !== undefined) {
            params.push(updates.is_active);
            sets.push(`is_active = $${params.length}`);
          }

          const sql = `
            UPDATE core.practice_fields
            SET ${sets.join(', ')}
            WHERE id = $1
            RETURNING
              id,
              region_id,
              code,
              name_zh_tw,
              name_en,
              latitude::float AS latitude,
              longitude::float AS longitude,
              radius_meters,
              active_time_rules,
              is_active,
              created_at,
              updated_at
          `;
          const result = await client.query<PracticeFieldRow>(sql, params);
          return result.rows[0] ?? null;
        }
      );

      if (!updated) return reply.code(404).send({ error: 'field_not_found' });

      return {
        ok: true,
        field: {
          ...updated,
          nfc_url: generateFieldNfcUrl(updated.code, { liffId }),
          qrcode_url: generateFieldQrCodeUrl(updated.code, { liffId })
        }
      };
    } catch (err: unknown) {
      const isDuplicate =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505';
      if (isDuplicate) {
        return reply.code(409).send({ error: 'field_code_conflict' });
      }
      request.log.error({ err }, 'failed to update practice field');
      return reply.code(500).send({ error: 'failed_to_update_field' });
    }
  };

  app.put('/admin/api/fields/:id', handleUpdate);
  app.patch('/admin/api/fields/:id', handleUpdate);

  app.get('/admin/fields', async (request, reply) => {
    const locale = resolveAdminLocale(request.query, request.headers.cookie);
    const principalId = await principalFor(request);
    if (!principalId) {
      return reply.header('cache-control', 'no-store').redirect('/admin/auth/login');
    }
    const html = renderAdminShell(
      'fieldSchedule',
      `<div class="card"><div class="brand-title"><h2>團練場地排班與管理</h2></div><p class="muted">管理各區週末團練場地資訊、GPS 座標、打卡半徑與開閉時段，並提供 NFC 燒錄及 QR Code 下載連結。</p><div id="fields-app"></div></div>`,
      `// Field Schedule Manager loaded`,
      locale,
      false,
      true
    );
    return reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', adminContentSecurityPolicy)
      .type('text/html; charset=utf-8')
      .send(html);
  });
};
