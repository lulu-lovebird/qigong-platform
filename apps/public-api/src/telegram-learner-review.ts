import { randomBytes } from 'node:crypto';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { localeSchema, uiText } from './ui-localization.js';
import { isHelpCommand } from './learner-help-content.js';

const positive = z.number().int().positive().safe();
const subjectSchema = z.string().regex(/^[1-9][0-9]{0,19}$/);
const opaqueSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const actor = z.object({ id: positive, is_bot: z.literal(false) });
const bot = z.object({ id: positive, is_bot: z.literal(true) });
const privateChat = z.object({ id: positive, type: z.literal('private') });
const originalMessage = z.object({
  message_id: positive,
  date: positive,
  chat: privateChat,
  from: bot,
  forward_origin: z.never().optional(),
  forward_date: z.never().optional(),
  forward_from: z.never().optional(),
  forward_from_chat: z.never().optional(),
  sender_chat: z.never().optional(),
  via_bot: z.never().optional(),
  is_automatic_forward: z.never().optional()
});
const callbackSchema = z.object({
  id: z.string().min(1).max(256),
  from: actor,
  message: originalMessage,
  data: z.string().max(64),
  inline_message_id: z.never().optional()
});
const replySchema = z.object({
  message_id: positive,
  from: actor,
  chat: privateChat,
  date: positive,
  text: z.string().trim().min(1).max(500),
  entities: z.array(z.object({ type: z.string() })).optional(),
  reply_to_message: originalMessage,
  forward_origin: z.never().optional(),
  forward_date: z.never().optional(),
  forward_from: z.never().optional(),
  forward_from_chat: z.never().optional(),
  sender_chat: z.never().optional(),
  via_bot: z.never().optional()
});
const stateSchema = z.object({
  state: z.enum([
    'unavailable',
    'stale',
    'decided',
    'ready',
    'deny',
    'input',
    'confirm_approve',
    'confirm_deny'
  ]),
  locale: localeSchema.optional(),
  reason: z.string().max(500).nullable().optional(),
  messageId: positive.optional(),
  applicant: z
    .object({
      name: z.string().max(150),
      platform: z.enum(['line', 'telegram', 'whatsapp']),
      sourceId: z.string().max(128)
    })
    .optional()
});
export type TelegramReviewButtons = ReadonlyArray<
  ReadonlyArray<{ text: string; callback_data: string }>
>;
export interface TelegramReviewTransport {
  send: (
    recipient: string,
    text: string,
    buttons?: TelegramReviewButtons,
    forceReply?: boolean
  ) => Promise<number>;
  edit: (
    recipient: string,
    messageId: number,
    text: string,
    buttons: TelegramReviewButtons
  ) => Promise<void>;
  answer: (callbackId: string, text: string) => Promise<void>;
}
export const createTelegramReviewTransport = (botToken: string): TelegramReviewTransport => {
  const botId = botToken.split(':')[0];
  const call = async (
    method: 'sendMessage' | 'editMessageText' | 'answerCallbackQuery',
    body: Record<string, unknown>
  ) => {
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000)
      });
      const data: unknown = await response.json();
      if (!response.ok) throw Error('Unaccepted');
      return z.object({ ok: z.literal(true), result: z.unknown() }).parse(data).result;
    } catch {
      throw Error('Private learner review transport unavailable');
    }
  };
  const message = (recipient: string, text: string) => ({
    chat_id: subjectSchema.parse(recipient),
    text: z.string().min(1).max(4096).parse(text),
    link_preview_options: { is_disabled: true }
    // Intentionally no parse_mode; applicant input and reasons are plain text.
  });
  return {
    async send(recipient, text, buttons, forceReply) {
      const result = await call('sendMessage', {
        ...message(recipient, text),
        reply_markup: forceReply
          ? { force_reply: true, selective: true }
          : { inline_keyboard: buttons ?? [] }
      });
      const accepted = originalMessage.safeParse(result);
      if (
        !accepted.success ||
        String(accepted.data.chat.id) !== recipient ||
        String(accepted.data.from.id) !== botId
      )
        throw Error('Private learner review transport unavailable');
      return accepted.data.message_id;
    },
    async edit(recipient, messageId, text, buttons) {
      await call('editMessageText', {
        ...message(recipient, text),
        message_id: positive.parse(messageId),
        reply_markup: { inline_keyboard: buttons }
      });
    },
    async answer(callbackId, text) {
      await call('answerCallbackQuery', { callback_query_id: callbackId, text, cache_time: 0 });
    }
  };
};
const actions = {
  a: 'approve',
  d: 'deny',
  c: 'cancel',
  y: 'confirm',
  i: 'incomplete',
  v: 'contact',
  t: 'custom'
} as const;
export const learnerReviewCallback = (token: string, action: keyof typeof actions) =>
  `lr:${opaqueSchema.parse(token)}:${action}`;
const reviewView = (state: z.infer<typeof stateSchema>, token: string) => {
  const en = state.locale === 'en';
  const text = (english: string, chinese: string) =>
    en ? english : uiText(state.locale ?? 'zh_TW', chinese);
  const button = (key: keyof typeof actions, english: string, chinese: string) => ({
    text: text(english, chinese),
    callback_data: learnerReviewCallback(token, key)
  });
  const cancel = button('c', 'Cancel', '取消');
  switch (state.state) {
    case 'ready':
      return {
        text: text(
          'Learner application: review cancelled; no decision made. Review this notification’s applicant in the secure admin portal if unsure.',
          '學員申請：已取消本次操作，尚未決定。如不確定此通知的申請人，請至安全後台確認。'
        ),
        buttons: [[button('a', 'Approve', '通過'), button('d', 'Deny', '拒絕')]]
      };
    case 'deny':
      return {
        text: text(
          'Choose a denial reason for this learner application, or enter your own. No decision yet.',
          '請為此學員申請選擇拒絕理由，或自行輸入。尚未送出決定。'
        ),
        buttons: [
          [button('i', 'Incomplete information', '資料不完整')],
          [button('v', 'Cannot verify contact', '無法確認聯絡資料')],
          [button('t', 'Enter a reason', '輸入其他理由')],
          [cancel]
        ]
      };
    case 'input':
      return {
        text: text(
          'Reply only to the separate reason prompt (1–500 characters). Commands and other conversations are not reasons. No decision yet.',
          '請僅回覆另送出的理由提示（1–500 字）。指令與其他對話不會作為理由。尚未送出決定。'
        ),
        buttons: [[cancel]]
      };
    case 'confirm_approve':
      return {
        text: text(
          'Confirm APPROVAL of the learner application from this notification? This creates a new learner identity; it does not merge matching contacts. No decision until you confirm.',
          '再次確認：通過此通知的學員申請？這會建立新學員身分，不會依相同聯絡資料合併帳號。按確認後才會決定。'
        ),
        buttons: [[button('y', 'Confirm approval', '確認通過')], [cancel]]
      };
    case 'confirm_deny':
      return {
        text:
          text(
            'Confirm DENIAL of the learner application from this notification? Reason:\n',
            '再次確認：拒絕此通知的學員申請？理由：\n'
          ) + (state.reason ?? ''),
        buttons: [[button('y', 'Confirm denial', '確認拒絕')], [cancel]]
      };
    case 'decided':
      return {
        text: text(
          'Decision recorded. The normal applicant result notification is queued.',
          '決定已記錄，申請人的一般結果通知已排入佇列。'
        ),
        buttons: []
      };
    default:
      return {
        text: text(
          'This review is no longer current. Use the secure admin portal.',
          '此審核已失效或資料已更新，請至安全後台確認。'
        ),
        buttons: []
      };
  }
};

// Single-line plain text; do not let self-reported text impersonate field labels.
export const learnerReviewPlainField = (value: string) =>
  JSON.stringify(
    Array.from(value, (character) => {
      const point = character.codePointAt(0) ?? 0;
      return point < 32 ||
        (point >= 127 && point <= 159) ||
        (point >= 0x202a && point <= 0x202e) ||
        (point >= 0x2066 && point <= 0x2069)
        ? ' '
        : character;
    }).join('')
  );

const applicantLabel = (state: z.infer<typeof stateSchema>) =>
  state.applicant
    ? (state.locale === 'en'
        ? 'Self-reported name: '
        : uiText(state.locale ?? 'zh_TW', '自行填寫姓名：')) +
      learnerReviewPlainField(state.applicant.name) +
      '\n' +
      state.applicant.platform.toUpperCase() +
      (state.locale === 'en'
        ? ' verified source system ID (not a chosen handle): '
        : uiText(state.locale ?? 'zh_TW', ' 已驗證來源系統 ID（不是自選帳號）：')) +
      state.applicant.sourceId +
      '\n\n'
    : '';
export const learnerReviewView = (state: z.infer<typeof stateSchema>, token: string) => {
  const view = reviewView(state, token);
  return { ...view, text: applicantLabel(state) + view.text };
};

/** Called ONLY after webhook-secret authentication, before message-only routing.
 * DB calls never accept a callback-supplied principal/application identifier.
 * Every network operation occurs after the request transaction commits.
 */
export const handleTelegramLearnerReview = async (
  pool: Pool,
  requestId: string,
  update: unknown,
  botId: string,
  transport: TelegramReviewTransport
): Promise<boolean> => {
  const envelope = z
    .object({
      update_id: z.number().int().nonnegative().safe(),
      callback_query: z.unknown().optional(),
      message: z.unknown().optional()
    })
    .safeParse(update);
  if (!envelope.success) return false;
  const query = async (sql: string, values: unknown[]) =>
    stateSchema.parse(
      (
        await withRequestContext(pool, 'qigong_api_runtime', { requestId }, (c) =>
          c.query<{ data: unknown }>(sql, values)
        )
      ).rows[0]?.data
    );
  if (envelope.data.callback_query !== undefined) {
    const parsed = callbackSchema.safeParse(envelope.data.callback_query);
    if (!parsed.success) return true;
    const callback = parsed.data;
    if (callback.message.chat.id !== callback.from.id || String(callback.message.from.id) !== botId)
      return true;
    const match = /^lr:([A-Za-z0-9_-]{43}):([adcyivt])$/.exec(callback.data);
    if (!match) return true;
    const token = randomBytes(32).toString('base64url');
    const subject = String(callback.from.id);
    const result = await query(
      'SELECT platform.telegram_learner_review_action($1,$2,$3,$4,$5) data',
      [
        subject,
        callback.message.message_id,
        match[1],
        actions[match[2] as keyof typeof actions],
        token
      ]
    );
    if (result.state !== 'unavailable') {
      const view = learnerReviewView(result, token);
      try {
        await transport.edit(subject, callback.message.message_id, view.text, view.buttons);
      } catch {
        /* Never replay a committed decision on an outbound failure. */
      }
      if (result.state === 'input') {
        try {
          const prompt = await transport.send(
            subject,
            applicantLabel(result) +
              (result.locale === 'en'
                ? 'Denial reason for the application in the preceding review notification: reply to THIS message only (1–500 characters). Do not send a command. You will confirm before submission.'
                : uiText(
                    result.locale ?? 'zh_TW',
                    '此審核通知的拒絕理由：請僅回覆「本訊息」（1–500 字），不要傳送指令。之後仍須再次確認才送出。'
                  )),
            undefined,
            true
          );
          await withRequestContext(pool, 'qigong_api_runtime', { requestId }, (c) =>
            c.query('SELECT platform.telegram_learner_review_prompt($1,$2,$3,$4)', [
              subject,
              callback.message.message_id,
              token,
              prompt
            ])
          );
        } catch {
          /* Missing/ambiguous prompt stays unusable; cancel or use WebAdmin. */
        }
      }
    }
    try {
      await transport.answer(
        callback.id,
        result.state === 'decided'
          ? 'Decision recorded / 決定已記錄'
          : result.state === 'unavailable'
            ? 'Review unavailable / 審核已失效'
            : 'Review updated / 審核已更新'
      );
    } catch {
      /* Acknowledgement is not a business transaction. */
    }
    return true;
  }
  const parsed = replySchema.safeParse(envelope.data.message);
  if (!parsed.success) return false;
  const message = parsed.data;
  const age = Date.now() / 1000 - message.date;
  if (
    message.chat.id !== message.from.id ||
    message.reply_to_message.chat.id !== message.chat.id ||
    String(message.reply_to_message.from.id) !== botId ||
    age < -60 ||
    age >= 86400 ||
    message.text.startsWith('/') ||
    isHelpCommand(message.text) ||
    /^(?:隱私|隐私|條款|条款)$/.test(message.text) ||
    message.entities?.some((entity) => entity.type === 'bot_command')
  )
    return false;
  const token = randomBytes(32).toString('base64url');
  const result = await query('SELECT platform.telegram_learner_review_reason($1,$2,$3,$4) data', [
    String(message.from.id),
    message.reply_to_message.message_id,
    message.text,
    token
  ]);
  if (result.state === 'unavailable' || result.messageId === undefined) return false;
  const view = learnerReviewView(result, token);
  try {
    await transport.edit(String(message.from.id), result.messageId, view.text, view.buttons);
  } catch {
    /* Already saved; old buttons cannot cause a decision. */
  }
  return true;
};
