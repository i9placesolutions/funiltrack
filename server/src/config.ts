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
  AUTH_ALLOW_REGISTRATION: booleanFromEnv(true),
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  AUTH_SECURE_COOKIE: booleanFromEnv(false),
  APP_PUBLIC_URL: z.string().trim().url().optional(),
  N8N_UAZAPI_WEBHOOK_URL: z.string().trim().url().optional(),
  UAZAPI_BASE_URL: z.string().trim().url().default('https://api.uazapi.com'),
  UAZAPI_TOKEN: z.string().trim().min(1).optional(),
  UAZAPI_ADMIN_TOKEN: z.string().trim().min(1).optional(),
  UAZAPI_INSTANCE_NAME: z.string().trim().min(1).max(80).default('funiltrack'),
  UAZAPI_ENCRYPTION_KEY: z.string().trim().min(32).optional(),
  INTEGRATIONS_ENCRYPTION_KEY: z.string().trim().min(32).optional(),
  UAZAPI_WEBHOOK_SECRET: z.string().trim().min(16).optional(),
  META_GRAPH_API_BASE_URL: z.string().trim().url().default('https://graph.facebook.com'),
  META_GRAPH_API_VERSION: z.string().trim().min(1).default('v23.0'),
  META_OAUTH_API_VERSION: z.string().trim().min(1).default('v25.0'),
  META_APP_ID: z.string().trim().min(1).optional(),
  META_APP_SECRET: z.string().trim().min(1).optional(),
  META_BUSINESS_LOGIN_CONFIG_ID: z.string().trim().min(1).optional(),
  META_OAUTH_REDIRECT_URI: z.string().trim().url().optional(),
  META_AD_ACCOUNT_ID: z.string().trim().min(1).optional(),
  META_ACCESS_TOKEN: z.string().trim().min(1).optional(),
  META_DATASET_ID: z.string().trim().min(1).optional(),
  META_PIXEL_ID: z.string().trim().min(1).optional(),
  META_CURRENCY: z.string().trim().length(3).default('BRL'),
  META_TEST_EVENT_CODE: z.string().trim().min(1).optional(),
  META_SYNC_ENABLED: booleanFromEnv(true),
  META_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  META_SYNC_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(30).default(3),
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
  authAllowRegistration: boolean
  authSessionTtlDays: number
  authSecureCookie: boolean
  appPublicUrl?: string
  n8nUazapiWebhookUrl?: string
  uazapiBaseUrl: string
  uazapiToken?: string
  uazapiAdminToken?: string
  uazapiInstanceName: string
  uazapiEncryptionKey?: string
  integrationsEncryptionKey?: string
  uazapiWebhookSecret?: string
  metaGraphApiBaseUrl: string
  metaGraphApiVersion: string
  metaOAuthApiVersion: string
  metaAppId?: string
  metaAppSecret?: string
  metaBusinessLoginConfigId?: string
  metaOAuthRedirectUri?: string
  metaAdAccountId?: string
  metaAccessToken?: string
  metaDatasetId?: string
  metaPixelId?: string
  metaCurrency: string
  metaTestEventCode?: string
  metaSyncEnabled: boolean
  metaSyncIntervalMinutes: number
  metaSyncLookbackDays: number
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
    authAllowRegistration: parsed.AUTH_ALLOW_REGISTRATION,
    authSessionTtlDays: parsed.AUTH_SESSION_TTL_DAYS,
    authSecureCookie: parsed.AUTH_SECURE_COOKIE,
    appPublicUrl: parsed.APP_PUBLIC_URL,
    n8nUazapiWebhookUrl: parsed.N8N_UAZAPI_WEBHOOK_URL,
    uazapiBaseUrl: parsed.UAZAPI_BASE_URL.replace(/\/$/, ''),
    uazapiToken: parsed.UAZAPI_TOKEN,
    uazapiAdminToken: parsed.UAZAPI_ADMIN_TOKEN,
    uazapiInstanceName: parsed.UAZAPI_INSTANCE_NAME,
    uazapiEncryptionKey: parsed.UAZAPI_ENCRYPTION_KEY,
    integrationsEncryptionKey: parsed.INTEGRATIONS_ENCRYPTION_KEY,
    uazapiWebhookSecret: parsed.UAZAPI_WEBHOOK_SECRET,
    metaGraphApiBaseUrl: parsed.META_GRAPH_API_BASE_URL.replace(/\/$/, ''),
    metaGraphApiVersion: parsed.META_GRAPH_API_VERSION,
    metaOAuthApiVersion: parsed.META_OAUTH_API_VERSION,
    metaAppId: parsed.META_APP_ID,
    metaAppSecret: parsed.META_APP_SECRET,
    metaBusinessLoginConfigId: parsed.META_BUSINESS_LOGIN_CONFIG_ID,
    metaOAuthRedirectUri: parsed.META_OAUTH_REDIRECT_URI,
    metaAdAccountId: parsed.META_AD_ACCOUNT_ID,
    metaAccessToken: parsed.META_ACCESS_TOKEN,
    metaDatasetId: parsed.META_DATASET_ID,
    metaPixelId: parsed.META_PIXEL_ID,
    metaCurrency: parsed.META_CURRENCY.toUpperCase(),
    metaTestEventCode: parsed.META_TEST_EVENT_CODE,
    metaSyncEnabled: parsed.META_SYNC_ENABLED,
    metaSyncIntervalMinutes: parsed.META_SYNC_INTERVAL_MINUTES,
    metaSyncLookbackDays: parsed.META_SYNC_LOOKBACK_DAYS,
    corsOrigin: parsed.CORS_ORIGIN,
    staticDir: parsed.STATIC_DIR,
  }
}
