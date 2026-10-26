import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { channelInviteAvailable, type InvitePlatform } from './channel-invites.js';
import { renderChannelInvitePage } from './channel-invite-pages.js';
import { beginLearnerPrivacy, isLearnerPrivacyError } from './learner-privacy-routes.js';
import { localeSchema, resolveLocale } from './ui-localization.js';

const credential = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  locale: localeSchema
});
const details = credential
  .extend({
    name: z
      .string()
      .trim()
      .min(1)
      .max(150)
      .refine((v) =>
        [...v].every((c) => {
          const code = c.codePointAt(0) ?? 0;
          return code >= 32 && code !== 127;
        })
      ),
    email: z.email().max(254),
    phone: z.string().regex(/^\+[1-9][0-9]{6,14}$/),
    notificationConsent: z.boolean()
  })
  .strict();
const stateSchema = z.object({
  status: z.enum(['approved', 'privacy', 'form', 'blocked', 'invalid']),
  alreadyMember: z.boolean().optional(),
  pendingApplication: z.boolean().optional(),
  region: z.string().optional(),
  regionName: z.string().nullable().optional()
});
const resultSchema = z.object({ status: z.literal('approved'), alreadyMember: z.boolean() });
const csp =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const registerChannelInvitePages = (
  app: FastifyInstance,
  pool: Pool,
  platform: InvitePlatform,
  secret: string,
  target?: string
): void => {
  for (const kind of ['join', 'invite'] as const)
    app.get('/' + platform + '/' + kind, (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', csp)
        .type('text/html; charset=utf-8')
        .send(
          renderChannelInvitePage(
            platform,
            resolveLocale(request.query, request.headers.cookie),
            kind === 'join',
            target
          )
        )
    );
  for (const action of ['status', 'redeem'] as const)
    app.post('/' + platform + '/invite/' + action, { bodyLimit: 8192 }, async (request, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff');
      if (
        request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
        !request.headers['content-type']?.startsWith('application/json')
      )
        return reply.code(403).send({ error: 'invalid_invite_origin' });
      const parsed =
        action === 'status'
          ? credential.strict().safeParse(request.body)
          : details.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_invite_details' });
      if (
        action === 'redeem' &&
        platform === 'whatsapp' &&
        (!('notificationConsent' in parsed.data) || parsed.data.notificationConsent !== true)
      )
        return reply.code(400).send({ error: 'invalid_invite_details' });
      try {
        const data = parsed.data;
        const result = await withRequestContext(
          pool,
          'qigong_api_runtime',
          { requestId: request.id },
          async (client) => {
            if (!(await channelInviteAvailable(client))) throw Error('channel invite unavailable');
            if (action === 'redeem') {
              const submitted = details.parse(data);
              return resultSchema.parse(
                (
                  await client.query<{ data: unknown }>(
                    'SELECT platform.redeem_channel_invite($1,$2,$3,$4,$5,$6,$7) data',
                    [
                      platform,
                      data.token,
                      submitted.name,
                      submitted.email,
                      submitted.phone,
                      submitted.locale,
                      submitted.notificationConsent
                    ]
                  )
                ).rows[0]?.data
              );
            }
            const state = stateSchema.parse(
              (
                await client.query<{ data: unknown }>(
                  'SELECT platform.channel_invite_form_state($1,$2,$3) data',
                  [platform, data.token, data.locale]
                )
              ).rows[0]?.data
            );
            if (state.status !== 'privacy') return state;
            const subject = z
              .string()
              .regex(/^[0-9]{1,20}$/)
              .parse(
                (
                  await client.query<{ subject: unknown }>(
                    'SELECT platform.channel_invite_form_subject($1,$2) subject',
                    [platform, data.token]
                  )
                ).rows[0]?.subject
              );
            const token = createHmac('sha256', secret)
              .update('channel-invite-privacy:v1:' + platform + ':' + subject + ':' + data.token)
              .digest('base64url');
            const privacy = await beginLearnerPrivacy(client, platform, subject, token);
            if (privacy.unavailable || !privacy.version || !privacy.hash)
              throw Error('channel invite unavailable');
            return { ...state, privacy: { token, version: privacy.version, hash: privacy.hash } };
          }
        );
        return result;
      } catch (error) {
        if (isLearnerPrivacyError(error))
          return reply.code(403).send({ error: 'privacy_acceptance_required' });
        const message = error instanceof Error ? error.message : '';
        if (message === 'channel invite unavailable')
          return reply.code(409).send({ error: 'channel_invite_unavailable' });
        if (message.startsWith('invalid channel invite'))
          return reply.code(400).send({ error: 'invalid_invite_details' });
        request.log.warn({ event: 'channel_invite_unavailable' });
        return reply.code(503).send({ error: 'channel_invite_unavailable' });
      }
    });
};
