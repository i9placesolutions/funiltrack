import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { randomUUID } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import type { AppConfig } from './config.js'

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
    sourceUrl?: string
    sourceType?: string
  }
  payload: JsonRecord
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
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

function keyFromConfig(config: AppConfig): Buffer {
  if (!config.uazapiEncryptionKey) {
    throw new UazApiConfigurationError(
      'UAZAPI_ENCRYPTION_KEY é obrigatório para armazenar um token criado pela API.',
    )
  }
  return createHash('sha256').update(config.uazapiEncryptionKey).digest()
}

function encryptToken(token: string, config: AppConfig): string {
  const key = keyFromConfig(config)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.')
}

function decryptToken(encoded: string, config: AppConfig): string {
  const [ivText, tagText, ciphertextText] = encoded.split('.')
  if (!ivText || !tagText || !ciphertextText) throw new UazApiConfigurationError('Token UazAPI armazenado inválido.')
  const decipher = createDecipheriv('aes-256-gcm', keyFromConfig(config), Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

function stringifyErrorPayload(payload: unknown): string {
  const record = asRecord(payload)
  const message = firstString(record?.message, record?.error, record?.response)
  return (message || 'A UazAPI recusou a operação.').slice(0, 500)
}

async function callUazApi<T>(
  config: AppConfig,
  token: string,
  path: string,
  options: { method?: 'GET' | 'POST' | 'DELETE'; body?: JsonRecord; admin?: boolean } = {},
): Promise<T> {
  const response = await fetch(`${config.uazapiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      [options.admin ? 'admintoken' : 'token']: token,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
  const text = await response.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  if (!response.ok) throw new UazApiError(stringifyErrorPayload(payload), response.status)
  return payload as T
}

async function getToken(pool: Pool, config: AppConfig): Promise<string | null> {
  const result = await pool.query<{ token_encrypted: string | null }>(
    `select token_encrypted from whatsapp_instances where id = 'default'`,
  )
  const encrypted = result.rows[0]?.token_encrypted
  if (encrypted) return decryptToken(encrypted, config)
  return config.uazapiToken ?? null
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
  config: AppConfig,
  state: Omit<WhatsAppState, 'configured'>,
  options: { error?: string | null; tokenEncrypted?: string | null } = {},
): Promise<WhatsAppState> {
  await pool.query(
    `insert into whatsapp_instances
      (id, provider, name, token_encrypted, status, qrcode, paircode, jid, profile_name,
       profile_pic_url, last_error, updated_at)
     values ('default', 'uazapi', $1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     on conflict (id) do update set
       name = excluded.name,
       token_encrypted = coalesce(excluded.token_encrypted, whatsapp_instances.token_encrypted),
       status = excluded.status,
       qrcode = excluded.qrcode,
       paircode = excluded.paircode,
       jid = excluded.jid,
       profile_name = excluded.profile_name,
       profile_pic_url = excluded.profile_pic_url,
       last_error = excluded.last_error,
       updated_at = now()`,
    [
      state.instanceName || config.uazapiInstanceName,
      options.tokenEncrypted ?? null,
      state.status,
      state.qrcode,
      state.paircode,
      state.jid,
      state.profileName,
      state.profilePicUrl,
      options.error === undefined ? state.lastError : options.error,
    ],
  )
  return {
    configured: true,
    ...state,
    lastError: options.error === undefined ? state.lastError : options.error,
  }
}

export async function getWhatsAppState(pool: Pool, config: AppConfig): Promise<WhatsAppState> {
  const local = await pool.query<Record<string, unknown>>(
    `select name, status, qrcode, paircode, jid, profile_name, profile_pic_url, last_error, updated_at
       from whatsapp_instances where id = 'default'`,
  )
  const row = local.rows[0]
  const token = await getToken(pool, config)
  if (!token) {
    return {
      configured: false,
      instanceName: firstString(row?.name, config.uazapiInstanceName) || config.uazapiInstanceName,
      status: firstString(row?.status, 'not_configured'),
      connected: false,
      loggedIn: false,
      jid: firstString(row?.jid) || null,
      qrcode: firstString(row?.qrcode) || null,
      paircode: firstString(row?.paircode) || null,
      profileName: firstString(row?.profile_name) || null,
      profilePicUrl: firstString(row?.profile_pic_url) || null,
      lastError: firstString(row?.last_error) || null,
      updatedAt: row?.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
    }
  }
  const payload = await callUazApi<JsonRecord>(config, token, '/instance/status')
  const state = stateFromPayload(payload, config.uazapiInstanceName)
  return persistState(pool, config, state)
}

export async function connectWhatsApp(
  pool: Pool,
  config: AppConfig,
  body: JsonRecord,
): Promise<WhatsAppState> {
  const token = await getToken(pool, config)
  if (!token) throw new UazApiConfigurationError('Configure UAZAPI_TOKEN ou crie a instância com UAZAPI_ADMIN_TOKEN.')
  const payload = await callUazApi<JsonRecord>(config, token, '/instance/connect', {
    method: 'POST',
    body,
  })
  const state = stateFromPayload(payload, config.uazapiInstanceName)
  return persistState(pool, config, state)
}

export async function disconnectWhatsApp(pool: Pool, config: AppConfig): Promise<WhatsAppState> {
  const token = await getToken(pool, config)
  if (!token) throw new UazApiConfigurationError('WhatsApp ainda não está configurado.')
  const payload = await callUazApi<JsonRecord>(config, token, '/instance/disconnect', { method: 'POST' })
  return persistState(pool, config, stateFromPayload(payload, config.uazapiInstanceName))
}

export async function sendWhatsAppText(
  pool: Pool,
  config: AppConfig,
  body: JsonRecord,
): Promise<JsonRecord> {
  const token = await getToken(pool, config)
  if (!token) throw new UazApiConfigurationError('Configure a UazAPI antes de enviar mensagens.')
  return callUazApi<JsonRecord>(config, token, '/send/text', { method: 'POST', body })
}

export async function configureWhatsAppWebhook(
  pool: Pool,
  config: AppConfig,
): Promise<{ configured: boolean; urlPath: string }> {
  const token = await getToken(pool, config)
  if (!token) throw new UazApiConfigurationError('Configure a UazAPI antes de configurar o webhook.')
  if (!config.appPublicUrl) throw new UazApiConfigurationError('APP_PUBLIC_URL precisa ser configurada para registrar o webhook.')
  const secret = config.uazapiWebhookSecret ?? config.webhookToken
  if (!secret) throw new UazApiConfigurationError('Configure UAZAPI_WEBHOOK_SECRET ou WEBHOOK_TOKEN antes do webhook.')
  const configuredTarget = config.n8nUazapiWebhookUrl
    ? new URL(config.n8nUazapiWebhookUrl)
    : new URL('/api/whatsapp/uazapi-webhook', config.appPublicUrl)
  configuredTarget.searchParams.set('secret', secret)
  await callUazApi(config, token, '/webhook', {
    method: 'POST',
    body: {
      enabled: true,
      url: configuredTarget.toString(),
      events: ['messages', 'messages_update', 'connection', 'history'],
      excludeMessages: ['wasSentByApi'],
      addUrlEvents: false,
      addUrlTypesMessages: false,
    },
  })
  return { configured: true, urlPath: configuredTarget.pathname }
}

export async function createWhatsAppInstance(
  pool: Pool,
  config: AppConfig,
): Promise<{ created: boolean; instanceName: string }> {
  if (!config.uazapiAdminToken) throw new UazApiConfigurationError('UAZAPI_ADMIN_TOKEN não configurado.')
  keyFromConfig(config)
  const payload = await callUazApi<JsonRecord>(config, config.uazapiAdminToken, '/instance/create', {
    method: 'POST',
    admin: true,
    body: { name: config.uazapiInstanceName },
  })
  const instance = asRecord(payload.instance) ?? {}
  const token = firstString(payload.token, instance.token)
  if (!token) throw new UazApiError('A UazAPI não retornou o token da instância.')
  const state = stateFromPayload(payload, config.uazapiInstanceName)
  await persistState(pool, config, state, { tokenEncrypted: encryptToken(token, config) })
  return { created: true, instanceName: state.instanceName }
}

function timingSafeSecret(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest()
  const rightHash = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftHash, rightHash)
}

export function ensureUazApiWebhookSecret(request: FastifyRequest, config: AppConfig): boolean {
  const expected = config.uazapiWebhookSecret ?? config.webhookToken
  if (!expected) return false
  const query = request.query as { secret?: unknown }
  const supplied = typeof query?.secret === 'string' ? query.secret : request.headers['x-uazapi-webhook-secret']
  return typeof supplied === 'string' && timingSafeSecret(supplied, expected)
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
    ...(firstString(referral?.source_url, referral?.sourceUrl) ? { sourceUrl: firstString(referral?.source_url, referral?.sourceUrl) } : {}),
    ...(firstString(referral?.source_type, referral?.sourceType) ? { sourceType: firstString(referral?.source_type, referral?.sourceType) } : {}),
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
  event: NormalizedUazApiEvent,
): Promise<boolean> {
  const id = `uazapi_event_${randomUUID()}`
  const result = await pool.query(
    `insert into whatsapp_events (id, provider, provider_event_id, event_type, payload)
     values ($1, 'uazapi', $2, $3, $4)
     on conflict (provider, provider_event_id) where provider_event_id is not null do nothing`,
    [id, event.providerEventId, event.eventType, event.payload],
  )
  return result.rowCount === 1
}

export function publicUazApiState(state: WhatsAppState): WhatsAppState {
  return {
    ...state,
    // QR code and pair code are intentionally returned only to authenticated UI users.
    qrcode: state.qrcode,
    paircode: state.paircode,
  }
}
