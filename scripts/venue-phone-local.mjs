#!/usr/bin/env node
// Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const node = '/opt/homebrew/opt/node@24/bin/node';
const pg = '/opt/homebrew/opt/postgresql@17/bin/';
const runtime = resolve(repository, 'scripts/venue-phone-runtime.ts');
export const publicOrigin = 'https://mingyenmac-mini.tailbf9b8d.ts.net';
export const lineKeys = Object.freeze([
  'LINE_CHANNEL_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_LOGIN_CHANNEL_ID',
  'LINE_LIFF_ID'
]);
export const baseEnvironment = () => ({
  PATH: '/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/bin:/bin',
  LANG: 'C',
  TZ: 'UTC',
  NODE_OPTIONS: '',
  NODE_ENV: 'development',
  LOG_LEVEL: 'silent',
  NFC_FIELD_CHECKIN_ENABLED: 'false'
});
export const selectLineEnvironment = (source) => {
  const selected = Object.fromEntries(lineKeys.map((key) => [key, source[key]]));
  if (
    typeof selected.LINE_CHANNEL_SECRET !== 'string' ||
    selected.LINE_CHANNEL_SECRET.length < 16 ||
    typeof selected.LINE_CHANNEL_ACCESS_TOKEN !== 'string' ||
    selected.LINE_CHANNEL_ACCESS_TOKEN.length < 20 ||
    !/^\d+$/.test(selected.LINE_LOGIN_CHANNEL_ID ?? '') ||
    selected.LINE_LIFF_ID !== '2011968988-KX3MjakL'
  )
    throw new Error('Required LINE configuration unavailable; values suppressed');
  return selected;
};
const command = (executable, args) => {
  const result = spawnSync(executable, args, {
    cwd: repository,
    env: baseEnvironment(),
    stdio: 'ignore',
    timeout: 120_000
  });
  if (result.status !== 0) throw new Error('Isolated setup command failed; diagnostics suppressed');
};
const credentials = () => {
  // Only this short-lived child loads the approved file. Never return other settings.
  // NODE_OPTIONS in its explicit environment overrides any value in the file.
  const result = spawnSync(
    node,
    [
      '--env-file=/Volumes/External Drive/repo/.env',
      '-e',
      `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(lineKeys)}.map(k=>[k,process.env[k]]))))`
    ],
    { env: baseEnvironment(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
  );
  if (result.status !== 0) throw new Error('Approved LINE environment unavailable');
  try {
    return selectLineEnvironment(JSON.parse(result.stdout));
  } catch {
    throw new Error('Required LINE configuration unavailable; values suppressed');
  }
};
export const assertPrivateRoot = async (root) => {
  if (!/^\/tmp\/venue-phone-pg\.[A-Za-z0-9]+$/.test(root ?? ''))
    throw new Error('Expected owned /tmp/venue-phone-pg.* directory');
  const info = await stat(root);
  const actual = await realpath(root);
  if (
    info.uid !== process.getuid() ||
    (info.mode & 0o077) !== 0 ||
    (actual !== root && actual !== '/private' + root) ||
    (await readFile(resolve(root, 'venue-phone-marker'), 'utf8')).trim() !== root
  )
    throw new Error('Unsafe or unrecognized cluster directory');
};
const assertCluster = async (root) => {
  await assertPrivateRoot(root);
  const pid = (await readFile(resolve(root, 'data/postmaster.pid'), 'utf8')).split('\n');
  if (
    ![root + '/data', '/private' + root + '/data'].includes(pid[1]) ||
    pid[3] !== '55480' ||
    ![root + '/socket', '/private' + root + '/socket'].includes(pid[4])
  )
    throw new Error('Postmaster does not match owned cluster');
};
const assertPortFree = () =>
  new Promise((resolveFree, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error('127.0.0.1:3100 is occupied')));
    server.listen(3100, '127.0.0.1', () => server.close(resolveFree));
  });
const runtimeArgs = (mode, root) => [
  '--conditions=development',
  '--import',
  'tsx',
  runtime,
  mode,
  root
];
const start = async () => {
  await assertPortFree();
  const line = credentials();
  const root = await mkdtemp('/tmp/venue-phone-pg.');
  await chmod(root, 0o700);
  await writeFile(resolve(root, 'venue-phone-marker'), root + '\n', { mode: 0o600 });
  let child;
  let started = false;
  try {
    command('/bin/mkdir', [root + '/socket']);
    command(pg + 'initdb', [
      '-D',
      root + '/data',
      '--username=venue_phone_owner',
      '--encoding=UTF8',
      '--no-locale',
      '--auth-local=trust',
      '--auth-host=reject'
    ]);
    command(pg + 'pg_ctl', [
      '-D',
      root + '/data',
      '-l',
      root + '/postgres.log',
      '-o',
      `-k ${root}/socket -p 55480 -c listen_addresses='' -c unix_socket_permissions=0700 -c log_statement=none -c log_min_messages=panic -c log_min_error_statement=panic -c log_parameter_max_length=0 -c log_parameter_max_length_on_error=0 -c log_connections=off -c log_disconnections=off`,
      '-w',
      'start'
    ]);
    started = true;
    await assertCluster(root);
    command(node, runtimeArgs('seed', root));
    child = spawn(node, runtimeArgs('serve', root), {
      cwd: repository,
      env: { ...baseEnvironment(), ...line },
      stdio: 'ignore',
      detached: true
    });
    // Handle spawn failure without ever echoing configuration.
    const spawned = new Promise((resolveSpawn, reject) => {
      child.once('spawn', resolveSpawn);
      child.once('error', () => reject(new Error('API process failed to spawn')));
    });
    await spawned;
    const pgPid = Number((await readFile(root + '/data/postmaster.pid', 'utf8')).split('\n')[0]);
    const state = { root, appPid: child.pid, pgPid, port: 3100, pgPort: 55480, publicOrigin };
    await writeFile(root + '/state.json', JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      try {
        const response = await fetch('http://127.0.0.1:3100/health/ready', {
          signal: AbortSignal.timeout(1000)
        });
        const health = await response.json();
        if (response.ok && health.runtime?.sessionUser === 'venue_phone_login') {
          ready = true;
          break;
        }
      } catch {
        /* startup only; no credential requests */
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    if (!ready) throw new Error('Isolated API readiness failed');
    child.unref();
    console.log(JSON.stringify(state, null, 2));
  } catch (error) {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((done) => child.once('exit', done));
    }
    // pg_ctl may have started even if its wait timed out: inspect only our new directory.
    try {
      await assertCluster(root);
      command(pg + 'pg_ctl', ['-D', root + '/data', '-m', 'fast', '-w', 'stop']);
      started = false;
    } catch {
      if (started) throw new Error(`Cleanup requires inspection of owned cluster: ${root}`);
      try {
        await stat(root + '/data/postmaster.pid');
        throw new Error(`Cleanup requires inspection of owned cluster: ${root}`);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') throw cleanupError;
      }
    }
    await rm(root, { recursive: true });
    throw error;
  }
};
const stop = async (root, cleanup) => {
  await assertPrivateRoot(root);
  const state = JSON.parse(await readFile(root + '/state.json', 'utf8'));
  if (state.root !== root || !Number.isSafeInteger(state.appPid) || state.appPid <= 1)
    throw new Error('Invalid owned process state');
  const processInfo = spawnSync('/bin/ps', ['-p', String(state.appPid), '-o', 'command='], {
    env: baseEnvironment(),
    encoding: 'utf8'
  });
  if (processInfo.status === 0) {
    const expected = `${node} ${runtimeArgs('serve', root).join(' ')}`;
    if (processInfo.stdout.trim() !== expected) throw new Error('PID reused; refusing to signal');
    process.kill(state.appPid, 'SIGTERM');
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        process.kill(state.appPid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') break;
        throw error;
      }
      if (attempt === 99) throw new Error('Owned API has not stopped; cluster retained');
      await new Promise((done) => setTimeout(done, 100));
    }
  } else if (processInfo.status !== 1) throw new Error('Unable to inspect owned API PID');
  try {
    await stat(root + '/data/postmaster.pid');
    await assertCluster(root);
    command(pg + 'pg_ctl', ['-D', root + '/data', '-m', 'fast', '-w', 'stop']);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (cleanup) await rm(root, { recursive: true });
  console.log(
    cleanup
      ? 'Owned API/cluster stopped and private directory removed'
      : `Stopped; retained ${root}`
  );
};
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [action, root] = process.argv.slice(2);
    if (action === 'start') await start();
    else if (action === 'stop' || action === 'cleanup') await stop(root, action === 'cleanup');
    else
      throw new Error('Usage: node scripts/venue-phone-local.mjs start | stop ROOT | cleanup ROOT');
  } catch (error) {
    // All outward errors above are fixed messages or private owned paths, never child diagnostics.
    console.error(
      error instanceof Error &&
        /^(Required |Approved |Expected |Unsafe |Postmaster |127\.0\.0\.1|Isolated |API |Cleanup |Invalid |PID |Owned |Unable |Usage:)/.test(
          error.message
        )
        ? error.message
        : 'Local phone harness failed; details suppressed'
    );
    process.exitCode = 1;
  }
}
