import { config as loadDotenv } from 'dotenv'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import type { Pool, PoolClient } from 'pg'
import { loadConfig } from './config.js'
import { createPool, runMigrations, withTransaction } from './db.js'

loadDotenv({ path: '.env.local' })
loadDotenv({ path: '.env' })

type JsonRecord = Record<string, unknown>

interface SeedSummary {
  skipped: boolean
  campaigns: number
  adSets: number
  ads: number
  metrics: number
  leads: number
  events: number
  alerts: number
}

const DATA_DIR = resolve(process.cwd(), 'src', 'mocks', 'data')
const DEMO_COMPANY_ID = 'company_i9place'

async function readDataset(fileName: string): Promise<JsonRecord[]> {
  const raw = await readFile(resolve(DATA_DIR, fileName), 'utf8')
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value)) throw new Error(`Dataset inválido: ${fileName}`)
  return value as JsonRecord[]
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

async function insertBatch(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
  conflictClause = 'on conflict do nothing',
): Promise<void> {
  const chunkSize = 200
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize)
    const values: unknown[] = []
    const placeholders = chunk.map((row, rowIndex) => {
      const rowPlaceholders = row.map((value, columnIndex) => {
        values.push(value)
        return `$${rowIndex * columns.length + columnIndex + 1}`
      })
      return `(${rowPlaceholders.join(', ')})`
    })

    await client.query(
      `insert into ${table} (${columns.join(', ')}) values ${placeholders.join(', ')} ${conflictClause}`,
      values,
    )
  }
}

export async function seedDemoData(pool: Pool): Promise<SeedSummary> {
  const existing = await pool.query<{ count: string }>(
    'select count(*)::text as count from campaigns',
  )
  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    return {
      skipped: true,
      campaigns: 0,
      adSets: 0,
      ads: 0,
      metrics: 0,
      leads: 0,
      events: 0,
      alerts: 0,
    }
  }

  const [campaigns, adSets, ads, metrics, leads, alerts] = await Promise.all([
    readDataset('campaigns.json'),
    readDataset('adsets.json'),
    readDataset('ads.json'),
    readDataset('daily-metrics.json'),
    readDataset('leads.json'),
    readDataset('alerts.json'),
  ])

  const events = leads.flatMap((lead) => {
    const timeline = Array.isArray(lead.timeline) ? lead.timeline : []
    return (timeline as JsonRecord[]).map((event) => ({
      leadId: asString(lead.id),
      id: asString(event.id),
      type: asString(event.type),
      text: asString(event.text),
      at: asString(event.at),
    }))
  })

  await withTransaction(pool, async (client) => {
    await insertBatch(
      client,
      'campaigns',
      [
        'company_id',
        'id',
        'name',
        'status',
        'objective',
        'daily_budget_cents',
        'spend_cents',
        'start_date',
        'end_date',
      ],
      campaigns.map((row) => [
        DEMO_COMPANY_ID,
        asString(row.id),
        asString(row.name),
        asString(row.status),
        asString(row.objective),
        asNumber(row.dailyBudget),
        asNumber(row.spend),
        asString(row.startDate),
        row.endDate ? asString(row.endDate) : null,
      ]),
    )

    await insertBatch(
      client,
      'ad_sets',
      [
        'company_id',
        'id',
        'campaign_id',
        'name',
        'status',
        'daily_budget_cents',
        'spend_cents',
        'start_date',
        'end_date',
      ],
      adSets.map((row) => [
        DEMO_COMPANY_ID,
        asString(row.id),
        asString(row.campaignId) || null,
        asString(row.name),
        asString(row.status),
        asNumber(row.dailyBudget),
        asNumber(row.spend),
        asString(row.startDate),
        row.endDate ? asString(row.endDate) : null,
      ]),
    )

    await insertBatch(
      client,
      'ads',
      [
        'company_id',
        'id',
        'ad_set_id',
        'campaign_id',
        'name',
        'status',
        'spend_cents',
        'impressions',
        'clicks',
      ],
      ads.map((row) => [
        DEMO_COMPANY_ID,
        asString(row.id),
        asString(row.adSetId) || null,
        asString(row.campaignId) || null,
        asString(row.name),
        asString(row.status),
        asNumber(row.spend),
        asNumber(row.impressions),
        asNumber(row.clicks),
      ]),
    )

    await insertBatch(
      client,
      'daily_metrics',
      [
        'company_id',
        'campaign_id',
        'metric_date',
        'impressions',
        'clicks',
        'spend_cents',
        'leads',
        'ctr',
        'cpc_cents',
        'cpl_cents',
        'roas',
      ],
      metrics.map((row) => [
        DEMO_COMPANY_ID,
        asString(row.campaignId),
        asString(row.date),
        asNumber(row.impressions),
        asNumber(row.clicks),
        asNumber(row.spend),
        asNumber(row.leads),
        asNumber(row.ctr),
        asNumber(row.cpc),
        asNumber(row.cpl),
        asNumber(row.roas),
      ]),
    )

    await insertBatch(
      client,
      'leads',
      [
        'company_id',
        'id',
        'name',
        'phone',
        'phone_digits',
        'stage',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'campaign_id',
        'ad_set_id',
        'ad_id',
        'created_at',
        'last_message_at',
        'value_cents',
      ],
      leads.map((row) => {
        const phone = asString(row.phone)
        return [
          DEMO_COMPANY_ID,
          asString(row.id),
          asString(row.name),
          phone,
          digitsOnly(phone),
          asString(row.stage, 'novo'),
          asString(row.utmSource),
          asString(row.utmMedium),
          asString(row.utmCampaign),
          asString(row.campaignId) || null,
          asString(row.adSetId) || null,
          asString(row.adId) || null,
          asString(row.createdAt),
          row.lastMessageAt ? asString(row.lastMessageAt) : null,
          asNumber(row.value),
        ]
      }),
    )

    await insertBatch(
      client,
      'lead_events',
      ['company_id', 'id', 'lead_id', 'type', 'text', 'occurred_at'],
      events.map((event) => [
        DEMO_COMPANY_ID,
        event.id,
        event.leadId,
        event.type,
        event.text,
        event.at,
      ]),
    )

    await insertBatch(
      client,
      'alerts',
      ['company_id', 'id', 'type', 'severity', 'title', 'message', 'created_at', 'read', 'ref_id'],
      alerts.map((row) => [
        DEMO_COMPANY_ID,
        asString(row.id),
        asString(row.type),
        asString(row.severity),
        asString(row.title),
        asString(row.message),
        asString(row.createdAt),
        Boolean(row.read),
        row.refId ? asString(row.refId) : null,
      ]),
    )
  })

  return {
    skipped: false,
    campaigns: campaigns.length,
    adSets: adSets.length,
    ads: ads.length,
    metrics: metrics.length,
    leads: leads.length,
    events: events.length,
    alerts: alerts.length,
  }
}

async function run(): Promise<void> {
  const config = loadConfig()
  const pool = createPool(config)
  try {
    await runMigrations(pool)
    const summary = await seedDemoData(pool)
    console.log(JSON.stringify(summary))
  } finally {
    await pool.end()
  }
}

const currentFile = process.argv[1] ? resolve(process.argv[1]) : ''
if (currentFile === fileURLToPath(import.meta.url)) {
  void run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
