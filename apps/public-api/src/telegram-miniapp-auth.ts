import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { beginLearnerPrivacy } from './learner-privacy-routes.js';
export const verifyTelegramMiniapp = (
  raw: string,
  botToken: string,
  now = Math.floor(Date.now() / 1000)
): { subject: string; authDate: number } => {
  if (!raw || raw.length > 16000) throw Error('Invalid Telegram Mini App proof');
  const fields = new URLSearchParams(raw),
    seen = new Set<string>();
  for (const [key] of fields) {
    if (seen.has(key)) throw Error('Invalid Telegram Mini App proof');
    seen.add(key);
  }
  const hash = fields.get('hash') ?? '',
    date = fields.get('auth_date') ?? '';
  if (!/^[0-9a-f]{64}$/i.test(hash) || !/^\d+$/.test(date))
    throw Error('Invalid Telegram Mini App proof');
  const authDate = Number(date);
  if (!Number.isSafeInteger(authDate) || authDate > now + 60 || now - authDate > 3600)
    throw Error('Expired Telegram Mini App proof');
  const check = [...fields]
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => k + '=' + v)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest(),
    expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex')))
    throw Error('Invalid Telegram Mini App proof');
  let user: unknown;
  try {
    user = JSON.parse(fields.get('user') ?? '');
  } catch {
    throw Error('Invalid Telegram Mini App user');
  }
  const parsed = z
    .object({ id: z.number().int().positive().safe(), is_bot: z.boolean().optional() })
    .safeParse(user);
  if (!parsed.success || parsed.data.is_bot) throw Error('Invalid Telegram Mini App user');
  return { subject: String(parsed.data.id), authDate };
};
export const registerTelegramMiniapp = (app: FastifyInstance, pool: Pool, botToken: string) => {
  app.post('/telegram/workspace/session', { bodyLimit: 20000 }, async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    if (
      request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
      !request.headers['content-type']?.startsWith('application/json')
    )
      return reply.code(403).send({ error: 'invalid_origin' });
    const input = z
      .object({
        initData: z.string().min(1).max(16000),
        locale: z.enum(['zh_TW', 'en']).default('zh_TW')
      })
      .strict()
      .safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_miniapp_request' });
    let subject: string;
    try {
      subject = verifyTelegramMiniapp(input.data.initData, botToken).subject;
    } catch {
      return reply.code(401).send({ error: 'invalid_miniapp_proof' });
    }
    try {
      return await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId: request.id },
        async (client) => {
          const privacyToken = randomBytes(32).toString('base64url'),
            state = await beginLearnerPrivacy(client, 'telegram', subject, privacyToken);
          if (state.unavailable)
            return reply.code(403).send({ error: 'workspace_access_unavailable' });
          if (state.required)
            return {
              status: 'consent_required',
              privacyUrl:
                '/privacy?platform=telegram&lang=' + input.data.locale + '#' + privacyToken
            };
          const token = randomBytes(32).toString('base64url'),
            result = await client.query<{ status: string }>(
              'SELECT platform.begin_telegram_miniapp_session($1,$2) status',
              [subject, token]
            );
          if (result.rows[0]?.status !== 'ready')
            return reply.code(403).send({ error: 'workspace_access_unavailable' });
          return { status: 'ready', token, expiresIn: 840 };
        }
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'Mini App exchange rate limited')
        return reply.header('retry-after', '60').code(429).send({ error: 'miniapp_rate_limited' });
      return reply.code(503).send({ error: 'miniapp_session_unavailable' });
    }
  });
};
