import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { AppConfig } from './config.js'

type Queryable = Pool | PoolClient
type JsonRecord = Record<string, unknown>

export type IntegrationProvider = 'meta' | 'uazapi'

export class IntegrationConfigurationError extends Error {}

export interface MetaIntegrationConfig {
  accessToken?: string
  adAccountId?: string
  datasetId?: string
  pixelId?: string
  currency: string
  testEventCode?: string
}

export interface UazApiIntegrationConfig {
  baseUrl: string
  token?: string
  instanceName: string
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function keyFromConfig(config: AppConfig): Buffer {
  const source = config.integrationsEncryptionKey ?? config.uazapiEncryptionKey
  if (!source) {
    throw new IntegrationConfigurationError(
      'INTEGRATIONS_ENCRYPTION_KEY (ou UAZAPI_ENCRYPTION_KEY) é obrigatório para guardar credenciais por empresa.',
    )
  }
  return createHash('sha256').update(source).digest()
}

export function encryptIntegrationSecret(value: string, config: AppConfig): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFromConfig(config), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.')
}

export function decryptIntegrationSecret(value: string, config: AppConfig): string {
  const [ivText, tagText, ciphertextText] = value.split('.')
  if (!ivText || !tagText || !ciphertextText) throw new IntegrationConfigurationError('Credencial criptografada inválida.')
  const decipher = createDecipheriv('aes-256-gcm', keyFromConfig(config), Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

async function readIntegration(
  pool: Queryable,
  companyId: string,
  provider: IntegrationProvider,
): Promise<{ config: JsonRecord; secretEncrypted: string | null; enabled: boolean } | null> {
  const result = await pool.query<{ config: JsonRecord; secret_encrypted: string | null; enabled: boolean }>(
    `select config, secret_encrypted, enabled
       from company_integrations
      where company_id = $1 and provider = $2`,
    [companyId, provider],
  )
  const row = result.rows[0]
  if (!row) return null
  return { config: asRecord(row.config), secretEncrypted: row.secret_encrypted, enabled: row.enabled }
}

async function saveIntegration(
  pool: Queryable,
  config: AppConfig,
  companyId: string,
  provider: IntegrationProvider,
  integrationConfig: JsonRecord,
  secret?: string,
): Promise<void> {
  const encrypted = secret ? encryptIntegrationSecret(secret, config) : null
  await pool.query(
    `insert into company_integrations (company_id, provider, config, secret_encrypted, enabled)
     values ($1, $2, $3::jsonb, $4, true)
     on conflict (company_id, provider) do update set
       config = excluded.config,
       secret_encrypted = coalesce(excluded.secret_encrypted, company_integrations.secret_encrypted),
       enabled = true,
       updated_at = now()`,
    [companyId, provider, JSON.stringify(integrationConfig), encrypted],
  )
}

export async function getMetaIntegration(
  pool: Queryable,
  config: AppConfig,
  companyId: string,
): Promise<MetaIntegrationConfig> {
  const row = await readIntegration(pool, companyId, 'meta')
  if (row?.enabled) {
    return {
      accessToken: row.secretEncrypted ? decryptIntegrationSecret(row.secretEncrypted, config) : undefined,
      adAccountId: text(row.config.adAccountId),
      datasetId: text(row.config.datasetId),
      pixelId: text(row.config.pixelId),
      currency: text(row.config.currency) ?? config.metaCurrency,
      testEventCode: text(row.config.testEventCode),
    }
  }
  // Compatibilidade transitória: a inicialização copia estes valores para a
  // empresa i9Place. O fallback impede indisponibilidade se a chave faltar.
  if (companyId === 'company_i9place') {
    return {
      accessToken: config.metaAccessToken,
      adAccountId: config.metaAdAccountId,
      datasetId: config.metaDatasetId,
      pixelId: config.metaPixelId,
      currency: config.metaCurrency,
      testEventCode: config.metaTestEventCode,
    }
  }
  return { currency: config.metaCurrency }
}

export async function saveMetaIntegration(
  pool: Queryable,
  config: AppConfig,
  companyId: string,
  input: {
    adAccountId: string
    datasetId?: string
    pixelId?: string
    currency?: string
    testEventCode?: string
    accessToken?: string
  },
): Promise<void> {
  await saveIntegration(pool, config, companyId, 'meta', {
    adAccountId: input.adAccountId.trim(),
    ...(input.datasetId?.trim() ? { datasetId: input.datasetId.trim() } : {}),
    ...(input.pixelId?.trim() ? { pixelId: input.pixelId.trim() } : {}),
    currency: (input.currency?.trim() || config.metaCurrency).toUpperCase(),
    ...(input.testEventCode?.trim() ? { testEventCode: input.testEventCode.trim() } : {}),
  }, input.accessToken?.trim())
}

export async function getUazApiIntegration(
  pool: Queryable,
  config: AppConfig,
  companyId: string,
): Promise<UazApiIntegrationConfig> {
  const row = await readIntegration(pool, companyId, 'uazapi')
  if (row?.enabled) {
    return {
      baseUrl: (text(row.config.baseUrl) ?? config.uazapiBaseUrl).replace(/\/$/, ''),
      token: row.secretEncrypted ? decryptIntegrationSecret(row.secretEncrypted, config) : undefined,
      instanceName: text(row.config.instanceName) ?? config.uazapiInstanceName,
    }
  }
  if (companyId === 'company_i9place') {
    return {
      baseUrl: config.uazapiBaseUrl,
      token: config.uazapiToken,
      instanceName: config.uazapiInstanceName,
    }
  }
  return { baseUrl: config.uazapiBaseUrl, instanceName: config.uazapiInstanceName }
}

export async function saveUazApiIntegration(
  pool: Queryable,
  config: AppConfig,
  companyId: string,
  input: { baseUrl: string; instanceName: string; token?: string },
): Promise<void> {
  const baseUrl = new URL(input.baseUrl.trim()).toString().replace(/\/$/, '')
  await saveIntegration(pool, config, companyId, 'uazapi', {
    baseUrl,
    instanceName: input.instanceName.trim(),
  }, input.token?.trim())
}

function hashWebhookSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function rotateUazApiWebhookSecret(pool: Queryable, companyId: string): Promise<string> {
  const secret = randomBytes(32).toString('base64url')
  await saveUazApiWebhookSecret(pool, companyId, secret)
  return secret
}

export async function saveUazApiWebhookSecret(
  pool: Queryable,
  companyId: string,
  secret: string,
): Promise<void> {
  await pool.query(
    `insert into company_integrations (company_id, provider, config, webhook_secret_hash, enabled)
     values ($1, 'uazapi', '{}'::jsonb, $2, true)
     on conflict (company_id, provider) do update set
       webhook_secret_hash = excluded.webhook_secret_hash,
       updated_at = now()`,
    [companyId, hashWebhookSecret(secret)],
  )
}

export async function verifyUazApiWebhookSecret(
  pool: Queryable,
  companyId: string,
  supplied: string | undefined,
): Promise<boolean> {
  if (!supplied) return false
  const result = await pool.query<{ webhook_secret_hash: string | null }>(
    `select webhook_secret_hash from company_integrations
      where company_id = $1 and provider = 'uazapi'`,
    [companyId],
  )
  const expected = result.rows[0]?.webhook_secret_hash
  if (!expected) return false
  const left = Buffer.from(hashWebhookSecret(supplied), 'hex')
  const right = Buffer.from(expected, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function bootstrapLegacyIntegrations(pool: Pool, config: AppConfig): Promise<void> {
  const companyId = 'company_i9place'
  try {
    if (config.metaAccessToken && (config.metaAdAccountId || config.metaDatasetId || config.metaPixelId)) {
      const exists = await readIntegration(pool, companyId, 'meta')
      if (!exists) {
        await saveMetaIntegration(pool, config, companyId, {
          adAccountId: config.metaAdAccountId ?? '',
          datasetId: config.metaDatasetId,
          pixelId: config.metaPixelId,
          currency: config.metaCurrency,
          testEventCode: config.metaTestEventCode,
          accessToken: config.metaAccessToken,
        })
      }
    }

    if (config.uazapiToken) {
      const exists = await readIntegration(pool, companyId, 'uazapi')
      if (!exists) {
        await saveUazApiIntegration(pool, config, companyId, {
          baseUrl: config.uazapiBaseUrl,
          instanceName: config.uazapiInstanceName,
          token: config.uazapiToken,
        })
      }
    }
  } catch (error) {
    if (!(error instanceof IntegrationConfigurationError)) throw error
    // Sem uma chave de criptografia antiga a empresa inicial continua no
    // fallback de ambiente; novos workspaces exigirão a chave antes de salvar.
  }
}
