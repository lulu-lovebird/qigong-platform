/**
 * Practice Field & NFC Weekend Check-in Routes
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@qigong/database';
import { z } from 'zod';
import {
  getActivePracticeFields,
  processFieldCheckin,
  type FieldCheckinInput,
  type FieldCheckinResult
} from './field-checkin-service.js';

export const fieldCheckinSchema = z
  .object({
    personId: z.string().uuid({ message: 'personId must be a valid UUID' }),
    fieldId: z.string().uuid({ message: 'fieldId must be a valid UUID' }).optional(),
    fieldCode: z.string().min(1).max(50).optional(),
    checkinMethod: z.enum(['nfc_gps', 'volunteer_manual']),
    userLatitude: z.number().min(-90).max(90).optional(),
    userLongitude: z.number().min(-180).max(180).optional(),
    volunteerPersonId: z
      .string()
      .uuid({ message: 'volunteerPersonId must be a valid UUID' })
      .optional(),
    studentNote: z.string().max(1000).optional(),
    checkinId: z.string().uuid({ message: 'checkinId must be a valid UUID' }).optional()
  })
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
  )
  .refine(
    (data) => data.checkinMethod !== 'volunteer_manual' || Boolean(data.volunteerPersonId),
    {
      message: 'volunteerPersonId is required for volunteer_manual check-in',
      path: ['volunteerPersonId']
    }
  );

export const mapCheckinErrorStatus = (error: string): number => {
  switch (error) {
    case 'already_checked_in':
      return 409;
    case 'field_not_found':
      return 404;
    case 'outside_geofence':
    case 'outside_time_window':
      return 403;
    case 'invalid_input':
    case 'field_inactive':
    case 'missing_coordinates':
    case 'missing_volunteer':
      return 400;
    default:
      return 500;
  }
};

/**
 * Registers Practice Field and NFC attendance endpoints into Fastify.
 */
export const registerFieldCheckinRoutes = (app: FastifyInstance, pool: Pool): void => {
  /**
   * GET /api/v1/fields/active
   * Retrieves all currently active practice fields and their time rules.
   */
  app.get('/api/v1/fields/active', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff');

    try {
      const fields = await getActivePracticeFields(pool);
      return reply.code(200).send({
        ok: true,
        fields
      });
    } catch (err: unknown) {
      app.log.error({ err }, 'Failed to fetch active practice fields');
      return reply.code(500).send({
        ok: false,
        error: 'database_error',
        message: 'Failed to retrieve active practice fields'
      });
    }
  });

  /**
   * POST /api/v1/field-checkin
   * Handles NFC touch check-in with GPS or manual volunteer authorization.
   */
  app.post('/api/v1/field-checkin', async (request: FastifyRequest, reply: FastifyReply) => {
    reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff');

    const parsed = fieldCheckinSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: 'invalid_input',
        message: parsed.error.issues[0]?.message ?? 'Invalid request payload',
        issues: parsed.error.issues
      });
    }

    try {
      const result: FieldCheckinResult = await processFieldCheckin(
        pool,
        parsed.data as FieldCheckinInput,
        {
          requestId: request.id
        }
      );

      if (result.ok) {
        return reply.code(200).send(result);
      }

      const status = mapCheckinErrorStatus(result.error);
      return reply.code(status).send(result);
    } catch (err: unknown) {
      app.log.error({ err }, 'Error during field check-in processing');
      return reply.code(500).send({
        ok: false,
        error: 'internal_error',
        message: 'An unexpected error occurred during check-in processing'
      });
    }
  });
};
