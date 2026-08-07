/**
 * Implementação mock da fachada de API.
 *
 * - Lê os JSONs determinísticos gerados por `scripts/generate-mock-data.mjs`
 *   (via dynamic import, para code-splitting e lazy-loading).
 * - Latência simulada de 150–400 ms por chamada.
 * - Paginação e filtros reais sobre o dataset.
 * - Mutações (estágio de lead, leitura de alerta) persistem em localStorage
 *   como "overrides" aplicados sobre o JSON original.
 *
 * Componentes NUNCA importam este módulo diretamente — usam a fachada de
 * `src/lib/api/index.ts`.
 */
import type {
  ApiClient,
  GetDailyMetricsParams,
  GetLeadsParams,
  Paginated,
} from './client'
import type {
  Ad,
  AdSet,
  Alert,
  Campaign,
  DailyMetric,
  Lead,
} from './types'
import { LeadStage } from './types'

const STAGE_OVERRIDES_KEY = 'funiltrack:lead-stage-overrides'
const ALERT_READ_OVERRIDES_KEY = 'funiltrack:alert-read-overrides'
const LEGACY_STAGE_OVERRIDES_KEY = 'metatrack:lead-stage-overrides'
const LEGACY_ALERT_READ_OVERRIDES_KEY = 'metatrack:alert-read-overrides'

interface MockDb {
  campaigns: Campaign[]
  adSets: AdSet[]
  ads: Ad[]
  metrics: DailyMetric[]
  leads: Lead[]
  alerts: Alert[]
}

let dbPromise: Promise<MockDb> | null = null

function loadDb(): Promise<MockDb> {
  if (!dbPromise) {
    dbPromise = Promise.all([
      import('../../mocks/data/campaigns.json'),
      import('../../mocks/data/adsets.json'),
      import('../../mocks/data/ads.json'),
      import('../../mocks/data/daily-metrics.json'),
      import('../../mocks/data/leads.json'),
      import('../../mocks/data/alerts.json'),
    ]).then(([campaigns, adsets, ads, metrics, leads, alerts]) => ({
      campaigns: campaigns.default as unknown as Campaign[],
      adSets: adsets.default as unknown as AdSet[],
      ads: ads.default as unknown as Ad[],
      metrics: metrics.default as unknown as DailyMetric[],
      leads: leads.default as unknown as Lead[],
      alerts: alerts.default as unknown as Alert[],
    }))
  }
  return dbPromise
}

/** Latência simulada entre 150 e 400 ms. */
function simulateLatency(): Promise<void> {
  const ms = 150 + Math.random() * 250
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage indisponível (modo privado etc.) — mutação segue apenas em memória.
  }
}

function getStageOverrides(): Record<string, LeadStage> {
  const raw = readJson<Record<string, string>>(
    STAGE_OVERRIDES_KEY,
    readJson<Record<string, string>>(LEGACY_STAGE_OVERRIDES_KEY, {}),
  )
  // Valida contra o enum: um valor corrompido no localStorage (ex.: estágio
  // renomeado/inválido) faria o lead sumir do funil e dos filtros.
  const valid: Record<string, LeadStage> = {}
  const stages = Object.values(LeadStage) as string[]
  for (const [id, stage] of Object.entries(raw)) {
    if (stages.includes(stage)) valid[id] = stage as LeadStage
  }
  return valid
}

function getAlertReadOverrides(): string[] {
  const current = readJson<string[]>(ALERT_READ_OVERRIDES_KEY, [])
  if (current.length > 0) return current
  return readJson<string[]>(LEGACY_ALERT_READ_OVERRIDES_KEY, [])
}

/** Aplica overrides persistidos sobre os leads do JSON. */
function withStageOverrides(leads: Lead[]): Lead[] {
  const overrides = getStageOverrides()
  return leads.map((lead) =>
    overrides[lead.id] && overrides[lead.id] !== lead.stage
      ? { ...lead, stage: overrides[lead.id] }
      : lead,
  )
}

/** Aplica overrides persistidos sobre os alertas do JSON. */
function withAlertOverrides(alerts: Alert[]): Alert[] {
  const readIds = new Set(getAlertReadOverrides())
  return alerts.map((alert) =>
    readIds.has(alert.id) ? { ...alert, read: true } : alert,
  )
}

/**
 * Busca por nome e/ou telefone com termos mistos tratados de forma coerente:
 * - só letras → casa com o nome;
 * - só dígitos → casa com o telefone (ignorando formatação);
 * - misto (ex.: "ana 11") → exige match da parte textual no nome E dos
 *   dígitos no telefone (antes, os dígitos ignoravam o nome por completo).
 */
function matchesSearch(lead: Lead, term: string): boolean {
  const digits = term.replace(/\D/g, '')
  const letters = term.replace(/\d/g, '').trim()
  const phoneDigits = lead.phone.replace(/\D/g, '')

  if (letters && digits) {
    return (
      lead.name.toLowerCase().includes(letters.toLowerCase()) &&
      phoneDigits.includes(digits)
    )
  }
  if (digits) return phoneDigits.includes(digits)
  return lead.name.toLowerCase().includes(term)
}

export const mockClient: ApiClient = {
  async getCampaigns(): Promise<Campaign[]> {
    const db = await loadDb()
    await simulateLatency()
    return db.campaigns.map((campaign) => ({ ...campaign }))
  },

  async getCampaign(id: string): Promise<Campaign> {
    const db = await loadDb()
    await simulateLatency()
    const campaign = db.campaigns.find((c) => c.id === id)
    if (!campaign) throw new Error(`Campanha não encontrada: ${id}`)
    return { ...campaign }
  },

  async getDailyMetrics(params: GetDailyMetricsParams): Promise<DailyMetric[]> {
    const db = await loadDb()
    await simulateLatency()
    const { from, to, campaignId } = params
    return db.metrics
      .filter(
        (m) =>
          m.date >= from &&
          m.date <= to &&
          (campaignId ? m.campaignId === campaignId : true),
      )
      .map((m) => ({ ...m }))
      .sort((a, b) => a.date.localeCompare(b.date))
  },

  async getLeads(params?: GetLeadsParams): Promise<Paginated<Lead>> {
    const db = await loadDb()
    await simulateLatency()

    const { page = 1, pageSize = 20, search, stage, campaignId, utmSource } =
      params ?? {}

    let leads = withStageOverrides(db.leads)

    if (stage) leads = leads.filter((l) => l.stage === stage)
    if (campaignId) leads = leads.filter((l) => l.campaignId === campaignId)
    if (utmSource) leads = leads.filter((l) => l.utmSource === utmSource)
    if (search) {
      const term = search.trim().toLowerCase()
      if (term) leads = leads.filter((l) => matchesSearch(l, term))
    }

    leads = leads
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    const total = leads.length
    const start = (page - 1) * pageSize
    const items = leads.slice(start, start + pageSize)
    const next = start + pageSize
    return {
      items,
      total,
      // Cursor = número da próxima página (a fachada é página-based).
      nextCursor: next < total ? String(page + 1) : null,
    }
  },

  async getLead(id: string): Promise<Lead> {
    const db = await loadDb()
    await simulateLatency()
    const lead = withStageOverrides(db.leads).find((l) => l.id === id)
    if (!lead) throw new Error(`Lead não encontrado: ${id}`)
    return { ...lead, timeline: lead.timeline.map((e) => ({ ...e })) }
  },

  async updateLeadStage(id: string, stage: LeadStage): Promise<Lead> {
    const db = await loadDb()
    await simulateLatency()
    const base = db.leads.find((l) => l.id === id)
    if (!base) throw new Error(`Lead não encontrado: ${id}`)

    const overrides = getStageOverrides()
    overrides[id] = stage
    writeJson(STAGE_OVERRIDES_KEY, overrides)

    return { ...base, stage }
  },

  async getAlerts(): Promise<Alert[]> {
    const db = await loadDb()
    await simulateLatency()
    return withAlertOverrides(db.alerts)
      .map((a) => ({ ...a }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  },

  async markAlertRead(id: string): Promise<Alert> {
    const db = await loadDb()
    await simulateLatency()
    const alert = db.alerts.find((a) => a.id === id)
    if (!alert) throw new Error(`Alerta não encontrado: ${id}`)

    const readIds = new Set(getAlertReadOverrides())
    readIds.add(id)
    writeJson(ALERT_READ_OVERRIDES_KEY, [...readIds])

    return { ...alert, read: true }
  },

  async getLeadSources(): Promise<string[]> {
    const db = await loadDb()
    await simulateLatency()
    // Derivado do dataset completo — não da página visível na lista.
    return [...new Set(db.leads.map((lead) => lead.utmSource))].sort()
  },
}
