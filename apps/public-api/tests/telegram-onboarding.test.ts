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
});
