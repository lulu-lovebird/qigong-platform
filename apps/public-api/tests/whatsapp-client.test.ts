import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createWhatsAppTextSender,
  createWhatsAppWorkspaceMenuSender,
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
  chineseTemplateLocale: 'zh_TW',
  simplifiedTemplateLocale: 'zh_CN'
};
afterEach(() => vi.unstubAllGlobals());
describe('Meta WhatsApp Cloud API transport', () => {
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'adds a bounded public-help menu row in %s without personal URL data',
    async (locale) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        Response.json({ messages: [{ id: 'synthetic-menu-id' }] })
      );
      vi.stubGlobal('fetch', fetch);
      await createWhatsAppWorkspaceMenuSender(config)('659900001234', 'Synthetic menu', locale);
      const body = fetch.mock.calls[0]?.[1]?.body;
      if (typeof body !== 'string') throw Error('Missing menu payload');
      const data = z
        .object({
          interactive: z.object({
            action: z.object({
              sections: z.array(
                z.object({ rows: z.array(z.object({ id: z.string(), title: z.string() })) })
              )
            })
          })
        })
        .parse(JSON.parse(body));
      const rows = data.interactive.action.sections[0]?.rows;
      if (!rows) throw Error('Missing rows');
      expect(rows.map((r) => r.id)).toEqual([
        'workspace:checkin',
        'workspace:leaderboard',
        'workspace:methods',
        'workspace:achievements',
        'workspace:journal',
        'workspace:help'
      ]);
      expect(rows.every((r) => [...r.title].length <= 24)).toBe(true);
      expect(body).not.toMatch(/#|access_token|session=/);
    }
  );
  it.each([
    ['approved', 'en'],
    ['rejected', 'en'],
    ['approved', 'zh_TW'],
    ['rejected', 'zh_TW'],
    ['approved', 'zh_CN'],
    ['rejected', 'zh_CN']
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
          language: { code: locale === 'en' ? 'en_US' : locale === 'zh_CN' ? 'zh_CN' : 'zh_TW' }
        }
      });
      expect(payload).not.toHaveProperty('text');
    }
  );
  it('never substitutes a Traditional template when a Simplified variation is not configured', () => {
    const { simplifiedTemplateLocale, ...withoutSimplified } = config;
    expect(simplifiedTemplateLocale).toBe('zh_CN');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    expect(() =>
      createWhatsAppNotificationSender(withoutSimplified)('886912345600', 'approved', 'zh_CN')
    ).toThrow('simplified notification template is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
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
