import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWhatsAppTextSender,
  createWhatsAppNotificationSender,
  loadWhatsAppNotificationConfig,
  type WhatsAppNotificationConfig
} from '../src/whatsapp-client.js';
const config: WhatsAppNotificationConfig = {
  phoneNumberId: '12345',
  accessToken: 'mock-whatsapp-access-token',
  graphVersion: 'v99.0',
  approvedTemplate: 'application_approved',
  rejectedTemplate: 'application_rejected',
  englishTemplateLocale: 'en_US',
  chineseTemplateLocale: 'zh_TW'
};
afterEach(() => vi.unstubAllGlobals());
describe('Meta WhatsApp Cloud API transport', () => {
  it.each([
    ['approved', 'en'],
    ['rejected', 'en'],
    ['approved', 'zh_TW'],
    ['rejected', 'zh_TW']
  ] as const)(
    'sends %s as an approved-template payload in %s, not free text',
    async (decision, locale) => {
      const fetchMock = vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.accepted' }] }))
      );
      vi.stubGlobal('fetch', fetchMock);
      await createWhatsAppNotificationSender(config)('886912345600', decision, locale);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://graph.facebook.com/v99.0/12345/messages');
      const body = fetchMock.mock.calls[0]?.[1]?.body;
      if (typeof body !== 'string') throw new Error('Expected JSON body');
      const payload: unknown = JSON.parse(body);
      expect(payload).toMatchObject({
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: decision === 'approved' ? 'application_approved' : 'application_rejected',
          language: { code: locale === 'en' ? 'en_US' : 'zh_TW' }
        }
      });
      expect(payload).not.toHaveProperty('text');
    }
  );
  it('treats malformed success responses as failures and sanitizes transport errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}'))
    );
    await expect(createWhatsAppTextSender(config)('886912345600', 'hello')).rejects.toThrow(
      'not accepted'
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('upstream data must not escape');
      })
    );
    await expect(createWhatsAppTextSender(config)('886912345600', 'hello')).rejects.toThrow(
      'WhatsApp transport failed'
    );
  });
  it('rejects partial template configuration instead of silently enabling an unusable sender', () => {
    expect(loadWhatsAppNotificationConfig({})).toBeUndefined();
    expect(() => loadWhatsAppNotificationConfig({ WHATSAPP_ACCESS_TOKEN: 'mock' })).toThrow(
      'supplied together'
    );
  });
});
