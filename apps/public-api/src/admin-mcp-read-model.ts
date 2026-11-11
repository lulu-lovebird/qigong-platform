/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  adminMcpLimits,
  adminMcpReadRowSchemas,
  parseAdminMcpCall,
  parseAdminMcpReadResult,
  type AdminMcpCall,
  type AdminMcpReadResult as CanonicalReadResult
} from './admin-mcp-contract.js';

export const adminMcpReadMaximumLimit = adminMcpLimits.maximumRows;
export const adminMcpReadMaximumBytes = adminMcpLimits.maximumOutputBytes;
export const adminMcpImplementedReadTools = Object.freeze([
  'guidance_list',
  'guidance_get',
  'venues_list'
] as const);
export type AdminMcpImplementedReadTool = (typeof adminMcpImplementedReadTools)[number];
export type AdminMcpReadRequest = Extract<AdminMcpCall, { tool: AdminMcpImplementedReadTool }>;
export type AdminMcpReadBinding = Readonly<{ principalId: string; clientId: string }>;

/** Selectors only, never authorization evidence. All date ranges are half-open. */
export type AdminMcpReadQuery =
  | Readonly<{
      operation: 'guidance_list';
      from: string;
      until: string;
      timezone: string;
      after: string | null;
      fetchLimit: number;
    }>
  | Readonly<{
      operation: 'guidance_get';
      campaignId: string;
      after: string | null;
      fetchLimit: number;
    }>
  | Readonly<{
      operation: 'venues_list';
      regionId: string;
      after: string | null;
      fetchLimit: number;
    }>;
export type AdminMcpReadPage = Pick<CanonicalReadResult, 'data' | 'nextCursor' | 'truncated'>;

export const parseAdminMcpReadRequest = (input: unknown): AdminMcpReadRequest => {
  try {
    const call = parseAdminMcpCall(input);
    if (
      call.tool !== 'guidance_list' &&
      call.tool !== 'guidance_get' &&
      call.tool !== 'venues_list'
    )
      throw new Error();
    return call;
  } catch {
    throw new Error('invalid_request');
  }
};

// Process-local authenticated cursors. Restart invalidates outstanding cursors; multi-process
// production wiring needs a reviewed shared signing-key lifecycle before it can be enabled.
// Never use a cursor as authorization. Every page still needs a fresh authorized backend read.
const cursorKey = randomBytes(32);
const cursorSchema = z
  .object({ v: z.literal(1), b: z.string().length(43), a: z.string().min(1).max(36) })
  .strict();
const digest = (payload: Buffer) => createHmac('sha256', cursorKey).update(payload).digest();
const selectors = (query: AdminMcpReadQuery) => {
  switch (query.operation) {
    case 'guidance_list':
      return { from: query.from, until: query.until, timezone: query.timezone };
    case 'guidance_get':
      return { campaignId: query.campaignId };
    case 'venues_list':
      return { regionId: query.regionId };
  }
};
const bindingHash = (query: AdminMcpReadQuery, binding: AdminMcpReadBinding) => {
  if (!z.uuid().safeParse(binding.principalId).success || !binding.clientId)
    throw new Error('invalid_request');
  return createHash('sha256')
    .update(
      JSON.stringify([
        query.operation,
        selectors(query),
        query.fetchLimit,
        binding.principalId,
        binding.clientId
      ])
    )
    .digest('base64url');
};

export const buildAdminMcpReadQuery = (
  request: AdminMcpReadRequest,
  binding: AdminMcpReadBinding
): AdminMcpReadQuery => {
  const { cursor, limit } = request.arguments;
  const base = { after: null, fetchLimit: limit + 1 };
  let query: AdminMcpReadQuery;
  switch (request.tool) {
    case 'guidance_list':
      query = {
        operation: request.tool,
        from: request.arguments.from,
        until: request.arguments.until,
        timezone: request.arguments.timezone,
        ...base
      };
      break;
    case 'guidance_get':
      query = { operation: request.tool, campaignId: request.arguments.campaignId, ...base };
      break;
    case 'venues_list':
      query = { operation: request.tool, regionId: request.arguments.regionId, ...base };
      break;
  }
  const hash = bindingHash(query, binding);
  let after: string | null = null;
  if (cursor !== null) {
    try {
      const bytes = Buffer.from(cursor, 'base64url');
      if (bytes.toString('base64url') !== cursor || bytes.length <= 32) throw new Error();
      const payload = bytes.subarray(32);
      if (!timingSafeEqual(bytes.subarray(0, 32), digest(payload))) throw new Error();
      const parsed = cursorSchema.parse(JSON.parse(payload.toString('utf8')) as unknown);
      if (parsed.b !== hash) throw new Error();
      after = (request.tool === 'guidance_get' ? z.iso.date() : z.uuid()).parse(parsed.a);
    } catch {
      throw new Error('invalid_request');
    }
  }
  return Object.freeze({ ...query, after });
};

const nextCursor = (query: AdminMcpReadQuery, binding: AdminMcpReadBinding, after: string) => {
  const payload = Buffer.from(JSON.stringify({ v: 1, b: bindingHash(query, binding), a: after }));
  const value = Buffer.concat([digest(payload), payload]).toString('base64url');
  if (value.length > 256) throw new Error();
  return value;
};
const sourceRecord = (input: unknown): Record<string, unknown> => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error();
  return input as Record<string, unknown>;
};
const boundedRows = (input: unknown, limit: number): unknown[] => {
  // Bound before row traversal and densify holes so they cannot bypass validation.
  if (!Array.isArray(input) || input.length > limit) throw new Error();
  return Array.from(input as unknown[]);
};
const ordered = (keys: readonly string[], after: string | null) => {
  let previous = after;
  for (const key of keys) {
    if (previous !== null && key <= previous) throw new Error();
    previous = key;
  }
};
// Backend records may contain extra private fields. The canonical allowlist strips them;
// public dispatcher results remain strict and reject extras rather than echoing raw rows.
const campaignSchema = adminMcpReadRowSchemas.campaign.unwrap().strip();
const entrySchema = adminMcpReadRowSchemas.entry.unwrap().strip();
const venueSchema = adminMcpReadRowSchemas.venue.unwrap().strip();

/**
 * Trusted backend wire data uses canonical DTO names: {items} or {campaign, entries}.
 * No legacy isActive -> publication-status inference or inclusive-end-date guessing.
 * The backend MUST filter at source and keyset paginate with one lookahead row:
 * campaignId/venueId ascending for lists, date ascending for guidance entries.
 * Any row (including lookahead) outside the requested selectors fails the whole page.
 */
export const decodeAdminMcpReadPage = (
  input: unknown,
  query: AdminMcpReadQuery,
  binding: AdminMcpReadBinding
): AdminMcpReadPage => {
  try {
    const source = sourceRecord(input);
    const limit = query.fetchLimit - 1;
    if (!Number.isInteger(limit) || limit < 1 || limit > adminMcpReadMaximumLimit)
      throw new Error();
    const call = parseAdminMcpReadRequest({
      tool: query.operation,
      arguments: { ...selectors(query), cursor: null, limit }
    });
    const metadata = {
      asOf: new Date().toISOString(),
      nextCursor: null,
      truncated: false,
      warnings: []
    };
    let data: CanonicalReadResult['data'];
    let keys: string[];
    switch (query.operation) {
      case 'guidance_list': {
        const rows = boundedRows(source.items, query.fetchLimit).map((row) =>
          campaignSchema.parse(row)
        );
        // Validate lookahead too, independently of the public maximumRows/limit cap.
        for (const row of rows)
          parseAdminMcpReadResult(call, { data: { items: [row] }, ...metadata });
        keys = rows.map((row) => row.campaignId);
        data = { items: rows.slice(0, limit) };
        break;
      }
      case 'guidance_get': {
        const campaign = campaignSchema.parse(source.campaign);
        const rows = boundedRows(source.entries, query.fetchLimit).map((row) =>
          entrySchema.parse(row)
        );
        for (const row of rows)
          parseAdminMcpReadResult(call, { data: { campaign, entries: [row] }, ...metadata });
        keys = rows.map((row) => row.date);
        data = { campaign, entries: rows.slice(0, limit) };
        break;
      }
      case 'venues_list': {
        const rows = boundedRows(source.items, query.fetchLimit).map((row) =>
          venueSchema.parse(row)
        );
        for (const row of rows)
          parseAdminMcpReadResult(call, { data: { items: [row] }, ...metadata });
        keys = rows.map((row) => row.venueId);
        data = { items: rows.slice(0, limit) };
        break;
      }
    }
    ordered(keys, query.after);
    const truncated = keys.length > limit;
    const lastKey = keys[limit - 1];
    const page = parseAdminMcpReadResult(call, {
      data,
      ...metadata,
      truncated,
      nextCursor: truncated && lastKey !== undefined ? nextCursor(query, binding, lastKey) : null
    });
    if (Buffer.byteLength(JSON.stringify(page), 'utf8') > adminMcpReadMaximumBytes)
      throw new Error();
    return Object.freeze({
      data: page.data,
      truncated: page.truncated,
      nextCursor: page.nextCursor
    });
  } catch {
    throw new Error('invalid_read_result');
  }
};
