import { describe, expect, it, vi } from 'vitest';
import { createHelpReplyGuard } from '../src/help-reply-guard.js';

describe('bounded process-local public help reply guard', () => {
  it('deduplicates concurrent and completed copies without claiming durable exactly-once', async () => {
    const guard = createHelpReplyGuard();
    const send = vi.fn(async () => {});
    await Promise.all([
      guard('event', 'subject', 'help', send),
      guard('event', 'subject', 'help', send)
    ]);
    await guard('event', 'subject', 'help', send);
    expect(send).toHaveBeenCalledTimes(1);
    await createHelpReplyGuard()('event', 'subject', 'help', send);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('rejects an event reused for a different subject or command', async () => {
    const guard = createHelpReplyGuard();
    const send = vi.fn(async () => {});
    await guard('event', 'subject', 'help', send);
    await expect(guard('event', 'other', 'help', send)).rejects.toThrow('Help reply conflict');
    await expect(guard('event', 'subject', '說明', send)).rejects.toThrow('Help reply conflict');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('removes a failed attempt so a genuine provider retry can run', async () => {
    const guard = createHelpReplyGuard();
    const send = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(Error('Synthetic send failure'))
      .mockResolvedValue(undefined);
    await expect(guard('event', 'subject', 'help', send)).rejects.toThrow('Synthetic send failure');
    await guard('event', 'subject', 'help', send);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('enforces bounded capacity, expires completed entries and never evicts pending sends', async () => {
    let now = 0;
    const guard = createHelpReplyGuard({ now: () => now, capacity: 1, ttlMs: 10 });
    let release: (() => void) | undefined;
    const pending = guard(
      'event',
      'subject',
      'help',
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await Promise.resolve();
    now = 100;
    await expect(guard('new', 'subject', 'help', async () => {})).rejects.toThrow(
      'Help reply capacity'
    );
    if (!release) throw Error('Missing provider completion');
    release();
    await pending;
    await expect(guard('new', 'subject', 'help', async () => {})).rejects.toThrow(
      'Help reply capacity'
    );
    now += 11;
    await expect(guard('new', 'subject', 'help', async () => {})).resolves.toBeUndefined();
  });
  it('rejects invalid limits rather than disabling the bounds', () => {
    expect(() => createHelpReplyGuard({ capacity: 0 })).toThrow();
    expect(() => createHelpReplyGuard({ capacity: 1.5 })).toThrow();
    expect(() => createHelpReplyGuard({ ttlMs: 0 })).toThrow();
  });
});
