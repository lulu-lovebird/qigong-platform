/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { z } from 'zod';
import { csvCell } from './venue-attendance-report.js';

const date = z.iso.date().refine((value) => value >= '0001-01-01' && value <= '9999-12-31');
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const month = z
  .string()
  .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/)
  .refine((v) => v >= '0001-01' && v < '9999-12');
export const venuePeopleMonthRange = (input: string): { from: string; until: string } => {
  const value = month.parse(input);
  const [year, mon] = value.split('-').map(Number) as [number, number];
  return {
    from: `${value}-01`,
    until: `${String(mon === 12 ? year + 1 : year).padStart(4, '0')}-${String(mon === 12 ? 1 : mon + 1).padStart(2, '0')}-01`
  };
};
export const venuePeopleTaipeiMonth = (now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit'
  }).format(now);

const selector = z
  .strictObject({
    mode: z.enum(['people', 'detail']),
    regionId: z.uuid(),
    fieldId: z.uuid().nullable(),
    personId: z.uuid().nullable(),
    period: z.union([z.strictObject({ month }), z.strictObject({ from: date, until: date })]),
    search: z
      .string()
      .max(80)
      .refine((v) => v === v.trim() && !/[\p{Cc}]/u.test(v)),
    sort: z.enum(['name', 'count', 'days', 'recent']),
    direction: z.enum(['asc', 'desc']),
    page: z.number().int().min(1).max(10000),
    limit: z.number().int().min(1).max(100)
  })
  .transform(({ period, ...rest }) => ({
    ...rest,
    ...('month' in period ? venuePeopleMonthRange(period.month) : period)
  }))
  .refine((v) => {
    const days =
      (Date.parse(v.until + 'T00:00:00Z') - Date.parse(v.from + 'T00:00:00Z')) / 86400000;
    return (
      days > 0 && days <= 366 && (v.mode === 'detail' ? v.personId !== null : v.personId === null)
    );
  });
export type VenuePeopleQuery = z.output<typeof selector>;
export const parseVenuePeopleQuery = (input: unknown): VenuePeopleQuery => selector.parse(input);

const totals = z.strictObject({
  attendanceCount: count,
  attendanceDays: count.max(366),
  learnerCount: count
});
const person = z.strictObject({
  personId: z.uuid(),
  name: z.string().min(1).max(120),
  attendanceCount: count.min(1),
  attendanceDays: count.min(1).max(366),
  latestDate: date
});
const record = z.strictObject({
  recordId: z.uuid(),
  personId: z.uuid(),
  name: z.string().min(1).max(120),
  date,
  timezone: z.string().min(1).max(100),
  checkedInAt: z.iso.datetime({ offset: true }),
  fieldId: z.uuid(),
  fieldCode: z.string().min(1).max(64),
  fieldName: z.string().min(1).max(120),
  method: z.enum(['qr_gps', 'nfc_gps', 'volunteer_manual'])
});
const common = {
  version: z.literal(1),
  regionId: z.uuid(),
  fieldId: z.uuid().nullable(),
  personId: z.uuid().nullable(),
  from: date,
  until: date,
  search: z.string().max(80),
  sort: z.enum(['name', 'count', 'days', 'recent']),
  direction: z.enum(['asc', 'desc']),
  page: count.min(1),
  limit: count.min(1).max(1000),
  exporting: z.boolean(),
  total: count,
  totals
};
const resultSchema = z.discriminatedUnion('mode', [
  z.strictObject({ ...common, mode: z.literal('people'), rows: z.array(person).max(1000) }),
  z.strictObject({ ...common, mode: z.literal('detail'), rows: z.array(record).max(1000) })
]);
export type VenuePeopleResult = z.infer<typeof resultSchema>;
/** Fail closed; DB JSON is not an authorization credential or an arbitrary projection. */
export const decodeVenuePeopleResult = (
  input: unknown,
  query: VenuePeopleQuery,
  exporting: boolean
): VenuePeopleResult => {
  const result = resultSchema.parse(input);
  for (const key of [
    'mode',
    'regionId',
    'fieldId',
    'personId',
    'from',
    'until',
    'search',
    'sort',
    'direction'
  ] as const)
    if (result[key] !== query[key]) throw new Error('invalid venue people binding');
  const limit = exporting ? 1000 : query.limit,
    page = exporting ? 1 : query.page;
  const { attendanceCount, attendanceDays, learnerCount } = result.totals;
  if (
    result.exporting !== exporting ||
    result.page !== page ||
    result.limit !== limit ||
    result.total !== (result.mode === 'people' ? learnerCount : attendanceCount) ||
    (exporting && result.total > 1000) ||
    result.rows.length !== Math.min(limit, Math.max(0, result.total - (page - 1) * limit)) ||
    attendanceDays > attendanceCount ||
    learnerCount > attendanceCount ||
    (attendanceCount === 0) !== (attendanceDays === 0) ||
    (attendanceCount === 0) !== (learnerCount === 0)
  )
    throw new Error('invalid venue people totals');
  const ids =
    result.mode === 'people'
      ? result.rows.map((r) => r.personId)
      : result.rows.map((r) => r.recordId);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate venue people rows');
  if (result.mode === 'people') {
    for (const row of result.rows)
      if (
        row.latestDate < query.from ||
        row.latestDate >= query.until ||
        row.attendanceDays > row.attendanceCount ||
        row.attendanceCount > attendanceCount ||
        row.attendanceDays > attendanceDays
      )
        throw new Error('invalid venue people row');
  } else {
    for (const row of result.rows)
      if (
        row.personId !== query.personId ||
        (query.fieldId !== null && row.fieldId !== query.fieldId) ||
        row.date < query.from ||
        row.date >= query.until
      )
        throw new Error('invalid venue detail row');
  }
  return result;
};

export const encodeVenuePeopleCsv = (data: VenuePeopleResult): string => {
  if (!data.exporting || data.rows.length !== data.total || data.total > 1000)
    throw new Error('invalid export');
  const headers =
    data.mode === 'people'
      ? ['學員 ID', '姓名', '所選場地次數', '去重出席日數', '最近出席日']
      : [
          '學員 ID',
          '姓名',
          '場地當地日期',
          '歷史時區',
          '出席時間 UTC',
          '場地代碼',
          '場地名稱',
          '簽到方式'
        ];
  const rows =
    data.mode === 'people'
      ? data.rows.map((r) => [
          r.personId,
          r.name,
          r.attendanceCount,
          r.attendanceDays,
          r.latestDate
        ])
      : data.rows.map((r) => [
          r.personId,
          r.name,
          r.date,
          r.timezone,
          r.checkedInAt,
          r.fieldCode,
          r.fieldName,
          r.method
        ]);
  return (
    '\uFEFF' +
    [headers, ...rows].map((row) => row.map((v) => csvCell(v)).join(',')).join('\r\n') +
    '\r\n'
  );
};
