import { createHash, randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import type { AppConfig } from './config.js'
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  saveMetaIntegration,
} from './integrations.js'

type JsonRecord = Record<string, unknown>

interface MetaOAuthSessionRow {
  id: string
  company_id: string
  initiated_by_user_id: string
  status: MetaOAuthSessionStatus
  access_token_encrypted: string | null
  error_message: string | null
  expires_at: Date
  authorized_at: Date | null
  completed_at: Date | null
}

interface MetaGraphPage<T> {
  data?: T[]
  paging?: { next?: string }
}

interface MetaGraphAdAccount {
  id?: unknown
  name?: unknown
  account_status?: unknown
  currency?: unknown
}

interface MetaGraphPixel {
  id?: unknown
  name?: unknown
}

export type MetaOAuthSessionStatus =
  | 'pending'
  | 'exchanging'
  | 'authorized'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled'

export interface MetaOAuthSession {
  id: string
  status: MetaOAuthSessionStatus
  expiresAt: string
  authorizedAt: string | null
  completedAt: string | null
  error: string | null
}

export interface MetaAdAccountOption {
  id: string
  name: string
  currency: string | null
  status: string | null
}

export interface MetaTrackingAssetOption {
  id: string
  name: string
  kind: 'pixel'
}

export class MetaOAuthConfigurationError extends Error {}

export class MetaOAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 502,
  ) {
    super(message)
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function optionalText(value: unknown): string | null {
  const candidate = text(value)
  return candidate || null
}

function stateHash(state: string): string {
  return createHash('sha256').update(state).digest('hex')
}

function nowIso(value: Date | null): string | null {
  return value ? new Date(value).toISOString() : null
}

function mapSession(row: MetaOAuthSessionRow): MetaOAuthSession {
  return {
    id: row.id,
    status: row.status,
    expiresAt: new Date(row.expires_at).toISOString(),
    authorizedAt: nowIso(row.authorized_at),
    completedAt: nowIso(row.completed_at),
    error: row.error_message,
  }
}

function callbackUrl(config: AppConfig): string | null {
  if (config.metaOAuthRedirectUri) return config.metaOAuthRedirectUri
  if (!config.appPublicUrl) return null
  return new URL('/api/meta/oauth/callback', config.appPublicUrl).toString()
}

function missingBusinessLoginConfig(config: AppConfig): string[] {
  const missing: string[] = []
  if (!config.metaAppId) missing.push('META_APP_ID')
  if (!config.metaAppSecret) missing.push('META_APP_SECRET')
  if (!config.metaBusinessLoginConfigId) missing.push('META_BUSINESS_LOGIN_CONFIG_ID')
  if (!callbackUrl(config)) missing.push('META_OAUTH_REDIRECT_URI')
  return missing
}

export function isMetaBusinessLoginConfigured(config: AppConfig): boolean {
  return missingBusinessLoginConfig(config).length === 0
}

function requireBusinessLoginConfig(config: AppConfig): {
  appId: string
  appSecret: string
  configurationId: string
  redirectUri: string
} {
  const missing = missingBusinessLoginConfig(config)
  if (missing.length > 0) {
    throw new MetaOAuthConfigurationError(
      `A conexão global da Meta ainda não está pronta (${missing.join(', ')}).`,
    )
  }
  return {
    appId: config.metaAppId as string,
    appSecret: config.metaAppSecret as string,
    configurationId: config.metaBusinessLoginConfigId as string,
    redirectUri: callbackUrl(config) as string,
  }
}

function metaErrorMessage(payload: unknown, fallback: string): string {
  const root = asRecord(payload)
  const error = asRecord(root?.error)
  return text(error?.message, text(root?.message, fallback)).slice(0, 500)
}

async function jsonResponse(response: Response): Promise<unknown> {
  const raw = await response.text()
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

async function exchangeAuthorizationCode(
  config: AppConfig,
  code: string,
): Promise<string> {
  const login = requireBusinessLoginConfig(config)
  const url = new URL(`${config.metaGraphApiBaseUrl}/${config.metaOAuthApiVersion}/oauth/access_token`)
  url.searchParams.set('client_id', login.appId)
  url.searchParams.set('client_secret', login.appSecret)
  url.searchParams.set('redirect_uri', login.redirectUri)
  url.searchParams.set('code', code)

  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  const payload = await jsonResponse(response)
  if (!response.ok) {
    throw new MetaOAuthError(metaErrorMessage(payload, 'A Meta recusou a autorização.'), response.status)
  }
  const accessToken = text(asRecord(payload)?.access_token)
  if (!accessToken) {
    throw new MetaOAuthError('A Meta não retornou um token de acesso válido.', 502)
  }
  return accessToken
}

async function graphRequest<T>(
  config: AppConfig,
  accessToken: string,
  pathOrUrl: string,
  query: Record<string, string> = {},
): Promise<T> {
  const url = new URL(
    pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${config.metaGraphApiBaseUrl}/${config.metaGraphApiVersion}/${pathOrUrl.replace(/^\//, '')}`,
  )
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  })
  const payload = await jsonResponse(response)
  if (!response.ok) {
    throw new MetaOAuthError(metaErrorMessage(payload, 'A Meta recusou a leitura dos ativos.'), response.status)
  }
  return payload as T
}

async function graphCollection<T>(
  config: AppConfig,
  accessToken: string,
  path: string,
  query: Record<string, string>,
): Promise<T[]> {
  const items: T[] = []
  let next: string | null = path
  let isFirst = true
  let pages = 0
  while (next && pages < 25) {
    const page: MetaGraphPage<T> = await graphRequest<MetaGraphPage<T>>(
      config,
      accessToken,
      next,
      isFirst ? query : {},
    )
    items.push(...(page.data ?? []))
    next = page.paging?.next ?? null
    isFirst = false
    pages += 1
  }
  return items
}

async function loadSession(
  pool: Pool,
  sessionId: string,
): Promise<MetaOAuthSessionRow | null> {
  const result = await pool.query<MetaOAuthSessionRow>(
    `select id, company_id, initiated_by_user_id, status, access_token_encrypted,
            error_message, expires_at, authorized_at, completed_at
       from meta_oauth_sessions
      where id = $1`,
    [sessionId],
  )
  return result.rows[0] ?? null
}

async function markExpired(pool: Pool, sessionId: string): Promise<void> {
  await pool.query(
    `update meta_oauth_sessions
        set status = 'expired', access_token_encrypted = null,
            error_message = 'A autorização expirou. Inicie novamente.', updated_at = now()
      where id = $1 and status in ('pending', 'exchanging', 'authorized')`,
    [sessionId],
  )
}

function ensureNotExpired(row: MetaOAuthSessionRow): void {
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new MetaOAuthError('A autorização expirou. Inicie novamente.', 410)
  }
}

async function authorizedSession(
  pool: Pool,
  config: AppConfig,
  companyId: string,
  userId: string,
  sessionId: string,
): Promise<{ session: MetaOAuthSession; accessToken: string }> {
  const row = await loadSession(pool, sessionId)
  if (!row || row.company_id !== companyId || row.initiated_by_user_id !== userId) {
    throw new MetaOAuthError('Autorização Meta não encontrada.', 404)
  }
  try {
    ensureNotExpired(row)
  } catch (error) {
    await markExpired(pool, row.id)
    throw error
  }
  if (row.status !== 'authorized' || !row.access_token_encrypted) {
    throw new MetaOAuthError(
      row.status === 'completed'
        ? 'Esta autorização já foi concluída.'
        : 'A autorização ainda não está pronta para escolher os ativos.',
      409,
    )
  }
  return { session: mapSession(row), accessToken: decryptIntegrationSecret(row.access_token_encrypted, config) }
}

async function adAccountsForToken(config: AppConfig, accessToken: string): Promise<MetaAdAccountOption[]> {
  const accounts = await graphCollection<MetaGraphAdAccount>(config, accessToken, '/me/adaccounts', {
    fields: 'id,name,account_status,currency',
    limit: '100',
  })
  return accounts.flatMap((account) => {
    const id = text(account.id)
    if (!id) return []
    return [{
      id,
      name: text(account.name, id),
      currency: optionalText(account.currency),
      status: optionalText(account.account_status),
    }]
  })
}

async function trackingAssetsForAccount(
  config: AppConfig,
  accessToken: string,
  adAccountId: string,
): Promise<MetaTrackingAssetOption[]> {
  const normalizedId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
  const pixels = await graphCollection<MetaGraphPixel>(config, accessToken, `/${normalizedId}/adspixels`, {
    fields: 'id,name',
    limit: '100',
  })
  return pixels.flatMap((pixel) => {
    const id = text(pixel.id)
    return id ? [{ id, name: text(pixel.name, id), kind: 'pixel' as const }] : []
  })
}

export async function startMetaBusinessLogin(
  pool: Pool,
  config: AppConfig,
  companyId: string,
  userId: string,
): Promise<{ authorizationUrl: string; session: MetaOAuthSession }> {
  const login = requireBusinessLoginConfig(config)
  const state = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  const row: MetaOAuthSessionRow = {
    id: `meta_oauth_${randomBytes(12).toString('hex')}`,
    company_id: companyId,
    initiated_by_user_id: userId,
    status: 'pending',
    access_token_encrypted: null,
    error_message: null,
    expires_at: expiresAt,
    authorized_at: null,
    completed_at: null,
  }
  await pool.query(
    `insert into meta_oauth_sessions
      (id, company_id, initiated_by_user_id, state_hash, status, expires_at)
     values ($1, $2, $3, $4, 'pending', $5)`,
    [row.id, row.company_id, row.initiated_by_user_id, stateHash(state), expiresAt],
  )

  const authorizationUrl = new URL(`https://www.facebook.com/${config.metaOAuthApiVersion}/dialog/oauth`)
  authorizationUrl.searchParams.set('client_id', login.appId)
  authorizationUrl.searchParams.set('redirect_uri', login.redirectUri)
  authorizationUrl.searchParams.set('state', state)
  authorizationUrl.searchParams.set('config_id', login.configurationId)
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('override_default_response_type', 'true')
  return { authorizationUrl: authorizationUrl.toString(), session: mapSession(row) }
}

export async function handleMetaBusinessLoginCallback(
  pool: Pool,
  config: AppConfig,
  input: { state?: string; code?: string; error?: string },
): Promise<{ sessionId: string; status: 'authorized' | 'failed' }> {
  const state = input.state?.trim()
  if (!state) throw new MetaOAuthError('Resposta de autorização Meta inválida.', 400)
  const result = await pool.query<MetaOAuthSessionRow>(
    `select id, company_id, initiated_by_user_id, status, access_token_encrypted,
            error_message, expires_at, authorized_at, completed_at
       from meta_oauth_sessions
      where state_hash = $1`,
    [stateHash(state)],
  )
  const row = result.rows[0]
  if (!row) throw new MetaOAuthError('A autorização Meta não foi encontrada.', 400)
  try {
    ensureNotExpired(row)
  } catch (error) {
    await markExpired(pool, row.id)
    throw error
  }

  if (input.error || !input.code?.trim()) {
    await pool.query(
      `update meta_oauth_sessions
          set status = 'failed', error_message = 'A autorização foi cancelada ou recusada na Meta.',
              access_token_encrypted = null, updated_at = now()
        where id = $1 and status in ('pending', 'exchanging')`,
      [row.id],
    )
    return { sessionId: row.id, status: 'failed' }
  }

  if (row.status === 'authorized' || row.status === 'completed') {
    return { sessionId: row.id, status: 'authorized' }
  }
  if (row.status !== 'pending') {
    throw new MetaOAuthError('Esta autorização não pode mais ser concluída. Inicie novamente.', 409)
  }

  const claimed = await pool.query(
    `update meta_oauth_sessions
        set status = 'exchanging', updated_at = now()
      where id = $1 and status = 'pending'`,
    [row.id],
  )
  if (claimed.rowCount !== 1) {
    throw new MetaOAuthError('A autorização já está sendo processada. Aguarde alguns segundos.', 409)
  }

  try {
    const accessToken = await exchangeAuthorizationCode(config, input.code.trim())
    await pool.query(
      `update meta_oauth_sessions
          set status = 'authorized', access_token_encrypted = $2, error_message = null,
              authorized_at = now(), updated_at = now()
        where id = $1`,
      [row.id, encryptIntegrationSecret(accessToken, config)],
    )
    return { sessionId: row.id, status: 'authorized' }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Não foi possível concluir a autorização Meta.'
    await pool.query(
      `update meta_oauth_sessions
          set status = 'failed', access_token_encrypted = null, error_message = $2, updated_at = now()
        where id = $1`,
      [row.id, message],
    )
    throw error
  }
}

export async function getMetaBusinessLoginAssets(
  pool: Pool,
  config: AppConfig,
  companyId: string,
  userId: string,
  sessionId: string,
): Promise<{ session: MetaOAuthSession; adAccounts: MetaAdAccountOption[] }> {
  const { session, accessToken } = await authorizedSession(pool, config, companyId, userId, sessionId)
  return { session, adAccounts: await adAccountsForToken(config, accessToken) }
}

export async function getMetaBusinessLoginTrackingAssets(
  pool: Pool,
  config: AppConfig,
  companyId: string,
  userId: string,
  sessionId: string,
  adAccountId: string,
): Promise<{ session: MetaOAuthSession; assets: MetaTrackingAssetOption[] }> {
  const { session, accessToken } = await authorizedSession(pool, config, companyId, userId, sessionId)
  const account = (await adAccountsForToken(config, accessToken)).find((item) => item.id === adAccountId || item.id === `act_${adAccountId}`)
  if (!account) throw new MetaOAuthError('A conta de anúncios escolhida não foi liberada nesta autorização.', 403)
  return { session, assets: await trackingAssetsForAccount(config, accessToken, account.id) }
}

export async function completeMetaBusinessLogin(
  pool: Pool,
  config: AppConfig,
  companyId: string,
  userId: string,
  sessionId: string,
  input: { adAccountId: string; datasetId: string },
): Promise<MetaOAuthSession> {
  const { session, accessToken } = await authorizedSession(pool, config, companyId, userId, sessionId)
  const account = (await adAccountsForToken(config, accessToken)).find((item) => item.id === input.adAccountId || item.id === `act_${input.adAccountId}`)
  if (!account) throw new MetaOAuthError('A conta de anúncios escolhida não foi liberada nesta autorização.', 403)
  const asset = (await trackingAssetsForAccount(config, accessToken, account.id)).find((item) => item.id === input.datasetId)
  if (!asset) throw new MetaOAuthError('O Pixel/Dataset escolhido não foi liberado nesta autorização.', 403)

  await saveMetaIntegration(pool, config, companyId, {
    adAccountId: account.id,
    adAccountName: account.name,
    datasetId: asset.id,
    datasetName: asset.name,
    currency: account.currency ?? config.metaCurrency,
    accessToken,
    connectionMethod: 'business_login',
    connectedAt: new Date().toISOString(),
  })
  const completed = await pool.query<MetaOAuthSessionRow>(
    `update meta_oauth_sessions
        set status = 'completed', access_token_encrypted = null, error_message = null,
            completed_at = now(), updated_at = now()
      where id = $1
      returning id, company_id, initiated_by_user_id, status, access_token_encrypted,
                error_message, expires_at, authorized_at, completed_at`,
    [session.id],
  )
  const row = completed.rows[0]
  if (!row) throw new MetaOAuthError('Não foi possível concluir a conexão Meta.', 500)
  return mapSession(row)
}

export function metaOAuthResultRedirect(
  config: AppConfig,
  result: 'success' | 'error',
  sessionId?: string,
): string {
  if (!config.appPublicUrl) {
    const query = new URLSearchParams({ meta_connect: result })
    if (sessionId) query.set('meta_session', sessionId)
    return `/config?${query.toString()}`
  }
  const url = new URL('/config', config.appPublicUrl)
  url.searchParams.set('meta_connect', result)
  if (sessionId) url.searchParams.set('meta_session', sessionId)
  return url.toString()
}
