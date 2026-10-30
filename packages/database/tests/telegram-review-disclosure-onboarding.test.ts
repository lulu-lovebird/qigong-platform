import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const version = 'telegram-learner-review-v1';
const opaque = () => randomBytes(32).toString('base64url');
type Channel = 'line' | 'telegram' | 'whatsapp';
suite('Application-bound notice ACK: verified submission wrappers, actual nonowner SQL', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
  let runtime: pg.Pool;
  let role: string;
  const query = (sql: string, values: unknown[] = []) =>
    withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (c) =>
      c.query(sql, values)
    );
  beforeEach(async () => {
    db = await createIsolatedTestDatabase(base!);
    await runMigrations(db.pool, directory, 'disclosure-test');
    role = 'disclosure_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await db.pool.query(
      `CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}';GRANT qigong_api_runtime TO ${role}`
    );
    const url = new URL(db.databaseUrl);
    url.username = role;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    await db.pool.query(
      "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('disclosure-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'disclosure-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'tw-general','operational','地區','Region' FROM c"
    );
  });
  afterEach(async () => {
    await runtime?.end();
    if (role) {
      await db.pool.query(`DROP OWNED BY ${role};DROP ROLE ${role}`);
    }
    await db?.dispose();
  });
  const link = async (channel: Channel, subject: string, token: string) => {
    if (channel === 'line')
      await db.pool.query(
        "INSERT INTO platform.line_links(line_user_id,token_hash,expires_at) VALUES($1,public.digest($2,'sha256'),clock_timestamp()+INTERVAL '5 minutes')",
        [subject, token]
      );
    else if (channel === 'telegram')
      await db.pool.query(
        "INSERT INTO platform.telegram_application_links(telegram_user_id,token_hash,expires_at) VALUES($1,public.digest($2,'sha256'),clock_timestamp()+INTERVAL '5 minutes')",
        [subject, token]
      );
    else
      await db.pool.query(
        "INSERT INTO platform.whatsapp_links(subject,purpose,token_hash,expires_at) VALUES($1,'apply',public.digest($2,'sha256'),clock_timestamp()+INTERVAL '5 minutes')",
        [subject, token]
      );
  };
  const submit = (
    channel: Channel,
    subject: string,
    token: string,
    notice: string | null | undefined = version
  ) => {
    const values: unknown[] = [
      token,
      'Synthetic learner',
      'disclosure@example.invalid',
      '+659900000061',
      'tw-general'
    ];
    if (channel === 'line') values.unshift(subject);
    if (channel === 'whatsapp') values.push('en', true);
    if (notice !== undefined) values.push(notice);
    return query(
      `SELECT platform.submit_${channel}_application${notice === undefined ? '' : '_v2'}(${values.map((_, i) => '$' + (i + 1)).join(',')}) status`,
      values
    );
  };
  const rows = () =>
    db.pool.query(
      'SELECT platform,external_subject_id,status,telegram_review_notice_version FROM identity.onboarding_applications ORDER BY external_subject_id'
    );
  it.each(['line', 'telegram', 'whatsapp'] as const)(
    '%s binds only successful complete pending submissions; invalid versions/tokens and old clients cannot mark receipts',
    async (channel) => {
      const subject = channel === 'line' ? 'U' + randomBytes(16).toString('hex') : '548000000061';
      const token = opaque();
      await link(channel, subject, token);
      for (const notice of [
        null,
        'old',
        'telegram-learner-review-v1 ',
        'telegram-learner-review-v2'
      ]) {
        await expect(submit(channel, subject, token, notice)).rejects.toThrow(
          'invalid application notice version'
        );
        expect((await rows()).rows).toEqual([]);
      }
      await expect(submit(channel, subject, opaque())).rejects.toThrow();
      if (channel === 'line')
        await expect(submit(channel, 'U' + randomBytes(16).toString('hex'), token)).rejects.toThrow(
          'link expired or used'
        );
      expect((await rows()).rows).toEqual([]);
      expect((await submit(channel, subject, token)).rows).toEqual([{ status: 'pending' }]);
      expect((await rows()).rows).toEqual([
        {
          platform: channel,
          external_subject_id: subject,
          status: 'pending',
          telegram_review_notice_version: version
        }
      ]);
      await expect(submit(channel, subject, token)).rejects.toThrow();
      // A different, successful old-client submission stays NULL, even on schema59.
      const legacy = channel === 'line' ? 'U' + randomBytes(16).toString('hex') : '548000000062';
      const legacyToken = opaque();
      await link(channel, legacy, legacyToken);
      // Explicit undefined would use the helper default; call the old signature directly.
      const args: unknown[] = [
        legacyToken,
        'Legacy learner',
        'legacy@example.invalid',
        '+659900000062',
        'tw-general'
      ];
      if (channel === 'line') args.unshift(legacy);
      if (channel === 'whatsapp') args.push('en', true);
      await query(
        `SELECT platform.submit_${channel}_application(${args.map((_, i) => '$' + (i + 1)).join(',')})`,
        args
      );
      expect(
        (await rows()).rows.find((row) => row.external_subject_id === legacy)
          ?.telegram_review_notice_version
      ).toBeNull();
      expect(
        (await db.pool.query('SELECT * FROM platform.learner_privacy_acceptances')).rows
      ).toEqual([]);
      await expect(
        query('UPDATE identity.onboarding_applications SET telegram_review_notice_version=$1', [
          version
        ])
      ).rejects.toThrow('permission denied');
    }
  );
  it.each(['line', 'telegram', 'whatsapp'] as const)(
    '%s preserves privacy checks and rolls back the consumed link and application if receipt writing fails',
    async (channel) => {
      const subject = channel === 'line' ? 'U' + randomBytes(16).toString('hex') : '548000000063';
      const token = opaque();
      await link(channel, subject, token);
      await db.pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
      await expect(submit(channel, subject, token)).rejects.toThrow('privacy acceptance required');
      expect((await rows()).rows).toEqual([]);
      await db.pool.query("UPDATE platform.learner_privacy_policies SET state='draft'");
      await db.pool.query(
        "CREATE FUNCTION identity.disclosure_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.telegram_review_notice_version IS NOT NULL THEN RAISE EXCEPTION 'Synthetic receipt write failure';END IF;RETURN NEW;END$$;CREATE TRIGGER disclosure_test_fail BEFORE UPDATE ON identity.onboarding_applications FOR EACH ROW EXECUTE FUNCTION identity.disclosure_test_fail()"
      );
      await expect(submit(channel, subject, token)).rejects.toThrow(
        'Synthetic receipt write failure'
      );
      expect((await rows()).rows).toEqual([]);
      await db.pool.query('DROP TRIGGER disclosure_test_fail ON identity.onboarding_applications');
      expect((await submit(channel, subject, token)).rows).toEqual([{ status: 'pending' }]);
    }
  );
  it.each(['line', 'telegram', 'whatsapp'] as const)(
    '%s cannot attach a receipt to an already reviewed application',
    async (channel) => {
      const subject = channel === 'line' ? 'U' + randomBytes(16).toString('hex') : '548000000065';
      const token = opaque();
      await link(channel, subject, token);
      const reviewer = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://disclosure.example.invalid','reviewer','Synthetic reviewer') RETURNING id"
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,status,decided_at,decided_by_principal_id,rejection_reason) SELECT $1,$2,'Synthetic reviewed',id,'rejected',clock_timestamp(),$3,'Synthetic rejection' FROM core.regions WHERE code='tw-general'",
        [channel, subject, reviewer]
      );
      await expect(submit(channel, subject, token)).rejects.toThrow('already reviewed');
      expect((await rows()).rows).toEqual([
        {
          platform: channel,
          external_subject_id: subject,
          status: 'rejected',
          telegram_review_notice_version: null
        }
      ]);
    }
  );
  it('grants wrappers only to the API, with fixed definer search paths and no new table privileges', async () => {
    const functions = (
      await db.pool.query<{
        api: boolean;
        worker: boolean;
        public: boolean;
        prosecdef: boolean;
        proconfig: string[];
        owner: boolean;
      }>(
        "SELECT has_function_privilege('qigong_api_runtime',p.oid,'EXECUTE') api,has_function_privilege('qigong_worker_runtime',p.oid,'EXECUTE') worker,EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public,p.prosecdef,p.proconfig,p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='platform' AND p.proname IN('submit_line_application_v2','submit_telegram_application_v2','submit_whatsapp_application_v2')"
      )
    ).rows;
    expect(functions).toHaveLength(3);
    for (const fn of functions)
      expect(fn).toEqual({
        api: true,
        worker: false,
        public: false,
        prosecdef: true,
        proconfig: ['search_path=pg_catalog'],
        owner: true
      });
    expect(
      (
        await query(
          'SELECT current_user,session_user,(SELECT rolbypassrls FROM pg_roles WHERE rolname=session_user) bypass'
        )
      ).rows
    ).toEqual([{ current_user: 'qigong_api_runtime', session_user: role, bypass: false }]);
    // Existing table SELECT is RLS-filtered, not a newly denied table grant.
    await db.pool.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id) SELECT 'telegram','548000000064','Synthetic RLS',id FROM core.regions WHERE code='tw-general'"
    );
    expect(
      (await query('SELECT telegram_review_notice_version FROM identity.onboarding_applications'))
        .rows
    ).toEqual([]);
  });
});
