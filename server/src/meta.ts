import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import type { Pool, PoolClient } from 'pg'
import type { AppConfig } from './config.js'
import { withTransaction } from './db.js'
import { getMetaIntegration, type MetaIntegrationConfig } from './integrations.js'
import { isMetaBusinessLoginConfigured } from './metaOAuth.js'

type JsonRecord = Record<string, unknown>
type DbRow = Record<string, unknown>
type Queryable = Pool | PoolClient

type MetaRequestConfig = MetaIntegrationConfig & Pick<
  AppConfig,
  'metaGraphApiBaseUrl' | 'metaGraphApiVersion'
>

export class MetaConfigurationError extends Error {}

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 502,
  ) {
    super(message)
  }
}

export type MetaConversionEventName = 'Lead' | 'QualifiedLead' | 'Purchase'

/** Dados first-party opcionais que melhoram o matching da Conversions API.
 * fbp/fbc, IP e user-agent não são hashes: a Meta exige os valores originais.
 */
export interface MetaCapiMatchingData {
  fbp?: string
  fbc?: string
  ctwaClid?: string
  clientIp?: string
  clientUserAgent?: string
}

export interface MetaCapiEventInput {
  companyId: string
  eventName: string
  eventId: string
  eventTime: Date
  phone: string
  valueCents: number
  currency: string
  leadId: string
  matching?: MetaCapiMatchingData
}

export interface MetaStatus {
  configured: boolean
  adsConfigured: boolean
  conversionsConfigured: boolean
  businessLoginConfigured: boolean
  connectionMethod: 'business_login' | 'manual' | 'not_connected'
  adAccountId: string | null
  adAccountName: string | null
  datasetId: string | null
  datasetName: string | null
  connectedAt: string | null
  graphApiVersion: string
  lastSyncAt: string | null
  lastError: string | null
}

export interface MetaSyncRange {
  from: string
  to: string
}

export interface MetaSyncSummary extends MetaSyncRange {
  campaigns: number
  adSets: number
  ads: number
  metrics: number
}

export interface MetaConversionProcessSummary {
  configured: boolean
  claimed: number
  sent: number
  failed: number
  skipped: number
}

export interface MetaConversionAuditItem {
  id: string
  leadId: string
  eventName: string
  eventId: string
  eventTime: string
  valueCents: number
  currency: string
  status: string
  attempts: number
  sentAt: string | null
  createdAt: string
  lastError: string | null
  acceptedEvents: number | null
  matching: {
    phoneHashed: boolean
    externalIdHashed: boolean
    clientIp: boolean
    ipVersion: 'IPv4' | 'IPv6' | null
    clientUserAgent: boolean
    fbp: boolean
    fbc: boolean
    ctwaClid: boolean
  }
}

interface MetaPage<T> {
  data?: T[]
  paging?: { next?: string }
}

interface MetaCampaign {
  id?: unknown
  name?: unknown
  status?: unknown
  effective_status?: unknown
  objective?: unknown
  daily_budget?: unknown
  start_time?: unknown
  stop_time?: unknown
}

interface MetaAdSet {
  id?: unknown
  campaign_id?: unknown
  name?: unknown
  status?: unknown
  effective_status?: unknown
  daily_budget?: unknown
  start_time?: unknown
  end_time?: unknown
}

interface MetaAd {
  id?: unknown
  adset_id?: unknown
  campaign_id?: unknown
  name?: unknown
  status?: unknown
  effective_status?: unknown
}

interface MetaAction {
  action_type?: unknown
  value?: unknown
}

interface MetaInsight {
  campaign_id?: unknown
  campaign_name?: unknown
  ad_id?: unknown
  ad_name?: unknown
  adset_id?: unknown
  adset_name?: unknown
  date_start?: unknown
  impressions?: unknown
  clicks?: unknown
  spend?: unknown
  actions?: unknown
  action_values?: unknown
}

interface CampaignMetric {
  campaignId: string
  date: string
  impressions: number
  clicks: number
  spendCents: number
  leads: number
  ctr: number
  cpcCents: number
  cplCents: number
  roas: number
}

interface AdAggregate {
  id: string
  adSetId: string | null
  campaignId: string | null
  name: string
  spendCents: number
  impressions: number
  clicks: number
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function integer(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0
}

function cents(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0
}

function decimal(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function dateOnly(value: unknown, fallback: string): string {
  const raw = text(value)
  if (!raw) return fallback
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString().slice(0, 10)
}

function normalizedAccountId(value: string): string {
  return value.startsWith('act_') ? value : `act_${value}`
}

function normalizedStatus(value: unknown): 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED' {
  const status = text(value).toUpperCase()
  if (status === 'ACTIVE') return 'ACTIVE'
  if (status === 'PAUSED') return 'PAUSED'
  if (status === 'DELETED') return 'DELETED'
  return 'ARCHIVED'
}

function normalizedObjective(value: unknown): 'LEADS' | 'MESSAGES' | 'CONVERSIONS' | 'TRAFFIC' | 'ENGAGEMENT' {
  const objective = text(value).toUpperCase()
  if (objective.includes('MESSAGE')) return 'MESSAGES'
  if (objective.includes('LEAD')) return 'LEADS'
  if (objective.includes('CONVERSION') || objective.includes('SALES')) return 'CONVERSIONS'
  if (objective.includes('TRAFFIC') || objective.includes('VISIT')) return 'TRAFFIC'
  if (objective.includes('ENGAGEMENT') || objective.includes('AWARENESS')) return 'ENGAGEMENT'
  return 'LEADS'
}

function actionList(value: unknown): MetaAction[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is MetaAction => Boolean(asRecord(item)))
}

function actionType(action: MetaAction): string {
  return text(action.action_type).toLowerCase()
}

function actionValue(actions: MetaAction[], predicate: (type: string) => boolean): number {
  return actions
    .filter((action) => predicate(actionType(action)))
    .reduce((sum, action) => sum + decimal(action.value), 0)
}

function leadCount(actions: MetaAction[]): number {
  const leadActions = actions.filter((action) => {
    const type = actionType(action)
    return type === 'lead' ||
      type.includes('lead') ||
      type.includes('messaging_conversation_started') ||
      type.includes('messaging_first_reply')
  })
  return Math.round(leadActions.reduce((sum, action) => sum + decimal(action.value), 0))
}

function errorMessage(payload: unknown): string {
  const root = asRecord(payload)
  const error = asRecord(root?.error)
  const message = text(error?.message, text(root?.message, 'A Meta API recusou a operação.'))
  return message.slice(0, 500)
}

function requireAdsConfig(config: MetaRequestConfig): { accessToken: string; accountId: string } {
  if (!config.accessToken || !config.adAccountId) {
    throw new MetaConfigurationError(
      'Configure META_ACCESS_TOKEN e META_AD_ACCOUNT_ID para consultar os anúncios.',
    )
  }
  return {
    accessToken: config.accessToken,
    accountId: normalizedAccountId(config.adAccountId),
  }
}

function requireConversionsConfig(config: MetaRequestConfig): { accessToken: string; datasetId: string } {
  const datasetId = config.datasetId ?? config.pixelId
  if (!config.accessToken || !datasetId) {
    throw new MetaConfigurationError(
      'Configure META_ACCESS_TOKEN e META_DATASET_ID ou META_PIXEL_ID para enviar conversões.',
    )
  }
  return { accessToken: config.accessToken, datasetId }
}

async function metaRequest<T>(
  config: MetaRequestConfig,
  pathOrUrl: string,
  options: { method?: 'GET' | 'POST'; query?: Record<string, string>; body?: JsonRecord } = {},
): Promise<T> {
  const url = new URL(
    pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${config.metaGraphApiBaseUrl}/${config.metaGraphApiVersion}/${pathOrUrl.replace(/^\//, '')}`,
  )
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.accessToken ?? ''}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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
  if (!response.ok) throw new MetaApiError(errorMessage(payload), response.status)
  return payload as T
}

async function fetchCollection<T>(
  config: MetaRequestConfig,
  path: string,
  query: Record<string, string>,
): Promise<T[]> {
  const values: T[] = []
  let next: string | null = path
  let first = true
  let pages = 0
  while (next && pages < 100) {
    const page: MetaPage<T> = await metaRequest<MetaPage<T>>(config, next, first ? { query } : {})
    values.push(...(page.data ?? []))
    next = page.paging?.next ?? null
    first = false
    pages += 1
  }
  return values
}

function buildCampaignMetrics(rows: MetaInsight[], fallbackDate: string): CampaignMetric[] {
  return rows.flatMap((row) => {
    const campaignId = text(row.campaign_id)
    if (!campaignId) return []
    const impressions = integer(row.impressions)
    const clicks = integer(row.clicks)
    const spendCents = cents(row.spend)
    const actions = actionList(row.actions)
    const values = actionList(row.action_values)
    const leads = leadCount(actions)
    const purchaseValue = actionValue(values, (type) => type.includes('purchase'))
    return [{
      campaignId,
      date: dateOnly(row.date_start, fallbackDate),
      impressions,
      clicks,
      spendCents,
      leads,
      ctr: impressions > 0 ? clicks / impressions : 0,
      cpcCents: clicks > 0 ? Math.round(spendCents / clicks) : 0,
      cplCents: leads > 0 ? Math.round(spendCents / leads) : 0,
      roas: spendCents > 0 ? purchaseValue / (spendCents / 100) : 0,
    }]
  })
}

function aggregateAds(rows: MetaInsight[], knownAds: MetaAd[]): AdAggregate[] {
  const values = new Map<string, AdAggregate>()
  for (const row of knownAds) {
    const id = text(row.id)
    if (!id) continue
    values.set(id, {
      id,
      adSetId: text(row.adset_id) || null,
      campaignId: text(row.campaign_id) || null,
      name: text(row.name, id),
      spendCents: 0,
      impressions: 0,
      clicks: 0,
    })
  }
  for (const row of rows) {
    const id = text(row.ad_id)
    if (!id) continue
    const current = values.get(id) ?? {
      id,
      adSetId: text(row.adset_id) || null,
      campaignId: text(row.campaign_id) || null,
      name: text(row.ad_name, id),
      spendCents: 0,
      impressions: 0,
      clicks: 0,
    }
    current.spendCents += cents(row.spend)
    current.impressions += integer(row.impressions)
    current.clicks += integer(row.clicks)
    if (text(row.ad_name)) current.name = text(row.ad_name)
    values.set(id, current)
  }
  return [...values.values()]
}

async function saveIntegrationState(
  pool: Pool,
  companyId: string,
  status: string,
  values: { lastSyncAt?: Date | null; lastError?: string | null; metadata?: JsonRecord },
): Promise<void> {
  await pool.query(
    `insert into integration_states (company_id, provider, status, last_sync_at, last_error, metadata, updated_at)
     values ($1, 'meta', $2, $3, $4, $5, now())
     on conflict (company_id, provider) do update set
       status = excluded.status,
       last_sync_at = excluded.last_sync_at,
       last_error = excluded.last_error,
       metadata = excluded.metadata,
       updated_at = now()`,
    [companyId, status, values.lastSyncAt ?? null, values.lastError ?? null, JSON.stringify(values.metadata ?? {})],
  )
}

function requestConfig(config: AppConfig, integration: MetaIntegrationConfig): MetaRequestConfig {
  return {
    ...integration,
    metaGraphApiBaseUrl: config.metaGraphApiBaseUrl,
    metaGraphApiVersion: config.metaGraphApiVersion,
  }
}

export async function getMetaStatus(pool: Pool, config: AppConfig, companyId: string): Promise<MetaStatus> {
  const integration = await getMetaIntegration(pool, config, companyId)
  const state = await pool.query<JsonRecord>(
    `select status, last_sync_at, last_error
       from integration_states
      where company_id = $1 and provider = 'meta'`,
    [companyId],
  )
  const row = state.rows[0]
  const adsConfigured = Boolean(integration.accessToken && integration.adAccountId)
  const conversionsConfigured = Boolean(integration.accessToken && (integration.datasetId || integration.pixelId))
  const connectionMethod = integration.accessToken
    ? (integration.connectionMethod ?? 'manual')
    : 'not_connected'
  return {
    configured: adsConfigured || conversionsConfigured,
    adsConfigured,
    conversionsConfigured,
    businessLoginConfigured: isMetaBusinessLoginConfigured(config),
    connectionMethod,
    adAccountId: integration.adAccountId ?? null,
    adAccountName: integration.adAccountName ?? null,
    datasetId: integration.datasetId ?? integration.pixelId ?? null,
    datasetName: integration.datasetName ?? null,
    connectedAt: integration.connectedAt ?? null,
    graphApiVersion: config.metaGraphApiVersion,
    lastSyncAt: row?.last_sync_at ? new Date(String(row.last_sync_at)).toISOString() : null,
    lastError: text(row?.last_error) || null,
  }
}

export async function syncMetaAds(
  pool: Pool,
  config: AppConfig,
  companyId: string,
  range: MetaSyncRange,
): Promise<MetaSyncSummary> {
  const metaConfig = requestConfig(config, await getMetaIntegration(pool, config, companyId))
  const { accountId } = requireAdsConfig(metaConfig)
  if (range.from > range.to) throw new MetaConfigurationError('O período da Meta é inválido.')

  try {
    const campaignRows = await fetchCollection<MetaCampaign>(metaConfig, `/${accountId}/campaigns`, {
      fields: 'id,name,status,effective_status,objective,daily_budget,start_time,stop_time',
      limit: '500',
    })
    const adSetRows = await fetchCollection<MetaAdSet>(metaConfig, `/${accountId}/adsets`, {
      fields: 'id,campaign_id,name,status,effective_status,daily_budget,start_time,end_time',
      limit: '500',
    })
    const adRows = await fetchCollection<MetaAd>(metaConfig, `/${accountId}/ads`, {
      fields: 'id,adset_id,campaign_id,name,status,effective_status',
      limit: '500',
    })
    const timeRange = JSON.stringify({ since: range.from, until: range.to })
    const campaignInsightRows = await fetchCollection<MetaInsight>(metaConfig, `/${accountId}/insights`, {
      level: 'campaign',
      time_increment: '1',
      time_range: timeRange,
      fields: 'campaign_id,campaign_name,date_start,impressions,clicks,spend,actions,action_values',
      limit: '500',
    })
    const adInsightRows = await fetchCollection<MetaInsight>(metaConfig, `/${accountId}/insights`, {
      level: 'ad',
      time_increment: '1',
      time_range: timeRange,
      fields: 'ad_id,ad_name,adset_id,campaign_id,date_start,impressions,clicks,spend',
      limit: '500',
    })
    const metrics = buildCampaignMetrics(campaignInsightRows, range.from)
    const campaignById = new Map<string, MetaCampaign>()
    for (const row of campaignRows) {
      const id = text(row.id)
      if (id) campaignById.set(id, row)
    }
    for (const row of metrics) {
      if (!campaignById.has(row.campaignId)) {
        campaignById.set(row.campaignId, { id: row.campaignId, name: row.campaignId })
      }
    }
    const adAggregates = aggregateAds(adInsightRows, adRows)
    const metricTotals = new Map<string, { spendCents: number; impressions: number; clicks: number }>()
    for (const metric of metrics) {
      const total = metricTotals.get(metric.campaignId) ?? { spendCents: 0, impressions: 0, clicks: 0 }
      total.spendCents += metric.spendCents
      total.impressions += metric.impressions
      total.clicks += metric.clicks
      metricTotals.set(metric.campaignId, total)
    }

    await withTransaction(pool, async (client) => {
      for (const row of campaignById.values()) {
        const id = text(row.id)
        const total = metricTotals.get(id) ?? { spendCents: 0, impressions: 0, clicks: 0 }
        await client.query(
          `insert into campaigns
            (company_id, id, name, status, objective, daily_budget_cents, spend_cents, start_date, end_date)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (id) do update set
             name = excluded.name,
             status = excluded.status,
             objective = excluded.objective,
             daily_budget_cents = excluded.daily_budget_cents,
             spend_cents = excluded.spend_cents,
             start_date = excluded.start_date,
             end_date = excluded.end_date,
             updated_at = now()
           where campaigns.company_id = excluded.company_id`,
          [
            companyId,
            id,
            text(row.name, id),
            normalizedStatus(row.effective_status ?? row.status),
            normalizedObjective(row.objective),
            integer(row.daily_budget),
            total.spendCents,
            dateOnly(row.start_time, range.from),
            text(row.stop_time) ? dateOnly(row.stop_time, range.to) : null,
          ],
        )
      }

      for (const row of adSetRows) {
        const id = text(row.id)
        const campaignId = text(row.campaign_id) || null
        if (!id || (campaignId && !campaignById.has(campaignId))) continue
        await client.query(
          `insert into ad_sets
            (company_id, id, campaign_id, name, status, daily_budget_cents, spend_cents, start_date, end_date)
           values ($1, $2, $3, $4, $5, $6, 0, $7, $8)
           on conflict (id) do update set
             campaign_id = excluded.campaign_id,
             name = excluded.name,
             status = excluded.status,
             daily_budget_cents = excluded.daily_budget_cents,
             start_date = excluded.start_date,
             end_date = excluded.end_date,
             updated_at = now()
           where ad_sets.company_id = excluded.company_id`,
          [
            companyId,
            id,
            campaignId,
            text(row.name, id),
            normalizedStatus(row.effective_status ?? row.status),
            integer(row.daily_budget),
            dateOnly(row.start_time, range.from),
            text(row.end_time) ? dateOnly(row.end_time, range.to) : null,
          ],
        )
      }

      for (const row of adAggregates) {
        if (row.campaignId && !campaignById.has(row.campaignId)) continue
        if (row.adSetId) {
          const adSet = await client.query<{ id: string }>(
            'select id from ad_sets where company_id = $1 and id = $2',
            [companyId, row.adSetId],
          )
          if (!adSet.rows[0]) continue
        }
        await client.query(
          `insert into ads
            (company_id, id, ad_set_id, campaign_id, name, status, spend_cents, impressions, clicks)
           values ($1, $2, $3, $4, $5, 'ARCHIVED', $6, $7, $8)
           on conflict (id) do update set
             ad_set_id = excluded.ad_set_id,
             campaign_id = excluded.campaign_id,
             name = excluded.name,
             spend_cents = excluded.spend_cents,
             impressions = excluded.impressions,
             clicks = excluded.clicks,
             updated_at = now()
           where ads.company_id = excluded.company_id`,
          [companyId, row.id, row.adSetId, row.campaignId, row.name, row.spendCents, row.impressions, row.clicks],
        )
      }

      for (const metric of metrics) {
        await client.query(
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
           where daily_metrics.company_id = excluded.company_id`,
          [
            companyId,
            metric.campaignId,
            metric.date,
            metric.impressions,
            metric.clicks,
            metric.spendCents,
            metric.leads,
            metric.ctr,
            metric.cpcCents,
            metric.cplCents,
            metric.roas,
          ],
        )
      }
    })

    const summary: MetaSyncSummary = {
      ...range,
      campaigns: campaignById.size,
      adSets: adSetRows.length,
      ads: adAggregates.length,
      metrics: metrics.length,
    }
    await saveIntegrationState(pool, companyId, 'connected', { lastSyncAt: new Date(), lastError: null, metadata: { ...summary } })
    return summary
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível sincronizar a Meta.'
    await saveIntegrationState(pool, companyId, 'error', { lastError: message })
    throw error
  }
}

export async function enqueueMetaConversionEvent(
  queryable: Queryable,
  companyId: string,
  leadId: string,
  eventName: MetaConversionEventName,
  eventTime: Date,
  valueCents: number,
  currency = 'BRL',
): Promise<void> {
  const lead = await queryable.query<{ attribution: JsonRecord }>(
    `select attribution from leads where company_id = $1 and id = $2`,
    [companyId, leadId],
  )
  const matching = capiMatchingFromAttribution(lead.rows[0]?.attribution)
  await queryable.query(
    `insert into meta_conversion_events
      (id, company_id, lead_id, event_name, event_id, event_time, value_cents, currency, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (company_id, event_id) do update
       set payload = case
             when meta_conversion_events.status = 'sent' then meta_conversion_events.payload
             else coalesce(meta_conversion_events.payload, '{}'::jsonb) || excluded.payload
           end,
           updated_at = now()`,
    [
      `meta_conversion_${createHash('sha256').update(`${companyId}:${leadId}:${eventName}`).digest('hex').slice(0, 32)}`,
      companyId,
      leadId,
      eventName,
      `${companyId}:${leadId}:${eventName}`,
      eventTime,
      Math.max(0, Math.round(valueCents)),
      currency,
      JSON.stringify({ source: 'funiltrack', companyId, leadId, eventName, matching }),
    ],
  )
}

function hashPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  return createHash('sha256').update(digits).digest('hex')
}

function hashExternalId(companyId: string, leadId: string): string {
  return createHash('sha256').update(`funiltrack:${companyId}:${leadId}`).digest('hex')
}

function capiText(value: unknown, maxLength: number): string | undefined {
  const candidate = text(value).trim().slice(0, maxLength)
  return candidate || undefined
}

function capiMatchingFromAttribution(value: unknown): MetaCapiMatchingData {
  const attribution = asRecord(value) ?? {}
  const fbp = capiText(attribution.fbp, 600)
  const fbc = capiText(attribution.fbc, 800)
  const ctwaClid = capiText(attribution.ctwaClid, 240)
  const clientIp = capiText(attribution.clientIp, 64)
  const clientUserAgent = capiText(attribution.clientUserAgent, 1_024)
  return {
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {}),
    ...(ctwaClid ? { ctwaClid } : {}),
    ...(clientIp && isIP(clientIp) ? { clientIp } : {}),
    ...(clientUserAgent ? { clientUserAgent } : {}),
  }
}

function capiMatchingFromEventPayload(value: unknown): MetaCapiMatchingData {
  const payload = asRecord(value)
  return capiMatchingFromAttribution(payload?.matching)
}

/** Gera um evento CAPI puro e testável, sem expor token nem chamar a Meta. */
export function buildMetaCapiEvent(event: MetaCapiEventInput): JsonRecord {
  const matching = event.matching ?? {}
  const userData: JsonRecord = {
    ph: [hashPhone(event.phone)],
    external_id: [hashExternalId(event.companyId, event.leadId)],
    ...(matching.fbp ? { fbp: matching.fbp } : {}),
    ...(matching.fbc ? { fbc: matching.fbc } : {}),
    ...(matching.ctwaClid ? { ctwa_clid: matching.ctwaClid } : {}),
    ...(matching.clientIp && isIP(matching.clientIp) ? { client_ip_address: matching.clientIp } : {}),
    ...(matching.clientUserAgent ? { client_user_agent: matching.clientUserAgent } : {}),
  }
  return {
    event_name: event.eventName,
    event_time: Math.floor(event.eventTime.getTime() / 1000),
    event_id: event.eventId,
    action_source: 'system_generated',
    user_data: userData,
    custom_data: {
      currency: event.currency,
      value: event.valueCents / 100,
      lead_id: event.leadId,
    },
  }
}

async function sendConversion(
  config: MetaRequestConfig,
  event: MetaCapiEventInput,
): Promise<JsonRecord> {
  const { datasetId } = requireConversionsConfig(config)
  const body: JsonRecord = { data: [buildMetaCapiEvent(event)] }
  if (config.testEventCode) body.test_event_code = config.testEventCode
  return metaRequest<JsonRecord>(config, `/${datasetId}/events`, { method: 'POST', body })
}

function conversionReceipt(value: unknown): JsonRecord {
  const response = asRecord(value) ?? {}
  const received = Number(response.events_received)
  const traceId = text(response.fbtrace_id)
  return {
    ...(Number.isFinite(received) ? { eventsReceived: Math.max(0, Math.round(received)) } : {}),
    ...(traceId ? { traceId } : {}),
    receivedAt: new Date().toISOString(),
  }
}

function matchingAudit(value: unknown): MetaConversionAuditItem['matching'] {
  const matching = capiMatchingFromEventPayload(value)
  const ipKind = matching.clientIp ? isIP(matching.clientIp) : 0
  return {
    phoneHashed: true,
    externalIdHashed: true,
    clientIp: Boolean(ipKind),
    ipVersion: ipKind === 4 ? 'IPv4' : ipKind === 6 ? 'IPv6' : null,
    clientUserAgent: Boolean(matching.clientUserAgent),
    fbp: Boolean(matching.fbp),
    fbc: Boolean(matching.fbc),
    ctwaClid: Boolean(matching.ctwaClid),
  }
}

function acceptedEvents(value: unknown): number | null {
  const payload = asRecord(value)
  const receipt = asRecord(payload?.receipt)
  const count = Number(receipt?.eventsReceived)
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : null
}

export async function listMetaConversionEvents(
  pool: Pool,
  companyId: string,
  options: { leadId?: string; limit?: number; includeFailureDetails?: boolean } = {},
): Promise<MetaConversionAuditItem[]> {
  const values: unknown[] = [companyId]
  const where = ['company_id = $1']
  if (options.leadId) {
    values.push(options.leadId)
    where.push(`lead_id = $${values.length}`)
  }
  values.push(Math.min(Math.max(Math.round(options.limit ?? 25), 1), 100))
  const result = await pool.query<DbRow>(
    `select id, lead_id, event_name, event_id, event_time, value_cents, currency,
            status, attempts, last_error, sent_at, created_at, payload
       from meta_conversion_events
      where ${where.join(' and ')}
      order by event_time desc, created_at desc
      limit $${values.length}`,
    values,
  )
  return result.rows.map((row) => ({
    id: text(row.id),
    leadId: text(row.lead_id),
    eventName: text(row.event_name),
    eventId: text(row.event_id),
    eventTime: new Date(String(row.event_time)).toISOString(),
    valueCents: integer(row.value_cents),
    currency: text(row.currency, 'BRL'),
    status: text(row.status),
    attempts: integer(row.attempts),
    sentAt: row.sent_at ? new Date(String(row.sent_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastError: options.includeFailureDetails ? (text(row.last_error) || null) : null,
    acceptedEvents: acceptedEvents(row.payload),
    matching: matchingAudit(row.payload),
  }))
}

export async function processPendingMetaConversions(
  pool: Pool,
  config: AppConfig,
  companyId: string,
  limit: number,
): Promise<MetaConversionProcessSummary> {
  const metaConfig = requestConfig(config, await getMetaIntegration(pool, config, companyId))
  if (!metaConfig.accessToken || !(metaConfig.datasetId || metaConfig.pixelId)) {
    return { configured: false, claimed: 0, sent: 0, failed: 0, skipped: 0 }
  }
  const safeLimit = Math.min(Math.max(Math.round(limit), 1), 100)
  const claimed = await pool.query<JsonRecord>(
    `update meta_conversion_events e
       set status = 'processing', attempts = e.attempts + 1, updated_at = now()
     from leads l
     where e.lead_id = l.id
       and e.company_id = $1
       and l.company_id = $1
       and e.id in (
         select id from meta_conversion_events
          where company_id = $1
            and (status in ('pending', 'failed')
             or (status = 'processing' and updated_at < now() - interval '10 minutes')
            )
          order by created_at asc
          limit $2
          for update skip locked
       )
     returning e.id, e.event_name, e.event_id, e.event_time, e.value_cents, e.currency, e.lead_id, e.payload, l.phone`,
    [companyId, safeLimit],
  )
  let sent = 0
  let failed = 0
  let skipped = 0
  for (const row of claimed.rows) {
    try {
      const response = await sendConversion(metaConfig, {
        companyId,
        eventName: text(row.event_name),
        eventId: text(row.event_id),
        eventTime: new Date(String(row.event_time)),
        phone: text(row.phone),
        valueCents: integer(row.value_cents),
        currency: text(row.currency, 'BRL'),
        leadId: text(row.lead_id),
        matching: capiMatchingFromEventPayload(row.payload),
      })
      await pool.query(
          `update meta_conversion_events
            set status = 'sent', sent_at = now(), last_error = null,
                payload = coalesce(payload, '{}'::jsonb) || $3::jsonb, updated_at = now()
          where company_id = $1 and id = $2`,
        [companyId, row.id, JSON.stringify({ receipt: conversionReceipt(response) })],
      )
      sent += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao enviar conversão para a Meta.'
      await pool.query(
          `update meta_conversion_events
            set status = 'failed', last_error = $2, updated_at = now()
          where company_id = $1 and id = $3`,
        [companyId, message.slice(0, 500), row.id],
      )
      failed += 1
    }
  }
  skipped = Math.max(0, safeLimit - claimed.rows.length)
  return { configured: true, claimed: claimed.rows.length, sent, failed, skipped }
}

export async function syncAllMetaAds(
  pool: Pool,
  config: AppConfig,
  range: MetaSyncRange,
): Promise<{ companies: number; succeeded: number; failed: number; results: Array<{ companyId: string; summary?: MetaSyncSummary; error?: string }> }> {
  const companies = await pool.query<{ company_id: string }>(
    `select company_id from company_integrations
      where provider = 'meta' and enabled = true
      order by company_id asc`,
  )
  const results: Array<{ companyId: string; summary?: MetaSyncSummary; error?: string }> = []
  for (const row of companies.rows) {
    try {
      results.push({ companyId: row.company_id, summary: await syncMetaAds(pool, config, row.company_id, range) })
    } catch (error) {
      results.push({ companyId: row.company_id, error: error instanceof Error ? error.message : 'Falha ao sincronizar.' })
    }
  }
  return {
    companies: companies.rows.length,
    succeeded: results.filter((result) => result.summary).length,
    failed: results.filter((result) => result.error).length,
    results,
  }
}

export async function processAllPendingMetaConversions(
  pool: Pool,
  config: AppConfig,
  limit: number,
): Promise<{ companies: number; claimed: number; sent: number; failed: number; skipped: number }> {
  const companies = await pool.query<{ company_id: string }>(
    `select company_id from company_integrations
      where provider = 'meta' and enabled = true
      order by company_id asc`,
  )
  let claimed = 0
  let sent = 0
  let failed = 0
  let skipped = 0
  for (const row of companies.rows) {
    const result = await processPendingMetaConversions(pool, config, row.company_id, limit)
    claimed += result.claimed
    sent += result.sent
    failed += result.failed
    skipped += result.skipped
  }
  return { companies: companies.rows.length, claimed, sent, failed, skipped }
}

export function conversionEventForStage(stage: string): MetaConversionEventName | null {
  if (stage === 'qualificado') return 'QualifiedLead'
  if (stage === 'vendido') return 'Purchase'
  return null
}
