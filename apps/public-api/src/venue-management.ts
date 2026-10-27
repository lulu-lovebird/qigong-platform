/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) =>
      [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    );
export const venueManagementFieldSchema = z
  .object({
    region_id: z.uuid(),
    code: z
      .string()
      .max(64)
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/),
    name_zh_tw: text(120).min(1),
    name_en: text(120).nullable(),
    address: text(500),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    radius_meters: z.number().int().min(1).max(5000),
    timezone: text(100).min(1),
    active_time_rules: z
      .object({
        day_of_week: z
          .array(z.number().int().min(0).max(6))
          .min(1)
          .max(7)
          .refine((v) => new Set(v).size === v.length),
        start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        end_time: z.string().regex(/^(?:([01]\d|2[0-3]):[0-5]\d|24:00)$/)
      })
      .strict()
      .refine((v) => v.start_time < v.end_time),
    is_active: z.boolean()
  })
  .strict();
export type VenueManagementField = z.infer<typeof venueManagementFieldSchema>;
export const venueManagementRowSchema = venueManagementFieldSchema.extend({
  id: z.uuid(),
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string()
});
export type VenueManagementRow = z.infer<typeof venueManagementRowSchema>;
const selector = { regionId: z.uuid() };
export const venueManagementOperationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['list', 'capabilities']), ...selector }).strict(),
  z.object({ action: z.literal('get'), ...selector, id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('create'),
      ...selector,
      field: venueManagementFieldSchema,
      reason: text(500).min(1)
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      ...selector,
      id: z.uuid(),
      version: z.number().int().positive(),
      field: venueManagementFieldSchema,
      reason: text(500).min(1)
    })
    .strict()
]);
export type VenueManagementOperation = z.infer<typeof venueManagementOperationSchema>;
export type VenueManagementResult =
  | { fields: VenueManagementRow[] }
  | { field: VenueManagementRow }
  | { canRead: true; canManage: boolean };

/** Server configuration only, never Host / forwarded headers / request payload. */
export const trustedVenueOrigin = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.origin !== value)
    throw new Error('venue publicOrigin must be an exact HTTPS origin');
  return url.origin;
};
export const venueManagementUrls = (code: string, publicOrigin: string) => {
  const origin = trustedVenueOrigin(publicOrigin);
  venueManagementFieldSchema.shape.code.parse(code);
  const entry = (source: 'nfc' | 'qr' | 'link') =>
    `${origin}/venue-checkin?${new URLSearchParams({ venue: code, source })}`;
  return { nfc: entry('nfc'), qr: entry('qr'), link: entry('link') };
};

/** No caller-supplied principal. Resolve credential and set context in this transaction. */
export const runVenueManagement = async (
  pool: Pool,
  requestId: string,
  session: string,
  input: unknown
): Promise<VenueManagementResult> => {
  const operation = venueManagementOperationSchema.parse(input);
  if (!/^[A-Za-z0-9_-]{43}$/.test(session)) throw new Error('unauthenticated');
  return withRequestContext(pool, 'qigong_api_runtime', { requestId }, async (client) => {
    const identity = await client.query<{ principal: string | null }>(
      'SELECT admin.session_principal($1) principal',
      [session]
    );
    const principal = identity.rows[0]?.principal;
    if (!principal) throw new Error('unauthenticated');
    await client.query("SELECT set_config('qigong.principal_id',$1,TRUE)", [principal]);
    const result = await client.query<{ data: unknown }>(
      'SELECT admin.venue_management($1,$2,$3,$4,$5,$6,$7) data',
      [
        session,
        operation.action,
        operation.regionId,
        'id' in operation ? operation.id : null,
        'version' in operation ? operation.version : null,
        'field' in operation ? JSON.stringify(operation.field) : null,
        'reason' in operation ? operation.reason : null
      ]
    );
    const data = result.rows[0]?.data;
    if (operation.action === 'list')
      return z
        .object({ fields: z.array(venueManagementRowSchema) })
        .strict()
        .parse(data);
    if (operation.action === 'capabilities')
      return z
        .object({ canRead: z.literal(true), canManage: z.boolean() })
        .strict()
        .parse(data);
    return z.object({ field: venueManagementRowSchema }).strict().parse(data);
  });
};

/** Parent must call from its trusted public lookup, never accept a redirect host. */
export const lookupManagedVenue = async (pool: Pool, requestId: string, code: string) => {
  venueManagementFieldSchema.shape.code.parse(code);
  return withRequestContext(pool, 'qigong_api_runtime', { requestId }, async (client) => {
    const result = await client.query<{ data: unknown }>(
      'SELECT admin.venue_management_lookup($1) data',
      [code]
    );
    return z
      .object({ code: z.string(), name: z.string(), active: z.boolean() })
      .strict()
      .nullable()
      .parse(result.rows[0]?.data);
  });
};
