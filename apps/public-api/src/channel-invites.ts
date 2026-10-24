import { createHmac, randomUUID } from 'node:crypto';
import type { PoolClient } from '@qigong/database';
import { z } from 'zod';
import { uiText, type Locale } from './ui-localization.js';

export const invitePlatformSchema = z.enum(['telegram', 'whatsapp']);
export type InvitePlatform = z.infer<typeof invitePlatformSchema>;
export interface InviteTransports {
  readonly telegram?: string;
  readonly whatsapp?: string;
}
export const loadInviteTransports = (source: NodeJS.ProcessEnv): InviteTransports => ({
  ...(source.TELEGRAM_INVITE_BOT_USERNAME
    ? {
        telegram: z
          .string()
          .regex(/^[A-Za-z][A-Za-z0-9_]{4,31}$/)
          .parse(source.TELEGRAM_INVITE_BOT_USERNAME)
      }
    : {}),
  ...(source.WHATSAPP_INVITE_CHAT_NUMBER
    ? {
        whatsapp: z
          .string()
          .regex(/^\+?[1-9][0-9]{6,14}$/)
          .parse(source.WHATSAPP_INVITE_CHAT_NUMBER)
          .replace(/^\+/, '')
      }
    : {})
});
export const channelInviteTransportUrl = (
  platform: InvitePlatform,
  target: string | undefined,
  token: string
): string | null => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !target) return null;
  if (platform === 'telegram')
    return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(target)
      ? 'https://t.me/' + target + '?start=inv_' + token
      : null;
  return /^[1-9][0-9]{6,14}$/.test(target)
    ? 'https://wa.me/' + target + '?text=' + encodeURIComponent('join inv_' + token)
    : null;
};
export const channelInviteCommand = (
  platform: InvitePlatform,
  text: string
): { command: boolean; token?: string; invalid?: boolean } => {
  const prefix =
    platform === 'telegram'
      ? /^\/start(?:@\w+)?\s+inv_([A-Za-z0-9_-]{43})\s*$/i
      : /^(?:join|加入)\s+inv_([A-Za-z0-9_-]{43})\s*$/i;
  const match = prefix.exec(text);
  if (match?.[1]) return { command: true, token: match[1] };
  const suspicious =
    platform === 'telegram' ? /^\/start(?:@\w+)?\s+inv_/i : /^(?:join|加入)\s+inv_/i;
  if (suspicious.test(text)) return { command: true, invalid: true };
  return {
    command:
      platform === 'telegram'
        ? /^\/(?:start|apply)(?:@\w+)?\s*$/i.test(text)
        : /^(?:\/?start|join|加入|申請)\s*$/i.test(text)
  };
};
export const channelInviteTexts = (locale: Locale) => {
  const text = (zh: string, en: string) => (locale === 'en' ? en : uiText(locale, zh));
  return {
    title: text('邀請加入打卡小幫手', 'Join the check-in helper by invitation'),
    intro: text(
      '邀請資訊已自動帶入，不必輸入邀請碼。請使用自己的通訊帳號。',
      'Your invitation is included automatically. No code to type. Use your own messaging account.'
    ),
    open: text('開啟小幫手並繼續', 'Open the helper to continue'),
    action: text(
      'Telegram請按開始；WhatsApp訊息已預填，請按送出，不用打字。',
      'In Telegram press Start. In WhatsApp press Send on the prefilled message; no typing is needed.'
    ),
    unavailable: text(
      '邀請或接續連結已失效，請向邀請人取得新網址，或回小幫手重新開啟。',
      'This invitation or continuation is unavailable. Ask the inviter for a new URL or return to the helper.'
    ),
    reply: text(
      '請開啟以下本人專用連結，完成必要同意及基本資料後，將依有效邀請直接核准，不必輸入邀請碼。',
      'Open your private link below. Complete the notice and your details to be approved by the valid invitation. No invitation code is needed.'
    ),
    continueRequired: text(
      '你有邀請尚待確認。請回小幫手重新按開始或傳送 join，開啟本人邀請表單，不必再填一般申請。',
      'An invitation awaits your confirmation. Return to the helper, press Start or send join, and open your private invitation form instead of an ordinary application.'
    ),
    name: text('姓名', 'Name'),
    email: text('網站註冊Email', 'Website registration email'),
    phone: text('國際格式電話', 'Phone in international format'),
    region: text('邀請核准地區', 'Invitation region'),
    pending: text(
      '你已有待審申請。請確認本人資料與邀請地區，提交後依有效邀請直接核准。',
      'You already have a pending application. Confirm your own details and invitation region to be approved by this valid invitation.'
    ),
    notice: text(
      '請先閱讀隱私政策與補充告知，再自行確認必要同意；邀請不代替同意。',
      'Read the privacy policy and supplement, then confirm the required notice yourself. An invitation is not consent.'
    ),
    privacy: text('隱私政策', 'Privacy policy'),
    supplement: text('補充告知', 'Supplementary notice'),
    accept: text(
      '我已閱讀並同意目前版本的必要隱私告知。',
      'I have read and agree to the current required privacy notice.'
    ),
    agree: text('同意並繼續', 'Agree and continue'),
    notification: text(
      '我同意透過WhatsApp接收申請審核結果通知；可回覆STOP取消。',
      'I agree to receive WhatsApp application-decision messages. Reply STOP to opt out.'
    ),
    join: text('確認資料並加入', 'Confirm details and join'),
    success: text(
      '已核准加入。請回原小幫手對話，開啟練功打卡。',
      'Approved. Return to the original helper chat and open Practice check-in.'
    ),
    busy: text('正在處理，請稍候。', 'Working, please wait.'),
    failure: text(
      '操作尚未確認完成，請保留輸入稍後重試；不要重複填一般申請。',
      'The operation is not confirmed. Keep your input and retry later; do not create another ordinary application.'
    ),
    language: text('介面語言', 'Language'),
    warning: text(
      '請勿轉傳本人接續連結。姓名、Email或電話相同不會合併帳號。',
      'Do not forward your private continuation. Matching names, email or phone never merges accounts.'
    )
  };
};
export const channelInviteAvailable = async (client: PoolClient): Promise<boolean> =>
  (
    await client.query<{ available: boolean }>(
      "SELECT to_regprocedure('platform.begin_channel_invite(text,text,text,uuid,text)') IS NOT NULL available"
    )
  ).rows[0]?.available === true;
const nativeState = z.object({
  status: z.enum(['none', 'invalid', 'blocked', 'approved', 'privacy', 'form']),
  nonce: z.uuid().optional()
});
export const beginChannelInvitation = async (
  client: PoolClient,
  platform: InvitePlatform,
  subject: string,
  invite: string | undefined,
  secret: string
) => {
  try {
    if (!(await channelInviteAvailable(client)))
      return { status: invite ? ('invalid' as const) : ('none' as const) };
    const make = (nonce: string) =>
      createHmac('sha256', secret)
        .update('channel-invite-resume:v1:' + platform + ':' + subject + ':' + nonce)
        .digest('base64url');
    const call = async (nonce: string) =>
      nativeState.parse(
        (
          await client.query<{ data: unknown }>(
            'SELECT platform.begin_channel_invite($1,$2,$3,$4,$5) data',
            [platform, subject, invite ?? null, nonce, make(nonce)]
          )
        ).rows[0]?.data
      );
    let nonce: string = randomUUID();
    let result = await call(nonce);
    if (result.nonce && result.nonce !== nonce) {
      nonce = result.nonce;
      result = await call(nonce);
    }
    return {
      ...result,
      ...(['form', 'privacy'].includes(result.status) && result.nonce
        ? { token: make(result.nonce) }
        : {})
    };
  } catch {
    // Never pass PostgreSQL details/parameters or resume material into the legacy bot logger.
    throw Error('channel invite service unavailable');
  }
};
