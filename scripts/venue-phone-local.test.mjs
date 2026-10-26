// Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertPrivateRoot,
  baseEnvironment,
  lineKeys,
  publicOrigin,
  selectLineEnvironment
} from './venue-phone-local.mjs';

const synthetic = {
  LINE_CHANNEL_SECRET: 'synthetic-channel-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-channel-access-token',
  LINE_LOGIN_CHANNEL_ID: '123456',
  LINE_LIFF_ID: '2011968988-KX3MjakL'
};
test('runtime allowlist drops all unrelated real service configuration', () => {
  const selected = selectLineEnvironment({
    ...synthetic,
    DATABASE_URL: 'postgresql://never-connect.invalid/forbidden',
    ADMIN_OIDC_ISSUER_URL: 'https://never-connect.invalid',
    TELEGRAM_ONBOARDING_BOT_TOKEN: 'synthetic-forbidden',
    NODE_OPTIONS: '--invalid-synthetic-option'
  });
  assert.deepEqual(selected, synthetic);
  assert.deepEqual(Object.keys(selected), lineKeys);
});
test('base environment never inherits process configuration', () => {
  assert.deepEqual(Object.keys(baseEnvironment()).sort(), [
    'LANG',
    'LOG_LEVEL',
    'NFC_FIELD_CHECKIN_ENABLED',
    'NODE_ENV',
    'NODE_OPTIONS',
    'PATH',
    'TZ'
  ]);
  assert.equal(baseEnvironment().NODE_OPTIONS, '');
  assert.equal(baseEnvironment().NFC_FIELD_CHECKIN_ENABLED, 'false');
  assert.equal(publicOrigin, 'https://mingyenmac-mini.tailbf9b8d.ts.net');
});
test('LINE configuration fails closed without disclosing input', () => {
  for (const key of lineKeys) {
    assert.throws(() => selectLineEnvironment({ ...synthetic, [key]: '' }), {
      message: 'Required LINE configuration unavailable; values suppressed'
    });
  }
  assert.throws(() => selectLineEnvironment({ ...synthetic, LINE_LIFF_ID: '123-other' }));
});
test('cleanup rejects arbitrary paths without inspecting them', async () => {
  for (const path of ['/tmp', '/tmp/venue-phone-pg.a/..', '/tmp/venue-qr-pg.abc', undefined])
    await assert.rejects(assertPrivateRoot(path), /Expected owned/);
});
test('cleanup requires owned private directory and exact marker', async () => {
  const root = await mkdtemp('/tmp/venue-phone-pg.');
  try {
    await chmod(root, 0o700);
    await writeFile(root + '/venue-phone-marker', root + '\n');
    await assertPrivateRoot(root);
    await chmod(root, 0o755);
    await assert.rejects(assertPrivateRoot(root), /Unsafe/);
    await chmod(root, 0o700);
    await writeFile(root + '/venue-phone-marker', '/tmp/not-this-cluster');
    await assert.rejects(assertPrivateRoot(root), /Unsafe/);
  } finally {
    await rm(root, { recursive: true });
  }
});
test('adapter uses true verifier, server-only QR and nonowner login; no synthetic identities', async () => {
  const source = await readFile(new URL('./venue-phone-runtime.ts', import.meta.url), 'utf8');
  assert.match(source, /venueQr: \{ enabled: true, publicOrigin \}/);
  assert.match(source, /poolFor\(directory, 'venue_phone_login'\)/);
  assert.match(
    source,
    /LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/
  );
  assert.match(source, /host: '127\.0\.0\.1', port: 3100/);
  assert.match(source, /request\.url\.split\('\?'\)\[0\] === '\/line\/webhook'/);
  assert.doesNotMatch(
    source,
    /verifyIdentity:|verifyIdToken:|adminAuth:|process\.env\.DATABASE_URL/
  );
  assert.doesNotMatch(source, /INSERT INTO (identity\.|admin\.|core\.checkins)/);
  assert.match(source, /'tw-location-test','目前位置測試場'/);
});
test('launcher never resets Serve, exposes PG TCP, or prints child diagnostics', async () => {
  const source = await readFile(new URL('./venue-phone-local.mjs', import.meta.url), 'utf8');
  assert.match(source, /listen_addresses=''/);
  assert.match(source, /unix_socket_permissions=0700/);
  assert.match(source, /log_parameter_max_length=0/);
  assert.match(source, /log_parameter_max_length_on_error=0/);
  assert.doesNotMatch(source, /tailscale|pkill|process\.env\./);
  assert.match(source, /'--auth-host=reject'/);
});
