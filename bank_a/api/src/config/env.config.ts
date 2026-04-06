import { z } from 'zod';

/**
 * Zod schema for environment variable validation.
 * Fails at startup if any required variable is missing or malformed — fail-fast principle.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // MongoDB
  MONGODB_URI: z.string().url(),

  // Kafka
  KAFKA_BROKERS: z.string().min(1),
  KAFKA_CLIENT_ID: z.string().default('orange-bank'),
  KAFKA_GROUP_ID: z.string().default('orange-bank-group'),

  // JWT
  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Redis
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Factory called by @nestjs/config to parse and validate all env vars.
 * Throws a descriptive error on validation failure before the app starts.
 */
export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const formatted = result.error.flatten().fieldErrors;
    const lines = Object.entries(formatted)
      .map(([k, v]) => `  [${k}] ${(v as string[]).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${lines}`);
  }

  return result.data;
}
