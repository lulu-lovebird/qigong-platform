import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { learnerHelpContent, helpUrl, isHelpCommand } from '../src/learner-help-content.js';
import { telegramFeatureButtons } from '../src/telegram-feature-buttons.js';

describe('public channel-specific beginner help', () => {
  it.each(
    (['line', 'telegram', 'whatsapp'] as const).flatMap((channel) =>
      (['zh_TW', 'zh_CN', 'en'] as const).map((locale) => ({ channel, locale }))
    )
  )(
    'serves $channel/$locale before enrollment without database or credentials',
    async ({ channel, locale }) => {
      const pool = new pg.Pool();
      const query = vi.spyOn(pool, 'query').mockRejectedValue(Error('No database for help'));
      const app = buildApp({ pool, logger: false });
      try {
        const response = await app.inject('/' + channel + '/help?lang=' + locale);
        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['referrer-policy']).toBe('no-referrer');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['content-security-policy']).toContain("default-src 'none'");
        expect(response.body).toContain(
          '<html lang="' +
            (locale === 'en' ? 'en' : locale === 'zh_CN' ? 'zh-Hans' : 'zh-Hant') +
            '">'
        );
        for (const id of ['start', 'daily', 'history', 'more'])
          expect(response.body).toContain('id="' + id + '"');
        expect(response.body.indexOf('id="daily"')).toBeLessThan(
          response.body.indexOf('<details>')
        );
        expect(response.body.match(/<details>/g)?.length).toBeGreaterThanOrEqual(6);
        expect(response.body).not.toMatch(
          /<script|<form|<input|<details open|localStorage|sessionStorage|fetch\(/
        );
        expect(response.body).toContain('/privacy?platform=' + channel);
        expect(query).not.toHaveBeenCalled();
        expect(pool.totalCount).toBe(0);
      } finally {
        await app.close();
        await pool.end();
      }
    }
  );
  it('does not reflect arbitrary language, credential, redirect or fragment-like query values', async () => {
    const pool = new pg.Pool();
    const app = buildApp({ pool, logger: false });
    try {
      const r = await app.inject(
        '/line/help?lang=%3Cscript%3E&access_token=synthetic-private-marker&returnTo=https%3A%2F%2Fother.example.invalid'
      );
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('<html lang="zh-Hant">');
      expect(r.body).not.toContain('synthetic-private-marker');
      expect(r.body).not.toContain('other.example.invalid');
      expect(
        (await app.inject({ method: 'POST', url: '/line/help', payload: {} })).statusCode
      ).toBe(404);
    } finally {
      await app.close();
      await pool.end();
    }
  });
  it('keeps each channel’s onboarding, completion and sharing boundaries distinct', () => {
    const line = JSON.stringify(learnerHelpContent('line', 'en'));
    const telegram = JSON.stringify(learnerHelpContent('telegram', 'en'));
    const wa = JSON.stringify(learnerHelpContent('whatsapp', 'en'));
    expect(line).toContain('original invitation');
    expect(line).toContain('learner stream');
    expect(telegram).toContain('Mini App');
    expect(telegram).toContain('/remind off');
    expect(telegram).toContain('learner stream');
    expect(wa).toContain('30 days');
    expect(wa).toContain('No chat summary is sent');
    expect(wa).toContain('not automatically posted');
    expect(wa).not.toContain('/remind');
    expect(line).not.toContain('Remember me');
    for (const s of [line, telegram, wa]) {
      expect(s).toContain('before noon');
      expect(s).toContain('not automatically merged');
    }
  });
  it('offers only trusted public help links without identity material', () => {
    for (const channel of ['line', 'telegram', 'whatsapp'] as const)
      for (const locale of ['zh_TW', 'zh_CN', 'en'] as const) {
        const url = new URL(helpUrl(channel, locale));
        expect(url.origin).toBe('https://checkin.baiyinqigong.org');
        expect(url.pathname).toBe('/' + channel + '/help');
        expect(url.hash).toBe('');
        expect([...url.searchParams.keys()].every((k) => k === 'lang')).toBe(true);
      }
    const buttons = telegramFeatureButtons('en');
    expect(buttons).toHaveLength(6);
    expect(buttons.at(-1)).toMatchObject({
      webApp: false,
      url: 'https://checkin.baiyinqigong.org/telegram/help?lang=en'
    });
    expect(buttons.slice(0, 5).every((b) => !Object.hasOwn(b, 'webApp'))).toBe(true);
  });
  it.each([
    'help',
    '/help',
    '/help@demo_bot',
    '說明',
    '说明',
    '使用說明',
    '使用说明',
    '幫助',
    '帮助'
  ])('recognizes the exact help command %s', (command) => {
    expect(isHelpCommand(command)).toBe(true);
  });
  it.each([
    'join',
    'checkin',
    '/help extra',
    'workspace:help',
    '/helper',
    'help#private',
    undefined
  ])('does not reinterpret other input as help: %s', (command) => {
    expect(isHelpCommand(command)).toBe(false);
  });
});
