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
  });
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
const regionalRange = { regionId: z.uuid(), ...range };
const channel = z.enum(['line', 'telegram', 'whatsapp']);
const inviteStatus = z.enum(['active', 'expired', 'revoked', 'exhausted']);
const guidanceStatus = z.enum(['draft', 'published', 'archived']);
const attendanceMethod = z.enum(['nfc_gps', 'qr_gps', 'volunteer_manual']);
const warning = z.enum(['data_delayed', 'partial_data']);

const inputs = {
  admin_get_capabilities: z.object({}).strict().readonly(),
  dashboard_get_summary: z.object(regionalRange).strict().refine(validRange).readonly(),
  learners_search: z
    .object({ regionId: z.uuid(), query: text(100), ...pagination })
    .strict()
    .readonly(),
  learners_get: z.object({ learnerId: z.uuid() }).strict().readonly(),
  applications_list: z
    .object({ regionId: z.uuid(), status: z.literal('pending'), ...pagination })
    .strict()
    .readonly(),
  invites_list: z
    .object({ regionId: z.uuid(), channel, status: inviteStatus, ...pagination })
    .strict()
    .readonly(),
  guidance_list: z
    .object({ ...range, ...pagination })
    .strict()
    .refine(validRange)
    .readonly(),
  guidance_get: z
    .object({ campaignId: z.uuid(), ...pagination })
    .strict()
    .readonly(),
  venues_list: z
    .object({ regionId: z.uuid(), ...pagination })
    .strict()
    .readonly(),
  attendance_search: z
    .object({
      ...regionalRange,
      venueId: z.uuid().nullable(),
      learnerId: z.uuid().nullable(),
      ...pagination
    })
    .strict()
    .refine(validRange)
    .readonly(),
  attendance_get_summary: z
    .object({ ...regionalRange, venueId: z.uuid().nullable() })
    .strict()
    .refine(validRange)
    .readonly(),
  audit_search: z
    .object({ ...regionalRange, targetId: z.uuid().nullable(), ...pagination })
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

/** Strict envelope: identity, scopes, phase switches and credentials are never arguments. */
export const parseAdminMcpCall = (input: unknown): AdminMcpCall => {
  const envelope = z.object({ tool: z.string(), arguments: z.unknown() }).strict().parse(input);
  if (!isAdminMcpToolName(envelope.tool)) throw new Error('unsupported_tool');
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
  .object({ learnerId: z.uuid(), displayName: text(120), regionId: z.uuid() })
  .strict()
  .readonly();
const guidance = z
  .object({ campaignId: z.uuid(), title: text(200), status: guidanceStatus, ...range })
  .strict()
  .refine(validRange)
  .readonly();
const venue = z
  .object({ venueId: z.uuid(), regionId: z.uuid(), name: text(120), active: z.boolean() })
  .strict()
  .readonly();
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
            applicationId: z.uuid(),
            regionId: z.uuid(),
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
            inviteId: z.uuid(),
            regionId: z.uuid(),
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
      entries: rows(
        z
          .object({ date, content: text(4000) })
          .strict()
          .readonly()
      )
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
            attendanceId: z.uuid(),
            learnerId: z.uuid(),
            venueId: z.uuid(),
            regionId: z.uuid(),
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
      venueId: z.uuid().nullable(),
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
            auditId: z.uuid(),
            targetId: z.uuid(),
            regionId: z.uuid(),
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
    calendar: 'iso8601',
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(instant));
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
