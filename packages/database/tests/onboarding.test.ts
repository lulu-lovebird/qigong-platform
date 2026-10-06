import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);

describeWithDatabase('messaging application review', () => {
  let pool: Pool;
  let runtimePool: Pool;
  let dispose: () => Promise<void>;
  let loginRole: string;
  let regionId: string;
  let otherRegionId: string;
  let reviewerId: string;
  let otherReviewerId: string;

  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(databaseUrl!);
    pool = db.pool;
    dispose = () => db.dispose();
    await runMigrations(pool, migrationsDirectory, 'vitest');
    loginRole = `qigong_review_${randomUUID().replaceAll('-', '')}`;
    const password = randomUUID().replaceAll('-', '');
    await pool.query(`CREATE ROLE ${loginRole} LOGIN PASSWORD '${password}' NOINHERIT NOBYPASSRLS`);
    await pool.query(`GRANT qigong_api_runtime TO ${loginRole}`);
    const url = new URL(db.databaseUrl);
    url.username = loginRole;
    url.password = password;
    runtimePool = new pg.Pool({ connectionString: url.toString() });
    const global = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (code, region_type, name_zh_tw, name_en)
       VALUES ('onboarding-global', 'global', '全球', 'Global') RETURNING id`
    );
    const country = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       VALUES ($1, 'onboarding-country', 'country', '國家', 'Country') RETURNING id`,
      [global.rows[0]!.id]
    );
    const regions = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       VALUES ($1, 'onboarding-a', 'operational', '甲', 'A'),
              ($1, 'onboarding-b', 'operational', '乙', 'B') RETURNING id`,
      [country.rows[0]!.id]
    );
    [regionId, otherRegionId] = regions.rows.map((row) => row.id);
    const principals = await pool.query<{ id: string }>(
      `INSERT INTO admin.principals (oidc_issuer, oidc_subject, display_name)
       VALUES ('https://example.com', 'reviewer-a', 'Reviewer A'),
              ('https://example.com', 'reviewer-b', 'Reviewer B') RETURNING id`
    );
    [reviewerId, otherReviewerId] = principals.rows.map((row) => row.id);
    await pool.query(
      `INSERT INTO admin.role_grants (principal_id, role_id, scope_type, region_id, reason)
       SELECT $1, id, 'region', $2, 'onboarding test' FROM admin.roles WHERE code = 'regional_admin'`,
      [reviewerId, regionId]
    );
    await pool.query(
      `INSERT INTO admin.role_grants (principal_id, role_id, scope_type, region_id, reason)
       SELECT $1, id, 'region', $2, 'onboarding test' FROM admin.roles WHERE code = 'regional_admin'`,
      [otherReviewerId, otherRegionId]
    );
  });

  afterAll(async () => {
    await runtimePool.end();
    await pool.query(`DROP OWNED BY ${loginRole}`);
    await pool.query(`DROP ROLE ${loginRole}`);
    await dispose();
  });

  const submit = async (subject: string) => {
    const result = await withRequestContext(
      pool,
      'qigong_worker_runtime',
      { requestId: randomUUID() },
      (client) =>
        client.query<{ id: string }>(
          `SELECT identity.submit_application('line', $1, 'New learner', $2) AS id`,
          [subject, regionId]
        )
    );
    return result.rows[0]!.id;
  };

  const review = (id: string, actor: string, decision: string, reason?: string) =>
    withRequestContext(
      runtimePool,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: actor },
      (client) =>
        client.query<{ person_id: string | null }>(
          `SELECT identity.decide_application($1, $2, $3) AS person_id`,
          [id, decision, reason ?? null]
        )
    );

  const completeApplication = async (id: string) => {
    await pool.query(
      `UPDATE identity.onboarding_applications
       SET learner_name = 'Test Learner', website_email = 'learner@example.com', phone_e164 = '+886912345678'
       WHERE id = $1`,
      [id]
    );
  };

  it('deduplicates requests, restricts region access and requires a rejection reason', async () => {
    const id = await submit('subject-reject');
    expect(await submit('subject-reject')).toBe(id);
    await expect(review(id, otherReviewerId, 'approved')).rejects.toThrow('permission denied');
    await expect(review(id, reviewerId, 'rejected')).rejects.toThrow('rejection reason required');
    await review(id, reviewerId, 'rejected', 'Not eligible');
    const rejected = await pool.query<{ status: string; person_id: string | null }>(
      'SELECT status, person_id FROM identity.onboarding_applications WHERE id = $1',
      [id]
    );
    expect(rejected.rows[0]).toEqual({ status: 'rejected', person_id: null });
    await expect(review(id, reviewerId, 'approved')).rejects.toThrow('not pending');
  });

  it('atomically activates only approved learners with a primary channel and audit event', async () => {
    const id = await submit('subject-approve');
    await expect(review(id, reviewerId, 'approved')).rejects.toThrow('identity details required');
    await completeApplication(id);
    const approved = await review(id, reviewerId, 'approved');
    const personId = approved.rows[0]!.person_id;
    expect(personId).toBeTruthy();
    const person = await pool.query<{
      website_subject: string | null;
      membership_status: string;
    }>('SELECT website_subject, membership_status FROM identity.people WHERE id = $1', [personId]);
    expect(person.rows[0]).toEqual({ website_subject: null, membership_status: 'pending' });
    const channel = await pool.query<{ activation_source: string }>(
      `SELECT activation_source FROM identity.person_interaction_channels
       WHERE person_id = $1 AND valid_to IS NULL`,
      [personId]
    );
    expect(channel.rows).toEqual([{ activation_source: 'onboarding' }]);
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.events WHERE target_id = $1`,
      [id]
    );
    expect(audit.rows).toEqual([{ action: 'onboarding.approved' }]);
    await expect(review(id, reviewerId, 'approved')).rejects.toThrow('not pending');
  });

  it('shows all active leaf methods by default and applies scoped personal visibility', async () => {
    const id = await submit('subject-methods');
    await completeApplication(id);
    const personId = (await review(id, reviewerId, 'approved')).rows[0]!.person_id!;
    const methods = await pool.query<{ id: string }>(
      `INSERT INTO core.practice_methods (code, method_type, name_zh_tw, name_en)
       VALUES ('method-a', 'leaf', '甲功法', 'A'), ('method-b', 'leaf', '乙功法', 'B')
       RETURNING id`
    );
    const list = () =>
      withRequestContext(
        runtimePool,
        'qigong_api_runtime',
        { requestId: randomUUID(), personId },
        (client) =>
          client.query<{ code: string }>(
            `SELECT code FROM core.visible_practice_methods($1, 'line')`,
            [personId]
          )
      );
    expect((await list()).rows.map(({ code }) => code)).toEqual(['method-a', 'method-b']);
    await expect(
      withRequestContext(
        runtimePool,
        'qigong_api_runtime',
        { requestId: randomUUID(), principalId: otherReviewerId },
        (client) =>
          client.query(`SELECT core.set_method_visibility($1, $2, false, 'Restricted')`, [
            personId,
            methods.rows[0]!.id
          ])
      )
    ).rejects.toThrow('permission denied');
    await withRequestContext(
      runtimePool,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: reviewerId },
      (client) =>
        client.query(`SELECT core.set_method_visibility($1, $2, false, 'Course selection')`, [
          personId,
          methods.rows[0]!.id
        ])
    );
    expect((await list()).rows.map(({ code }) => code)).toEqual(['method-b']);
  });

  it('requires audited functions for enrollment and method visibility writes', async () => {
    const id = await submit('subject-direct-write');
    await completeApplication(id);
    const personId = (await review(id, reviewerId, 'approved')).rows[0]!.person_id!;
    const method = await pool.query<{ id: string }>(
      `INSERT INTO core.practice_methods (code, method_type, name_zh_tw, name_en)
       VALUES ('restricted-method', 'leaf', '限制功法', 'Restricted') RETURNING id`
    );
    const course = await pool.query<{ id: string }>(
      `INSERT INTO core.courses (code, name) VALUES ('restricted-course', 'Restricted') RETURNING id`
    );
    await expect(
      withRequestContext(
        runtimePool,
        'qigong_api_runtime',
        { requestId: randomUUID(), principalId: reviewerId },
        (client) =>
          client.query(
            `INSERT INTO core.person_method_visibility
           (person_id, practice_method_id, visible, set_by_principal_id, reason)
           VALUES ($1, $2, false, $3, 'bypassed audit')`,
            [personId, method.rows[0]!.id, reviewerId]
          )
      )
    ).rejects.toThrow('permission denied');
    await expect(
      withRequestContext(
        runtimePool,
        'qigong_api_runtime',
        { requestId: randomUUID(), principalId: reviewerId },
        (client) =>
          client.query(
            `INSERT INTO core.person_course_enrollments
           (person_id, course_id, status, recorded_by_principal_id, reason)
           VALUES ($1, $2, 'completed', $3, 'bypassed audit')`,
            [personId, course.rows[0]!.id, reviewerId]
          )
      )
    ).rejects.toThrow('permission denied');
    await withRequestContext(
      runtimePool,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: reviewerId },
      (client) =>
        client.query(`SELECT core.record_course_enrollment($1, $2, 'enrolled', 'manual review')`, [
          personId,
          course.rows[0]!.id
        ])
    );
    const enrollment = await pool.query<{ status: string }>(
      'SELECT status FROM core.person_course_enrollments WHERE person_id = $1',
      [personId]
    );
    expect(enrollment.rows).toEqual([{ status: 'enrolled' }]);
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.events WHERE target_id = $1 AND action = 'enrollment.changed'`,
      [personId]
    );
    expect(audit.rows).toEqual([{ action: 'enrollment.changed' }]);
  });
});
