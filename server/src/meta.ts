import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { AppConfig } from './config.js'
import { withTransaction } from './db.js'

type JsonRecord = Record<string, unknown>
type Queryable = Pool | PoolClient

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

export interface MetaStatus {
  configured: boolean
  adsConfigured: boolean
  conversionsConfigured: boolean
  adAccountId: string | null
  datasetId: string | null
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

function requireAdsConfig(config: AppConfig): { accessToken: string; accountId: string } {
  if (!config.metaAccessToken || !config.metaAdAccountId) {
    throw new MetaConfigurationError(
      'Configure META_ACCESS_TOKEN e META_AD_ACCOUNT_ID para consultar os anúncios.',
    )
  }
  return {
    accessToken: config.metaAccessToken,
    accountId: normalizedAccountId(config.metaAdAccountId),
  }
}

function requireConversionsConfig(config: AppConfig): { accessToken: string; datasetId: string } {
  const datasetId = config.metaDatasetId ?? config.metaPixelId
  if (!config.metaAccessToken || !datasetId) {
    throw new MetaConfigurationError(
      'Configure META_ACCESS_TOKEN e META_DATASET_ID ou META_PIXEL_ID para enviar conversões.',
    )
  }
  return { accessToken: config.metaAccessToken, datasetId }
}

async function metaRequest<T>(
  config: AppConfig,
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
      Authorization: `Bearer ${config.metaAccessToken ?? ''}`,
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
  config: AppConfig,
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
  status: string,
  values: { lastSyncAt?: Date | null; lastError?: string | null; metadata?: JsonRecord },
): Promise<void> {
  await pool.query(
    `insert into integration_states (provider, status, last_sync_at, last_error, metadata, updated_at)
     values ('meta', $1, $2, $3, $4, now())
     on conflict (provider) do update set
       status = excluded.status,
       last_sync_at = excluded.last_sync_at,
       last_error = excluded.last_error,
       metadata = excluded.metadata,
       updated_at = now()`,
    [status, values.lastSyncAt ?? null, values.lastError ?? null, JSON.stringify(values.metadata ?? {})],
  )
}

export async function getMetaStatus(pool: Pool, config: AppConfig): Promise<MetaStatus> {
  const state = await pool.query<JsonRecord>(
    `select status, last_sync_at, last_error from integration_states where provider = 'meta'`,
  )
  const row = state.rows[0]
  const adsConfigured = Boolean(config.metaAccessToken && config.metaAdAccountId)
  const conversionsConfigured = Boolean(config.metaAccessToken && (config.metaDatasetId || config.metaPixelId))
  return {
    configured: adsConfigured || conversionsConfigured,
    adsConfigured,
    conversionsConfigured,
    adAccountId: config.metaAdAccountId ?? null,
    datasetId: config.metaDatasetId ?? config.metaPixelId ?? null,
    graphApiVersion: config.metaGraphApiVersion,
    lastSyncAt: row?.last_sync_at ? new Date(String(row.last_sync_at)).toISOString() : null,
    lastError: text(row?.last_error) || null,
  }
}

export async function syncMetaAds(
  pool: Pool,
  config: AppConfig,
  range: MetaSyncRange,
): Promise<MetaSyncSummary> {
  const { accountId } = requireAdsConfig(config)
  if (range.from > range.to) throw new MetaConfigurationError('O período da Meta é inválido.')

  try {
    const campaignRows = await fetchCollection<MetaCampaign>(config, `/${accountId}/campaigns`, {
      fields: 'id,name,status,effective_status,objective,daily_budget,start_time,stop_time',
      limit: '500',
    })
    const adSetRows = await fetchCollection<MetaAdSet>(config, `/${accountId}/adsets`, {
      fields: 'id,campaign_id,name,status,effective_status,daily_budget,start_time,end_time',
      limit: '500',
    })
    const adRows = await fetchCollection<MetaAd>(config, `/${accountId}/ads`, {
      fields: 'id,adset_id,campaign_id,name,status,effective_status',
      limit: '500',
    })
    const timeRange = JSON.stringify({ since: range.from, until: range.to })
    const campaignInsightRows = await fetchCollection<MetaInsight>(config, `/${accountId}/insights`, {
      level: 'campaign',
      time_increment: '1',
      time_range: timeRange,
      fields: 'campaign_id,campaign_name,date_start,impressions,clicks,spend,actions,action_values',
      limit: '500',
    })
    const adInsightRows = await fetchCollection<MetaInsight>(config, `/${accountId}/insights`, {
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
            (id, name, status, objective, daily_budget_cents, spend_cents, start_date, end_date)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (id) do update set
             name = excluded.name,
             status = excluded.status,
             objective = excluded.objective,
             daily_budget_cents = excluded.daily_budget_cents,
             spend_cents = excluded.spend_cents,
             start_date = excluded.start_date,
             end_date = excluded.end_date,
             updated_at = now()`,
          [
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
            (id, campaign_id, name, status, daily_budget_cents, spend_cents, start_date, end_date)
           values ($1, $2, $3, $4, $5, 0, $6, $7)
           on conflict (id) do update set
             campaign_id = excluded.campaign_id,
             name = excluded.name,
             status = excluded.status,
             daily_budget_cents = excluded.daily_budget_cents,
             start_date = excluded.start_date,
             end_date = excluded.end_date,
             updated_at = now()`,
          [
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
          const adSet = await client.query<{ id: string }>('select id from ad_sets where id = $1', [row.adSetId])
          if (!adSet.rows[0]) continue
        }
        await client.query(
          `insert into ads
            (id, ad_set_id, campaign_id, name, status, spend_cents, impressions, clicks)
           values ($1, $2, $3, $4, 'ARCHIVED', $5, $6, $7)
           on conflict (id) do update set
             ad_set_id = excluded.ad_set_id,
             campaign_id = excluded.campaign_id,
             name = excluded.name,
             spend_cents = excluded.spend_cents,
             impressions = excluded.impressions,
             clicks = excluded.clicks,
             updated_at = now()`,
          [row.id, row.adSetId, row.campaignId, row.name, row.spendCents, row.impressions, row.clicks],
        )
      }

      for (const metric of metrics) {
        await client.query(
          `insert into daily_metrics
            (campaign_id, metric_date, impressions, clicks, spend_cents, leads, ctr, cpc_cents, cpl_cents, roas)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           on conflict (campaign_id, metric_date) do update set
             impressions = excluded.impressions,
             clicks = excluded.clicks,
             spend_cents = excluded.spend_cents,
             leads = excluded.leads,
             ctr = excluded.ctr,
             cpc_cents = excluded.cpc_cents,
             cpl_cents = excluded.cpl_cents,
             roas = excluded.roas,
             updated_at = now()`,
          [
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
    await saveIntegrationState(pool, 'connected', { lastSyncAt: new Date(), lastError: null, metadata: { ...summary } })
    return summary
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível sincronizar a Meta.'
    await saveIntegrationState(pool, 'error', { lastError: message })
    throw error
  }
}

export async function enqueueMetaConversionEvent(
  queryable: Queryable,
  leadId: string,
  eventName: MetaConversionEventName,
  eventTime: Date,
  valueCents: number,
  currency = 'BRL',
): Promise<void> {
  await queryable.query(
    `insert into meta_conversion_events
      (id, lead_id, event_name, event_id, event_time, value_cents, currency, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (event_id) do nothing`,
    [
      `meta_conversion_${createHash('sha256').update(`${leadId}:${eventName}`).digest('hex').slice(0, 32)}`,
      leadId,
      eventName,
      `${leadId}:${eventName}`,
      eventTime,
      Math.max(0, Math.round(valueCents)),
      currency,
      JSON.stringify({ source: 'funiltrack', leadId, eventName }),
    ],
  )
}

function hashPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  return createHash('sha256').update(digits).digest('hex')
}

async function sendConversion(
  config: AppConfig,
  event: { eventName: string; eventId: string; eventTime: Date; phone: string; valueCents: number; currency: string; leadId: string },
): Promise<void> {
  const { datasetId } = requireConversionsConfig(config)
  const data: JsonRecord = {
    event_name: event.eventName,
    event_time: Math.floor(event.eventTime.getTime() / 1000),
    event_id: event.eventId,
    action_source: 'system_generated',
    user_data: { ph: [hashPhone(event.phone)] },
    custom_data: {
      currency: event.currency,
      value: event.valueCents / 100,
      lead_id: event.leadId,
    },
  }
  const body: JsonRecord = { data: [data] }
  if (config.metaTestEventCode) body.test_event_code = config.metaTestEventCode
  await metaRequest(config, `/${datasetId}/events`, { method: 'POST', body })
}

export async function processPendingMetaConversions(
  pool: Pool,
  config: AppConfig,
  limit: number,
): Promise<MetaConversionProcessSummary> {
  if (!config.metaAccessToken || !(config.metaDatasetId || config.metaPixelId)) {
    return { configured: false, claimed: 0, sent: 0, failed: 0, skipped: 0 }
  }
  const safeLimit = Math.min(Math.max(Math.round(limit), 1), 100)
  const claimed = await pool.query<JsonRecord>(
    `update meta_conversion_events e
       set status = 'processing', attempts = e.attempts + 1, updated_at = now()
      from leads l
     where e.lead_id = l.id
       and e.id in (
         select id from meta_conversion_events
          where status in ('pending', 'failed')
             or (status = 'processing' and updated_at < now() - interval '10 minutes')
          order by created_at asc
          limit $1
          for update skip locked
       )
     returning e.id, e.event_name, e.event_id, e.event_time, e.value_cents, e.currency, e.lead_id, l.phone`,
    [safeLimit],
  )
  let sent = 0
  let failed = 0
  let skipped = 0
  for (const row of claimed.rows) {
    try {
      await sendConversion(config, {
        eventName: text(row.event_name),
        eventId: text(row.event_id),
        eventTime: new Date(String(row.event_time)),
        phone: text(row.phone),
        valueCents: integer(row.value_cents),
        currency: text(row.currency, 'BRL'),
        leadId: text(row.lead_id),
      })
      await pool.query(
        `update meta_conversion_events
            set status = 'sent', sent_at = now(), last_error = null, updated_at = now()
          where id = $1`,
        [row.id],
      )
      sent += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao enviar conversão para a Meta.'
      await pool.query(
        `update meta_conversion_events
            set status = 'failed', last_error = $2, updated_at = now()
          where id = $1`,
        [row.id, message.slice(0, 500)],
      )
      failed += 1
    }
  }
  skipped = Math.max(0, safeLimit - claimed.rows.length)
  return { configured: true, claimed: claimed.rows.length, sent, failed, skipped }
}

export function conversionEventForStage(stage: string): MetaConversionEventName | null {
  if (stage === 'qualificado') return 'QualifiedLead'
  if (stage === 'vendido') return 'Purchase'
  return null
}
