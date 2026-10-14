import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyLineIdentity } from '../src/line-profile.js';
const subject = 'U' + 'a'.repeat(32),
  claims = {
    sub: subject,
    aud: '123',
    exp: Math.floor(Date.now() / 1000) + 600,
    iss: 'https://access.line.me',
    name: 'LINE暱稱😀'
  };
afterEach(() => vi.unstubAllGlobals());
describe('Server-verified LINE display metadata', () => {
  it('takes a nickname only from the verified endpoint response bound to the exact channel and subject', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(claims));
    vi.stubGlobal('fetch', fetch);
    expect(await verifyLineIdentity('synthetic-id-token', '123')).toEqual({
      subject,
      displayName: 'LINE暱稱😀'
    });
    expect(fetch.mock.calls[0]![0]).toBe('https://api.line.me/oauth2/v2.1/verify');
    const body = fetch.mock.calls[0]![1]?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    if (body instanceof URLSearchParams) expect(body.get('client_id')).toBe('123');
  });
  it.each([
    { aud: 'other' },
    { exp: 0 },
    { iss: 'https://evil.example.invalid' },
    { sub: 'invalid' }
  ])('rejects wrong audience, expiry, issuer or subject: %j', async (patch) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...claims, ...patch }))
    );
    await expect(verifyLineIdentity('synthetic-id-token', '123')).rejects.toThrow(
      'LINE ID token verification failed'
    );
  });
  it.each([undefined, '', '   ', 'a'.repeat(151), 'control\ncharacter', 42])(
    'does not invent or accept an invalid display name %j',
    async (name) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ ...claims, name }))
      );
      expect(await verifyLineIdentity('synthetic-id-token', '123')).toEqual({ subject });
    }
  );
  it('sanitizes provider failures without leaking tokens or supplied profile details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Error('Secret synthetic-id-token name should not leak');
      })
    );
    await expect(verifyLineIdentity('synthetic-id-token', '123')).rejects.toThrow(
      /^LINE ID token verification failed$/
    );
  });
});
