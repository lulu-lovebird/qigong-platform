import type { PoolClient } from '@qigong/database';
import { z } from 'zod';
import { adminNameColumn, type AdminLocale } from './admin-locale.js';

export const reportViewSchema = z.enum([
  'overview',
  'status',
  'leaderboard',
  'methods',
  'search',
  'person'
]);
export const reportQuerySchema = z
  .object({
    lang: z.enum(['zh_TW', 'en']).optional(),
    period: z.enum(['week', 'month', 'quarter', 'year', '30d', '90d']).default('week'),
    date: z.iso
      .date()
      .refine((value) => value >= '0001-01-01')
      .optional(),
    region: z.uuid().optional(),
    platform: z.enum(['telegram', 'line', 'whatsapp']).optional(),
    q: z.string().trim().max(100).default(''),
    personId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    top: z.coerce
      .number()
      .pipe(z.union([z.literal(10), z.literal(20), z.literal(30)]))
      .default(10),
    state: z.enum(['checked', 'pending']).default('checked'),
    timezone: z.string().min(1).max(100).default('Asia/Taipei')
  })
  .strict();
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type ReportView = z.infer<typeof reportViewSchema>;
export interface ReportRange {
  today: string;
  start: string;
  end: string;
  timezone: string;
}
export class ReportError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// Every data query runs as qigong_api_runtime with a real session principal.
// RLS is the second boundary, even when filters or IDs are forged by the browser.
const eligibleFor = (locale: AdminLocale) => `WITH eligible AS (
  SELECT person.id, coalesce(nullif(person.preferred_name,''),person.legal_name,person.public_nickname,${locale === 'en' ? "'Unnamed learner'" : "'未命名學員'"}) AS display_name, person.practice_timezone,
    assignment.region_id, region.${adminNameColumn(locale)} AS region_name,
    (SELECT string_agg(DISTINCT identity.platform, ', ' ORDER BY identity.platform)
      FROM identity.platform_identities identity WHERE identity.person_id=person.id AND identity.revoked_at IS NULL) AS platforms
  FROM identity.people person
  LEFT JOIN core.person_region_assignments assignment ON assignment.person_id=person.id
    AND assignment.assignment_type='primary' AND assignment.valid_from<=CURRENT_DATE
    AND (assignment.valid_to IS NULL OR assignment.valid_to>CURRENT_DATE)
  LEFT JOIN core.regions region ON region.id=assignment.region_id
  WHERE person.status='active' AND admin.can_access_person(person.id,'stats.read')
    AND admin.can_access_person(person.id,'checkin.read')
    AND ($1::uuid IS NULL OR assignment.region_id=$1)
    AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM identity.platform_identities identity
      WHERE identity.person_id=person.id AND identity.platform=$2 AND identity.revoked_at IS NULL))
    AND ($3::text IS NULL OR coalesce(nullif(person.preferred_name,''),person.legal_name,person.public_nickname,${locale === 'en' ? "'Unnamed learner'" : "'未命名學員'"}) ILIKE $3 ESCAPE E'\\\\')
    AND ($4::uuid IS NULL OR person.id=$4)
), practices AS (
  SELECT checkin.* FROM core.checkins checkin JOIN eligible ON eligible.id=checkin.person_id
  JOIN identity.platform_identities identity ON identity.id=checkin.submitted_via_identity_id
  WHERE ($2::text IS NULL OR identity.platform=$2)
)`;
const parameters = (query: ReportQuery, personId = query.personId) => [
  query.region ?? null,
  query.platform ?? null,
  query.q ? '%' + query.q.replace(/[\\%_]/g, '\\$&') + '%' : null,
  personId ?? null
];
const pageResult = <T>(rows: T[], total: number, query: ReportQuery) => ({
  rows,
  total,
  page: query.page,
  limit: query.limit,
  totalPages: Math.max(1, Math.ceil(total / query.limit))
});

export const getReportRange = async (
  client: PoolClient,
  query: ReportQuery
): Promise<ReportRange> => {
  const zone = await client.query('SELECT 1 FROM pg_timezone_names WHERE name=$1', [
    query.timezone
  ]);
  if (!zone.rowCount) throw new ReportError(400, 'invalid_timezone');
  const range = await client.query<ReportRange>(
    `WITH clock AS (SELECT (CURRENT_TIMESTAMP AT TIME ZONE $1)::date AS today), bounds AS (
    SELECT today,CASE $2 WHEN '30d' THEN today-29 WHEN '90d' THEN today-89
      ELSE date_trunc($2,today::timestamp)::date END AS start FROM clock)
    SELECT today::text,start::text,(today+1)::text AS end,$1::text AS timezone FROM bounds`,
    [query.timezone, query.period]
  );
  const result = range.rows[0]!;
  if (query.date && query.date > result.today) throw new ReportError(400, 'future_report_date');
  return result;
};

interface LearnerRow {
  id: string;
  display_name: string;
  region_name: string | null;
  platforms: string | null;
  practice_timezone: string;
}
interface RankingRow extends LearnerRow {
  total_days: number;
  period_days: number;
  max_streak: number;
  current_streak: number;
  last_checkin: string | null;
}
interface MethodRow {
  code: string;
  name: string;
  parent_name: string | null;
  days: number;
  share: number;
}

const methodSummary = async (
  client: PoolClient,
  query: ReportQuery,
  start: string,
  end: string
) => {
  const eligible = eligibleFor(query.lang ?? 'zh_TW');
  const nameColumn = adminNameColumn(query.lang ?? 'zh_TW');
  const methods = await client.query<MethodRow>(
    eligible +
      `, selections AS (
    SELECT selection.* FROM practices JOIN core.checkin_method_selections selection ON selection.checkin_id=practices.id
    WHERE practices.practice_date >= $5::date AND practices.practice_date < $6::date)
    SELECT method.code,method.${nameColumn} AS name,parent.${nameColumn} AS parent_name,count(*)::integer AS days,
      round(count(*)::numeric*100/nullif((SELECT count(*) FROM selections),0),1)::float8 AS share
    FROM selections JOIN core.practice_methods method ON method.id=selections.practice_method_id
    LEFT JOIN core.practice_methods parent ON parent.id=method.parent_id
    GROUP BY method.id,parent.${nameColumn} ORDER BY days DESC,method.sort_order,method.code`,
    [...parameters(query), start, end]
  );
  return methods.rows;
};

export const getAdminReport = async (client: PoolClient, view: ReportView, query: ReportQuery) => {
  const eligible = eligibleFor(query.lang ?? 'zh_TW');
  const nameColumn = adminNameColumn(query.lang ?? 'zh_TW');
  const access = await client.query<{
    allowed: boolean;
  }>(`SELECT admin.request_principal_id() IS NOT NULL
    AND admin.has_permission('learner.read') AND admin.has_permission('checkin.read') AND admin.has_permission('stats.read') AS allowed`);
  if (!access.rows[0]?.allowed) throw new ReportError(403, 'report_permission_denied');
  const range = await getReportRange(client, query);
  const args = parameters(query);
  if (view === 'overview') {
    const kpis = await client.query<{
      active_users: number;
      total_checkins: number;
      learners: number;
      average_daily: number;
    }>(
      eligible +
        `
      SELECT count(DISTINCT person_id)::integer AS active_users,count(*)::integer AS total_checkins,
        (SELECT count(*)::integer FROM eligible) AS learners,
        round(count(*)::numeric / greatest($6::date-$5::date,1),1)::float8 AS average_daily
      FROM practices WHERE practice_date >= $5::date AND practice_date < $6::date`,
      [...args, range.start, range.end]
    );
    const trend = await client.query<{ date: string; count: number }>(
      eligible +
        `
      SELECT day::date::text AS date,count(practices.id)::integer AS count
      FROM generate_series($5::date::timestamp,($6::date-1)::timestamp,INTERVAL '1 day') day
      LEFT JOIN practices ON practices.practice_date=day::date GROUP BY day ORDER BY day`,
      [...args, range.start, range.end]
    );
    const regions = await client.query<{
      id: string;
      name: string;
    }>(`SELECT id,${nameColumn} AS name FROM core.regions
      WHERE active AND region_type='operational' AND admin.can_access_region(id,'stats.read')
      AND admin.can_access_region(id,'learner.read') AND admin.can_access_region(id,'checkin.read') ORDER BY code`);
    return { range, kpis: kpis.rows[0]!, trend: trend.rows, regions: regions.rows };
  }
  if (view === 'status' || view === 'search') {
    const targetDate = query.date ?? range.today;
    const condition =
      view === 'search'
        ? ''
        : `WHERE ${query.state === 'pending' ? 'NOT' : ''} EXISTS (SELECT 1 FROM practices WHERE practices.person_id=eligible.id AND practices.practice_date=$5::date)
          ${
            query.state === 'pending'
              ? `AND EXISTS (SELECT 1 FROM core.person_region_assignments membership WHERE membership.person_id=eligible.id
            AND membership.assignment_type='primary' AND membership.valid_from<=$5::date
            AND (membership.valid_to IS NULL OR membership.valid_to>$5::date))`
              : ''
          }`;
    // Parameter $5 also appears in the search condition so PostgreSQL can infer it.
    const selected =
      eligible +
      `, selected AS (SELECT * FROM eligible ${condition || 'WHERE $5::date IS NOT NULL'})`;
    const total = (
      await client.query<{ total: number }>(
        selected + ' SELECT count(*)::integer AS total FROM selected',
        [...args, targetDate]
      )
    ).rows[0]!.total;
    const rows = await client.query<LearnerRow>(
      selected + ' SELECT * FROM selected ORDER BY display_name,id LIMIT $6 OFFSET $7',
      [...args, targetDate, query.limit, (query.page - 1) * query.limit]
    );
    return { range, date: targetDate, state: query.state, ...pageResult(rows.rows, total, query) };
  }
  if (view === 'methods')
    return { range, methods: await methodSummary(client, query, range.start, range.end) };
  if (view === 'leaderboard') {
    const ranking =
      eligible +
      `, dates AS (SELECT person_id,practice_date,
      practice_date-row_number() OVER (PARTITION BY person_id ORDER BY practice_date)::integer AS run FROM practices),
      runs AS (SELECT person_id,count(*)::integer AS length,max(practice_date) AS last_date FROM dates GROUP BY person_id,run),
      period_dates AS (SELECT person_id,practice_date,practice_date-row_number() OVER(PARTITION BY person_id ORDER BY practice_date)::integer AS run
        FROM practices WHERE practice_date >= $5::date AND practice_date < $6::date),
      period_runs AS (SELECT person_id,count(*)::integer AS length FROM period_dates GROUP BY person_id,run),
      ranked AS (SELECT eligible.*,
        (SELECT count(*)::integer FROM practices WHERE person_id=eligible.id) AS total_days,
        (SELECT count(*)::integer FROM period_dates WHERE person_id=eligible.id) AS period_days,
        coalesce((SELECT max(length) FROM period_runs WHERE person_id=eligible.id),0) AS max_streak,
        coalesce((SELECT max(length) FROM runs WHERE person_id=eligible.id
          AND last_date >= (CURRENT_TIMESTAMP AT TIME ZONE eligible.practice_timezone)::date-1),0) AS current_streak,
        (SELECT max(practice_date)::text FROM practices WHERE person_id=eligible.id) AS last_checkin FROM eligible)`;
    const values = [...args, range.start, range.end];
    const total = (
      await client.query<{ total: number }>(
        eligible + ' SELECT count(*)::integer AS total FROM eligible',
        args
      )
    ).rows[0]!.total;
    const rows = await client.query<RankingRow>(
      ranking +
        ' SELECT * FROM ranked ORDER BY total_days DESC,current_streak DESC,display_name,id LIMIT $7 OFFSET $8',
      [...values, query.limit, (query.page - 1) * query.limit]
    );
    const top = await client.query<RankingRow>(
      ranking +
        ' SELECT * FROM ranked WHERE period_days>0 ORDER BY period_days DESC,max_streak DESC,display_name,id LIMIT $7',
      [...values, query.top]
    );
    const streaks = await client.query<RankingRow>(
      ranking +
        ' SELECT * FROM ranked WHERE max_streak>0 ORDER BY max_streak DESC,period_days DESC,display_name,id LIMIT $7',
      [...values, query.top]
    );
    return { range, ...pageResult(rows.rows, total, query), top: top.rows, streaks: streaks.rows };
  }
  if (!query.personId) throw new ReportError(400, 'person_id_required');
  const person = (await client.query<LearnerRow>(eligible + ' SELECT * FROM eligible', args))
    .rows[0];
  if (!person) throw new ReportError(404, 'learner_not_found');
  const analyses = await Promise.all(
    [30, 90].map(async (days) => {
      const start = (
        await client.query<{ start: string }>('SELECT ($1::date-($2::integer-1))::text AS start', [
          range.today,
          days
        ])
      ).rows[0]!.start;
      const totalDays = (
        await client.query<{ total: number }>(
          eligible +
            ' SELECT count(*)::integer AS total FROM practices WHERE practice_date >= $5::date AND practice_date < $6::date',
          [...args, start, range.end]
        )
      ).rows[0]!.total;
      return { days, totalDays, methods: await methodSummary(client, query, start, range.end) };
    })
  );
  const total = (
    await client.query<{ total: number }>(
      eligible + ' SELECT count(*)::integer AS total FROM practices',
      args
    )
  ).rows[0]!.total;
  const history = await client.query<{
    id: string;
    practice_date: string;
    practice_timezone: string;
    entry_kind: string;
    platform: string;
    created_at: Date;
    methods: string[];
  }>(
    eligible +
      `
    SELECT practices.id,practice_date::text,practices.practice_timezone,entry_kind,identity.platform,practices.created_at,
      coalesce((SELECT array_agg(method.${nameColumn} ORDER BY method.sort_order,method.code)
        FROM core.checkin_method_selections selection JOIN core.practice_methods method ON method.id=selection.practice_method_id WHERE selection.checkin_id=practices.id),ARRAY[]::text[]) AS methods
    FROM practices JOIN identity.platform_identities identity ON identity.id=practices.submitted_via_identity_id
    ORDER BY practice_date DESC,practices.id LIMIT $5 OFFSET $6`,
    [...args, query.limit, (query.page - 1) * query.limit]
  );
  return { range, person, analyses, history: pageResult(history.rows, total, query) };
};
