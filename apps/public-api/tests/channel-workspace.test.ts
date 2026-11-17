import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
import {
  deliverChannelPracticeReceipts,
  createLinePracticeSender
} from '../src/channel-practice-receipts.js';
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const headers = { origin: 'https://checkin.baiyinqigong.org', 'content-type': 'application/json' };
interface Profile {
  today: string;
  entries: { id: string; version: number; practiceNote: string; methods: { code: string }[] }[];
  confirmed: boolean;
  totalDays: number;
}
suite('LINE workspace HTTP and private summaries', () => {
  let root: Pool;
  let runtime: Pool;
  let dispose: () => Promise<void>;
  let role: string;
  let region: string;
  let principal: string;
  let app: FastifyInstance;
  let person: string;
  let identity: string;
  let subject: string;
  let counter = 700000;
  const post = (path: string, payload: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: path,
      headers,
      payload: { idToken: 'verified-line-token', locale: 'zh_TW', ...payload }
    });
  const profile = async () => {
    const response = await post('/line/workspace/profile');
    expect(response.statusCode).toBe(200);
    return response.json<Profile>();
  };
  const confirm = async () => {
    const response = await post('/line/preferences/timezone', { timezone: 'UTC' });
    expect(response.statusCode).toBe(200);
  };
  beforeAll(async () => {
    const database = await createIsolatedTestDatabase(url!);
    root = database.pool;
    dispose = () => database.dispose();
    await runMigrations(root, directory, 'http-workspace');
    role = 'qigong_workspace_http_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_api_runtime,qigong_worker_runtime TO ${role}`);
    const connection = new URL(database.databaseUrl);
    connection.username = role;
    connection.password = password;
    runtime = new pg.Pool({ connectionString: connection.href });
    principal = (
      await root.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://workspace-http.test','root','Root') RETURNING id"
      )
    ).rows[0]!.id;
    const global = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('global-workspace-http','global','全球','Global') RETURNING id"
      )
    ).rows[0]!.id;
    const country = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'country-workspace-http','country','國家','Country') RETURNING id",
        [global]
      )
    ).rows[0]!.id;
    region = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'tw-general','operational','地區','Region') RETURNING id",
        [country]
      )
    ).rows[0]!.id;
  });
  beforeEach(async () => {
    subject = 'U' + (++counter).toString(16).padStart(32, '0');
    person = (
      await root.query<{ id: string }>(
        "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Confidential learner','UTC') RETURNING id"
      )
    ).rows[0]!.id;
    identity = (
      await root.query<{ id: string }>(
        "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'line',$2) RETURNING id",
        [person, subject]
      )
    ).rows[0]!.id;
    await root.query(
      "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
      [person, identity]
    );
    await root.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES('line',$1,'Learner','Learner','private@example.test','+886912345600',$2,'approved',$3,CURRENT_TIMESTAMP,$4)",
      [subject, region, person, principal]
    );
    await root.query(
      "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-30)",
      [person, region]
    );

    app = buildApp({
      pool: runtime,
      logger: false,
      adminAuth: {
        callbackUrl: 'https://checkin.baiyinqigong.org/admin/auth/callback',
        begin: async (_v, state) => new URL('https://login.test/?state=' + state),
        complete: async () => ({ iss: 'https://workspace-http.test', sub: 'root' })
      },
      line: {
        channelSecret: 'line-workspace-secret-32-characters',
        channelAccessToken: 'fake-line-channel-token',
        loginChannelId: '123456',
        liffId: '123456-test',
        reply: async () => {},
        verifyIdToken: async (value) => {
          if (value !== 'verified-line-token') throw Error('Invalid LINE token');
          return subject;
        }
      }
    });
    await root.query('DELETE FROM admin.role_grants WHERE principal_id=$1', [principal]);
    await root.query(
      "UPDATE ops.channel_practice_receipts SET status='cancelled',lease_id=NULL,leased_until=NULL WHERE status IN ('pending','sending')"
    );
  });
  afterEach(async () => {
    await app?.close();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await runtime?.end();
    if (role && runtime) {
      await root.query(`DROP OWNED BY ${role}`);
      await root.query(`DROP ROLE ${role}`);
    }
    await dispose?.();
  });

  it('serves all six LIFF views in Traditional Chinese without Telegram SDK or credentials in URLs', async () => {
    for (const path of [
      '/line/',
      '/line/checkin',
      '/line/leaderboard',
      '/line/method-analysis',
      '/line/achievements',
      '/line/journal'
    ]) {
      const page = await app.inject(path);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('static.line-scdn.net');
      expect(page.body).not.toContain('telegram.org');
      expect(page.body).toContain('<html lang="zh-Hant">');
    }
  });
  it('authenticates every JSON request, supports reports and rejects browser IDs and recipient injection', async () => {
    expect((await post('/line/workspace/profile', { idToken: 'fake' })).statusCode).toBe(401);
    expect((await post('/line/workspace/profile', { userId: subject })).statusCode).toBe(400);
    expect((await post('/line/workspace/save', { recipient: subject })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/line/workspace/profile',
          payload: { idToken: 'verified-line-token' }
        })
      ).statusCode
    ).toBe(403);
    for (const view of ['leaderboard', 'methods', 'achievements', 'history'])
      expect(
        (
          await post('/line/workspace/report', {
            view,
            ...(view === 'history' ? { month: (await profile()).today.slice(0, 7) } : {})
          })
        ).statusCode
      ).toBe(200);
    const legacy = await post('/line/workspace/report', { view: 'achievements', locale: 'zh_CN' });
    expect(legacy.statusCode).toBe(200);
    const data = legacy.json<{ badges: { code: string; name: string; displayName?: string }[] }>();
    expect(data.badges.filter((b) => b.displayName)).toHaveLength(49);
    expect(data.badges.find((b) => b.code === 'method_dayan_100')).toMatchObject({
      name: '大雁功 100 天',
      displayName: '大雁功｜雁归太和'
    });
  });
  it('saves with idempotent UUID/version protection, displays own sharing, and queues a private summary', async () => {
    await confirm();
    const requestId = randomUUID(),
      payload = {
        requestId,
        date: (await profile()).today,
        version: 0,
        methods: ['dayan_chu'],
        practiceNote: 'Must not enter LINE chat',
        feelingTagIds: []
      };
    const saved = await post('/line/workspace/save', payload);
    expect(saved.statusCode).toBe(200);
    expect((await post('/line/workspace/save', payload)).json()).toEqual(saved.json());
    expect(
      (await post('/line/workspace/save', { ...payload, requestId: randomUUID() })).statusCode
    ).toBe(409);
    expect((await post('/line/journal/own', { page: 1 })).statusCode).toBe(200);
    const sender = vi.fn(async (recipient: string, text: string, id: string) => {
      expect(recipient).toBe(subject);
      expect(text).toContain('打卡成功');
      expect(text).not.toContain('Must not enter');
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });
    expect(await deliverChannelPracticeReceipts(runtime, 'line', sender, () => {}, 3)).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    'returns an atomic Zhengyang combo snapshot without LINE Push when LIFF owns delivery (versioned=%s)',
    async (versioned) => {
      await root.query('UPDATE ops.versioned_achievement_control SET enabled=$1', [versioned]);
      try {
        await confirm();
        const payload = {
          requestId: randomUUID(),
          date: (await profile()).today,
          version: 0,
          methods: ['zhengyang_morning', 'zhengyang_night'],
          practiceNote: 'private-zhengyang-note',
          feelingTagIds: [],
          lineReceiptMode: 'liff-summary-v1'
        };
        const saved = await post('/line/workspace/save', payload);
        expect(saved.statusCode, saved.body).toBe(200);
        const result = saved.json<{
          version: number;
          receiptQueued: boolean;
          receiptDelivery: string;
          unlockedBadges: { code: string; period: string; ruleVersion: number }[];
          lineReceipt: { id: string; text: string };
        }>();
        expect(result.receiptDelivery).toBe('liff');
        expect(result.receiptQueued).toBe(false);
        expect(
          result.unlockedBadges.some((b) => b.code === 'combo_zhengyang_7' && b.ruleVersion === 1)
        ).toBe(true);
        expect(result.lineReceipt.text).toContain('正陽雙照');
        expect(result.lineReceipt.text).toContain('晨功');
        expect(result.lineReceipt.text).toContain('夜功');
        expect(result.lineReceipt.text).not.toContain('private-zhengyang-note');
        expect(
          (
            await root.query(
              "SELECT status,payload ? '_saveNonce' nonce FROM ops.channel_practice_receipts WHERE id=$1",
              [result.lineReceipt.id]
            )
          ).rows[0]
        ).toEqual({ status: 'cancelled', nonce: false });
        const sender = vi.fn(async () => {});
        expect(await deliverChannelPracticeReceipts(runtime, 'line', sender, () => {}, 3)).toBe(0);
        expect(sender).not.toHaveBeenCalled();
        expect((await post('/line/workspace/save', payload)).json()).toEqual(saved.json());
        expect(
          (await post('/line/workspace/save', { ...payload, methods: ['dayan_chu'] })).statusCode
        ).toBe(409);
        expect(
          (
            await root.query(
              'SELECT count(*)::int count FROM ops.channel_practice_receipts WHERE identity_id=$1',
              [identity]
            )
          ).rows[0]
        ).toEqual({ count: 1 });
      } finally {
        await root.query('UPDATE ops.versioned_achievement_control SET enabled=FALSE');
      }
    }
  );
  it('includes a newly earned combo on a valid makeup date using the learner timezone', async () => {
    const zone = (
      await root.query<{ name: string }>(
        "SELECT name FROM (VALUES('UTC'),('Etc/GMT+6'),('Etc/GMT+12'),('Etc/GMT-6')) z(name) WHERE (clock_timestamp() AT TIME ZONE name)::time<TIME '12:00' ORDER BY (clock_timestamp() AT TIME ZONE name)::time LIMIT 1"
      )
    ).rows[0]!.name;
    expect((await post('/line/preferences/timezone', { timezone: zone })).statusCode).toBe(200);
    const today = (await profile()).today;
    const date = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    const response = await post('/line/workspace/save', {
      requestId: randomUUID(),
      date,
      version: 0,
      methods: ['zhengyang_morning', 'zhengyang_night'],
      lineReceiptMode: 'liff-summary-v1'
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response
        .json<{ unlockedBadges: { code: string }[] }>()
        .unlockedBadges.some((b) => b.code === 'combo_zhengyang_7')
    ).toBe(true);
    expect(response.json<{ action: string; lineReceipt: { text: string } }>().action).toBe(
      'makeup'
    );
    expect(response.json<{ lineReceipt: { text: string } }>().lineReceipt.text).toContain(
      '補登成功'
    );
  });
  it('gives an old open LINE page one Bot summary with badges, without duplicate top-level LIFF data', async () => {
    await confirm();
    const saved = await post('/line/workspace/save', {
      requestId: randomUUID(),
      date: (await profile()).today,
      version: 0,
      methods: ['zhengyang_morning', 'zhengyang_night']
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).not.toHaveProperty('unlockedBadges');
    expect(saved.json()).not.toHaveProperty('lineReceipt');
    const sender = vi.fn(async (_recipient: string, text: string) => {
      expect(text).toContain('正陽雙照');
    });
    expect(await deliverChannelPracticeReceipts(runtime, 'line', sender, () => {}, 3)).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);
  });
  it('preserves the first delivery owner across a requestUUID replay with a different client capability', async () => {
    await confirm();
    const request = {
      requestId: randomUUID(),
      date: (await profile()).today,
      version: 0,
      methods: ['zhengyang_morning', 'zhengyang_night']
    };
    const first = await post('/line/workspace/save', request);
    expect(first.statusCode).toBe(200);
    const replay = await post('/line/workspace/save', {
      ...request,
      lineReceiptMode: 'liff-summary-v1'
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ receiptDelivery: 'bot', receiptQueued: true });
    expect(replay.json()).not.toHaveProperty('lineReceipt');
    expect(
      (
        await root.query(
          'SELECT count(*)::int count FROM ops.channel_practice_receipts WHERE identity_id=$1',
          [identity]
        )
      ).rows[0]
    ).toEqual({ count: 1 });
  });
  it('does not transfer a cached LIFF-owned receipt back to Bot delivery for an old-client replay', async () => {
    await confirm();
    const request = {
      requestId: randomUUID(),
      date: (await profile()).today,
      version: 0,
      methods: ['zhengyang_morning', 'zhengyang_night']
    };
    const first = await post('/line/workspace/save', {
      ...request,
      lineReceiptMode: 'liff-summary-v1'
    });
    expect(first.statusCode, first.body).toBe(200);
    const replay = await post('/line/workspace/save', request);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({ receiptDelivery: 'liff', receiptQueued: false });
    expect(replay.json()).not.toHaveProperty('lineReceipt');
    expect(replay.json()).not.toHaveProperty('unlockedBadges');
    expect(
      (
        await root.query('SELECT status FROM ops.channel_practice_receipts WHERE identity_id=$1', [
          identity
        ])
      ).rows
    ).toEqual([{ status: 'cancelled' }]);
  });
  it('does not announce the same badge on a no-new-award correction and treats restoration as a new active award', async () => {
    await confirm();
    const date = (await profile()).today;
    const save = async (version: number, methods: string[]) =>
      post('/line/workspace/save', {
        requestId: randomUUID(),
        date,
        version,
        methods,
        lineReceiptMode: 'liff-summary-v1'
      });
    const first = await save(0, ['zhengyang_morning', 'zhengyang_night']);
    expect(first.statusCode, first.body).toBe(200);
    const repeat = await save(first.json<{ version: number }>().version, [
      'zhengyang_morning',
      'zhengyang_night'
    ]);
    expect(repeat.statusCode, repeat.body).toBe(200);
    expect(repeat.json<{ unlockedBadges: unknown[] }>().unlockedBadges).toEqual([]);
    const removed = await save(repeat.json<{ version: number }>().version, ['zhengyang_morning']);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json<{ unlockedBadges: unknown[] }>().unlockedBadges).toEqual([]);
    const restored = await save(removed.json<{ version: number }>().version, [
      'zhengyang_morning',
      'zhengyang_night'
    ]);
    expect(restored.statusCode, restored.body).toBe(200);
    expect(
      restored
        .json<{ unlockedBadges: { code: string }[] }>()
        .unlockedBadges.some((b) => b.code === 'combo_zhengyang_7')
    ).toBe(true);
  });
  it('distinguishes award rule versions and periods in the private delta key', async () => {
    await root.query(
      "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'combo_zhengyang_7','2026',1)",
      [person]
    );
    const before = (
      await root.query<{ data: unknown }>('SELECT core._practice_receipt_badge_keys($1) data', [
        person
      ])
    ).rows[0]!.data;
    await root.query(
      "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'combo_zhengyang_7','2025',1),($1,'combo_zhengyang_7','2026',2)",
      [person]
    );
    const after = (
      await root.query<{ data: { period: string; ruleVersion: number }[] }>(
        'SELECT core._practice_receipt_new_badges($1,$2,$3) data',
        [person, JSON.stringify(before), 'zh_TW']
      )
    ).rows[0]!.data;
    expect(after.map((b) => [b.period, b.ruleVersion])).toEqual([
      ['2025', 1],
      ['2026', 2]
    ]);
  });
  it('serializes duplicate saveUUID requests into one persisted snapshot and receipt', async () => {
    await confirm();
    const payload = {
      requestId: randomUUID(),
      date: (await profile()).today,
      version: 0,
      methods: ['zhengyang_morning', 'zhengyang_night'],
      lineReceiptMode: 'liff-summary-v1'
    };
    const [a, b] = await Promise.all([
      post('/line/workspace/save', payload),
      post('/line/workspace/save', payload)
    ]);
    expect(a.statusCode, a.body).toBe(200);
    expect(b.statusCode, b.body).toBe(200);
    expect(a.json()).toEqual(b.json());
    expect(
      (
        await root.query(
          'SELECT count(*)::int count FROM ops.channel_practice_receipts WHERE identity_id=$1',
          [identity]
        )
      ).rows[0]
    ).toEqual({ count: 1 });
  });
  it('restores receipt correlation, community notice and evaluator-cause settings inside a pooled transaction', async () => {
    await confirm();
    const date = (await profile()).today;
    await withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID() },
      async (c) => {
        await c.query(
          "SELECT set_config('qigong.community_notice','old-notice',TRUE),set_config('qigong.practice_save_nonce','old-nonce',TRUE),set_config('qigong.achievement_cause','explicit_evaluation',TRUE),set_config('qigong.line_receipt_mode','liff-summary-v1',TRUE)"
        );
        await c.query('SELECT platform.community_workspace_save($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
          'line',
          subject,
          randomUUID(),
          date,
          0,
          ['zhengyang_morning', 'zhengyang_night'],
          null,
          null,
          null
        ]);
        expect(
          (
            await c.query(
              "SELECT current_setting('qigong.community_notice',TRUE) notice,current_setting('qigong.practice_save_nonce',TRUE) nonce,current_setting('qigong.achievement_cause',TRUE) cause"
            )
          ).rows[0]
        ).toEqual({ notice: 'old-notice', nonce: 'old-nonce', cause: 'explicit_evaluation' });
      }
    );
  });
  it('rolls back award evaluation and receipt snapshots when the actual save fails', async () => {
    await confirm();
    const before = (
      await root.query(
        'SELECT count(*)::int count FROM core.person_practice_badges WHERE person_id=$1',
        [person]
      )
    ).rows;
    const response = await post('/line/workspace/save', {
      requestId: randomUUID(),
      date: (await profile()).today,
      version: 0,
      methods: ['not_a_method'],
      lineReceiptMode: 'liff-summary-v1'
    });
    expect(response.statusCode).toBe(409);
    expect(
      (
        await root.query(
          'SELECT count(*)::int count FROM core.person_practice_badges WHERE person_id=$1',
          [person]
        )
      ).rows
    ).toEqual(before);
    expect(
      (
        await root.query(
          'SELECT count(*)::int count FROM ops.channel_practice_receipts WHERE identity_id=$1',
          [identity]
        )
      ).rows[0]
    ).toEqual({ count: 0 });
    await expect(
      withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (c) =>
        c.query('SELECT ops._evaluate_achievement_person($1,TRUE)', [person])
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (c) =>
        c.query('SELECT core._practice_receipt_badge_keys($1)', [person])
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (c) =>
        c.query("SELECT core._practice_receipt_new_badges($1,'[]'::jsonb,'zh_TW')", [person])
      )
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('saves a disclosed LINE reflection atomically into the student stream, with no sharing checkbox or external enablement', async () => {
    await confirm();
    const date = (await profile()).today;
    const payload = {
      requestId: randomUUID(),
      date,
      version: 0,
      methods: ['dayan_chu'],
      practiceNote: 'LINE community reflection',
      feelingTagIds: [],
      communityNotice: 'student-community-notes-v1'
    };
    const saved = await post('/line/workspace/save', payload);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ communityShared: true, communitySharing: 'automatic' });
    const stream = await post('/line/journal/feed', { cursor: null });
    expect(stream.statusCode, stream.body).toBe(200);
    expect(
      stream
        .json<{ entries: Array<{ practiceNote: string }> }>()
        .entries.some((e) => e.practiceNote === 'LINE community reflection')
    ).toBe(true);
    const row = (
      await root.query(
        'SELECT active,external_enabled FROM core.journal_publications WHERE checkin_id=$1',
        [saved.json<{ checkinId: string }>().checkinId]
      )
    ).rows[0]!;
    expect(row).toEqual({ active: true, external_enabled: false });
    expect(
      (await post('/line/workspace/save', { ...payload, communityNotice: 'invalid-version' }))
        .statusCode
    ).toBe(400);
    expect(
      (await post('/line/workspace/save', { ...payload, externalEnabled: true })).statusCode
    ).toBe(400);
    const html = (await app.inject('/line/checkin')).body;
    expect(html).toContain('打卡心得供所有學員閱讀');
    expect(html).not.toMatch(/type="checkbox"[^>]*(?:share|community)/);
  });
  it('persists only a verified LINE subject language and rejects Origin, browser-subject and unknown-locale injection', async () => {
    expect((await post('/line/preferences/language', { locale: 'en' })).statusCode).toBe(200);
    const read = () =>
      app.inject({
        method: 'POST',
        url: '/line/preferences/language',
        headers,
        payload: { idToken: 'verified-line-token' }
      });
    expect((await read()).json()).toMatchObject({ locale: 'en' });
    expect(
      (await post('/line/preferences/language', { locale: 'zh_CN', userId: 'U' + 'f'.repeat(32) }))
        .statusCode
    ).toBe(400);
    expect((await post('/line/preferences/language', { locale: 'zh_SG' })).statusCode).toBe(400);
    expect(
      (await post('/line/preferences/language', { locale: 'zh_CN', idToken: 'fake' })).statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/line/preferences/language',
          headers: { ...headers, origin: 'https://outside.example.invalid' },
          payload: { idToken: 'verified-line-token', locale: 'zh_CN' }
        })
      ).statusCode
    ).toBe(403);
    expect((await read()).json()).toMatchObject({ locale: 'en' });
    const selected = await post('/line/preferences/language', { locale: 'zh_CN' });
    expect(selected.statusCode, selected.body).toBe(200);
    expect((await read()).json()).toMatchObject({ locale: 'zh_CN' });
    const stored = (
      await root.query(
        'SELECT locale FROM platform.identity_preferences WHERE platform=$1 AND external_subject_id=$2',
        ['line', subject]
      )
    ).rows[0];
    expect(stored).toEqual({ locale: 'zh_CN' });
    const cookie = Array.isArray(selected.headers['set-cookie'])
      ? selected.headers['set-cookie'].join(';')
      : selected.headers['set-cookie'];
    expect(cookie).toContain('__Host-qigong-learner-locale=zh_CN');
    expect(
      (await app.inject({ url: '/line/checkin', headers: { cookie: String(cookie) } })).body
    ).toContain('<html lang="zh-Hans">');
    expect((await app.inject('/line/checkin?lang=en')).body).toContain('<html lang="en">');
  });
  it('renders live Simplified labels but preserves verified names, reflection text and private receipt boundaries', async () => {
    await confirm();
    await post('/line/preferences/language', { locale: 'zh_CN' });
    await withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (client) =>
      client.query('SELECT platform.refresh_verified_line_profile($1,$2)', [subject, '已儲存'])
    );
    const methods = await post('/line/workspace/profile', { locale: 'zh_CN' });
    expect(methods.statusCode, methods.body).toBe(200);
    expect(
      methods
        .json<{ methods: { code: string; name: string }[] }>()
        .methods.find((m) => m.code === 'wuqinxi_he')?.name
    ).toBe('鹤戏');
    const english = await post('/line/workspace/profile', { locale: 'en' });
    expect(english.statusCode, english.body).toBe(200);
    expect(
      english
        .json<{ methods: { code: string; name: string }[] }>()
        .methods.find((m) => m.code === 'wuqinxi_he')?.name
    ).toBe('Crane Form');
    const traditional = await post('/line/workspace/profile', { locale: 'zh_TW' });
    expect(traditional.statusCode, traditional.body).toBe(200);
    expect(
      traditional
        .json<{ methods: { code: string; name: string }[] }>()
        .methods.find((m) => m.code === 'wuqinxi_he')?.name
    ).toBe('鶴戲');
    const saved = await post('/line/workspace/save', {
      locale: 'zh_CN',
      requestId: randomUUID(),
      date: (await profile()).today,
      version: 0,
      methods: ['wuqinxi_he'],
      practiceNote: '練功打卡',
      feelingTagIds: [],
      communityNotice: 'student-community-notes-v1'
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const stream = await post('/line/journal/feed', { locale: 'zh_CN', cursor: null });
    expect(stream.statusCode, stream.body).toBe(200);
    expect(
      stream.json<{ entries: { alias: string; practiceNote: string }[] }>().entries
    ).toContainEqual(expect.objectContaining({ alias: '已儲存', practiceNote: '練功打卡' }));
    const sender = vi.fn(async (recipient: string, text: string) => {
      expect(recipient).toBe(subject);
      expect(text).toContain('总打卡天数');
      expect(text).toContain('鹤戏');
      expect(text).not.toContain('練功打卡');
    });
    expect(await deliverChannelPracticeReceipts(runtime, 'line', sender, () => {}, 3)).toBe(1);
    expect(sender).toHaveBeenCalledOnce();
  });
  it('uses fixed recipient and stable retry key and sanitizes transport errors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const id = randomUUID();
    await createLinePracticeSender('private-provider-token')(subject, 'Safe summary', id);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Line-Retry-Key': id });
    const body = fetch.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw Error('Expected JSON body');
    expect(JSON.parse(body)).toMatchObject({ to: subject });
    fetch.mockResolvedValueOnce(
      new Response('{}', { status: 409, headers: { 'x-line-accepted-request-id': randomUUID() } })
    );
    await createLinePracticeSender('private-provider-token')(subject, 'Safe summary', id);
    fetch.mockRejectedValueOnce(Error('private-provider-token'));
    await expect(
      createLinePracticeSender('private-provider-token')(subject, 'Safe', id)
    ).rejects.toThrow('LINE practice delivery failed');
  });
});
