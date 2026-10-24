import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestContext, type Pool, type PoolClient } from '@qigong/database';
import { z } from 'zod';
import {
  channelInviteAvailable,
  channelInviteTransportUrl,
  invitePlatformSchema,
  type InviteTransports
} from './channel-invites.js';
import { renderAdminChannelInvites } from './admin-channel-invite-pages.js';
import { adminContentSecurityPolicy } from './admin-branding.js';
import { resolveAdminLocale } from './admin-locale.js';
const reason = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((v) =>
    [...v].every((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
  );
const createSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((v) =>
        [...v].every((c) => {
          const code = c.codePointAt(0) ?? 0;
          return code >= 32 && code !== 127;
        })
      ),
    region: z.enum(['tw-general', 'my-general', 'sg-general', 'hk-general', 'other-general']),
    days: z.number().int().min(1).max(30).default(7),
    maxUses: z.number().int().min(1).max(10000).default(1),
    reason
  })
  .strict();
export const registerAdminChannelInvites = (
  app: FastifyInstance,
  pool: Pool,
  transports: InviteTransports,
  principalFor: (request: FastifyRequest) => Promise<string | null>,
  validCsrf: (request: FastifyRequest) => boolean,
  sessionFor: (request: FastifyRequest) => string | undefined
): void => {
  const execute = <T>(
    principal: string,
    request: FastifyRequest,
    callback: (client: PoolClient, session: string) => Promise<T>
  ) =>
    withRequestContext(
      pool,
      'qigong_api_runtime',
      { principalId: principal, requestId: request.id },
      async (client) => {
        const session = sessionFor(request);
        if (!session || !(await channelInviteAvailable(client)))
          throw Error('channel invite management denied');
        const result = await callback(client, session);
        if (
          (
            await client.query<{ allowed: boolean }>(
              'SELECT admin.channel_invite_session_current($1) allowed',
              [session]
            )
          ).rows[0]?.allowed !== true
        )
          throw Error('channel invite management denied');
        return result;
      }
    );
  const fail = (error: unknown) => {
    const m = error instanceof Error ? error.message : '';
    return m === 'channel invite management denied'
      ? { status: 403, code: 'channel_invite_management_denied' }
      : m === 'channel invite conflict'
        ? { status: 409, code: 'channel_invite_conflict' }
        : m.startsWith('invalid channel invite')
          ? { status: 400, code: 'invalid_channel_invite' }
          : { status: 503, code: 'channel_invite_unavailable' };
  };
  app.get('/admin/api/channel-invites/capabilities', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    try {
      const canManage = await execute(
        principal,
        request,
        async (client, session) =>
          (
            await client.query<{ allowed: boolean }>(
              'SELECT admin.channel_invite_session_current($1) allowed',
              [session]
            )
          ).rows[0]?.allowed === true
      );
      return { canManage };
    } catch {
      return { canManage: false };
    }
  });
  app.get('/admin/channel-invites', async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    const principal = await principalFor(request);
    if (!principal) return reply.redirect('/admin/auth/login');
    try {
      await execute(principal, request, () => Promise.resolve(true));
    } catch {
      return reply.code(403).send({ error: 'channel_invite_management_denied' });
    }
    return reply
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', adminContentSecurityPolicy)
      .type('text/html; charset=utf-8')
      .send(renderAdminChannelInvites(resolveAdminLocale(request.query, request.headers.cookie)));
  });
  app.get('/admin/api/channel-invites/:platform', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    const params = z.object({ platform: invitePlatformSchema }).strict().safeParse(request.params),
      query = z
        .object({ page: z.coerce.number().int().min(1).max(100000).default(1) })
        .strict()
        .safeParse(request.query);
    if (!params.success || !query.success)
      return reply.code(400).send({ error: 'invalid_channel_invite' });
    try {
      return await execute(principal, request, async (client, session) => {
        const data = z
          .object({
            items: z.array(
              z.object({
                id: z.uuid(),
                label: z.string(),
                region: z.string(),
                expiresAt: z.string(),
                maxUses: z.number().int(),
                uses: z.number().int(),
                revision: z.number().int(),
                revoked: z.boolean(),
                issuerActive: z.boolean()
              })
            ),
            page: z.number().int(),
            total: z.number().int(),
            regions: z.array(z.object({ code: z.string(), name: z.string() }))
          })
          .parse(
            (
              await client.query<{ data: unknown }>(
                'SELECT admin.channel_invite_list($1,$2,$3) data',
                [params.data.platform, query.data.page, session]
              )
            ).rows[0]?.data
          );
        return {
          ...data,
          configured:
            channelInviteTransportUrl(
              params.data.platform,
              transports[params.data.platform],
              'x'.repeat(43)
            ) !== null
        };
      });
    } catch (error) {
      const f = fail(error);
      return reply.code(f.status).send({ error: f.code });
    }
  });
  app.post('/admin/api/channel-invites/:platform', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    if (
      request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
      !request.headers['content-type']?.startsWith('application/json') ||
      !validCsrf(request)
    )
      return reply.code(403).send({ error: 'invalid_csrf' });
    const params = z.object({ platform: invitePlatformSchema }).strict().safeParse(request.params),
      body = createSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_channel_invite' });
    const platform = params.data.platform,
      token = randomBytes(32).toString('base64url');
    if (!channelInviteTransportUrl(platform, transports[platform], token))
      return reply.code(409).send({ error: 'invite_transport_unconfigured' });
    try {
      const data = await execute(principal, request, async (client, session) =>
        z
          .object({
            id: z.uuid(),
            revision: z.number().int(),
            expiresAt: z.string(),
            maxUses: z.number().int(),
            platform: invitePlatformSchema
          })
          .parse(
            (
              await client.query<{ data: unknown }>(
                'SELECT admin.create_channel_invite($1,$2,$3,$4,$5,$6,$7,$8) data',
                [
                  platform,
                  token,
                  body.data.label,
                  body.data.region,
                  new Date(Date.now() + body.data.days * 86400000).toISOString(),
                  body.data.maxUses,
                  body.data.reason,
                  session
                ]
              )
            ).rows[0]?.data
          )
      );
      return reply
        .code(201)
        .send({ ...data, url: 'https://checkin.baiyinqigong.org/' + platform + '/join#' + token });
    } catch (error) {
      const f = fail(error);
      return reply.code(f.status).send({ error: f.code });
    }
  });
  app.post(
    '/admin/api/channel-invites/:platform/:id/revoke',
    { bodyLimit: 4096 },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const principal = await principalFor(request);
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
      if (
        request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
        !request.headers['content-type']?.startsWith('application/json') ||
        !validCsrf(request)
      )
        return reply.code(403).send({ error: 'invalid_csrf' });
      const params = z
          .object({ platform: invitePlatformSchema, id: z.uuid() })
          .strict()
          .safeParse(request.params),
        body = z
          .object({ version: z.number().int().min(1).max(2147483647), reason })
          .strict()
          .safeParse(request.body);
      if (!params.success || !body.success)
        return reply.code(400).send({ error: 'invalid_channel_invite' });
      try {
        return await execute(principal, request, async (client, session) =>
          z
            .object({ revoked: z.literal(true), revision: z.number().int() })
            .parse(
              (
                await client.query<{ data: unknown }>(
                  'SELECT admin.revoke_channel_invite($1,$2,$3,$4,$5) data',
                  [
                    params.data.platform,
                    params.data.id,
                    body.data.version,
                    body.data.reason,
                    session
                  ]
                )
              ).rows[0]?.data
            )
        );
      } catch (error) {
        const f = fail(error);
        return reply.code(f.status).send({ error: f.code });
      }
    }
  );
};
