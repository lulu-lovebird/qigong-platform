/** Public navigation only; neither a venue code nor a link is proof of presence.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { z } from 'zod';
import { localeSchema, type Locale } from './ui-localization.js';
import { venueEntryCodeSchema } from './venue-entry-guidance.js';
export const whatsappVenueOrigin = 'https://checkin.baiyinqigong.org';
export const whatsappVenueConfigSchema = z.strictObject({
  enabled: z.literal(true),
  publicOrigin: z.literal(whatsappVenueOrigin),
  publicPhoneNumber: z
    .string()
    .regex(/^[1-9][0-9]{6,14}$/)
    .refine((v) => v.trim() === v)
});
export type WhatsAppVenueConfig = z.infer<typeof whatsappVenueConfigSchema>;
export const loadWhatsAppVenueConfig = (
  source: NodeJS.ProcessEnv
): WhatsAppVenueConfig | undefined => {
  const enabled = z
    .enum(['true', 'false'])
    .default('false')
    .parse(source.WHATSAPP_VENUE_CHECKIN_ENABLED);
  if (enabled !== 'true') return undefined;
  return whatsappVenueConfigSchema.parse({
    enabled: true,
    publicOrigin: whatsappVenueOrigin,
    publicPhoneNumber: source.WHATSAPP_VENUE_PUBLIC_PHONE
  });
};
export const whatsappVenuePageQuerySchema = z.strictObject({
  venue: venueEntryCodeSchema,
  source: z.enum(['nfc', 'qr', 'link']).default('link'),
  lang: localeSchema.default('zh_TW')
});
export const whatsappVenueCommand = (text: string): { code: string; locale?: Locale } | null => {
  if (text.length > 160) return null;
  const match = /^(?:團練|团练|\/?venue)[ \t]+(\S+)(?:[ \t]+(zh_TW|zh_CN|en))?$/i.exec(text.trim());
  if (!match) return null;
  const code = venueEntryCodeSchema.safeParse(match[1]);
  const locale = match[2] === undefined ? undefined : localeSchema.safeParse(match[2]);
  if (!code.success || (locale !== undefined && !locale.success)) return null;
  return { code: code.data, ...(locale?.success ? { locale: locale.data } : {}) };
};
export const whatsappVenuePagePath = (
  code: string,
  locale: Locale,
  source: 'nfc' | 'qr' | 'link' = 'link'
) => {
  const value = whatsappVenuePageQuerySchema.parse({ venue: code, lang: locale, source });
  return (
    '/whatsapp/venue-checkin?' +
    new URLSearchParams({ venue: value.venue, source: value.source, lang: value.lang }).toString()
  );
};
export const whatsappVenuePrivateLink = (code: string, locale: Locale, token: string) => {
  z.string()
    .length(43)
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .parse(token);
  return whatsappVenueOrigin + whatsappVenuePagePath(code, locale) + '#' + token;
};
export const whatsappVenueChatUrl = (config: WhatsAppVenueConfig, code: string, locale: Locale) => {
  const value = whatsappVenueConfigSchema.parse(config);
  venueEntryCodeSchema.parse(code);
  localeSchema.parse(locale);
  return (
    `https://wa.me/${value.publicPhoneNumber}?` +
    new URLSearchParams({ text: `venue ${code} ${locale}` }).toString()
  );
};
