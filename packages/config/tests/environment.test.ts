import { describe, expect, it } from 'vitest';
import { loadEnvironment } from '../src/index.js';

describe('loadEnvironment', () => {
  it('parses a complete environment', () => {
    expect(
      loadEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/qigong',
        PORT: '3200'
      })
    ).toMatchObject({ NODE_ENV: 'test', PORT: 3200, DATABASE_POOL_MAX: 10 });
  });

  it('rejects an invalid database URL', () => {
    expect(() => loadEnvironment({ DATABASE_URL: 'not-a-url' })).toThrow();
    expect(() => loadEnvironment({ DATABASE_URL: 'https://example.com/database' })).toThrow(
      'DATABASE_URL must use postgres:// or postgresql://'
    );
  });
});
