import { randomUUID } from 'node:crypto';
import pg, { type PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withRequestContext } from '@qigong/database';
import type * as Database from '@qigong/database';
import {
  createTelegramReviewTransport,
  handleTelegramLearnerReview,
  learnerReviewCallback,
  learnerReviewView,
  type TelegramReviewTransport
} from '../src/telegram-learner-review.js';

const fixture = vi.hoisted(
  (): { data: Record<string, unknown>; order: string[]; query: ReturnType<typeof vi.fn> } => ({
    data: { state: 'unavailable' },
    order: [],
    query: vi.fn()
  })
);
vi.mock('@qigong/database', async (original) => ({
  ...(await original<typeof Database>()),
  withRequestContext: vi.fn(
    async (
      _pool: pg.Pool,
      _role: string,
      _context: unknown,
      callback: (client: PoolClient) => Promise<unknown>
    ) => {
      const result = await callback({ query: fixture.query } as unknown as PoolClient);
      fixture.order.push('commit');
      return result;
    }
  )
}));
const subject = 548000000059;
const botId = 59000;
const token = 'T'.repeat(43);
const botMessage = (messageId = 590) => ({
  message_id: messageId,
  date: 1900000000,
  chat: { id: subject, type: 'private' },
  from: { id: botId, is_bot: true }
});
const callback = (data = learnerReviewCallback(token, 'a')) => ({
  update_id: 1,
  callback_query: {
    id: 'callback-fixture',
    from: { id: subject, is_bot: false },
    message: botMessage(),
    data
  }
});
const reply = (text = 'Synthetic custom reason') => ({
  update_id: 2,
  message: {
    message_id: 591,
    date: Math.floor(Date.now() / 1000),
    chat: { id: subject, type: 'private' },
    from: { id: subject, is_bot: false },
    text,
    reply_to_message: botMessage(592)
  }
});
const pool = new pg.Pool();
const transport: TelegramReviewTransport = {
  send: vi.fn(async () => 592),
  edit: vi.fn(async () => {
    fixture.order.push('edit');
  }),
  answer: vi.fn(async () => {})
};
const handle = (update: unknown) =>
  handleTelegramLearnerReview(pool, randomUUID(), update, String(botId), transport);
beforeEach(() => {
  vi.clearAllMocks();
  fixture.data = { state: 'unavailable' };
  fixture.order.length = 0;
  fixture.query.mockImplementation(async () => ({ rows: [{ data: fixture.data }] }));
});
afterEach(() => vi.unstubAllGlobals());
describe('Bound private Telegram learner callbacks', () => {
  it.each([
    (v: ReturnType<typeof callback>) => {
      v.callback_query.from.id++;
    },
    (v: ReturnType<typeof callback>) => {
      v.callback_query.from.is_bot = true;
    },
    (v: ReturnType<typeof callback>) => {
      v.callback_query.message.from.id++;
    },
    (v: ReturnType<typeof callback>) => {
      v.callback_query.message.from.is_bot = false;
    },
    (v: ReturnType<typeof callback>) => {
      v.callback_query.message.chat.type = 'group';
    },
    (v: ReturnType<typeof callback>) => {
      v.callback_query.message.date = 0;
    },
    (v: ReturnType<typeof callback>) => {
      Object.assign(v.callback_query.message, { forward_origin: { type: 'user' } });
    },
    (v: ReturnType<typeof callback>) => {
      Object.assign(v.callback_query, { inline_message_id: 'inline' });
    },
    (v: ReturnType<typeof callback>) => {
      v.callback_query.data = 'lr:' + 'X'.repeat(65);
    },
    (v: ReturnType<typeof callback>) => {
      v.callback_query.data = 'lr:' + token + ':z';
    },
    (v: ReturnType<typeof callback>) => {
      v.callback_query.message.message_id = Number.MAX_SAFE_INTEGER + 1;
    }
  ])(
    'rejects spoofed/inaccessible/forwarded/malformed callback without touching SQL',
    async (mutate) => {
      const update = callback();
      mutate(update);
      expect(await handle(update)).toBe(true);
      expect(fixture.query).not.toHaveBeenCalled();
      expect(transport.edit).not.toHaveBeenCalled();
    }
  );
  it('maps opaque actions to the narrow SQL entrypoint without a principal or subject/application ID in callback data', async () => {
    fixture.data = {
      state: 'confirm_approve',
      locale: 'en',
      applicant: { name: 'Self report', platform: 'line', sourceId: 'U' + 'a'.repeat(32) }
    };
    expect(await handle(callback())).toBe(true);
    const [sql, values] = fixture.query.mock.calls[0]!;
    expect(sql).toBe('SELECT platform.telegram_learner_review_action($1,$2,$3,$4,$5) data');
    expect(values).toEqual([
      String(subject),
      590,
      token,
      'approve',
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
    ]);
    const context = vi.mocked(withRequestContext).mock.calls[0]![2];
    expect(context).not.toHaveProperty('principalId');
    expect(fixture.order).toEqual(['commit', 'edit']);
    expect(transport.edit).toHaveBeenCalledWith(
      String(subject),
      590,
      expect.stringContaining('Self-reported name'),
      expect.any(Array)
    );
  });
  it('requires explicit confirmation and offers cancel, selected reason and custom reason controls', () => {
    for (const state of ['ready', 'deny', 'input', 'confirm_approve', 'confirm_deny'] as const) {
      const view = learnerReviewView({ state, locale: 'en', reason: '<plain>' }, token);
      const buttons = view.buttons.flat();
      for (const button of buttons) {
        expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
        expect(button.callback_data).not.toContain(String(subject));
      }
      if (state.startsWith('confirm')) expect(buttons[0]!.callback_data.endsWith(':y')).toBe(true);
      if (state === 'deny')
        expect(buttons.map((b) => b.callback_data.at(-1))).toEqual(['i', 'v', 't', 'c']);
    }
  });
  it('sends only plain-text controls and scrubs errors without leaking URL/token/body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: botMessage(700) })
    );
    vi.stubGlobal('fetch', fetch);
    const sender = createTelegramReviewTransport(`${botId}:synthetic-secret`);
    expect(await sender.send(String(subject), '<b>Self-report</b>')).toBe(700);
    const raw = fetch.mock.calls[0]![1]?.body;
    if (typeof raw !== 'string') throw Error('Expected JSON');
    expect(JSON.parse(raw) as unknown).not.toHaveProperty('parse_mode');
    fetch.mockRejectedValueOnce(
      Error('https://api.telegram.org/bot-SECRET private@example.invalid')
    );
    await expect(sender.send(String(subject), 'private@example.invalid')).rejects.toThrow(
      /^Private learner review transport unavailable$/
    );
    fetch.mockResolvedValueOnce(
      Response.json({ ok: true, result: { ...botMessage(700), chat: { id: 12, type: 'private' } } })
    );
    await expect(sender.send(String(subject), 'Synthetic')).rejects.toThrow(
      'Private learner review transport unavailable'
    );
  });
  it('never retries the committed decision when editing or answering fails', async () => {
    fixture.data = { state: 'decided', locale: 'en' };
    vi.mocked(transport.edit).mockRejectedValueOnce(Error('Synthetic failure'));
    vi.mocked(transport.answer).mockRejectedValueOnce(Error('Synthetic failure'));
    expect(await handle(callback(learnerReviewCallback(token, 'y')))).toBe(true);
    expect(fixture.query).toHaveBeenCalledTimes(1);
    expect(fixture.order).toEqual(['commit']);
  });
  it('does not edit or expose a terminal result on authorization failure', async () => {
    expect(await handle(callback())).toBe(true);
    expect(transport.edit).not.toHaveBeenCalled();
    expect(transport.answer).toHaveBeenCalledWith(
      'callback-fixture',
      expect.stringContaining('unavailable')
    );
  });
});
describe('Explicit reason reply isolation', () => {
  it.each([
    '/journal',
    ' /start',
    '/checkin',
    '/admin_notify something',
    '',
    ' '.repeat(3),
    'x'.repeat(501)
  ])('never consumes command/invalid text %j as a reason', async (text) => {
    expect(await handle(reply(text))).toBe(false);
    expect(fixture.query).not.toHaveBeenCalled();
  });
  it.each([
    (v: ReturnType<typeof reply>) => {
      delete (v.message as Partial<typeof v.message>).reply_to_message;
    },
    (v: ReturnType<typeof reply>) => {
      v.message.reply_to_message.from.id++;
    },
    (v: ReturnType<typeof reply>) => {
      v.message.reply_to_message.chat.id++;
    },
    (v: ReturnType<typeof reply>) => {
      v.message.chat.type = 'group';
    },
    (v: ReturnType<typeof reply>) => {
      Object.assign(v.message, { forward_origin: {} });
    },
    (v: ReturnType<typeof reply>) => {
      Object.assign(v.message, { entities: [{ type: 'bot_command' }] });
    },
    (v: ReturnType<typeof reply>) => {
      v.message.date = 1;
    }
  ])('does not capture unrelated, forwarded or expired conversations', async (mutate) => {
    const update = reply();
    mutate(update);
    expect(await handle(update)).toBe(false);
    expect(fixture.query).not.toHaveBeenCalled();
  });
  it('records the accepted bot prompt ID, only after the custom reason state commits', async () => {
    fixture.data = { state: 'input', locale: 'en' };
    expect(await handle(callback(learnerReviewCallback(token, 't')))).toBe(true);
    expect(transport.send).toHaveBeenCalledWith(
      String(subject),
      expect.stringContaining('THIS message'),
      undefined,
      true
    );
    expect(fixture.query.mock.calls[1]).toEqual([
      'SELECT platform.telegram_learner_review_prompt($1,$2,$3,$4)',
      [String(subject), 590, expect.any(String), 592]
    ]);
    expect(fixture.order[0]).toBe('commit');
  });
  it('only updates the SQL-authorized originating application and still requires confirmation', async () => {
    fixture.data = { state: 'confirm_deny', locale: 'en', reason: '<plain>', messageId: 590 };
    expect(await handle(reply('<plain>'))).toBe(true);
    expect(fixture.query.mock.calls[0]).toEqual([
      'SELECT platform.telegram_learner_review_reason($1,$2,$3,$4) data',
      [String(subject), 592, '<plain>', expect.any(String)]
    ]);
    expect(transport.edit).toHaveBeenCalledWith(
      String(subject),
      590,
      expect.stringContaining('<plain>'),
      expect.any(Array)
    );
    fixture.data = { state: 'unavailable' };
    expect(await handle(reply())).toBe(false);
  });
});
