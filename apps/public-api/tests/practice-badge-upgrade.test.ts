import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('schema65->66 receipt upgrade with old open clients and cached saves', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
  let runtime: Pool;
  let app: ReturnType<typeof buildApp>;
  let oldDir: string;
  let role: string;
  let person: string;
  let identity: string;
  let saved: Record<string, unknown>;
  let payload: Record<string, unknown>;
  let pendingId: string;
  const subject = 'U' + 'a'.repeat(32);
  const post = (body: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/line/workspace/save',
      headers: { origin: 'https://checkin.baiyinqigong.org' },
      payload: { idToken: 'synthetic-line-proof', locale: 'zh_TW', ...body }
    });
  beforeAll(async () => {
    db = await createIsolatedTestDatabase(base!);
    oldDir = await mkdtemp(path.join(tmpdir(), 'badge-schema65-'));
    for (const name of await readdir(directory))
      if (/^\d{4}_.+\.sql$/.test(name) && name < '0066_')
        await copyFile(path.join(directory, name), path.join(oldDir, name));
    expect((await runMigrations(db.pool, oldDir)).currentVersion).toBe(
      '0065_whatsapp_venue_authority.sql'
    );
    role = 'badge_upgrade_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await db.pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await db.pool.query(`GRANT qigong_api_runtime TO ${role}`);
    const url = new URL(db.databaseUrl);
    url.username = role;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    const principal = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://badge-upgrade.invalid','reviewer','Synthetic') RETURNING id"
      )
    ).rows[0]!.id;
    const region = (
      await db.pool.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('badge-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'badge-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'badge-operational','operational','地區','Region' FROM c RETURNING id"
      )
    ).rows[0]!.id;
    person = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Synthetic upgrade learner','UTC') RETURNING id"
      )
    ).rows[0]!.id;
    identity = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'line',$2) RETURNING id",
        [person, subject]
      )
    ).rows[0]!.id;
    await db.pool.query(
      "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
      [person, identity]
    );
    await db.pool.query(
      "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-10)",
      [person, region]
    );
    await db.pool.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES('line',$1,'Synthetic','Synthetic','synthetic@example.invalid','+60110000000',$2,'approved',$3,clock_timestamp(),$4)",
      [subject, region, person, principal]
    );
    app = buildApp({
      pool: runtime,
      logger: false,
      line: {
        channelSecret: 'synthetic-line-secret-not-real',
        channelAccessToken: 'synthetic-access-token',
        loginChannelId: '123',
        liffId: '123-synthetic',
        verifyIdToken: async () => subject,
        reply: async () => {}
      }
    });
    const headers = { origin: 'https://checkin.baiyinqigong.org' };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/line/preferences/timezone',
          headers,
          payload: { idToken: 'synthetic-line-proof', locale: 'zh_TW', timezone: 'UTC' }
        })
      ).statusCode
    ).toBe(200);
    const profile = await app.inject({
      method: 'POST',
      url: '/line/workspace/profile',
      headers,
      payload: { idToken: 'synthetic-line-proof', locale: 'zh_TW' }
    });
    payload = {
      requestId: randomUUID(),
      date: profile.json<{ today: string }>().today,
      version: 0,
      methods: ['zhengyang_morning', 'zhengyang_night'],
      lineReceiptMode: 'liff-summary-v1'
    };
    const response = await post(payload);
    expect(response.statusCode, response.body).toBe(200);
    saved = response.json<Record<string, unknown>>();
    expect(saved).toMatchObject({ receiptQueued: true });
    expect(saved).not.toHaveProperty('lineReceipt');
    pendingId = (
      await db.pool.query<{ id: string }>(
        'SELECT id FROM ops.channel_practice_receipts WHERE identity_id=$1',
        [identity]
      )
    ).rows[0]!.id;
    // Synthetic fixture only: represent an award already earned before this deployment.
    await db.pool.query(
      "INSERT INTO core.person_practice_badges(person_id,badge_code,rule_version,period) VALUES($1,'combo_zhengyang_7',1,extract(year FROM $2::date)::int::text) ON CONFLICT DO NOTHING",
      [person, payload.date]
    );
    expect((await runMigrations(db.pool, directory)).applied).toEqual([
      '0066_practice_badge_receipts.sql'
    ]);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await runtime?.end();
    if (role) await db.pool.query(`DROP ROLE ${role}`);
    await db?.dispose();
    if (oldDir) await rm(oldDir, { recursive: true, force: true });
  });
  it('replays the old request exactly without stealing delivery or backfilling its receipt', async () => {
    const response = await post(payload);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual(saved);
    const receipt = (
      await db.pool.query<{ status: string; payload: Record<string, unknown> }>(
        'SELECT status,payload FROM ops.channel_practice_receipts WHERE id=$1',
        [pendingId]
      )
    ).rows[0]!;
    expect(receipt.status).toBe('pending');
    expect(receipt.payload).not.toHaveProperty('unlockedBadges');
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int count FROM ops.channel_practice_receipts WHERE identity_id=$1',
          [identity]
        )
      ).rows[0]
    ).toEqual({ count: 1 });
  });
  it('negotiates a new correction without reannouncing a previously earned badge', async () => {
    const response = await post({ ...payload, requestId: randomUUID(), version: saved.version });
    expect(response.statusCode, response.body).toBe(200);
    const data = response.json<{
      receiptDelivery: string;
      receiptQueued: boolean;
      unlockedBadges: unknown[];
      lineReceipt: { text: string };
    }>();
    expect(data).toMatchObject({
      receiptDelivery: 'liff',
      receiptQueued: false,
      unlockedBadges: []
    });
    expect(data.lineReceipt.text).not.toContain('🎉');
    expect(
      (
        await db.pool.query('SELECT status FROM ops.channel_practice_receipts WHERE id=$1', [
          pendingId
        ])
      ).rows[0]
    ).toEqual({ status: 'pending' });
  });
  it('still rejects a changed fingerprint on the old requestUUID', async () => {
    expect((await post({ ...payload, methods: ['dayan_chu'] })).statusCode).toBe(409);
  });
});
