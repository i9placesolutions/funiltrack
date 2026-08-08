import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import type { AppConfig } from './config.js'
import {
  getUazApiIntegration,
  saveUazApiIntegration,
  saveUazApiWebhookSecret,
  verifyUazApiWebhookSecret,
  type UazApiIntegrationConfig,
} from './integrations.js'

type JsonRecord = Record<string, unknown>

export class UazApiConfigurationError extends Error {}

export class UazApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 502,
  ) {
    super(message)
  }
}

export interface WhatsAppState {
  configured: boolean
  instanceName: string
  status: string
  connected: boolean
  loggedIn: boolean
  jid: string | null
  qrcode: string | null
  paircode: string | null
  profileName: string | null
  profilePicUrl: string | null
  lastError: string | null
  updatedAt: string | null
}

export interface NormalizedUazApiEvent {
  eventType: string
  providerEventId: string | null
  isMessage: boolean
  name: string
  phone: string
  text: string
  direction: 'incoming' | 'outgoing'
  at: Date
  attribution: {
    adId?: string
    ctwaClid?: string
    fbclid?: string
    fbp?: string
    fbc?: string
    sourceUrl?: string
    sourceType?: string
  }
  payload: JsonRecord
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function getPath(record: JsonRecord, path: string[]): unknown {
  let value: unknown = record
  for (const key of path) {
    const current = asRecord(value)
    if (!current) return undefined
    value = current[key]
  }
  return value
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value
  }
  return undefined
}

function normalizePhone(value: string): string {
  const withoutJid = value.replace(/@(s\.whatsapp\.net|lid|g\.us|newsletter)$/i, '')
  return withoutJid.replace(/\D/g, '')
}

function toDate(value: unknown): Date {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value > 10_000_000_000 ? value : value * 1000
    const date = new Date(timestamp)
    if (!Number.isNaN(date.getTime())) return date
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date
  }
  return new Date()
}

function stringifyErrorPayload(payload: unknown): string {
  const record = asRecord(payload)
  const message = firstString(record?.message, record?.error, record?.response)
  return (message || 'A UazAPI recusou a operação.').slice(0, 500)
}

async function callUazApi<T>(
  baseUrl: string,
  token: string,
  path: string,
  options: { method?: 'GET' | 'POST' | 'DELETE'; body?: JsonRecord; admin?: boolean } = {},
): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      [options.admin ? 'admintoken' : 'token']: token,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
  const raw = await response.text()
  let payload: unknown = null
  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    payload = null
  }
  if (!response.ok) throw new UazApiError(stringifyErrorPayload(payload), response.status)
  return payload as T
}

function stateFromPayload(payload: unknown, existingName: string): Omit<WhatsAppState, 'configured'> {
  const root = asRecord(payload) ?? {}
  const instance = asRecord(root.instance) ?? root
  const statusRecord = asRecord(root.status) ?? {}
  const rawStatus = firstString(instance.status, statusRecord.connected ? 'connected' : '', 'disconnected')
  const connected = firstBoolean(statusRecord.connected, root.connected, rawStatus === 'connected') ?? false
  const loggedIn = firstBoolean(statusRecord.loggedIn, root.loggedIn, connected) ?? false
  const jidRecord = asRecord(statusRecord.jid) ?? asRecord(root.jid)
  const jid = firstString(
    typeof statusRecord.jid === 'string' ? statusRecord.jid : '',
    jidRecord ? `${firstString(jidRecord.user)}${firstString(jidRecord.server) ? `@${firstString(jidRecord.server)}` : ''}` : '',
  )
  return {
    instanceName: firstString(instance.name, root.name, existingName) || existingName,
    status: connected ? 'connected' : rawStatus,
    connected,
    loggedIn,
    jid: jid || null,
    qrcode: firstString(instance.qrcode, root.qrcode) || null,
    paircode: firstString(instance.paircode, root.paircode) || null,
    profileName: firstString(instance.profileName, root.profileName) || null,
    profilePicUrl: firstString(instance.profilePicUrl, root.profilePicUrl) || null,
    lastError: null,
    updatedAt: new Date().toISOString(),
  }
}

async function persistState(
  pool: Pool,
  companyId: string,
  integration: UazApiIntegrationConfig,
  state: Omit<WhatsAppState, 'configured'>,
  error?: string | null,
): Promise<WhatsAppState> {
  await pool.query(
    `insert into whatsapp_instances
      (id, company_id, provider, name, status, qrcode, paircode, jid, profile_name,
       profile_pic_url, last_error, updated_at)
     values ($1, $2, 'uazapi', $3, $4, $5, $6, $7, $8, $9, $10, now())
     on conflict (company_id, provider) do update set
       name = excluded.name,
       status = excluded.status,
       qrcode = excluded.qrcode,
       paircode = excluded.paircode,
       jid = excluded.jid,
       profile_name = excluded.profile_name,
       profile_pic_url = excluded.profile_pic_url,
       last_error = excluded.last_error,
       updated_at = now()`,
    [
      `whatsapp_${companyId}`,
      companyId,
      state.instanceName || integration.instanceName,
      state.status,
      state.qrcode,
      state.paircode,
      state.jid,
      state.profileName,
      state.profilePicUrl,
      error === undefined ? state.lastError : error,
    ],
  )
  return {
    configured: true,
    ...state,
    lastError: error === undefined ? state.lastError : error,
  }
}

async function localState(pool: Pool, companyId: string): Promise<Record<string, unknown> | undefined> {
  const result = await pool.query<Record<string, unknown>>(
    `select name, status, qrcode, paircode, jid, profile_name, profile_pic_url, last_error, updated_at
       from whatsapp_instances
      where company_id = $1 and provider = 'uazapi'`,
    [companyId],
  )
  return result.rows[0]
}

export async function getWhatsAppState(pool: Pool, config: AppConfig, companyId: string): Promise<WhatsAppState> {
  const [local, integration] = await Promise.all([
    localState(pool, companyId),
    getUazApiIntegration(pool, config, companyId),
  ])
  if (!integration.token) {
    return {
      configured: false,
      instanceName: firstString(local?.name, integration.instanceName) || integration.instanceName,
      status: firstString(local?.status, 'not_configured'),
      connected: false,
      loggedIn: false,
      jid: firstString(local?.jid) || null,
      qrcode: firstString(local?.qrcode) || null,
      paircode: firstString(local?.paircode) || null,
      profileName: firstString(local?.profile_name) || null,
      profilePicUrl: firstString(local?.profile_pic_url) || null,
      lastError: firstString(local?.last_error) || null,
      updatedAt: local?.updated_at ? new Date(String(local.updated_at)).toISOString() : null,
    }
  }
  const payload = await callUazApi<JsonRecord>(integration.baseUrl, integration.token, '/instance/status')
  return persistState(pool, companyId, integration, stateFromPayload(payload, integration.instanceName))
}

export async function connectWhatsApp(
  pool: Pool,
  config: AppConfig,
  companyId: string,
  body: JsonRecord,
): Promise<WhatsAppState> {
  const integration = await getUazApiIntegration(pool, config, companyId)
  if (!integration.token) throw new UazApiConfigurationError('Configure o token UazAPI desta empresa antes de gerar o QR Code.')
  const payload = await callUazApi<JsonRecord>(integration.baseUrl, integration.token, '/instance/connect', {
    method: 'POST',
    body,
  })
  return persistState(pool, companyId, integration, stateFromPayload(payload, integration.instanceName))
}

export async function disconnectWhatsApp(pool: Pool, config: AppConfig, companyId: string): Promise<WhatsAppState> {
  const integration = await getUazApiIntegration(pool, config, companyId)
  if (!integration.token) throw new UazApiConfigurationError('WhatsApp ainda não está configurado nesta empresa.')
  const payload = await callUazApi<JsonRecord>(integration.baseUrl, integration.token, '/instance/disconnect', { method: 'POST' })
  return persistState(pool, companyId, integration, stateFromPayload(payload, integration.instanceName))
}

export async function sendWhatsAppText(
  pool: Pool,
  config: AppConfig,
  companyId: string,
  body: JsonRecord,
): Promise<JsonRecord> {
  const integration = await getUazApiIntegration(pool, config, companyId)
  if (!integration.token) throw new UazApiConfigurationError('Configure a UazAPI desta empresa antes de enviar mensagens.')
  return callUazApi<JsonRecord>(integration.baseUrl, integration.token, '/send/text', { method: 'POST', body })
}

export async function configureWhatsAppWebhook(
  pool: Pool,
  config: AppConfig,
  companyId: string,
): Promise<{ configured: boolean; urlPath: string }> {
  const integration = await getUazApiIntegration(pool, config, companyId)
  if (!integration.token) throw new UazApiConfigurationError('Configure a UazAPI desta empresa antes do webhook.')
  if (!config.appPublicUrl) throw new UazApiConfigurationError('APP_PUBLIC_URL precisa estar configurada para registrar o webhook.')
  const secret = randomBytes(32).toString('base64url')
  const target = new URL(`/api/whatsapp/uazapi-webhook/${encodeURIComponent(companyId)}`, config.appPublicUrl)
  target.searchParams.set('secret', secret)
  await callUazApi(integration.baseUrl, integration.token, '/webhook', {
    method: 'POST',
    body: {
      enabled: true,
      url: target.toString(),
      events: ['messages', 'messages_update', 'connection', 'history'],
      excludeMessages: ['wasSentByApi'],
      addUrlEvents: false,
      addUrlTypesMessages: false,
    },
  })
  await saveUazApiWebhookSecret(pool, companyId, secret)
  return { configured: true, urlPath: target.pathname }
}

export async function createWhatsAppInstance(
  pool: Pool,
  config: AppConfig,
  companyId: string,
): Promise<{ created: boolean; instanceName: string }> {
  if (!config.uazapiAdminToken) throw new UazApiConfigurationError('UAZAPI_ADMIN_TOKEN não configurado no serviço.')
  const integration = await getUazApiIntegration(pool, config, companyId)
  const payload = await callUazApi<JsonRecord>(integration.baseUrl, config.uazapiAdminToken, '/instance/create', {
    method: 'POST',
    admin: true,
    body: { name: integration.instanceName },
  })
  const instance = asRecord(payload.instance) ?? {}
  const token = firstString(payload.token, instance.token)
  if (!token) throw new UazApiError('A UazAPI não retornou o token da instância.')
  const state = stateFromPayload(payload, integration.instanceName)
  const savedIntegration = {
    baseUrl: integration.baseUrl,
    instanceName: state.instanceName,
    token,
  }
  await saveUazApiIntegration(pool, config, companyId, savedIntegration)
  return {
    created: true,
    instanceName: (await persistState(pool, companyId, savedIntegration, state)).instanceName,
  }
}

function timingSafeSecret(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest()
  const rightHash = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftHash, rightHash)
}

/** Compatibilidade para a URL global antiga da i9Place. Novas empresas usam
 * o endpoint com companyId e um segredo exclusivo armazenado em hash. */
export function ensureUazApiWebhookSecret(request: FastifyRequest, config: AppConfig): boolean {
  const expected = config.uazapiWebhookSecret ?? config.webhookToken
  if (!expected) return false
  const query = request.query as { secret?: unknown }
  const supplied = typeof query?.secret === 'string' ? query.secret : request.headers['x-uazapi-webhook-secret']
  return typeof supplied === 'string' && timingSafeSecret(supplied, expected)
}

export async function ensureCompanyUazApiWebhookSecret(
  pool: Pool,
  companyId: string,
  request: FastifyRequest,
): Promise<boolean> {
  const query = request.query as { secret?: unknown }
  const supplied = typeof query?.secret === 'string'
    ? query.secret
    : typeof request.headers['x-uazapi-webhook-secret'] === 'string'
      ? request.headers['x-uazapi-webhook-secret']
      : undefined
  return verifyUazApiWebhookSecret(pool, companyId, supplied)
}

export function normalizeUazApiEvent(payload: unknown): NormalizedUazApiEvent {
  const root = asRecord(payload) ?? {}
  const data = asRecord(root.data)
  const message = asRecord(root.message) ?? asRecord(data?.message)
  const key = asRecord(message?.key) ?? asRecord(data?.key) ?? asRecord(root.key)
  const referral =
    asRecord(root.referral) ??
    asRecord(message?.referral) ??
    asRecord(data?.referral) ??
    asRecord(getPath(message ?? {}, ['contextInfo', 'referral'])) ??
    asRecord(getPath(data ?? {}, ['contextInfo', 'referral']))
  const eventType = firstString(root.event, root.eventType, root.type, data?.event, data?.eventType, 'unknown').toLowerCase()
  const text = firstString(
    root.text,
    root.body,
    root.messageText,
    message?.text,
    message?.body,
    getPath(message ?? {}, ['conversation']),
    getPath(message ?? {}, ['extendedTextMessage', 'text']),
    getPath(message ?? {}, ['imageMessage', 'caption']),
    data?.text,
  )
  const phone = normalizePhone(firstString(
    root.chatid,
    root.chatId,
    root.sender_pn,
    root.sender,
    root.from,
    root.number,
    key?.remoteJid,
    message?.chatid,
    message?.sender,
    data?.chatid,
    data?.sender_pn,
  ))
  const fromMe = firstBoolean(root.fromMe, root.from_me, message?.fromMe, key?.fromMe, data?.fromMe) ?? false
  const providerEventId = firstString(
    root.messageid,
    root.messageId,
    root.id,
    message?.messageid,
    message?.id,
    key?.id,
    data?.messageid,
  ) || null
  const isMessage = Boolean(text || phone) && (eventType.includes('message') || eventType === 'history' || eventType === 'unknown')
  const attribution = {
    ...(firstString(referral?.source_id) ? { adId: firstString(referral?.source_id) } : {}),
    ...(firstString(referral?.ctwa_clid, referral?.ctwaClid) ? { ctwaClid: firstString(referral?.ctwa_clid, referral?.ctwaClid) } : {}),
    ...(firstString(referral?.fbclid) ? { fbclid: firstString(referral?.fbclid) } : {}),
    ...(firstString(referral?.fbp, referral?._fbp) ? { fbp: firstString(referral?.fbp, referral?._fbp) } : {}),
    ...(firstString(referral?.fbc, referral?._fbc) ? { fbc: firstString(referral?.fbc, referral?._fbc) } : {}),
    ...(firstString(referral?.source_url, referral?.sourceUrl) ? { sourceUrl: firstString(referral?.source_url, referral?.sourceUrl) } : {}),
    ...(firstString(referral?.source_type, referral?.sourceType) ? { sourceType: firstString(referral?.source_type) } : {}),
  }
  return {
    eventType,
    providerEventId,
    isMessage,
    name: firstString(root.senderName, root.pushName, root.name, message?.senderName, data?.senderName, 'Contato WhatsApp') || 'Contato WhatsApp',
    phone,
    text,
    direction: fromMe ? 'outgoing' : 'incoming',
    at: toDate(firstString(root.messageTimestamp, root.timestamp, message?.messageTimestamp, data?.messageTimestamp) || root.timestamp),
    attribution,
    payload: root,
  }
}

export async function recordUazApiEvent(
  pool: Pool,
  companyId: string,
  event: NormalizedUazApiEvent,
): Promise<boolean> {
  const id = `uazapi_event_${randomUUID()}`
  const result = await pool.query(
    `insert into whatsapp_events (id, company_id, provider, provider_event_id, event_type, payload)
     values ($1, $2, 'uazapi', $3, $4, $5)
     on conflict (company_id, provider, provider_event_id) where provider_event_id is not null do nothing`,
    [id, companyId, event.providerEventId, event.eventType, event.payload],
  )
  return result.rowCount === 1
}

export function publicUazApiState(state: WhatsAppState): WhatsAppState {
  return {
    ...state,
    // QR code e pair code só chegam a uma sessão autenticada do workspace.
    qrcode: state.qrcode,
    paircode: state.paircode,
  }
}
