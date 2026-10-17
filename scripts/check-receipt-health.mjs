// @ts-check
// Operator-only, local read-only collection. No SSH, environment-file reads or notification sends.
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  lstatSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  existsSync
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  receiptObservationSchema,
  receiptAlertStateSchema,
  advanceReceiptAlerts
} from '../apps/public-api/src/practice-receipt-health.ts';

/** @param {string} text @returns {unknown} */
const parseJson = (text) => JSON.parse(text);
/** @param {unknown} input @returns {input is Record<string, unknown>} */
const isRecord = (input) => typeof input === 'object' && input !== null && !Array.isArray(input);
/** @param {string} text */
const parseProperties = (text) => {
  /** @type {Map<string, string>} */
  const properties = new Map();
  for (const line of text.trim().split('\n')) {
    const separator = line.indexOf('=');
    if (separator < 1) throw Error('Invalid service properties');
    properties.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return properties;
};
/** @param {string} since */
const sqlFor = (since) => `
BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
WITH boundary AS(SELECT clock_timestamp() AS observed_at, greatest(TIMESTAMPTZ '${since}',clock_timestamp()-INTERVAL '24 hours') AS window_start),
jobs AS(
 SELECT platform AS channel,status,attempts,created_at,delivered_at,available_at,leased_until
 FROM ops.channel_practice_receipts WHERE platform='line'
 UNION ALL
 SELECT 'telegram',status,attempts,created_at,delivered_at,available_at,leased_until
 FROM ops.telegram_practice_receipts
), channels(channel) AS(VALUES('line'),('telegram')),
stats AS(SELECT c.channel,
 count(*) FILTER(WHERE status='pending')::int AS pending,
 count(*) FILTER(WHERE status='pending' AND available_at<=b.observed_at)::int AS due,
 count(*) FILTER(WHERE status='sending')::int AS sending,
 count(*) FILTER(WHERE status='failed')::int AS failed,
 count(*) FILTER(WHERE status='sending' AND leased_until<b.observed_at)::int AS "expiredLeases",
 count(*) FILTER(WHERE (status='pending' AND attempts>0) OR (status='sending' AND attempts>1))::int AS retrying,
 greatest(0,extract(epoch FROM(b.observed_at-min(created_at) FILTER(WHERE status='pending' AND available_at<=b.observed_at)))*1000) AS due_age,
 greatest(0,extract(epoch FROM(b.observed_at-min(created_at) FILTER(WHERE status IN('pending','sending'))))*1000) AS outstanding_age,
 count(*) FILTER(WHERE created_at>b.observed_at OR delivered_at>b.observed_at OR delivered_at<created_at)::int AS "clockAnomalies"
 FROM channels c CROSS JOIN boundary b LEFT JOIN jobs j ON j.channel=c.channel GROUP BY c.channel,b.observed_at),
delivery AS(SELECT c.channel,count(j.channel)::int AS "deliverySamples",
 percentile_cont(.5) WITHIN GROUP(ORDER BY extract(epoch FROM(delivered_at-created_at))*1000) AS "p50Ms",
 percentile_cont(.95) WITHIN GROUP(ORDER BY extract(epoch FROM(delivered_at-created_at))*1000) AS "p95Ms",
 max(extract(epoch FROM(delivered_at-created_at))*1000) AS "maxMs"
 FROM channels c CROSS JOIN boundary b LEFT JOIN jobs j ON j.channel=c.channel AND status='delivered'
 AND created_at>=b.window_start AND delivered_at>=b.window_start AND delivered_at<=b.observed_at AND delivered_at>=created_at
 GROUP BY c.channel)
SELECT jsonb_build_object('observedAtMs',floor(extract(epoch FROM b.observed_at)*1000),
 'windowStartMs',floor(extract(epoch FROM b.window_start)*1000),'queues',
 (SELECT jsonb_agg(jsonb_build_object('channel',s.channel,'pending',pending,'due',due,'sending',sending,'failed',failed,
 'expiredLeases',"expiredLeases",'retrying',retrying,'oldestDueAgeMs',CASE WHEN due>0 THEN due_age END,
 'oldestOutstandingAgeMs',CASE WHEN pending+sending>0 THEN outstanding_age END,
 'deliverySamples',"deliverySamples",'p50Ms',"p50Ms",'p95Ms',"p95Ms",'maxMs',"maxMs",'clockAnomalies',"clockAnomalies") ORDER BY s.channel)
 FROM stats s JOIN delivery d USING(channel))) AS snapshot FROM boundary b;
COMMIT;
`;
const cleanEnv = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };
/** @param {string} file @param {readonly string[]} args @param {string} [input] */
const run = (file, args, input) =>
  execFileSync(file, args, {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    env: cleanEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(input ? { input } : {})
  });
/** @param {string} since */
const collect = (since) => {
  if (process.platform !== 'linux' || process.getuid?.() !== 0)
    throw Error('Local operator required');
  const details = parseProperties(
    run('/usr/bin/systemctl', [
      'show',
      'qigong-practice-receipts.service',
      '-p',
      'ActiveState',
      '-p',
      'InvocationID',
      '-p',
      'NRestarts',
      '-p',
      'ActiveEnterTimestampMonotonic'
    ])
  );
  const activeState = details.get('ActiveState');
  if (
    typeof activeState !== 'string' ||
    !['active', 'inactive', 'activating', 'deactivating', 'failed'].includes(activeState)
  )
    throw Error('Service status unavailable');
  const active = activeState === 'active';
  /** @param {unknown} value */
  const elapsedMs = (value) => {
    const nowMonoUs = Number(process.hrtime.bigint() / 1000n);
    const micros = Number(value);
    if (!Number.isSafeInteger(micros) || micros <= 0 || micros > nowMonoUs)
      throw Error('Invalid monotonic timestamp');
    return (nowMonoUs - micros) / 1000;
  };
  /** @type {unknown} */
  let heartbeatMicros = null;
  /** @type {unknown} */
  let lanes = { line: null, telegram: null };
  if (active) {
    const invocation = details.get('InvocationID');
    if (!/^[a-f0-9]{32}$/.test(invocation ?? '')) throw Error('Missing service invocation');
    const entry = run('/usr/bin/journalctl', [
      '--boot=0',
      '--unit=qigong-practice-receipts.service',
      `_SYSTEMD_INVOCATION_ID=${invocation}`,
      '--grep=\"event\":\"practice_receipt_worker_heartbeat\"',
      '--lines=1',
      '--no-pager',
      '--output=json',
      '--output-fields=__MONOTONIC_TIMESTAMP,MESSAGE'
    ]).trim();
    if (entry) {
      const journal = parseJson(entry);
      if (!isRecord(journal) || typeof journal.MESSAGE !== 'string')
        throw Error('Missing journal message');
      const message = parseJson(journal.MESSAGE);
      if (!isRecord(message) || message.event !== 'practice_receipt_worker_heartbeat')
        throw Error('Missing heartbeat');
      heartbeatMicros = journal.__MONOTONIC_TIMESTAMP;
      if (message.lanes) lanes = message.lanes;
    }
  }
  const database = parseJson(
    run(
      '/usr/sbin/runuser',
      [
        '-u',
        'postgres',
        '--',
        '/usr/bin/psql',
        '-X',
        '--no-password',
        '-h',
        '/var/run/postgresql',
        '-p',
        '5432',
        '-U',
        'postgres',
        '-d',
        'qigong_platform',
        '-qAt',
        '-v',
        'ON_ERROR_STOP=1'
      ],
      sqlFor(since)
    )
  );
  if (
    !isRecord(database) ||
    typeof database.observedAtMs !== 'number' ||
    Math.abs(database.observedAtMs - Date.now()) > 10000
  )
    throw Error('Collector clock mismatch');
  const finalDetails = parseProperties(
    run('/usr/bin/systemctl', [
      'show',
      'qigong-practice-receipts.service',
      '-p',
      'ActiveState',
      '-p',
      'InvocationID'
    ])
  );
  if (
    finalDetails.get('ActiveState') !== activeState ||
    finalDetails.get('InvocationID') !== details.get('InvocationID')
  )
    throw Error('Service changed during collection');
  return receiptObservationSchema.parse({
    kind: 'observed',
    observedAtMs: database.observedAtMs,
    windowStartMs: database.windowStartMs,
    queues: database.queues,
    service: {
      active,
      restarts: Number(details.get('NRestarts')),
      uptimeMs: active ? elapsedMs(details.get('ActiveEnterTimestampMonotonic')) : 0,
      heartbeatAgeMs: heartbeatMicros === null ? null : elapsedMs(heartbeatMicros),
      lanes
    }
  });
};
/** @param {string} file @returns {unknown} */
const readJson = (file) => {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw Error('Invalid input file');
  return parseJson(readFileSync(file, 'utf8'));
};
/** @type {number | undefined} */
let lock;
/** @type {string | undefined} */
let lockPath, temporary;
try {
  /** @type {Map<string, string | true>} */
  const options = new Map();
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    if (
      typeof flag !== 'string' ||
      !['--local', '--print-sql', '--input', '--since', '--state-file'].includes(flag) ||
      options.has(flag)
    )
      throw Error('Invalid arguments');
    const value = flag === '--local' || flag === '--print-sql' ? true : process.argv[++i];
    if (!value || (typeof value === 'string' && value.startsWith('--')))
      throw Error('Missing argument');
    options.set(flag, value);
  }
  const sinceInput = options.get('--since');
  /** @type {string | undefined} */
  let since;
  if (sinceInput) {
    if (
      typeof sinceInput !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(sinceInput)
    )
      throw Error('Explicit UTC boundary required');
    since = new Date(sinceInput).toISOString();
    if (Date.parse(since) > Date.now()) throw Error('Future boundary');
  }
  if (options.has('--print-sql')) {
    if (!since || options.size !== 2) throw Error('SQL mode requires only a boundary');
    process.stdout.write(sqlFor(since));
  } else {
    if (
      options.has('--local') === options.has('--input') ||
      (options.has('--local') && !since) ||
      (options.has('--input') && since)
    )
      throw Error('Select one collector mode');
    const stateFile = options.get('--state-file');
    if (typeof stateFile !== 'string' || !path.isAbsolute(stateFile))
      throw Error('Private absolute state path required');
    const parent = path.dirname(stateFile);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const directory = lstatSync(parent);
    if (!directory.isDirectory() || directory.mode & 0o022 || directory.uid !== process.getuid?.())
      throw Error('Untrusted state directory');
    lockPath = stateFile + '.lock';
    lock = openSync(lockPath, 'wx', 0o600);
    /** @type {import('../apps/public-api/src/practice-receipt-health.ts').ReceiptAlertState | null} */
    let previous = null;
    if (existsSync(stateFile)) {
      const stat = lstatSync(stateFile);
      if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid?.())
        throw Error('Untrusted state file');
      previous = receiptAlertStateSchema.parse(readJson(stateFile));
    }
    /** @type {import('../apps/public-api/src/practice-receipt-health.ts').ReceiptObservation} */
    let snapshot;
    if (options.has('--input')) {
      const inputFile = options.get('--input');
      if (typeof inputFile !== 'string') throw Error('Missing input file');
      snapshot = receiptObservationSchema.parse(readJson(inputFile));
    } else {
      try {
        if (typeof since !== 'string') throw Error('Missing epoch');
        snapshot = collect(since);
      } catch {
        snapshot = { kind: 'unavailable', observedAtMs: Date.now() };
      }
    }
    const result = advanceReceiptAlerts(snapshot, previous);
    temporary = stateFile + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, JSON.stringify(result.state) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, stateFile);
    temporary = undefined;
    console.log(
      JSON.stringify({
        event: 'receipt_health_check',
        status: result.status,
        observation: snapshot,
        alerts: result.events,
        activeAlerts: result.state.entries.filter((entry) => entry.notifiedSeverity)
      })
    );
    process.exitCode =
      result.status === 'unknown'
        ? 3
        : result.status === 'critical'
          ? 2
          : result.status === 'warning'
            ? 1
            : 0;
  }
} catch {
  console.log(JSON.stringify({ event: 'receipt_health_check_failed', status: 'unknown' }));
  process.exitCode = 3;
} finally {
  if (temporary) {
    try {
      unlinkSync(temporary);
    } catch {}
  }
  if (lock !== undefined) {
    let cleanupFailed = false;
    try {
      closeSync(lock);
    } catch {
      cleanupFailed = true;
    }
    try {
      if (lockPath) unlinkSync(lockPath);
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed) {
      console.error(
        JSON.stringify({ event: 'receipt_health_state_cleanup_failed', status: 'unknown' })
      );
      process.exitCode = 3;
    }
  }
}
