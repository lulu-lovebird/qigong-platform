import { z } from 'zod';

const positiveInteger = z.coerce.number().int().positive();

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'postgres:' || protocol === 'postgresql:';
  }, 'DATABASE_URL must use postgres:// or postgresql://'),
  DATABASE_POOL_MAX: positiveInteger.default(10),
  DATABASE_CONNECTION_TIMEOUT_MS: positiveInteger.default(5000),
  DATABASE_STATEMENT_TIMEOUT_MS: positiveInteger.default(10000)
});

export type Environment = z.infer<typeof environmentSchema>;

export const loadEnvironment = (source: NodeJS.ProcessEnv = process.env): Environment =>
  environmentSchema.parse(source);
