import type { FastifyInstance } from 'fastify';
import { withRequestContext, type Pool, type PoolClient } from '@qigong/database';
import { z } from 'zod';
import { learnerLocale, type LearnerLocale } from './learner-locale.js';
import {
  learnerPrivacyHash,
  learnerPrivacyVersion,
  learnerPrivacyContact
} from './learner-privacy-policy.js';
import { learnerPrivacyTexts } from './learner-privacy-locale.js';
import { renderLearnerPrivacyPage } from './learner-privacy-pages.js';
export const privacyPlatform = z.enum(['telegram', 'line', 'whatsapp']);
export type PrivacyPlatform = z.infer<typeof privacyPlatform>;
export const privacyNoticeSchema = z.object({
  version: z.string(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  active: z.boolean()
});
const privacyGateSchema = z.object({
  active: z.boolean(),
  required: z.boolean(),
  unavailable: z.boolean(),
  reflectionConsent: z.boolean(),
  version: z.string().nullable(),
  hash: z.string().nullable()
});
export const beginLearnerPrivacy = async (
  client: PoolClient,
  platform: PrivacyPlatform,
  subject: string,
  token: string
) =>
  privacyGateSchema.parse(
    (
      await client.query<{ data: unknown }>('SELECT platform.begin_privacy_gate($1,$2,$3) data', [
        platform,
        subject,
        token
      ])
    ).rows[0]?.data
  );
export const learnerPrivacyReply = (
  state: z.infer<typeof privacyGateSchema>,
  platform: PrivacyPlatform,
  token: string,
  locale: LearnerLocale,
  force = false
): string | null => {
  const t = learnerPrivacyTexts(locale);
  if (state.unavailable)
    return t.suspended + '\n' + learnerPrivacyContact.name + ' ' + learnerPrivacyContact.email;
  if (!state.required && !force) return null;
  return (
    (state.active ? t.privacyRequired : t.draft) +
    '\n' +
    t.privacyLink +
    '\nhttps://checkin.baiyinqigong.org/privacy?platform=' +
    platform +
    '&lang=' +
    locale +
    '#' +
    token
  );
};
export const isLearnerPrivacyError = (e: unknown): boolean =>
  e instanceof Error &&
  /^(privacy (acceptance required|credential unavailable|session unavailable)|reflection consent required|learner eligibility unavailable)$/.test(
    e.message
  );
export const registerLearnerPrivacyRoutes = (app: FastifyInstance, pool: Pool) => {
  const notice = async (requestId: string) =>
    privacyNoticeSchema.parse(
      (
        await withRequestContext(pool, 'qigong_api_runtime', { requestId }, (c) =>
          c.query<{ data: unknown }>('SELECT platform.privacy_notice() data')
        )
      ).rows[0]?.data
    );
  app.get('/learner/privacy/notice', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      return await notice(request.id);
    } catch {
      return reply.code(503).send({ error: 'privacy_unavailable' });
    }
  });
  app.get('/privacy', async (request, reply) => {
    reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff');
    const input = z
      .object({
        lang: z.enum(['zh_TW', 'en']).default('zh_TW'),
        platform: privacyPlatform.default('telegram')
      })
      .strict()
      .safeParse(request.query);
    if (!input.success) return reply.code(400).send({ error: 'invalid_privacy_query' });
    try {
      const current = await notice(request.id);
      if (current.hash !== learnerPrivacyHash || current.version !== learnerPrivacyVersion)
        return reply.code(503).send({ error: 'privacy_document_mismatch' });
      return reply
        .header(
          'content-security-policy',
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org"
        )
        .type('text/html; charset=utf-8')
        .send(
          renderLearnerPrivacyPage(
            learnerLocale(input.data.lang),
            input.data.platform,
            current.active
          )
        );
    } catch {
      return reply.code(503).send({ error: 'privacy_unavailable' });
    }
  });
  app.post('/learner/privacy/accept', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    if (
      request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
      !request.headers['content-type']?.startsWith('application/json')
    )
      return reply.code(403).send({ error: 'invalid_origin' });
    const input = z
      .object({
        platform: privacyPlatform,
        token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        version: z.string().min(1).max(100),
        hash: z.string().regex(/^[0-9a-f]{64}$/),
        locale: z.enum(['zh_TW', 'en']),
        accepted: z.literal(true),
        reflectionConsent: z.boolean()
      })
      .strict()
      .safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_privacy_acceptance' });
    const v = input.data;
    if (v.version !== learnerPrivacyVersion || v.hash !== learnerPrivacyHash)
      return reply.code(409).send({ error: 'privacy_policy_conflict' });
    try {
      return z
        .object({ accepted: z.literal(true), version: z.string(), reflectionConsent: z.boolean() })
        .parse(
          (
            await withRequestContext(pool, 'qigong_api_runtime', { requestId: request.id }, (c) =>
              c.query<{ data: unknown }>(
                'SELECT platform.accept_privacy($1,$2,$3,$4,$5,$6,$7) data',
                [v.platform, v.token, v.version, v.hash, v.locale, v.accepted, v.reflectionConsent]
              )
            )
          ).rows[0]?.data
        );
    } catch (e) {
      if (isLearnerPrivacyError(e))
        return reply.code(403).send({ error: 'privacy_acceptance_unavailable' });
      if (e instanceof Error && e.message === 'privacy policy conflict')
        return reply.code(409).send({ error: 'privacy_policy_conflict' });
      return reply.code(503).send({ error: 'privacy_unavailable' });
    }
  });
};
