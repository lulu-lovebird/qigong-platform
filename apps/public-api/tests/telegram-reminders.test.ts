import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
import { telegramFeatureButtons } from '../src/telegram-feature-buttons.js';
import {
  parseTelegramReminder,
  createTelegramReminderSender,
  deliverTelegramReminders,
  telegramReminderWorkerEnabled
} from '../src/telegram-reminders.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
describe('Telegram command presentation', () => {
  it('leaves outbound reminders disabled unless the worker flag is explicitly true', () => {
    expect(telegramReminderWorkerEnabled(undefined)).toBe(false);
    expect(telegramReminderWorkerEnabled('false')).toBe(false);
    expect(telegramReminderWorkerEnabled('true')).toBe(true);
    expect(() => telegramReminderWorkerEnabled('1')).toThrow();
  });
  it.each([
    ['checkin', '✅', 'checkin'],
    ['leaderboard', '🏆', 'leaderboard'],
    ['methods', '📈', 'method-analysis'],
    ['methodanalysis', '📈', 'method-analysis'],
    ['achievements', '🏮', 'achievements'],
    ['history', '🏮', 'achievements'],
    ['mystats', '🏮', 'achievements'],
    ['badges', '🏮', 'achievements'],
    ['journal', '📝', 'journal'],
    ['share', '📝', 'journal']
  ])('maps %s to one native feature', (command, icon, page) => {
    for (const locale of ['zh_TW', 'zh_CN', 'en'] as const) {
      const buttons = telegramFeatureButtons(locale, command);
      expect(buttons).toHaveLength(1);
      expect(buttons[0]!.text.startsWith(icon)).toBe(true);
      expect(buttons[0]!.url).toContain('/telegram/' + page);
      expect(buttons[0]!.url).not.toContain('#');
    }
  });
  it('keeps five start entries and parses explicit opt-in settings without loose arguments', () => {
    expect(telegramFeatureButtons('zh_TW')).toHaveLength(5);
    expect(parseTelegramReminder('/remind')).toEqual({ action: 'read' });
    expect(parseTelegramReminder('/remind 21')).toEqual({ action: 'hour', value: '21' });
    expect(parseTelegramReminder('/remind off')).toEqual({ action: 'off' });
    expect(parseTelegramReminder('/remind tz America/New_York')).toEqual({
      action: 'timezone',
      value: 'America/New_York'
    });
    expect(parseTelegramReminder('/remindtest@demo')).toEqual({ action: 'preview' });
    for (const text of ['/remind 24', '/remind -1', '/remind on extra', '/remindtest extra'])
      expect(parseTelegramReminder(text)).toBeNull();
  });
  it('uses a static native button, no personal payload and fails on unaccepted provider responses', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    try {
      await createTelegramReminderSender('synthetic-not-real')('777001', 'en');
      const body = fetch.mock.calls[0]![1]!.body;
      if (typeof body !== 'string') throw Error('JSON expected');
      expect(JSON.parse(body) as unknown).toMatchObject({
        chat_id: '777001',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '✅ Start check-in',
                web_app: { url: 'https://checkin.baiyinqigong.org/telegram/checkin?lang=en' }
              }
            ]
          ]
        }
      });
      expect(body).not.toContain('practiceNote');
      fetch.mockResolvedValueOnce(Response.json({ ok: false }));
      await expect(
        createTelegramReminderSender('synthetic-not-real')('777001', 'en')
      ).rejects.toThrow('delivery failed');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
suite('Signed Telegram reminders and restricted durable delivery', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
    runtime: Pool,
    role: string,
    person: string,
    app: FastifyInstance,
    counter = 800000;
  const subject = '777001',
    secret = 'synthetic-webhook-secret-not-real',
    sendMessage = vi.fn(
      async (
        chat: number,
        text: string,
        buttons?: ReadonlyArray<{ text: string; url: string }>
      ) => {
        expect(chat).toBeGreaterThan(0);
        expect(text).toBeTruthy();
        if (buttons)
          expect(
            buttons.every((button) =>
              button.url.startsWith('https://checkin.baiyinqigong.org/telegram/')
            )
          ).toBe(true);
      }
    );
  const webhook = (text: string, id = ++counter, privateChat = true) =>
    app.inject({
      method: 'POST',
      url: '/telegram/onboarding/webhook',
      headers: { 'x-telegram-bot-api-secret-token': secret },
      payload: {
        update_id: id,
        message: {
          chat: { id: privateChat ? Number(subject) : -1, type: privateChat ? 'private' : 'group' },
          from: { id: Number(subject), first_name: 'Synthetic' },
          text
        }
      }
    });
  const query = <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
    worker = false
  ) =>
    withRequestContext(
      runtime,
      worker ? 'qigong_worker_runtime' : 'qigong_api_runtime',
      { requestId: randomUUID() },
      (c) => c.query<Row>(sql, values)
    );
  beforeEach(async () => {
    sendMessage.mockClear();
    db = await createIsolatedTestDatabase(base!);
    await runMigrations(db.pool, directory, 'reminder-test');
    role = 'qigong_reminder_test_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await db.pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await db.pool.query(`GRANT qigong_api_runtime,qigong_worker_runtime TO ${role}`);
    const url = new URL(db.databaseUrl);
    url.username = role;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    const actor = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://reminder.example.invalid','reviewer','Synthetic reviewer') RETURNING id"
      )
    ).rows[0]!.id;
    const region = (
      await db.pool.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('reminder-global','global','全球','Global') RETURNING id),k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'reminder-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'tw-general','operational','地區','Region' FROM k RETURNING id"
      )
    ).rows[0]!.id;
    person = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Synthetic learner','UTC') RETURNING id"
      )
    ).rows[0]!.id;
    const identity = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'telegram',$2) RETURNING id",
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
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES('telegram',$1,'Synthetic','Synthetic','demo@example.invalid','+65940000001',$2,'approved',$3,CURRENT_TIMESTAMP,$4)",
      [subject, region, person, actor]
    );
    app = buildApp({
      pool: runtime,
      logger: false,
      telegramOnboarding: {
        botToken: '123456:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        webhookSecret: secret,
        regionCode: 'tw-general',
        sendMessage
      }
    });
  });
  afterEach(async () => {
    await app.close();
    await runtime.end();
    await db.pool.query(`DROP OWNED BY ${role}`);
    await db.pool.query(`DROP ROLE ${role}`);
    await db.dispose();
  });
  it('defaults off at21, changes only reminder timezone, and sends one feature instead of a full menu', async () => {
    await webhook('/remind');
    expect(sendMessage.mock.calls[0]![1]).toContain('已關閉');
    expect(sendMessage.mock.calls[0]![1]).toContain('21:00');
    expect((await db.pool.query('SELECT * FROM ops.telegram_reminders')).rowCount).toBe(0);
    await webhook('/remind tz Asia/Taipei');
    expect(
      (await db.pool.query('SELECT practice_timezone FROM identity.people WHERE id=$1', [person]))
        .rows[0]!.practice_timezone
    ).toBe('UTC');
    await webhook('/checkin');
    expect(sendMessage.mock.calls.at(-1)![2]).toHaveLength(1);
    expect(sendMessage.mock.calls.at(-1)![2]![0]!.text).toBe('✅ 開始打卡');
    await webhook('/start');
    expect(sendMessage.mock.calls.at(-1)![2]).toHaveLength(5);
  });
  it('captures the selected Simplified locale for an explicit preview without opting the learner into reminders', async () => {
    await webhook('/language zh_CN');
    expect((await db.pool.query('SELECT * FROM ops.telegram_reminders')).rowCount).toBe(0);
    await webhook('/remind');
    expect(sendMessage.mock.calls.at(-1)?.[1]).toContain('已关闭');
    await webhook('/remindtest');
    expect((await db.pool.query('SELECT locale FROM ops.telegram_reminders')).rows).toEqual([
      { locale: 'zh_CN' }
    ]);
    const sender = vi.fn(async (recipient: string, locale: string) => {
      expect(recipient).toBe('777001');
      expect(locale).toBe('zh_CN');
    });
    expect(await deliverTelegramReminders(runtime, sender, () => {})).toBe(1);
    expect(sender).toHaveBeenCalledOnce();
    expect(
      (await db.pool.query('SELECT enabled FROM platform.telegram_reminder_settings')).rows
    ).toEqual([{ enabled: false }]);
  });
  it('validates hours, zones, webhook identity and idempotently ignores duplicate settings updates', async () => {
    await webhook('/remind 24');
    await webhook('/remind tz Invalid/Zone');
    expect(
      (await db.pool.query('SELECT enabled FROM platform.telegram_reminder_settings')).rows[0]
        ?.enabled ?? false
    ).toBe(false);
    const id = ++counter;
    await webhook('/remind 21', id);
    const calls = sendMessage.mock.calls.length;
    await webhook('/remind 21', id);
    expect(sendMessage.mock.calls.length).toBe(calls);
    expect(
      (await db.pool.query('SELECT revision FROM platform.telegram_reminder_settings')).rows[0]!
        .revision
    ).toBe(1);
    await webhook('/remind off', ++counter, false);
    expect(
      (await db.pool.query('SELECT enabled FROM platform.telegram_reminder_settings')).rows[0]!
        .enabled
    ).toBe(true);
    expect(
      (await app.inject({ method: 'POST', url: '/telegram/onboarding/webhook', payload: {} }))
        .statusCode
    ).toBe(401);
  });
  it('queues once per local day even after checkin and prevents repeated worker sends', async () => {
    await webhook('/remind ' + new Date().getUTCHours());
    await db.pool.query(
      "INSERT INTO core.checkins(person_id,practice_date,entry_kind,submitted_via_identity_id,practice_timezone,region_assignment_id) SELECT $1,CURRENT_DATE,'regular',i.id,'UTC',a.id FROM identity.platform_identities i JOIN core.person_region_assignments a ON a.person_id=i.person_id WHERE i.person_id=$1",
      [person]
    );
    expect(
      (await query<{ n: number }>('SELECT ops.queue_telegram_reminders(100) n', [], true)).rows[0]!
        .n
    ).toBe(1);
    expect(
      (await query<{ n: number }>('SELECT ops.queue_telegram_reminders(100) n', [], true)).rows[0]!
        .n
    ).toBe(0);
    const sender = vi.fn(async () => {});
    expect(await deliverTelegramReminders(runtime, sender, () => {})).toBe(1);
    expect(await deliverTelegramReminders(runtime, sender, () => {})).toBe(0);
    expect(sender).toHaveBeenCalledWith(subject, 'zh_TW');
  });
  it('rate-limits本人preview, rechecks off after claim and cancels leased work', async () => {
    await webhook('/remindtest');
    await webhook('/remindtest');
    expect(sendMessage.mock.calls.at(-1)![1]).toContain('五分鐘');
    const job = (
      await query<{ id: string; lease_id: string }>(
        'SELECT * FROM ops.claim_telegram_reminders(1)',
        [],
        true
      )
    ).rows[0]!;
    expect(
      (
        await query<{ allowed: boolean }>(
          'SELECT ops.telegram_reminder_allowed($1,$2) allowed',
          [job.id, job.lease_id],
          true
        )
      ).rows[0]!.allowed
    ).toBe(true);
    await webhook('/remind off');
    expect(
      (
        await query<{ allowed: boolean }>(
          'SELECT ops.telegram_reminder_allowed($1,$2) allowed',
          [job.id, job.lease_id],
          true
        )
      ).rows[0]!.allowed
    ).toBe(false);
    expect((await db.pool.query('SELECT status FROM ops.telegram_reminders')).rows[0]!.status).toBe(
      'cancelled'
    );
  });
  it('allows off even after consent or eligibility removal while denying new sends and opt-in', async () => {
    await webhook('/remind on');
    await webhook('/remindtest');
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
    const sender = vi.fn(async () => {});
    expect(await deliverTelegramReminders(runtime, sender, () => {})).toBe(0);
    expect(sender).not.toHaveBeenCalled();
    await webhook('/remind off');
    expect(sendMessage.mock.calls.at(-1)![1]).toContain('已關閉');
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='draft'");
    await db.pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE person_id=$1',
      [person]
    );
    await db.pool.query("UPDATE identity.people SET status='suspended' WHERE id=$1", [person]);
    await webhook('/remind on');
    expect(
      (await db.pool.query('SELECT enabled FROM platform.telegram_reminder_settings')).rows[0]!
        .enabled
    ).toBe(false);
  });
  it('retries failures with bounded backoff and rejects wrong leases and runtime table access', async () => {
    await webhook('/remindtest');
    const failed = vi.fn(async () => {
        throw Error('Synthetic transport failure');
      }),
      onError = vi.fn();
    await deliverTelegramReminders(runtime, failed, onError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(
      (await db.pool.query('SELECT status,attempts FROM ops.telegram_reminders')).rows[0]
    ).toEqual({ status: 'pending', attempts: 1 });
    expect(await deliverTelegramReminders(runtime, failed, onError)).toBe(0);
    await expect(query('SELECT * FROM platform.telegram_reminder_settings')).rejects.toThrow();
    await expect(
      query('SELECT platform.telegram_reminder_command(1,$1,$2,NULL)', [subject, 'on'], true)
    ).rejects.toThrow();
    expect(
      (
        await query<{ accepted: boolean }>(
          'SELECT ops.finish_telegram_reminder($1,$2,true) accepted',
          [randomUUID(), randomUUID()],
          true
        )
      ).rows[0]!.accepted
    ).toBe(false);
  });
  it('does not starve recipients beyond the first100 and bounds reminder concurrency at5', async () => {
    await db.pool.query(
      "WITH p AS(INSERT INTO identity.people(preferred_name,practice_timezone) SELECT 'Synthetic batch learner','UTC' FROM generate_series(1,125) RETURNING id),i AS(INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) SELECT id,'telegram',(90000000+row_number() OVER(ORDER BY id))::text FROM p RETURNING id,person_id,external_subject_id),c AS(INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) SELECT person_id,id,'onboarding' FROM i),a AS(INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) SELECT 'telegram',external_subject_id,'Synthetic','Synthetic','demo@example.invalid','+65940000002',(SELECT id FROM core.regions WHERE code='tw-general'),'approved',person_id,clock_timestamp(),(SELECT id FROM admin.principals LIMIT 1) FROM i) INSERT INTO platform.telegram_reminder_settings(person_id,enabled,hour,timezone) SELECT id,true,extract(hour FROM clock_timestamp() AT TIME ZONE 'UTC')::int,'UTC' FROM p"
    );
    expect(
      (await query<{ n: number }>('SELECT ops.queue_telegram_reminders(100) n', [], true)).rows[0]!
        .n
    ).toBe(100);
    expect(
      (await query<{ n: number }>('SELECT ops.queue_telegram_reminders(100) n', [], true)).rows[0]!
        .n
    ).toBe(25);
    let active = 0,
      peak = 0;
    const sender = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    });
    for (let batch = 0; batch < 5; batch++) {
      const delivered = await deliverTelegramReminders(runtime, sender, () => {});
      const diagnostic =
        delivered !== 25
          ? (
              await db.pool.query(
                'SELECT j.status,count(*)::int count,min(extract(epoch FROM j.expires_at-clock_timestamp())) expires_seconds,min(extract(epoch FROM clock_timestamp()-ch.valid_from)) channel_age_seconds,count(*) FILTER(WHERE ops.telegram_reminder_eligible(j.id))::int eligible FROM ops.telegram_reminders j JOIN identity.person_interaction_channels ch ON ch.platform_identity_id=j.identity_id GROUP BY j.status'
              )
            ).rows
          : undefined;
      expect(delivered, JSON.stringify(diagnostic)).toBe(25);
    }
    expect(sender).toHaveBeenCalledTimes(125);
    expect(peak).toBeLessThanOrEqual(5);
  });
  it('expires previews and rejects abandoned leases instead of sending after the delivery window', async () => {
    await webhook('/remindtest');
    const job = (
      await query<{ id: string; lease_id: string }>(
        'SELECT * FROM ops.claim_telegram_reminders(1)',
        [],
        true
      )
    ).rows[0]!;
    await db.pool.query(
      "UPDATE ops.telegram_reminders SET leased_until=clock_timestamp()-INTERVAL '1 second',expires_at=clock_timestamp()-INTERVAL '1 second'"
    );
    expect(
      (
        await query<{ allowed: boolean }>(
          'SELECT ops.telegram_reminder_allowed($1,$2) allowed',
          [job.id, job.lease_id],
          true
        )
      ).rows[0]!.allowed
    ).toBe(false);
    const sender = vi.fn(async () => {});
    expect(await deliverTelegramReminders(runtime, sender, () => {})).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });
  it('honors half-hour zones and DST PostgreSQL scheduling semantics', async () => {
    const times = await db.pool.query(
      "SELECT ('2026-03-08'::date+TIME '02:00') AT TIME ZONE 'America/New_York' spring,('2026-11-01'::date+TIME '01:00') AT TIME ZONE 'America/New_York' autumn,('2026-10-13'::date+TIME '21:00') AT TIME ZONE 'Asia/Kolkata' half"
    );
    expect(times.rows[0]!.spring.toISOString()).toBe('2026-03-08T07:00:00.000Z');
    expect(times.rows[0]!.autumn.toISOString()).toBe('2026-11-01T06:00:00.000Z');
    expect(times.rows[0]!.half.toISOString()).toBe('2026-10-13T15:30:00.000Z');
  });
});
