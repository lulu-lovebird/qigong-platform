import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { runRealtimePracticeReceipts } from '../src/practice-receipt-runtime.js';
import { deliverChannelPracticeReceipts } from '../src/channel-practice-receipts.js';
import {
  waitForReceiptPoll,
  type ReceiptDispatchEvent
} from '../src/practice-receipt-dispatcher.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip;
const migrations = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);
interface Actor {
  person: string;
  identity: string;
  checkin: string;
  subject: string;
}
const until = async (test: () => boolean | Promise<boolean>) => {
  for (let n = 0; n < 250; n++) {
    if (await test()) return;
    await delay(20);
  }
  throw Error('Synthetic receipt synchronization timeout');
};
const fastWait = async (_ms: number, signal: AbortSignal) => {
  try {
    await delay(20, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) throw error;
  }
};
suite('Restricted continuous receipt dispatcher and committed outbox', () => {
  let root: Pool, runtime: Pool, dispose: () => Promise<void>, role: string;
  let runtimeUrl: string;
  const actors = new Map<'line' | 'telegram', Actor>();
  const enqueue = async (
    platform: 'line' | 'telegram',
    count = 1,
    client: Pick<Pool, 'query'> = root
  ) => {
    const actor = actors.get(platform)!,
      ids: string[] = [];
    for (let n = 0; n < count; n++) {
      const id = randomUUID();
      ids.push(id);
      const payload = {
        date: '2026-10-15',
        action: 'regular',
        locale: 'zh_CN',
        methods: ['鶴戲'],
        currentStreak: 3,
        totalDays: 9,
        practiceNote: 'PRIVATE REFLECTION NEVER SEND',
        feelingTags: ['PRIVATE FEELING']
      };
      if (platform === 'line')
        await client.query(
          "INSERT INTO ops.channel_practice_receipts(id,platform,identity_id,person_id,checkin_id,recipient,payload) VALUES($1,'line',$2,$3,$4,$5,$6::jsonb)",
          [id, actor.identity, actor.person, actor.checkin, actor.subject, JSON.stringify(payload)]
        );
      else
        await client.query(
          'INSERT INTO ops.telegram_practice_receipts(id,identity_id,person_id,checkin_id,recipient,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
          [id, actor.identity, actor.person, actor.checkin, actor.subject, JSON.stringify(payload)]
        );
    }
    return ids;
  };
  beforeAll(async () => {
    const database = await createIsolatedTestDatabase(base!);
    root = database.pool;
    dispose = () => database.dispose();
    await runMigrations(root, migrations, 'realtime-receipt-test');
    role = 'qigong_receipt_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_worker_runtime TO ${role}`);
    const url = new URL(database.databaseUrl);
    url.username = role;
    url.password = password;
    runtimeUrl = url.href;
    runtime = new pg.Pool({ connectionString: runtimeUrl, max: 4 });
    const principal = (
      await root.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://receipt.example.invalid','root','Synthetic reviewer') RETURNING id"
      )
    ).rows[0]!.id;
    const region = (
      await root.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('receipt-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'receipt-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'receipt-region','operational','地區','Region' FROM c RETURNING id"
      )
    ).rows[0]!.id;
    for (const platform of ['line', 'telegram'] as const) {
      const subject = platform === 'line' ? 'U' + 'a'.repeat(32) : '548000000074';
      const person = (
        await root.query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Synthetic learner','UTC') RETURNING id"
        )
      ).rows[0]!.id;
      const identity = (
        await root.query<{ id: string }>(
          'INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,$2,$3) RETURNING id',
          [person, platform, subject]
        )
      ).rows[0]!.id;
      await root.query(
        "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,valid_from) VALUES($1,$2,'onboarding',clock_timestamp()-INTERVAL '1 day')",
        [person, identity]
      );
      await root.query(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES($1,$2,'Synthetic learner','Synthetic learner','synthetic@example.invalid','+659900000074',$3,'approved',$4,clock_timestamp(),$5)",
        [platform, subject, region, person, principal]
      );
      const assignment = (
        await root.query<{ id: string }>(
          "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-1) RETURNING id",
          [person, region]
        )
      ).rows[0]!.id;
      const checkin = (
        await root.query<{ id: string }>(
          "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) VALUES($1,$2,CURRENT_DATE,'UTC','regular',$3) RETURNING id",
          [person, identity, assignment]
        )
      ).rows[0]!.id;
      actors.set(platform, { person, identity, checkin, subject });
    }
  });
  beforeEach(async () => {
    await root.query('TRUNCATE ops.channel_practice_receipts,ops.telegram_practice_receipts');
    await root.query('UPDATE identity.platform_identities SET revoked_at=NULL');
    await root.query('UPDATE identity.person_interaction_channels SET valid_to=NULL');
    await root.query(
      "UPDATE core.platform_metadata SET architecture_version='phase-23-admin-achievements'"
    );
  });
  afterAll(async () => {
    await runtime?.end();
    if (role) {
      await root.query(`DROP OWNED BY ${role}`);
      await root.query(`DROP ROLE ${role}`);
    }
    await dispose?.();
  });
  it('drains both channels beyond the former minute batches without exposing feelings or original notes', async () => {
    await enqueue('line', 7);
    await enqueue('telegram', 7);
    const c = new AbortController();
    let line = 0,
      telegram = 0;
    const check = (text: string) => {
      expect(text).toContain('鹤戏');
      expect(text).not.toContain('PRIVATE');
    };
    const stop = () => {
      if (line === 7 && telegram === 7) c.abort();
    };
    const task = runRealtimePracticeReceipts({
      pool: runtime,
      signal: c.signal,
      report: () => {},
      line: async (recipient, text) => {
        expect(recipient).toBe(actors.get('line')!.subject);
        check(text);
        line++;
        stop();
      },
      telegram: async (recipient, text) => {
        expect(recipient).toBe(actors.get('telegram')!.subject);
        check(text);
        telegram++;
        stop();
      }
    });
    try {
      await until(() => line === 7 && telegram === 7);
    } finally {
      c.abort();
      await task;
    }
    expect(
      (
        await root.query(
          "SELECT count(*)::int n FROM ops.channel_practice_receipts WHERE status='delivered'"
        )
      ).rows[0]!.n
    ).toBe(7);
    expect(
      (
        await root.query(
          "SELECT count(*)::int n FROM ops.telegram_practice_receipts WHERE status='delivered'"
        )
      ).rows[0]!.n
    ).toBe(7);
  });
  it('cannot see an uncommitted enqueue, then delivers it on a subsequent poll after commit', async () => {
    const client = await root.connect(),
      c = new AbortController(),
      sender = vi.fn(async () => {});
    let polls = 0;
    await client.query('BEGIN');
    await enqueue('line', 1, client);
    const task = runRealtimePracticeReceipts({
      pool: runtime,
      signal: c.signal,
      report: () => {},
      line: sender,
      telegram: async () => {},
      wait: async (ms, signal) => {
        expect(ms).toBe(1000);
        polls++;
        await fastWait(ms, signal);
      }
    });
    try {
      await until(() => polls >= 2);
      expect(sender).not.toHaveBeenCalled();
      await client.query('COMMIT');
      await until(() => sender.mock.calls.length === 1);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      c.abort();
      await task;
    }
    expect(sender).toHaveBeenCalledOnce();
  });
  it('detects an enqueue arriving while idle with the actual one-second polling interval', async () => {
    const c = new AbortController();
    let idle = false,
      sends = 0;
    const pauses: number[] = [];
    const task = runRealtimePracticeReceipts({
      pool: runtime,
      signal: c.signal,
      report: () => {},
      telegram: async () => {},
      line: async () => {
        sends++;
        c.abort();
      },
      wait: async (ms, signal) => {
        pauses.push(ms);
        idle = true;
        await waitForReceiptPoll(ms, signal);
      }
    });
    try {
      await until(() => idle);
      await enqueue('line');
      await until(() => sends === 1);
    } finally {
      c.abort();
      await task;
    }
    expect(sends).toBe(1);
    expect(pauses.every((ms) => ms === 1000)).toBe(true);
  });
  it('never sends an enqueue that rolls back', async () => {
    const client = await root.connect(),
      c = new AbortController(),
      sender = vi.fn(async () => {});
    let polls = 0;
    await client.query('BEGIN');
    await enqueue('line', 1, client);
    const task = runRealtimePracticeReceipts({
      pool: runtime,
      signal: c.signal,
      report: () => {},
      line: sender,
      telegram: async () => {},
      wait: async (ms, signal) => {
        polls++;
        await fastWait(ms, signal);
      }
    });
    try {
      await until(() => polls >= 2);
      await client.query('ROLLBACK');
      const after = polls;
      await until(() => polls >= after + 3);
      expect(sender).not.toHaveBeenCalled();
    } finally {
      await client.query('ROLLBACK');
      client.release();
      c.abort();
      await task;
    }
  });
  it('coordinates concurrent realtime/fallback claims through the existing leases', async () => {
    const ids = await enqueue('line', 10),
      seen: string[] = [],
      c = new AbortController();
    const sender = async (_recipient: string, _text: string, id: string) => {
      seen.push(id);
      if (seen.length === 10) c.abort();
    };
    const task = runRealtimePracticeReceipts({
      pool: runtime,
      signal: c.signal,
      report: () => {},
      line: sender,
      telegram: async () => {},
      wait: fastWait
    });
    try {
      await Promise.all([
        deliverChannelPracticeReceipts(runtime, 'line', sender, () => {}, 3),
        deliverChannelPracticeReceipts(runtime, 'line', sender, () => {}, 3)
      ]);
      await until(() => seen.length === 10);
    } finally {
      c.abort();
      await task;
    }
    expect(new Set(seen).size).toBe(10);
    expect([...seen].sort()).toEqual(ids.sort());
  });
  it('rechecks current eligibility before each claimed send', async () => {
    await enqueue('line', 3);
    const c = new AbortController();
    let sends = 0;
    const task = runRealtimePracticeReceipts({
      pool: runtime,
      signal: c.signal,
      report: () => {},
      telegram: async () => {},
      line: async () => {
        sends++;
        await root.query(
          'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE platform_identity_id=$1',
          [actors.get('line')!.identity]
        );
        await root.query(
          'UPDATE identity.platform_identities SET revoked_at=clock_timestamp() WHERE id=$1',
          [actors.get('line')!.identity]
        );
        c.abort();
      }
    });
    try {
      await until(() => sends >= 1);
    } finally {
      c.abort();
      await task;
    }
    expect(sends).toBe(1);
  });
  it('drains an in-flight network call on shutdown before marking the lease delivered', async () => {
    await enqueue('line');
    const c = new AbortController();
    let entered = false,
      finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let ended = false;
    const task = runRealtimePracticeReceipts({
      pool: runtime,
      signal: c.signal,
      report: () => {},
      telegram: async () => {},
      line: async () => {
        entered = true;
        await pending;
      }
    }).then(() => {
      ended = true;
    });
    try {
      await until(() => entered);
      c.abort();
      await delay(30);
      expect(ended).toBe(false);
      finish();
      await task;
      expect(
        (await root.query('SELECT status FROM ops.channel_practice_receipts')).rows[0]!.status
      ).toBe('delivered');
    } finally {
      c.abort();
      finish?.();
      await task;
    }
  });
  it('retains persisted retry/backoff and the same LINE retry key without logging provider diagnostics', async () => {
    const [id] = await enqueue('line'),
      c = new AbortController(),
      events: ReceiptDispatchEvent[] = [],
      attempts: string[] = [];
    let succeed = false;
    const task = runRealtimePracticeReceipts({
      pool: runtime,
      signal: c.signal,
      report: (event) => events.push(event),
      wait: fastWait,
      telegram: async () => {},
      line: async (_recipient, _text, key) => {
        attempts.push(key);
        if (!succeed) throw Error('PRIVATE TOKEN');
      }
    });
    try {
      await until(
        async () =>
          (
            await root.query(
              "SELECT count(*)::int n FROM ops.channel_practice_receipts WHERE status='pending' AND attempts=1"
            )
          ).rows[0]!.n === 1
      );
      await delay(100);
      expect(attempts).toEqual([id]);
      succeed = true;
      await root.query(
        "UPDATE ops.channel_practice_receipts SET available_at=clock_timestamp()-INTERVAL '1 second'"
      );
      await until(
        async () =>
          (
            await root.query(
              "SELECT count(*)::int n FROM ops.channel_practice_receipts WHERE status='delivered'"
            )
          ).rows[0]!.n === 1
      );
    } finally {
      c.abort();
      await task;
    }
    expect(attempts).toEqual([id, id]);
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
    expect(
      (await root.query('SELECT attempts FROM ops.channel_practice_receipts')).rows[0]!.attempts
    ).toBe(2);
  });
  it('rechecks schema between batches and leaves later work unclaimed after incompatibility', async () => {
    await enqueue('line', 4);
    const c = new AbortController();
    let sends = 0;
    try {
      const result = await runRealtimePracticeReceipts({
        pool: runtime,
        signal: c.signal,
        report: () => {},
        telegram: async () => {},
        line: async () => {
          sends++;
          if (sends === 3)
            await root.query(
              "UPDATE core.platform_metadata SET architecture_version='synthetic-incompatible'"
            );
        }
      });
      expect(result.schemaMismatch).toBe(true);
      expect(sends).toBe(3);
      expect(
        (
          await root.query(
            "SELECT count(*)::int n FROM ops.channel_practice_receipts WHERE status='pending' AND attempts=0"
          )
        ).rows[0]!.n
      ).toBe(1);
    } finally {
      c.abort();
      await root.query(
        "UPDATE core.platform_metadata SET architecture_version='phase-23-admin-achievements'"
      );
    }
  });
  it('runs the compiled service through a symlink and exits cleanly on SIGTERM without provider access', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'qigong-receipt-entry-')),
      entry = path.join(directory, 'worker.mjs');
    await symlink(
      fileURLToPath(new URL('../dist/practice-receipt-worker.js', import.meta.url)),
      entry
    );
    const preload =
      'data:text/javascript,' +
      encodeURIComponent(
        "globalThis.fetch=async()=>{throw Error('External transport forbidden in synthetic service test')}"
      );
    const child = spawn(process.execPath, ['--import', preload, entry], {
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: runtimeUrl,
        PRACTICE_RECEIPTS_REALTIME_ENABLED: 'true',
        TELEGRAM_ONBOARDING_BOT_TOKEN: '123456:' + 'a'.repeat(35),
        LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-no-provider-token'
      }
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    let diagnostic = '';
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostic += chunk.toString('utf8');
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    try {
      await until(() => output.includes('practice_receipt_worker_started'));
      child.kill('SIGTERM');
      expect(await exited).toBe(0);
      expect(output).toContain('practice_receipt_worker_stopped');
      expect(diagnostic).toBe('');
      expect(output).not.toContain('synthetic-no-provider-token');
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await exited;
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('stops without sending on a changed schema and cannot read receipt tables directly as the runtime role', async () => {
    await enqueue('line');
    await root.query(
      "UPDATE core.platform_metadata SET architecture_version='synthetic-incompatible'"
    );
    const c = new AbortController(),
      sender = vi.fn(async () => {});
    try {
      expect(
        await runRealtimePracticeReceipts({
          pool: runtime,
          signal: c.signal,
          report: () => {},
          telegram: sender,
          line: sender
        })
      ).toEqual({ schemaMismatch: true });
      expect(sender).not.toHaveBeenCalled();
      await expect(runtime.query('SELECT * FROM ops.channel_practice_receipts')).rejects.toThrow(
        'permission denied'
      );
    } finally {
      await root.query(
        "UPDATE core.platform_metadata SET architecture_version='phase-23-admin-achievements'"
      );
    }
  });
});
