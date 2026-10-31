/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import type { FastifyInstance } from 'fastify';
import {
  venueGuidancePresentation,
  venuePreviewUrl,
  type VenuePreviewEntry
} from './line-venue-checkin-page.js';
import { venueEntryCodeSchema, type VenueEntryAvailabilityResult } from './venue-entry-guidance.js';
import { htmlLocale, isLocale, resolveLocale, type Locale } from './ui-localization.js';

interface VenueEntry extends VenuePreviewEntry {
  channel?: 'line';
}
const keys = new Set(['venue', 'source', 'lang', 'channel']);
// This public URL has no SDK callback keys, credentials, identity or redirect input.
const parseEntry = (rawUrl: string, cookie?: string): VenueEntry | null => {
  if (rawUrl.length > 512 || rawUrl.includes('#')) return null;
  try {
    decodeURIComponent(rawUrl); // Reject malformed percent encoding, including invalid UTF-8.
    const url = new URL(rawUrl, 'https://entry.invalid');
    const query = url.searchParams;
    if (
      url.pathname !== '/venue-checkin' ||
      [...query.keys()].some((key) => !keys.has(key) || query.getAll(key).length !== 1)
    )
      return null;
    const venue = query.get('venue');
    const source = query.get('source');
    const lang = query.get('lang');
    const channel = query.get('channel');
    if (
      !venue ||
      !venueEntryCodeSchema.safeParse(venue).success ||
      (source !== null && source !== 'nfc' && source !== 'qr' && source !== 'link') ||
      (lang !== null && !isLocale(lang)) ||
      (channel !== null && channel !== 'line')
    )
      return null;
    return {
      venue,
      source: source ?? 'link',
      lang: resolveLocale({ lang }, cookie),
      ...(channel === null ? {} : { channel })
    };
  } catch {
    return null;
  }
};
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char
  );
const texts = {
  zh_TW: {
    title: '團練場入口',
    invalid: '入口參數無效或缺少場地代碼，請重新取得正確連結。',
    venue: '場地代碼（未驗證）',
    unknown:
      '尚無可信場地查詢；無法確認名稱、是否存在或是否停用。最終由簽到後端驗證場地；無效或停用場地不得簽到。',
    source: '請優先輕觸現場 NFC 標籤；無法感應時掃描 QR。來源及連結不是邀請或在場證明。',
    line: '使用 LINE 繼續',
    unavailable: 'LINE 入口未配置，暫時無法繼續。',
    pending: 'Telegram／WhatsApp 場地簽到尚未實作，暫不提供入口。',
    notice: '尚未記錄出席。此頁不要求登入或定位；來源標記不是身份、防偽或在場證明。'
  },
  zh_CN: {
    title: '团练场入口',
    invalid: '入口参数无效或缺少场地代码，请重新取得正确链接。',
    venue: '场地代码（未验证）',
    unknown:
      '尚无可信场地查询；无法确认名称、是否存在或是否停用。最终由签到后端验证场地；无效或停用场地不得签到。',
    source: '请优先轻触现场 NFC 标签；无法感应时扫描 QR。来源及链接不是邀请或在场证明。',
    line: '使用 LINE 继续',
    unavailable: 'LINE 入口未配置，暂时无法继续。',
    pending: 'Telegram／WhatsApp 场地签到尚未实作，暂不提供入口。',
    notice: '尚未记录出席。此页不要求登录或定位；来源标记不是身份、防伪或在场证明。'
  },
  en: {
    title: 'Venue entry',
    invalid: 'Invalid entry parameters or missing venue code. Obtain a valid link.',
    venue: 'Venue code (unverified)',
    unknown:
      'No trusted venue lookup is available. Name, existence and active status are unverified. The check-in backend must validate the venue; unknown or disabled venues cannot check in.',
    source:
      'Tap the on-site NFC tag first; scan QR if tapping is unavailable. Sources and links are not invitations or proof of presence.',
    line: 'Continue with LINE',
    unavailable: 'LINE entry is not configured. Unable to continue.',
    pending: 'Telegram / WhatsApp venue check-in is not implemented. No entry is available yet.',
    notice:
      'Attendance has NOT been recorded. This page requests no login or location. Source is not proof of identity, authenticity or presence.'
  }
} as const;
export interface ManagedVenueEntry {
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
}
export type ManagedVenueLookup = (
  requestId: string,
  code: string
) => Promise<ManagedVenueEntry | null>;
export type LegacyManagedLookup = ManagedVenueLookup;
/** Explicit opt-in, authoritative public DTO lookup. No legacy fallback on failure. */
export type VenueGuidanceLookup = (
  requestId: string,
  code: string
) => Promise<VenueEntryAvailabilityResult>;
const renderEntry = (
  entry: VenueEntry | null,
  lineAvailable: boolean,
  lang: Locale,
  managed?: ManagedVenueEntry | null,
  lookupFailed = false
): string => {
  const t = texts[lang];
  const allowed = (managed === undefined && !lookupFailed) || managed?.active === true;
  const lookupNotice =
    lang === 'en'
      ? {
          missing: 'Venue not found.',
          disabled: 'Venue disabled. Check-in is unavailable.',
          unavailable: 'Venue lookup unavailable. Please retry later.'
        }
      : lang === 'zh_CN'
        ? {
            missing: '场地不存在。',
            disabled: '场地已停用，无法签到。',
            unavailable: '场地查询暂不可用，请稍后再试。'
          }
        : {
            missing: '場地不存在。',
            disabled: '場地已停用，無法簽到。',
            unavailable: '場地查詢暫不可用，請稍後再試。'
          };
  const venueDescription = lookupFailed
    ? lookupNotice.unavailable
    : managed === undefined
      ? t.unknown
      : managed === null
        ? lookupNotice.missing
        : escapeHtml(managed.name) + (managed.active ? '' : ' — ' + lookupNotice.disabled);
  const query = entry
    ? new URLSearchParams({
        venue: entry.venue,
        source: entry.source ?? 'link',
        lang: entry.lang,
        channel: 'line'
      })
    : null;
  return `<!doctype html>
<html lang="${htmlLocale(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${t.title}</title>
<style>body{font:1.2rem/1.6 system-ui,sans-serif;max-width:36rem;margin:auto;padding:1rem;color:#18251d;background:#f7faf7}a{display:block;min-height:48px;padding:.5rem;border:2px solid #23623b;border-radius:.5rem;color:#164b2a}a:focus-visible{outline:3px solid #2358bc;outline-offset:4px}code{overflow-wrap:anywhere}footer{margin-top:2rem;font-size:.9rem}</style></head>
<body><main><h1>${t.title}</h1>${
    entry && query
      ? `<p>${managed ? '' : t.venue + ': '}<code>${escapeHtml(entry.venue)}</code></p><p role="status">${venueDescription}</p>${allowed && lineAvailable ? `<a href="/venue-checkin?${escapeHtml(query.toString())}">${t.line}</a>` : allowed ? `<p role="status">${t.unavailable}</p>` : ''}<p>${t.pending}</p>`
      : `<p role="alert">${t.invalid}</p>`
  }<p>${t.notice}</p></main><footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer></body></html>`;
};

const renderGuidedEntry = (
  entry: VenueEntry,
  lineAvailable: boolean,
  view: ReturnType<typeof venueGuidancePresentation>
): string => {
  const t = texts[entry.lang];
  const query = new URLSearchParams({
    venue: entry.venue,
    source: entry.source ?? 'link',
    lang: entry.lang,
    channel: 'line'
  });
  return `<!doctype html><html lang="${htmlLocale(entry.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${t.title}</title><style>body{font:1.2rem/1.65 system-ui,sans-serif;max-width:36rem;margin:auto;padding:1rem;color:#172b24;background:#f3f7f3}a{display:block;min-height:48px;padding:.75rem;color:#164b83}:focus-visible{outline:3px solid #ad5100}p,dd,a{overflow-wrap:anywhere}dd{margin-bottom:.5rem}footer{font-size:.8rem;margin-top:2rem}</style></head><body><main>${view.markup}${view.open ? `<p>${t.source}</p><p>${t.notice}</p>${lineAvailable ? `<a href="/venue-checkin?${escapeHtml(query.toString())}">${t.line}</a>` : `<p role="status">${t.unavailable}</p>`}` : ''}</main><footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer></body></html>`;
};

// No pool or learner-write adapter is accepted at this anonymous boundary.
export const registerVenueEntry = (
  app: FastifyInstance,
  liffId?: string,
  lookup?: LegacyManagedLookup,
  guidanceLookup?: VenueGuidanceLookup
) => {
  // Match the existing safe ID policy; never interpret configuration as a URL or path.
  const lineAvailable = typeof liffId === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(liffId);
  app.get('/venue-checkin', async (request, reply) => {
    reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-robots-tag', 'noindex, nofollow')
      .header('x-content-type-options', 'nosniff')
      .header('permissions-policy', 'geolocation=(), camera=(), microphone=()')
      .header(
        'content-security-policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      );
    const entry = parseEntry(request.url, request.headers.cookie);
    if (guidanceLookup !== undefined) {
      if (!entry)
        return reply
          .code(400)
          .type('text/html; charset=utf-8')
          .send(renderEntry(null, false, 'zh_TW'));
      let result: VenueEntryAvailabilityResult;
      try {
        result = await guidanceLookup(request.id, entry.venue);
      } catch {
        result = { status: 503, body: { error: 'venue_entry_unavailable' } };
      }
      const view = venueGuidancePresentation(result, entry.venue, entry.lang);
      if (view.open && lineAvailable && entry.channel === 'line') {
        const suffix = venuePreviewUrl(entry).slice('/line'.length);
        return reply
          .code(303)
          .redirect(`https://liff.line.me/${encodeURIComponent(liffId)}` + suffix);
      }
      return reply
        .code(view.open && entry.channel === 'line' && !lineAvailable ? 503 : view.result.status)
        .type('text/html; charset=utf-8')
        .send(renderGuidedEntry(entry, lineAvailable, view));
    }
    let managed: ManagedVenueEntry | null | undefined;
    let lookupFailed = false;
    if (entry && lookup) {
      try {
        managed = await lookup(request.id, entry.venue);
        if (managed && managed.code !== entry.venue) throw new Error('invalid venue binding');
        if (managed === null) reply.code(404);
        else if (!managed.active) reply.code(410);
      } catch {
        lookupFailed = true;
        reply.code(503);
      }
    }
    if (!entry) reply.code(400);
    else if (
      !lookupFailed &&
      (managed === undefined || managed?.active) &&
      entry.channel === 'line'
    ) {
      if (lineAvailable) {
        // Only the fixed official origin and server-owned ID, never Host/query/callback input.
        const suffix = venuePreviewUrl(entry).slice('/line'.length);
        return reply
          .code(303)
          .redirect(`https://liff.line.me/${encodeURIComponent(liffId)}` + suffix);
      }
      reply.code(503);
    }
    return reply
      .type('text/html; charset=utf-8')
      .send(renderEntry(entry, lineAvailable, entry?.lang ?? 'zh_TW', managed, lookupFailed));
  });
};
