import { describe, expect, it } from 'vitest';
import {
  defaultVenueEntryChannel,
  venueChannelLinkInputSchema,
  venueChannelLinks
} from '../src/venue-channel-links.js';

const origin = 'https://checkin.baiyinqigong.org';
const input = { venue: 'tw-demo-hall', channel: 'line', locale: 'zh_TW' } as const;

describe('planned channel-specific venue entry links', () => {
  it.each([
    ['TW', 'line'],
    ['MY', 'whatsapp'],
    ['SG', 'whatsapp'],
    ['HK', 'whatsapp']
  ] as const)('uses server country %s to suggest %s', (country, expected) => {
    expect(defaultVenueEntryChannel(country)).toBe(expected);
  });

  it.each(['', 'tw', 'US', 'Asia/Taipei', 'zh_TW', 'tw-demo-hall', ' TW', 'TW\n'])(
    'does not infer or normalize an unconfigured country: %j',
    (country) => expect(defaultVenueEntryChannel(country)).toBeNull()
  );

  it.each(['line', 'whatsapp'] as const)('builds explicit %s NFC, QR and link URLs', (channel) => {
    const links = venueChannelLinks(origin, { ...input, channel });
    for (const source of ['nfc', 'qr', 'link'] as const) {
      expect(links[source]).toBe(
        `${origin}/venue-checkin?venue=tw-demo-hall&source=${source}&channel=${channel}&lang=zh_TW`
      );
      const url = new URL(links[source]);
      expect([...url.searchParams.keys()]).toEqual(['venue', 'source', 'channel', 'lang']);
      expect(url.hash).toBe('');
      expect(url.username).toBe('');
    }
  });

  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'keeps %s independent of channel/country',
    (locale) => {
      expect(
        new URL(
          venueChannelLinks(origin, { ...input, channel: 'whatsapp', locale }).nfc
        ).searchParams.get('lang')
      ).toBe(locale);
    }
  );

  it.each([
    '',
    'http://checkin.baiyinqigong.org',
    'https://checkin.baiyinqigong.org/',
    'https://checkin.baiyinqigong.org/path',
    'https://checkin.baiyinqigong.org?redirect=evil',
    'https://checkin.baiyinqigong.org#secret',
    'https://user:secret@checkin.baiyinqigong.org'
  ])('rejects a malformed server origin %j', (value) => {
    expect(() => venueChannelLinks(value, input)).toThrow();
  });

  it.each([
    { venue: '' },
    { venue: 'TW-DEMO-HALL' },
    { venue: 'tw-demo-hall\n' },
    { venue: 'tw-demo-hall&channel=whatsapp' },
    { venue: 'tw-' + 'a'.repeat(63) },
    { channel: 'telegram' },
    { channel: 'https://evil.example' },
    { locale: 'ms' },
    { token: 'private-credential' },
    { personId: 'another-person' },
    { redirect: 'https://evil.example' },
    { country: 'TW' },
    { source: 'nfc' }
  ])('rejects invalid or additional navigation fields: %j', (value) => {
    expect(venueChannelLinkInputSchema.safeParse({ ...input, ...value }).success).toBe(false);
  });
});
