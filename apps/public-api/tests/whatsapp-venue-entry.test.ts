import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerVenueEntry } from '../src/venue-entry.js';
import type { VenueEntryAvailabilityResult } from '../src/venue-entry-guidance.js';
const code = 'my-demo-hall';
const result: VenueEntryAvailabilityResult = {
  status: 200,
  body: {
    version: 1,
    availability: 'open',
    venue: { code, name: 'Synthetic venue', timezone: 'Asia/Kuala_Lumpur' },
    observedAt: '2026-11-16T00:10:00Z',
    relevantSession: {
      opensAt: '2026-11-15T23:30:00Z',
      startsAt: '2026-11-16T00:00:00Z',
      endsAt: '2026-11-16T01:00:00Z'
    },
    nextSession: null
  }
};
const path = '/venue-checkin?venue=' + code + '&source=nfc&lang=en';
describe('explicit NFC channel dispatch, no identity or presence authority', () => {
  it('directly dispatches WhatsApp only when server-enabled, preserving public metadata', async () => {
    const app = Fastify();
    const lookup = vi.fn(async () => result);
    registerVenueEntry(app, 'mock-liff', undefined, lookup, true);
    try {
      const r = await app.inject(path + '&channel=whatsapp');
      expect(r.statusCode).toBe(303);
      expect(r.headers.location).toBe(
        '/whatsapp/venue-checkin?venue=my-demo-hall&source=nfc&lang=en'
      );
      expect(r.headers.location).not.toContain('#');
    } finally {
      await app.close();
    }
  });
  it('keeps explicit LINE dispatch unchanged with both channels enabled', async () => {
    const app = Fastify();
    registerVenueEntry(app, 'mock-liff', undefined, async () => result, true);
    try {
      const r = await app.inject(path + '&channel=line');
      expect(r.statusCode).toBe(303);
      expect(r.headers.location).toBe(
        'https://liff.line.me/mock-liff/venue-checkin?venue=my-demo-hall&source=nfc&lang=en'
      );
    } finally {
      await app.close();
    }
  });
  it('keeps WhatsApp rejected by the parser while disabled', async () => {
    const app = Fastify();
    const lookup = vi.fn(async () => result);
    registerVenueEntry(app, 'mock-liff', undefined, lookup, false);
    try {
      expect((await app.inject(path + '&channel=whatsapp')).statusCode).toBe(400);
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it.each([
    'redirect=https://evil.example',
    'token=secret',
    'channel=telegram',
    'channel=whatsapp&channel=line'
  ])('rejects untrusted dispatch parameters %s', async (extra) => {
    const app = Fastify();
    registerVenueEntry(app, 'mock-liff', undefined, async () => result, true);
    try {
      const r = await app.inject(path + '&' + extra);
      expect(r.statusCode).toBe(400);
      expect(r.headers.location).toBeUndefined();
      expect(r.body).not.toContain('evil.example');
    } finally {
      await app.close();
    }
  });
  it('keeps a closed venue read-only instead of launching either channel', async () => {
    const app = Fastify();
    const closed: VenueEntryAvailabilityResult = {
      status: 200,
      body: {
        ...result.body,
        version: 1,
        availability: 'before_open',
        venue: { code, name: 'Synthetic venue', timezone: 'Asia/Kuala_Lumpur' },
        observedAt: '2026-11-15T23:00:00Z',
        relevantSession: {
          opensAt: '2026-11-15T23:30:00Z',
          startsAt: '2026-11-16T00:00:00Z',
          endsAt: '2026-11-16T01:00:00Z'
        },
        nextSession: null
      }
    };
    registerVenueEntry(app, 'mock-liff', undefined, async () => closed, true);
    try {
      const r = await app.inject(path + '&channel=whatsapp');
      expect(r.statusCode).toBe(200);
      expect(r.headers.location).toBeUndefined();
      expect(r.body).toContain('schedule-warning');
      expect(r.body).not.toContain('<script');
      expect(r.body).not.toContain('/whatsapp/venue-checkin?');
    } finally {
      await app.close();
    }
  });
});
