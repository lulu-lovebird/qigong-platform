/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import QRCode from 'qrcode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeVenueQr } from '../src/venue-management-qr.js';

const origin = 'https://synthetic.example';
afterEach(() => vi.restoreAllMocks());
describe('bounded canonical venue PNG encoder', () => {
  it('encodes the exact trusted target with high contrast, Q correction and four quiet modules', async () => {
    const spy = vi.spyOn(QRCode, 'toDataURL');
    const image = await encodeVenueQr('tw-synthetic-park', origin);
    expect(image.target).toBe(origin + '/venue-checkin?venue=tw-synthetic-park&source=qr');
    expect(image.filename).toBe('venue-tw-synthetic-park-qr.png');
    expect(spy).toHaveBeenCalledWith(image.target, {
      type: 'image/png',
      errorCorrectionLevel: 'Q',
      margin: 4,
      width: 768,
      color: { dark: '#000000ff', light: '#ffffffff' }
    });
    const png = Buffer.from(image.pngDataUrl.slice('data:image/png;base64,'.length), 'base64');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.subarray(12, 16).toString()).toBe('IHDR');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([768, 768]);
    expect(image.pngDataUrl.length).toBeLessThan(200000);
  });
  it.each([
    'http://synthetic.example',
    'https://u:p@synthetic.example',
    origin + '/',
    origin + '/path',
    origin + '?url=evil',
    'not a URL'
  ])('rejects malformed origin %s before encoding', async (value) => {
    const spy = vi.spyOn(QRCode, 'toDataURL');
    await expect(encodeVenueQr('tw-synthetic-park', value)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
  it.each(['https://evil.example', 'bad_code', '../qr', 'tw-synthetic?url=evil'])(
    'rejects URL and raw claims as code %s',
    async (code) => {
      const spy = vi.spyOn(QRCode, 'toDataURL');
      await expect(encodeVenueQr(code, origin)).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    }
  );
  it.each(['data:image/svg+xml;base64,AAAA', 'data:image/png;base64,' + 'A'.repeat(200000)])(
    'refuses unexpected encoder output',
    async (output) => {
      // Select the promise overload; qrcode also exposes callback overloads.
      const pngEncoder: {
        toDataURL(text: string, options?: QRCode.QRCodeToDataURLOptions): Promise<string>;
      } = QRCode;
      vi.spyOn(pngEncoder, 'toDataURL').mockResolvedValue(output);
      await expect(encodeVenueQr('tw-synthetic-park', origin)).rejects.toThrow(
        'venue_qr_unavailable'
      );
    }
  );
});
