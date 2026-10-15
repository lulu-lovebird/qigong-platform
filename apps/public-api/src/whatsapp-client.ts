import { uiText } from './ui-localization.js';
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
  chineseTemplateLocale: z.literal('zh_TW'),
  simplifiedTemplateLocale: z.literal('zh_CN').optional()
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
  if (!Object.values(values).some(Boolean)) {
    if (source.WHATSAPP_TEMPLATE_LANGUAGE_ZH_CN)
      throw Error('WhatsApp base configuration is required');
    return undefined;
  }
  if (!Object.values(values).every(Boolean))
    throw new Error('WhatsApp notification configuration must be supplied together');
  return whatsappNotificationSchema.parse({
    ...values,
    chineseTemplateLocale: 'zh_TW',
    simplifiedTemplateLocale: source.WHATSAPP_TEMPLATE_LANGUAGE_ZH_CN
  });
};
type WhatsAppPayload = { to: string } & (
  | { type: 'text'; text: { body: string; preview_url: false } }
  | { type: 'template'; template: { name: string; language: { code: string } } }
  | {
      type: 'interactive';
      interactive: {
        type: 'list';
        body: { text: string };
        action: {
          button: string;
          sections: Array<{ title: string; rows: Array<{ id: string; title: string }> }>;
        };
      };
    }
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
export const createWhatsAppWorkspaceMenuSender =
  (config: WhatsAppTransport) =>
  (recipient: string, text: string, locale: 'zh_TW' | 'zh_CN' | 'en') =>
    sendWhatsAppMessage(config, {
      to: recipient,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text },
        action: {
          button: locale === 'en' ? 'Choose a feature' : uiText(locale, '選擇功能'),
          sections: [
            {
              title: locale === 'en' ? 'Learner workspace' : uiText(locale, '學員工作區'),
              rows: [
                ['checkin', locale === 'en' ? 'Check-in' : uiText(locale, '練功打卡')],
                ['leaderboard', locale === 'en' ? 'Leaderboard' : uiText(locale, '排行榜')],
                ['methods', locale === 'en' ? 'Method analysis' : uiText(locale, '功法分析')],
                [
                  'achievements',
                  locale === 'en' ? 'Achievements / history' : uiText(locale, '成就／月曆')
                ],
                ['journal', locale === 'en' ? 'Shared reflections' : uiText(locale, '心得分享')]
              ].map(([id, title]) => ({ id: 'workspace:' + id, title: title! }))
            }
          ]
        }
      }
    });
export const createWhatsAppNotificationSender =
  (config: WhatsAppNotificationConfig): NotificationSender =>
  (recipient, decision, locale = 'zh_TW') => {
    const language =
      locale === 'en'
        ? config.englishTemplateLocale
        : locale === 'zh_CN'
          ? config.simplifiedTemplateLocale
          : config.chineseTemplateLocale;
    if (!language) throw Error('WhatsApp simplified notification template is not configured');
    return sendWhatsAppMessage(config, {
      to: recipient,
      type: 'template',
      template: {
        name: decision === 'approved' ? config.approvedTemplate : config.rejectedTemplate,
        language: { code: language }
      }
    });
  };
