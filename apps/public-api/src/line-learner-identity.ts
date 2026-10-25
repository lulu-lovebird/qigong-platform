import {
  withRequestContext,
  resolveLineLearnerIdentity,
  type Pool,
  type PoolClient
} from '@qigong/database';
import { z } from 'zod';
import {
  verifiedLineIdentitySchema,
  verifyLineIdentity,
  type VerifiedLineIdentity
} from './line-profile.js';

const credentialSchema = z.object({ idToken: z.string().trim().min(1).max(4096) }).strict();
const learnerMappingSchema = z
  .object({
    subject: verifiedLineIdentitySchema.shape.subject,
    identityId: z.uuid(),
    personId: z.uuid(),
    revoked: z.boolean(),
    learnerActive: z.boolean(),
    channelActive: z.boolean(),
    applicationApproved: z.boolean()
  })
  .strict()
  .nullable();
const privacySchema = z.discriminatedUnion('active', [
  z.object({ active: z.literal(false), reflectionConsent: z.boolean() }).strict(),
  z
    .object({
      active: z.literal(true),
      required: z.boolean(),
      unavailable: z.boolean(),
      reflectionConsent: z.boolean(),
      version: z.string().min(1),
      hash: z.string().regex(/^[0-9a-f]{64}$/)
    })
    .strict()
]);

/**
 * Server-owned DB boundary, not request data. Must use an audited controlled
 * function on this runtime client, returning null for unknown subjects. There is
 * production resolver is the minimal 0049 controlled function. Do not substitute
 * privileged SQL, a report, or a new broad GRANT.
 */
export type LineLearnerResolver = (client: PoolClient, verifiedSubject: string) => Promise<unknown>;

export interface LineLearnerIdentityOptions {
  loginChannelId: string;
  resolveLearner?: LineLearnerResolver;
  verifyIdentity?: (idToken: string, channelId: string) => Promise<VerifiedLineIdentity>;
}

export type LineLearnerIdentityResult =
  | {
      readonly ok: true;
      readonly identity: {
        readonly platform: 'line';
        readonly subject: string;
        readonly identityId: string;
        readonly personId: string;
      };
      readonly privacy: {
        readonly active: boolean;
        readonly reflectionConsent: boolean;
        readonly version: string | null;
        readonly hash: string | null;
      };
    }
  | {
      readonly ok: false;
      readonly statusCode: 401 | 403 | 503;
      readonly error:
        | 'invalid_line_identity'
        | 'learner_identity_unavailable'
        | 'privacy_acceptance_required'
        | 'line_identity_unavailable';
    };

/** Identity snapshot only: not an attendance/volunteer authorization or reusable session. */
export const createLineLearnerIdentityAdapter = (
  pool: Pool,
  options: LineLearnerIdentityOptions
) => {
  const channelId = z.string().trim().min(1).max(100).parse(options.loginChannelId);
  const verify = options.verifyIdentity ?? verifyLineIdentity;
  return async (requestId: string, credential: unknown): Promise<LineLearnerIdentityResult> => {
    const input = credentialSchema.safeParse(credential);
    if (!input.success) return { ok: false, statusCode: 401, error: 'invalid_line_identity' };
    let subject: string;
    try {
      subject = verifiedLineIdentitySchema.parse(
        await verify(input.data.idToken, channelId)
      ).subject;
    } catch {
      return { ok: false, statusCode: 401, error: 'invalid_line_identity' };
    }
    try {
      // No caller-supplied person/principal context, and no pool.query bootstrap.
      return await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId },
        async (client): Promise<LineLearnerIdentityResult> => {
          const mapping = learnerMappingSchema.parse(
            await (options.resolveLearner ?? resolveLineLearnerIdentity)(client, subject)
          );
          if (
            !mapping ||
            mapping.subject !== subject ||
            mapping.revoked ||
            !mapping.learnerActive ||
            !mapping.channelActive ||
            !mapping.applicationApproved
          )
            return { ok: false, statusCode: 403, error: 'learner_identity_unavailable' };
          // Existing controlled function enforces current required consent. It
          // does not create a privacy session, accept a policy or write practice.
          const privacy = privacySchema.parse(
            (
              await client.query<{ data: unknown }>(
                'SELECT platform.privacy_usage($1,$2) AS data',
                ['line', subject]
              )
            ).rows[0]?.data
          );
          if (privacy.active && privacy.unavailable)
            return { ok: false, statusCode: 403, error: 'learner_identity_unavailable' };
          if (privacy.active && privacy.required)
            return { ok: false, statusCode: 403, error: 'privacy_acceptance_required' };
          return {
            ok: true,
            identity: {
              platform: 'line',
              subject,
              identityId: mapping.identityId,
              personId: mapping.personId
            },
            privacy: {
              active: privacy.active,
              reflectionConsent: privacy.reflectionConsent,
              version: privacy.active ? privacy.version : null,
              hash: privacy.active ? privacy.hash : null
            }
          };
        }
      );
    } catch (error) {
      // Never propagate verifier/DB diagnostics, credentials or profile data.
      if (error instanceof Error && error.message === 'privacy acceptance required')
        return { ok: false, statusCode: 403, error: 'privacy_acceptance_required' };
      if (error instanceof Error && error.message === 'learner eligibility unavailable')
        return { ok: false, statusCode: 403, error: 'learner_identity_unavailable' };
      return { ok: false, statusCode: 503, error: 'line_identity_unavailable' };
    }
  };
};
