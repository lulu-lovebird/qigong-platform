import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  rmSync,
  statSync,
  symlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { receiptAlertStateSchema } from '../src/practice-receipt-health.js';
const script = fileURLToPath(new URL('../../../scripts/check-receipt-health.mjs', import.meta.url));
const directories: string[] = [];
const fixture = () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'receipt-health-'));
  directories.push(directory);
  const input = path.join(directory, 'input.json');
  const state = path.join(directory, 'state.json');
  writeFileSync(
    input,
    JSON.stringify({ kind: 'unavailable', observedAtMs: 1000000, recipient: 'PRIVATE DO NOT LOG' })
  );
  return { directory, input, state };
};
const run = (...args: string[]) =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000 });
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
describe('Receipt operator CLI, no live services or providers', () => {
  it('atomically persists private alert state, emits one opening and deduplicates subsequent runs', () => {
    const f = fixture();
    const result = run('--input', f.input, '--state-file', f.state);
    expect(result.status).toBe(3);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('"kind":"opened"');
    expect(result.stdout).not.toContain('PRIVATE');
    expect(statSync(f.state).mode & 0o777).toBe(0o600);
    expect(
      receiptAlertStateSchema.parse(JSON.parse(readFileSync(f.state, 'utf8'))).entries
    ).toHaveLength(1);
    const again = run('--input', f.input, '--state-file', f.state);
    expect(again.status).toBe(3);
    expect(again.stdout).toContain('"alerts":[]');
  });
  it.each(['--unknown', '--since', '--input'])('sanitizes invalid arguments %s', (flag) => {
    const result = run(flag, 'PRIVATE DO NOT LOG');
    expect(result.status).toBe(3);
    expect(result.stdout).toBe('{"event":"receipt_health_check_failed","status":"unknown"}\n');
    expect(result.stderr).toBe('');
  });
  it('refuses a corrupt or unsafe state rather than silently resetting deduplication', () => {
    const f = fixture();
    writeFileSync(f.state, 'PRIVATE CORRUPT STATE', { mode: 0o600 });
    const before = readFileSync(f.state, 'utf8');
    const result = run('--input', f.input, '--state-file', f.state);
    expect(result.status).toBe(3);
    expect(result.stdout).not.toContain('PRIVATE');
    expect(readFileSync(f.state, 'utf8')).toBe(before);
    chmodSync(f.state, 0o644);
    expect(run('--input', f.input, '--state-file', f.state).stdout).toContain(
      'receipt_health_check_failed'
    );
  });
  it('refuses symlink state and concurrent check locks without removing another process lock', () => {
    const f = fixture();
    symlinkSync(f.input, f.state);
    expect(run('--input', f.input, '--state-file', f.state).status).toBe(3);
    rmSync(f.state);
    writeFileSync(f.state + '.lock', 'OTHER OPERATOR', { mode: 0o600 });
    expect(run('--input', f.input, '--state-file', f.state).status).toBe(3);
    expect(readFileSync(f.state + '.lock', 'utf8')).toBe('OTHER OPERATOR');
  });
  it('refuses backwards observation time without overwriting previous alert state', () => {
    const f = fixture();
    run('--input', f.input, '--state-file', f.state);
    const before = readFileSync(f.state, 'utf8');
    writeFileSync(f.input, JSON.stringify({ kind: 'unavailable', observedAtMs: 999999 }));
    expect(run('--input', f.input, '--state-file', f.state).status).toBe(3);
    expect(readFileSync(f.state, 'utf8')).toBe(before);
  });
  it('exports constant, aggregate-only, bounded read-only SQL and requires an explicit UTC epoch', () => {
    const result = run('--print-sql', '--since', '2026-10-01T00:00:00Z');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('BEGIN READ ONLY;');
    expect(result.stdout).toContain("SET LOCAL statement_timeout='5s'");
    expect(result.stdout).toContain('created_at>=b.window_start');
    expect(result.stdout).not.toMatch(/recipient|payload|person_id|identity_id/);
    for (const value of ["2026-10-01';DELETE", '2026-10-01', '2999-01-01T00:00:00Z'])
      expect(run('--print-sql', '--since', value).status).toBe(3);
  });
});
