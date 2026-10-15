import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { resolveLocale } from './ui-localization.js';
import { renderLineInvitePage } from './line-invite-page.js';
import { beginLearnerPrivacy } from './learner-privacy-routes.js';
import { getLineInviteContinuation, lineInviteResumeToken } from './line-invite-continuation.js';
export interface LineInviteConfig {
  liffId: string;
  loginChannelId: string;
  privacySecret: string;
  verifyIdToken: (token: string) => Promise<string>;
  verifyFriendship?: (token: string, subject: string) => Promise<boolean>;
}
export const verifyLineFriendship = async (
  accessToken: string,
  subject: string,
  channel: string
) => {
  try {
    const verified = await fetch(
      'https://api.line.me/oauth2/v2.1/verify?' +
        new URLSearchParams({ access_token: accessToken }).toString(),
      { signal: AbortSignal.timeout(5000) }
    );
    if (!verified.ok) throw Error('Unverified access token');
    const auth = z
      .object({ client_id: z.string(), expires_in: z.number().positive() })
      .parse(await verified.json());
    if (auth.client_id !== channel) throw Error('Wrong client');
    const headers = { authorization: 'Bearer ' + accessToken };
    const profile = await fetch('https://api.line.me/v2/profile', {
      headers,
      signal: AbortSignal.timeout(5000)
    });
    if (!profile.ok) throw Error('Profile unavailable');
    if (
      z.object({ userId: z.string().regex(/^U[0-9a-f]{32}$/) }).parse(await profile.json())
        .userId !== subject
    )
      throw Error('Wrong subject');
    const friendship = await fetch('https://api.line.me/friendship/v1/status', {
      headers,
      signal: AbortSignal.timeout(5000)
    });
    if (!friendship.ok) throw Error('Friendship unavailable');
    return z.object({ friendFlag: z.boolean() }).parse(await friendship.json()).friendFlag;
  } catch {
    throw new Error('LINE friendship verification unavailable');
  }
};
const subject = z.string().regex(/^U[0-9a-f]{32}$/),
  opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const credentials = z.object({
  idToken: z.string().min(1).max(4096),
  accessToken: z.string().min(1).max(4096).optional(),
  token: opaque.optional()
});
const stateSchema = z.object({
  status: z.enum(['approved', 'privacy', 'form', 'pending', 'blocked', 'invalid']),
  region: z.string().optional(),
  regionName: z.string().optional(),
  pendingApplication: z.boolean().optional()
});
export const registerLineInvites = (app: FastifyInstance, pool: Pool, config: LineInviteConfig) => {
  const verifyFriend =
    config.verifyFriendship ??
    ((token: string, uid: string) => verifyLineFriendship(token, uid, config.loginChannelId));
  const query = <Row extends Record<string, unknown>>(
    requestId: string,
    sql: string,
    values: unknown[]
  ) =>
    withRequestContext(pool, 'qigong_api_runtime', { requestId }, (c) => c.query<Row>(sql, values));
  const identify = async (token: string) => {
    try {
      return subject.parse(await config.verifyIdToken(token));
    } catch {
      return null;
    }
  };
  app.get('/line/invite', async (request, reply) =>
    reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header(
        'content-security-policy',
        "default-src 'none'; script-src 'unsafe-inline' https://static.line-scdn.net; style-src 'unsafe-inline'; connect-src 'self' https://api.line.me https://access.line.me; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      )
      .type('text/html; charset=utf-8')
      .send(
        renderLineInvitePage(config.liffId, resolveLocale(request.query, request.headers.cookie))
      )
  );
  for (const action of ['status', 'redeem'] as const)
    app.post('/line/invite/' + action, { bodyLimit: 8192 }, async (request, reply) => {
      reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
      if (
        request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
        !request.headers['content-type']?.startsWith('application/json')
      )
        return reply.code(403).send({ error: 'invalid_origin' });
      const schema =
        action === 'status'
          ? credentials.strict()
          : credentials
              .extend({
                name: z.string().trim().min(1).max(150),
                email: z.email().max(254),
                phone: z.string().regex(/^\+[1-9][0-9]{6,14}$/)
              })
              .strict();
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_invite_details' });
      const uid = await identify(parsed.data.idToken);
      if (!uid) return reply.code(401).send({ error: 'invalid_line_identity' });
      try {
        // Missing fragments may result from LIFF cleanup/reload. Resume only this verified subject.
        const inviteToken =
          parsed.data.token ??
          (await getLineInviteContinuation(pool, request.id, uid, config.privacySecret));
        const state = stateSchema.parse(
          (
            await query<{ data: unknown }>(
              request.id,
              'SELECT platform.line_invite_state($1,$2) data',
              [uid, inviteToken ?? null]
            )
          ).rows[0]?.data
        );
        if (state.status === 'approved') return { status: 'approved', alreadyMember: true };
        if (!['form', 'privacy'].includes(state.status))
          return action === 'status'
            ? state
            : reply.code(403).send({ error: 'line_invite_unavailable' });
        let resumeToken: string | undefined;
        if (action === 'status' && state.region && inviteToken) {
          const nonce = randomUUID();
          const remembered = await query<{ nonce: string }>(
            request.id,
            'SELECT platform.remember_line_invite($1,$2,$3,$4) nonce',
            [uid, inviteToken, nonce, lineInviteResumeToken(config.privacySecret, uid, nonce)]
          );
          const confirmedNonce = z.uuid().parse(remembered.rows[0]?.nonce);
          resumeToken = lineInviteResumeToken(config.privacySecret, uid, confirmedNonce);
          if (confirmedNonce !== nonce) {
            // Preserve stable continuation links, including after an approved signing-key rotation.
            await query(request.id, 'SELECT platform.remember_line_invite($1,$2,$3,$4)', [
              uid,
              inviteToken,
              confirmedNonce,
              resumeToken
            ]);
          }
        }
        // Save the subject-bound continuation before exposing the add-friend link.
        // All new/pending approvals still require matching access token and server friendship.
        if (state.region) {
          if (!parsed.data.accessToken)
            return reply.code(401).send({ error: 'invalid_line_identity' });
          if (!(await verifyFriend(parsed.data.accessToken, uid)))
            return action === 'status'
              ? { status: 'friend', resumeToken }
              : reply.code(403).send({ error: 'line_friendship_required' });
        }
        if (state.status === 'privacy') {
          if (action === 'redeem')
            return reply.code(403).send({ error: 'privacy_acceptance_required' });
          const token = createHmac('sha256', config.privacySecret)
            .update('line-invite-privacy:' + uid + ':' + Math.floor(Date.now() / 300000))
            .digest('base64url');
          const privacy = await withRequestContext(
            pool,
            'qigong_api_runtime',
            { requestId: request.id },
            (c) => beginLearnerPrivacy(c, 'line', uid, token)
          );
          if (privacy.unavailable) return { status: 'blocked' };
          return {
            status: 'privacy',
            resumeToken,
            privacy: { token, version: privacy.version, hash: privacy.hash }
          };
        }
        if (action === 'status') return { ...state, resumeToken };
        const data = z
          .object({ name: z.string(), email: z.string(), phone: z.string() })
          .parse(parsed.data);
        const result = await query<{ data: unknown }>(
          request.id,
          'SELECT platform.redeem_line_invite($1,$2,$3,$4,$5) data',
          [uid, inviteToken ?? null, data.name, data.email, data.phone]
        );
        return z
          .object({ status: z.literal('approved'), alreadyMember: z.boolean() })
          .parse(result.rows[0]?.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'LINE friendship verification unavailable')
          return reply.code(503).send({ error: 'line_friendship_unavailable' });
        if (message === 'privacy acceptance required')
          return reply.code(403).send({ error: 'privacy_acceptance_required' });
        if (message === 'line invite unavailable')
          return reply.code(409).send({ error: 'line_invite_unavailable' });
        if (message.startsWith('invalid line invite'))
          return reply.code(400).send({ error: 'invalid_invite_details' });
        app.log.error({ requestId: request.id }, 'LINE invite processing failed');
        return reply.code(503).send({ error: 'line_invite_service_unavailable' });
      }
    });
};
