/**
 * Internal, dormant phase-one contracts; NOT an MCP transport or OAuth implementation.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 */
import { z } from 'zod';

export const adminMcpLimits = Object.freeze({
  maximumRows: 50,
  maximumRangeDays: 93,
  maximumInputBytes: 16384,
  maximumOutputBytes: 65536,
  timeoutMs: 5000
});

const text = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0 && !/[\p{Cc}]/u.test(value));
// One canonical UUID representation keeps resource selectors and keyset ordering stable.
const uuid = z.uuid().toLowerCase();
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const date = z.iso.date().refine((value) => value >= '0001-01-01');
const timestamp = z.iso.datetime({ offset: true });
const timezone = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  })
  .overwrite(
    (value) => new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone
  );
const cursor = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);
const pagination = {
  cursor: cursor.nullable(),
  limit: z.number().int().min(1).max(adminMcpLimits.maximumRows)
};
/** Ranges are half-open [from, until), interpreted in the explicitly supplied timezone. */
const range = {
  from: date.describe('Inclusive local ISO date'),
  until: date.describe('Exclusive local ISO date; must be after from and at most 93 days later'),
  timezone: timezone.describe(
    'Explicit IANA business timezone, never inferred from client location'
  )
};
const validRange = (value: { from: string; until: string }) => {
  const days = (Date.parse(value.until) - Date.parse(value.from)) / 86400000;
  return days > 0 && days <= adminMcpLimits.maximumRangeDays;
};
const regionalRange = { regionId: uuid, ...range };
const channel = z.enum(['line', 'telegram', 'whatsapp']);
const inviteStatus = z.enum(['active', 'expired', 'revoked', 'exhausted']);
const guidanceStatus = z.enum(['draft', 'published', 'archived']);
const attendanceMethod = z.enum(['nfc_gps', 'qr_gps', 'volunteer_manual']);
const warning = z.enum(['data_delayed', 'partial_data', 'pagination_not_snapshot']);

const inputs = {
  admin_get_capabilities: z.object({}).strict().readonly(),
  dashboard_get_summary: z.object(regionalRange).strict().refine(validRange).readonly(),
  learners_search: z
    .object({ regionId: uuid, query: text(100), ...pagination })
    .strict()
    .readonly(),
  learners_get: z.object({ learnerId: uuid }).strict().readonly(),
  applications_list: z
    .object({ regionId: uuid, status: z.literal('pending'), ...pagination })
    .strict()
    .readonly(),
  invites_list: z
    .object({ regionId: uuid, channel, status: inviteStatus, ...pagination })
    .strict()
    .readonly(),
  guidance_list: z
    .object({ ...range, ...pagination })
    .strict()
    .refine(validRange)
    .readonly(),
  guidance_get: z
    .object({ campaignId: uuid, ...pagination })
    .strict()
    .readonly(),
  venues_list: z
    .object({ regionId: uuid, ...pagination })
    .strict()
    .readonly(),
  attendance_search: z
    .object({
      ...regionalRange,
      venueId: uuid.nullable(),
      learnerId: uuid.nullable(),
      ...pagination
    })
    .strict()
    .refine(validRange)
    .readonly(),
  attendance_get_summary: z
    .object({ ...regionalRange, venueId: uuid.nullable() })
    .strict()
    .refine(validRange)
    .readonly(),
  audit_search: z
    .object({ ...regionalRange, targetId: uuid.nullable(), ...pagination })
    .strict()
    .refine(validRange)
    .readonly()
} as const;

export type AdminMcpToolName = keyof typeof inputs;
export type AdminMcpReadToolName = Exclude<AdminMcpToolName, 'admin_get_capabilities'>;
export type AdminMcpCall = {
  [Name in AdminMcpToolName]: Readonly<{ tool: Name; arguments: z.infer<(typeof inputs)[Name]> }>;
}[AdminMcpToolName];
export type AdminMcpReadCall = Exclude<AdminMcpCall, { tool: 'admin_get_capabilities' }>;

export const adminMcpReadScopes = Object.freeze([
  'admin:summary:read',
  'admin:learners:read',
  'admin:invites:read',
  'admin:guidance:read',
  'admin:venues:read',
  'admin:audit:read'
] as const);
export type AdminMcpReadScope = (typeof adminMcpReadScopes)[number];
const requiredScopes: Readonly<Record<AdminMcpToolName, readonly AdminMcpReadScope[]>> = {
  admin_get_capabilities: [],
  dashboard_get_summary: ['admin:summary:read'],
  learners_search: ['admin:learners:read'],
  learners_get: ['admin:learners:read'],
  applications_list: ['admin:learners:read'],
  invites_list: ['admin:invites:read'],
  guidance_list: ['admin:guidance:read'],
  guidance_get: ['admin:guidance:read'],
  venues_list: ['admin:venues:read'],
  attendance_search: ['admin:venues:read', 'admin:learners:read'],
  attendance_get_summary: ['admin:venues:read'],
  audit_search: ['admin:audit:read']
};

const names = Object.keys(inputs) as AdminMcpToolName[];
export const isAdminMcpToolName = (value: string): value is AdminMcpToolName =>
  Object.hasOwn(inputs, value);
export const adminMcpScopesFor = (tool: AdminMcpToolName): readonly AdminMcpReadScope[] =>
  Object.freeze([...requiredScopes[tool]]);

/** Shallow guard for parsed JSON values only: no recursion or arbitrary serialization.
 * This cannot bound raw bytes, JSON parsing, or hostile Proxy traps. A future transport
 * MUST enforce its body limit before parsing. All current tool arguments are flat.
 */
const boundedRecord = (
  input: unknown,
  maximumFields: number,
  flat: boolean,
  schemaKeys: readonly string[]
) => {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new Error('invalid_request');
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) throw new Error('invalid_request');
  // Schema keys are a small trusted list; catch accessors even if non-enumerable.
  for (const key of schemaKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor !== undefined && !('value' in descriptor)) throw new Error('invalid_request');
  }
  let fields = 0;
  for (const key in input) {
    if (++fields > maximumFields) throw new Error('invalid_request');
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !('value' in descriptor)) throw new Error('invalid_request');
    const value: unknown = descriptor.value;
    if (flat && value !== null && !['string', 'number', 'boolean'].includes(typeof value))
      throw new Error('invalid_request');
    if (flat && typeof value === 'string' && value.length > adminMcpLimits.maximumInputBytes)
      throw new Error('invalid_request');
  }
};
/** Envelope only; callers can authorize the known tool BEFORE inspecting selectors. */
export const parseAdminMcpEnvelope = (input: unknown) => {
  boundedRecord(input, 2, false, ['tool', 'arguments']);
  return z
    .object({ tool: z.string().min(1).max(100), arguments: z.unknown() })
    .strict()
    .parse(input);
};

/** Strict envelope: identity, scopes, phase switches and credentials are never arguments. */
export const parseAdminMcpCall = (input: unknown): AdminMcpCall => {
  const envelope = parseAdminMcpEnvelope(input);
  if (!isAdminMcpToolName(envelope.tool)) throw new Error('unsupported_tool');
  boundedRecord(envelope.arguments, 12, true, Object.keys(inputs[envelope.tool].unwrap().shape));
  const args = inputs[envelope.tool].parse(envelope.arguments);
  // Each schema is selected by the matching discriminant, never by the caller's asserted type.
  return Object.freeze({ tool: envelope.tool, arguments: args }) as AdminMcpCall;
};

/** Returns fresh JSON schemas. Cross-field range checks remain enforced by server parsing. */
export const getAdminMcpToolCatalog = () =>
  names.map((name) => ({
    name,
    phase: 'read_only' as const,
    requiredScopes: adminMcpScopesFor(name),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: z.toJSONSchema(inputs[name]),
    // Successful structured response. Failures use the separate stable error-code envelope.
    outputSchema: z.toJSONSchema(
      z
        .object({
          schemaVersion: z.literal(1),
          requestId: z.uuid(),
          ok: z.literal(true),
          data: outputs[name],
          ...resultMetadata
        })
        .strict()
    ),
    errorCodes: adminMcpErrorCodes,
    limits: adminMcpLimits
  }));

const learner = z
  .object({ learnerId: uuid, displayName: text(120), regionId: uuid })
  .strict()
  .readonly();
const guidance = z
  .object({
    campaignId: uuid,
    title: text(200),
    status: guidanceStatus,
    ...range,
    until: date.describe('Exclusive local ISO campaign end date; must be after from')
  })
  .strict()
  // Campaign lifespan is not the bounded query window.
  .refine((value) => value.from < value.until)
  .readonly();
const venue = z
  .object({ venueId: uuid, regionId: uuid, name: text(120), active: z.boolean() })
  .strict()
  .readonly();
const guidanceEntry = z
  .object({
    date,
    content: z
      .string()
      .min(1)
      // Migration 0063 caps trimmed content at 500 Unicode characters. Keep a
      // conservative untrimmed DTO cap without rewriting whitespace in the prose.
      .max(500)
      .refine((value) => value.trim().length > 0 && !/(?![\r\n\t])\p{Cc}/u.test(value))
  })
  .strict()
  .readonly();
/** Shared row schemas for the trusted backend boundary and public result validation. */
export const adminMcpReadRowSchemas = Object.freeze({
  campaign: guidance,
  entry: guidanceEntry,
  venue
});
const rows = <Schema extends z.ZodType>(schema: Schema) =>
  z.array(schema).max(adminMcpLimits.maximumRows).readonly();
const summary = { ...regionalRange, basis: z.literal('all_matching_records') };
const outputs = {
  admin_get_capabilities: z
    .object({
      phase: z.literal('read_only'),
      scopes: z.array(z.enum(adminMcpReadScopes)).max(adminMcpReadScopes.length).readonly(),
      tools: z
        .array(z.enum(names as [AdminMcpToolName, ...AdminMcpToolName[]]))
        .max(names.length)
        .readonly()
    })
    .strict()
    .readonly(),
  dashboard_get_summary: z
    .object({
      ...summary,
      learnerCount: count,
      pendingApplicationCount: count,
      attendanceCount: count
    })
    .strict()
    .refine(validRange)
    .readonly(),
  learners_search: z
    .object({ items: rows(learner) })
    .strict()
    .readonly(),
  learners_get: learner,
  applications_list: z
    .object({
      items: rows(
        z
          .object({
            applicationId: uuid,
            regionId: uuid,
            displayName: text(120),
            status: z.literal('pending'),
            submittedAt: timestamp
          })
          .strict()
          .readonly()
      )
    })
    .strict()
    .readonly(),
  invites_list: z
    .object({
      items: rows(
        z
          .object({
            inviteId: uuid,
            regionId: uuid,
            channel,
            status: inviteStatus,
            expiresAt: timestamp,
            usedCount: count,
            maxUses: count
          })
          .strict()
          .refine((value) => value.usedCount <= value.maxUses)
          .readonly()
      )
    })
    .strict()
    .readonly(),
  guidance_list: z
    .object({ items: rows(guidance) })
    .strict()
    .readonly(),
  guidance_get: z
    .object({
      campaign: guidance,
      entries: rows(guidanceEntry)
    })
    .strict()
    .readonly(),
  venues_list: z
    .object({ items: rows(venue) })
    .strict()
    .readonly(),
  attendance_search: z
    .object({
      items: rows(
        z
          .object({
            attendanceId: uuid,
            learnerId: uuid,
            venueId: uuid,
            regionId: uuid,
            date,
            method: attendanceMethod
          })
          .strict()
          .readonly()
      )
    })
    .strict()
    .readonly(),
  attendance_get_summary: z
    .object({
      ...summary,
      venueId: uuid.nullable(),
      attendanceCount: count,
      learnerCount: count,
      attendanceDays: count
    })
    .strict()
    .refine(validRange)
    .readonly(),
  audit_search: z
    .object({
      items: rows(
        z
          .object({
            auditId: uuid,
            targetId: uuid,
            regionId: uuid,
            occurredAt: timestamp,
            action: z.enum(['read', 'create', 'update', 'revoke', 'delete']),
            outcome: z.enum(['succeeded', 'denied', 'failed'])
          })
          .strict()
          .readonly()
      )
    })
    .strict()
    .readonly()
} as const;

const resultMetadata = {
  asOf: timestamp,
  nextCursor: cursor.nullable(),
  truncated: z.boolean(),
  warnings: z.array(warning).max(2).readonly()
};
export type AdminMcpData = {
  [Name in AdminMcpToolName]: z.infer<(typeof outputs)[Name]>;
}[AdminMcpToolName];
export type AdminMcpReadResult = Readonly<z.infer<ReturnType<typeof resultSchema>>>;
const resultSchema = (tool: AdminMcpToolName) =>
  z
    .object({ data: outputs[tool], ...resultMetadata })
    .strict()
    .readonly();

const dateInTimezone = (instant: string, zone: string) => {
  const parts = new Intl.DateTimeFormat('en', {
    // ISO calendar formatting omits era on Node 24/ICU 78; Gregorian keeps AD/BC explicit.
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: zone,
    year: 'numeric',
    era: 'short',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(instant));
  // Intl formats ISO year zero as year 1 BC. Never reinterpret it as AD 1.
  if (parts.find((value) => value.type === 'era')?.value !== 'AD')
    throw new Error('invalid_result');
  const part = (kind: 'year' | 'month' | 'day') =>
    parts.find((value) => value.type === kind)?.value;
  return `${part('year')?.padStart(4, '0')}-${part('month')}-${part('day')}`;
};

/** Explicit allowlists reject, rather than echo, raw records and unexpected sensitive fields. */
export const parseAdminMcpReadResult = (call: AdminMcpCall, input: unknown): AdminMcpReadResult => {
  const result = resultSchema(call.tool).parse(input);
  const data = result.data;
  const args = call.arguments;
  const matches = (actual: object, expected: object, keys: readonly string[]) =>
    keys.every(
      (key) =>
        !Object.hasOwn(expected, key) || Reflect.get(actual, key) === Reflect.get(expected, key)
    );
  if ('limit' in args) {
    const entries = 'items' in data ? data.items : 'entries' in data ? data.entries : [];
    if (entries.length > args.limit) throw new Error('invalid_result');
  } else if (result.nextCursor !== null || result.truncated) throw new Error('invalid_result');
  if (
    result.nextCursor !== null &&
    (!result.truncated || ('cursor' in args && result.nextCursor === args.cursor))
  )
    throw new Error('invalid_result');
  if (
    'items' in data &&
    !data.items.every((row) =>
      matches(
        row,
        args,
        ['regionId', 'channel', 'status', 'venueId', 'learnerId', 'targetId'].filter(
          (key) => Reflect.get(args, key) !== null
        )
      )
    )
  )
    throw new Error('invalid_result');
  if (
    'items' in data &&
    'from' in args &&
    !data.items.every((row) => !('date' in row) || (row.date >= args.from && row.date < args.until))
  )
    throw new Error('invalid_result');
  if (
    'items' in data &&
    'from' in args &&
    !data.items.every((row) => {
      if ('occurredAt' in row) {
        const localDate = dateInTimezone(row.occurredAt, args.timezone);
        return localDate >= args.from && localDate < args.until;
      }
      // Guidance list selects campaigns overlapping the requested half-open business range.
      if ('campaignId' in row)
        return row.timezone === args.timezone && row.from < args.until && row.until > args.from;
      return true;
    })
  )
    throw new Error('invalid_result');
  if ('basis' in data && !matches(data, args, ['regionId', 'from', 'until', 'timezone', 'venueId']))
    throw new Error('invalid_result');
  if (
    call.tool === 'learners_get' &&
    (!('learnerId' in data) || data.learnerId !== call.arguments.learnerId)
  )
    throw new Error('invalid_result');
  if (call.tool === 'guidance_get') {
    if (
      !('campaign' in data) ||
      data.campaign.campaignId !== call.arguments.campaignId ||
      !data.entries.every(
        (entry) => entry.date >= data.campaign.from && entry.date < data.campaign.until
      )
    )
      throw new Error('invalid_result');
  }
  return result;
};

export const adminMcpErrorCodes = [
  'unauthenticated',
  'permission_denied',
  'invalid_request',
  'tool_unavailable',
  'rate_limited',
  'service_unavailable',
  'timeout',
  'cancelled',
  'result_unavailable'
] as const;
export type AdminMcpErrorCode = (typeof adminMcpErrorCodes)[number];
export type AdminMcpResponse = Readonly<
  {
    schemaVersion: 1;
    requestId: string;
  } & (
    | {
        ok: true;
        data: AdminMcpData;
        asOf: string;
        nextCursor: string | null;
        truncated: boolean;
        warnings: readonly z.infer<typeof warning>[];
      }
    | { ok: false; error: { code: AdminMcpErrorCode } }
  )
>;
