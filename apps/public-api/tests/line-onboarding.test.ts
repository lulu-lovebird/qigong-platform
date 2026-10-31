import { createHmac, randomUUID } from 'node:crypto';
import { Script } from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { buildApp } from '../src/app.js';
import { lineApplicationPage } from '../src/line-application-page.js';
import { lineCheckinPage } from '../src/line-checkin-page.js';
import { registerLineOnboarding, type LineConfig } from '../src/line-onboarding.js';
import { renderVenuePreview, venuePreviewRequest } from '../src/line-venue-checkin-page.js';
import { renderChannelWorkspacePage } from '../src/channel-workspace-pages.js';
import type { VenueGuidanceLookup } from '../src/venue-entry.js';
import type {
  VenueEntryAvailabilityDto,
  VenueEntryAvailabilityResult,
  VenueGuidanceLookupResult
} from '../src/venue-entry-guidance.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);
describeWithDatabase('LINE onboarding and checkin', () => {
  let pool: Pool;
  let runtimePool: Pool;
  let databaseName: string;
  let loginRole: string;
  let regionId: string;
  let principalId: string;
  const secret = 'test-line-channel-secret-32-characters';
  const lineUser = 'U' + 'a'.repeat(32);
  const sendReply = vi.fn(async (token: string, text: string) => {
    expect(token).toBeTruthy();
    expect(text).toBeTruthy();
  });
  const verify = vi.fn(async (idToken: string) => {
    if (idToken !== 'verified-token') throw new Error('invalid token');
    return lineUser;
  });
  beforeAll(async () => {
    const maintenance = new pg.Client({ connectionString: databaseUrl });
    await maintenance.connect();
    databaseName = `qigong_line_test_${randomUUID().replaceAll('-', '')}`;
    await maintenance.query(`CREATE DATABASE ${databaseName}`);
    await maintenance.end();
    const url = new URL(databaseUrl!);
    url.pathname = `/${databaseName}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    await runMigrations(pool, migrationsDirectory, 'vitest');
    loginRole = `qigong_line_${randomUUID().replaceAll('-', '')}`;
    const password = randomUUID().replaceAll('-', '');
    await pool.query(`CREATE ROLE ${loginRole} LOGIN PASSWORD '${password}' NOINHERIT NOBYPASSRLS`);
    await pool.query(`GRANT qigong_api_runtime TO ${loginRole}`);
    url.username = loginRole;
    url.password = password;
    runtimePool = new pg.Pool({ connectionString: url.toString() });
    const global = await pool.query<{ id: string }>(`INSERT INTO core.regions
      (code,region_type,name_zh_tw,name_en) VALUES ('line-global','global','全球','Global') RETURNING id`);
    const country = await pool.query<{ id: string }>(
      `INSERT INTO core.regions
      (parent_region_id,code,region_type,name_zh_tw,name_en)
      VALUES ($1,'line-tw','country','台灣','Taiwan') RETURNING id`,
      [global.rows[0]!.id]
    );
    const region = await pool.query<{ id: string }>(
      `INSERT INTO core.regions
      (parent_region_id,code,region_type,name_zh_tw,name_en)
      VALUES ($1,'tw-general','operational','台灣地區','Taiwan Region') RETURNING id`,
      [country.rows[0]!.id]
    );
    regionId = region.rows[0]!.id;
    const principal = await pool.query<{ id: string }>(
      `INSERT INTO admin.principals (oidc_issuer,oidc_subject,display_name) VALUES
       ('https://admin.example.com','line-admin','LINE Admin') RETURNING id`
    );
    principalId = principal.rows[0]!.id;
    await pool.query(
      `INSERT INTO admin.role_grants (principal_id,role_id,scope_type,region_id,reason)
      SELECT $1,id,'region',$2,'review' FROM admin.roles WHERE code='regional_admin'`,
      [principalId, regionId]
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

  it('uses configured LIFF deep links for checkin and workspace commands without embedding credentials', async () => {
    const reply = vi.fn(async (token: string, text: string) => {
      expect(token).toBe('menu-reply');
      expect(text).toBeTruthy();
    });
    const app = buildApp({
      pool: runtimePool,
      logger: false,
      line: {
        channelSecret: secret,
        channelAccessToken: 'mock-access-token',
        loginChannelId: '123456',
        liffId: '123456-test',
        reply,
        verifyIdToken: verify
      }
    });
    try {
      for (const text of ['打卡', '選單', '排行榜']) {
        const raw = JSON.stringify({
          events: [
            {
              type: 'message',
              webhookEventId: randomUUID(),
              replyToken: 'menu-reply',
              source: { type: 'user', userId: lineUser },
              message: { type: 'text', text }
            }
          ]
        });
        const response = await app.inject({
          method: 'POST',
          url: '/line/webhook',
          headers: {
            'content-type': 'application/json',
            'x-line-signature': createHmac('sha256', secret).update(raw).digest('base64')
          },
          payload: raw
        });
        expect(response.statusCode).toBe(200);
        const message = reply.mock.calls.at(-1)?.[1];
        expect(message).toBeDefined();
        if (typeof message !== 'string') throw Error('Missing signed LINE reply');
        for (const page of ['checkin', 'leaderboard', 'method-analysis', 'achievements', 'journal'])
          expect(message).toContain('https://liff.line.me/123456-test/' + page);
        expect(message.match(/https:\/\/checkin\.baiyinqigong\.org\/line\/[^\s]+/g)).toEqual([
          'https://checkin.baiyinqigong.org/line/help'
        ]);
        expect(message).not.toMatch(/access_token=|#/);
        expect(message).not.toContain('mock-access-token');
        expect(message).not.toContain('idToken');
      }
    } finally {
      await app.close();
    }
  });
  it('validates webhook signature and ID token, reviews the application, and checks in once', async () => {
    const app = buildApp({
      pool: runtimePool,
      logger: false,
      line: {
        channelSecret: secret,
        channelAccessToken: 'mock-access-token',
        loginChannelId: '123456',
        liffId: '123456-test',
        reply: sendReply,
        verifyIdToken: verify
      }
    });
    const event = {
      events: [
        {
          type: 'message',
          webhookEventId: 'event-1',
          replyToken: 'reply-1',
          source: { type: 'user', userId: lineUser },
          message: { type: 'text', text: '加入' }
        }
      ]
    };
    const raw = JSON.stringify(event);
    const signature = createHmac('sha256', secret).update(raw).digest('base64');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/line/webhook',
          payload: raw,
          headers: { 'content-type': 'application/json', 'x-line-signature': 'bad' }
        })
      ).statusCode
    ).toBe(401);
    const webhook = await app.inject({
      method: 'POST',
      url: '/line/webhook',
      payload: raw,
      headers: { 'content-type': 'application/json', 'x-line-signature': signature }
    });
    expect(webhook.statusCode, webhook.body).toBe(200);
    const link = sendReply.mock.calls.at(-1)?.[1] ?? '';
    const linkToken = link.match(
      /https:\/\/liff\.line\.me\/123456-test\/apply#([A-Za-z0-9_-]{43})/
    )?.[1];
    expect(link).not.toContain('https://checkin.baiyinqigong.org/line/apply');
    expect(linkToken).toBeTruthy();
    const headers = { origin: 'https://checkin.baiyinqigong.org' };
    const details = {
      token: linkToken,
      idToken: 'verified-token',
      name: 'LINE Learner',
      email: 'line@example.com',
      phone: '+886912345600',
      region: 'tw-general'
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/line/onboarding/apply',
          headers,
          payload: { ...details, idToken: 'fake' }
        })
      ).statusCode
    ).toBe(401);
    const applied = await app.inject({
      method: 'POST',
      url: '/line/onboarding/apply',
      headers,
      payload: details
    });
    expect(applied.statusCode, applied.body).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/line/onboarding/apply',
          headers,
          payload: details
        })
      ).statusCode
    ).toBe(409);
    const application = await pool.query<{ id: string }>(
      "SELECT id FROM identity.onboarding_applications WHERE platform='line' AND external_subject_id=$1",
      [lineUser]
    );
    await withRequestContext(
      runtimePool,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId },
      (client) =>
        client.query('SELECT identity.decide_application($1,$2,$3)', [
          application.rows[0]!.id,
          'approved',
          null
        ])
    );
    const request = (route: string, payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: `/line/checkin/${route}`,
        headers,
        payload: { idToken: 'verified-token', ...payload }
      });
    expect((await request('methods', {})).json().methods).toHaveLength(22);
    expect((await request('history', {})).json().totalDays).toBe(0);
    const saved = await request('submit', { methods: ['dayan_chu'], makeup: false });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await request('submit', { methods: ['dayan_chu'], makeup: false })).statusCode).toBe(
      409
    );
    const history = await request('history', {});
    expect(history.json().currentStreak).toBe(1);
    const id = history.json().entries[0].id as string;
    expect((await request('correct', { checkinId: id, methods: ['dayan_gao'] })).statusCode).toBe(
      200
    );
    expect((await request('history', {})).json().entries[0].method_codes).toEqual(['dayan_gao']);
    expect(
      (await request('correct', { checkinId: randomUUID(), methods: ['dayan_chu'] })).statusCode
    ).toBe(409);
    await app.close();
  });

  it('creates separate learners for identical cross-platform details without changing the existing channel', async () => {
    const telegram = await pool.query<{ id: string }>(
      `INSERT INTO identity.onboarding_applications
      (platform, external_subject_id, display_name, requested_region_id, learner_name, website_email, phone_e164)
      VALUES ('telegram','987654321','Shared Learner',$1,'Shared Learner','shared@example.com','+886912345601') RETURNING id`,
      [regionId]
    );
    const reviewed = await withRequestContext(
      runtimePool,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId },
      (client) =>
        client.query<{ person_id: string }>(
          'SELECT identity.decide_application($1,$2,$3) AS person_id',
          [telegram.rows[0]!.id, 'approved', null]
        )
    );
    const personId = reviewed.rows[0]!.person_id;
    const duplicateLine = 'U' + 'b'.repeat(32);
    const application = await pool.query<{ id: string }>(
      `INSERT INTO identity.onboarding_applications
      (platform, external_subject_id, display_name, requested_region_id, learner_name, website_email, phone_e164)
      VALUES ('line',$1,'Shared Learner',$2,' shared learner ','SHARED@EXAMPLE.COM','+886912345601') RETURNING id`,
      [duplicateLine, regionId]
    );
    await withRequestContext(
      runtimePool,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId },
      (client) =>
        client.query('SELECT identity.decide_application($1,$2,$3)', [
          application.rows[0]!.id,
          'approved',
          null
        ])
    );
    const linked = await pool.query<{ person_id: string }>(
      'SELECT person_id FROM identity.onboarding_applications WHERE id=$1',
      [application.rows[0]!.id]
    );
    const linePersonId = linked.rows[0]!.person_id;
    expect(linePersonId).not.toBe(personId);
    const channel = await pool.query<{ platform: string }>(
      `SELECT identity.platform
      FROM identity.person_interaction_channels channel
      JOIN identity.platform_identities identity ON identity.id=channel.platform_identity_id
      WHERE channel.person_id=$1 AND channel.valid_to IS NULL`,
      [personId]
    );
    expect(channel.rows).toEqual([{ platform: 'telegram' }]);
    const linkedLine = await pool.query<{ person_id: string }>(
      `SELECT person_id FROM identity.platform_identities WHERE platform='line' AND external_subject_id=$1`,
      [duplicateLine]
    );
    expect(linkedLine.rows).toEqual([{ person_id: linePersonId }]);
    const lineChannel = await pool.query<{ platform: string }>(
      `SELECT identity.platform FROM identity.person_interaction_channels channel
       JOIN identity.platform_identities identity ON identity.id=channel.platform_identity_id
       WHERE channel.person_id=$1 AND channel.valid_to IS NULL`,
      [linePersonId]
    );
    expect(lineChannel.rows).toEqual([{ platform: 'line' }]);
    const history = await withRequestContext(
      runtimePool,
      'qigong_api_runtime',
      { requestId: randomUUID() },
      (client) =>
        client.query<{ history: { totalDays: number } }>(
          'SELECT platform.line_checkin_history($1) AS history',
          [duplicateLine]
        )
    );
    expect(history.rows[0]?.history.totalDays).toBe(0);
  });

  // Policy A: matching personal details never authorize association.
  const reviewApplication = async (
    platform: 'line' | 'telegram',
    label: string,
    requestedRegion = regionId
  ) => {
    const subject = platform === 'line' ? 'U' + randomUUID().replaceAll('-', '') : randomUUID();
    const result = await pool.query<{ id: string }>(
      `INSERT INTO identity.onboarding_applications
       (platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164)
       VALUES ($1,$2,$3,$4,$3,$5,'+886912345699') RETURNING id`,
      [platform, subject, label, requestedRegion, `${label}@example.com`]
    );
    return { id: result.rows[0]!.id, subject };
  };
  const approveApplication = async (applicationId: string, actor = principalId) => {
    const result = await withRequestContext(
      runtimePool,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: actor },
      (client) =>
        client.query<{ person_id: string }>(
          'SELECT identity.decide_application($1,$2,$3) AS person_id',
          [applicationId, 'approved', null]
        )
    );
    return result.rows[0]!.person_id;
  };

  it('creates a separate learner when identical details have multiple approved candidates', async () => {
    const first = await reviewApplication('telegram', 'ambiguous');
    const second = await reviewApplication('telegram', 'ambiguous');
    const firstPerson = await approveApplication(first.id);
    const secondPerson = await approveApplication(second.id);
    expect(secondPerson).not.toBe(firstPerson);
    const line = await reviewApplication('line', 'ambiguous');
    const linePerson = await approveApplication(line.id);
    expect([firstPerson, secondPerson]).not.toContain(linePerson);
    const identities = await pool.query<{ person_id: string; external_subject_id: string }>(
      'SELECT person_id,external_subject_id FROM identity.platform_identities WHERE person_id=ANY($1::uuid[])',
      [[firstPerson, secondPerson, linePerson]]
    );
    expect(identities.rows).toHaveLength(3);
  });

  it('does not replace an existing LINE identity when personal details match', async () => {
    const first = await reviewApplication('line', 'same-platform');
    const firstPerson = await approveApplication(first.id);
    const second = await reviewApplication('line', 'same-platform');
    const secondPerson = await approveApplication(second.id);
    expect(secondPerson).not.toBe(firstPerson);
    const identities = await pool.query<{ person_id: string; external_subject_id: string }>(
      'SELECT person_id,external_subject_id FROM identity.platform_identities WHERE person_id=ANY($1::uuid[]) ORDER BY person_id',
      [[firstPerson, secondPerson]]
    );
    expect(identities.rows).toEqual(
      expect.arrayContaining([
        { person_id: firstPerson, external_subject_id: first.subject },
        { person_id: secondPerson, external_subject_id: second.subject }
      ])
    );
    expect(identities.rows).toHaveLength(2);
  });

  it('creates a separate learner in the authorized requested region without modifying matching people elsewhere', async () => {
    const original = await reviewApplication('telegram', 'cross-region');
    const personId = await approveApplication(original.id);
    const region = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id,code,region_type,name_zh_tw,name_en)
       SELECT parent_region_id,'line-other-region','operational','其它地區','Other Region'
       FROM core.regions WHERE id=$1 RETURNING id`,
      [regionId]
    );
    const otherRegion = region.rows[0]!.id;
    const principal = await pool.query<{ id: string }>(
      `INSERT INTO admin.principals (oidc_issuer,oidc_subject,display_name)
       VALUES ('https://admin.example.com','line-other-admin','Other Admin') RETURNING id`
    );
    const otherPrincipal = principal.rows[0]!.id;
    await pool.query(
      `INSERT INTO admin.role_grants (principal_id,role_id,scope_type,region_id,reason)
       SELECT $1,id,'region',$2,'review' FROM admin.roles WHERE code='regional_admin'`,
      [otherPrincipal, otherRegion]
    );
    const line = await reviewApplication('line', 'cross-region', otherRegion);
    await expect(approveApplication(line.id)).rejects.toThrow(
      'onboarding review permission denied'
    );
    expect(
      (
        await pool.query<{ status: string }>(
          'SELECT status FROM identity.onboarding_applications WHERE id=$1',
          [line.id]
        )
      ).rows[0]?.status
    ).toBe('pending');
    expect(
      (
        await pool.query('SELECT id FROM ops.onboarding_notifications WHERE application_id=$1', [
          line.id
        ])
      ).rowCount
    ).toBe(0);
    const linePersonId = await approveApplication(line.id, otherPrincipal);
    expect(linePersonId).not.toBe(personId);
    const lineAssignment = await pool.query<{ region_id: string }>(
      'SELECT region_id FROM core.person_region_assignments WHERE person_id=$1 AND valid_to IS NULL',
      [linePersonId]
    );
    expect(lineAssignment.rows).toEqual([{ region_id: otherRegion }]);
    const originalIdentities = await pool.query<{ platform: string }>(
      'SELECT platform FROM identity.platform_identities WHERE person_id=$1',
      [personId]
    );
    expect(originalIdentities.rows).toEqual([{ platform: 'telegram' }]);
    const assignments = await pool.query<{ region_id: string }>(
      'SELECT region_id FROM core.person_region_assignments WHERE person_id=$1 AND valid_to IS NULL',
      [personId]
    );
    expect(assignments.rows).toEqual([{ region_id: regionId }]);
    const visible = await withRequestContext(
      runtimePool,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: otherPrincipal },
      (client) => client.query('SELECT id FROM identity.people WHERE id=$1', [personId])
    );
    expect(visible.rowCount).toBe(0);
    const channel = await pool.query<{ platform: string }>(
      `SELECT identity.platform FROM identity.person_interaction_channels channel
       JOIN identity.platform_identities identity ON identity.id=channel.platform_identity_id
       WHERE channel.person_id=$1 AND channel.valid_to IS NULL`,
      [personId]
    );
    expect(channel.rows).toEqual([{ platform: 'telegram' }]);
  });

  it('allows only one concurrent approval of the same application', async () => {
    const application = await reviewApplication('line', 'same-application');
    const results = await Promise.allSettled([
      approveApplication(application.id),
      approveApplication(application.id)
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : undefined).toBeInstanceOf(Error);
    if (rejected?.status !== 'rejected')
      throw new Error('Expected one rejected duplicate approval');
    expect(rejected.reason).toMatchObject({ message: 'application is not pending' });
    const identities = await pool.query(
      "SELECT id FROM identity.platform_identities WHERE platform='line' AND external_subject_id=$1",
      [application.subject]
    );
    expect(identities.rowCount).toBe(1);
    expect(
      (
        await pool.query('SELECT id FROM ops.onboarding_notifications WHERE application_id=$1', [
          application.id
        ])
      ).rowCount
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT id FROM audit.events WHERE action='onboarding.approved' AND target_id=$1",
          [application.id]
        )
      ).rowCount
    ).toBe(1);
  });

  it('handles concurrent LINE approvals without replacing identities or duplicating notifications', async () => {
    const first = await reviewApplication('line', 'concurrent-line');
    const second = await reviewApplication('line', 'concurrent-line');
    const people = await Promise.all([approveApplication(first.id), approveApplication(second.id)]);
    expect(new Set(people).size).toBe(2);
    const channels = await pool.query<{ person_id: string }>(
      'SELECT person_id FROM identity.person_interaction_channels WHERE person_id=ANY($1::uuid[]) AND valid_to IS NULL',
      [people]
    );
    expect(channels.rows).toHaveLength(2);
    const notifications = await pool.query(
      'SELECT id FROM ops.onboarding_notifications WHERE application_id=ANY($1::uuid[])',
      [[first.id, second.id]]
    );
    expect(notifications.rowCount).toBe(2);
    const audit = await pool.query(
      "SELECT id FROM audit.events WHERE action='onboarding.approved' AND target_id=ANY($1::text[])",
      [[first.id, second.id]]
    );
    expect(audit.rowCount).toBe(2);
  });

  it.each(['telegram', 'line'] as const)(
    'creates separate cross-platform learners even when %s commits first',
    async (firstPlatform) => {
      const label = `concurrent-${firstPlatform}-first`;
      const first = await reviewApplication(firstPlatform, label);
      const second = await reviewApplication(
        firstPlatform === 'telegram' ? 'line' : 'telegram',
        label
      );
      let firstDecided!: () => void;
      let releaseFirst!: () => void;
      let secondStarted!: () => void;
      const decided = new Promise<void>((resolve) => {
        firstDecided = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const started = new Promise<void>((resolve) => {
        secondStarted = resolve;
      });
      const firstReview = withRequestContext(
        runtimePool,
        'qigong_api_runtime',
        { requestId: randomUUID(), principalId },
        async (client) => {
          try {
            const result = await client.query<{ person_id: string }>(
              'SELECT identity.decide_application($1,$2,$3) AS person_id',
              [first.id, 'approved', null]
            );
            firstDecided();
            await hold;
            return result.rows[0]!.person_id;
          } finally {
            firstDecided();
          }
        }
      );
      await decided;
      const secondReview = withRequestContext(
        runtimePool,
        'qigong_api_runtime',
        { requestId: randomUUID(), principalId },
        async (client) => {
          try {
            const result = client.query<{ person_id: string }>(
              'SELECT identity.decide_application($1,$2,$3) AS person_id',
              [second.id, 'approved', null]
            );
            secondStarted();
            return (await result).rows[0]!.person_id;
          } finally {
            secondStarted();
          }
        }
      );
      // Both review transactions overlap; neither may use personal details for association.
      await started;
      releaseFirst();
      const [firstPerson, secondPerson] = await Promise.all([firstReview, secondReview]);
      expect(secondPerson).not.toBe(firstPerson);
      const identities = await pool.query<{ person_id: string; platform: string }>(
        'SELECT person_id,platform FROM identity.platform_identities WHERE person_id=ANY($1::uuid[])',
        [[firstPerson, secondPerson]]
      );
      expect(identities.rows).toHaveLength(2);
      expect(identities.rows).toEqual(
        expect.arrayContaining([
          { person_id: firstPerson, platform: firstPlatform },
          { person_id: secondPerson, platform: firstPlatform === 'telegram' ? 'line' : 'telegram' }
        ])
      );
      const notifications = await pool.query(
        'SELECT id FROM ops.onboarding_notifications WHERE application_id=ANY($1::uuid[])',
        [[first.id, second.id]]
      );
      expect(notifications.rowCount).toBe(2);
    }
  );

  it('handles replayed join events and rejects stolen, expired and consumed links', async () => {
    const learner = 'U' + 'c'.repeat(32);
    const stranger = 'U' + 'd'.repeat(32);
    const replies = vi.fn<(replyToken: string, text: string) => Promise<void>>(async () => {});
    const app = buildApp({
      pool: runtimePool,
      logger: false,
      line: {
        channelSecret: secret,
        channelAccessToken: 'mock-access-token',
        loginChannelId: '123456',
        liffId: '123456-test',
        reply: replies,
        verifyIdToken: async (idToken) => (idToken === 'stranger' ? stranger : learner)
      }
    });
    try {
      const raw = JSON.stringify({
        events: [
          {
            type: 'message',
            webhookEventId: 'replayed-event',
            replyToken: 'replayed-reply',
            source: { type: 'user', userId: learner },
            message: { type: 'text', text: '加入' }
          }
        ]
      });
      const webhook = () =>
        app.inject({
          method: 'POST',
          url: '/line/webhook',
          payload: raw,
          headers: {
            'content-type': 'application/json',
            'x-line-signature': createHmac('sha256', secret).update(raw).digest('base64')
          }
        });
      expect((await webhook()).statusCode).toBe(200);
      expect((await webhook()).statusCode).toBe(200);
      expect(replies.mock.calls[0]?.[1]).toBe(replies.mock.calls[1]?.[1]);
      const linkToken = replies.mock.calls[0]?.[1].split('#')[1];
      const details = {
        token: linkToken,
        idToken: 'learner',
        name: 'Replay Learner',
        email: 'replay@example.com',
        phone: '+886912345602',
        region: 'tw-general'
      };
      const apply = (payload: typeof details) =>
        app.inject({
          method: 'POST',
          url: '/line/onboarding/apply',
          headers: { origin: 'https://checkin.baiyinqigong.org' },
          payload
        });
      expect((await apply({ ...details, idToken: 'stranger' })).statusCode).toBe(409);
      expect(
        (await pool.query('SELECT * FROM platform.line_links WHERE line_user_id=$1', [learner]))
          .rowCount
      ).toBe(1);
      await pool.query(
        "UPDATE platform.line_links SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE line_user_id=$1",
        [learner]
      );
      expect((await apply(details)).statusCode).toBe(409);
      expect((await webhook()).statusCode).toBe(200);
      expect((await apply(details)).statusCode).toBe(200);
      expect((await apply(details)).statusCode).toBe(409);
      expect((await webhook()).statusCode).toBe(200);
      expect(
        (
          await pool.query(
            "SELECT * FROM identity.onboarding_applications WHERE platform='line' AND external_subject_id=$1",
            [learner]
          )
        ).rowCount
      ).toBe(1);
      expect(
        (await pool.query('SELECT * FROM platform.line_links WHERE line_user_id=$1', [learner]))
          .rowCount
      ).toBe(0);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/line/checkin/submit',
            headers: { origin: 'https://checkin.baiyinqigong.org' },
            payload: { idToken: 'learner', methods: ['dayan_chu'], makeup: false }
          })
        ).statusCode
      ).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('enforces makeup and correction deadlines in the database practice timezone', async () => {
    const learner = 'U' + 'e'.repeat(32);
    const application = await pool.query<{ id: string }>(
      `INSERT INTO identity.onboarding_applications (platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164) VALUES ('line',$1,'Deadline Learner',$2,'Deadline Learner','deadline@example.com','+886912345603') RETURNING id`,
      [learner, regionId]
    );
    const approved = await withRequestContext(
      runtimePool,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId },
      (client) =>
        client.query<{ person_id: string }>(
          'SELECT identity.decide_application($1,$2,$3) AS person_id',
          [application.rows[0]!.id, 'approved', null]
        )
    );
    const personId = approved.rows[0]!.person_id;
    const zones = await pool.query<{ name: string; before_noon: boolean }>(
      `SELECT name, (CURRENT_TIMESTAMP AT TIME ZONE name)::time < TIME '12:00' AS before_noon FROM pg_timezone_names WHERE name LIKE 'Etc/GMT%'`
    );
    const beforeNoon = zones.rows.find((zone) => zone.before_noon)!.name;
    const afterNoon = zones.rows.find((zone) => !zone.before_noon)!.name;
    await pool.query('UPDATE identity.people SET practice_timezone=$1 WHERE id=$2', [
      beforeNoon,
      personId
    ]);
    await pool.query(
      'UPDATE core.person_region_assignments SET valid_from=CURRENT_DATE-10 WHERE person_id=$1',
      [personId]
    );
    const app = buildApp({
      pool: runtimePool,
      logger: false,
      line: {
        channelSecret: secret,
        channelAccessToken: 'mock-access-token',
        loginChannelId: '123456',
        liffId: '123456-test',
        reply: sendReply,
        verifyIdToken: async () => learner
      }
    });
    const request = (route: string, payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/line/checkin/' + route,
        headers: { origin: 'https://checkin.baiyinqigong.org' },
        payload: { idToken: 'learner', ...payload }
      });
    try {
      expect(
        (await request('submit', { methods: ['dayan_chu', 'dayan_chu'], makeup: true })).statusCode
      ).toBe(409);
      const saved = await request('submit', { methods: ['dayan_chu'], makeup: true });
      expect(saved.statusCode, saved.body).toBe(200);
      const checkinId = saved.json().checkin_id as string;
      expect((await request('correct', { checkinId, methods: ['dayan_gao'] })).statusCode).toBe(
        200
      );
      await pool.query('UPDATE identity.people SET practice_timezone=$1 WHERE id=$2', [
        afterNoon,
        personId
      ]);
      await pool.query(
        'UPDATE core.checkins SET practice_date=(CURRENT_TIMESTAMP AT TIME ZONE $1)::date-1 WHERE id=$2',
        [afterNoon, checkinId]
      );
      expect((await request('history', {})).json().makeupOpen).toBe(false);
      expect((await request('submit', { methods: ['dayan_chu'], makeup: true })).statusCode).toBe(
        409
      );
      expect((await request('correct', { checkinId, methods: ['dayan_chu'] })).statusCode).toBe(
        409
      );
      const selections = await pool.query<{ code: string }>(
        'SELECT method.code FROM core.checkin_method_selections selection JOIN core.practice_methods method ON method.id=selection.practice_method_id WHERE selection.checkin_id=$1',
        [checkinId]
      );
      expect(selections.rows).toEqual([{ code: 'dayan_gao' }]);
    } finally {
      await app.close();
    }
  });

  it('renders syntactically valid LIFF scripts', () => {
    const applicationHtml = lineApplicationPage('123456-test');
    expect(applicationHtml.indexOf('liff.login({ redirectUri: loginRedirectUri })')).toBeLessThan(
      applicationHtml.indexOf("history.replaceState(null, '', location.pathname")
    );
    for (const html of [lineApplicationPage('123456-test'), lineCheckinPage('123456-test')]) {
      const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
      expect(script).toBeTruthy();
      expect(script).toContain('liff.init');
      expect(() => new Script(script!)).not.toThrow();
    }
  });
  it('gates signed new LINE joins on explicit supplement acceptance without accepting a browser user ID', async () => {
    const newUser = 'U' + randomUUID().replaceAll('-', '');
    await pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
    const reply = vi.fn<(token: string, text: string) => Promise<void>>(async () => {});
    const app = buildApp({
      pool: runtimePool,
      logger: false,
      line: {
        channelSecret: secret,
        channelAccessToken: 'mock-access-token',
        loginChannelId: '123456',
        liffId: '123456-test',
        reply,
        verifyIdToken: async (value) => {
          if (value !== 'fresh-verified-id-token') throw Error('Unverified token');
          return newUser;
        }
      }
    });
    const command = async () => {
      const raw = JSON.stringify({
        events: [
          {
            type: 'message',
            webhookEventId: randomUUID(),
            replyToken: 'reply-privacy',
            source: { type: 'user', userId: newUser },
            message: { type: 'text', text: '加入' }
          }
        ]
      });
      return app.inject({
        method: 'POST',
        url: '/line/webhook',
        payload: raw,
        headers: {
          'content-type': 'application/json',
          'x-line-signature': createHmac('sha256', secret).update(raw).digest('base64')
        }
      });
    };
    try {
      expect((await command()).statusCode).toBe(200);
      const text = reply.mock.calls.at(-1)![1];
      expect(text).toContain('/privacy?platform=line');
      const token = text.match(/#([A-Za-z0-9_-]{43})/)![1]!;
      const notice = (await app.inject('/learner/privacy/notice')).json<{
        version: string;
        hash: string;
      }>();
      const headers = { origin: 'https://checkin.baiyinqigong.org' };
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/line/checkin/history',
            headers,
            payload: { idToken: 'fresh-verified-id-token' }
          })
        ).statusCode
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/learner/privacy/accept',
            headers,
            payload: {
              platform: 'line',
              token,
              version: notice.version,
              hash: notice.hash,
              locale: 'zh_TW',
              accepted: true,
              reflectionConsent: false,
              userId: newUser
            }
          })
        ).statusCode
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/learner/privacy/accept',
            headers,
            payload: {
              platform: 'line',
              token,
              version: notice.version,
              hash: notice.hash,
              locale: 'zh_TW',
              accepted: true,
              reflectionConsent: false
            }
          })
        ).statusCode
      ).toBe(200);
      expect((await command()).statusCode).toBe(200);
      expect(reply.mock.calls.at(-1)![1]).toContain('https://liff.line.me/123456-test/apply#');
    } finally {
      await app.close();
      await pool.query("UPDATE platform.learner_privacy_policies SET state='draft'");
    }
  });
});

// Synthetic HTTP registration tests: no SDK execution, provider traffic, SQL or physical NFC.
describe('LINE server-owned venue guidance adapter', () => {
  const apps: FastifyInstance[] = [];
  const forbidden = vi.fn(async () => {
    throw new Error('Unexpected provider, identity or database I/O');
  });
  const config: LineConfig = {
    channelSecret: 'mock-secret',
    channelAccessToken: 'mock-access-token',
    loginChannelId: 'mock-login-channel',
    liffId: 'mock-liff',
    verifyIdentity: forbidden,
    verifyIdToken: forbidden,
    verifyFriendship: forbidden,
    reply: forbidden
  };
  const venue = 'us-practice-hall';
  const session = {
    opensAt: '2026-10-30T15:45:00Z',
    startsAt: '2026-10-30T16:15:00Z',
    endsAt: '2026-10-31T16:00:00Z'
  };
  const availability = (
    state: VenueEntryAvailabilityDto['availability'] = 'open'
  ): VenueEntryAvailabilityDto => ({
    version: 1,
    availability: state,
    venue:
      state === 'not_found'
        ? null
        : { code: venue, name: 'Original 場地 & name', timezone: 'Asia/Taipei' },
    observedAt:
      state === 'before_open'
        ? '2026-10-30T15:30:00Z'
        : state === 'ended'
          ? '2026-10-31T17:00:00Z'
          : '2026-10-30T16:00:00Z',
    relevantSession: ['open', 'before_open', 'ended'].includes(state) ? session : null,
    nextSession: null
  });
  const resultFor = (
    state: VenueEntryAvailabilityDto['availability'] = 'open'
  ): VenueEntryAvailabilityResult =>
    state === 'unavailable'
      ? { status: 503, body: { error: 'venue_entry_unavailable' } }
      : {
          status: state === 'not_found' ? 404 : state === 'disabled' ? 410 : 200,
          body: availability(state)
        };
  const fixture = (
    lookup?: VenueGuidanceLookup,
    enabled = true,
    history = false,
    debug?: Parameters<typeof registerLineOnboarding>[5]
  ) => {
    const app = Fastify({ logger: false });
    apps.push(app);
    registerLineOnboarding(
      app,
      { connect: forbidden, query: forbidden } as unknown as Pool,
      config,
      enabled,
      history,
      debug,
      lookup
    );
    return app;
  };
  const urlFor = (context: 'direct' | 'primary' | 'residual', lang = 'en') => {
    const query = `venue=${venue}&source=nfc&lang=${lang}`;
    return context === 'direct'
      ? `/line/venue-checkin?${query}`
      : (context === 'primary' ? '/line/' : '/line/venue-checkin') +
          '?liff.state=' +
          encodeURIComponent('/venue-checkin?' + query) +
          '&code=mock-callback-secret';
  };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', forbidden);
  });
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    expect(forbidden).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it.each(
    (['direct', 'primary', 'residual'] as const).flatMap((context) =>
      (['zh_TW', 'zh_CN', 'en'] as const).flatMap((lang) =>
        (
          [
            'open',
            'before_open',
            'ended',
            'not_activity_day',
            'disabled',
            'not_found',
            'unavailable'
          ] as const
        ).map((state) => ({ context, lang, state }))
      )
    )
  )('calendar-only result: $context / $lang / $state', async ({ context, lang, state }) => {
    const result = resultFor(state);
    const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue(result);
    const response = await fixture(lookup).inject({
      url: urlFor(context, lang),
      headers: {
        host: 'evil.example',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'http'
      }
    });
    const primary = context === 'primary';
    const open = state === 'open';
    expect(response.statusCode).toBe(result.status);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.any(String), venue);
    expect(lookup.mock.calls[0]).toHaveLength(2);
    expect(response.headers).toMatchObject({
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
      'permissions-policy': `geolocation=${open && !primary ? '(self)' : '()'}, camera=(), microphone=()`,
      'content-security-policy':
        "default-src 'none'; script-src 'unsafe-inline' https://static.line-scdn.net; style-src 'unsafe-inline'; connect-src 'self' https://api.line.me; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    });
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.body).not.toMatch(
      /evil\.example|mock-callback-secret|preview-test|preview-debug-token/
    );
    expect(response.body).toContain(
      'Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting'
    );
    if (primary && state !== 'unavailable') {
      expect(response.body).toContain('withLoginOnExternalBrowser:false');
      expect(response.body.match(/liff\.init\(/g)).toHaveLength(1);
      expect(response.body).not.toMatch(
        /getIDToken|liff\.login|fetch\(|navigator\.|<button|<select|JSON\./
      );
    } else if (!open) {
      expect(response.body).not.toMatch(
        /<script|<button|<input|<select|fetch\(|getIDToken|navigator\./
      );
    } else {
      expect(response.body).toContain('id="guided-calendar"');
      expect(response.body).toContain('id="guided-checkin"');
      expect(response.body).toContain('withLoginOnExternalBrowser:false');
      expect(response.body.match(/liff\.init\(/g)).toHaveLength(1);
      expect(response.body).toContain('getIDToken');
      expect(response.body).toContain('/api/line/venue-entry-status');
    }
    if (!['not_found', 'unavailable'].includes(state)) {
      expect(response.body).toContain('Original 場地 &amp; name');
      expect(response.body).toContain('Asia/Taipei');
    }
  });
  it.each(
    [
      null,
      {},
      'legacy',
      { mode: 'guided' },
      { mode: 'unavailable' },
      { mode: 'legacy', extra: 'private-marker' },
      { mode: 'legacy', status: 503 },
      { status: 400, body: { error: 'invalid_venue_entry_request' } },
      { status: 503, body: { error: 'venue_entry_unavailable' } },
      { status: 503, body: { error: 'private-marker' } },
      { status: 200, body: { ...availability(), extra: 'private-marker' } },
      {
        status: 200,
        body: {
          ...availability(),
          venue: { code: 'other-hall', name: 'private-marker', timezone: 'UTC' }
        }
      },
      { status: 410, body: availability() },
      { status: 200, body: availability('unavailable') }
    ].flatMap((raw) => (['direct', 'primary'] as const).map((context) => ({ raw, context })))
  )('malformed or unavailable callback is never legacy: %#', async ({ raw, context }) => {
    const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue(raw as VenueGuidanceLookupResult);
    const response = await fixture(lookup).inject(urlFor(context));
    expect(response.statusCode).toBe(503);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.any(String), venue);
    expect(response.headers['permissions-policy']).toBe('geolocation=(), camera=(), microphone=()');
    expect(response.headers.location).toBeUndefined();
    expect(response.body).toContain('Venue lookup unavailable');
    expect(response.body).not.toMatch(
      /<script|<button|private-marker|preview-test|mock-callback-secret/
    );
  });
  it.each(['direct', 'primary'] as const)(
    'throwing callback stays bounded: %s',
    async (context) => {
      const lookup = vi.fn<VenueGuidanceLookup>().mockRejectedValue(new Error('private-marker'));
      const response = await fixture(lookup).inject(urlFor(context));
      expect(response.statusCode).toBe(503);
      expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.any(String), venue);
      expect(response.body).not.toMatch(/private-marker|<script|preview-test/);
      expect(response.headers['permissions-policy']).toBe(
        'geolocation=(), camera=(), microphone=()'
      );
      expect(response.headers.location).toBeUndefined();
    }
  );
  const invalidStates = [
    '/venue-checkin',
    '/venue-checkin?venue=bad',
    `/venue-checkin?venue=${venue}&venue=${venue}`,
    `/venue-checkin?venue=${venue}&source=nfc&source=qr`,
    `/venue-checkin?venue=${venue}&mode=legacy`,
    `/venue-checkin?venue=${venue}#private-marker`,
    '/venue-checkin/extra?venue=' + venue,
    '/venue-checkin?venue=%3Cscript%3Eprivate-marker',
    '/venue-checkin?venue=' + 'a'.repeat(65)
  ];
  it.each([
    '/line/venue-checkin',
    ...invalidStates.map((state) => '/line/' + '?liff.state=' + encodeURIComponent(state)),
    ...invalidStates.map((state) => '/line/venue-checkin?liff.state=' + encodeURIComponent(state)),
    `/line/venue-checkin?venue=${venue}&mode=legacy`,
    `/line/venue-checkin?venue=${venue}&venue=${venue}`,
    urlFor('primary') + '&liff.state=' + encodeURIComponent('/venue-checkin?venue=' + venue),
    urlFor('primary') + '&code=duplicate',
    '/line/venue-checkin?liff.state=' +
      encodeURIComponent('//evil.example/venue-checkin?venue=' + venue)
  ])('invalid preview is 400 without callback or SDK: %s', async (url) => {
    const lookup = vi.fn<VenueGuidanceLookup>();
    const response = await fixture(lookup).inject(url);
    expect(response.statusCode).toBe(400);
    expect(lookup).not.toHaveBeenCalled();
    expect(response.headers.location).toBeUndefined();
    expect(response.body).not.toMatch(/<script|mock-callback-secret|private-marker|evil\.example/);
  });
  it.each(['/line/', '/line/checkin', '/line/?liff.state=%2Fapply%23private-marker'])(
    'ordinary workspace stays unchanged: %s',
    async (url) => {
      const lookup = vi.fn<VenueGuidanceLookup>();
      const response = await fixture(lookup).inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(
        renderChannelWorkspacePage({ platform: 'line', liffId: config.liffId }, 'checkin', 'zh_TW')
      );
      expect(lookup).not.toHaveBeenCalled();
    }
  );
  it('application and independent venue history never use guidance', async () => {
    const lookup = vi.fn<VenueGuidanceLookup>();
    const app = fixture(lookup, true, true);
    const apply = await app.inject('/line/apply?lang=en');
    expect(apply.statusCode).toBe(200);
    expect(apply.body).toBe(lineApplicationPage(config.liffId, 'en'));
    const direct = await app.inject('/line/venue-history?lang=en');
    const primary = await app.inject(
      '/line/?liff.state=' + encodeURIComponent('/venue-history?lang=en')
    );
    expect(direct.statusCode).toBe(200);
    expect(primary.statusCode).toBe(200);
    expect(primary.body).toBe(direct.body);
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each(['absent', 'sentinel', 'qr-off'] as const)(
    'legacy rendering is byte-for-byte unchanged: %s',
    async (mode) => {
      const lookup =
        mode === 'absent'
          ? undefined
          : vi.fn<VenueGuidanceLookup>().mockResolvedValue({ mode: 'legacy' });
      const enabled = mode !== 'qr-off';
      const app = fixture(lookup, enabled, true);
      for (const context of ['direct', 'primary'] as const) {
        const url = urlFor(context);
        const preview = venuePreviewRequest(url);
        if (preview.kind !== 'preview') throw new Error('Invalid synthetic fixture');
        const response = await app.inject(url);
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe(
          renderVenuePreview(config.liffId, preview.entry, enabled ? 'checkin' : 'preview', true)
        );
        expect(response.headers['permissions-policy']).toBe('geolocation=(self)');
        expect(response.headers.location).toBeUndefined();
        expect(response.body).not.toContain('guided-calendar');
      }
      if (mode === 'sentinel') expect(lookup).toHaveBeenCalledTimes(2);
      else if (lookup) expect(lookup).not.toHaveBeenCalled();
    }
  );
  it('QR off never calls even a throwing guided reader', async () => {
    const lookup = vi.fn<VenueGuidanceLookup>().mockRejectedValue(Error('Must never execute'));
    const response = await fixture(lookup, false).inject(urlFor('direct'));
    expect(response.statusCode).toBe(200);
    expect(response.headers['permissions-policy']).toBe('geolocation=(self)');
    expect(response.body).not.toContain('/api/line/venue-checkin');
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each(['2000-01-01T00:00:00Z', '2099-01-01T00:00:00Z'])(
    'legacy sentinel preserves server debug TTL: %s',
    async (expiresAt) => {
      const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue({ mode: 'legacy' });
      const response = await fixture(lookup, true, false, {
        venueCode: 'tw-location-test',
        expiresAt
      }).inject('/line/venue-checkin?venue=tw-location-test&lang=en');
      expect(response.statusCode).toBe(200);
      expect(response.body.includes('id="preview-debug-token"')).toBe(expiresAt.startsWith('2099'));
      expect(response.headers['permissions-policy']).toBe('geolocation=(self)');
      expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'tw-location-test');
    }
  );
  it('canonical disabled sentinel stays 410 without GPS or debug controls', async () => {
    const result: VenueEntryAvailabilityResult = {
      status: 410,
      body: {
        ...availability('disabled'),
        venue: { code: 'tw-location-test', name: 'Canonical test & name', timezone: 'UTC' }
      }
    };
    const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue(result);
    const response = await fixture(lookup, true, false, {
      venueCode: 'tw-location-test',
      expiresAt: '2099-01-01T00:00:00Z'
    }).inject('/line/venue-checkin?venue=tw-location-test&lang=en');
    expect(response.statusCode).toBe(410);
    expect(response.body).toContain('Canonical test &amp; name');
    expect(response.body).not.toMatch(/<script|preview-debug-token|<button|navigator/);
    expect(response.headers['permissions-policy']).toBe('geolocation=(), camera=(), microphone=()');
    expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'tw-location-test');
  });
  it('proper-name injection is escaped and cookie locale requires no preferences I/O', async () => {
    const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue({
      status: 200,
      body: {
        ...availability('before_open'),
        venue: {
          code: venue,
          name: '</script><script>private-marker()</script>',
          timezone: 'UTC'
        }
      }
    });
    const response = await fixture(lookup).inject({
      url: '/line/venue-checkin?venue=' + venue,
      headers: { cookie: '__Host-qigong-learner-locale=en' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="en">');
    expect(response.body).toContain('&lt;/script&gt;&lt;script&gt;private-marker()&lt;/script&gt;');
    expect(response.body).not.toContain('<script');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.any(String), venue);
  });
});
