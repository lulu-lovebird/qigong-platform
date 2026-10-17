import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { receiptQueueSchema } from '../src/practice-receipt-health.js';
import { z } from 'zod';
const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const script = fileURLToPath(new URL('../../../scripts/check-receipt-health.mjs', import.meta.url));
const aggregate = z.object({
  observedAtMs: z.number(),
  windowStartMs: z.number(),
  queues: z.array(receiptQueueSchema).length(2)
});
suite('Operator receipt SQL on isolated synthetic PostgreSQL (not provider/RLS acceptance)', () => {
  let pool: Pool, dispose: () => Promise<void>, sql: string;
  beforeAll(async () => {
    const database = await createIsolatedTestDatabase(base!);
    pool = database.pool;
    dispose = () => database.dispose();
    await pool.query(`CREATE SCHEMA ops;
      CREATE TABLE ops.channel_practice_receipts(platform TEXT,status TEXT,attempts INTEGER DEFAULT 0,created_at TIMESTAMPTZ,delivered_at TIMESTAMPTZ,available_at TIMESTAMPTZ,leased_until TIMESTAMPTZ,recipient TEXT DEFAULT 'PRIVATE',payload TEXT DEFAULT 'PRIVATE');
      CREATE TABLE ops.telegram_practice_receipts(LIKE ops.channel_practice_receipts INCLUDING DEFAULTS);`);
    const result = spawnSync(
      process.execPath,
      [script, '--print-sql', '--since', new Date(Date.now() - 3600000).toISOString()],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(0);
    sql = result.stdout
      .slice(result.stdout.indexOf('WITH boundary'), result.stdout.lastIndexOf('COMMIT;'))
      .trim();
  });
  afterAll(async () => {
    await dispose?.();
  });
  const collect = async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const result = await client.query<{ snapshot: unknown }>(sql);
      await client.query('ROLLBACK');
      return aggregate.parse(result.rows[0]?.snapshot);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  };
  it('returns both empty queues with explicit null latency, not zero milliseconds', async () => {
    const value = await collect();
    expect(value.queues.map((q) => q.channel)).toEqual(['line', 'telegram']);
    for (const queue of value.queues)
      expect(queue).toMatchObject({
        pending: 0,
        due: 0,
        deliverySamples: 0,
        p50Ms: null,
        p95Ms: null,
        maxMs: null,
        oldestDueAgeMs: null
      });
  });
  it('excludes pre-epoch created jobs even when accepted now, but includes retry backlog and stale leases', async () => {
    await pool.query(`INSERT INTO ops.channel_practice_receipts(platform,status,created_at,delivered_at,available_at,leased_until,attempts) VALUES
      ('line','delivered',CURRENT_TIMESTAMP-INTERVAL '2 days',CURRENT_TIMESTAMP-INTERVAL '1 second',CURRENT_TIMESTAMP,NULL,1),
      ('line','delivered',CURRENT_TIMESTAMP-INTERVAL '2 seconds',CURRENT_TIMESTAMP-INTERVAL '1 second',CURRENT_TIMESTAMP,NULL,1),
      ('line','pending',CURRENT_TIMESTAMP-INTERVAL '6 minutes',NULL,CURRENT_TIMESTAMP+INTERVAL '1 minute',NULL,1),
      ('line','sending',CURRENT_TIMESTAMP-INTERVAL '20 seconds',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP-INTERVAL '1 second',1);
      INSERT INTO ops.telegram_practice_receipts(status,created_at,available_at) VALUES('pending',CURRENT_TIMESTAMP-INTERVAL '30 seconds',CURRENT_TIMESTAMP-INTERVAL '1 second');`);
    const value = await collect();
    expect(value.queues[0]).toMatchObject({
      deliverySamples: 1,
      p50Ms: 1000,
      p95Ms: 1000,
      maxMs: 1000,
      pending: 1,
      sending: 1,
      expiredLeases: 1,
      retrying: 1,
      due: 0,
      oldestDueAgeMs: null
    });
    expect(value.queues[0]!.oldestOutstandingAgeMs).toBeGreaterThanOrEqual(360000);
    expect(value.queues[1]).toMatchObject({ pending: 1, due: 1, deliverySamples: 0, p50Ms: null });
    expect(value.queues[1]!.oldestDueAgeMs).toBeGreaterThanOrEqual(30000);
    expect(JSON.stringify(value)).not.toContain('PRIVATE');
  });
  it('reports reversed timestamps separately without negative latency and never includes WhatsApp jobs', async () => {
    await pool.query(`INSERT INTO ops.channel_practice_receipts(platform,status,created_at,delivered_at,available_at) VALUES
      ('line','delivered',CURRENT_TIMESTAMP-INTERVAL '1 second',CURRENT_TIMESTAMP-INTERVAL '2 seconds',CURRENT_TIMESTAMP),
      ('whatsapp','failed',CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP);`);
    const value = await collect();
    expect(value.queues[0]).toMatchObject({ clockAnomalies: 1, deliverySamples: 1, failed: 0 });
    expect(value.queues[1]).toMatchObject({ clockAnomalies: 0 });
  });
});
