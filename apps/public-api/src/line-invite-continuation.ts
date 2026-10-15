import { createHmac } from 'node:crypto';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';

export const lineInviteResumeToken = (secret: string, subject: string, nonce: string) =>
  createHmac('sha256', secret)
    .update('line-invite-resume:v1:' + subject + ':' + nonce)
    .digest('base64url');

export const getLineInviteContinuation = async (
  pool: Pool,
  requestId: string,
  subject: string,
  secret: string
): Promise<string | undefined> => {
  const result = await withRequestContext(pool, 'qigong_api_runtime', { requestId }, (client) =>
    client.query<{ nonce: string | null }>('SELECT platform.line_invite_continuation($1) nonce', [
      subject
    ])
  );
  const nonce = result.rows[0]?.nonce;
  return nonce ? lineInviteResumeToken(secret, subject, z.uuid().parse(nonce)) : undefined;
};
