import { z } from 'zod';
export interface VerifiedLineIdentity {
  subject: string;
  displayName?: string;
}
const name = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .refine((value) => [...value].every((c) => (c.codePointAt(0) ?? 0) >= 32));
export const verifiedLineIdentitySchema = z
  .object({ subject: z.string().regex(/^U[0-9a-f]{32}$/), displayName: name.optional() })
  .strict();
export const verifyLineIdentity = async (
  idToken: string,
  channelId: string
): Promise<VerifiedLineIdentity> => {
  try {
    const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw Error('Unaccepted identity');
    const claims = z
      .object({
        sub: z.string().regex(/^U[0-9a-f]{32}$/),
        aud: z.string(),
        exp: z.number(),
        iss: z.literal('https://access.line.me'),
        name: z.unknown().optional()
      })
      .parse(await response.json());
    if (
      claims.aud !== channelId ||
      claims.exp <= Date.now() / 1000 ||
      claims.iss !== 'https://access.line.me'
    )
      throw Error('Invalid identity');
    const display = name.safeParse(claims.name);
    return { subject: claims.sub, ...(display.success ? { displayName: display.data } : {}) };
  } catch {
    throw new Error('LINE ID token verification failed');
  }
};
