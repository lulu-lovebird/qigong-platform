import { describe, expect, it } from 'vitest';
import {
  whatsappVenueCommand,
  whatsappVenuePrivateLink,
  whatsappVenuePageQuerySchema,
  whatsappVenueChatUrl,
  whatsappVenueConfigSchema,
  loadWhatsAppVenueConfig
} from '../src/whatsapp-venue-navigation.js';
const config = {
  enabled: true as const,
  publicOrigin: 'https://checkin.baiyinqigong.org',
  publicPhoneNumber: '60110000000'
} as const;
describe('WhatsApp venue navigation and private return links', () => {
  it('defaults the venue switch off and requires a public business phone only when on', () => {
    expect(loadWhatsAppVenueConfig({})).toBeUndefined();
    expect(
      loadWhatsAppVenueConfig({
        WHATSAPP_VENUE_CHECKIN_ENABLED: 'false',
        WHATSAPP_VENUE_PUBLIC_PHONE: 'bad'
      })
    ).toBeUndefined();
    expect(
      loadWhatsAppVenueConfig({
        WHATSAPP_VENUE_CHECKIN_ENABLED: 'true',
        WHATSAPP_VENUE_PUBLIC_PHONE: '60110000000'
      })
    ).toEqual(config);
    expect(() => loadWhatsAppVenueConfig({ WHATSAPP_VENUE_CHECKIN_ENABLED: 'true' })).toThrow();
    expect(() => loadWhatsAppVenueConfig({ WHATSAPP_VENUE_CHECKIN_ENABLED: 'TRUE' })).toThrow();
  });
  it.each(['團練 my-demo-hall', '团练 my-demo-hall', 'venue my-demo-hall', '/venue my-demo-hall'])(
    'parses bounded command %s',
    (text) => {
      expect(whatsappVenueCommand(text)).toEqual({ code: 'my-demo-hall' });
    }
  );
  it('keeps an explicitly requested locale separate from identity', () => {
    expect(whatsappVenueCommand('venue sg-demo-hall en')).toEqual({
      code: 'sg-demo-hall',
      locale: 'en'
    });
  });
  it.each([
    'venue MY-HALL',
    'venue my-demo-hall https://evil.example',
    'venue my-demo-hall en extra',
    'venue my-demo-hall\nen',
    'venue my-demo-hall fr',
    'checkin',
    'venue ' + 'a'.repeat(200)
  ])('rejects malformed command %j', (text) => expect(whatsappVenueCommand(text)).toBeNull());
  it('puts a validated private token only in the fragment of the fixed venue page', () => {
    const token = 't'.repeat(43);
    const link = new URL(whatsappVenuePrivateLink('my-demo-hall', 'en', token));
    expect(link.origin).toBe(config.publicOrigin);
    expect(link.pathname).toBe('/whatsapp/venue-checkin');
    expect([...link.searchParams.keys()]).toEqual(['venue', 'source', 'lang']);
    expect(link.searchParams.get('venue')).toBe('my-demo-hall');
    expect(link.hash).toBe('#' + token);
    expect(link.search).not.toContain(token);
  });
  it.each(['short', 't'.repeat(43) + '\n', 'x'.repeat(43) + '&redirect=evil'])(
    'rejects an invalid private token %j',
    (token) => expect(() => whatsappVenuePrivateLink('my-demo-hall', 'en', token)).toThrow()
  );
  it('builds only a fixed public business chat link with a bounded prefilled command', () => {
    const link = new URL(whatsappVenueChatUrl(config, 'hk-demo-hall', 'zh_TW'));
    expect(link.origin).toBe('https://wa.me');
    expect(link.pathname).toBe('/60110000000');
    expect(link.searchParams.get('text')).toBe('venue hk-demo-hall zh_TW');
  });
  it.each([
    { ...config, publicOrigin: 'https://evil.example' },
    { ...config, publicPhoneNumber: '1/redirect' },
    { ...config, enabled: false }
  ])('rejects unsafe server configuration %j', (value) =>
    expect(whatsappVenueConfigSchema.safeParse(value).success).toBe(false)
  );
  it.each([
    { venue: 'my-demo-hall', redirect: 'https://evil.example' },
    { venue: 'my-demo-hall', token: 'secret' },
    { venue: ['my-demo-hall', 'sg-demo-hall'] }
  ])('rejects unsafe or duplicate page query %j', (value) =>
    expect(whatsappVenuePageQuerySchema.safeParse(value).success).toBe(false)
  );
});
