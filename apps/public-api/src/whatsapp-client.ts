import { z } from 'zod';
import type { NotificationSender } from './onboarding-notifications.js';

export const whatsappTransportSchema = z.object({
  phoneNumberId: z.string().regex(/^\d+$/),
  accessToken: z.string().min(20),
  graphVersion: z.string().regex(/^v\d+\.\d+$/)
});
export type WhatsAppTransport = z.infer<typeof whatsappTransportSchema>;
export const whatsappNotificationSchema = whatsappTransportSchema.extend({
  approvedTemplate: z.string().regex(/^[a-z0-9_]+$/),
  rejectedTemplate: z.string().regex(/^[a-z0-9_]+$/),
  englishTemplateLocale: z.string().regex(/^en(?:_[A-Z]{2})?$/),
  chineseTemplateLocale: z.literal('zh_TW')
});
export type WhatsAppNotificationConfig = z.infer<typeof whatsappNotificationSchema>;
export const loadWhatsAppNotificationConfig = (
  source: NodeJS.ProcessEnv
): WhatsAppNotificationConfig | undefined => {
  const values = {
    phoneNumberId: source.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: source.WHATSAPP_ACCESS_TOKEN,
    graphVersion: source.WHATSAPP_GRAPH_VERSION,
    approvedTemplate: source.WHATSAPP_APPROVED_TEMPLATE,
    rejectedTemplate: source.WHATSAPP_REJECTED_TEMPLATE,
    englishTemplateLocale: source.WHATSAPP_TEMPLATE_LANGUAGE_EN
  };
  if (!Object.values(values).some(Boolean)) return undefined;
  if (!Object.values(values).every(Boolean))
    throw new Error('WhatsApp notification configuration must be supplied together');
  return whatsappNotificationSchema.parse({ ...values, chineseTemplateLocale: 'zh_TW' });
};
type WhatsAppPayload = { to: string } & (
  | { type: 'text'; text: { body: string; preview_url: false } }
  | { type: 'template'; template: { name: string; language: { code: string } } }
);
export const sendWhatsAppMessage = async (config: WhatsAppTransport, payload: WhatsAppPayload) => {
  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          ...payload
        }),
        signal: AbortSignal.timeout(5000)
      }
    );
  } catch {
    throw new Error('WhatsApp transport failed');
  }
  if (!response.ok) throw new Error(`WhatsApp HTTP ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('WhatsApp response not accepted');
  }
  if (
    !z.object({ messages: z.array(z.object({ id: z.string().min(1) })).min(1) }).safeParse(body)
      .success
  )
    throw new Error('WhatsApp response not accepted');
};
export const createWhatsAppTextSender =
  (config: WhatsAppTransport) => (recipient: string, text: string) =>
    sendWhatsAppMessage(config, {
      to: recipient,
      type: 'text',
      text: { body: text, preview_url: false }
    });
export const createWhatsAppNotificationSender =
  (config: WhatsAppNotificationConfig): NotificationSender =>
  (recipient, decision, locale = 'zh_TW') =>
    sendWhatsAppMessage(config, {
      to: recipient,
      type: 'template',
      template: {
        name: decision === 'approved' ? config.approvedTemplate : config.rejectedTemplate,
        language: {
          code: locale === 'en' ? config.englishTemplateLocale : config.chineseTemplateLocale
        }
      }
    });
