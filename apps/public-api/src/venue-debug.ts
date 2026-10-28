/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const venueDebugMigrationVersion = '0057_venue_test_scope.sql';
export type VenueDebugVenueCode = 'tw-location-test' | 'tw-taipei-cks';
const isDebugVenue = (code: unknown): code is VenueDebugVenueCode =>
  code === 'tw-location-test' || code === 'tw-taipei-cks';
export const venueDebugLabel = '異地測試，未計入正式出席';
/** Server-owned, never serialized to pages. DB enablement is separately owner-provisioned. */
export interface VenueDebugConfig {
  readonly enabled: true;
  readonly venueCode: VenueDebugVenueCode;
  readonly expiresAt: string;
  readonly tokenHash: string;
}
export const validateVenueDebugConfig = (config: VenueDebugConfig): VenueDebugConfig => {
  if (
    config.enabled !== true ||
    !isDebugVenue(config.venueCode) ||
    !/^[0-9a-f]{64}$/.test(config.tokenHash) ||
    !Number.isFinite(Date.parse(config.expiresAt)) ||
    Date.parse(config.expiresAt) <= Date.now() ||
    Date.parse(config.expiresAt) > Date.now() + 3600000 ||
    new Date(Date.parse(config.expiresAt)).toISOString() !== config.expiresAt
  )
    throw new Error('invalid venue debug configuration');
  return Object.freeze({
    enabled: true,
    venueCode: config.venueCode,
    expiresAt: config.expiresAt,
    tokenHash: config.tokenHash
  });
};
export const loadVenueDebugConfig = (source: NodeJS.ProcessEnv): VenueDebugConfig | undefined => {
  const enabled = source.VENUE_DISTANCE_DEBUG_ENABLED ?? 'false';
  if (enabled === 'false') return undefined;
  if (enabled !== 'true') throw new Error('invalid venue debug configuration');
  return validateVenueDebugConfig({
    enabled: true,
    venueCode: source.VENUE_DISTANCE_DEBUG_VENUE_CODE as VenueDebugVenueCode,
    expiresAt: source.VENUE_DISTANCE_DEBUG_EXPIRES_AT ?? '',
    tokenHash: source.VENUE_DISTANCE_DEBUG_TOKEN_SHA256 ?? ''
  });
};
/** Hash both sides to fixed length; malformed, empty and duplicate headers fail closed. */
export const acceptsVenueDebugToken = (
  config: VenueDebugConfig | undefined,
  token: unknown,
  venue: string
): boolean => {
  if (!config || typeof token !== 'string' || token.length < 32 || token.length > 256) return false;
  const matches = timingSafeEqual(
    createHash('sha256').update(token, 'utf8').digest(),
    Buffer.from(config.tokenHash, 'hex')
  );
  return (
    matches &&
    isDebugVenue(venue) &&
    venue === config.venueCode &&
    Date.parse(config.expiresAt) > Date.now()
  );
};
/** Only sent as a parameter inside the request transaction; raw token never enters SQL. */
export const venueDebugProof = (
  config: VenueDebugConfig,
  requestId: string,
  subject: string,
  venue: string,
  issued: number
): string =>
  createHmac('sha256', Buffer.from(config.tokenHash, 'hex'))
    .update(
      [requestId.toLowerCase(), subject, venue, issued, Date.parse(config.expiresAt)].join('|')
    )
    .digest('hex');
