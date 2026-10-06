import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations, type Pool } from '@qigong/database';
import { buildApp } from '../src/app.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);

describeWithDatabase('separate Telegram onboarding webhook', () => {
  let pool: Pool;
  let runtimePool: Pool;
  let loginRole: string;
  let databaseName: string;
  let regionId: string;
  const sendMessage = vi.fn(async (chatId: number, text: string) => {
    expect(chatId).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
  });
  const secret = 'new_platform_telegram_onboarding_secret';
  const update = (id: number, userId: number, chatType = 'private', text = '/start') => ({
    update_id: id,
    message: {
      chat: { id: userId, type: chatType },
      from: { id: userId, first_name: 'Test Learner' },
      text
    }
  });

  beforeAll(async () => {
    const maintenance = new pg.Client({ connectionString: databaseUrl });
    await maintenance.connect();
    databaseName = `qigong_telegram_test_${randomUUID().replaceAll('-', '')}`;
    await maintenance.query(`CREATE DATABASE ${databaseName}`);
    await maintenance.end();
    const url = new URL(databaseUrl!);
    url.pathname = `/${databaseName}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    await runMigrations(pool, migrationsDirectory, 'vitest');
    loginRole = `qigong_telegram_${randomUUID().replaceAll('-', '')}`;
    const password = randomUUID().replaceAll('-', '');
    await pool.query(`CREATE ROLE ${loginRole} LOGIN PASSWORD '${password}' NOINHERIT NOBYPASSRLS`);
    await pool.query(`GRANT qigong_api_runtime TO ${loginRole}`);
    url.username = loginRole;
    url.password = password;
    runtimePool = new pg.Pool({ connectionString: url.toString() });
    const global = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (code, region_type, name_zh_tw, name_en)
       VALUES ('telegram-global', 'global', '全球', 'Global') RETURNING id`
    );
    const country = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       VALUES ($1, 'telegram-country', 'country', '台灣', 'Taiwan') RETURNING id`,
      [global.rows[0]!.id]
    );
    const region = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       VALUES ($1, 'tw-general', 'operational', '測試地區', 'Pilot') RETURNING id`,
      [country.rows[0]!.id]
    );
    regionId = region.rows[0]!.id;
    const otherCountries = [
      ['my', 'Malaysia', '馬來西亞'],
      ['sg', 'Singapore', '新加坡'],
      ['hk', 'Hong Kong', '香港'],
      ['other', 'Other', '其它']
    ];
    for (const [code, nameEn, nameZh] of otherCountries) {
      await pool.query(
        `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
         VALUES ($1, $2, 'country', $3, $4)`,
        [global.rows[0]!.id, code, nameZh, nameEn]
      );
    }
    await pool.query(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       SELECT id, code || '-general', 'operational', name_zh_tw || '地區', name_en || ' Region'
       FROM core.regions WHERE code IN ('my', 'sg', 'hk', 'other')`
    );
  });

  afterAll(async () => {
    await runtimePool.end();
    await pool.query(`DROP OWNED BY ${loginRole}`);
    await pool.query(`DROP ROLE ${loginRole}`);
    await pool.end();
    const maintenance = new pg.Client({ connectionString: databaseUrl });
    await maintenance.connect();
    await maintenance.query(`DROP DATABASE ${databaseName}`);
    await maintenance.end();
  });

  it('rejects unauthenticated updates and deduplicates signed private requests', async () => {
    const app = buildApp({
      pool: runtimePool,
      logger: false,
      telegramOnboarding: {
        botToken: '123456:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        webhookSecret: secret,
        regionCode: 'tw-general',
        sendMessage
      }
    });
    const url = '/telegram/onboarding/webhook';
    const signed = { 'x-telegram-bot-api-secret-token': secret };
    expect(
      (await app.inject({ method: 'POST', url, payload: update(100, 12345) })).statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { 'x-telegram-bot-api-secret-token': 'incorrect' },
          payload: update(100, 12345)
        })
      ).statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: signed,
          payload: { update_id: 'forged', message: {} }
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: signed,
          payload: update(101, 12345, 'group')
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: signed,
          payload: update(102, 12345, 'private', 'hello')
        })
      ).statusCode
    ).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url, headers: signed, payload: update(103, 12345) }))
        .statusCode
    ).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url, headers: signed, payload: update(103, 12345) }))
        .statusCode
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: signed,
          payload: update(104, 12345, 'private', '/apply')
        })
      ).statusCode
    ).toBe(200);
    const beforeSubmission = await pool.query<{ count: string }>(
      `SELECT count(*) FROM identity.onboarding_applications WHERE platform = 'telegram'`
    );
    expect(Number(beforeSubmission.rows[0]!.count)).toBe(0);
    expect(sendMessage).toHaveBeenCalledTimes(3);
    const linkText =
      sendMessage.mock.calls.find(([, text]) => text.includes('/telegram/apply#'))?.[1] ?? '';
    const token = linkText.match(/\/telegram\/apply#([A-Za-z0-9_-]{43})/)?.[1];
    expect(token).toBeTruthy();
    const submit = (body: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/telegram/onboarding/apply',
        headers: { origin: 'https://checkin.baiyinqigong.org' },
        payload: body
      });
    const details = {
      token: token!,
      name: 'True Learner',
      email: 'learner@example.com',
      phone: '+886912345678',
      region: 'tw-general'
    };
    expect((await submit({ ...details, phone: '0912345678' })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: '/telegram/onboarding/apply', payload: details }))
        .statusCode
    ).toBe(403);
    const submitted = await submit(details);
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect((await submit(details)).statusCode).toBe(409);
    const applications = await pool.query<{ status: string; requested_region_id: string }>(
      `SELECT status, requested_region_id FROM identity.onboarding_applications
       WHERE platform = 'telegram' AND external_subject_id = '12345'`
    );
    expect(applications.rows).toEqual([{ status: 'pending', requested_region_id: regionId }]);
    const detailsRow = await pool.query<{
      learner_name: string;
      website_email: string;
      phone_e164: string;
    }>(
      `SELECT learner_name, website_email, phone_e164 FROM identity.onboarding_applications
       WHERE platform = 'telegram' AND external_subject_id = '12345'`
    );
    expect(detailsRow.rows).toEqual([
      {
        learner_name: 'True Learner',
        website_email: 'learner@example.com',
        phone_e164: '+886912345678'
      }
    ]);
    const formPage = await app.inject({ method: 'GET', url: '/telegram/apply' });
    expect(formPage.statusCode).toBe(200);
    expect(formPage.body).toContain('白雁官網註冊 Email');
    expect(formPage.body).toContain('馬來西亞');
    expect(formPage.headers['cache-control']).toBe('no-store');
    expect(formPage.headers['referrer-policy']).toBe('no-referrer');
    const choices = await pool.query<{ code: string }>(
      `SELECT code FROM core.regions WHERE code IN ('tw-general', 'my-general', 'sg-general', 'hk-general', 'other-general') ORDER BY code`
    );
    expect(choices.rows.map(({ code }) => code)).toEqual([
      'hk-general',
      'my-general',
      'other-general',
      'sg-general',
      'tw-general'
    ]);
    const events = await pool.query<{ update_id: string }>(
      `SELECT update_id FROM platform.telegram_onboarding_updates ORDER BY update_id`
    );
    expect(events.rows.map((row) => Number(row.update_id))).toEqual([103, 104]);
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage.mock.calls.every(([chatId]) => chatId === 12345)).toBe(true);
    expect(
      (await app.inject({ method: 'POST', url, headers: signed, payload: update(103, 98765) }))
        .statusCode
    ).toBe(503);
    const afterCollision = await pool.query<{ count: string }>(
      `SELECT count(*) FROM identity.onboarding_applications WHERE platform = 'telegram'`
    );
    expect(Number(afterCollision.rows[0]!.count)).toBe(1);
    await app.close();
  });

  it('permits only approved active Telegram learners to check in once per practice date', async () => {
    const app = buildApp({
      pool: runtimePool,
      logger: false,
      telegramOnboarding: {
        botToken: '123456:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        webhookSecret: secret,
        regionCode: 'tw-general',
        sendMessage
      }
    });
    const signed = { 'x-telegram-bot-api-secret-token': secret };
    const webhook = '/telegram/onboarding/webhook';
    const attempt = await app.inject({
      method: 'POST',
      url: webhook,
      headers: signed,
      payload: update(200, 54321, 'private', '/checkin')
    });
    expect(attempt.statusCode).toBe(200);
    expect(sendMessage.mock.calls.at(-1)?.[1]).toContain('尚未通過');

    const reviewer = await pool.query<{ id: string }>(
      `INSERT INTO admin.principals (oidc_issuer, oidc_subject, display_name)
       VALUES ('https://admin.example.com', 'checkin-reviewer', 'Reviewer') RETURNING id`
    );
    const person = await pool.query<{ id: string }>(
      `INSERT INTO identity.people (preferred_name, membership_status)
       VALUES ('Test Learner', 'pending') RETURNING id`
    );
    const identity = await pool.query<{ id: string }>(
      `INSERT INTO identity.platform_identities (person_id, platform, external_subject_id, display_name)
       VALUES ($1, 'telegram', '54321', 'Test Learner') RETURNING id`,
      [person.rows[0]!.id]
    );
    await pool.query(
      `INSERT INTO core.person_region_assignments
       (person_id, region_id, assignment_type, valid_from, assigned_by_principal_id)
       VALUES ($1, $2, 'primary', CURRENT_DATE - 1, $3)`,
      [person.rows[0]!.id, regionId, reviewer.rows[0]!.id]
    );
    await pool.query(
      `INSERT INTO identity.person_interaction_channels
       (person_id, platform_identity_id, activation_source, activated_by_principal_id)
       VALUES ($1, $2, 'onboarding', $3)`,
      [person.rows[0]!.id, identity.rows[0]!.id, reviewer.rows[0]!.id]
    );
    const application = await pool.query<{ id: string }>(
      `INSERT INTO identity.onboarding_applications
       (platform, external_subject_id, display_name, requested_region_id, learner_name,
        website_email, phone_e164)
       VALUES ('telegram', '54321', 'Test Learner', $1, 'Test Learner', 'learner@example.com', '+886912345678') RETURNING id`,
      [regionId]
    );
    await pool.query(
      `UPDATE identity.onboarding_applications SET status = 'approved', person_id = $1,
       decided_by_principal_id = $2, decided_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [person.rows[0]!.id, reviewer.rows[0]!.id, application.rows[0]!.id]
    );

    const ready = await app.inject({
      method: 'POST',
      url: webhook,
      headers: signed,
      payload: update(201, 54321, 'private', '/checkin')
    });
    expect(ready.statusCode).toBe(200);
    const link = sendMessage.mock.calls.at(-1)?.[1] ?? '';
    const token = link.match(/\/telegram\/checkin#([A-Za-z0-9_-]{43})/)?.[1];
    expect(token).toBeTruthy();
    const headers = { origin: 'https://checkin.baiyinqigong.org' };
    const methods = await app.inject({
      method: 'POST',
      url: '/telegram/checkin/methods',
      headers,
      payload: { token }
    });
    expect(methods.statusCode).toBe(200);
    expect(methods.json().methods).toHaveLength(22);
    const methodRows = methods.json().methods as Array<{
      code: string;
      parent_code: string | null;
      parent_name_zh_tw: string | null;
    }>;
    const families: Record<string, string[]> = {
      dayan: ['dayan_chu', 'dayan_gao'],
      wuqinxi: ['wuqinxi_he', 'wuqinxi_yuan', 'wuqinxi_hu', 'wuqinxi_xiong', 'wuqinxi_lu'],
      huichun: ['huichun_chu', 'huichun_zhong'],
      guishou: ['guishou_bagua', 'guishou_qiankun', 'guishou_fengxiang_guishuo'],
      zhengyang: ['zhengyang_morning', 'zhengyang_night'],
      jinggong: ['jinggong_zhoutian', 'jinggong_qixing', 'jinggong_songjing']
    };
    for (const [parent, children] of Object.entries(families)) {
      expect(methodRows.filter((row) => row.parent_code === parent).map((row) => row.code)).toEqual(
        children
      );
      expect(methodRows.find((row) => row.parent_code === parent)?.parent_name_zh_tw).toBeTruthy();
    }
    expect(methodRows.filter((row) => row.parent_code === null)).toHaveLength(5);
    const history = (value: string | undefined) =>
      app.inject({
        method: 'POST',
        url: '/telegram/checkin/history',
        headers,
        payload: { token: value }
      });
    expect((await history(undefined)).statusCode).toBe(400);
    expect((await history('a'.repeat(43))).statusCode).toBe(403);
    const initial = await history(token);
    expect(initial.statusCode, initial.body).toBe(200);
    expect(initial.json().entries).toEqual([]);
    expect(initial.json().currentStreak).toBe(0);
    const submit = (methodCodes: string[]) =>
      app.inject({
        method: 'POST',
        url: '/telegram/checkin/submit',
        headers,
        payload: { token, methods: methodCodes, makeup: false }
      });
    expect((await submit(['unknown-method'])).statusCode).toBe(409);
    const completed = await submit(['dayan_chu']);
    expect(completed.statusCode, completed.body).toBe(200);
    expect(completed.json().entryKind).toBe('regular');
    expect((await submit(['dayan_chu'])).statusCode).toBe(409);
    const recorded = await history(token);
    expect(recorded.statusCode, recorded.body).toBe(200);
    expect(recorded.json().entries[0].method_codes).toEqual(['dayan_chu']);
    expect(recorded.json().entries[0].editable).toBe(true);
    expect(recorded.json().currentStreak).toBe(1);
    expect(recorded.json().totalDays).toBe(1);
    const checkinId: string = recorded.json().entries[0].id;
    const correct = (value: string | undefined, id: string, codes: string[]) =>
      app.inject({
        method: 'POST',
        url: '/telegram/checkin/correct',
        headers,
        payload: { token: value, checkinId: id, methods: codes }
      });
    expect((await correct('a'.repeat(43), checkinId, ['dayan_gao'])).statusCode).toBe(409);
    expect((await correct(token, randomUUID(), ['dayan_gao'])).statusCode).toBe(409);
    expect((await correct(token, checkinId, ['dayan_gao', 'dayan_gao'])).statusCode).toBe(409);
    expect((await history(token)).json().entries[0].method_codes).toEqual(['dayan_chu']);
    expect((await correct(token, checkinId, ['dayan_gao'])).statusCode).toBe(200);
    expect((await history(token)).json().entries[0].method_codes).toEqual(['dayan_gao']);
    const anotherLink = await app.inject({
      method: 'POST',
      url: webhook,
      headers: signed,
      payload: update(202, 54321, 'private', '/checkin')
    });
    expect(anotherLink.statusCode).toBe(200);
    const secondToken = sendMessage.mock.calls
      .at(-1)?.[1]
      .match(/\/telegram\/checkin#([A-Za-z0-9_-]{43})/)?.[1];
    expect(secondToken).toBeTruthy();
    const duplicateDay = await app.inject({
      method: 'POST',
      url: '/telegram/checkin/submit',
      headers,
      payload: { token: secondToken, methods: ['dayan_gao'], makeup: false }
    });
    expect(duplicateDay.statusCode).toBe(409);
    expect((await correct(secondToken, checkinId, ['dayan_chu'])).statusCode).toBe(200);
    await pool.query(
      `UPDATE core.checkins SET practice_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date - 2
       WHERE id = $1`,
      [checkinId]
    );
    expect((await correct(secondToken, checkinId, ['dayan_gao'])).statusCode).toBe(409);
    const stale = await history(secondToken);
    expect(stale.json().entries[0].editable).toBe(false);
    expect(stale.json().currentStreak).toBe(0);
    await pool.query(
      `UPDATE core.checkins SET practice_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date
       WHERE id = $1`,
      [checkinId]
    );
    await pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to = CURRENT_TIMESTAMP WHERE person_id = $1',
      [person.rows[0]!.id]
    );
    const inactiveChannel = await app.inject({
      method: 'POST',
      url: webhook,
      headers: signed,
      payload: update(203, 54321, 'private', '/checkin')
    });
    expect(inactiveChannel.statusCode).toBe(200);
    expect(sendMessage.mock.calls.at(-1)?.[1]).toContain('主要打卡管道');
    expect((await history(secondToken)).statusCode).toBe(403);
    expect((await correct(secondToken, checkinId, ['dayan_gao'])).statusCode).toBe(409);
    const saved = await pool.query<{ code: string }>(
      `SELECT method.code FROM core.checkins checkin
       JOIN core.checkin_method_selections selection ON selection.checkin_id = checkin.id
       JOIN core.practice_methods method ON method.id = selection.practice_method_id
       WHERE checkin.person_id = $1`,
      [person.rows[0]!.id]
    );
    expect(saved.rows).toEqual([{ code: 'dayan_chu' }]);
    await app.close();
  });

  it('uses the learner practice timezone to enforce the noon makeup deadline', async () => {
    const app = buildApp({
      pool: runtimePool,
      logger: false,
      telegramOnboarding: {
        botToken: '123456:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        webhookSecret: secret,
        regionCode: 'tw-general',
        sendMessage
      }
    });
    const principal = await pool.query<{ id: string }>(
      `SELECT id FROM admin.principals WHERE oidc_subject = 'checkin-reviewer'`
    );
    const person = await pool.query<{ id: string }>(
      `INSERT INTO identity.people (preferred_name, practice_timezone, membership_status)
       VALUES ('Timezone Learner', 'Pacific/Honolulu', 'pending') RETURNING id`
    );
    const identity = await pool.query<{ id: string }>(
      `INSERT INTO identity.platform_identities (person_id, platform, external_subject_id)
       VALUES ($1, 'telegram', '54322') RETURNING id`,
      [person.rows[0]!.id]
    );
    await pool.query(
      `INSERT INTO core.person_region_assignments
       (person_id, region_id, assignment_type, valid_from, assigned_by_principal_id)
       VALUES ($1, $2, 'primary', CURRENT_DATE - 3, $3)`,
      [person.rows[0]!.id, regionId, principal.rows[0]!.id]
    );
    await pool.query(
      `INSERT INTO identity.person_interaction_channels
       (person_id, platform_identity_id, activation_source, activated_by_principal_id)
       VALUES ($1, $2, 'onboarding', $3)`,
      [person.rows[0]!.id, identity.rows[0]!.id, principal.rows[0]!.id]
    );
    const application = await pool.query<{ id: string }>(
      `INSERT INTO identity.onboarding_applications
       (platform, external_subject_id, display_name, requested_region_id, learner_name,
        website_email, phone_e164)
       VALUES ('telegram', '54322', 'Timezone Learner', $1, 'Timezone Learner', 'tz@example.com', '+886912345680') RETURNING id`,
      [regionId]
    );
    await pool.query(
      `UPDATE identity.onboarding_applications SET status = 'approved', person_id = $1,
       decided_by_principal_id = $2, decided_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [person.rows[0]!.id, principal.rows[0]!.id, application.rows[0]!.id]
    );
    const signed = { 'x-telegram-bot-api-secret-token': secret };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/telegram/onboarding/webhook',
          headers: signed,
          payload: update(204, 54322, 'private', '/checkin')
        })
      ).statusCode
    ).toBe(200);
    const token = sendMessage.mock.calls
      .at(-1)?.[1]
      .match(/\/telegram\/checkin#([A-Za-z0-9_-]{43})/)?.[1];
    const someoneElse = await pool.query<{ id: string }>(
      `SELECT id FROM core.checkins WHERE person_id <> $1 LIMIT 1`,
      [person.rows[0]!.id]
    );
    expect(someoneElse.rows).toHaveLength(1);
    const otherCorrection = await app.inject({
      method: 'POST',
      url: '/telegram/checkin/correct',
      headers: { origin: 'https://checkin.baiyinqigong.org' },
      payload: { token, checkinId: someoneElse.rows[0]!.id, methods: ['dayan_gao'] }
    });
    expect(otherCorrection.statusCode).toBe(409);
    const response = await app.inject({
      method: 'POST',
      url: '/telegram/checkin/submit',
      headers: { origin: 'https://checkin.baiyinqigong.org' },
      payload: { token, methods: ['dayan_chu'], makeup: true }
    });
    const clock = await pool.query<{ before_noon: boolean; expected_date: string }>(
      `SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Pacific/Honolulu')::time < TIME '12:00' AS before_noon,
              ((CURRENT_TIMESTAMP AT TIME ZONE 'Pacific/Honolulu')::date - 1)::text AS expected_date`
    );
    if (clock.rows[0]!.before_noon) {
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().practiceDate).toBe(clock.rows[0]!.expected_date);
    } else {
      expect(response.statusCode).toBe(409);
    }
    await app.close();
  });
});
