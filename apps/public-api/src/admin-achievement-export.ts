import type { PoolClient } from '@qigong/database';
import { z } from 'zod';
import { achievementCodeSchema, achievementQuerySchema } from './admin-achievements.js';
import { uiText } from './ui-localization.js';
import type { AdminLocale } from './admin-locale.js';
import { hasAchievementVersions } from './achievement-version-compat.js';
export const exportFiltersSchema = achievementQuerySchema
  .omit({ page: true, limit: true })
  .strict();
export const exportPurposeSchema = z.enum(['award_contact', 'internal_review']);
export const achievementExportInput = exportFiltersSchema
  .extend({ purpose: exportPurposeSchema, confirmed: z.literal(true) })
  .strict();
export type ExportFilters = z.infer<typeof exportFiltersSchema>;
export type ExportPurpose = z.infer<typeof exportPurposeSchema>;
export const exportPreviewSchema = z.object({
  code: achievementCodeSchema,
  name: z.string(),
  ruleVersion: z.number().int().positive(),
  provenance: z.string().nullable().optional(),
  count: z.number().int().min(0).max(5001),
  overLimit: z.boolean(),
  limit: z.literal(5000)
});
const field = z.string().max(10000);
export const personalExportSchema = z
  .object({
    code: achievementCodeSchema,
    name: z.string(),
    ruleVersion: z.number().int().positive(),
    provenance: z.string().nullable().optional(),
    count: z.number().int().min(0).max(5000),
    rows: z
      .array(
        z.object({
          lineId: field,
          telegramId: field,
          whatsappId: field,
          name: field,
          phone: field,
          email: field,
          periods: field,
          contactStatus: z.enum(['missing_current_application', 'matched_current_application'])
        })
      )
      .max(5000)
  })
  .refine((value) => value.count === value.rows.length);
export type PersonalExport = z.infer<typeof personalExportSchema>;
const parameters = (code: string, query: ExportFilters, locale: AdminLocale) => [
  code,
  locale,
  query.region ?? null,
  query.platform ?? null,
  query.q,
  query.year ?? null
];
export const getAchievementExportPreview = async (
  client: PoolClient,
  code: string,
  query: ExportFilters,
  locale: AdminLocale
) => {
  const versioned = query.version !== undefined;
  if (versioned && !(await hasAchievementVersions(client)))
    throw Error('invalid achievement export');
  const result = await client.query<{ data: unknown }>(
    versioned
      ? 'SELECT admin.achievement_version_export_preview($1,$2,$3,$4,$5,$6,$7) data'
      : 'SELECT admin.achievement_export_preview($1,$2,$3,$4,$5,$6) data',
    [...parameters(code, query, locale), ...(versioned ? [query.version] : [])]
  );
  const data = exportPreviewSchema.parse(result.rows[0]?.data);
  return {
    ...data,
    name: data.provenance === 'published_snapshot' ? data.name : uiText(locale, data.name)
  };
};
// Quoting alone does NOT prevent spreadsheet formulas or numeric ID coercion.
// Apostrophe text guards are deliberate CSV presentation characters, not database updates.
export const csvCell = (value: string, forceText = false): string => {
  const first = value.replace(/^[\s\p{Cf}\p{Cc}]*/gu, '');
  const guarded =
    value !== '' && (forceText || /^[=+\-@]/u.test(first) || /^\p{Cc}/u.test(value))
      ? "'" + value
      : value;
  return '"' + guarded.replace(/"/g, '""') + '"';
};
export const encodeAchievementCsv = (data: PersonalExport, locale: AdminLocale): Buffer => {
  const title = data.provenance === 'published_snapshot' ? data.name : uiText(locale, data.name);
  const header = [
    'line_id',
    'telegram_id',
    'whatsapp_id',
    'name',
    'phone',
    'email',
    'achievement_code',
    'achievement_name',
    'rule_version',
    'award_periods',
    'contact_status'
  ];
  const lines = [header.map((v) => csvCell(v)).join(',')];
  for (const row of data.rows)
    lines.push(
      [
        csvCell(row.lineId, true),
        csvCell(row.telegramId, true),
        csvCell(row.whatsappId, true),
        csvCell(row.name),
        csvCell(row.phone, true),
        csvCell(row.email),
        csvCell(data.code),
        csvCell(title),
        csvCell(String(data.ruleVersion)),
        csvCell(row.periods),
        csvCell(row.contactStatus)
      ].join(',')
    );
  const result = Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
  if (result.byteLength > 10 * 1024 * 1024) throw Error('achievement export too large');
  return result;
};
export const achievementCsvFilename = (
  code: string,
  name: string,
  locale: AdminLocale,
  now: Date = new Date(),
  sourceOwnedName = true
) => {
  achievementCodeSchema.parse(code);
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const label =
    Array.from(
      (sourceOwnedName ? uiText(locale, name) : name)
        .normalize('NFC')
        .replace(/[\\/<>:"|?*\p{C}]/gu, '_')
        .trim()
    )
      .slice(0, 60)
      .join('') || code;
  const filename =
    (locale === 'en' ? 'achievement' : '成就') + '_' + label + '_' + code + '_' + stamp + '.csv';
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
  return {
    filename,
    disposition:
      'attachment; filename="achievement-' +
      code +
      '-' +
      stamp +
      ".csv\"; filename*=UTF-8''" +
      encoded
  };
};
export const prepareAchievementCsv = async (
  client: PoolClient,
  code: string,
  query: ExportFilters,
  locale: AdminLocale,
  purpose: ExportPurpose,
  sessionToken: string
) => {
  const versioned = query.version !== undefined;
  if (versioned && !(await hasAchievementVersions(client)))
    throw Error('invalid achievement export');
  const result = await client.query<{ data: unknown }>(
    versioned
      ? 'SELECT admin.prepare_achievement_version_export($1,$2,$3,$4,$5,$6,$7,$8) data'
      : 'SELECT admin.prepare_achievement_personal_export($1,$2,$3,$4,$5,$6,$7) data',
    [...parameters(code, query, locale), purpose, ...(versioned ? [query.version] : [])]
  );
  const data = personalExportSchema.parse(result.rows[0]?.data),
    body = encodeAchievementCsv(data, locale),
    file = achievementCsvFilename(
      data.code,
      data.name + (versioned ? '-v' + data.ruleVersion : ''),
      locale,
      new Date(),
      data.provenance !== 'published_snapshot'
    );
  // Still in the request transaction: failure rolls back audit/cooldown, before any CSV bytes leave.
  const allowed = await client.query<{ allowed: boolean }>(
    'SELECT admin.can_export_achievement_personal_now() AND admin.achievement_export_session_current($1) allowed',
    [sessionToken]
  );
  if (allowed.rows[0]?.allowed !== true) throw Error('achievement export denied');
  return { body, ...file };
};
export const achievementExportFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (
    message === 'achievement export denied' ||
    message === 'achievement access denied' ||
    message === 'achievement scope unavailable'
  )
    return { status: 403, code: 'achievement_export_denied' };
  if (message === 'achievement export rate limited')
    return { status: 429, code: 'achievement_export_rate_limited' };
  if (message === 'achievement export too large')
    return { status: 413, code: 'achievement_export_too_large' };
  if (message === 'achievement unavailable')
    return { status: 404, code: 'achievement_unavailable' };
  if (message === 'invalid achievement export' || message === 'invalid achievement query')
    return { status: 400, code: 'invalid_achievement_export' };
  return { status: 503, code: 'achievement_export_unavailable' };
};
