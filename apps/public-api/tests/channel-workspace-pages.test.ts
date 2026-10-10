import { Script } from 'node:vm';
import { describe, it, expect } from 'vitest';
import { renderChannelWorkspacePage } from '../src/channel-workspace-pages.js';
import type { ChannelWorkspacePage } from '../src/channel-workspace-pages.js';
describe('LINE workspace generated scripts', () => {
  it.each(['zh_TW', 'en'] as const)(
    'renders syntax-valid WhatsApp %s pages without LINE or Telegram SDKs',
    (locale) => {
      for (const page of [
        'checkin',
        'leaderboard',
        'methods',
        'achievements',
        'journal'
      ] as const) {
        const html = renderChannelWorkspacePage({ platform: 'whatsapp' }, page, locale);
        for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
          expect(() => new Script(m[1]!)).not.toThrow();
        expect(html).not.toContain('telegram.org');
        expect(html).not.toContain('static.line-scdn.net');
        expect(html).toContain('/whatsapp/');
        if (page === 'achievements') {
          expect(html).toContain('id="channel-calendar"');
          expect(html).toContain('renderChannelCalendar(data)');
        }
      }
    }
  );
  it.each(['checkin', 'leaderboard', 'methods', 'achievements', 'journal'] as const)(
    'parses %s and authenticates through LIFF, not browser IDs',
    (page: ChannelWorkspacePage) => {
      const html = renderChannelWorkspacePage(
        { platform: 'line', liffId: '123456-test' },
        page,
        'en'
      );
      for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
        expect(() => new Script(match[1]!)).not.toThrow();
      expect(html).toContain('await lineReady;');
      expect(html).toContain('JSON.stringify({idToken,locale,...values})');
      expect(html).not.toContain('telegram.org');
      expect(html).not.toContain('JSON.stringify({token,locale,...values})');
      expect(html).toContain('<html lang="zh-Hant">');
      expect(html.indexOf('src="https://static.line-scdn.net')).toBeLessThan(
        html.indexOf('await liff.init')
      );
    }
  );
});
