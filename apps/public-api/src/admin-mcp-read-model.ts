/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { Buffer } from 'node:buffer';
import { z } from 'zod';

export const adminMcpReadMaximumLimit = 50;
export const adminMcpReadMaximumBytes = 128 * 1024;
const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.iso.date().refine((value) => !value.startsWith('0000-'));
const timezone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
const pagination = {
  limit: z.number().int().min(1).max(adminMcpReadMaximumLimit).default(20),
  cursor: z.string().min(1).max(512).nullable().default(null)
};
const requestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('guidance_list'), ...pagination }).strict(),
  z.object({ operation: z.literal('guidance_get'), id: uuid, ...pagination }).strict(),
  z.object({ operation: z.literal('venues_list'), regionId: uuid, ...pagination }).strict()
]);
export type AdminMcpReadRequest = Readonly<z.infer<typeof requestSchema>>;

/** These are query selectors, NOT identity, credentials, or authorization evidence. */
export type AdminMcpReadQuery =
  | Readonly<{ operation: 'guidance_list'; after: string | null; fetchLimit: number }>
  | Readonly<{ operation: 'guidance_get'; id: string; after: string | null; fetchLimit: number }>
  | Readonly<{
      operation: 'venues_list';
      regionId: string;
      after: string | null;
      fetchLimit: number;
    }>;

const cursorSchema = z.discriminatedUnion('operation', [
  z.object({ v: z.literal(1), operation: z.literal('guidance_list'), after: uuid }).strict(),
  z
    .object({ v: z.literal(1), operation: z.literal('guidance_get'), id: uuid, after: date })
    .strict(),
  z
    .object({ v: z.literal(1), operation: z.literal('venues_list'), regionId: uuid, after: uuid })
    .strict()
]);

export const parseAdminMcpReadRequest = (input: unknown): AdminMcpReadRequest => {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new Error('invalid_request');
  return Object.freeze(parsed.data);
};

export const buildAdminMcpReadQuery = (request: AdminMcpReadRequest): AdminMcpReadQuery => {
  let after: string | null = null;
  if (request.cursor !== null) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(request.cursor)) throw new Error();
      const bytes = Buffer.from(request.cursor, 'base64url');
      if (bytes.toString('base64url') !== request.cursor) throw new Error();
      const raw: unknown = JSON.parse(bytes.toString('utf8'));
      const cursor = cursorSchema.parse(raw);
      if (
        cursor.operation !== request.operation ||
        (cursor.operation === 'guidance_get' &&
          (request.operation !== 'guidance_get' || cursor.id !== request.id)) ||
        (cursor.operation === 'venues_list' &&
          (request.operation !== 'venues_list' || cursor.regionId !== request.regionId))
      )
        throw new Error();
      after = cursor.after;
    } catch {
      throw new Error('invalid_request');
    }
  }
  const base = { after, fetchLimit: request.limit + 1 };
  switch (request.operation) {
    case 'guidance_list':
      return Object.freeze({ operation: request.operation, ...base });
    case 'guidance_get':
      return Object.freeze({ operation: request.operation, id: request.id, ...base });
    case 'venues_list':
      return Object.freeze({ operation: request.operation, regionId: request.regionId, ...base });
  }
};

// Object schemas deliberately STRIP unknown source fields. Only these allowlisted
// values reach the caller; never spread a DB row or forward arbitrary JSON.
const campaignSchema = z
  .object({
    id: uuid,
    title: z.string().min(1).max(150),
    startDate: date,
    endDate: date,
    timezone,
    isActive: z.boolean()
  })
  .refine((value) => value.endDate >= value.startDate);
const entrySchema = z.object({
  id: uuid,
  guideDate: date,
  title: z.string().max(100).nullable(),
  content: z.string().min(1).max(500)
});
const venueSchema = z
  .object({
    id: uuid,
    region_id: uuid,
    code: z.string().min(1).max(64),
    name_zh_tw: z.string().min(1).max(120),
    name_en: z.string().max(120).nullable(),
    timezone,
    is_active: z.boolean()
  })
  .transform((value) => ({
    id: value.id,
    regionId: value.region_id,
    code: value.code,
    nameZhTw: value.name_zh_tw,
    nameEn: value.name_en,
    timezone: value.timezone,
    isActive: value.is_active
  }));
export type AdminMcpGuidanceCampaign = Readonly<z.infer<typeof campaignSchema>>;
export type AdminMcpGuidanceEntry = Readonly<z.infer<typeof entrySchema>>;
export type AdminMcpVenue = Readonly<z.infer<typeof venueSchema>>;
export type AdminMcpReadData =
  | Readonly<{ operation: 'guidance_list'; campaigns: readonly AdminMcpGuidanceCampaign[] }>
  | Readonly<{
      operation: 'guidance_get';
      campaign: AdminMcpGuidanceCampaign;
      entries: readonly AdminMcpGuidanceEntry[];
    }>
  | Readonly<{ operation: 'venues_list'; regionId: string; venues: readonly AdminMcpVenue[] }>;
export interface AdminMcpReadPage {
  readonly data: AdminMcpReadData;
  readonly nextCursor: string | null;
  /** More rows exist, not a total or a snapshot guarantee. */
  readonly truncated: boolean;
}

const sourceRecord = (input: unknown): Record<string, unknown> => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error();
  return input as Record<string, unknown>;
};
const boundedRows = (input: unknown, limit: number): unknown[] => {
  // Check before Zod traversal, including before inspecting row contents.
  if (!Array.isArray(input) || input.length > limit) throw new Error();
  // Densify sparse arrays so holes are validated as undefined, not skipped by map.
  return Array.from(input as unknown[]);
};
const ordered = (keys: readonly string[], after: string | null) => {
  let previous = after;
  for (const key of keys) {
    if (previous !== null && key <= previous) throw new Error();
    previous = key;
  }
};
const nextCursor = (query: AdminMcpReadQuery, after: string): string => {
  const selector =
    query.operation === 'guidance_get'
      ? { id: query.id }
      : query.operation === 'venues_list'
        ? { regionId: query.regionId }
        : {};
  // An unsigned position hint. Altering it can only select another authorized
  // page: the adapter MUST reauthorize every query independently of this value.
  return Buffer.from(
    JSON.stringify({ v: 1, operation: query.operation, ...selector, after })
  ).toString('base64url');
};

/**
 * Adapter wire shapes: {campaigns}, {campaign, entries}, or {fields} (venue DB
 * snake_case). Rows MUST already be keyset-paginated at the authorized boundary:
 * UUID ascending for lists; guideDate ascending for entries. Never load all rows
 * then slice. One lookahead row determines truncation; no inferred totals.
 */
export const decodeAdminMcpReadPage = (
  input: unknown,
  query: AdminMcpReadQuery
): AdminMcpReadPage => {
  try {
    const source = sourceRecord(input);
    const limit = query.fetchLimit - 1;
    if (!Number.isInteger(limit) || limit < 1 || limit > adminMcpReadMaximumLimit)
      throw new Error();
    let data: AdminMcpReadData;
    let keys: string[];
    switch (query.operation) {
      case 'guidance_list': {
        const rows = boundedRows(source.campaigns, query.fetchLimit).map((row) =>
          campaignSchema.parse(row)
        );
        keys = rows.map((row) => row.id);
        data = { operation: query.operation, campaigns: rows.slice(0, limit) };
        break;
      }
      case 'guidance_get': {
        const campaign = campaignSchema.parse(source.campaign);
        if (campaign.id !== query.id) throw new Error();
        const rows = boundedRows(source.entries, query.fetchLimit).map((row) =>
          entrySchema.parse(row)
        );
        if (
          rows.some(
            (row) => row.guideDate < campaign.startDate || row.guideDate > campaign.endDate
          ) ||
          new Set(rows.map((row) => row.id)).size !== rows.length
        )
          throw new Error();
        keys = rows.map((row) => row.guideDate);
        data = { operation: query.operation, campaign, entries: rows.slice(0, limit) };
        break;
      }
      case 'venues_list': {
        const rows = boundedRows(source.fields, query.fetchLimit).map((row) =>
          venueSchema.parse(row)
        );
        if (rows.some((row) => row.regionId !== query.regionId)) throw new Error();
        keys = rows.map((row) => row.id);
        data = {
          operation: query.operation,
          regionId: query.regionId,
          venues: rows.slice(0, limit)
        };
        break;
      }
    }
    ordered(keys, query.after);
    const truncated = keys.length > limit;
    const lastKey = keys[limit - 1];
    const page = {
      data,
      truncated,
      nextCursor: truncated && lastKey !== undefined ? nextCursor(query, lastKey) : null
    };
    if (Buffer.byteLength(JSON.stringify(page), 'utf8') > adminMcpReadMaximumBytes)
      throw new Error();
    return page;
  } catch {
    // Do not expose Zod issues, DB records, or sensitive source values.
    throw new Error('invalid_read_result');
  }
};
