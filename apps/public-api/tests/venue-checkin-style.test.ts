import { describe, expect, it } from 'vitest';
import { renderVenuePreview, venueGuidancePresentation } from '../src/line-venue-checkin-page.js';
import type { VenueEntryAvailabilityResult } from '../src/venue-entry-guidance.js';

const guidance: VenueEntryAvailabilityResult = {
  status: 200,
  body: {
    version: 1,
    availability: 'open',
    venue: { code: 'tw-demo-hall', name: '示範團練場', timezone: 'Asia/Taipei' },
    observedAt: '2026-11-15T00:00:00Z',
    relevantSession: {
      opensAt: '2026-11-14T23:30:00Z',
      startsAt: '2026-11-15T00:00:00Z',
      endsAt: '2026-11-15T01:00:00Z'
    },
    nextSession: null
  }
};

describe('venue check-in workspace visual consistency', () => {
  it.each(['zh_TW', 'zh_CN', 'en'] as const)('shares the workspace shell in %s', (lang) => {
    for (const html of [
      renderVenuePreview('mock-liff', { venue: 'tw-demo-hall', lang }, 'checkin', true),
      renderVenuePreview('mock-liff', { venue: 'tw-demo-hall', lang }, 'checkin', true, undefined, {
        result: guidance
      }),
      renderVenuePreview('mock-liff', null, 'checkin', true)
    ]) {
      expect(html).toContain('background:#f6f7fb');
      expect(html).toContain('background:#0d6efd');
      expect(html).toContain('border-radius:16px');
      expect(html).toContain('min-height:48px');
      expect(html).toContain(':focus-visible');
      expect(html).toContain('[hidden]{display:none!important}');
      expect(html).toContain('<header class="page-header">');
      expect(html).toContain('<section class="venue-card">');
      expect(html).not.toContain('background:#195941');
    }
  });

  it('places the guided language control in the header, outside the hideable calendar', () => {
    const html = renderVenuePreview(
      'mock-liff',
      { venue: 'tw-demo-hall', lang: 'zh_TW' },
      'checkin',
      true,
      undefined,
      { result: guidance }
    ).split('<script')[0]!;
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toMatch(/<header[^>]*>[\s\S]*id="guided-language"[\s\S]*<\/header>/);
    expect(html.indexOf('id="guided-language"')).toBeLessThan(html.indexOf('id="guided-calendar"'));
    expect(html.indexOf('id="guided-status"')).toBeLessThan(html.indexOf('id="guided-checkin"'));
    expect(html).toContain('id="guided-receipt" class="venue-actions" hidden');
    expect(html).toContain('示範團練場');
    expect(html).toContain(
      '<p class="venue-identity"><span class="venue-name" title="示範團練場 — tw-demo-hall">示範團練場</span><span class="venue-timezone">Asia/Taipei</span></p>'
    );
    expect(html).not.toContain('<p>Asia/Taipei</p>');
  });

  it('uses a compact single session summary with full accessible timestamps', () => {
    const html = renderVenuePreview(
      'mock-liff',
      { venue: 'tw-demo-hall', lang: 'zh_TW' },
      'checkin',
      true,
      undefined,
      { result: guidance }
    );
    expect(html).toContain('<h1>團練場打卡</h1>');
    expect(html).toContain(
      '<span>2026/11/15 08:00–09:00</span><span class="opening-time">07:30 開放簽到</span>'
    );
    expect(html).toMatch(
      /class="session-summary" aria-label="團練開始 [^"]+團練結束 [^"]+開放簽到/
    );
    expect(html).not.toContain('<dl>');
    expect(html).toContain('id="guided-checkin" class="checkin-primary"');
    expect(html).toContain('.checkin-primary{min-height:60px;');
    expect(html).toContain('.opening-time{');
    expect(html).toContain('<div class="checkin-stamp" aria-hidden="true">');
    expect(html).toContain('.checkin-stamp{display:none;');
    expect(html).toContain('main:has(#guided-receipt:not([hidden])) .checkin-stamp{display:grid}');
  });

  it('retains different local dates across midnight and meaningful seconds', () => {
    if (!('availability' in guidance.body)) throw new Error('Invalid fixture');
    const html = renderVenuePreview(
      'mock-liff',
      { venue: 'tw-demo-hall', lang: 'zh_TW' },
      'checkin',
      true,
      undefined,
      {
        result: {
          status: 200,
          body: {
            ...guidance.body,
            relevantSession: {
              opensAt: '2026-11-14T15:45:00Z',
              startsAt: '2026-11-14T16:15:00Z',
              endsAt: '2026-11-15T16:30:15Z'
            }
          }
        }
      }
    );
    expect(html).toContain('2026/11/15 00:15–2026/11/16 00:30:15');
    expect(html).toContain('2026/11/14 23:45 開放簽到');
  });

  it.each(['before_open', 'ended', 'not_activity_day'] as const)(
    'uses a warning only for the non-check-in schedule state %s',
    (availability) => {
      if (!('availability' in guidance.body)) throw new Error('Invalid fixture');
      const view = venueGuidancePresentation(
        {
          status: 200,
          body: {
            ...guidance.body,
            availability,
            relevantSession:
              availability === 'not_activity_day' ? null : guidance.body.relevantSession
          }
        },
        'tw-demo-hall',
        'zh_TW'
      );
      expect(view.open).toBe(false);
      expect(view.markup).toContain('<p role="status" class="schedule-warning">');
      expect(view.markup).not.toContain('<button');
      const open = venueGuidancePresentation(guidance, 'tw-demo-hall', 'zh_TW');
      expect(open.open).toBe(true);
      expect(open.markup).not.toContain('schedule-warning');
      expect(open.markup).toContain('<p role="status" class="schedule-open">');
    }
  );

  it('keeps the test warning and manual code clearly separate from formal attendance', () => {
    const html = renderVenuePreview(
      'mock-liff',
      { venue: 'tw-location-test', lang: 'zh_TW' },
      'checkin',
      true,
      'tw-location-test'
    );
    expect(html).toContain('class="notice" data-warning="true"');
    expect(html).toContain('僅供測試，不計正式出席');
    expect(html).toContain('id="preview-debug-token" type="password"');
  });
});
