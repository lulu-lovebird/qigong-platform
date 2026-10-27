// Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tools = ['postgres', 'initdb', 'pg_ctl', 'createdb'] as const;
export type LocalPgTool = (typeof tools)[number];
export interface LocalPgTools {
  directory: string;
  major: 16 | 17;
}

// Deliberately allowlisted: never forward DB URLs, PG*, credentials or preloads.
export const localPgEnvironment = (path: string): NodeJS.ProcessEnv => ({
  PATH: path,
  LANG: 'C',
  LC_ALL: 'C',
  TZ: 'UTC'
});

const executable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** PG_BIN_DIR and absolute PATH entries are operator-trusted executable locations.
 * Missing host initdb is the only skip case. Broken/unsupported explicit tools fail.
 * Never falls back to TEST_DATABASE_URL or a running PostgreSQL service.
 */
export function discoverLocalPgTools(env: NodeJS.ProcessEnv): LocalPgTools | undefined {
  const explicit = env.PG_BIN_DIR;
  if (explicit !== undefined && (!isAbsolute(explicit) || /[:\r\n]/.test(explicit)))
    throw new Error('PG_BIN_DIR must be an absolute trusted tool directory');
  const path = env.PATH ?? '/usr/bin:/bin';
  const candidates = explicit !== undefined ? [explicit] : path.split(delimiter);
  for (const directory of candidates) {
    // Ignore cwd-relative PATH entries: never execute checkout-local lookalikes.
    if (!isAbsolute(directory) || /[\r\n]/.test(directory)) continue;
    if (!executable(resolve(directory, 'initdb')) && explicit === undefined) continue;
    if (!tools.every((name) => executable(resolve(directory, name))))
      throw new Error('Local PostgreSQL tool directory is incomplete');
    const majors = tools.map((name) => {
      let version: string;
      try {
        version = execFileSync(resolve(directory, name), ['--version'], {
          env: localPgEnvironment(path),
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 10000
        });
      } catch {
        // Suppress child diagnostics: they may include inherited/local details.
        throw new Error('Local PostgreSQL tool version probe failed');
      }
      return Number(version.match(/\(PostgreSQL\) (\d+)\./)?.[1]);
    });
    const major = majors[0];
    if ((major !== 16 && major !== 17) || !majors.every((value) => value === major))
      throw new Error('Local PostgreSQL tools must all be the same supported major (16 or 17)');
    return { directory: resolve(directory), major };
  }
  return undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.version.startsWith('v24.')) throw new Error('Node 24 is required');
    const selected = discoverLocalPgTools(process.env);
    if (!selected) {
      console.error('SKIP: local PostgreSQL initdb tools unavailable; isolated harness NOT RUN');
      process.exitCode = 77;
    } else {
      console.log(selected.directory);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Local PostgreSQL discovery failed');
    process.exitCode = 1;
  }
}
