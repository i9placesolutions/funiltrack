import { z } from 'zod'

const booleanFromEnv = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) return fallback
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
    })

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().trim().min(1).optional(),
  DATABASE_SSL: booleanFromEnv(false),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.string().trim().min(1).optional(),
  REDIS_REQUIRED: booleanFromEnv(false),
  SEED_DEMO_DATA: booleanFromEnv(false),
  API_TOKEN: z.string().trim().min(1).optional(),
  WEBHOOK_TOKEN: z.string().trim().min(1).optional(),
  CORS_ORIGIN: z.string().default('*'),
  STATIC_DIR: z.string().default('dist'),
})

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  host: string
  databaseUrl: string
  databaseSsl: boolean
  pgPoolMax: number
  redisUrl?: string
  redisRequired: boolean
  seedDemoData: boolean
  apiToken?: string
  webhookToken?: string
  corsOrigin: string
  staticDir: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env)
  const databaseUrl =
    parsed.DATABASE_URL ??
    (parsed.NODE_ENV === 'production'
      ? undefined
      : 'postgresql://funiltrack:funiltrack@127.0.0.1:5432/funiltrack')

  if (!databaseUrl) {
    throw new Error('DATABASE_URL é obrigatório em produção.')
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    databaseUrl,
    databaseSsl: parsed.DATABASE_SSL,
    pgPoolMax: parsed.PG_POOL_MAX,
    redisUrl: parsed.REDIS_URL,
    redisRequired: parsed.REDIS_REQUIRED,
    seedDemoData: parsed.SEED_DEMO_DATA,
    apiToken: parsed.API_TOKEN,
    webhookToken: parsed.WEBHOOK_TOKEN,
    corsOrigin: parsed.CORS_ORIGIN,
    staticDir: parsed.STATIC_DIR,
  }
}
