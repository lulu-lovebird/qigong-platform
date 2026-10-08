import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const url = process.env.TEST_DATABASE_URL;
const migrations = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);
const suite = url ? describe : describe.skip;
interface Tag {
  id: string;
  name_zh_tw: string;
  name_en: string;
  active: boolean;
}
interface Catalog {
  version: number;
  tags: Tag[];
}
suite('private practice notes and stable feeling tag snapshots', () => {
  let pool: Pool;
  let runtime: Pool;
  let dispose: () => Promise<void>;
  let role: string;
  let principal: string;
  let person: string;
  let checkin: string;
  let credential: string;
  let token: string;
  const context = () => ({ requestId: randomUUID(), principalId: principal });
  const query = <Row extends pg.QueryResultRow>(
    sql: string,
    values: unknown[] = [],
    asAdmin = false
  ) =>
    withRequestContext(
      runtime,
      'qigong_api_runtime',
      asAdmin ? context() : { requestId: randomUUID() },
      (client) => client.query<Row>(sql, values)
    );
  const catalog = async () =>
    (await query<{ data: Catalog }>('SELECT admin.feeling_tag_catalog() data', [], true)).rows[0]!
      .data;
  const saveTags = async (
    version: number,
    tags: ReadonlyArray<Omit<Tag, 'id'> & { id?: string }>
  ) =>
    (
      await query<{ data: Catalog }>(
        'SELECT admin.save_feeling_tags($1,$2::jsonb) data',
        [version, JSON.stringify(tags)],
        true
      )
    ).rows[0]!.data;
  const save = (
    note: string | null,
    ids: string[] | null,
    id = checkin,
    channel = 'line',
    auth = credential
  ) =>
    query('SELECT platform.save_practice_note($1,$2,$3,$4,$5::uuid[])', [
      channel,
      auth,
      id,
      note,
      ids
    ]);
  beforeEach(async () => {
    const database = await createIsolatedTestDatabase(url!);
    pool = database.pool;
    dispose = () => database.dispose();
    await runMigrations(pool, migrations, 'vitest');
    role = 'qigong_notes_' + randomUUID().replaceAll('-', '');
    const source = new URL(database.databaseUrl);
    const password = randomBytes(24).toString('hex');
    await pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await pool.query(`GRANT qigong_api_runtime TO ${role}`);
    source.username = role;
    source.password = password;
    runtime = new pg.Pool({ connectionString: source.href });
    principal = (
      await pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://notes.example','root','Notes admin') RETURNING id"
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,reason) SELECT $1,id,'global','isolated notes tests' FROM admin.roles WHERE code='super_admin'",
      [principal]
    );
    const global = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('notes-global','global','全球','Global') RETURNING id"
      )
    ).rows[0]!.id;
    const country = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'notes-country','country','國家','Country') RETURNING id",
        [global]
      )
    ).rows[0]!.id;
    const region = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'notes-region','operational','心得區','Notes region') RETURNING id",
        [country]
      )
    ).rows[0]!.id;
    person = (
      await pool.query<{ id: string }>(
        "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Learner','UTC') RETURNING id"
      )
    ).rows[0]!.id;
    credential = 'U' + randomUUID().replaceAll('-', '');
    const identity = (
      await pool.query<{ id: string }>(
        "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'line',$2) RETURNING id",
        [person, credential]
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
      [person, identity]
    );
    await pool.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES('line',$1,'Learner','Learner','notes@example.com','+886912345600',$2,'approved',$3,CURRENT_TIMESTAMP,$4)",
      [credential, region, person, principal]
    );
    const assignment = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-10) RETURNING id",
        [person, region]
      )
    ).rows[0]!.id;
    checkin = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) VALUES($1,$2,CURRENT_DATE,'UTC','regular',$3) RETURNING id",
        [person, identity, assignment]
      )
    ).rows[0]!.id;
    token = randomBytes(32).toString('base64url');
  });
  afterEach(async () => {
    await runtime?.end();
    if (role) {
      await pool.query(`DROP OWNED BY ${role}`);
      await pool.query(`DROP ROLE ${role}`);
    }
    await dispose?.();
  });
  it('keeps free text unchanged and historical labels stable through rename, reorder and deactivation', async () => {
    const initial = await saveTags(1, [
      { name_zh_tw: '放鬆', name_en: 'Relaxed', active: true },
      { name_zh_tw: '睡得好', name_en: 'Better sleep', active: true }
    ]);
    const tag = initial.tags[0]!;
    await save('放鬆\n我手寫的心得 <script>', [tag.id]);
    await saveTags(initial.version, [
      { ...initial.tags[1]! },
      { ...tag, name_zh_tw: '很放鬆', name_en: 'Very relaxed', active: false }
    ]);
    await save(null, [tag.id]);
    const snapshot = (
      await query<{
        data: {
          tags: Array<{ name: string }>;
          notes: Array<{ practice_note: string; feeling_tags: Array<{ name: string }> }>;
        };
      }>('SELECT platform.practice_notes($1,$2,$3) data', ['line', credential, 'en'])
    ).rows[0]!.data;
    expect(snapshot.tags.map((t) => t.name)).toEqual(['睡得好']);
    expect(snapshot.notes[0]).toMatchObject({
      practice_note: '放鬆\n我手寫的心得 <script>',
      feeling_tags: [{ name: '放鬆' }]
    });
    await save(null, []);
    expect(
      (await pool.query('SELECT practice_note FROM core.checkin_notes')).rows[0]?.practice_note
    ).toBe('放鬆\n我手寫的心得 <script>');
    expect((await pool.query('SELECT * FROM core.checkin_note_tags')).rows).toEqual([]);
  });
  it('preserves omitted fields, allows tag-only notes and enforces Unicode limits in SQL', async () => {
    const c = await saveTags(1, [{ name_zh_tw: '放鬆', name_en: 'Relaxed', active: true }]);
    await save('', [c.tags[0]!.id]);
    await save(null, null);
    expect((await pool.query('SELECT * FROM core.checkin_note_tags')).rowCount).toBe(1);
    await save('😀'.repeat(1000), null);
    await expect(save('😀'.repeat(1001), null)).rejects.toThrow('invalid practice note');
    expect(
      (await pool.query('SELECT length(practice_note) n FROM core.checkin_notes')).rows[0]?.n
    ).toBe(1000);
    await expect(save(null, [c.tags[0]!.id, c.tags[0]!.id])).rejects.toThrow(
      'invalid feeling tags'
    );
    await expect(save('rollback', [randomUUID()])).rejects.toThrow('invalid feeling tags');
    expect(
      (await pool.query('SELECT length(practice_note) n FROM core.checkin_notes')).rows[0]?.n
    ).toBe(1000);
  });
  it('denies forged checkins, expired or cross-channel credentials, inactive identities and past corrections', async () => {
    await expect(save('forged', [], randomUUID())).rejects.toThrow(
      'practice note correction unavailable'
    );
    await expect(save('forged', [], checkin, 'telegram', credential)).rejects.toThrow(
      'practice identity unavailable'
    );
    await expect(save('forged', [], checkin, 'telegram', token)).rejects.toThrow(
      'practice identity unavailable'
    );
    await pool.query('UPDATE core.checkins SET practice_date=CURRENT_DATE-2 WHERE id=$1', [
      checkin
    ]);
    await expect(save('past', [])).rejects.toThrow('practice note correction unavailable');
    await pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to=CURRENT_TIMESTAMP WHERE person_id=$1',
      [person]
    );
    await pool.query("UPDATE identity.people SET status='suspended' WHERE id=$1", [person]);
    await expect(save('suspended', [])).rejects.toThrow('practice identity unavailable');
  });
  it('uses forced RLS: anonymous, self contexts and ordinary report readers cannot see note text or tags', async () => {
    await save('private', []);
    expect((await query('SELECT * FROM core.checkin_notes')).rows).toEqual([]);
    expect(
      (
        await withRequestContext(
          runtime,
          'qigong_api_runtime',
          { requestId: randomUUID(), personId: person },
          (c) => c.query('SELECT * FROM core.checkin_notes')
        )
      ).rows
    ).toEqual([]);
    expect((await query('SELECT * FROM core.checkin_notes', [], true)).rows).toHaveLength(1);
    await pool.query(
      "UPDATE admin.role_grants SET role_id=(SELECT id FROM admin.roles WHERE code='global_viewer') WHERE principal_id=$1",
      [principal]
    );
    expect((await query('SELECT * FROM core.checkin_notes', [], true)).rows).toEqual([]);
    expect((await query('SELECT * FROM core.checkin_note_tags', [], true)).rows).toEqual([]);
    await expect(query('DELETE FROM core.checkin_notes')).rejects.toThrow('permission denied');
    await expect(query('SELECT admin.feeling_tag_catalog()')).rejects.toThrow(
      'tag management denied'
    );
  });
  it('serves tag-only journals without granting method metadata to private-note-only readers', async () => {
    const tags = await saveTags(1, [{ name_zh_tw: '放鬆', name_en: 'Relaxed', active: true }]);
    await save('', [tags.tags[0]!.id]);
    const read = () =>
      query<{
        data: {
          total: number;
          entries: Array<{
            name: string;
            practiceNote: string;
            feelingTags: Array<{ name: string }>;
            methodsVisible: boolean;
            methods: string[];
          }>;
        };
      }>("SELECT admin.practice_journal(NULL,1,'en') data", [], true);
    expect((await read()).rows[0]?.data).toMatchObject({
      total: 1,
      entries: [
        {
          name: 'Learner',
          practiceNote: '',
          feelingTags: [{ name: 'Relaxed' }],
          methodsVisible: true
        }
      ]
    });
    const reader = (
      await pool.query<{ id: string }>(
        "INSERT INTO admin.roles(code,description) VALUES('notes_reader_test','isolated permission test') RETURNING id"
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO admin.role_permissions(role_id,permission_id) SELECT $1,id FROM admin.permissions WHERE code IN ('learner.read','checkin.read_private_note')",
      [reader]
    );
    await pool.query('UPDATE admin.role_grants SET role_id=$1 WHERE principal_id=$2', [
      reader,
      principal
    ]);
    expect((await read()).rows[0]?.data.entries[0]).toMatchObject({
      methodsVisible: false,
      methods: []
    });
    const outsideRegion = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT parent_region_id,'outside-notes','operational','其他區','Other region' FROM core.regions WHERE code='notes-region' RETURNING id"
      )
    ).rows[0]!.id;
    await pool.query(
      "UPDATE admin.role_grants SET scope_type='region',region_id=$1 WHERE principal_id=$2",
      [outsideRegion, principal]
    );
    expect((await read()).rows[0]?.data).toMatchObject({ total: 0, entries: [] });
    await expect(
      query('SELECT admin.practice_journal($1,1,$2)', [person, 'en'], true)
    ).rejects.toThrow('learner unavailable');
    expect((await query('SELECT * FROM core.checkin_notes', [], true)).rows).toEqual([]);
    expect((await query('SELECT * FROM core.checkin_note_tags', [], true)).rows).toEqual([]);
    await pool.query(
      "UPDATE admin.role_grants SET role_id=(SELECT id FROM admin.roles WHERE code='global_viewer'),scope_type='global',region_id=NULL WHERE principal_id=$1",
      [principal]
    );
    await expect(read()).rejects.toThrow('journal access denied');
  });
  it('validates whole catalogs atomically and prevents stale overwrites, duplicated names and omissions', async () => {
    const initial = await saveTags(1, [{ name_zh_tw: '放鬆', name_en: 'Relaxed', active: true }]);
    await expect(saveTags(1, initial.tags)).rejects.toThrow('tag version conflict');
    await expect(saveTags(initial.version, [])).rejects.toThrow('invalid feeling tags');
    await expect(
      saveTags(initial.version, [
        ...initial.tags,
        { name_zh_tw: '其他', name_en: 'RELAXED', active: true }
      ])
    ).rejects.toThrow('invalid feeling tags');
    expect(await catalog()).toEqual(initial);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit.events WHERE action='feeling_tags.update'"
        )
      ).rows[0]?.n
    ).toBe(1);
  });
});
