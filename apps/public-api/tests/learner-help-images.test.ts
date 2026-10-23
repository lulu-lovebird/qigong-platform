import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  lineHelpImages,
  lineHelpImagePath,
  lineHelpImageText,
  lineHelpImageLabels,
  registerLearnerHelpImages
} from '../src/learner-help-images.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<{ readFile: typeof readFile }>();
  return { ...original, readFile: vi.fn(original.readFile) };
});

const server = () => {
  const app = fastify({ logger: false });
  registerLearnerHelpImages(app);
  return app;
};

describe('consented LINE Help screenshot whitelist', () => {
  it.each(lineHelpImages)('serves only the pinned cropped pixels for $file', async (image) => {
    const app = server();
    try {
      const r = await app.inject(lineHelpImagePath(image));
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('image/png');
      expect(r.headers['cache-control']).toBe('public, max-age=3600');
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(r.headers['content-security-policy']).toContain("default-src 'none'");
      expect(r.headers['set-cookie']).toBeUndefined();
      const source = readFileSync(
        new URL('../../../assets/learner-help/line/' + image.file, import.meta.url)
      );
      expect(r.rawPayload.equals(source)).toBe(true);
      expect(createHash('sha256').update(source).digest('hex')).toBe(image.sha256);
      expect([...source.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const chunks: string[] = [];
      const data: Buffer[] = [];
      let offset = 8;
      while (offset < source.length) {
        const size = source.readUInt32BE(offset);
        const kind = source.toString('ascii', offset + 4, offset + 8);
        chunks.push(kind);
        if (kind === 'IDAT') data.push(source.subarray(offset + 8, offset + 8 + size));
        offset += size + 12;
      }
      expect(offset).toBe(source.length);
      expect(chunks).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND']);
      expect(source.readUInt32BE(16)).toBe(image.width);
      expect(source.readUInt32BE(20)).toBe(image.height);
      expect(inflateSync(Buffer.concat(data)).length).toBe((image.width * 3 + 1) * image.height);
    } finally {
      await app.close();
    }
  });

  it('has exactly seven unique image identities and section placement', () => {
    expect(lineHelpImages).toHaveLength(7);
    expect(new Set(lineHelpImages.map(lineHelpImagePath)).size).toBe(7);
    expect(lineHelpImages.map((image) => image.section)).toEqual([
      'start',
      'daily',
      'daily',
      'daily',
      'daily',
      'achievements',
      'history'
    ]);
    expect(lineHelpImages.every((image) => /^[a-f0-9]{64}$/.test(image.sha256))).toBe(true);
  });

  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'provides source-owned captions and honest screenshot labels for %s',
    (locale) => {
      for (const image of lineHelpImages) {
        expect(lineHelpImageText(image, locale).title.length).toBeGreaterThan(3);
        expect(lineHelpImageText(image, locale).caption.length).toBeGreaterThan(12);
      }
      const labels = lineHelpImageLabels(locale);
      expect(labels.notice).toContain(
        locale === 'en' ? 'Traditional Chinese' : locale === 'zh_CN' ? '繁体中文' : '繁體中文'
      );
      expect(labels.notice).toContain(
        locale === 'en'
          ? 'not your live data'
          : locale === 'zh_CN'
            ? '不是你的即时资料'
            : '不是你的即時資料'
      );
    }
  );

  it('refuses names, wrong hashes, alternate channels, source paths and write methods without file reads', async () => {
    const app = server();
    try {
      vi.mocked(readFile).mockClear();
      for (const url of [
        '/line/help/images/line-01-menu.png',
        '/line/help/images/' + '0'.repeat(64) + '/line-01-menu.png',
        '/line/help/images/' + lineHelpImages[0].sha256 + '/../../../../etc/passwd',
        '/line/help/images/' + lineHelpImages[0].sha256 + '/%2e%2e%2fapi.env',
        '/line/help/images/' + lineHelpImages[0].sha256 + '/__proto__',
        '/telegram/help/images/' + lineHelpImages[0].sha256 + '/' + lineHelpImages[0].file,
        '/whatsapp/help/images/' + lineHelpImages[0].sha256 + '/' + lineHelpImages[0].file,
        '/assets/learner-help/line/line-01-menu.PNG'
      ])
        expect((await app.inject(url)).statusCode).toBe(404);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: lineHelpImagePath(lineHelpImages[0]),
            payload: {}
          })
        ).statusCode
      ).toBe(404);
      expect(readFile).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('ignores credential/redirect queries and supports a bodyless HEAD', async () => {
    const app = server();
    try {
      const url = lineHelpImagePath(lineHelpImages[4]);
      const r = await app.inject(
        url + '?access_token=synthetic-private-marker&returnTo=https://example.invalid'
      );
      expect(r.statusCode).toBe(200);
      expect(createHash('sha256').update(r.rawPayload).digest('hex')).toBe(
        lineHelpImages[4].sha256
      );
      expect(r.headers.location).toBeUndefined();
      const head = await app.inject({ method: 'HEAD', url });
      expect(head.statusCode).toBe(200);
      expect(head.rawPayload.length).toBe(0);
    } finally {
      await app.close();
    }
  });

  it.each(['missing', 'modified'] as const)(
    'fails closed with a sanitized response for a %s asset',
    async (mode) => {
      const app = server();
      try {
        if (mode === 'missing')
          vi.mocked(readFile).mockRejectedValueOnce(Error('synthetic-private-file-path'));
        else
          vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('synthetic-private-file-content'));
        const r = await app.inject(lineHelpImagePath(lineHelpImages[0]));
        expect(r.statusCode).toBe(503);
        expect(r.headers['cache-control']).toBe('no-store');
        expect(r.json()).toEqual({ error: 'help_image_unavailable' });
        expect(r.body).not.toContain('synthetic-private');
      } finally {
        await app.close();
      }
    }
  );
});
