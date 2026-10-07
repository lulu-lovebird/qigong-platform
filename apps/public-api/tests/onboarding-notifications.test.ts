import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { deliverOnboardingNotifications } from '../src/onboarding-notifications.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);

describeWithDatabase('onboarding notification delivery', () => {
  let pool: Pool;
  let workerPool: Pool;
  let loginRole: string;
  let databaseName: string;
  let principalId: string;
  let regionId: string;

  beforeAll(async () => {
    const maintenance = new pg.Client({ connectionString: databaseUrl });
    await maintenance.connect();
    databaseName = `qigong_notification_test_${randomUUID().replaceAll('-', '')}`;
    await maintenance.query(`CREATE DATABASE ${databaseName}`);
    await maintenance.end();
    const url = new URL(databaseUrl!);
    url.pathname = `/${databaseName}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    await runMigrations(pool, migrationsDirectory, 'vitest');
    loginRole = `qigong_notify_${randomUUID().replaceAll('-', '')}`;
    const password = randomUUID().replaceAll('-', '');
    await pool.query(`CREATE ROLE ${loginRole} LOGIN PASSWORD '${password}' NOINHERIT NOBYPASSRLS`);
    await pool.query(`GRANT qigong_worker_runtime TO ${loginRole}`);
    url.username = loginRole;
    url.password = password;
    workerPool = new pg.Pool({ connectionString: url.toString() });
    const global = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (code, region_type, name_zh_tw, name_en)
       VALUES ('notification-global', 'global', '全球', 'Global') RETURNING id`
    );
    const country = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       VALUES ($1, 'notification-country', 'country', '台灣', 'Taiwan') RETURNING id`,
      [global.rows[0]!.id]
    );
    const region = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       VALUES ($1, 'notification-region', 'operational', '台灣地區', 'Taiwan Region') RETURNING id`,
      [country.rows[0]!.id]
    );
    regionId = region.rows[0]!.id;
    const principal = await pool.query<{ id: string }>(
      `INSERT INTO admin.principals (oidc_issuer, oidc_subject, display_name)
       VALUES ('https://admin.example.com', 'notification-admin', 'Admin') RETURNING id`
    );
    principalId = principal.rows[0]!.id;
    await pool.query(
      `INSERT INTO admin.role_grants (principal_id, role_id, scope_type, region_id, reason)
       SELECT $1, id, 'region', $2, 'review' FROM admin.roles WHERE code = 'regional_admin'`,
      [principalId, regionId]
    );
  });

  afterAll(async () => {
    await workerPool.end();
    await pool.query(`DROP OWNED BY ${loginRole}`);
    await pool.query(`DROP ROLE ${loginRole}`);
    await pool.end();
    const maintenance = new pg.Client({ connectionString: databaseUrl });
    await maintenance.connect();
    await maintenance.query(`DROP DATABASE ${databaseName}`);
    await maintenance.end();
  });

  const makeApplication = async (subject: string) => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO identity.onboarding_applications
       (platform, external_subject_id, display_name, requested_region_id,
        learner_name, website_email, phone_e164)
       VALUES ('telegram', $1, 'Learner', $2, 'Learner', 'learner@example.com', '+886912345678') RETURNING id`,
      [subject, regionId]
    );
    return result.rows[0]!.id;
  };

  const decide = (id: string, decision: string, rejection?: string) =>
    withRequestContext(
      pool,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId },
      (client) =>
        client.query('SELECT identity.decide_application($1, $2, $3)', [
          id,
          decision,
          rejection ?? null
        ])
    );

  it('delivers Telegram decisions using the saved channel locale', async () => {
    const id = await makeApplication('88888');
    await withRequestContext(pool, 'qigong_api_runtime', { requestId: randomUUID() }, (client) =>
      client.query("SELECT platform.set_identity_locale('telegram','88888','en')")
    );
    await decide(id, 'approved');
    const sender = vi.fn(async () => {});
    expect(await deliverOnboardingNotifications(workerPool, sender, () => undefined)).toBe(1);
    expect(sender).toHaveBeenCalledWith('88888', 'approved', 'en');
  });

  it('queues once per decision, retries failed sends, and never resends a delivered notification', async () => {
    const approvedId = await makeApplication('notify-approved');
    const rejectedId = await makeApplication('notify-rejected');
    await decide(approvedId, 'approved');
    await decide(rejectedId, 'rejected', 'Not eligible');
    await expect(decide(approvedId, 'approved')).rejects.toThrow('not pending');
    const queued = await pool.query<{ decision: string; status: string }>(
      `SELECT decision, status FROM ops.onboarding_notifications WHERE external_subject_id LIKE 'notify-%' ORDER BY decision`
    );
    expect(queued.rows).toEqual([
      { decision: 'approved', status: 'pending' },
      { decision: 'rejected', status: 'pending' }
    ]);
    await expect(workerPool.query('SELECT * FROM ops.onboarding_notifications')).rejects.toThrow(
      'permission denied'
    );
    await expect(
      workerPool.query("UPDATE ops.onboarding_notifications SET status = 'delivered'")
    ).rejects.toThrow('permission denied');
    const errors: string[] = [];
    const failOnce = vi.fn(async (_recipient: string, decision: string) => {
      if (decision === 'rejected') throw new Error('Telegram temporarily unavailable');
    });
    expect(
      await deliverOnboardingNotifications(workerPool, failOnce, (error) =>
        errors.push(String(error))
      )
    ).toBe(2);
    expect(errors).toHaveLength(1);
    const firstPass = await pool.query<{ decision: string; status: string; attempts: number }>(
      `SELECT decision, status, attempts FROM ops.onboarding_notifications WHERE external_subject_id LIKE 'notify-%' ORDER BY decision`
    );
    expect(firstPass.rows).toEqual([
      { decision: 'approved', status: 'delivered', attempts: 1 },
      { decision: 'rejected', status: 'pending', attempts: 1 }
    ]);
    expect(await deliverOnboardingNotifications(workerPool, failOnce, () => undefined)).toBe(0);
    await pool.query(
      `UPDATE ops.onboarding_notifications SET available_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE decision = 'rejected'`
    );
    const retry = vi.fn(async (recipient: string, decision: string) => {
      expect(recipient).toBe('notify-rejected');
      expect(decision).toBe('rejected');
    });
    expect(await deliverOnboardingNotifications(workerPool, retry, () => undefined)).toBe(1);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(await deliverOnboardingNotifications(workerPool, retry, () => undefined)).toBe(0);
    const final = await pool.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM ops.onboarding_notifications WHERE decision = 'rejected'`
    );
    expect(final.rows).toEqual([{ status: 'delivered', attempts: 2 }]);
    const lineApplication = await pool.query<{ id: string }>(
      `INSERT INTO identity.onboarding_applications
       (platform, external_subject_id, display_name, requested_region_id,
        learner_name, website_email, phone_e164)
       VALUES ('line', $1, 'LINE Learner', $2, 'LINE Learner', 'line@example.com', '+886912345679') RETURNING id`,
      ['U' + 'b'.repeat(32), regionId]
    );
    await decide(lineApplication.rows[0]!.id, 'approved');
    const sendLine = vi.fn(async (recipient: string, decision: string) => {
      expect(recipient).toBeTruthy();
      expect(decision).toBe('approved');
    });
    expect(
      await deliverOnboardingNotifications(workerPool, retry, () => undefined, 10, sendLine)
    ).toBe(1);
    expect(sendLine).toHaveBeenCalledWith('U' + 'b'.repeat(32), 'approved');
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
