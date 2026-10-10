import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { buildApp } from '../src/app.js';
import { loadWhatsAppConfig, type WhatsAppConfig } from '../src/whatsapp-onboarding.js';
import { deliverOnboardingNotifications } from '../src/onboarding-notifications.js';
import { deliverChannelPracticeReceipts } from '../src/channel-practice-receipts.js';

const config: WhatsAppConfig = {
  phoneNumberId: '12345',
  businessAccountId: '67890',
  appSecret: 'test-whatsapp-app-secret-32-characters',
  verifyToken: 'test-whatsapp-verification-token',
  accessToken: 'mock-whatsapp-access-token',
  graphVersion: 'v99.0'
};
const body = (
  id: string,
  text: string,
  from = '886912345600',
  timestamp = Math.floor(Date.now() / 1000).toString()
) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: config.businessAccountId,
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: config.phoneNumberId },
            messages: [{ id, from, timestamp, type: 'text', text: { body: text } }]
          }
        }
      ]
    }
  ]
});
const signed = (payload: unknown) => {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return {
    method: 'POST' as const,
    url: '/whatsapp/webhook',
    payload: raw,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256':
        'sha256=' + createHmac('sha256', config.appSecret).update(raw).digest('hex')
    }
  };
};
const origin = { origin: 'https://checkin.baiyinqigong.org' };

describe('WhatsApp verification without database or external requests', () => {
  it('fails closed on incomplete configuration and leaves an unconfigured adapter disabled', async () => {
    expect(loadWhatsAppConfig({})).toBeUndefined();
    expect(() => loadWhatsAppConfig({ WHATSAPP_PHONE_NUMBER_ID: '12345' })).toThrow(
      'supplied together'
    );
    const app = buildApp({ pool: new pg.Pool(), logger: false });
    try {
      expect((await app.inject({ method: 'GET', url: '/whatsapp/webhook' })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
  it('verifies subscription tokens and raw-body signatures, not arbitrary accounts or bodies', async () => {
    const app = buildApp({ pool: new pg.Pool(), logger: false, whatsapp: config });
    try {
      const query = '/whatsapp/webhook?hub.mode=subscribe&hub.challenge=1234&hub.verify_token=';
      expect((await app.inject({ method: 'GET', url: query + config.verifyToken })).body).toBe(
        '1234'
      );
      expect((await app.inject({ method: 'GET', url: query + 'wrong' })).statusCode).toBe(403);
      expect(
        (await app.inject({ method: 'POST', url: '/whatsapp/webhook', payload: { entry: [] } }))
          .statusCode
      ).toBe(401);
      expect((await app.inject(signed('{'))).statusCode).toBe(400);
      expect(
        (await app.inject(signed({ object: 'whatsapp_business_account', entry: [] }))).statusCode
      ).toBe(200);
      const wrong = body('wrong-account', 'join');
      wrong.entry[0]!.id = '11111';
      expect((await app.inject(signed(wrong))).statusCode).toBe(403);
      const request = signed({ object: 'whatsapp_business_account', entry: [] });
      expect((await app.inject({ ...request, payload: request.payload + ' ' })).statusCode).toBe(
        401
      );
      expect((await app.inject(signed(' '.repeat(262145)))).statusCode).toBe(413);
      expect(
        (await app.inject({ method: 'POST', url: '/whatsapp/onboarding/apply', payload: {} }))
          .statusCode
      ).toBe(403);
      for (const kind of ['apply', 'checkin']) {
        const page = await app.inject({ method: 'GET', url: '/whatsapp/' + kind + '?lang=en' });
        expect(page.statusCode).toBe(200);
        expect(page.headers['cache-control']).toBe('no-store');
        expect(page.body).toContain('<html lang="en">');
        expect(page.body).not.toContain('Telegram');
      }
    } finally {
      await app.close();
    }
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);
describeWithDatabase('WhatsApp restricted-role onboarding and practice', () => {
  let pool: Pool;
  let runtime: Pool;
  let databaseName: string;
  let loginRole: string;
  let regionId: string;
  let principalId: string;
  const replies = vi.fn<(recipient: string, text: string) => Promise<void>>(async () => {});
  beforeAll(async () => {
    const source = new URL(databaseUrl!);
    if (!source.pathname.includes('test')) throw new Error('Expected test database');
    const maintenance = new pg.Client({ connectionString: databaseUrl });
    await maintenance.connect();
    databaseName = 'qigong_whatsapp_test_' + randomUUID().replaceAll('-', '');
    await maintenance.query(`CREATE DATABASE ${databaseName}`);
    await maintenance.end();
    source.pathname = '/' + databaseName;
    pool = new pg.Pool({ connectionString: source.toString() });
    await runMigrations(pool, migrationsDirectory, 'vitest');
    loginRole = 'qigong_whatsapp_' + randomUUID().replaceAll('-', '');
    const password = randomUUID();
    await pool.query(`CREATE ROLE ${loginRole} LOGIN PASSWORD '${password}' NOINHERIT NOBYPASSRLS`);
    await pool.query(`GRANT qigong_api_runtime TO ${loginRole}`);
    source.username = loginRole;
    source.password = password;
    runtime = new pg.Pool({ connectionString: source.toString() });
    const region = await pool.query<{ id: string }>(
      `WITH global AS (INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('wa-global','global','全球','Global') RETURNING id), country AS (INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'wa-country','country','台灣','Taiwan' FROM global RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'tw-general','operational','台灣地區','Taiwan Region' FROM country RETURNING id`
    );
    regionId = region.rows[0]!.id;
    const principal = await pool.query<{ id: string }>(
      "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://admin.example.com','wa-reviewer','Reviewer') RETURNING id"
    );
    principalId = principal.rows[0]!.id;
    await pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,reason) SELECT $1,id,'region',$2,'review' FROM admin.roles WHERE code='regional_admin'",
      [principalId, regionId]
    );
  });
  afterAll(async () => {
    if (runtime) await runtime.end();
    if (pool) {
      if (loginRole) {
        await pool.query(`DROP OWNED BY ${loginRole}`);
        await pool.query(`DROP ROLE ${loginRole}`);
      }
      await pool.end();
    }
    if (databaseName) {
      const maintenance = new pg.Client({ connectionString: databaseUrl });
      await maintenance.connect();
      await maintenance.query(`DROP DATABASE ${databaseName}`);
      await maintenance.end();
    }
  });
  const appFactory = (sendText = replies) =>
    buildApp({ pool: runtime, logger: false, whatsapp: { ...config, sendText } });
  const decide = (id: string) =>
    withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId },
      async (client) => {
        await client.query('SAVEPOINT review_diagnostic');
        try {
          return await client.query<{ person_id: string }>(
            "SELECT identity.decide_application($1,'approved',NULL) person_id",
            [id]
          );
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT review_diagnostic');
          const flags = (
            await client.query(
              "SELECT admin.request_principal_id()=$1::uuid actor_matches,admin.has_permission('onboarding.review') permission,admin.can_review_application($2) region_permission,extract(epoch FROM(clock_timestamp()-CURRENT_TIMESTAMP)) transaction_age",
              [principalId, regionId]
            )
          ).rows[0];
          const clockFlags = (
            await pool.query(
              'SELECT bool_or(g.valid_from<=clock_timestamp()) valid_clock,bool_or(g.valid_to IS NULL) open_ended,min(extract(epoch FROM(g.valid_from-clock_timestamp()))) until_valid FROM admin.role_grants g WHERE principal_id=$1',
              [principalId]
            )
          ).rows[0];
          throw Error(
            JSON.stringify({
              stage: 'review',
              kind:
                error instanceof Error && error.message === 'onboarding review permission denied'
                  ? 'review_denied'
                  : 'database_error',
              flags,
              clockFlags
            })
          );
        }
      }
    );

  it('persists English, deduplicates concurrent deliveries, applies with consent and creates an independent approved learner', async () => {
    const app = appFactory();
    try {
      expect((await app.inject(signed(body('language-en', 'language en')))).statusCode).toBe(200);
      const join = signed(body('join-1', 'join'));
      const responses = await Promise.all([app.inject(join), app.inject(join)]);
      expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
      expect(
        replies.mock.calls.filter(([, text]) => text.includes('/whatsapp/apply'))
      ).toHaveLength(1);
      const link = replies.mock.calls.at(-1)?.[1] ?? '';
      const token = link.match(/apply\?lang=en#([A-Za-z0-9_-]{43})/)?.[1];
      expect(token).toBeTruthy();
      const details = {
        token,
        locale: 'en',
        name: 'Shared WA Learner',
        email: 'sharedwa@example.com',
        phone: '+886912345600',
        region: 'tw-general',
        notificationConsent: true
      };
      const apply = (payload: Record<string, unknown>) =>
        app.inject({ method: 'POST', url: '/whatsapp/onboarding/apply', headers: origin, payload });
      expect((await apply({ ...details, notificationConsent: false })).statusCode).toBe(400);
      expect((await apply({ ...details, token: 'a'.repeat(43) })).statusCode).toBe(409);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/whatsapp/checkin/history',
            headers: origin,
            payload: { token }
          })
        ).statusCode
      ).toBe(409);
      expect((await apply(details)).statusCode).toBe(200);
      expect((await apply(details)).statusCode).toBe(409);
      const telegram = await pool.query<{ id: string }>(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164) VALUES('telegram','999999','Shared WA Learner',$1,'Shared WA Learner','sharedwa@example.com','+886912345600') RETURNING id",
        [regionId]
      );
      const telegramPerson = (await decide(telegram.rows[0]!.id)).rows[0]!.person_id;
      const application = await pool.query<{ id: string }>(
        "SELECT id FROM identity.onboarding_applications WHERE platform='whatsapp' AND external_subject_id='886912345600'"
      );
      const waPerson = (await decide(application.rows[0]!.id)).rows[0]!.person_id;
      expect(waPerson).not.toBe(telegramPerson);
      const sender = vi.fn(async () => {});
      expect(
        await deliverOnboardingNotifications(
          pool,
          async () => {},
          () => {},
          10,
          undefined,
          sender
        )
      ).toBe(2);
      expect(sender).toHaveBeenCalledWith('886912345600', 'approved', 'en');
      expect((await app.inject(signed(body('practice-1', 'checkin')))).statusCode).toBe(200);
      const checkinToken = replies.mock.calls
        .at(-1)?.[1]
        .match(/checkin\?lang=en#([A-Za-z0-9_-]{43})/)?.[1];
      expect(checkinToken).toBeTruthy();
      const request = (route: string, payload: Record<string, unknown> = {}) =>
        app.inject({
          method: 'POST',
          url: '/whatsapp/checkin/' + route,
          headers: origin,
          payload: { token: checkinToken, locale: 'en', ...payload }
        });
      expect((await request('methods')).json().methods).toHaveLength(22);
      expect(
        (await request('submit', { methods: ['dayan_chu', 'dayan_chu'], makeup: false })).statusCode
      ).toBe(409);
      const completed = await request('submit', { methods: ['dayan_chu'], makeup: false });
      expect(completed.statusCode, completed.body).toBe(200);
      expect((await request('submit', { methods: ['dayan_chu'], makeup: false })).statusCode).toBe(
        409
      );
      const checkinId = completed.json().checkin_id as string;
      expect(
        (await request('correct', { checkinId: randomUUID(), methods: ['dayan_gao'] })).statusCode
      ).toBe(409);
      const corrected = await request('correct', { checkinId, methods: ['dayan_gao'] });
      expect(corrected.statusCode, corrected.body).toBe(200);
      const history = (await request('history')).json();
      const name = (
        await pool.query<{ name_en: string }>(
          "SELECT name_en FROM core.practice_methods WHERE code='dayan_gao'"
        )
      ).rows[0]!.name_en;
      expect(history.entries[0].method_names).toEqual([name]);
      expect(history.totalDays).toBe(1);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/whatsapp/preferences/language',
            headers: origin,
            payload: { token: checkinToken, locale: 'zh_TW' }
          })
        ).statusCode
      ).toBe(200);
      await pool.query(
        "UPDATE core.checkins SET practice_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date-2 WHERE id=$1",
        [checkinId]
      );
      expect((await request('correct', { checkinId, methods: ['dayan_chu'] })).statusCode).toBe(
        409
      );
      await pool.query(
        'UPDATE identity.person_interaction_channels SET valid_to=CURRENT_TIMESTAMP WHERE person_id=$1',
        [waPerson]
      );
      expect((await request('history')).statusCode).toBe(409);
      await expect(runtime.query('SELECT * FROM platform.whatsapp_events')).rejects.toThrow(
        'permission denied'
      );
      await expect(runtime.query('SELECT * FROM platform.whatsapp_links')).rejects.toThrow(
        'permission denied'
      );
    } finally {
      await app.close();
    }
  });
  it('rolls back failed replies and safely resumes a retry without accepting a conflicting message ID', async () => {
    const failing = vi
      .fn<(recipient: string, text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue(undefined);
    const app = appFactory(failing);
    const request = signed(body('retry-message', 'join', '886912345601'));
    try {
      expect((await app.inject(request)).statusCode).toBe(503);
      expect(
        (
          await pool.query(
            "SELECT * FROM platform.whatsapp_events WHERE message_id='retry-message'"
          )
        ).rowCount
      ).toBe(0);
      expect(
        (await pool.query("SELECT * FROM platform.whatsapp_links WHERE subject='886912345601'"))
          .rowCount
      ).toBe(0);
      expect((await app.inject(request)).statusCode).toBe(200);
    } finally {
      await app.close();
    }
    const restarted = appFactory(failing);
    try {
      expect((await restarted.inject(request)).statusCode).toBe(200);
      expect(failing).toHaveBeenCalledTimes(2);
      expect(
        (await restarted.inject(signed(body('retry-message', 'language en', '886912345602'))))
          .statusCode
      ).toBe(503);
    } finally {
      await restarted.close();
    }
  });
  it('does not send free text for stale messages or decision templates after consent withdrawal', async () => {
    const app = appFactory();
    try {
      const before = replies.mock.calls.length;
      expect(
        (
          await app.inject(
            signed(
              body(
                'stale-message',
                'join',
                '886912345603',
                Math.floor(Date.now() / 1000 - 90000).toString()
              )
            )
          )
        ).statusCode
      ).toBe(200);
      expect(replies.mock.calls).toHaveLength(before);
      expect((await app.inject(signed(body('opt-out', 'STOP')))).statusCode).toBe(200);
      const application = await pool.query<{ id: string }>(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164) VALUES('whatsapp','886912345604','No Consent',$1,'No Consent','noconsent@example.com','+886912345604') RETURNING id",
        [regionId]
      );
      await pool.query(
        "INSERT INTO platform.whatsapp_notification_consents(subject,allowed) VALUES('886912345604',TRUE)"
      );
      expect(
        (await app.inject(signed(body('withdraw-consent', 'STOP', '886912345604')))).statusCode
      ).toBe(200);
      expect(
        (
          await pool.query<{ allowed: boolean }>(
            "SELECT allowed FROM platform.whatsapp_notification_consents WHERE subject='886912345604'"
          )
        ).rows[0]?.allowed
      ).toBe(false);
      await decide(application.rows[0]!.id);
      const sender = vi.fn(async () => {});
      const errors: unknown[] = [];
      await deliverOnboardingNotifications(
        pool,
        async () => {},
        (error) => errors.push(error),
        10,
        undefined,
        sender
      );
      expect(sender).not.toHaveBeenCalled();
      expect(errors).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('enforces token expiry and the database practice-timezone makeup/correction deadlines', async () => {
    const application = await pool.query<{ id: string }>(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164) VALUES('whatsapp','886912345605','Deadline',$1,'Deadline','deadlinewa@example.com','+886912345605') RETURNING id",
      [regionId]
    );
    const personId = (await decide(application.rows[0]!.id)).rows[0]!.person_id;
    const zones = await pool.query<{ name: string; before_noon: boolean }>(
      "SELECT name,(CURRENT_TIMESTAMP AT TIME ZONE name)::time<TIME '12:00' AS before_noon FROM pg_timezone_names WHERE name LIKE 'Etc/GMT%'"
    );
    const morning = zones.rows.find((zone) => zone.before_noon)!.name;
    const afternoon = zones.rows.find((zone) => !zone.before_noon)!.name;
    await pool.query('UPDATE identity.people SET practice_timezone=$1 WHERE id=$2', [
      morning,
      personId
    ]);
    await pool.query(
      'UPDATE core.person_region_assignments SET valid_from=CURRENT_DATE-3 WHERE person_id=$1',
      [personId]
    );
    const app = appFactory();
    try {
      expect(
        (await app.inject(signed(body('deadline-checkin', 'checkin', '886912345605')))).statusCode
      ).toBe(200);
      const token = replies.mock.calls.at(-1)?.[1].match(/checkin#([A-Za-z0-9_-]{43})/)?.[1];
      expect(token).toBeTruthy();
      const request = (route: string, payload: Record<string, unknown> = {}) =>
        app.inject({
          method: 'POST',
          url: '/whatsapp/checkin/' + route,
          headers: origin,
          payload: { token, ...payload }
        });
      const saved = await request('submit', { methods: ['dayan_chu'], makeup: true });
      expect(saved.statusCode, saved.body).toBe(200);
      const checkinId = saved.json().checkin_id as string;
      expect((await request('correct', { checkinId, methods: ['dayan_gao'] })).statusCode).toBe(
        200
      );
      await pool.query('UPDATE identity.people SET practice_timezone=$1 WHERE id=$2', [
        afternoon,
        personId
      ]);
      await pool.query(
        'UPDATE core.checkins SET practice_date=(CURRENT_TIMESTAMP AT TIME ZONE $1)::date-1 WHERE id=$2',
        [afternoon, checkinId]
      );
      expect((await request('submit', { methods: ['dayan_chu'], makeup: true })).statusCode).toBe(
        409
      );
      expect((await request('correct', { checkinId, methods: ['dayan_chu'] })).statusCode).toBe(
        409
      );
      await pool.query(
        "UPDATE platform.whatsapp_links SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE subject='886912345605' AND purpose='checkin'"
      );
      expect((await request('history')).statusCode).toBe(409);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/whatsapp/preferences/language',
            headers: origin,
            payload: { token, locale: 'en' }
          })
        ).statusCode
      ).toBe(403);
    } finally {
      await app.close();
    }
  });
  it('supports signed interactive menus, complete reports and idempotent saves with safe private receipts', async () => {
    const user = '886966666666',
      menu = vi.fn<(recipient: string, text: string, locale: 'zh_TW' | 'en') => Promise<void>>(
        async () => {}
      );
    const application = (
      await pool.query<{ id: string }>(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164) VALUES('whatsapp',$1,'Workspace learner',$2,'Workspace learner','workspace@example.test','+886966666666') RETURNING id",
        [user, regionId]
      )
    ).rows[0]!.id;
    await decide(application);
    const app = buildApp({
      pool: runtime,
      logger: false,
      whatsapp: { ...config, sendText: replies, sendWorkspaceMenu: menu }
    });
    try {
      expect(
        (await app.inject(signed(body('workspace-menu-' + randomUUID(), 'menu', user)))).statusCode
      ).toBe(200);
      const text = menu.mock.calls.at(-1)![1];
      expect(text).toContain('/whatsapp/journal');
      const token = text.match(/#([A-Za-z0-9_-]{43})/)![1]!;
      const request = (path: string, values: Record<string, unknown> = {}) =>
        app.inject({
          method: 'POST',
          url: '/whatsapp/' + path,
          headers: origin,
          payload: { token, locale: 'en', ...values }
        });
      const profile = (await request('workspace/profile')).json<{
        today: string;
        timezone: string;
        entries: Array<{ date: string; version: number }>;
      }>();
      expect(
        (await request('preferences/timezone', { timezone: profile.timezone })).statusCode
      ).toBe(200);
      for (const view of ['leaderboard', 'methods', 'achievements', 'history'])
        expect(
          (
            await request('workspace/report', {
              view,
              ...(view === 'history' ? { month: profile.today.slice(0, 7) } : {})
            })
          ).statusCode
        ).toBe(200);
      const payload = {
        requestId: randomUUID(),
        date: profile.today,
        version: profile.entries.find((e) => e.date === profile.today)?.version ?? 0,
        methods: ['dayan_chu'],
        practiceNote: 'Private WA journal must not be sent',
        feelingTagIds: []
      };
      const saved = await request('workspace/save', payload);
      expect(saved.statusCode).toBe(200);
      expect((await request('workspace/save', payload)).json()).toEqual(saved.json());
      expect((await request('journal/own', { page: 1 })).statusCode).toBe(200);
      const sender = vi.fn(async (recipient: string, summary: string) => {
        expect(recipient).toBe(user);
        expect(summary).not.toContain('Private WA journal');
      });
      expect(await deliverChannelPracticeReceipts(pool, 'whatsapp', sender, () => {}, 3)).toBe(1);
      expect(sender).toHaveBeenCalledTimes(1);
      const event = body('workspace-interactive-' + randomUUID(), 'unused', user);
      Object.assign(event.entry[0]!.changes[0]!.value.messages[0]!, {
        type: 'interactive',
        text: undefined,
        interactive: { type: 'list_reply', list_reply: { id: 'workspace:achievements' } }
      });
      expect((await app.inject(signed(event))).statusCode).toBe(200);
      expect(menu).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });
  it('gates signed WhatsApp joins without conflating privacy acceptance with notification consent', async () => {
    const user = '886955555555',
      send = vi.fn<(recipient: string, text: string) => Promise<void>>(async () => {});
    const app = appFactory(send);
    await pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
    try {
      expect(
        (await app.inject(signed(body('privacy-' + randomUUID(), 'join', user)))).statusCode
      ).toBe(200);
      const text = send.mock.calls.at(-1)![1];
      expect(text).toContain('/privacy?platform=whatsapp');
      const token = text.match(/#([A-Za-z0-9_-]{43})/)![1]!;
      const notice = (await app.inject('/learner/privacy/notice')).json<{
        version: string;
        hash: string;
      }>();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/learner/privacy/accept',
            headers: origin,
            payload: {
              platform: 'whatsapp',
              token,
              version: notice.version,
              hash: notice.hash,
              locale: 'en',
              accepted: true,
              reflectionConsent: false
            }
          })
        ).statusCode
      ).toBe(200);
      expect(
        (await app.inject(signed(body('privacy-continue-' + randomUUID(), 'join', user))))
          .statusCode
      ).toBe(200);
      expect(send.mock.calls.at(-1)![1]).toContain('/whatsapp/apply');
      expect(
        (
          await pool.query(
            'SELECT * FROM platform.whatsapp_notification_consents WHERE subject=$1',
            [user]
          )
        ).rowCount
      ).toBe(0);
    } finally {
      await app.close();
      await pool.query("UPDATE platform.learner_privacy_policies SET state='draft'");
    }
  });
});
