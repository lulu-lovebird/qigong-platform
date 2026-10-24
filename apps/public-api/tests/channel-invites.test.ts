import { Script } from 'node:vm';
import Fastify from 'fastify';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  channelInviteCommand,
  channelInviteTransportUrl,
  loadInviteTransports
} from '../src/channel-invites.js';
import { renderChannelInvitePage } from '../src/channel-invite-pages.js';
import { registerChannelInvitePages } from '../src/channel-invite-routes.js';
import { renderAdminChannelInvites } from '../src/admin-channel-invite-pages.js';

const token = 'a'.repeat(43);
describe('one URL channel invitations', () => {
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'renders the %s admin UI with a single-use default and compilable script',
    (locale) => {
      const html = renderAdminChannelInvites(locale);
      expect(html).toContain('name="maxUses" type="number" min="1" max="10000" value="1"');
      for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
        expect(() => new Script(match[1]!)).not.toThrow();
      expect(html).not.toMatch(/localStorage|sessionStorage|<script src=/);
    }
  );
  it('generates native prefilled links, never guessing phone-number IDs or accepting arbitrary targets', () => {
    expect(channelInviteTransportUrl('telegram', 'example_helper_bot', token)).toBe(
      'https://t.me/example_helper_bot?start=inv_' + token
    );
    expect(channelInviteTransportUrl('whatsapp', '999000000001', token)).toBe(
      'https://wa.me/999000000001?text=join%20inv_' + token
    );
    expect(channelInviteTransportUrl('telegram', undefined, token)).toBeNull();
    expect(channelInviteTransportUrl('whatsapp', undefined, token)).toBeNull();
    expect(channelInviteTransportUrl('telegram', 'other.example/path', token)).toBeNull();
    expect(channelInviteTransportUrl('whatsapp', 'https://other.example', token)).toBeNull();
    expect(channelInviteTransportUrl('telegram', 'example_helper_bot', 'short')).toBeNull();
    expect(loadInviteTransports({})).toEqual({});
    expect(
      loadInviteTransports({
        TELEGRAM_INVITE_BOT_USERNAME: 'example_helper_bot',
        WHATSAPP_INVITE_CHAT_NUMBER: '+999000000001'
      })
    ).toEqual({ telegram: 'example_helper_bot', whatsapp: '999000000001' });
    expect(() => loadInviteTransports({ TELEGRAM_INVITE_BOT_USERNAME: '@wrong' })).toThrow();
  });
  it.each(['telegram', 'whatsapp'] as const)(
    'parses only exact %s commands and keeps other feature commands independent',
    (platform) => {
      const command = platform === 'telegram' ? '/start' : 'join';
      expect(channelInviteCommand(platform, command + ' inv_' + token)).toEqual({
        command: true,
        token
      });
      expect(channelInviteCommand(platform, command)).toEqual({ command: true });
      expect(channelInviteCommand(platform, command + ' inv_short')).toEqual({
        command: true,
        invalid: true
      });
      for (const text of ['help', 'checkin', '/checkin', 'history', '/remind off'])
        expect(channelInviteCommand(platform, text).command).toBe(false);
      expect(channelInviteCommand(platform, command + ' inv_' + token + ' extra').invalid).toBe(
        true
      );
    }
  );
  it.each(
    (['telegram', 'whatsapp'] as const).flatMap((platform) =>
      (['zh_TW', 'zh_CN', 'en'] as const).flatMap((locale) =>
        [true, false].map((landing) => ({ platform, locale, landing }))
      )
    )
  )(
    'renders $platform/$locale/landing=$landing without a manual invitation field or script syntax errors',
    ({ platform, locale, landing }) => {
      const html = renderChannelInvitePage(
        platform,
        locale,
        landing,
        platform === 'telegram' ? 'example_helper_bot' : '999000000001'
      );
      expect(html).not.toMatch(/name="(?:invite|token|subject|region)"/);
      expect(html).not.toMatch(
        /localStorage|sessionStorage|<script src=|<input[^>]*\schecked(?:\s|=|>)|\.checked\s*=\s*true/
      );
      expect(html).toContain('location.hash.slice(1)');
      expect(html).toContain('history.replaceState');
      expect(html).toContain('const platform=' + JSON.stringify(platform));
      for (const code of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
        expect(() => new Script(code[1]!)).not.toThrow();
      expect(html).toContain('name="name"');
      expect(html).toContain('name="email"');
      expect(html).toContain('name="phone"');
      if (platform === 'whatsapp')
        expect(html).toContain('id="notification" type="checkbox" required');
    }
  );
  it('does not allow malformed configured account names to inject markup', () => {
    const html = renderChannelInvitePage(
      'telegram',
      'en',
      true,
      '</script><script>syntheticInjection()</script>'
    );
    expect(html).not.toContain('syntheticInjection');
  });
  it('serves public landing/form pages with no database and rejects cross-origin or malformed submissions before queries', async () => {
    const pool = new pg.Pool(),
      query = vi.spyOn(pool, 'query').mockRejectedValue(Error('No database for public pages')),
      app = Fastify({ logger: false });
    registerChannelInvitePages(app, pool, 'telegram', 'synthetic-secret', 'example_helper_bot');
    registerChannelInvitePages(app, pool, 'whatsapp', 'synthetic-secret', '999000000001');
    try {
      for (const platform of ['telegram', 'whatsapp'])
        for (const kind of ['join', 'invite']) {
          const r = await app.inject(
            '/' +
              platform +
              '/' +
              kind +
              '?lang=en&token=synthetic-url-marker&returnTo=https://other.invalid'
          );
          expect(r.statusCode).toBe(200);
          expect(r.headers['cache-control']).toBe('no-store');
          expect(r.headers['referrer-policy']).toBe('no-referrer');
          expect(r.headers['x-content-type-options']).toBe('nosniff');
          expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
          expect(r.body).not.toContain('synthetic-url-marker');
          expect(r.body).not.toContain('other.invalid');
        }
      for (const platform of ['telegram', 'whatsapp'])
        for (const action of ['status', 'redeem']) {
          const url = '/' + platform + '/invite/' + action;
          expect(
            (await app.inject({ method: 'POST', url, payload: { token, locale: 'en' } })).statusCode
          ).toBe(403);
          expect(
            (
              await app.inject({
                method: 'POST',
                url,
                headers: { origin: 'https://checkin.baiyinqigong.org' },
                payload: { token, locale: 'en', subject: 'spoofed' }
              })
            ).statusCode
          ).toBe(400);
        }
      expect(query).not.toHaveBeenCalled();
      expect(pool.totalCount).toBe(0);
    } finally {
      await app.close();
      await pool.end();
    }
  });
});
