/** Public navigation only: never proof of identity, presence or invitation.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { z } from 'zod';
import { localeSchema } from './ui-localization.js';
import { venueEntryCodeSchema } from './venue-entry-guidance.js';
import { trustedVenueOrigin } from './venue-management.js';

export const venueEntryChannelSchema = z.enum(['line', 'whatsapp']);
export type VenueEntryChannel = z.infer<typeof venueEntryChannelSchema>;

/** Server-owned country configuration only, not IP, language or a venue-code prefix.
 * Unknown countries require an explicit choice; never silently select a channel. */
export const defaultVenueEntryChannel = (countryCode: string): VenueEntryChannel | null => {
  switch (countryCode) {
    case 'TW':
      return 'line';
    case 'MY':
    case 'SG':
    case 'HK':
      return 'whatsapp';
    default:
      return null;
  }
};

export const venueChannelLinkInputSchema = z.strictObject({
  venue: venueEntryCodeSchema,
  channel: venueEntryChannelSchema,
  locale: localeSchema
});
export type VenueChannelLinkInput = z.infer<typeof venueChannelLinkInputSchema>;

/** Pure planned URL contract; does not enable routes or assert channel availability.
 * Pass only the deployment's trusted origin, never request/forwarded Host headers.
 * Callers must gate publication on the corresponding channel being enabled. */
export const venueChannelLinks = (publicOrigin: string, input: VenueChannelLinkInput) => {
  const origin = trustedVenueOrigin(publicOrigin);
  const value = venueChannelLinkInputSchema.parse(input);
  const entry = (source: 'nfc' | 'qr' | 'link') =>
    `${origin}/venue-checkin?${new URLSearchParams({
      venue: value.venue,
      source,
      channel: value.channel,
      lang: value.locale
    })}`;
  return { nfc: entry('nfc'), qr: entry('qr'), link: entry('link') };
};
