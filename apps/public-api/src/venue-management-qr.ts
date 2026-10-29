/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import QRCode from 'qrcode';
import { venueManagementUrls } from './venue-management.js';

export interface VenueQrImage {
  readonly target: string;
  readonly pngDataUrl: string;
  readonly filename: string;
}

/** Only canonical server-configured venue targets. Not an arbitrary URL encoder. */
export const encodeVenueQr = async (code: string, publicOrigin: string): Promise<VenueQrImage> => {
  const target = venueManagementUrls(code, publicOrigin).qr;
  if (target.length > 2048) throw new Error('venue_qr_unavailable');
  const pngDataUrl = await QRCode.toDataURL(target, {
    type: 'image/png',
    errorCorrectionLevel: 'Q',
    margin: 4,
    width: 768,
    color: { dark: '#000000ff', light: '#ffffffff' }
  });
  if (
    pngDataUrl.length > 200000 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(pngDataUrl)
  )
    throw new Error('venue_qr_unavailable');
  return { target, pngDataUrl, filename: `venue-${code}-qr.png` };
};
