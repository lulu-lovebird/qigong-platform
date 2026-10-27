/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import type { Pool } from '@qigong/database';
import { describe, expect, it, vi } from 'vitest';
import { checkVenueFeatureReadiness, validateVenueSuiteConfig } from '../src/venue-suite.js';

describe('independent venue capability evidence', () => {
  it.each(['history', 'management', 'people', 'debug'] as const)(
    'probes %s without reading PII or invoking operations',
    async (feature) => {
      const query = vi.fn(async (sql: string) => ({
        rows: sql.includes(' AS ready') ? [{ ready: true }] : []
      }));
      const pool = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool;
      expect(await checkVenueFeatureReadiness(pool, feature)).toEqual({ feature, ready: true });
      const probe = query.mock.calls.find(([sql]) => sql.includes(' AS ready'))?.[0];
      expect(probe).toContain('count(*)=54');
      expect(probe).toContain('count(*)=55');
      expect(probe).toContain('count(*)=56');
      expect(probe).toContain('relforcerowsecurity');
      expect(probe).toContain('pg_auth_members');
      expect(probe).not.toMatch(/SELECT .* FROM (core|identity)\./);
    }
  );
  it('does not treat missing evidence or database errors as readiness', async () => {
    const pool = {
      connect: async () => {
        throw new Error('private SQL diagnostics');
      }
    } as unknown as Pool;
    expect(await checkVenueFeatureReadiness(pool, 'history')).toEqual({
      feature: 'history',
      ready: false
    });
  });
  it('requires exact trusted HTTPS origins and explicit enablement', () => {
    expect(validateVenueSuiteConfig({})).toEqual({});
    expect(
      validateVenueSuiteConfig({
        history: { enabled: true, publicOrigin: 'https://synthetic.invalid' }
      })
    ).toEqual({ history: { enabled: true, publicOrigin: 'https://synthetic.invalid' } });
    for (const publicOrigin of [
      'http://synthetic.invalid',
      'https://synthetic.invalid/',
      'https://user@synthetic.invalid'
    ])
      expect(() =>
        validateVenueSuiteConfig({ history: { enabled: true, publicOrigin } })
      ).toThrow();
  });
});
