/**
 * Practice Field & NFC Weekend Check-in Routes
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getActivePracticeFields,
  processFieldCheckin,
  type FieldCheckinFailure
} from './field-checkin-service.js';

// No identity, subject, credential or daily-practice link is trusted by this quarantined API.
// A future credential adapter must verify server-side before deriving learner identity;
// accepting a token-shaped string or setting person context from the payload is not sufficient.
export const fieldCheckinSchema = z
  .object({
    fieldId: z.string().uuid().optional(),
    fieldCode: z.string().min(1).max(50).optional(),
    checkinMethod: z.enum(['nfc_gps', 'volunteer_manual']),
    userLatitude: z.number().min(-90).max(90).optional(),
    userLongitude: z.number().min(-180).max(180).optional(),
    studentNote: z.string().max(1000).optional()
  })
  .strict()
  .refine((data) => Boolean(data.fieldId || data.fieldCode), {
    message: 'Either fieldId or fieldCode must be provided',
    path: ['fieldId']
  })
  .refine(
    (data) =>
      data.checkinMethod !== 'nfc_gps' ||
      (data.userLatitude !== undefined && data.userLongitude !== undefined),
    {
      message: 'userLatitude and userLongitude are required for nfc_gps check-in',
      path: ['userLatitude']
    }
  );

export const mapCheckinErrorStatus = (error: FieldCheckinFailure['error']): number =>
  error === 'volunteer_authorization_unavailable' ? 403 : 503;

const privateResponse = (reply: FastifyReply): FastifyReply =>
  reply
    .header('cache-control', 'no-store')
    .header('referrer-policy', 'no-referrer')
    .header('x-content-type-options', 'nosniff');

/**
 * Fail closed even if explicitly enabled against a pre-quarantine schema or privileged pool.
 * No DB dependency is accepted while the trusted credential/context path is incomplete.
 */
export const registerFieldCheckinRoutes = (app: FastifyInstance): void => {
  app.get('/api/v1/fields/active', (_request, reply) => {
    const result = getActivePracticeFields();
    return privateResponse(reply).code(mapCheckinErrorStatus(result.error)).send(result);
  });

  app.post('/api/v1/field-checkin', { bodyLimit: 4096 }, (request, reply) => {
    privateResponse(reply);
    const parsed = fieldCheckinSchema.safeParse(request.body);
    if (!parsed.success) {
      // Do not echo payloads, credentials, GPS or learner notes in validation errors/logs.
      return reply.code(400).send({ ok: false, error: 'invalid_input' });
    }
    const result = processFieldCheckin(parsed.data);
    return reply.code(mapCheckinErrorStatus(result.error)).send(result);
  });
};
