/**
 * Regressão do conjunto de alertas sobre o dataset REAL gerado pelo seed
 * (src/mocks/data/*.json) — roda o motor completo + mesclagem com os alertas
 * de API exatamente como o app faz em `useAllAlerts`.
 *
 * Protege contra duas regressões históricas:
 * - C1: checkLeadResponseRule avaliava TODO o backlog histórico e o badge
 *   estreava em "99+" (~228 não lidos). Agora o total de não lidos deve
 *   ficar abaixo de um teto sensato.
 * - C2: o seed tinha só 90 dias de métricas e a janela anterior do período
 *   de 90 dias ficava vazia ("—" em todos os KPIs).
 */
import { describe, expect, it } from 'vitest'
import campaignsJson from '../../mocks/data/campaigns.json'
import metricsJson from '../../mocks/data/daily-metrics.json'
import leadsJson from '../../mocks/data/leads.json'
import alertsJson from '../../mocks/data/alerts.json'
import type { Alert, Campaign, DailyMetric, Lead } from '../api'
import {
  DEFAULT_THRESHOLDS,
  evaluateAlertRules,
  isoDate,
  mergeWithApiAlerts,
} from './rules'

const campaigns = campaignsJson as unknown as Campaign[]
const metrics = metricsJson as unknown as DailyMetric[]
const leads = leadsJson as unknown as Lead[]
const apiAlerts = alertsJson as unknown as Alert[]

/** Teto sensato de não lidos no estado inicial do demo (badge saudável). */
const MAX_UNREAD = 15

function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

describe('conjunto de alertas sobre o dataset real (seed)', () => {
  const now = new Date()

  const derived = evaluateAlertRules({
    campaigns,
    metrics,
    leads,
    thresholds: DEFAULT_THRESHOLDS,
    now,
  })
  const merged = mergeWithApiAlerts(apiAlerts, derived)
  const unread = merged.filter((alert) => !alert.read)

  it('mantém o total de não lidos abaixo do teto (regressão C1)', () => {
    expect(unread.length).toBeGreaterThan(0)
    expect(unread.length).toBeLessThanOrEqual(MAX_UNREAD)
  })

  it('mantém a regra de lead sem resposta demonstrável (alguns poucos)', () => {
    const leadAlerts = merged.filter(
      (alert) => alert.type === 'LEAD_SEM_RESPOSTA',
    )
    expect(leadAlerts.length).toBeGreaterThan(0)
    expect(leadAlerts.length).toBeLessThanOrEqual(10)
  })

  it('janela anterior do período de 90 dias tem métricas (regressão C2)', () => {
    // Mesma janela usada pelo dashboard: previousPeriodRange(90).
    const from = isoDate(addDays(now, -179))
    const to = isoDate(addDays(now, -90))
    const previousWindow = metrics.filter(
      (m) => m.date >= from && m.date <= to,
    )
    expect(previousWindow.length).toBeGreaterThan(0)
    // Pelo menos um dia de métrica por campanha na janela anterior.
    const campaignsCovered = new Set(previousWindow.map((m) => m.campaignId))
    expect(campaignsCovered.size).toBe(campaigns.length)
  })

  it('nenhuma métrica tem data futura (regressão C4)', () => {
    const today = isoDate(now)
    for (const metric of metrics) {
      expect(metric.date <= today).toBe(true)
    }
  })

  it('nenhum evento de timeline fica no futuro (regressão C4)', () => {
    const nowMs = now.getTime()
    for (const lead of leads) {
      for (const event of lead.timeline) {
        expect(new Date(event.at).getTime()).toBeLessThanOrEqual(nowMs)
      }
    }
  })

  it('lastMessageAt sempre tem evento de mensagem correspondente (regressão C3)', () => {
    for (const lead of leads) {
      if (!lead.lastMessageAt) continue
      const hasEvent = lead.timeline.some(
        (event) =>
          (event.type === 'mensagem_recebida' ||
            event.type === 'mensagem_enviada') &&
          event.at === lead.lastMessageAt,
      )
      expect(hasEvent).toBe(true)
    }
  })
})
