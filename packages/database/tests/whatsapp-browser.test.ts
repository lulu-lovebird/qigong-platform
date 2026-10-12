import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const url = process.env.TEST_DATABASE_URL,
  suite = url ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('WhatsApp browser credentials and no practice messages', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
    runtime: Pool,
    role: string,
    person: string,
    identity: string,
    region: string;
  const subject = '65900000001',
    link = () => randomBytes(32).toString('base64url');
  let credential: string, session: string, csrf: string;
  const query = <T extends pg.QueryResultRow>(
    sql: string,
    values: unknown[] = [],
    worker = false
  ) =>
    withRequestContext(
      runtime,
      worker ? 'qigong_worker_runtime' : 'qigong_api_runtime',
      { requestId: randomUUID() },
      (c) => c.query<T>(sql, values)
    );
  const mint = (remember = true) =>
    query<{ data: { expiresAt: string; remembered: boolean } }>(
      'SELECT platform.create_whatsapp_browser_session($1,$2,$3,$4) data',
      [credential, session, csrf, remember]
    );
  beforeEach(async () => {
    db = await createIsolatedTestDatabase(url!);
    await runMigrations(db.pool, directory, 'vitest-browser');
    role = 'qigong_browser_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await db.pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await db.pool.query(`GRANT qigong_api_runtime,qigong_worker_runtime TO ${role}`);
    const connection = new URL(db.databaseUrl);
    connection.username = role;
    connection.password = password;
    runtime = new pg.Pool({ connectionString: connection.href });
    const actor = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://browser.example.invalid','reviewer','Synthetic reviewer') RETURNING id"
      )
    ).rows[0]!.id;
    region = (
      await db.pool.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('browser-global','global','全球','Global') RETURNING id),k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'browser-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'tw-general','operational','地區','Region' FROM k RETURNING id"
      )
    ).rows[0]!.id;
    person = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Synthetic WhatsApp learner','UTC') RETURNING id"
      )
    ).rows[0]!.id;
    identity = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'whatsapp',$2) RETURNING id",
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
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES('whatsapp',$1,'Synthetic learner','Synthetic learner','demo@example.invalid','+65900000001',$2,'approved',$3,CURRENT_TIMESTAMP,$4)",
      [subject, region, person, actor]
    );
    credential = link();
    session = link();
    csrf = link();
    await query('SELECT platform.begin_whatsapp_link($1,$2,$3)', [subject, credential, 'checkin']);
  });
  afterEach(async () => {
    await runtime.end();
    await db.pool.query(`DROP OWNED BY ${role}`);
    await db.pool.query(`DROP ROLE ${role}`);
    await db.dispose();
  });
  it('stores only hashes and continues after the private link expires without extending the service window', async () => {
    const result = (await mint()).rows[0]!.data;
    expect(result.remembered).toBe(true);
    const remaining = new Date(result.expiresAt).getTime() - Date.now();
    expect(remaining).toBeGreaterThan(29 * 86400000);
    expect(
      (
        await db.pool.query<{ seconds: string }>(
          'SELECT extract(epoch FROM(expires_at-created_at)) seconds FROM platform.whatsapp_browser_sessions'
        )
      ).rows[0]!.seconds
    ).toBe('2592000.000000');
    await db.pool.query(
      "UPDATE platform.whatsapp_links SET expires_at=clock_timestamp()-INTERVAL '1 second'"
    );
    expect(
      (
        await query<{ subject: string }>(
          "SELECT platform.whatsapp_link_subject($1,'checkin') subject",
          [session]
        )
      ).rows[0]!.subject
    ).toBe(subject);
    expect(
      (
        await query<{ ok: boolean }>('SELECT platform.whatsapp_legacy_checkin_allowed($1) ok', [
          session
        ])
      ).rows[0]!.ok
    ).toBe(false);
    expect((await db.pool.query('SELECT * FROM platform.whatsapp_service_windows')).rowCount).toBe(
      0
    );
    const stored = (
      await db.pool.query('SELECT token_hash,csrf_hash FROM platform.whatsapp_browser_sessions')
    ).rows;
    expect(JSON.stringify(stored)).not.toContain(session);
    expect(JSON.stringify(stored)).not.toContain(csrf);
  });
  it('issues only fifteen minutes when remember is disabled and refuses a second exchange', async () => {
    const result = (await mint(false)).rows[0]!.data;
    expect(result.remembered).toBe(false);
    expect(
      (
        await db.pool.query<{ seconds: string }>(
          'SELECT extract(epoch FROM(expires_at-created_at)) seconds FROM platform.whatsapp_browser_sessions'
        )
      ).rows[0]!.seconds
    ).toBe('900.000000');
    await expect(mint()).rejects.toThrow('invalid WhatsApp link');
  });
  it('rejects expired, foreign-purpose and non-approved initial proofs', async () => {
    await db.pool.query(
      "UPDATE platform.whatsapp_links SET expires_at=clock_timestamp()-INTERVAL '1 second'"
    );
    await expect(mint()).rejects.toThrow('invalid WhatsApp link');
    await db.pool.query('DELETE FROM platform.whatsapp_links');
    await query('SELECT platform.begin_whatsapp_link($1,$2,$3)', [
      '65900000002',
      credential,
      'apply'
    ]);
    await expect(mint()).rejects.toThrow('invalid WhatsApp link');
  });
  it('requires matching CSRF and revokes only the current device on logout', async () => {
    await mint();
    const first = session,
      firstCsrf = csrf;
    credential = link();
    session = link();
    csrf = link();
    await query('SELECT platform.begin_whatsapp_link($1,$2,$3)', [subject, credential, 'checkin']);
    await mint();
    await expect(
      query('SELECT platform.whatsapp_browser_session_info($1,$2)', [first, csrf])
    ).rejects.toThrow('invalid WhatsApp browser session');
    await query('SELECT platform.revoke_whatsapp_browser_session($1,$2)', [first, firstCsrf]);
    await expect(
      query('SELECT platform.whatsapp_browser_session_info($1,$2)', [first, firstCsrf])
    ).rejects.toThrow('invalid WhatsApp browser session');
    expect(
      (
        await query<{ data: { authenticated: boolean } }>(
          'SELECT platform.whatsapp_browser_session_info($1,$2) data',
          [session, csrf]
        )
      ).rows[0]!.data.authenticated
    ).toBe(true);
  });
  it.each(['person', 'identity', 'channel'] as const)(
    'revokes all devices when %s eligibility closes and never silently restores them',
    async (kind) => {
      await mint();
      await db.pool.query(
        'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE person_id=$1',
        [person]
      );
      if (kind === 'person')
        await db.pool.query("UPDATE identity.people SET status='suspended' WHERE id=$1", [person]);
      if (kind === 'identity')
        await db.pool.query(
          'UPDATE identity.platform_identities SET revoked_at=clock_timestamp() WHERE id=$1',
          [identity]
        );
      if (kind === 'channel')
        await db.pool.query(
          'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE person_id=$1',
          [person]
        );
      expect(
        (await db.pool.query('SELECT revoked_at FROM platform.whatsapp_browser_sessions')).rows[0]
          .revoked_at
      ).not.toBeNull();
      await expect(
        query('SELECT platform.whatsapp_browser_session_info($1,$2)', [session, csrf])
      ).rejects.toThrow('invalid WhatsApp browser session');
    }
  );
  it('rechecks absolute expiry and privacy acceptance for each request', async () => {
    await mint();
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
    await expect(
      query("SELECT platform.whatsapp_link_subject($1,'checkin')", [session])
    ).rejects.toThrow('privacy acceptance required');
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='draft'");
    await db.pool.query(
      "UPDATE platform.whatsapp_browser_sessions SET created_at=CURRENT_TIMESTAMP-INTERVAL '31 days',expires_at=CURRENT_TIMESTAMP-INTERVAL '1 day'"
    );
    await expect(
      query('SELECT platform.whatsapp_browser_session_info($1,$2)', [session, csrf])
    ).rejects.toThrow('invalid WhatsApp browser session');
  });
  it('saves practice and corrections with no WhatsApp outbox or worker sender even inside the service window', async () => {
    await mint();
    await query('SELECT platform.record_whatsapp_service_window($1,clock_timestamp())', [subject]);
    await query('SELECT platform.channel_workspace_timezone($1,$2,$3)', [
      'whatsapp',
      session,
      'UTC'
    ]);
    const saved = (
      await query<{ data: { version: number; receiptQueued: boolean } }>(
        'SELECT platform.channel_workspace_save($1,$2,$3,CURRENT_DATE,0,$4,$5,$6) data',
        ['whatsapp', session, randomUUID(), ['dayan_chu'], 'Private browser reflection', []]
      )
    ).rows[0]!.data;
    expect(saved.receiptQueued).toBe(false);
    const corrected = (
      await query<{ data: { receiptQueued: boolean } }>(
        'SELECT platform.channel_workspace_save($1,$2,$3,CURRENT_DATE,$4,$5,$6,$7) data',
        ['whatsapp', session, randomUUID(), saved.version, ['dayan_gao'], 'Private correction', []]
      )
    ).rows[0]!.data;
    expect(corrected.receiptQueued).toBe(false);
    expect(
      (await db.pool.query("SELECT * FROM ops.channel_practice_receipts WHERE platform='whatsapp'"))
        .rowCount
    ).toBe(0);
    expect(
      (await query('SELECT * FROM ops.claim_channel_practice_receipts($1,3)', ['whatsapp'], true))
        .rowCount
    ).toBe(0);
  });
  it('keeps runtime table access, worker issuance and pre-disable helpers sealed', async () => {
    await expect(query('SELECT * FROM platform.whatsapp_browser_sessions')).rejects.toMatchObject({
      code: '42501'
    });
    await expect(
      query(
        'SELECT platform.create_whatsapp_browser_session($1,$2,$3,true)',
        [credential, session, csrf],
        true
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      query('SELECT platform._pre_browser_queue_channel_practice_receipt($1,$2,$3,$4)', [
        'whatsapp',
        credential,
        randomUUID(),
        'regular'
      ])
    ).rejects.toMatchObject({ code: '42501' });
  });
});
