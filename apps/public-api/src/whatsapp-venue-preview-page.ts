/** UI review only. No registered route, login, location request or attendance write.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { venueCheckinStyles, venueGuidancePresentation } from './line-venue-checkin-page.js';
import { venueEntryCodeSchema } from './venue-entry-guidance.js';
import { whatsappVenueReceiptSchema } from './whatsapp-venue-contract.js';
import { htmlLocale, type Locale } from './ui-localization.js';

export const whatsappVenuePreviewStates = [
  'login',
  'ready',
  'locating',
  'sending',
  'success',
  'gps_error',
  'uncertain'
] as const;
export type WhatsAppVenuePreviewState = (typeof whatsappVenuePreviewStates)[number];
export interface WhatsAppVenuePreviewInput {
  readonly code: string;
  readonly locale: Locale;
  readonly availability: unknown;
  readonly state: WhatsAppVenuePreviewState;
  readonly receipt?: unknown;
}
const texts = {
  zh_TW: {
    title: '團練場打卡',
    preview: 'WhatsApp UI 預覽：示範狀態，不會登入、定位或寫入出席。',
    login: '尚未登入：請在 WhatsApp 私聊送出下方指令，取得私人登入連結。',
    remember: '這是我的裝置，記住30天（共用裝置請取消勾選）',
    ready: '示範資格已確認，按下按鈕後才會要求定位。',
    locating: '正在取得位置，尚未送出出席。',
    sending: '正在確認打卡結果，請勿重複送出。',
    success: '打卡成功',
    gps_error: '無法取得位置。請確認定位權限後再試；尚未送出出席。',
    uncertain: '打卡結果尚未確認。請查看紀錄或安全重試，勿假定未記錄。',
    invalid: '無法確認場地或打卡結果，不顯示成功。',
    button: '確認位置並打卡',
    completed: '已完成打卡',
    history: '我的團練紀錄',
    daily: '每日練功打卡',
    logout: '登出此裝置',
    privacy: '只有點擊打卡才取得當次位置；不儲存原始 GPS，不主動回傳聊天收據。'
  },
  zh_CN: {
    title: '团练场打卡',
    preview: 'WhatsApp UI 预览：示范状态，不会登录、定位或写入出席。',
    login: '尚未登录：请在 WhatsApp 私聊发送下方指令，获取私人登录链接。',
    remember: '这是我的设备，记住30天（共用设备请取消勾选）',
    ready: '示范资格已确认，按下按钮后才会请求定位。',
    locating: '正在获取位置，尚未提交出席。',
    sending: '正在确认打卡结果，请勿重复提交。',
    success: '打卡成功',
    gps_error: '无法获取位置。请确认定位权限后重试；尚未提交出席。',
    uncertain: '打卡结果尚未确认。请查看记录或安全重试，勿假定未记录。',
    invalid: '无法确认场地或打卡结果，不显示成功。',
    button: '确认位置并打卡',
    completed: '已完成打卡',
    history: '我的团练记录',
    daily: '每日练功打卡',
    logout: '退出此设备',
    privacy: '只有点击打卡才获取当次位置；不存储原始 GPS，不主动回传聊天收据。'
  },
  en: {
    title: 'Group practice check-in',
    preview: 'WhatsApp UI preview: sample states only. No login, location or attendance writes.',
    login:
      'Not signed in. Send the command below in private WhatsApp chat for a private login link.',
    remember: 'My device: remember for 30 days (uncheck on a shared device)',
    ready: 'Sample eligibility confirmed. Location is requested only after pressing check-in.',
    locating: 'Getting your location. Attendance has not been submitted.',
    sending: 'Confirming the check-in result. Do not submit again.',
    success: 'Checked in',
    gps_error:
      'Location unavailable. Check location permission and retry. Attendance not submitted.',
    uncertain:
      'Result not confirmed. Check your history or retry safely; attendance may be recorded.',
    invalid: 'Venue or receipt could not be verified. Success is not shown.',
    button: 'Confirm location and check in',
    completed: 'Check-in complete',
    history: 'My venue attendance',
    daily: 'Daily practice check-in',
    logout: 'Sign out this device',
    privacy:
      'Location is requested only on check-in. Raw GPS is not stored. No proactive chat receipt.'
  }
} as const;
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  );

/** Render sample states without loading any scripts or accepting browser credentials.
 * A shape-valid preview receipt is NOT an authentication/DB verification result. */
export const renderWhatsAppVenuePreview = (input: WhatsAppVenuePreviewInput): string => {
  const t = texts[input.locale];
  const code = venueEntryCodeSchema.safeParse(input.code);
  const view = venueGuidancePresentation(input.availability, input.code, input.locale);
  const receipt = whatsappVenueReceiptSchema.safeParse(input.receipt);
  let success = false;
  let result = '';
  if (
    code.success &&
    input.state === 'success' &&
    receipt.success &&
    receipt.data.venue.code === input.code
  ) {
    try {
      const formatter = new Intl.DateTimeFormat(htmlLocale(input.locale), {
        timeZone: receipt.data.venue.timezone,
        calendar: 'gregory',
        numberingSystem: 'latn',
        dateStyle: 'medium',
        timeStyle: 'short'
      });
      const checkedInAt = new Date(receipt.data.checkedInAt);
      result = `${t.success} — ${receipt.data.venue.name} / ${formatter.format(checkedInAt)} (${receipt.data.venue.timezone})`;
      success = true;
    } catch {
      // Malformed sample times/timezones must not produce a success stamp.
    }
  }
  const unavailable = !code.success || !view.open;
  const message = success
    ? result
    : input.state === 'success' || !code.success
      ? t.invalid
      : t[input.state];
  const calendar = view.markup.replace(/^<header class="page-header">[\s\S]*?<\/header>/, '');
  const content = unavailable
    ? ''
    : `<section class="venue-card${success ? ' wa-preview-success' : ''}"><p class="venue-help">${t.privacy}</p>${input.state === 'login' ? `<p>${t.login}</p><p><code>團練 ${escapeHtml(input.code)}</code></p><label><input type="checkbox" checked disabled> ${t.remember}</label>` : ''}${success ? `<div class="checkin-stamp" aria-hidden="true"><span>✓</span><strong>${t.success}</strong></div>` : ''}<p id="wa-venue-preview-status" role="status" aria-live="polite"${success ? ' class="schedule-open"' : ''}>${escapeHtml(message)}</p><button class="checkin-primary" type="button" disabled aria-busy="${input.state === 'locating' || input.state === 'sending'}">${success ? t.completed : t.button}</button></section>${success ? `<nav class="venue-actions"><button type="button" disabled>${t.history}</button><button type="button" disabled>${t.daily}</button></nav>` : ''}${input.state !== 'login' ? `<button class="preview-secondary" type="button" disabled>${t.logout}</button>` : ''}`;
  return `<!doctype html><html lang="${htmlLocale(input.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>WhatsApp · ${t.title}</title><style>${venueCheckinStyles}
.wa-preview-success .checkin-stamp{display:grid}.preview-secondary,.venue-actions button{background:#e5e7eb;color:#1f2937}.venue-actions button{width:auto;flex:1 1 auto}.preview-banner{font-size:14px}.channel-label{font-size:13px;padding:5px 10px;background:#f0fdf4;color:#166534;border:1px solid #86efac;border-radius:999px}
</style></head><body><main><aside class="notice preview-banner">${t.preview}</aside><header class="page-header"><h1>${t.title}</h1><span class="channel-label">WhatsApp</span></header>${code.success ? calendar : `<section class="venue-card"><p role="status">${t.invalid}</p></section>`}${content}<footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer></main></body></html>`;
};
