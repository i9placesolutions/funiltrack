import cors from '@fastify/cors'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isIP } from 'node:net'
import { resolve } from 'node:path'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import type { AppConfig } from './config.js'
import { checkDatabase, withTransaction } from './db.js'
import { RedisCache } from './redis.js'
import {
  attachAuthUser,
  authUserFromRequest,
  clearSessionCookie,
  createSession,
  deleteAllUserSessions,
  deleteSession,
  getSessionUser,
  hashPassword,
  hasUsers,
  isApiTokenRequest,
  normalizeEmail,
  setSessionCookie,
  validatePassword,
  verifyPassword,
} from './auth.js'
import {
  UazApiConfigurationError,
  UazApiError,
  configureWhatsAppWebhook,
  connectWhatsApp,
  createWhatsAppInstance,
  disconnectWhatsApp,
  ensureCompanyUazApiWebhookSecret,
  ensureUazApiWebhookSecret,
  getWhatsAppState,
  normalizeUazApiEvent,
  publicUazApiState,
  recordUazApiEvent,
  sendWhatsAppText,
} from './uazapi.js'
import {
  MetaApiError,
  MetaConfigurationError,
  conversionEventForStage,
  enqueueMetaConversionEvent,
  getMetaStatus,
  listMetaConversionEvents,
  processAllPendingMetaConversions,
  processPendingMetaConversions,
  syncAllMetaAds,
  syncMetaAds,
} from './meta.js'
import {
  IntegrationConfigurationError,
  saveMetaIntegration,
  saveUazApiIntegration,
} from './integrations.js'
import {
  MetaOAuthConfigurationError,
  MetaOAuthError,
  completeMetaBusinessLogin,
  getMetaBusinessLoginAssets,
  getMetaBusinessLoginTrackingAssets,
  handleMetaBusinessLoginCallback,
  metaOAuthResultRedirect,
  startMetaBusinessLogin,
} from './metaOAuth.js'
import {
  addCompanyMember,
  CompanyAccessError,
  completeCompanyOnboarding,
  createCompany,
  listCompanyMembers,
  listCompaniesForUser,
  removeCompanyMember,
  requireCompanyRole,
  resolveCompanyContext,
  updateCompanyName,
} from './tenancy.js'

const LEAD_STAGES = ['novo', 'contato', 'qualificado', 'vendido', 'perdido'] as const
const ALERT_TYPES = [
  'LEAD_SEM_RESPOSTA',
  'ORCAMENTO_ESTOURADO',
  'CPL_ACIMA_MEDIA',
  'QUEDA_ENTREGA',
] as const
const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const
type DbRow = Record<string, unknown>
type Queryable = Pool | PoolClient

class NotFoundError extends Error {}

class WebhookAuthError extends Error {}

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato YYYY-MM-DD.')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: 'Data inválida.',
  })

const leadListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  page_size: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().trim().max(120).optional(),
  stage: z.enum(LEAD_STAGES).optional(),
  campaign_id: z.string().trim().min(1).max(120).optional(),
  utm_source: z.string().trim().min(1).max(120).optional(),
})

const metricsQuerySchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
  campaign_id: z.string().trim().min(1).max(120).optional(),
})

const stageBodySchema = z.object({ stage: z.enum(LEAD_STAGES) })

const whatsappWebhookSchema = z.object({
  companyId: z.string().trim().min(1).max(180).optional(),
  id: z.string().trim().min(1).max(180).optional(),
  leadId: z.string().trim().min(1).max(180).optional(),
  name: z.string().trim().min(1).max(180),
  phone: z.string().trim().min(5).max(80),
  text: z.string().trim().min(1).max(10_000),
  direction: z.enum(['incoming', 'outgoing', 'received', 'sent']).default('incoming'),
  at: z.string().datetime({ offset: true }).optional(),
  campaignId: z.string().trim().min(1).max(120).optional(),
  adSetId: z.string().trim().min(1).max(120).optional(),
  adId: z.string().trim().min(1).max(120).optional(),
  utmSource: z.string().trim().max(120).optional(),
  utmMedium: z.string().trim().max(120).optional(),
  utmCampaign: z.string().trim().max(120).optional(),
  ctwaClid: z.string().trim().max(240).optional(),
  fbclid: z.string().trim().max(240).optional(),
  fbp: z.string().trim().max(600).optional(),
  fbc: z.string().trim().max(800).optional(),
  sourceUrl: z.string().trim().url().max(2_000).optional(),
  // Estes dois campos devem vir do navegador do visitante ou do servidor
  // first-party que recebeu o formulário; nunca da infraestrutura UazAPI/n8n.
  clientIp: z.string().trim().max(64).optional(),
  clientUserAgent: z.string().trim().max(1_024).optional(),
})

const alertWebhookSchema = z.object({
  companyId: z.string().trim().min(1).max(180).optional(),
  id: z.string().trim().min(1).max(180).optional(),
  type: z.enum(ALERT_TYPES),
  severity: z.enum(ALERT_SEVERITIES),
  title: z.string().trim().min(1).max(240),
  message: z.string().trim().min(1).max(10_000),
  createdAt: z.string().datetime({ offset: true }).optional(),
  read: z.boolean().default(false),
  refId: z.string().trim().min(1).max(180).optional(),
})

const metricWebhookSchema = z.object({
  companyId: z.string().trim().min(1).max(180).optional(),
  campaignId: z.string().trim().min(1).max(120),
  date: dateOnlySchema,
  impressions: z.coerce.number().int().min(0),
  clicks: z.coerce.number().int().min(0),
  spend: z.coerce.number().int().min(0),
  leads: z.coerce.number().int().min(0),
  ctr: z.coerce.number().min(0),
  cpc: z.coerce.number().int().min(0),
  cpl: z.coerce.number().int().min(0),
  roas: z.coerce.number().min(0),
})

const metaSyncSchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
})

const metaConversionsProcessSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

const metaConversionEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(15),
})

const metaOAuthSessionParamsSchema = z.object({
  sessionId: z.string().trim().regex(/^meta_oauth_[a-f0-9]{24}$/),
})

const metaOAuthTrackingAssetsQuerySchema = z.object({
  ad_account_id: z.string().trim().min(1).max(120),
})

const metaOAuthCompleteSchema = z.object({
  adAccountId: z.string().trim().min(1).max(120),
  datasetId: z.string().trim().min(1).max(120),
})

const metaOAuthCallbackQuerySchema = z.object({
  state: z.string().trim().min(1).max(300).optional(),
  code: z.string().trim().min(1).max(4_000).optional(),
  error: z.string().trim().min(1).max(120).optional(),
})

const authRegisterSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.').max(120),
  companyName: z.string().trim().min(2, 'Informe o nome da empresa.').max(120).optional(),
  email: z.string().trim().email('Informe um e-mail válido.').max(240),
  password: z.string().min(1, 'Informe uma senha.').max(128),
})

const authLoginSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido.').max(240),
  password: z.string().min(1, 'Informe sua senha.').max(128),
})

const authChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual.'),
  newPassword: z.string().min(1, 'Informe a nova senha.').max(128),
})

const companyCreateSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da empresa.').max(120),
})

const companyUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da empresa.').max(120),
})

const companyMemberSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido.').max(240),
  role: z.enum(['owner', 'admin', 'member']),
})

const metaIntegrationSchema = z.object({
  adAccountId: z.string().trim().min(1, 'Informe a conta de anúncios.').max(120),
  accessToken: z.string().trim().min(1).max(2_000).optional(),
  datasetId: z.string().trim().max(120).optional(),
  pixelId: z.string().trim().max(120).optional(),
  currency: z.string().trim().length(3).optional(),
  testEventCode: z.string().trim().max(240).optional(),
})

const uazApiIntegrationSchema = z.object({
  baseUrl: z.string().trim().url('Informe a URL da UazAPI.'),
  instanceName: z.string().trim().min(1, 'Informe o nome da instância.').max(80),
  token: z.string().trim().min(1).max(2_000).optional(),
})

const dataDeletionRequestSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido.').max(240),
  name: z.string().trim().min(1).max(120).optional(),
  details: z.string().trim().min(1).max(1_000).optional(),
})

const whatsappConnectSchema = z.object({
  phone: z.string().trim().regex(/^\d{10,15}$/, 'Telefone deve estar em formato internacional.').optional(),
  browser: z.enum(['auto', 'safari', 'firefox', 'edge', 'chrome']).optional(),
  systemName: z.string().trim().max(80).optional(),
  proxy_managed_country: z.string().trim().regex(/^[a-z]{2}$/).optional(),
  proxy_managed_state: z.string().trim().max(80).optional(),
  proxy_managed_city: z.string().trim().max(120).optional(),
})

const whatsappSendTextSchema = z.object({
  number: z.string().trim().min(5).max(120),
  text: z.string().trim().min(1).max(10_000),
  replyid: z.string().trim().max(180).optional(),
  linkPreview: z.boolean().optional(),
  delay: z.number().int().min(0).max(120_000).optional(),
})

function numberValue(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : 0
}

function textValue(value: unknown, fallback = ''): string {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : fallback
}

function optionalTextValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function dateOnlyValue(value: unknown): string {
  const text = textValue(value)
  return text.length >= 10 ? text.slice(0, 10) : text
}

function mapCampaign(row: DbRow) {
  return {
    id: textValue(row.id),
    name: textValue(row.name),
    status: textValue(row.status),
    objective: textValue(row.objective),
    dailyBudget: numberValue(row.daily_budget_cents),
    spend: numberValue(row.spend_cents),
    startDate: dateOnlyValue(row.start_date),
    ...(row.end_date ? { endDate: dateOnlyValue(row.end_date) } : {}),
  }
}

function recordValue(value: unknown): DbRow {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as DbRow
    : {}
}

function safeIso(value: unknown): string | null {
  const candidate = textValue(value)
  const date = new Date(candidate)
  return candidate && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}

function maskedIp(value: string): string {
  if (isIP(value) === 4) {
    const [first = '', second = '', third = ''] = value.split('.')
    return `${first}.${second}.${third}.***`
  }
  const prefix = value.split(':').filter(Boolean).slice(0, 2).join(':')
  return prefix ? `${prefix}::••••` : 'IPv6 protegido'
}

function mapLeadTracking(row: DbRow, includeFullIp: boolean) {
  const attribution = recordValue(row.attribution)
  const clientIp = normalizeClientIp(textValue(attribution.clientIp))
  const source = attribution.clientIpSource === 'browser_request' || attribution.clientIpSource === 'first_party_payload'
    ? attribution.clientIpSource
    : clientIp
      ? 'first_party_payload'
      : null
  const version = clientIp ? isIP(clientIp) : 0
  return {
    clientIp: includeFullIp ? clientIp ?? null : null,
    maskedIp: clientIp ? maskedIp(clientIp) : null,
    fullIpVisible: Boolean(clientIp && includeFullIp),
    ipVersion: version === 4 ? 'IPv4' : version === 6 ? 'IPv6' : null,
    ipSource: source,
    capturedAt: safeIso(attribution.trackingCapturedAt),
    clientUserAgentCaptured: Boolean(normalizeClientUserAgent(textValue(attribution.clientUserAgent))),
    fbpCaptured: Boolean(textValue(attribution.fbp)),
    fbcCaptured: Boolean(textValue(attribution.fbc)),
    fbclidCaptured: Boolean(textValue(attribution.fbclid)),
    ctwaClidCaptured: Boolean(textValue(attribution.ctwaClid)),
    sourceUrl: textValue(attribution.sourceUrl) || null,
  }
}

function mapLead(
  row: DbRow,
  options: { includeTracking?: boolean; includeFullIp?: boolean } = {},
) {
  const timeline = Array.isArray(row.timeline) ? row.timeline : []
  return {
    id: textValue(row.id),
    name: textValue(row.name),
    phone: textValue(row.phone),
    stage: textValue(row.stage, 'novo'),
    utmSource: textValue(row.utm_source),
    utmMedium: textValue(row.utm_medium),
    utmCampaign: textValue(row.utm_campaign),
    campaignId: textValue(row.campaign_id),
    adSetId: textValue(row.ad_set_id),
    adId: textValue(row.ad_id),
    createdAt: new Date(textValue(row.created_at)).toISOString(),
    lastMessageAt: row.last_message_at
      ? new Date(textValue(row.last_message_at)).toISOString()
      : null,
    value: numberValue(row.value_cents),
    timeline: timeline.map((event) => {
      const item = event as DbRow
      return {
        id: textValue(item.id),
        type: textValue(item.type),
        text: textValue(item.text),
        at: new Date(textValue(item.at)).toISOString(),
      }
    }),
    ...(options.includeTracking
      ? { tracking: mapLeadTracking(row, Boolean(options.includeFullIp)) }
      : {}),
  }
}

function mapAlert(row: DbRow) {
  return {
    id: textValue(row.id),
    type: textValue(row.type),
    severity: textValue(row.severity),
    title: textValue(row.title),
    message: textValue(row.message),
    createdAt: new Date(textValue(row.created_at)).toISOString(),
    read: Boolean(row.read),
    ...(optionalTextValue(row.ref_id) ? { refId: textValue(row.ref_id) } : {}),
  }
}

function mapMetric(row: DbRow) {
  return {
    campaignId: textValue(row.campaign_id),
    date: dateOnlyValue(row.metric_date),
    impressions: numberValue(row.impressions),
    clicks: numberValue(row.clicks),
    spend: numberValue(row.spend_cents),
    leads: numberValue(row.leads),
    ctr: numberValue(row.ctr),
    cpc: numberValue(row.cpc_cents),
    cpl: numberValue(row.cpl_cents),
    roas: numberValue(row.roas),
  }
}

function jsonError(reply: FastifyReply, statusCode: number, message: string, details?: unknown) {
  return reply.code(statusCode).send({
    error: statusCode >= 500 ? 'internal_error' : 'request_error',
    message,
    ...(details ? { details } : {}),
  })
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(body)
  if (result.success) return result.data
  jsonError(reply, 400, 'Dados inválidos.', result.error.flatten())
  return null
}

function parseQuery<T>(schema: z.ZodType<T>, query: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(query)
  if (result.success) return result.data
  jsonError(reply, 400, 'Parâmetros inválidos.', result.error.flatten())
  return null
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '')
}

function isIncoming(direction: 'incoming' | 'outgoing' | 'received' | 'sent'): boolean {
  return direction === 'incoming' || direction === 'received'
}

async function findExistingId(
  client: PoolClient,
  table: 'campaigns' | 'ad_sets' | 'ads',
  companyId: string,
  value: string | undefined,
): Promise<string | null> {
  if (!value) return null
  const result = await client.query<{ id: string }>(
    `select id from ${table} where company_id = $1 and id = $2`,
    [companyId, value],
  )
  return result.rows[0]?.id ?? null
}

async function fetchLeadById(queryable: Queryable, companyId: string, id: string): Promise<DbRow | null> {
  const result = await queryable.query<DbRow>(
    `
      select
        l.id,
        l.name,
        l.phone,
        l.stage,
        l.utm_source,
        l.utm_medium,
        l.utm_campaign,
        l.campaign_id,
        l.ad_set_id,
        l.ad_id,
        l.created_at,
        l.last_message_at,
        l.value_cents,
        l.attribution,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', e.id,
              'type', e.type,
              'text', e.text,
              'at', e.occurred_at
            ) order by e.occurred_at, e.id
          ) filter (where e.id is not null),
          '[]'::jsonb
        ) as timeline
      from leads l
      left join lead_events e on e.company_id = l.company_id and e.lead_id = l.id
      where l.company_id = $1 and l.id = $2
      group by l.id
    `,
    [companyId, id],
  )
  return result.rows[0] ?? null
}

function requestHeaderValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}

interface LeadRequestContext {
  clientIp?: string
  clientUserAgent?: string
  clientIpSource?: 'browser_request'
}

function normalizeClientIp(value: string | undefined): string | undefined {
  if (!value) return undefined
  const candidate = value.split(',')[0]?.trim() ?? ''
  return isIP(candidate) ? candidate : undefined
}

function normalizeClientUserAgent(value: string | undefined): string | undefined {
  const candidate = value?.trim().slice(0, 1_024)
  return candidate || undefined
}

function looksLikeBrowserUserAgent(value: string | undefined): boolean {
  return Boolean(value && /mozilla\/|applewebkit\/|chrome\/|safari\/|firefox\/|edg\//i.test(value))
}

/**
 * Apenas usa o IP/UA do request quando ele realmente parece vir de um browser.
 * Webhooks UazAPI e n8n não carregam o IP/UA do lead e não podem ser usados
 * como substitutos: isso prejudicaria o matching da Meta.
 */
function leadRequestContext(request: FastifyRequest): LeadRequestContext {
  const clientUserAgent = normalizeClientUserAgent(requestHeaderValue(request, 'user-agent'))
  if (!looksLikeBrowserUserAgent(clientUserAgent)) return {}
  return {
    clientIp: normalizeClientIp(request.ip),
    clientUserAgent,
    clientIpSource: 'browser_request',
  }
}

function fbclidFromSourceUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value).searchParams.get('fbclid')?.trim() || undefined
  } catch {
    return undefined
  }
}

function fbcFromAttribution(
  fbc: string | undefined,
  fbclid: string | undefined,
  at: Date,
): string | undefined {
  if (fbc?.trim()) return fbc.trim()
  if (!fbclid?.trim()) return undefined
  // Formato oficial do _fbc quando a origem fornece fbclid e ainda não há
  // cookie. O timestamp é o momento em que o clique/lead foi recebido.
  return `fb.1.${at.getTime()}.${fbclid.trim()}`
}

function ensureWebhookAuth(request: FastifyRequest, config: AppConfig): void {
  if (!config.webhookToken) {
    throw new WebhookAuthError('WEBHOOK_TOKEN não configurado.')
  }
  if (requestHeaderValue(request, 'x-webhook-token') !== config.webhookToken) {
    throw new WebhookAuthError('Token do webhook inválido.')
  }
}

function corsOriginValue(config: AppConfig): boolean | string[] {
  if (config.corsOrigin.trim() === '*') return true
  return config.corsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function providerErrorStatus(error: unknown): number {
  if (error instanceof CompanyAccessError) return error.statusCode
  if (error instanceof UazApiConfigurationError) return 503
  if (error instanceof IntegrationConfigurationError) return 503
  if (error instanceof MetaOAuthConfigurationError) return 503
  if (error instanceof UazApiError) return Math.max(400, Math.min(error.statusCode, 502))
  if (error instanceof MetaOAuthError) return Math.max(400, Math.min(error.statusCode, 502))
  if (error instanceof MetaConfigurationError) return 503
  if (error instanceof MetaApiError) return Math.max(400, Math.min(error.statusCode, 502))
  return 500
}

async function persistLeadMessage(
  pool: Pool,
  body: z.input<typeof whatsappWebhookSchema>,
  config: AppConfig,
  companyId: string,
  requestContext: LeadRequestContext = {},
): Promise<ReturnType<typeof mapLead>> {
  const phoneDigits = normalizePhone(body.phone)
  if (!phoneDigits) throw new NotFoundError('Telefone inválido.')
  const at = body.at ? new Date(body.at) : new Date()
  const eventType = isIncoming(body.direction ?? 'incoming')
    ? 'mensagem_recebida'
    : 'mensagem_enviada'
  const fbclid = body.fbclid ?? fbclidFromSourceUrl(body.sourceUrl)
  const fbc = fbcFromAttribution(body.fbc, fbclid, at)
  const suppliedClientIp = normalizeClientIp(body.clientIp)
  const clientIp = suppliedClientIp ?? requestContext.clientIp
  const clientUserAgent = normalizeClientUserAgent(body.clientUserAgent) ?? requestContext.clientUserAgent
  const clientIpSource = suppliedClientIp
    ? 'first_party_payload'
    : clientIp
      ? requestContext.clientIpSource
      : undefined
  const attribution = JSON.stringify({
    ...(body.utmSource ? { utmSource: body.utmSource } : {}),
    ...(body.utmMedium ? { utmMedium: body.utmMedium } : {}),
    ...(body.utmCampaign ? { utmCampaign: body.utmCampaign } : {}),
    ...(body.ctwaClid ? { ctwaClid: body.ctwaClid } : {}),
    ...(fbclid ? { fbclid } : {}),
    ...(body.fbp ? { fbp: body.fbp } : {}),
    ...(fbc ? { fbc } : {}),
    ...(body.sourceUrl ? { sourceUrl: body.sourceUrl } : {}),
    ...(clientIp ? { clientIp } : {}),
    ...(clientIpSource ? { clientIpSource } : {}),
    ...(clientUserAgent ? { clientUserAgent } : {}),
    ...(clientIp || clientUserAgent ? { trackingCapturedAt: at.toISOString() } : {}),
  })
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{ id: string }>(
      'select id from leads where company_id = $1 and phone_digits = $2 for update',
      [companyId, phoneDigits],
    )
    let leadId = existing.rows[0]?.id
    if (!leadId) {
      leadId = body.leadId ?? `lead_${randomUUID()}`
      const campaignId = await findExistingId(client, 'campaigns', companyId, body.campaignId)
      const adSetId = await findExistingId(client, 'ad_sets', companyId, body.adSetId)
      const adId = await findExistingId(client, 'ads', companyId, body.adId)
      await client.query(
        `insert into leads
          (company_id, id, name, phone, phone_digits, stage, utm_source, utm_medium, utm_campaign,
           campaign_id, ad_set_id, ad_id, created_at, last_message_at, value_cents, attribution)
         values ($1, $2, $3, $4, $5, 'novo', $6, $7, $8, $9, $10, $11, $12, $12, 0, $13::jsonb)`,
        [
          companyId,
          leadId,
          body.name,
          body.phone,
          phoneDigits,
          body.utmSource ?? '',
          body.utmMedium ?? '',
          body.utmCampaign ?? '',
          campaignId,
          adSetId,
          adId,
          at,
          attribution,
        ],
      )
      await client.query(
        `insert into lead_events (company_id, id, lead_id, type, text, occurred_at)
         values ($1, $2, $3, 'lead_criado', 'Lead criado via webhook do WhatsApp', $4)`,
        [companyId, `lead_event_${randomUUID()}`, leadId, at],
      )
      await enqueueMetaConversionEvent(client, companyId, leadId, 'Lead', at, 0, config.metaCurrency)
    } else {
      const campaignId = await findExistingId(client, 'campaigns', companyId, body.campaignId)
      const adSetId = await findExistingId(client, 'ad_sets', companyId, body.adSetId)
      const adId = await findExistingId(client, 'ads', companyId, body.adId)
      await client.query(
        `update leads
         set name = $1,
             phone = $2,
             last_message_at = greatest(coalesce(last_message_at, $3), $3),
             utm_source = coalesce(nullif($4, ''), utm_source),
             utm_medium = coalesce(nullif($5, ''), utm_medium),
             utm_campaign = coalesce(nullif($6, ''), utm_campaign),
             campaign_id = coalesce($7, campaign_id),
             ad_set_id = coalesce($8, ad_set_id),
             ad_id = coalesce($9, ad_id),
             attribution = coalesce(attribution, '{}'::jsonb) || $10::jsonb,
             updated_at = now()
         where company_id = $11 and id = $12`,
        [body.name, body.phone, at, body.utmSource ?? '', body.utmMedium ?? '', body.utmCampaign ?? '', campaignId, adSetId, adId, attribution, companyId, leadId],
      )
    }

    await client.query(
      `insert into lead_events (company_id, id, lead_id, type, text, occurred_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do nothing`,
      [companyId, body.id ?? `lead_event_${randomUUID()}`, leadId, eventType, body.text, at],
    )
    const saved = await fetchLeadById(client, companyId, leadId)
    if (!saved) throw new NotFoundError('Lead criado, mas não pôde ser lido.')
    return mapLead(saved)
  })
}

export interface AppDependencies {
  pool: Pool
  cache: RedisCache
  config: AppConfig
}

export async function buildApp({ pool, cache, config }: AppDependencies): Promise<FastifyInstance> {
  // Em produção o Coolify entrega X-Forwarded-For pelo proxy público. Em
  // desenvolvimento não confiamos nesse header, evitando IPs forjados locais.
  const app = Fastify({ logger: true, trustProxy: config.nodeEnv === 'production' })

  await app.register(fastifyCookie)
  await app.register(cors, {
    origin: corsOriginValue(config),
    credentials: true,
  })

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return
    if (request.method === 'OPTIONS') return
    if (request.url.startsWith('/api/health')) return
    if (request.url.startsWith('/api/webhooks/')) return
    if (request.url.startsWith('/api/whatsapp/uazapi-webhook')) return
    const routePath = request.url.split('?')[0]
    if (
      routePath === '/api/auth/login' ||
      routePath === '/api/auth/register' ||
      routePath === '/api/auth/me' ||
      routePath === '/api/auth/logout' ||
      routePath === '/api/meta/oauth/callback' ||
      routePath === '/api/privacy/deletion-requests'
    ) return
    if (isApiTokenRequest(request, config)) return
    const user = await getSessionUser(request, pool)
    if (!user) {
      await jsonError(reply, 401, 'Sessão ausente ou expirada.')
      return
    }
    attachAuthUser(request, user)
  })

  const authSessionPayload = async (
    user: { id: unknown; name: unknown; email: unknown; role: unknown },
    request?: FastifyRequest,
  ) => {
    const companies = await listCompaniesForUser(pool, String(user.id))
    const requested = request ? requestHeaderValue(request, 'x-funiltrack-company-id') : undefined
    const activeCompanyId = companies.some((company) => company.id === requested)
      ? requested
      : companies[0]?.id ?? null
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      companies,
      activeCompanyId,
    }
  }

  // A fila CAPI continua protegida por lock/idempotência no banco. Este disparo
  // reduz o atraso após uma mensagem ou troca de estágio; o scheduler e o n8n
  // permanecem como recuperação caso o processo esteja reiniciando.
  const processMetaConversionsSoon = (companyId: string) => {
    void processPendingMetaConversions(pool, config, companyId, 25)
      .then((summary) => {
        if (summary.failed > 0) {
          app.log.warn({ companyId, failed: summary.failed }, 'Conversões Meta ficaram pendentes para nova tentativa')
        }
      })
      .catch((error: unknown) => {
        app.log.warn(
          { companyId, error: error instanceof Error ? error.message.slice(0, 300) : 'erro desconhecido' },
          'Não foi possível processar a fila Meta agora; será tentado novamente',
        )
      })
  }

  app.get('/api/auth/me', async (request, reply) => {
    const user = await getSessionUser(request, pool)
    if (!user) return jsonError(reply, 401, 'Sessão ausente ou expirada.')
    return reply.send(await authSessionPayload(user, request))
  })

  app.post('/api/auth/register', async (request, reply) => {
    const body = parseBody(authRegisterSchema, request.body, reply)
    if (!body) return
    const passwordError = validatePassword(body.password)
    if (passwordError) return jsonError(reply, 400, passwordError)
    const alreadyHasUsers = await hasUsers(pool)
    if (alreadyHasUsers && !config.authAllowRegistration) {
      return jsonError(reply, 403, 'O cadastro de novos usuários está desativado.')
    }
    const email = normalizeEmail(body.email)
    const passwordHash = await hashPassword(body.password)
    const userId = `user_${randomUUID()}`
    try {
      const user = await withTransaction(pool, async (client) => {
        const result = await client.query<Record<string, unknown>>(
          `insert into users (id, name, email, password_hash, role)
           values ($1, $2, $3, $4, $5)
           returning id, name, email, role`,
          [userId, body.name, email, passwordHash, alreadyHasUsers ? 'member' : 'owner'],
        )
        await createCompany(client, userId, body.companyName ?? `Workspace de ${body.name}`)
        return result.rows[0]
      })
      const token = await createSession(pool, userId, config)
      setSessionCookie(reply, token, config)
      return reply.code(201).send(await authSessionPayload(user as { id: unknown; name: unknown; email: unknown; role: unknown }, request))
    } catch (error) {
      if (error instanceof Error && /users_email_lower_uidx|duplicate key/i.test(error.message)) {
        return jsonError(reply, 409, 'Este e-mail já está cadastrado.')
      }
      throw error
    }
  })

  app.post('/api/auth/login', async (request, reply) => {
    const body = parseBody(authLoginSchema, request.body, reply)
    if (!body) return
    const result = await pool.query<Record<string, unknown>>(
      `select id, name, email, role, password_hash
         from users where lower(email) = $1 and active = true`,
      [normalizeEmail(body.email)],
    )
    const row = result.rows[0]
    if (!row || !(await verifyPassword(body.password, String(row.password_hash)))) {
      return jsonError(reply, 401, 'E-mail ou senha inválidos.')
    }
    await pool.query('update users set last_login_at = now(), updated_at = now() where id = $1', [row.id])
    const token = await createSession(pool, String(row.id), config)
    setSessionCookie(reply, token, config)
    return reply.send(await authSessionPayload(row as { id: unknown; name: unknown; email: unknown; role: unknown }, request))
  })

  app.post('/api/auth/logout', async (request, reply) => {
    await deleteSession(request, pool)
    clearSessionCookie(reply)
    return reply.send({ ok: true })
  })

  app.post('/api/auth/change-password', async (request, reply) => {
    const user = authUserFromRequest(request)
    if (!user) return jsonError(reply, 401, 'Sessão ausente ou expirada.')
    const body = parseBody(authChangePasswordSchema, request.body, reply)
    if (!body) return
    const passwordError = validatePassword(body.newPassword)
    if (passwordError) return jsonError(reply, 400, passwordError)
    const result = await pool.query<{ password_hash: string }>('select password_hash from users where id = $1', [user.id])
    if (!result.rows[0] || !(await verifyPassword(body.currentPassword, result.rows[0].password_hash))) {
      return jsonError(reply, 400, 'A senha atual está incorreta.')
    }
    await pool.query('update users set password_hash = $1, updated_at = now() where id = $2', [await hashPassword(body.newPassword), user.id])
    await deleteAllUserSessions(pool, user.id)
    const token = await createSession(pool, user.id, config)
    setSessionCookie(reply, token, config)
    return reply.send({ ok: true })
  })

  app.get('/api/companies', async (request, reply) => {
    const user = authUserFromRequest(request)
    if (!user) return jsonError(reply, 401, 'Sessão ausente ou expirada.')
    const companies = await listCompaniesForUser(pool, user.id)
    return reply.send({ companies })
  })

  app.post('/api/companies', async (request, reply) => {
    const user = authUserFromRequest(request)
    if (!user) return jsonError(reply, 401, 'Sessão ausente ou expirada.')
    const body = parseBody(companyCreateSchema, request.body, reply)
    if (!body) return
    const company = await createCompany(pool, user.id, body.name)
    return reply.code(201).send({ company })
  })

  app.get('/api/company', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    return reply.send({ company })
  })

  app.patch('/api/company', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    requireCompanyRole(company, ['owner'])
    const body = parseBody(companyUpdateSchema, request.body, reply)
    if (!body) return
    const updated = await updateCompanyName(pool, company.id, body.name)
    return reply.send({ company: { ...updated, role: company.role } })
  })

  app.post('/api/company/onboarding/complete', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    requireCompanyRole(company, ['owner', 'admin'])
    await completeCompanyOnboarding(pool, company.id)
    return reply.send({ ok: true })
  })

  app.get('/api/company/members', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    return reply.send({ members: await listCompanyMembers(pool, company.id) })
  })

  app.post('/api/company/members', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    requireCompanyRole(company, ['owner'])
    const body = parseBody(companyMemberSchema, request.body, reply)
    if (!body) return
    const member = await addCompanyMember(pool, company.id, body.email, body.role)
    return reply.code(201).send({ member })
  })

  app.delete('/api/company/members/:userId', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    requireCompanyRole(company, ['owner'])
    const params = request.params as { userId?: string }
    if (!params.userId) return jsonError(reply, 400, 'Informe o membro a remover.')
    await removeCompanyMember(pool, company.id, params.userId)
    return reply.send({ ok: true })
  })

  app.put('/api/integrations/meta', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    requireCompanyRole(company, ['owner', 'admin'])
    const body = parseBody(metaIntegrationSchema, request.body, reply)
    if (!body) return
    try {
      await saveMetaIntegration(pool, config, company.id, body)
      return reply.send(await getMetaStatus(pool, config, company.id))
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível salvar a Meta.')
    }
  })

  app.put('/api/integrations/uazapi', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    requireCompanyRole(company, ['owner', 'admin'])
    const body = parseBody(uazApiIntegrationSchema, request.body, reply)
    if (!body) return
    try {
      await saveUazApiIntegration(pool, config, company.id, body)
      return reply.send({ saved: true })
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível salvar a UazAPI.')
    }
  })

  app.post('/api/privacy/deletion-requests', async (request, reply) => {
    const body = parseBody(dataDeletionRequestSchema, request.body, reply)
    if (!body) return
    const id = `deletion_request_${randomUUID()}`
    const result = await pool.query<{ id: string; requested_at: Date }>(
      `insert into data_deletion_requests (id, email, name, details)
       values ($1, $2, $3, $4)
       returning id, requested_at`,
      [id, normalizeEmail(body.email), body.name ?? null, body.details ?? null],
    )
    const saved = result.rows[0]
    return reply.code(202).send({
      ok: true,
      requestId: saved.id,
      requestedAt: saved.requested_at.toISOString(),
    })
  })

  app.get('/api/health', async (_request, reply) => {
    const databaseOk = await checkDatabase(pool)
    const redisOk = await cache.ping()
    const redisStatus = cache.enabled ? (redisOk ? 'ok' : 'error') : 'disabled'
    const healthy = databaseOk && (!config.redisRequired || redisOk)
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      database: databaseOk ? 'ok' : 'error',
      redis: redisStatus,
    })
  })

  app.get('/api/health/db', async (_request, reply) => {
    const healthy = await checkDatabase(pool)
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'error',
      database: healthy ? 'ok' : 'error',
    })
  })

  app.get('/api/health/redis', async (_request, reply) => {
    const healthy = cache.enabled ? await cache.ping() : !config.redisRequired
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'error',
      redis: cache.enabled ? (healthy ? 'ok' : 'error') : 'disabled',
    })
  })

  app.get('/api/meta/status', async (request, reply) => {
    try {
      const company = await resolveCompanyContext(request, pool, config)
      return reply.send(await getMetaStatus(pool, config, company.id))
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível consultar a Meta.')
    }
  })

  app.post('/api/meta/oauth/start', async (request, reply) => {
    try {
      const company = await resolveCompanyContext(request, pool, config)
      requireCompanyRole(company, ['owner', 'admin'])
      const user = authUserFromRequest(request)
      if (!user) return jsonError(reply, 401, 'Faça login para conectar os ativos da Meta.')
      return reply.send(await startMetaBusinessLogin(pool, config, company.id, user.id))
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível iniciar a autorização Meta.')
    }
  })

  app.get('/api/meta/oauth/callback', async (request, reply) => {
    const parsed = metaOAuthCallbackQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.redirect(metaOAuthResultRedirect(config, 'error'))
    try {
      const result = await handleMetaBusinessLoginCallback(pool, config, parsed.data)
      return reply.redirect(metaOAuthResultRedirect(config, result.status === 'authorized' ? 'success' : 'error', result.sessionId))
    } catch (error) {
      request.log.warn(
        { error: error instanceof Error ? error.message.slice(0, 300) : 'erro desconhecido' },
        'Callback Meta Business Login não foi concluído',
      )
      return reply.redirect(metaOAuthResultRedirect(config, 'error'))
    }
  })

  app.get('/api/meta/oauth/sessions/:sessionId/assets', async (request, reply) => {
    const params = metaOAuthSessionParamsSchema.safeParse(request.params)
    if (!params.success) return jsonError(reply, 400, 'Sessão Meta inválida.')
    try {
      const company = await resolveCompanyContext(request, pool, config)
      requireCompanyRole(company, ['owner', 'admin'])
      const user = authUserFromRequest(request)
      if (!user) return jsonError(reply, 401, 'Faça login para continuar a autorização Meta.')
      return reply.send(await getMetaBusinessLoginAssets(pool, config, company.id, user.id, params.data.sessionId))
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível ler os ativos da Meta.')
    }
  })

  app.get('/api/meta/oauth/sessions/:sessionId/tracking-assets', async (request, reply) => {
    const params = metaOAuthSessionParamsSchema.safeParse(request.params)
    const query = parseQuery(metaOAuthTrackingAssetsQuerySchema, request.query, reply)
    if (!params.success || !query) {
      if (!params.success) return jsonError(reply, 400, 'Sessão Meta inválida.')
      return
    }
    try {
      const company = await resolveCompanyContext(request, pool, config)
      requireCompanyRole(company, ['owner', 'admin'])
      const user = authUserFromRequest(request)
      if (!user) return jsonError(reply, 401, 'Faça login para continuar a autorização Meta.')
      return reply.send(await getMetaBusinessLoginTrackingAssets(
        pool,
        config,
        company.id,
        user.id,
        params.data.sessionId,
        query.ad_account_id,
      ))
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível ler os Pixels/Datasets da Meta.')
    }
  })

  app.post('/api/meta/oauth/sessions/:sessionId/complete', async (request, reply) => {
    const params = metaOAuthSessionParamsSchema.safeParse(request.params)
    const body = parseBody(metaOAuthCompleteSchema, request.body, reply)
    if (!params.success || !body) {
      if (!params.success) return jsonError(reply, 400, 'Sessão Meta inválida.')
      return
    }
    try {
      const company = await resolveCompanyContext(request, pool, config)
      requireCompanyRole(company, ['owner', 'admin'])
      const user = authUserFromRequest(request)
      if (!user) return jsonError(reply, 401, 'Faça login para concluir a autorização Meta.')
      const session = await completeMetaBusinessLogin(
        pool,
        config,
        company.id,
        user.id,
        params.data.sessionId,
        body,
      )
      processMetaConversionsSoon(company.id)
      await cache.invalidate()
      return reply.send({ session, status: await getMetaStatus(pool, config, company.id) })
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível concluir a conexão Meta.')
    }
  })

  app.get('/api/meta/conversions', async (request, reply) => {
    const query = parseQuery(metaConversionEventsQuerySchema, request.query, reply)
    if (!query) return
    try {
      const company = await resolveCompanyContext(request, pool, config)
      const includeFailureDetails = company.platformToken || company.role === 'owner' || company.role === 'admin'
      return reply.send(await listMetaConversionEvents(pool, company.id, {
        limit: query.limit,
        includeFailureDetails,
      }))
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível consultar a fila Meta.')
    }
  })

  app.post('/api/meta/sync', async (request, reply) => {
    const body = parseBody(metaSyncSchema, request.body, reply)
    if (!body) return
    try {
      const company = await resolveCompanyContext(request, pool, config)
      requireCompanyRole(company, ['owner', 'admin'])
      const summary = await syncMetaAds(pool, config, company.id, body)
      await cache.invalidate()
      return reply.send(summary)
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível sincronizar a Meta.')
    }
  })

  app.post('/api/meta/conversions/process', async (request, reply) => {
    const body = parseBody(metaConversionsProcessSchema, request.body ?? {}, reply)
    if (!body) return
    try {
      const company = await resolveCompanyContext(request, pool, config)
      requireCompanyRole(company, ['owner', 'admin'])
      return reply.send(await processPendingMetaConversions(pool, config, company.id, body.limit ?? 25))
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível processar conversões da Meta.')
    }
  })

  app.get('/api/whatsapp/status', async (request, reply) => {
    try {
      const company = await resolveCompanyContext(request, pool, config)
      return reply.send(publicUazApiState(await getWhatsAppState(pool, config, company.id)))
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível consultar o WhatsApp.')
    }
  })

  app.post('/api/whatsapp/instance', async (request, reply) => {
    try {
      const company = await resolveCompanyContext(request, pool, config)
      requireCompanyRole(company, ['owner', 'admin'])
      return reply.code(201).send(await createWhatsAppInstance(pool, config, company.id))
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível criar a instância UazAPI.')
    }
  })

  app.post('/api/whatsapp/connect', async (request, reply) => {
    const body = parseBody(whatsappConnectSchema, request.body ?? {}, reply)
    if (!body) return
    try {
      const company = await resolveCompanyContext(request, pool, config)
      requireCompanyRole(company, ['owner', 'admin'])
      return reply.send(publicUazApiState(await connectWhatsApp(pool, config, company.id, body)))
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível iniciar a conexão.')
    }
  })

  app.post('/api/whatsapp/disconnect', async (request, reply) => {
    try {
      const company = await resolveCompanyContext(request, pool, config)
      requireCompanyRole(company, ['owner', 'admin'])
      return reply.send(publicUazApiState(await disconnectWhatsApp(pool, config, company.id)))
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível desconectar.')
    }
  })

  app.post('/api/whatsapp/configure-webhook', async (request, reply) => {
    try {
      const company = await resolveCompanyContext(request, pool, config)
      requireCompanyRole(company, ['owner', 'admin'])
      return reply.send(await configureWhatsAppWebhook(pool, config, company.id))
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível configurar o webhook UazAPI.')
    }
  })

  app.post('/api/whatsapp/send/text', async (request, reply) => {
    const body = parseBody(whatsappSendTextSchema, request.body, reply)
    if (!body) return
    try {
      const company = await resolveCompanyContext(request, pool, config)
      const providerResponse = await sendWhatsAppText(pool, config, company.id, body)
      const number = body.number.replace(/@(s\.whatsapp\.net|lid)$/i, '')
      if (!number.includes('@')) {
        const normalized = whatsappWebhookSchema.safeParse({
          id: `uazapi_out_${randomUUID()}`,
          name: 'Contato WhatsApp',
          phone: number,
          text: body.text,
          direction: 'outgoing',
          at: new Date().toISOString(),
        })
        if (normalized.success) {
          await persistLeadMessage(pool, normalized.data, config, company.id)
          await cache.invalidate()
          processMetaConversionsSoon(company.id)
        }
      }
      return reply.send({ ok: true, provider: providerResponse })
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível enviar a mensagem.')
    }
  })

  app.post('/api/whatsapp/uazapi-webhook', async (request, reply) => {
    if (!ensureUazApiWebhookSecret(request, config)) return jsonError(reply, 401, 'Webhook UazAPI não autorizado.')
    const event = normalizeUazApiEvent(request.body)
    const companyId = 'company_i9place'
    const inserted = await recordUazApiEvent(pool, companyId, event)
    if (inserted && event.isMessage && event.phone && event.text) {
      const normalized = whatsappWebhookSchema.safeParse({
        id: event.providerEventId ?? `uazapi_message_${randomUUID()}`,
        name: event.name,
        phone: event.phone,
        text: event.text,
        direction: event.direction,
        at: event.at.toISOString(),
        adId: event.attribution.adId,
        ctwaClid: event.attribution.ctwaClid,
        fbclid: event.attribution.fbclid,
        fbp: event.attribution.fbp,
        fbc: event.attribution.fbc,
        sourceUrl: event.attribution.sourceUrl,
      })
      if (normalized.success) {
        await persistLeadMessage(pool, normalized.data, config, companyId)
        await cache.invalidate()
        processMetaConversionsSoon(companyId)
      }
    }
    return reply.send({ ok: true, duplicate: !inserted })
  })

  app.post('/api/whatsapp/uazapi-webhook/:companyId', async (request, reply) => {
    const params = request.params as { companyId?: string }
    const companyId = params.companyId ?? ''
    if (!companyId || !(await ensureCompanyUazApiWebhookSecret(pool, companyId, request))) {
      return jsonError(reply, 401, 'Webhook UazAPI não autorizado.')
    }
    const event = normalizeUazApiEvent(request.body)
    const inserted = await recordUazApiEvent(pool, companyId, event)
    if (inserted && event.isMessage && event.phone && event.text) {
      const normalized = whatsappWebhookSchema.safeParse({
        id: event.providerEventId ?? `uazapi_message_${randomUUID()}`,
        name: event.name,
        phone: event.phone,
        text: event.text,
        direction: event.direction,
        at: event.at.toISOString(),
        adId: event.attribution.adId,
        ctwaClid: event.attribution.ctwaClid,
        fbclid: event.attribution.fbclid,
        fbp: event.attribution.fbp,
        fbc: event.attribution.fbc,
        sourceUrl: event.attribution.sourceUrl,
      })
      if (normalized.success) {
        await persistLeadMessage(pool, normalized.data, config, companyId)
        await cache.invalidate()
        processMetaConversionsSoon(companyId)
      }
    }
    return reply.send({ ok: true, duplicate: !inserted })
  })

  app.get('/api/campaigns', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    const cacheNamespace = `company:${company.id}:campaigns`
    const cached = await cache.getJson<ReturnType<typeof mapCampaign>[]>(cacheNamespace)
    if (cached) return reply.send(cached)

    const result = await pool.query<DbRow>(
      `select id, name, status, objective, daily_budget_cents, spend_cents, start_date, end_date
       from campaigns where company_id = $1 order by created_at asc, id asc`,
      [company.id],
    )
    const campaigns = result.rows.map(mapCampaign)
    await cache.setJson(cacheNamespace, campaigns, 60)
    return reply.send(campaigns)
  })

  app.get('/api/campaigns/:id', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    const params = request.params as { id?: string }
    const id = params.id ?? ''
    const cacheNamespace = `company:${company.id}:campaign:${encodeURIComponent(id)}`
    const cached = await cache.getJson<ReturnType<typeof mapCampaign>>(cacheNamespace)
    if (cached) return reply.send(cached)

    const result = await pool.query<DbRow>(
      `select id, name, status, objective, daily_budget_cents, spend_cents, start_date, end_date
       from campaigns where company_id = $1 and id = $2`,
      [company.id, id],
    )
    const campaign = result.rows[0]
    if (!campaign) return jsonError(reply, 404, 'Campanha não encontrada.')
    const response = mapCampaign(campaign)
    await cache.setJson(cacheNamespace, response, 60)
    return reply.send(response)
  })

  app.get('/api/metrics/daily', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    const query = parseQuery(metricsQuerySchema, request.query, reply)
    if (!query) return

    const cacheNamespace = `company:${company.id}:metrics:${query.from}:${query.to}:${query.campaign_id ?? 'all'}`
    const cached = await cache.getJson<ReturnType<typeof mapMetric>[]>(cacheNamespace)
    if (cached) return reply.send(cached)

    const values: unknown[] = [company.id, query.from, query.to]
    const filters = ['company_id = $1', 'metric_date between $2 and $3']
    if (query.campaign_id) {
      values.push(query.campaign_id)
      filters.push(`campaign_id = $${values.length}`)
    }
    const result = await pool.query<DbRow>(
      `select campaign_id, metric_date, impressions, clicks, spend_cents, leads, ctr, cpc_cents, cpl_cents, roas
       from daily_metrics where ${filters.join(' and ')} order by metric_date asc, campaign_id asc`,
      values,
    )
    const metrics = result.rows.map(mapMetric)
    await cache.setJson(cacheNamespace, metrics, 120)
    return reply.send(metrics)
  })

  app.get('/api/leads/sources', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    const cacheNamespace = `company:${company.id}:lead-sources`
    const cached = await cache.getJson<string[]>(cacheNamespace)
    if (cached) return reply.send(cached)

    const result = await pool.query<{ utm_source: string }>(
      `select distinct utm_source from leads where company_id = $1 and utm_source <> '' order by utm_source asc`,
      [company.id],
    )
    const sources = result.rows.map((row) => row.utm_source)
    await cache.setJson(cacheNamespace, sources, 300)
    return reply.send(sources)
  })

  app.get('/api/leads', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    const query = parseQuery(leadListQuerySchema, request.query, reply)
    if (!query) return
    const page = query.page ?? 1
    const pageSize = query.page_size ?? 20

    const cacheNamespace = `company:${company.id}:leads:${encodeURIComponent(JSON.stringify(query))}`
    const cached = await cache.getJson<{
      items: ReturnType<typeof mapLead>[]
      total: number
      nextCursor: string | null
    }>(cacheNamespace)
    if (cached) return reply.send(cached)

    const values: unknown[] = [company.id]
    const filters: string[] = ['l.company_id = $1']
    const addFilter = (sql: string, value: unknown) => {
      values.push(value)
      filters.push(sql.replace('?', `$${values.length}`))
    }

    if (query.stage) addFilter('l.stage = ?', query.stage)
    if (query.campaign_id) addFilter('l.campaign_id = ?', query.campaign_id)
    if (query.utm_source) addFilter('l.utm_source = ?', query.utm_source)
    if (query.search) {
      const digits = query.search.replace(/\D/g, '')
      const letters = query.search.replace(/\d/g, '').trim()
      if (letters && digits) {
        addFilter('lower(l.name) like lower(?)', `%${letters}%`)
        addFilter('l.phone_digits like ?', `%${digits}%`)
      } else if (digits) {
        addFilter('l.phone_digits like ?', `%${digits}%`)
      } else if (letters) {
        addFilter('lower(l.name) like lower(?)', `%${letters}%`)
      }
    }

    const where = filters.length > 0 ? `where ${filters.join(' and ')}` : ''
    const limitPosition = values.length + 1
    const offsetPosition = values.length + 2
    const offset = (page - 1) * pageSize
    values.push(pageSize, offset)

    const result = await pool.query<DbRow>(
      `
        select
          l.id,
          l.name,
          l.phone,
          l.stage,
          l.utm_source,
          l.utm_medium,
          l.utm_campaign,
          l.campaign_id,
          l.ad_set_id,
          l.ad_id,
          l.created_at,
          l.last_message_at,
          l.value_cents,
          count(*) over() as total,
          coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', e.id,
                'type', e.type,
                'text', e.text,
                'at', e.occurred_at
              ) order by e.occurred_at, e.id
            ) filter (where e.id is not null),
            '[]'::jsonb
          ) as timeline
        from leads l
        left join lead_events e on e.company_id = l.company_id and e.lead_id = l.id
        ${where}
        group by l.id
        order by l.created_at desc, l.id asc
        limit $${limitPosition} offset $${offsetPosition}
      `,
      values,
    )
    const total = numberValue(result.rows[0]?.total)
    const items = result.rows.map((row) => mapLead(row))
    const response = {
      items,
      total,
      nextCursor: offset + items.length < total ? String(page + 1) : null,
    }
    await cache.setJson(cacheNamespace, response, 30)
    return reply.send(response)
  })

  app.get('/api/leads/:id', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    const params = request.params as { id?: string }
    const id = params.id ?? ''
    const includeFullIp = company.platformToken || company.role === 'owner' || company.role === 'admin'
    const cacheNamespace = `company:${company.id}:lead:${encodeURIComponent(id)}:${includeFullIp ? 'tracking-full' : 'tracking-masked'}`
    const cached = await cache.getJson<ReturnType<typeof mapLead>>(cacheNamespace)
    if (cached) return reply.send(cached)

    const row = await fetchLeadById(pool, company.id, id)
    if (!row) return jsonError(reply, 404, 'Lead não encontrado.')
    const lead = mapLead(row, { includeTracking: true, includeFullIp })
    await cache.setJson(cacheNamespace, lead, 30)
    return reply.send(lead)
  })

  app.get('/api/leads/:id/meta-events', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    const params = request.params as { id?: string }
    const leadId = params.id?.trim() ?? ''
    if (!leadId) return jsonError(reply, 400, 'Informe o lead.')
    const lead = await pool.query<{ id: string }>(
      'select id from leads where company_id = $1 and id = $2',
      [company.id, leadId],
    )
    if (!lead.rows[0]) return jsonError(reply, 404, 'Lead não encontrado.')
    const includeFailureDetails = company.platformToken || company.role === 'owner' || company.role === 'admin'
    return reply.send(await listMetaConversionEvents(pool, company.id, {
      leadId,
      limit: 10,
      includeFailureDetails,
    }))
  })

  app.patch('/api/leads/:id/stage', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    const params = request.params as { id?: string }
    const id = params.id ?? ''
    const body = parseBody(stageBodySchema, request.body, reply)
    if (!body) return

    const lead = await withTransaction(pool, async (client) => {
      const current = await client.query<{ id: string; stage: string; value_cents: number }>(
        'select id, stage, value_cents from leads where company_id = $1 and id = $2 for update',
        [company.id, id],
      )
      if (!current.rows[0]) throw new NotFoundError('Lead não encontrado.')

      if (current.rows[0].stage !== body.stage) {
        await client.query(
          `update leads set stage = $1, updated_at = now() where company_id = $2 and id = $3`,
          [body.stage, company.id, id],
        )
        await client.query(
          `insert into lead_events (company_id, id, lead_id, type, text, occurred_at)
           values ($1, $2, $3, 'estagio_alterado', $4, now())`,
          [
            company.id,
            `lead_event_${randomUUID()}`,
            id,
            `Estágio alterado para ${body.stage}`,
          ],
        )
        const conversionEvent = conversionEventForStage(body.stage)
        if (conversionEvent) {
          await enqueueMetaConversionEvent(
            client,
            company.id,
            id,
            conversionEvent,
            new Date(),
            numberValue(current.rows[0].value_cents),
            config.metaCurrency,
          )
        }
      }

      const updated = await fetchLeadById(client, company.id, id)
      if (!updated) throw new NotFoundError('Lead não encontrado.')
      return mapLead(updated, {
        includeTracking: true,
        includeFullIp: company.platformToken || company.role === 'owner' || company.role === 'admin',
      })
    })
    await cache.invalidate()
    processMetaConversionsSoon(company.id)
    return reply.send(lead)
  })

  app.get('/api/alerts', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    const cacheNamespace = `company:${company.id}:alerts`
    const cached = await cache.getJson<ReturnType<typeof mapAlert>[]>(cacheNamespace)
    if (cached) return reply.send(cached)

    const result = await pool.query<DbRow>(
      `select id, type, severity, title, message, created_at, read, ref_id
       from alerts where company_id = $1 order by created_at desc, id asc`,
      [company.id],
    )
    const alerts = result.rows.map(mapAlert)
    await cache.setJson(cacheNamespace, alerts, 30)
    return reply.send(alerts)
  })

  app.post('/api/alerts/:id/read', async (request, reply) => {
    const company = await resolveCompanyContext(request, pool, config)
    const params = request.params as { id?: string }
    const result = await pool.query<DbRow>(
      `update alerts set read = true where company_id = $1 and id = $2
       returning id, type, severity, title, message, created_at, read, ref_id`,
      [company.id, params.id ?? ''],
    )
    const alert = result.rows[0]
    if (!alert) return jsonError(reply, 404, 'Alerta não encontrado.')
    await cache.invalidate()
    return reply.send(mapAlert(alert))
  })

  app.post('/api/webhooks/whatsapp', async (request, reply) => {
    try {
      ensureWebhookAuth(request, config)
    } catch (error) {
      return jsonError(reply, 401, error instanceof Error ? error.message : 'Webhook não autorizado.')
    }

    const body = parseBody(whatsappWebhookSchema, request.body, reply)
    if (!body) return
    const lead = await persistLeadMessage(
      pool,
      body,
      config,
      body.companyId ?? 'company_i9place',
      leadRequestContext(request),
    )
    await cache.invalidate()
    processMetaConversionsSoon(body.companyId ?? 'company_i9place')
    return reply.code(201).send(lead)
  })

  app.post('/api/webhooks/meta/sync', async (request, reply) => {
    try {
      ensureWebhookAuth(request, config)
    } catch (error) {
      return jsonError(reply, 401, error instanceof Error ? error.message : 'Webhook não autorizado.')
    }
    const body = parseBody(metaSyncSchema, request.body, reply)
    if (!body) return
    try {
      const summary = await syncAllMetaAds(pool, config, body)
      await cache.invalidate()
      return reply.send(summary)
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível sincronizar a Meta.')
    }
  })

  app.post('/api/webhooks/meta/conversions/process', async (request, reply) => {
    try {
      ensureWebhookAuth(request, config)
    } catch (error) {
      return jsonError(reply, 401, error instanceof Error ? error.message : 'Webhook não autorizado.')
    }
    const body = parseBody(metaConversionsProcessSchema, request.body ?? {}, reply)
    if (!body) return
    try {
      return reply.send(await processAllPendingMetaConversions(pool, config, body.limit ?? 25))
    } catch (error) {
      return jsonError(reply, providerErrorStatus(error), error instanceof Error ? error.message : 'Não foi possível processar conversões da Meta.')
    }
  })

  app.post('/api/webhooks/alerts', async (request, reply) => {
    try {
      ensureWebhookAuth(request, config)
    } catch (error) {
      return jsonError(reply, 401, error instanceof Error ? error.message : 'Webhook não autorizado.')
    }

    const body = parseBody(alertWebhookSchema, request.body, reply)
    if (!body) return
    const companyId = body.companyId ?? 'company_i9place'
    const id = body.id ?? `alert_${randomUUID()}`
    const result = await pool.query<DbRow>(
      `insert into alerts (company_id, id, type, severity, title, message, created_at, read, ref_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set
         type = excluded.type,
         severity = excluded.severity,
         title = excluded.title,
         message = excluded.message,
         created_at = excluded.created_at,
         ref_id = excluded.ref_id
       where alerts.company_id = excluded.company_id
       returning id, type, severity, title, message, created_at, read, ref_id`,
      [
        companyId,
        id,
        body.type,
        body.severity,
        body.title,
        body.message,
        body.createdAt ? new Date(body.createdAt) : new Date(),
        body.read,
        body.refId ?? null,
      ],
    )
    await cache.invalidate()
    return reply.code(201).send(mapAlert(result.rows[0]))
  })

  app.post('/api/webhooks/metrics', async (request, reply) => {
    try {
      ensureWebhookAuth(request, config)
    } catch (error) {
      return jsonError(reply, 401, error instanceof Error ? error.message : 'Webhook não autorizado.')
    }

    const body = parseBody(metricWebhookSchema, request.body, reply)
    if (!body) return
    const companyId = body.companyId ?? 'company_i9place'
    const result = await pool.query<DbRow>(
      `insert into daily_metrics
        (company_id, campaign_id, metric_date, impressions, clicks, spend_cents, leads, ctr, cpc_cents, cpl_cents, roas)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (campaign_id, metric_date) do update set
         impressions = excluded.impressions,
         clicks = excluded.clicks,
         spend_cents = excluded.spend_cents,
         leads = excluded.leads,
         ctr = excluded.ctr,
         cpc_cents = excluded.cpc_cents,
         cpl_cents = excluded.cpl_cents,
         roas = excluded.roas,
         updated_at = now()
       where daily_metrics.company_id = excluded.company_id
       returning campaign_id, metric_date, impressions, clicks, spend_cents, leads, ctr, cpc_cents, cpl_cents, roas`,
      [
        companyId,
        body.campaignId,
        body.date,
        body.impressions,
        body.clicks,
        body.spend,
        body.leads,
        body.ctr,
        body.cpc,
        body.cpl,
        body.roas,
      ],
    )
    await cache.invalidate()
    return reply.code(201).send(mapMetric(result.rows[0]))
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof NotFoundError) {
      return jsonError(reply, 404, error.message)
    }
    if (error instanceof WebhookAuthError) {
      return jsonError(reply, 401, error.message)
    }
    if (error instanceof CompanyAccessError) {
      return jsonError(reply, error.statusCode, error.message)
    }
    request.log.error({ err: error }, 'Falha não tratada na API')
    return jsonError(reply, 500, 'Erro interno do servidor.')
  })

  const staticDir = resolve(process.cwd(), config.staticDir)
  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, {
      root: staticDir,
      index: false,
    })

    app.get('/', async (_request, reply) => reply.sendFile('index.html'))
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.sendFile('index.html')
      }
      return jsonError(reply, 404, 'Rota não encontrada.')
    })
  } else {
    app.setNotFoundHandler((_request, reply) => jsonError(reply, 404, 'Rota não encontrada.'))
  }

  return app
}
