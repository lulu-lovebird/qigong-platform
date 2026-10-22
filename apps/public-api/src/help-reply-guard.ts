import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// Short-lived, process-local help-reply suppression only. No learner data, consent or eligibility.
// This is not a durable outbox or an exactly-once guarantee across restart/provider timeouts.
export const createHelpReplyGuard = (
  options: { now?: () => number; capacity?: number; ttlMs?: number } = {}
) => {
  const now = options.now ?? (() => performance.now());
  const capacity = options.capacity ?? 5000;
  const ttl = options.ttlMs ?? 15 * 60 * 1000;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isFinite(ttl) || ttl <= 0)
    throw Error('Invalid help reply limits');
  interface Entry {
    fingerprint: string;
    expiresAt: number;
    pending?: Promise<void>;
  }
  const entries = new Map<string, Entry>();
  const hash = (parts: readonly string[]) =>
    createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  return async (
    eventId: string,
    subject: string,
    command: string,
    send: () => Promise<void>
  ): Promise<void> => {
    for (const [key, entry] of entries)
      if (!entry.pending && entry.expiresAt <= now()) entries.delete(key);
    const key = hash([eventId]),
      fingerprint = hash([subject, command]);
    const existing = entries.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw Error('Help reply conflict');
      if (existing.pending) await existing.pending;
      return;
    }
    if (entries.size >= capacity) throw Error('Help reply capacity');
    const entry: Entry = { fingerprint, expiresAt: now() + ttl };
    const task = Promise.resolve().then(send);
    entry.pending = task;
    entries.set(key, entry);
    try {
      await task;
      delete entry.pending;
      entry.expiresAt = now() + ttl;
    } catch (error) {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    }
  };
};
