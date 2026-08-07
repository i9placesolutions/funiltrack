/**
 * Motor de regras de alertas — PURO e testável.
 *
 * Todas as funções recebem dados + thresholds e retornam alertas derivados,
 * sem efeitos colaterais (sem rede, sem storage, sem relógio implícito:
 * o instante de referência `now` é sempre injetado).
 *
 * Regras implementadas:
 * 1. Orçamento: gasto do dia ≥ `budgetRatio` do orçamento diário da campanha
 *    (crítico quando já estourou 100%).
 * 2. CPL: custo por lead do dia acima do alvo configurado
 *    (crítico quando ≥ 2× o alvo).
 * 3. Pico de mensagens: volume de leads do dia > `spikeMultiplier` × média
 *    móvel dos últimos `spikeWindowDays` dias.
 * 4. Lead sem resposta: última interação do lead é uma mensagem recebida há
 *    mais de `leadResponseHours` horas — mas dentro do horizonte operacional
 *    de `leadResponseHours + leadResponseHorizonHours`. Mensagens muito
 *    antigas são histórico, não incidente ativo, e saem do escopo da regra.
 *
 * Decisão de contrato: o enum `AlertType` (src/lib/api/types.ts) é fechado e
 * não pode ser modificado nesta fase. A regra de pico de mensagens usa o
 * tipo estendido 'PICO_MENSAGENS' — a UI trata `DerivedAlertType` como união
 * e o restante do app segue usando `AlertType` normalmente.
 */
import type {
  Alert,
  AlertSeverity,
  Campaign,
  DailyMetric,
  Lead,
  LeadEvent,
} from '../api'
import { AlertType, LeadStage } from '../api'
import { formatBRL, formatPercent } from '../format'

/** Tipos possíveis de um alerta derivado (união do enum + extensão local). */
export type DerivedAlertType = AlertType | 'PICO_MENSAGENS'

/** Alerta produzido pelo motor de regras (sempre com id `derived:*`). */
export interface DerivedAlert extends Omit<Alert, 'type'> {
  type: DerivedAlertType
}

/** Thresholds configuráveis do motor (ver `src/lib/alerts/targets.ts`). */
export interface AlertThresholds {
  /** Fração do orçamento diário que dispara alerta (ex.: 0.8 = 80%). */
  budgetRatio: number
  /** CPL alvo em centavos de BRL. */
  cplTargetCents: number
  /** Pico = volume do dia > spikeMultiplier × média móvel. */
  spikeMultiplier: number
  /** Janela (em dias) da média móvel usada na regra de pico. */
  spikeWindowDays: number
  /** Horas sem resposta até alertar sobre um lead. */
  leadResponseHours: number
  /**
   * Horizonte operacional (horas) além de `leadResponseHours`: leads cuja
   * última mensagem é mais antiga que isso são histórico, não incidente.
   */
  leadResponseHorizonHours: number
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  budgetRatio: 0.8,
  cplTargetCents: 3500,
  spikeMultiplier: 2,
  spikeWindowDays: 7,
  leadResponseHours: 2,
  leadResponseHorizonHours: 48,
}

export const DERIVED_ID_PREFIX = 'derived:'

/** Um alerta é derivado (client-side) quando seu id usa o prefixo local. */
export function isDerivedAlertId(id: string): boolean {
  return id.startsWith(DERIVED_ID_PREFIX)
}

export interface EvaluateInput {
  campaigns: Campaign[]
  metrics: DailyMetric[]
  leads: Lead[]
  thresholds?: Partial<AlertThresholds>
  /** Instante de referência (injetado para testabilidade). */
  now: Date
}

/** Avalia todas as regras e retorna os alertas derivados (mais recentes 1º). */
export function evaluateAlertRules(input: EvaluateInput): DerivedAlert[] {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds }
  const { campaigns, metrics, leads, now } = input
  return [
    ...checkBudgetRule(campaigns, metrics, thresholds, now),
    ...checkCplRule(campaigns, metrics, thresholds, now),
    ...checkMessageSpikeRule(metrics, thresholds, now),
    ...checkLeadResponseRule(leads, thresholds, now),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Mescla alertas da fachada de API com os derivados pelo motor.
 *
 * Estratégia: a API é a fonte de verdade — quando já existe um alerta de API
 * com o mesmo (tipo, refId), o derivado correspondente é descartado
 * (evita duplicar "Orçamento estourado" etc.). Os demais derivados entram
 * como complementos, todos ordenados por data decrescente.
 */
export function mergeWithApiAlerts(
  apiAlerts: Alert[],
  derivedAlerts: DerivedAlert[],
): DerivedAlert[] {
  const apiKeys = new Set(
    apiAlerts.map((a) => dedupeKey(a.type, a.refId ?? null)),
  )
  const extras = derivedAlerts.filter(
    (d) => !apiKeys.has(dedupeKey(d.type, d.refId ?? null)),
  )
  return [...apiAlerts, ...extras].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
}

/* ------------------------------------------------------------------ */
/* Regras individuais                                                  */
/* ------------------------------------------------------------------ */

/** Regra 1 — orçamento da campanha ≥ budgetRatio consumido no dia. */
export function checkBudgetRule(
  campaigns: Campaign[],
  metrics: DailyMetric[],
  thresholds: AlertThresholds,
  now: Date,
): DerivedAlert[] {
  const alerts: DerivedAlert[] = []
  const latest = latestMetricByCampaign(metrics, now)

  for (const campaign of campaigns) {
    if (campaign.status !== 'ACTIVE' || campaign.dailyBudget <= 0) continue
    const metric = latest.get(campaign.id)
    if (!metric) continue

    const ratio = metric.spend / campaign.dailyBudget
    if (ratio < thresholds.budgetRatio) continue

    const severity: AlertSeverity = ratio >= 1 ? 'critical' : 'warning'
    const date = metric.date
    alerts.push({
      id: `${DERIVED_ID_PREFIX}ORCAMENTO:${campaign.id}:${date}`,
      type: AlertType.ORCAMENTO_ESTOURADO,
      severity,
      title:
        ratio >= 1
          ? 'Orçamento diário estourado'
          : 'Orçamento próximo do limite',
      message: `A campanha "${campaign.name}" já consumiu ${formatPercent(
        ratio,
      )} do orçamento diário de ${formatBRL(campaign.dailyBudget)}.`,
      createdAt: new Date(`${date}T12:00:00`).toISOString(),
      read: false,
      refId: campaign.id,
    })
  }
  return alerts
}

/** Regra 2 — CPL do dia acima do alvo configurado. */
export function checkCplRule(
  campaigns: Campaign[],
  metrics: DailyMetric[],
  thresholds: AlertThresholds,
  now: Date,
): DerivedAlert[] {
  const alerts: DerivedAlert[] = []
  const latest = latestMetricByCampaign(metrics, now)
  const campaignById = new Map(campaigns.map((c) => [c.id, c]))

  for (const [campaignId, metric] of latest) {
    if (metric.leads <= 0 || metric.cpl <= thresholds.cplTargetCents) continue
    const campaign = campaignById.get(campaignId)
    if (!campaign) continue

    const ratio = metric.cpl / thresholds.cplTargetCents
    const over = Math.round((ratio - 1) * 100)
    alerts.push({
      id: `${DERIVED_ID_PREFIX}CPL:${campaignId}:${metric.date}`,
      type: AlertType.CPL_ACIMA_MEDIA,
      severity: ratio >= 2 ? 'critical' : 'warning',
      title: 'CPL acima do alvo',
      message: `O custo por lead de "${campaign.name}" está ${over}% acima do alvo de ${formatBRL(thresholds.cplTargetCents)} (atual: ${formatBRL(metric.cpl)}).`,
      createdAt: new Date(`${metric.date}T12:00:00`).toISOString(),
      read: false,
      refId: campaignId,
    })
  }
  return alerts
}

/** Regra 3 — pico de mensagens: hoje > spikeMultiplier × média móvel. */
export function checkMessageSpikeRule(
  metrics: DailyMetric[],
  thresholds: AlertThresholds,
  now: Date,
): DerivedAlert[] {
  const today = isoDate(now)
  const totals = new Map<string, number>()
  for (const metric of metrics) {
    totals.set(metric.date, (totals.get(metric.date) ?? 0) + metric.leads)
  }

  const todayTotal = totals.get(today) ?? 0
  if (todayTotal <= 0) return []

  // Média móvel dos N dias anteriores ao dia atual.
  const history: number[] = []
  for (let i = 1; i <= thresholds.spikeWindowDays; i += 1) {
    const date = isoDate(addDays(now, -i))
    history.push(totals.get(date) ?? 0)
  }
  const avg =
    history.reduce((sum, n) => sum + n, 0) / thresholds.spikeWindowDays
  // Exige histórico mínimo para não alertar com base em pouca informação.
  if (avg <= 0 || history.filter((n) => n > 0).length < 3) return []

  if (todayTotal <= thresholds.spikeMultiplier * avg) return []

  return [
    {
      id: `${DERIVED_ID_PREFIX}PICO:${today}`,
      type: 'PICO_MENSAGENS',
      severity: 'info',
      title: 'Pico de mensagens recebido',
      message: `O volume de novas conversas hoje (${todayTotal}) está mais de ${thresholds.spikeMultiplier}× acima da média móvel (${avg.toFixed(1)}/dia). Reforce o atendimento.`,
      createdAt: now.toISOString(),
      read: false,
    },
  ]
}

/**
 * Regra 4 — lead sem resposta dentro do horizonte operacional.
 *
 * Um lead é considerado "incidente ativo" apenas quando a última mensagem
 * recebida caiu na janela (`leadResponseHours`, `leadResponseHours` +
 * `leadResponseHorizonHours`] horas atrás. Espera além do horizonte é
 * histórico (o lead já deveria ter sido tratado/qualificado) e não gera
 * alerta — isso evita que todo o backlog do funil lote a central.
 */
export function checkLeadResponseRule(
  leads: Lead[],
  thresholds: AlertThresholds,
  now: Date,
): DerivedAlert[] {
  const alerts: DerivedAlert[] = []
  const limitMs = thresholds.leadResponseHours * 60 * 60 * 1000
  const horizonMs =
    (thresholds.leadResponseHours + thresholds.leadResponseHorizonHours) *
    60 * 60 * 1000

  for (const lead of leads) {
    // Leads fechados não precisam de resposta.
    if (lead.stage === LeadStage.VENDIDO || lead.stage === LeadStage.PERDIDO) {
      continue
    }
    const lastMessage = lastMessageEvent(lead.timeline)
    if (!lastMessage || lastMessage.type !== 'mensagem_recebida') continue

    const waitingMs = now.getTime() - new Date(lastMessage.at).getTime()
    if (waitingMs <= limitMs || waitingMs > horizonMs) continue

    alerts.push({
      id: `${DERIVED_ID_PREFIX}LEAD:${lead.id}:${isoDate(new Date(lastMessage.at))}`,
      type: AlertType.LEAD_SEM_RESPOSTA,
      severity: 'warning',
      title: 'Lead aguardando resposta',
      message: `${lead.name} enviou mensagem há mais de ${thresholds.leadResponseHours}h e ainda não recebeu resposta.`,
      createdAt: lastMessage.at,
      read: false,
      refId: lead.id,
    })
  }
  return alerts
}

/* ------------------------------------------------------------------ */
/* Helpers puros                                                       */
/* ------------------------------------------------------------------ */

/** Métrica mais recente (até `now`) de cada campanha. */
function latestMetricByCampaign(
  metrics: DailyMetric[],
  now: Date,
): Map<string, DailyMetric> {
  const today = isoDate(now)
  const latest = new Map<string, DailyMetric>()
  for (const metric of metrics) {
    if (metric.date > today) continue
    const current = latest.get(metric.campaignId)
    if (!current || metric.date > current.date) latest.set(metric.campaignId, metric)
  }
  return latest
}

/** Último evento de mensagem (recebida ou enviada) da timeline do lead. */
function lastMessageEvent(timeline: LeadEvent[]): LeadEvent | null {
  let last: LeadEvent | null = null
  for (const event of timeline) {
    if (event.type !== 'mensagem_recebida' && event.type !== 'mensagem_enviada') {
      continue
    }
    if (!last || event.at > last.at) last = event
  }
  return last
}

function dedupeKey(type: string, refId: string | null): string {
  return `${type}::${refId ?? 'global'}`
}

/** ISO-8601 somente data (YYYY-MM-DD) no fuso local. */
export function isoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}
