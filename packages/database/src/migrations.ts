import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';

const migrationLockKey = 1_726_467_773;

interface AppliedMigration {
  version: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  currentVersion: string | null;
}

export const isMigrationVersionCompatible = (
  currentVersion: string | null,
  minimumVersion: string,
  maximumVersion: string
) =>
  currentVersion !== null &&
  currentVersion.localeCompare(minimumVersion) >= 0 &&
  currentVersion.localeCompare(maximumVersion) <= 0;

const checksum = (sql: string) => createHash('sha256').update(sql).digest('hex');

const ensureLedger = (client: PoolClient) =>
  client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      duration_ms INTEGER NOT NULL,
      deployed_by TEXT NOT NULL
    )
  `);

const loadApplied = async (client: PoolClient) => {
  const result = await client.query<AppliedMigration>(
    'SELECT version, checksum FROM schema_migrations ORDER BY version'
  );
  return new Map(result.rows.map((row) => [row.version, row.checksum]));
};

export const runMigrations = async (
  pool: Pool,
  migrationsDirectory: string,
  deployedBy = process.env.USER || 'unknown'
): Promise<MigrationResult> => {
  const client = await pool.connect();
  const appliedVersions: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [migrationLockKey]);
    await ensureLedger(client);
    const applied = await loadApplied(client);
    const files = (await readdir(migrationsDirectory))
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .sort();
    const fileSet = new Set(files);
    const missingAppliedMigrations = [...applied.keys()].filter((version) => !fileSet.has(version));
    if (missingAppliedMigrations.length) {
      throw new Error(
        `Applied migrations missing from artifact: ${missingAppliedMigrations.join(', ')}`
      );
    }

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDirectory, file), 'utf8');
      const fileChecksum = checksum(sql);
      const recordedChecksum = applied.get(file);

      if (recordedChecksum) {
        if (recordedChecksum !== fileChecksum) {
          throw new Error(`Migration checksum mismatch: ${file}`);
        }
        continue;
      }

      const startedAt = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (version, checksum, duration_ms, deployed_by)
           VALUES ($1, $2, $3, $4)`,
          [file, fileChecksum, Date.now() - startedAt, deployedBy]
        );
        await client.query('COMMIT');
        appliedVersions.push(file);
      } catch (error) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          if (error instanceof Error && rollbackError instanceof Error) {
            error.cause = rollbackError;
          }
        });
        throw error;
      }
    }

    const currentVersion = files.length ? (files.at(-1) ?? null) : null;
    return { applied: appliedVersions, currentVersion };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [migrationLockKey]).catch(() => undefined);
    client.release();
  }
};

export const getMigrationStatus = async (
  pool: Pool,
  minimumVersion: string,
  maximumVersion: string
) => {
  const result = await pool.query<{ version: string }>(
    `SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1`
  );
  const currentVersion = result.rows[0]?.version ?? null;
  const ready = isMigrationVersionCompatible(currentVersion, minimumVersion, maximumVersion);
  return { currentVersion, minimumVersion, maximumVersion, ready };
};
