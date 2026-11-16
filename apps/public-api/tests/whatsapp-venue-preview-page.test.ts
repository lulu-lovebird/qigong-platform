import { describe, expect, it } from 'vitest';
import {
  renderWhatsAppVenuePreview,
  whatsappVenuePreviewStates,
  type WhatsAppVenuePreviewInput
} from '../src/whatsapp-venue-preview-page.js';

const availability = {
  status: 200,
  body: {
    version: 1,
    availability: 'open',
    venue: { code: 'my-demo-hall', name: '示範團練場', timezone: 'Asia/Kuala_Lumpur' },
    observedAt: '2026-11-16T00:10:00Z',
    relevantSession: {
      opensAt: '2026-11-15T23:30:00Z',
      startsAt: '2026-11-16T00:00:00Z',
      endsAt: '2026-11-16T01:00:00Z'
    },
    nextSession: null
  }
};
const receipt = {
  ok: true,
  venue: availability.body.venue,
  checkedInAt: '2026-11-16T00:10:00Z',
  attendanceDate: '2026-11-16',
  replayed: false
};
const input: WhatsAppVenuePreviewInput = {
  code: 'my-demo-hall',
  locale: 'zh_TW',
  availability,
  state: 'ready'
};

describe('read-only WhatsApp venue UI review renderer', () => {
  it.each(
    (['zh_TW', 'zh_CN', 'en'] as const).flatMap((locale) =>
      whatsappVenuePreviewStates.map((state) => ({ locale, state }))
    )
  )('renders $locale/$state without scripts, live links, login or GPS', ({ locale, state }) => {
    const html = renderWhatsAppVenuePreview({ ...input, locale, state, receipt });
    expect(html).toContain('WhatsApp');
    expect(html).toContain('background:#f6f7fb');
    expect(html).toContain('class="venue-timezone">Asia/Kuala_Lumpur');
    expect(html).toContain('min-height:60px');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script|<form|<a\b|navigator\.|fetch\(|liff\.|document\.cookie/);
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => /\bdisabled\b/.test(button))).toBe(true);
    if (state === 'success') {
      expect(html).toContain('<div class="checkin-stamp" aria-hidden="true">');
      expect(html).toContain('wa-preview-success');
    } else {
      expect(html).not.toContain('<div class="checkin-stamp"');
    }
  });

  it('uses the site command only in a clearly marked, disabled login preview', () => {
    const html = renderWhatsAppVenuePreview({ ...input, state: 'login' });
    expect(html).toContain('示範狀態');
    expect(html).toContain('<code>團練 my-demo-hall</code>');
    expect(html).toContain('type="checkbox" checked disabled');
    expect(html).not.toContain('phoneNumberId');
    expect(html).not.toContain('wa.me/');
  });

  it.each([
    undefined,
    {},
    { ...receipt, ok: false },
    { ...receipt, isTest: true, verificationMode: 'distance_debug' },
    { ...receipt, venue: { ...receipt.venue, code: 'sg-another-hall' } },
    { ...receipt, checkedInAt: 'not-a-time' },
    { ...receipt, attendanceDate: '2026-11-15' },
    { ...receipt, venue: { ...receipt.venue, timezone: 'invalid/timezone' } }
  ])('does not turn a malformed, wrong-day or wrong-mode receipt into a stamp: %j', (sample) => {
    const html = renderWhatsAppVenuePreview({ ...input, state: 'success', receipt: sample });
    expect(html).toContain('無法確認場地或打卡結果');
    expect(html).not.toContain('<div class="checkin-stamp"');
  });

  it.each(['before_open', 'ended', 'not_activity_day', 'disabled'])(
    'keeps the %s calendar read-only without login or check-in controls',
    (state) => {
      const html = renderWhatsAppVenuePreview({
        ...input,
        state: 'success',
        receipt,
        availability: {
          ...availability,
          body: {
            ...availability.body,
            availability: state,
            relevantSession: ['disabled', 'not_activity_day'].includes(state)
              ? null
              : availability.body.relevantSession
          }
        }
      });
      expect(html).not.toContain('<button');
      expect(html).not.toContain('<div class="checkin-stamp"');
      if (state !== 'disabled') expect(html).toContain('class="schedule-warning"');
    }
  );

  it('does not reflect invalid venue codes into the page or command', () => {
    const html = renderWhatsAppVenuePreview({
      ...input,
      code: '<script>attack</script>',
      state: 'login'
    });
    expect(html).not.toContain('attack');
    expect(html).not.toContain('<button');
  });

  it('escapes public venue names and receipt text without creating markup', () => {
    const name = '<img src=x onerror="attack">';
    const html = renderWhatsAppVenuePreview({
      ...input,
      state: 'success',
      receipt: { ...receipt, venue: { ...receipt.venue, name } },
      availability: {
        ...availability,
        body: { ...availability.body, venue: { ...availability.body.venue, name } }
      }
    });
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
  });

  it('distinguishes an unsent GPS failure from an uncertain write result', () => {
    const gps = renderWhatsAppVenuePreview({ ...input, state: 'gps_error' });
    const uncertain = renderWhatsAppVenuePreview({ ...input, state: 'uncertain' });
    expect(gps).toContain('尚未送出出席');
    expect(uncertain).toContain('勿假定未記錄');
    expect(gps).not.toContain('<div class="checkin-stamp"');
    expect(uncertain).not.toContain('<div class="checkin-stamp"');
  });
});
