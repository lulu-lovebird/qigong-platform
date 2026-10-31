import { z } from 'zod';
import { lineLoginScript } from './application-page.js';
import {
  venueEntryAvailabilitySchema,
  venueEntryCodeSchema,
  venueEntrySessionSchema,
  type VenueEntryAvailabilityResult,
  type VenueEntrySession
} from './venue-entry-guidance.js';
import type { VenueDebugVenueCode } from './venue-debug.js';
import {
  htmlLocale,
  isLocale,
  languageOptions,
  resolveLocale,
  type Locale
} from './ui-localization.js';

export interface VenuePreviewEntry {
  venue: string;
  source?: 'nfc' | 'qr' | 'link';
  lang: Locale;
  explicitLang?: boolean;
}
type PreviewRequest =
  { kind: 'none' } | { kind: 'invalid' } | { kind: 'preview'; entry: VenuePreviewEntry };
const path = '/line/venue-checkin';
const callbackKeys = new Set([
  '_line_login_attempt',
  'code',
  'state',
  'error',
  'error_description',
  'liffClientId',
  'liffRedirectUri'
]);
const applicationKeys = new Set(['venue', 'source', 'lang']);
const uniqueAllowed = (query: URLSearchParams, allowed: ReadonlySet<string>) =>
  [...query.keys()].every((key) => allowed.has(key) && query.getAll(key).length === 1);

// Never redirect to liff.state on the server. Only select this renderer for the exact
// appended LIFF path; the official SDK still owns primary -> secondary navigation.
export const venuePreviewRequest = (rawUrl: string, cookie?: string): PreviewRequest => {
  const url = new URL(rawUrl, 'https://preview.invalid');
  const direct = url.pathname === path;
  const states = url.searchParams.getAll('liff.state');
  const candidate = states.find((state) => /^\/venue-checkin(?:[?/#]|$)/.test(state));
  if (!direct && !candidate) return { kind: 'none' };
  if (rawUrl.length > 8192) return { kind: 'invalid' };
  let query = url.searchParams;
  if (states.length) {
    if (
      states.length !== 1 ||
      !candidate ||
      candidate.length > 512 ||
      !uniqueAllowed(query, new Set(['liff.state', ...callbackKeys])) ||
      !/^\/venue-checkin(?:\?[^#]*)?$/.test(candidate)
    )
      return { kind: 'invalid' };
    query = new URL(candidate, 'https://preview.invalid').searchParams;
    if (!uniqueAllowed(query, applicationKeys)) return { kind: 'invalid' };
  } else if (!uniqueAllowed(query, new Set([...applicationKeys, ...callbackKeys]))) {
    return { kind: 'invalid' };
  }
  const venue = query.get('venue');
  const source = query.get('source');
  const lang = query.get('lang');
  if (
    !venue ||
    venue.length > 64 ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(venue) ||
    (source !== null && source !== 'nfc' && source !== 'qr' && source !== 'link') ||
    (lang !== null && !isLocale(lang))
  )
    return { kind: 'invalid' };
  return {
    kind: 'preview',
    entry: {
      venue,
      ...(source === null ? {} : { source }),
      lang: resolveLocale({ lang }, cookie),
      explicitLang: lang !== null
    }
  };
};
export const venuePreviewUrl = (entry: VenuePreviewEntry): string => {
  const query = new URLSearchParams({ venue: entry.venue });
  if (entry.source) query.set('source', entry.source);
  if (entry.explicitLang !== false) query.set('lang', entry.lang);
  return path + '?' + query.toString();
};
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char
  );
const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
const texts = {
  zh_TW: {
    title: '團練入口預覽',
    notice: '測試預覽，尚未記錄出席',
    venue: '場地代碼',
    unknown: '尚無可信場地資料，無法確認場地名稱、時段或是否在場。',
    privacy:
      '只有按下按鈕才會請求定位。原始位置僅當次處理，不儲存、不傳送。靜態 NFC／QR／連結可轉傳，來源標記僅供分析，並非防偽或出席證明。',
    button: '確認位置並測試',
    locatingButton: '定位中…',
    sendingButton: '送出中…',
    completedButton: '定位測試完成',
    ready: 'LINE 初始化完成，可開始定位測試；這不是學員資格或場地驗證。',
    loading: '正在初始化 LINE，請稍候。',
    loginError:
      'LINE 登入未完成或初始化失敗。請重新開啟原 LIFF 連結；若仍失敗，請回 LINE 聊天重試。尚未記錄出席。',
    locating: '正在取得定位，請稍候。',
    located: '定位已取得，但未經後端場地驗證。這只是測試，尚未記錄出席。',
    denied: '您未允許定位。請在裝置設定允許後再試；尚未記錄出席。',
    timeout: '定位逾時，請稍後再試；尚未記錄出席。',
    unavailable: '目前無法取得定位，請確認裝置設定後再試；尚未記錄出席。',
    unsupported: '此瀏覽器不支援定位，請換用支援定位的瀏覽器；尚未記錄出席。',
    daily: '記錄今天功法與感受',
    history: '查看我的團練紀錄',
    language: '介面語言',
    languageFailed: '語言偏好未儲存。請稍後重新選擇語言重試。',
    invalid: '入口參數無效或缺少場地代碼。請重新取得正確連結；尚未記錄出席。'
  },
  zh_CN: {
    title: '团练入口预览',
    notice: '测试预览，尚未记录出席',
    venue: '场地代码',
    unknown: '尚无可信场地资料，无法确认场地名称、时段或是否在场。',
    privacy:
      '只有按下按钮才会请求定位。原始位置仅当次处理，不储存、不传送。静态 NFC／QR／链接可转发，来源标记仅供分析，并非防伪或出席证明。',
    button: '确认位置并测试',
    locatingButton: '定位中…',
    sendingButton: '提交中…',
    completedButton: '定位测试完成',
    ready: 'LINE 初始化完成，可开始定位测试；这不是学员资格或场地验证。',
    loading: '正在初始化 LINE，请稍候。',
    loginError:
      'LINE 登录未完成或初始化失败。请重新打开原 LIFF 链接；若仍失败，请回 LINE 聊天重试。尚未记录出席。',
    locating: '正在取得定位，请稍候。',
    located: '定位已取得，但未经后端场地验证。这只是测试，尚未记录出席。',
    denied: '您未允许定位。请在设备设置允许后再试；尚未记录出席。',
    timeout: '定位超时，请稍后再试；尚未记录出席。',
    unavailable: '目前无法取得定位，请确认设备设置后再试；尚未记录出席。',
    unsupported: '此浏览器不支持定位，请换用支持定位的浏览器；尚未记录出席。',
    daily: '记录今天功法与感受',
    history: '查看我的团练记录',
    language: '界面语言',
    languageFailed: '语言偏好未保存。请稍后重新选择语言重试。',
    invalid: '入口参数无效或缺少场地代码。请重新取得正确链接；尚未记录出席。'
  },
  en: {
    title: 'Group practice entry preview',
    notice: 'Test preview — attendance has NOT been recorded',
    venue: 'Venue code',
    unknown:
      'No trusted venue lookup is available. Venue name, schedule and presence are unverified.',
    privacy:
      'Location is requested only when you press the button. Raw location is handled only for this attempt, never stored or sent. Static NFC/QR/links can be forwarded; source is an analytics label, not proof of authenticity or attendance.',
    button: 'Check location and test',
    locatingButton: 'Locating…',
    sendingButton: 'Submitting…',
    completedButton: 'Location test complete',
    ready:
      'LINE initialization completed. You can test location; learner eligibility and venue are not verified.',
    loading: 'Initializing LINE. Please wait.',
    loginError:
      'LINE login or initialization failed. Reopen the original LIFF link or return to LINE chat to retry. Attendance has NOT been recorded.',
    locating: 'Getting location. Please wait.',
    located:
      'Location acquired, but NOT verified against a venue by the backend. Test only — attendance has NOT been recorded.',
    denied:
      'Location permission denied. Allow location in device settings and retry. Attendance has NOT been recorded.',
    timeout: 'Location timed out. Please retry. Attendance has NOT been recorded.',
    unavailable:
      'Location unavailable. Check device settings and retry. Attendance has NOT been recorded.',
    unsupported:
      'This browser does not support location. Use a supported browser. Attendance has NOT been recorded.',
    daily: 'Record today’s practice and reflections',
    history: 'View my group practice history',
    language: 'Language',
    languageFailed: 'Language preference was not saved. Select the language again to retry.',
    invalid:
      'Invalid entry parameters or missing venue code. Obtain a valid link. Attendance has NOT been recorded.'
  }
} as const;

const checkinTexts = {
  zh_TW: {
    title: '團練場簽到',
    notice: '正式出席簽到：送出後由後端驗證並記錄',
    unknown:
      '團練開始前30分鐘開放打卡，結束即停止。團練時段由管理員提供；打卡時段依場地時區計算，午夜附近的團練可能前一天開放。請在定位半徑內簽到。簽到獨立於日課，同人同場以實際打卡當下的場地當地日期一次，跨場正常累計。',
    privacy:
      '按下按鈕才取得並傳送本次位置供後端驗證；不保存原始 GPS、不寫入網址或紀錄。QR 可轉傳，GPS 不是防偽證明。',
    button: '確認位置並簽到',
    completedButton: '已簽到',
    ready: 'LINE 初始化完成；後端仍會驗證身份、同意、場地與位置。',
    sending: '正在驗證並記錄出席，請稍候。',
    success: '出席已記錄',
    retry: '無法確認結果，可能已記錄。請重試；同人同場同日不會重複計次。',
    outside_radius: '位置不在場地半徑內，請在現場重試。',
    outside_window: '目前不在可打卡時段：團練開始前30分鐘開放，結束即停止（依場地時區）。',
    rejected: '簽到未完成。請確認學員資格及最新隱私同意，或回 LINE 聊天辦理。'
  },
  zh_CN: {
    title: '团练场签到',
    notice: '正式出席签到：提交后由后端验证并记录',
    unknown:
      '团练开始前30分钟开放打卡，结束即停止。团练时段由管理员提供；打卡时段依场地时区计算，午夜附近的团练可能前一天开放。请在定位半径内签到。签到独立于日课，同人同场以实际打卡当下的场地当地日期一次，跨场正常累计。',
    privacy:
      '按下按钮才获取并传送本次位置供后端验证；不保存原始 GPS、不写入网址或日志。QR 可转发，GPS 不是防伪证明。',
    button: '确认位置并签到',
    completedButton: '已签到',
    ready: 'LINE 初始化完成；后端仍会验证身份、同意、场地与位置。',
    sending: '正在验证并记录出席，请稍候。',
    success: '出席已记录',
    retry: '无法确认结果，可能已记录。请重试；同人同场同日不会重复计次。',
    outside_radius: '位置不在场地半径内，请在现场重试。',
    outside_window: '目前不在可打卡时段：团练开始前30分钟开放，结束即停止（依场地时区）。',
    rejected: '签到未完成。请确认学员资格及最新隐私同意，或回 LINE 聊天办理。'
  },
  en: {
    title: 'Venue attendance',
    notice: 'Live check-in: the server verifies and records attendance',
    unknown:
      'Check-in opens 30 minutes before group practice starts and stops when it ends, in the venue’s timezone. Ask the administrator for the practice schedule; check-in for a practice near midnight may open the previous day. Check in within the venue radius. Attendance is separate from daily practice: once per person, venue and actual local check-in date; visits to other venues count normally.',
    privacy:
      'Pressing the button sends this attempt’s location for server validation. Raw GPS is not stored, logged or put in URLs. QR links can be forwarded; GPS is not proof against impersonation.',
    button: 'Confirm location and check in',
    completedButton: 'Checked in',
    ready: 'LINE initialized. The server still checks identity, consent, venue and location.',
    sending: 'Verifying and recording attendance. Please wait.',
    success: 'Attendance recorded',
    retry:
      'Result unknown; attendance may already be recorded. Retry safely: the same venue and local date will not count twice.',
    outside_radius: 'Outside the venue radius. Retry on site.',
    outside_window:
      'Outside the check-in window: opens 30 minutes before practice starts and stops when it ends (venue timezone).',
    rejected:
      'Check-in was not completed. Confirm learner eligibility and current privacy consent, or return to LINE chat.'
  }
} as const;

const debugTexts = {
  zh_TW: {
    label: '異地測試，未計入正式出席',
    testOnly: '僅供測試，不計正式出席',
    completedButton: '測試已完成',
    unavailableButton: '測試未開放',
    unavailable: '測試簽到尚未開放；此場地必須使用短效測試碼，不能進行普通簽到。',
    help: '僅豁免距離；仍需真實 GPS、身份、同意與可打卡時段。測試碼限人工輸入，僅當次記憶體使用，不放入網址或儲存。',
    optIn: '使用異地測試',
    token: '短效測試碼',
    denied: '測試碼無效、已到期或測試未開啟；未完成簽到。'
  },
  zh_CN: {
    label: '异地测试，未计入正式出席',
    testOnly: '仅供测试，不计正式出席',
    completedButton: '测试已完成',
    unavailableButton: '测试未开放',
    unavailable: '测试签到尚未开放；此场地必须使用短效测试码，不能进行普通签到。',
    help: '仅豁免距离；仍需真实 GPS、身份、同意与可打卡时段。测试码限人工输入，仅当次内存使用，不放入网址或存储。',
    optIn: '使用异地测试',
    token: '短效测试码',
    denied: '测试码无效、已到期或测试未开启；未完成签到。'
  },
  en: {
    label: 'Distance test, excluded from formal attendance',
    testOnly: 'Testing only; excluded from formal attendance',
    completedButton: 'Test complete',
    unavailableButton: 'Testing unavailable',
    unavailable:
      'Test check-in is not open. This venue requires a short-lived test code; standard check-in is unavailable.',
    help: 'Only distance is waived. Real GPS, identity, consent and the check-in window are still required. Enter the code manually; it stays in request memory only, never in URLs or storage.',
    optIn: 'Use distance test',
    token: 'Short-lived test code',
    denied: 'The test code is invalid, expired or testing is disabled. No check-in was completed.'
  }
} as const;

/** Opt-in server context. Route selection is not identity or attendance authority.
 * B2 must supply isPrimaryBootstrap only after validating the exact primary route. */
export interface VenuePreviewGuidance {
  readonly result: VenueEntryAvailabilityResult;
  readonly isPrimaryBootstrap?: boolean;
}
const guidanceResultSchema = z.union([
  z.strictObject({
    status: z.union([z.literal(200), z.literal(404), z.literal(410)]),
    body: venueEntryAvailabilitySchema
  }),
  z.strictObject({
    status: z.literal(400),
    body: z.strictObject({ error: z.literal('invalid_venue_entry_request') })
  }),
  z.strictObject({
    status: z.literal(503),
    body: z.strictObject({ error: z.literal('venue_entry_unavailable') })
  })
]);
/** Malformed adapters, inconsistent statuses and cross-venue DTOs never fall back. */
export const validateVenueGuidanceResult = (
  result: unknown,
  code: string
): VenueEntryAvailabilityResult => {
  const parsed = guidanceResultSchema.safeParse(result);
  if (parsed.success && parsed.data.status !== 400) {
    const value = parsed.data;
    if (value.status === 503) return value;
    const expected =
      value.body.availability === 'not_found'
        ? 404
        : value.body.availability === 'disabled'
          ? 410
          : value.body.availability === 'unavailable'
            ? 503
            : 200;
    if (
      value.status === expected &&
      (!value.body.venue || value.body.venue.code === code) &&
      // Canonical disabled/missing results remain truthful; this sentinel is never formal-open.
      !(code === 'tw-location-test' && value.body.availability === 'open')
    )
      return value;
  }
  return { status: 503, body: { error: 'venue_entry_unavailable' } };
};
/** Full venue-local dates, including previous-day opening / next-day ending.
 * Never use the phone timezone or a local clock to decide availability. */
export const formatVenueEntrySession = (
  session: VenueEntrySession,
  timezone: string,
  locale: Locale
): { startsAt: string; endsAt: string; opensAt: string } | null => {
  try {
    const parsed = venueEntrySessionSchema.parse(session);
    const formatter = new Intl.DateTimeFormat(htmlLocale(locale), {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    return {
      startsAt: formatter.format(new Date(parsed.startsAt)),
      endsAt: formatter.format(new Date(parsed.endsAt)),
      opensAt: formatter.format(new Date(parsed.opensAt))
    };
  } catch {
    return null;
  }
};
const guidanceTexts = {
  zh_TW: {
    title: '團練場入口',
    open: '目前開放簽到',
    before_open: '尚未開放簽到',
    ended: '本次團練已結束',
    not_activity_day: '今天不是此場地的團練日',
    disabled: '場地已停用',
    not_found: '場地不存在',
    unavailable: '場地查詢暫不可用，請稍後再試。',
    start: '團練開始',
    end: '團練結束',
    opens: '開放簽到',
    next: '下一次團練',
    unknownNext: '下次時段尚無資料',
    source: '請優先輕觸現場 NFC 標籤；無法感應時掃描 QR。連結及來源標記不是身份、在場或邀請證明。',
    login: '登入 LINE',
    retry: '重新驗證',
    loading: '正在確認資格，尚未記錄出席。',
    error: '無法確認資格，請重新驗證；這不表示需要重新申請。',
    needs_application:
      '請回 LINE 私聊手動輸入「加入」，填寫私人表單，等待人工核准後再輕觸 NFC 或掃描 QR。',
    pending: '申請審核中，請等待人工核准後再輕觸或掃描；不要重複申請。',
    blocked: '目前無法簽到，請聯絡管理員；不要重複申請。',
    required: '請回 LINE 私聊手動輸入「隱私」，完成既有同意流程後再輕觸或掃描。',
    chat: '開啟 LINE 私聊',
    privacy: '只有按下簽到按鈕才取得本次位置並傳送後端驗證；不儲存原始 GPS。',
    closed: '場地狀態已改變，請重新輕觸 NFC 或掃描 QR 查看最新時段。'
  },
  zh_CN: {
    title: '团练场入口',
    open: '目前开放签到',
    before_open: '尚未开放签到',
    ended: '本次团练已结束',
    not_activity_day: '今天不是此场地的团练日',
    disabled: '场地已停用',
    not_found: '场地不存在',
    unavailable: '场地查询暂不可用，请稍后再试。',
    start: '团练开始',
    end: '团练结束',
    opens: '开放签到',
    next: '下一次团练',
    unknownNext: '下次时段尚无资料',
    source: '请优先轻触现场 NFC 标签；无法感应时扫描 QR。链接及来源标记不是身份、在场或邀请证明。',
    login: '登录 LINE',
    retry: '重新验证',
    loading: '正在确认资格，尚未记录出席。',
    error: '无法确认资格，请重新验证；这不表示需要重新申请。',
    needs_application:
      '请回 LINE 私聊手动输入「加入」，填写私人表单，等待人工核准后再轻触 NFC 或扫描 QR。',
    pending: '申请审核中，请等待人工核准后再轻触或扫描；不要重复申请。',
    blocked: '目前无法签到，请联系管理员；不要重复申请。',
    required: '请回 LINE 私聊手动输入「隱私」，完成既有同意流程后再轻触或扫描。',
    chat: '打开 LINE 私聊',
    privacy: '只有按下签到按钮才获取本次位置并传送后端验证；不存储原始 GPS。',
    closed: '场地状态已改变，请重新轻触 NFC 或扫描 QR 查看最新时段。'
  },
  en: {
    title: 'Venue entry',
    open: 'Check-in is open',
    before_open: 'Check-in has not opened',
    ended: 'This practice has ended',
    not_activity_day: 'Not a practice day at this venue',
    disabled: 'Venue disabled',
    not_found: 'Venue not found',
    unavailable: 'Venue lookup unavailable. Please retry later.',
    start: 'Practice starts',
    end: 'Practice ends',
    opens: 'Check-in opens',
    next: 'Next practice',
    unknownNext: 'Next session unknown',
    source:
      'Tap the on-site NFC tag first; scan the QR code if tapping is unavailable. Links and source labels are not proof of identity, presence or an invitation.',
    login: 'Log in to LINE',
    retry: 'Verify again',
    loading: 'Checking eligibility. Attendance has NOT been recorded.',
    error:
      'Eligibility could not be verified. Retry; this does not mean you need a new application.',
    needs_application:
      'In private LINE chat, manually send 「加入」, fill in the private form and wait for manual approval. Then tap NFC or scan QR again.',
    pending:
      'Application pending. Wait for manual approval, then tap or scan again. Do not reapply.',
    blocked: 'Check-in is blocked. Contact the administrator. Do not reapply.',
    required:
      'In private LINE chat, manually send 「隱私」 and complete the existing privacy flow. Then tap or scan again.',
    chat: 'Open private LINE chat',
    privacy:
      'Only pressing check-in requests this attempt’s location and sends it for server validation. Raw GPS is not stored.',
    closed: 'Venue availability changed. Tap NFC or scan QR again for the latest schedule.'
  }
} as const;
/** Shared anonymous presentation. Only bounded public fields reach the markup. */
export const venueGuidancePresentation = (result: unknown, code: string, locale: Locale) => {
  let validated = validateVenueGuidanceResult(result, code);
  const t = guidanceTexts[locale];
  const cards = (session: VenueEntrySession, timezone: string): string | null => {
    const time = formatVenueEntrySession(session, timezone, locale);
    return time
      ? `<dl><dt>${t.start}</dt><dd>${escapeHtml(time.startsAt)}</dd><dt>${t.end}</dt><dd>${escapeHtml(time.endsAt)}</dd><dt>${t.opens}</dt><dd>${escapeHtml(time.opensAt)}</dd></dl>`
      : null;
  };
  let details = '';
  if (validated.status !== 503 && validated.status !== 400 && validated.body.venue) {
    const body = validated.body;
    const zone = body.venue!.timezone;
    const relevant = body.relevantSession ? cards(body.relevantSession, zone) : '';
    const next = body.nextSession ? cards(body.nextSession, zone) : '';
    if (relevant === null || next === null)
      validated = { status: 503, body: { error: 'venue_entry_unavailable' } };
    else
      details = `<p>${escapeHtml(body.venue!.name)} — <code>${escapeHtml(code)}</code></p><p>${escapeHtml(zone)}</p>${relevant}${next ? `<h2>${t.next}</h2>${next}` : body.availability === 'disabled' ? '' : `<p>${t.unknownNext}</p>`}`;
  }
  const availability =
    validated.status === 503 || validated.status === 400
      ? 'unavailable'
      : validated.body.availability;
  return {
    result: validated,
    open: availability === 'open',
    markup: `<h1>${t.title}</h1><p role="status">${t[availability]}</p>${details}`
  };
};
const guidanceDocument = (lang: Locale, body: string, script = '') =>
  `<!doctype html><html lang="${htmlLocale(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${guidanceTexts[lang].title}</title><style>body{font:1.2rem/1.65 system-ui,sans-serif;max-width:36rem;margin:auto;padding:1rem;color:#172b24;background:#f3f7f3}button,a,select{font:inherit;min-height:48px;margin:.5rem 0}button,a{display:block}button{padding:.75rem}dd{margin-bottom:.5rem}p,dd,a{overflow-wrap:anywhere}[hidden]{display:none!important}:focus-visible{outline:3px solid #ad5100}footer{font-size:.8rem;margin-top:2rem}</style></head><body><main>${body}</main><footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer>${script}</body></html>`;
const renderGuidedVenuePreview = (
  liffId: string,
  entry: VenuePreviewEntry | null,
  historyEnabled: boolean,
  guidance: VenuePreviewGuidance
): string => {
  const lang = entry && isLocale(entry.lang) ? entry.lang : 'zh_TW';
  const t = guidanceTexts[lang];
  if (
    !entry ||
    !venueEntryCodeSchema.safeParse(entry.venue).success ||
    !isLocale(entry.lang) ||
    (entry.source !== undefined && !['nfc', 'qr', 'link'].includes(entry.source))
  )
    return guidanceDocument(lang, `<h1>${t.title}</h1><p>${texts[lang].invalid}</p>`);
  const view = venueGuidancePresentation(guidance.result, entry.venue, lang);
  if (
    view.result.status === 503 ||
    view.result.status === 400 ||
    !/^[A-Za-z0-9-]{1,100}$/.test(liffId)
  )
    return guidanceDocument(lang, view.markup.replace(t.open, t.unavailable));
  const sdk = '<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>';
  if (guidance.isPrimaryBootstrap === true)
    return guidanceDocument(
      lang,
      view.markup,
      `${sdk}<script>liff.init({liffId:${scriptJson(liffId)},withLoginOnExternalBrowser:false}).catch(()=>{});</script>`
    );
  if (!view.open) return guidanceDocument(lang, view.markup);
  const canonical = venuePreviewUrl(entry);
  const ui = {
    ...texts[lang],
    ...checkinTexts[lang],
    ...t,
    gpsUnavailable: texts[lang].unavailable,
    uncertain: checkinTexts[lang].retry
  };
  return guidanceDocument(
    lang,
    `<section id="guided-calendar">${view.markup}</section><p>${t.source}</p><p>${t.privacy}</p><p id="guided-status" role="status" aria-live="polite">${t.loading}</p><button id="guided-login" type="button" hidden>${t.login}</button><button id="guided-retry" type="button" hidden>${t.retry}</button><a id="guided-chat" href="https://line.me/R/oaMessage/%40556fjenc" referrerpolicy="no-referrer" hidden>${t.chat}</a><button id="guided-checkin" type="button" disabled aria-busy="false">${ui.button}</button><label id="guided-language-label" for="guided-language">${ui.language}</label><select id="guided-language">${languageOptions(lang)}</select><div id="guided-receipt" hidden>${historyEnabled ? `<a href="/line/venue-history?lang=${lang}">${ui.history}</a>` : ''}<a href="/line/checkin?lang=${lang}">${ui.daily}</a></div>`,
    `${sdk}<script>
(()=>{
const ui=${scriptJson(ui)},code=${scriptJson(entry.venue)},canonical=${scriptJson(canonical)},locale=${scriptJson(lang)};
const status=document.getElementById('guided-status'),button=document.getElementById('guided-checkin'),login=document.getElementById('guided-login'),retry=document.getElementById('guided-retry'),chat=document.getElementById('guided-chat'),language=document.getElementById('guided-language'),receipt=document.getElementById('guided-receipt'),calendar=document.getElementById('guided-calendar'),languageLabel=document.getElementById('guided-language-label');
let token='',busy=true,eligible=false,completed=false,alive=true,calendarOpen=true;
const controls=()=>{button.disabled=!alive||busy||!eligible||completed||!calendarOpen;button.setAttribute('aria-busy',String(busy));language.disabled=!alive||busy||!calendarOpen;login.disabled=!alive||busy||!calendarOpen;retry.disabled=!alive||busy||!calendarOpen;};
const strict=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim().length>0&&!/[\\x00-\\x1f\\x7f]/.test(value);
const stamp=value=>typeof value==='string'&&value.length<=64&&/^\\d{4}-\\d{2}-\\d{2}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===value.slice(0,10);
const zone=value=>{try{if(!text(value,100))return false;new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}};
const session=value=>strict(value,['startsAt','endsAt','opensAt'])&&stamp(value.startsAt)&&stamp(value.endsAt)&&stamp(value.opensAt)&&Date.parse(value.endsAt)>Date.parse(value.startsAt)&&Date.parse(value.opensAt)<Date.parse(value.startsAt);
const availability=value=>{
 if(!strict(value,['version','availability','venue','observedAt','relevantSession','nextSession'])||value.version!==1||!stamp(value.observedAt)||!['open','before_open','ended','not_activity_day','disabled','not_found','unavailable'].includes(value.availability))throw Error('availability');
 const venue=value.venue;
 if(venue!==null&&(!strict(venue,['code','name','timezone'])||venue.code!==code||!text(venue.name,120)||!zone(venue.timezone)))throw Error('binding');
 if(value.relevantSession!==null&&!session(value.relevantSession)||value.nextSession!==null&&(!session(value.nextSession)||Date.parse(value.nextSession.opensAt)<=Date.parse(value.observedAt)))throw Error('session');
 if(['open','before_open','ended'].includes(value.availability)&&(!venue||!value.relevantSession)||value.availability==='not_activity_day'&&(!venue||value.relevantSession!==null)||value.availability==='disabled'&&(!venue||value.relevantSession!==null||value.nextSession!==null)||value.availability==='not_found'&&(venue!==null||value.relevantSession!==null||value.nextSession!==null)||value.availability==='unavailable'&&(value.relevantSession!==null||value.nextSession!==null))throw Error('state');
 return value;
};
const credential=()=>{const current=liff.isLoggedIn()?liff.getIDToken():'';if(!text(current,4096))throw Error('credential');return current;};
const same=attempt=>{if(!alive||credential()!==attempt)throw Error('credential changed');};
const options={cache:'no-store',credentials:'omit',redirect:'error'};
const selfStatus=async attempt=>{
 const response=await fetch('/api/line/venue-entry-status',{...options,method:'POST',headers:{'content-type':'application/json','x-venue-entry':'1'},body:JSON.stringify({idToken:attempt})});
 if(response.status!==200)throw Error('status');
 const data=await response.json();same(attempt);
 if(!strict(data,['version','status','privacy'])||data.version!==1||!['needs_application','pending','approved','blocked'].includes(data.status)||(data.status==='approved'?!['clear','required'].includes(data.privacy):data.privacy!==null))throw Error('status');
 return data;
};
const showStatus=data=>{eligible=data.status==='approved'&&data.privacy==='clear';chat.hidden=!(data.status==='needs_application'||data.status==='approved'&&data.privacy==='required');status.textContent=eligible?ui.ready:data.status==='approved'?ui.required:ui[data.status];retry.hidden=eligible;};
const failure=message=>{token='';eligible=false;chat.hidden=true;retry.hidden=false;status.textContent=message;};
const closeCalendar=message=>{calendarOpen=false;token='';eligible=false;calendar.hidden=true;chat.hidden=true;login.hidden=true;retry.hidden=true;button.hidden=true;language.hidden=true;languageLabel.hidden=true;receipt.hidden=true;status.textContent=message;controls();};
// Server-owned relative path only: never reuse callback, query-host or liff.state navigation.
const refreshCalendarDocument=()=>{try{location.replace(canonical);}catch{/* Remain read-only if navigation is unavailable. */}};
const refreshAvailability=async()=>{
 const response=await fetch('/api/venue-entry/availability?venue='+encodeURIComponent(code),{...options,method:'GET'});
 if(![200,404,410].includes(response.status))throw Error('availability');
 const data=availability(await response.json());
 const expected=data.availability==='not_found'?404:data.availability==='disabled'?410:data.availability==='unavailable'?503:200;
 if(response.status!==expected)throw Error('availability');
 if(!alive)throw Error('hidden');
 if(data.availability!=='open'){closeCalendar(ui[data.availability]);refreshCalendarDocument();return false;}
 return true;
};
const verify=async()=>{
 if(busy||!alive||!calendarOpen||completed)return;
 busy=true;eligible=false;chat.hidden=true;controls();
 try{if(!await refreshAvailability())return;const attempt=credential();token=attempt;showStatus(await selfStatus(attempt));}
 catch{if(alive)failure(ui.error);}finally{busy=false;controls();}
};
globalThis.addEventListener('pagehide',()=>{alive=false;token='';eligible=false;busy=true;chat.hidden=true;receipt.hidden=true;controls();});
language.onchange=()=>{
 const next=language.value;if(busy||!alive||!calendarOpen||!['zh_TW','zh_CN','en'].includes(next)||next===locale){language.value=locale;return;}
 busy=true;token='';eligible=false;controls();document.cookie='__Host-qigong-learner-locale='+next+'; Path=/; Max-Age=31536000; Secure; SameSite=Lax';
 const target=new URL(canonical,location.href);target.searchParams.set('lang',next);location.replace(target.pathname+target.search);
};
login.onclick=async()=>{
 if(busy||!alive||!calendarOpen)return;busy=true;controls();
 try{if(!await refreshAvailability())return;liff.login({redirectUri:new URL(canonical,location.origin).href});}
 catch{if(alive)failure(ui.error);}finally{busy=false;controls();}
};
retry.onclick=verify;
button.onclick=async()=>{
 if(busy||!alive||!calendarOpen||!eligible||completed)return;
 busy=true;eligible=false;retry.hidden=true;chat.hidden=true;controls();status.textContent=ui.loading;
 let attempt='',writeAttempted=false,preWriteError=ui.error;
 try{
  if(!await refreshAvailability())return;
  attempt=credential();token=attempt;const state=await selfStatus(attempt);showStatus(state);same(attempt);
  if(!eligible)return;
  status.textContent=ui.locating;preWriteError=ui.gpsUnavailable;
  const position=await new Promise((resolve,reject)=>{
   if(!navigator.geolocation){preWriteError=ui.unsupported;reject();return;}
   try{navigator.geolocation.getCurrentPosition(resolve,error=>{
    let code;try{if(error!==null&&typeof error==='object')code=error.code;}catch{/* Only known geolocation codes affect copy. */}
    preWriteError=code===1?ui.denied:code===3?ui.timeout:ui.gpsUnavailable;reject();
   },{enableHighAccuracy:false,timeout:10000,maximumAge:0});}catch{preWriteError=ui.gpsUnavailable;reject();}
  });
  preWriteError=ui.error;same(attempt);status.textContent=ui.sending;
  const request={...options,method:'POST',headers:{'content-type':'application/json','x-venue-checkin':'1'},body:JSON.stringify({idToken:token,venue:code,latitude:position.coords.latitude,longitude:position.coords.longitude})};
  // Marks transport invocation, not proof that bytes reached the server.
  writeAttempted=true;
  const response=await fetch('/api/line/venue-checkin',request);
  if(!alive)return;
  if(response.status!==200){
   let data=null;try{data=await response.json();}catch{/* Unknown write outcome remains uncertain. */}
   if(data?.error==='outside_window'){closeCalendar(ui.closed);try{if(await refreshAvailability())refreshCalendarDocument();}catch{refreshCalendarDocument();}return;}
   failure(response.status>=500?ui.uncertain:response.status===401?ui.error:data?.error==='outside_radius'?ui.outside_radius:ui.rejected);return;
  }
  const data=await response.json();same(attempt);
  if(!data||data.ok!==true||Object.hasOwn(data,'isTest')||Object.hasOwn(data,'verificationMode')||!data.venue||!text(data.venue.name,120)||!zone(data.venue.timezone)||!stamp(data.checkedInAt)||(data.venue.code!==undefined&&data.venue.code!==code))throw Error('receipt');
  const time=new Intl.DateTimeFormat(${scriptJson(htmlLocale(lang))},{timeZone:data.venue.timezone,dateStyle:'full',timeStyle:'short'}).format(new Date(data.checkedInAt));
  status.textContent=ui.success+' — '+data.venue.name+' / '+time+' ('+data.venue.timezone+')';completed=true;token='';receipt.hidden=false;button.textContent=ui.completedButton;
 }catch{if(alive)failure(writeAttempted?ui.uncertain:preWriteError);}finally{attempt='';token='';busy=false;controls();}
};
(async()=>{try{
 await liff.init({liffId:${scriptJson(liffId)},withLoginOnExternalBrowser:false});if(!alive)return;
 if(!liff.isLoggedIn()){busy=false;login.hidden=false;status.textContent=ui.login;controls();return;}
 token=credential();showStatus(await selfStatus(token));
}catch{if(alive)failure(ui.error);}finally{if(alive){busy=false;controls();}}})();
})();
</script>`
  );
};

export const renderVenuePreview = (
  liffId: string,
  entry: VenuePreviewEntry | null,
  mode: 'preview' | 'checkin' = 'preview',
  historyEnabled = false,
  debugVenue?: VenueDebugVenueCode,
  guidance?: VenuePreviewGuidance
): string => {
  if (guidance !== undefined)
    return renderGuidedVenuePreview(liffId, entry, historyEnabled, guidance);
  const lang = entry?.lang ?? 'zh_TW';
  const live = mode === 'checkin';
  const debugAvailable = live && debugVenue !== undefined && entry?.venue === debugVenue;
  const testOnly = live && entry?.venue === 'tw-location-test';
  const testUnavailable = testOnly && !debugAvailable;
  const d = debugTexts[lang];
  const t = { ...(live ? { ...texts[lang], ...checkinTexts[lang] } : texts[lang]), debug: d };
  const canonical = entry ? venuePreviewUrl(entry) : '';
  const historyHref = /^[A-Za-z0-9-]{1,100}$/.test(liffId)
    ? `https://liff.line.me/${encodeURIComponent(liffId)}/venue-history?lang=${lang}`
    : `/line/venue-history?lang=${lang}`;
  return `<!doctype html><html lang="${htmlLocale(lang)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>${t.title}</title><style>
:root{font:125%/1.65 system-ui,sans-serif;color:#172b24;background:#f3f7f3}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;padding:1rem}main{max-width:36rem;margin:auto}h1{font-size:1.6rem}h1,p,label,a,summary{overflow-wrap:anywhere}.notice{border:3px solid #725000;background:#fff5d6;padding:1rem;font-weight:700}button,a,select{font:inherit;min-height:48px}button,a{display:block;padding:.75rem;margin:1rem 0}button{width:100%;overflow-wrap:anywhere;color:white;background:#195941;border:2px solid #195941;border-radius:.5rem}button:disabled{color:#404040;background:#ddd;border-color:#777}a{color:#164b83}select,input{font:inherit;min-height:48px;min-inline-size:0;max-inline-size:100%}#preview-debug-token{display:block;width:100%}summary{min-height:48px}#preview-status{padding:.75rem;border:2px solid #567365}:focus-visible{outline:3px solid #ad5100;outline-offset:3px}footer{font-size:.8rem;overflow-wrap:anywhere;margin-top:2rem}
</style></head><body><main><h1>${t.title}</h1><p id="preview-notice" class="notice">${!entry ? t.invalid : testOnly ? d.testOnly : t.notice}</p>
${entry ? `<p>${t.venue}：<strong>${escapeHtml(entry.venue)}</strong></p><p>${t.unknown}</p><p>${t.privacy}</p><label for="preview-language">${t.language}</label><select id="preview-language" disabled>${languageOptions(lang)}</select>` : ''}
${debugAvailable ? `<details${testOnly ? ' open' : ''}><summary>${d.token}</summary><p>${d.help}</p>${testOnly ? '<input id="preview-debug-enabled" type="checkbox" checked disabled hidden>' : `<label><input id="preview-debug-enabled" type="checkbox">${d.optIn}</label>`}<label for="preview-debug-token">${d.token}</label><input id="preview-debug-token" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="256"></details>` : ''}
${entry ? `<button id="preview-test" type="button" aria-busy="false" aria-describedby="preview-status" disabled>${testUnavailable ? d.unavailableButton : t.button}</button>` : ''}
<p id="preview-status" role="status" aria-live="polite" aria-atomic="true">${entry ? (testUnavailable ? d.unavailable : t.loading) : t.invalid}</p>
${live && entry && historyEnabled ? `<a id="preview-history" href="${escapeHtml(historyHref)}" referrerpolicy="no-referrer" hidden>${t.history}</a>` : ''}
<a href="/line/checkin?lang=${lang}" referrerpolicy="no-referrer">${t.daily}</a>
<footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer></main>
${
  entry
    ? `<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script><script>
${lineLoginScript(liffId, lang, canonical, { explicitLocale: entry.explicitLang === false ? null : lang })}
const previewText=${scriptJson(t)},previewCanonical=${scriptJson(canonical)},previewInitial=${scriptJson(entry)};
const status=document.getElementById('preview-status'),button=document.getElementById('preview-test'),language=document.getElementById('preview-language');
let previewReady=false,previewBusy=false,previewCompleted=false,previewLocated=false,previewPhase='',noticeTesting=${testOnly};
// Only a user-requested result may scroll. Missing/throwing browser APIs must
// never turn an already validated server success into an error.
const revealResult=()=>{try{
  if(typeof status.getBoundingClientRect!=='function'||typeof status.scrollIntoView!=='function')return;
  const height=globalThis.visualViewport?.height||globalThis.innerHeight;
  if(!height)return;
  const rect=status.getBoundingClientRect();
  if(rect.top>=0&&rect.bottom<=height)return;
  const reduced=typeof globalThis.matchMedia==='function'&&globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  status.scrollIntoView({block:'nearest',behavior:reduced?'auto':'smooth'});
}catch{/* Presentation failure must not replace the result. */}};
${
  debugAvailable
    ? `const debugToggle=document.getElementById('preview-debug-enabled'),debugInput=document.getElementById('preview-debug-token');
let debugToken='';
const clearDebug=(reset=false)=>{debugToken='';debugInput.value='';if(reset)debugToggle.checked=${testOnly ? 'true' : 'false'};};
debugToggle.onchange=()=>{if(previewBusy||previewCompleted)return;noticeTesting=${testOnly ? 'true' : 'debugToggle.checked'};clearDebug();controls();};
globalThis.addEventListener?.('pagehide',()=>clearDebug(true));`
    : 'const clearDebug=()=>{};'
}
const controls=()=>{button.disabled=${testUnavailable}||previewBusy||!previewReady||previewCompleted;language.disabled=previewBusy||!previewReady;
button.setAttribute?.('aria-busy',String(previewBusy));
button.textContent=previewPhase==='locating'?previewText.locatingButton:previewPhase==='sending'?previewText.sendingButton:previewCompleted?(noticeTesting?previewText.debug.completedButton:previewText.completedButton):${testUnavailable}?previewText.debug.unavailableButton:previewLocated?previewText.completedButton:previewText.button;
document.getElementById('preview-notice').textContent=noticeTesting?previewText.debug.testOnly:previewText.notice;
${debugAvailable ? `debugInput.disabled=previewBusy||!previewReady||previewCompleted;debugToggle.disabled=${testOnly}||debugInput.disabled;` : ''}};
const invalidate=()=>{previewReady=false;idToken='';clearDebug(true);status.textContent=previewText.loginError;};
const currentCredential=()=>{try{const currentToken=liff.getIDToken()||'';if(liff.isLoggedIn()&&currentToken)return currentToken;}catch{/* SDK failure never authorizes a request. */}invalidate();return '';};
language.onchange=async()=>{
  const next=language.value;
  if(!previewReady||previewBusy||!['zh_TW','zh_CN','en'].includes(next)||next===previewInitial.lang){language.value=previewInitial.lang;return;}
  previewBusy=true;clearDebug(true);if(!previewCompleted)noticeTesting=${testOnly};controls();
  let navigating=false;
  try{
    const currentToken=currentCredential();if(!currentToken){language.value=previewInitial.lang;return;}
    const response=await fetch('/line/preferences/language',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:currentToken,locale:next})});
    if(response.status===401){invalidate();language.value=previewInitial.lang;return;}
    if(!response.ok)throw new Error('language');
    document.cookie='__Host-qigong-learner-locale='+next+'; Path=/; Max-Age=31536000; Secure; SameSite=Lax';
    const target=new URL(previewCanonical,location.href);target.searchParams.set('lang',next);
    status.textContent=lineLoginText.switching;
    location.replace(target.pathname+target.search);navigating=true;
  }catch{language.value=previewInitial.lang;status.textContent=previewText.languageFailed;}finally{if(!navigating){previewBusy=false;controls();}}
};
lineReady.then(()=>{previewReady=true;controls();status.textContent=${testUnavailable ? 'previewText.debug.unavailable' : 'previewText.ready'};}).catch(error=>{if(error?.message===lineLoginText.switching){previewBusy=true;clearDebug();status.textContent=lineLoginText.switching;}else status.textContent=linePrimaryRedirect?lineLoginText.primary:previewText.loginError;controls();});
controls();
button.onclick=()=>{
  if(${testUnavailable}||!previewReady||previewBusy||previewCompleted||button.disabled)return;
  if(!currentCredential()){controls();revealResult();return;}
  if(!navigator.geolocation){status.textContent=previewText.unsupported;revealResult();return;}
  ${
    debugAvailable
      ? `const testing=${testOnly ? 'true' : 'debugToggle.checked'};debugToken=testing?debugInput.value:'';debugInput.value='';
  noticeTesting=testing;
  if(testing&&(debugToken.length<32||debugToken.length>256)){clearDebug();status.textContent=previewText.debug.denied;controls();revealResult();return;}`
      : 'const testing=false;'
  }
  noticeTesting=testing;previewLocated=false;previewBusy=true;previewPhase='locating';controls();status.textContent=previewText.locating;
  const finish=(message,located=false)=>{status.textContent=message;previewLocated=located;previewBusy=false;previewPhase='';clearDebug();controls();revealResult();};
  try{navigator.geolocation.getCurrentPosition(
    ${
      live
        ? `async position=>{
      previewPhase='sending';controls();status.textContent=previewText.sending;
      try {
        const currentToken=currentCredential();if(!currentToken){finish(previewText.loginError);return;}
        const response=await fetch('/api/line/venue-checkin',{
          method:'POST',cache:'no-store',credentials:'omit',redirect:'error',
          headers:{'content-type':'application/json','x-venue-checkin':'1'${debugAvailable ? ",...(testing?{'X-Venue-Debug-Token':debugToken}:{})" : ''}},
          body:JSON.stringify({idToken:currentToken,venue:${scriptJson(entry?.venue)},latitude:position.coords.latitude,longitude:position.coords.longitude})
        });
        if(response.status===401){invalidate();finish(previewText.loginError);return;}
        const data=await response.json();
        if(!response.ok||data.ok!==true){
          finish((data.error==='venue_debug_denied'||data.error==='venue_test_code_required')?previewText.debug.denied:response.status>=500?previewText.retry:data.error==='outside_radius'?previewText.outside_radius:data.error==='outside_window'?previewText.outside_window:previewText.rejected);return;
        }
        if((testing?(data.isTest!==true||data.verificationMode!=='distance_debug'):(data.isTest!==undefined||data.verificationMode!==undefined)))throw new Error('invalid result mode');
        if(!data.venue||typeof data.venue.name!=='string'||typeof data.checkedInAt!=='string'||typeof data.venue.timezone!=='string')throw new Error('invalid result');
        const time=new Intl.DateTimeFormat(${scriptJson(htmlLocale(lang))},{timeZone:data.venue.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(data.checkedInAt));
        status.textContent=(data.isTest===true?previewText.debug.label:previewText.success)+' — '+data.venue.name+' / '+time+' ('+data.venue.timezone+'). '+previewText.daily;
        ${historyEnabled ? "document.getElementById('preview-history').hidden=false;" : ''}
        clearDebug();previewCompleted=true;previewBusy=false;previewPhase='';controls();revealResult();
      }catch{finish(previewText.retry);}
    }`
        : '()=>finish(previewText.located,true)'
    },
    error=>finish(error.code===1?previewText.denied:error.code===3?previewText.timeout:previewText.unavailable),
    {enableHighAccuracy:false,timeout:10000,maximumAge:0}
  );}catch{finish(previewText.unavailable);}
};
</script>`
    : ''
}</body></html>`;
};
