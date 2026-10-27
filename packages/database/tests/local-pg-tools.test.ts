// Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverLocalPgTools, localPgEnvironment } from './local-pg-tools.js';

const roots: string[] = [];
const fixture = async (major: number, name = 'bin with spaces') => {
  const root = await mkdtemp('/tmp/venue-pg-tools-');
  roots.push(root);
  const directory = resolve(root, name);
  await mkdir(directory, { recursive: true });
  for (const tool of ['postgres', 'initdb', 'pg_ctl', 'createdb']) {
    const path = resolve(directory, tool);
    await writeFile(path, `#!/bin/sh\nprintf '%s\\n' '${tool} (PostgreSQL) ${major}.11'\n`);
    await chmod(path, 0o700);
  }
  return directory;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('portable local PostgreSQL tools (synthetic executables, no database)', () => {
  it.each([16, 17] as const)('selects explicit PG%d even with an unrelated PATH', async (major) => {
    const directory = await fixture(major);
    expect(discoverLocalPgTools({ PG_BIN_DIR: directory, PATH: '/nonexistent' })).toEqual({
      directory,
      major
    });
  });
  it.each([
    [16, 'usr/lib/postgresql/16/bin'],
    [17, 'usr/local/opt/postgresql@17/bin']
  ] as const)('discovers PG%d on Linux/Intel Mac-shaped PATH: %s', async (major, path) => {
    const directory = await fixture(major, path);
    expect(discoverLocalPgTools({ PATH: `/nonexistent:${directory}:/usr/bin:/bin` })).toEqual({
      directory,
      major
    });
  });
  it('missing local initdb does not adopt a service database or PG connection configuration', () => {
    expect(
      discoverLocalPgTools({
        PATH: '/nonexistent',
        TEST_DATABASE_URL: 'postgresql://synthetic.invalid/never-contact',
        PGHOST: 'synthetic.invalid'
      })
    ).toBeUndefined();
  });
  it('ignores empty and relative PATH entries, including the checkout', () => {
    expect(discoverLocalPgTools({ PATH: ':.:./node_modules/.bin:relative' })).toBeUndefined();
  });
  it.each(['', '.', 'relative/bin', '/tmp/bin:other', '/tmp/bin\nother'])(
    'rejects invalid explicit directory without silently falling back: %j',
    (directory) => {
      expect(() => discoverLocalPgTools({ PG_BIN_DIR: directory })).toThrow(/absolute trusted/);
    }
  );
  it('explicit missing tools fail, even when PATH offers a complete installation', async () => {
    const directory = await fixture(17);
    expect(() => discoverLocalPgTools({ PG_BIN_DIR: '/nonexistent', PATH: directory })).toThrow(
      /incomplete/
    );
  });
  it('a PATH installation containing initdb but missing pg_ctl fails rather than skips', async () => {
    const directory = await fixture(17);
    await rm(resolve(directory, 'pg_ctl'));
    expect(() => discoverLocalPgTools({ PATH: directory })).toThrow(/incomplete/);
  });
  it.each([15, 18])('unsupported major %d fails, not skip', async (major) => {
    const directory = await fixture(major);
    expect(() => discoverLocalPgTools({ PG_BIN_DIR: directory })).toThrow(/supported major/);
  });
  it('mixed major versions fail', async () => {
    const directory = await fixture(17);
    await writeFile(
      resolve(directory, 'createdb'),
      '#!/bin/sh\nprintf "createdb (PostgreSQL) 16.11\\n"\n'
    );
    expect(() => discoverLocalPgTools({ PG_BIN_DIR: directory })).toThrow(/same supported major/);
  });
  it('unparseable version fails', async () => {
    const directory = await fixture(17);
    await writeFile(resolve(directory, 'postgres'), '#!/bin/sh\nprintf "unrecognized\\n"\n');
    expect(() => discoverLocalPgTools({ PG_BIN_DIR: directory })).toThrow(/supported major/);
  });
  it('probe diagnostics are suppressed', async () => {
    const directory = await fixture(17);
    await writeFile(
      resolve(directory, 'initdb'),
      '#!/bin/sh\nprintf "SYNTHETIC_PRIVATE" >&2\nexit 1\n'
    );
    expect(() => discoverLocalPgTools({ PG_BIN_DIR: directory })).toThrow(
      /^Local PostgreSQL tool version probe failed$/
    );
  });
  it('tool environment is an allowlist, not a copy of process.env', () => {
    expect(localPgEnvironment('/trusted/bin')).toEqual({
      PATH: '/trusted/bin',
      LANG: 'C',
      LC_ALL: 'C',
      TZ: 'UTC'
    });
  });
  it('CLI missing tools exits 77 with NOT RUN, invalid configuration exits 1', () => {
    const helper = fileURLToPath(new URL('./local-pg-tools.ts', import.meta.url));
    const skipped = spawnSync(process.execPath, [helper], {
      env: localPgEnvironment('/nonexistent'),
      encoding: 'utf8'
    });
    expect(skipped.status).toBe(77);
    expect(skipped.stderr).toContain('SKIP:');
    expect(skipped.stderr).toContain('NOT RUN');
    const invalid = spawnSync(process.execPath, [helper], {
      env: { ...localPgEnvironment('/nonexistent'), PG_BIN_DIR: '/nonexistent' },
      encoding: 'utf8'
    });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).not.toContain('SKIP:');
  });
  it('CLI accepts a trusted directory containing spaces', async () => {
    const directory = await fixture(16);
    const selected = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./local-pg-tools.ts', import.meta.url))],
      {
        env: { ...localPgEnvironment('/nonexistent'), PG_BIN_DIR: directory },
        encoding: 'utf8'
      }
    );
    expect(selected.status).toBe(0);
    expect(selected.stdout.trim()).toBe(directory);
  });
  it.each([
    ['focused', undefined, 77],
    ['focused', '/nonexistent', 1],
    ['invalid-mode', undefined, 1]
  ] as const)(
    'runner mode %s with explicit tools %s exits %d before cluster creation',
    (mode, directory, status) => {
      const runner = fileURLToPath(
        new URL('../../../scripts/test-venue-suite-local-pg.sh', import.meta.url)
      );
      const env = localPgEnvironment(resolve(process.execPath, '..') + ':/usr/bin:/bin');
      if (directory !== undefined) env.PG_BIN_DIR = directory;
      const result = spawnSync('/bin/bash', [runner, mode], { env, encoding: 'utf8' });
      expect(result.status).toBe(status);
      if (status === 77) expect(result.stderr).toContain('NOT RUN');
      else expect(result.stderr).not.toContain('SKIP:');
    }
  );
  it('runner retains socket-only, private root, host reject, marker and PID guards', async () => {
    const source = await readFile(
      new URL('../../../scripts/test-venue-suite-local-pg.sh', import.meta.url),
      'utf8'
    );
    for (const guard of [
      "listen_addresses=''",
      'unix_socket_permissions=0700',
      '--auth-host=reject',
      'chmod 700',
      'suite-owner-marker',
      'info.uid !== process.getuid()',
      '(info.mode & 0o777) !== 0o700',
      'realpathSync(pid[1])',
      'pid[3] !== port',
      'realpathSync(pid[4])'
    ])
      expect(source).toContain(guard);
  });
});
