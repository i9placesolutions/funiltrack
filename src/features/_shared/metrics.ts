/**
 * Agregação de métricas diárias para KPIs e gráficos.
 *
 * Todos os valores monetários permanecem em CENTAVOS de BRL (formatação
 * apenas na camada de exibição via `formatBRL`).
 *
 * Fórmula do ROAS agregado:
 *   Cada `DailyMetric` já traz `roas` diário, então a receita estimada do dia
 *   é `roas_d × gasto_d`. O ROAS do período é a média ponderada pelo gasto:
 *     ROAS_período = Σ(roas_d × gasto_d) / Σ(gasto_d)
 *                  = receita estimada total / gasto total
 *   (Alternativa caso o campo não existisse: receita estimada = soma do
 *   `value` dos leads vendidos + qualificados atribuídos às campanhas.)
 */
import type { DailyMetric } from '../../lib/api'

/** KPIs agregados de um período. */
export interface PeriodKpis {
  /** Gasto total (centavos BRL). */
  spend: number
  /** Total de leads. */
  leads: number
  /** Custo por lead (centavos BRL); 0 sem leads. */
  cpl: number
  /** CTR como fração 0–1. */
  ctr: number
  /** Custo por clique (centavos BRL); 0 sem cliques. */
  cpc: number
  /** ROAS adimensional (receita estimada / gasto). */
  roas: number
}

/** Agrega métricas diárias em KPIs do período. */
export function aggregateMetrics(metrics: DailyMetric[]): PeriodKpis {
  let spend = 0
  let leads = 0
  let clicks = 0
  let impressions = 0
  let estimatedRevenue = 0

  for (const m of metrics) {
    spend += m.spend
    leads += m.leads
    clicks += m.clicks
    impressions += m.impressions
    estimatedRevenue += m.roas * m.spend
  }

  return {
    spend,
    leads,
    cpl: leads > 0 ? Math.round(spend / leads) : 0,
    ctr: impressions > 0 ? clicks / impressions : 0,
    cpc: clicks > 0 ? Math.round(spend / clicks) : 0,
    roas: spend > 0 ? estimatedRevenue / spend : 0,
  }
}

/** Ponto da série diária (custo + leads) para o gráfico de linha. */
export interface TrendPoint {
  /** ISO YYYY-MM-DD. */
  date: string
  /** Gasto do dia (centavos BRL). */
  spend: number
  /** Leads do dia. */
  leads: number
}

/** Agrupa métricas por dia somando todas as campanhas, em ordem cronológica. */
export function dailySeries(metrics: DailyMetric[]): TrendPoint[] {
  const byDate = new Map<string, TrendPoint>()
  for (const m of metrics) {
    const point = byDate.get(m.date)
    if (point) {
      point.spend += m.spend
      point.leads += m.leads
    } else {
      byDate.set(m.date, { date: m.date, spend: m.spend, leads: m.leads })
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Fatia de gasto por campanha para o gráfico donut. */
export interface CampaignSpendSlice {
  id: string
  /** Gasto no período (centavos BRL). */
  spend: number
}

/** Agrupa o gasto do período por campanha (ordem decrescente). */
export function spendByCampaign(metrics: DailyMetric[]): CampaignSpendSlice[] {
  const byCampaign = new Map<string, number>()
  for (const m of metrics) {
    byCampaign.set(m.campaignId, (byCampaign.get(m.campaignId) ?? 0) + m.spend)
  }
  return [...byCampaign.entries()]
    .map(([id, spend]) => ({ id, spend }))
    .sort((a, b) => b.spend - a.spend)
}

/**
 * Variação percentual relativa ao período anterior.
 * Retorna `null` quando não há base de comparação válida.
 */
export function percentDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null
  return (current - previous) / previous
}
