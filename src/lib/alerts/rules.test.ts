/**
 * Testes do motor de regras de alertas (src/lib/alerts/rules.ts).
 * Todas as regras são puras: thresholds e `now` são sempre injetados.
 */
import { describe, expect, it } from 'vitest'
import {
  checkBudgetRule,
  checkCplRule,
  checkLeadResponseRule,
  checkMessageSpikeRule,
  DEFAULT_THRESHOLDS,
  evaluateAlertRules,
  isoDate,
  mergeWithApiAlerts,
} from './rules'
import type { AlertThresholds } from './rules'
import type { Campaign, DailyMetric, Lead, LeadEvent } from '../api/types'
import { AlertType, LeadStage } from '../api/types'

/* ------------------------------------------------------------------ */
/* Builders de fixtures                                                */
/* ------------------------------------------------------------------ */

const NOW = new Date('2026-08-06T12:00:00')
const TODAY = isoDate(NOW)

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'cmp_test',
    name: 'Campanha Teste',
    status: 'ACTIVE',
    objective: 'LEADS',
    dailyBudget: 10000, // R$ 100,00
    spend: 0,
    startDate: '2026-08-01',
    ...overrides,
  }
}

function makeMetric(overrides: Partial<DailyMetric> = {}): DailyMetric {
  return {
    campaignId: 'cmp_test',
    date: TODAY,
    impressions: 1000,
    clicks: 20,
    spend: 5000,
    leads: 2,
    ctr: 0.02,
    cpc: 250,
    cpl: 2500,
    roas: 1.5,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<LeadEvent> = {}): LeadEvent {
  return {
    id: 'ev_test',
    type: 'mensagem_recebida',
    text: 'Olá!',
    at: NOW.toISOString(),
    ...overrides,
  }
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead_test',
    name: 'Maria Teste',
    phone: '+55 11 91234-5678',
    stage: LeadStage.NOVO,
    utmSource: 'facebook',
    utmMedium: 'cpc',
    utmCampaign: 'teste',
    campaignId: 'cmp_test',
    adSetId: 'as_test',
    adId: 'ad_test',
    createdAt: NOW.toISOString(),
    lastMessageAt: NOW.toISOString(),
    value: 0,
    timeline: [],
    ...overrides,
  }
}

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString()
}

function daysAgoDate(days: number): string {
  const d = new Date(NOW)
  d.setDate(d.getDate() - days)
  return isoDate(d)
}

/* ------------------------------------------------------------------ */
/* Regra 1 — orçamento                                                 */
/* ------------------------------------------------------------------ */

describe('checkBudgetRule', () => {
  it('alerta warning quando o gasto atinge 80% do orçamento diário', () => {
    const alerts = checkBudgetRule(
      [makeCampaign()],
      [makeMetric({ spend: 8000 })], // 80% de 10000
      DEFAULT_THRESHOLDS,
      NOW,
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0].type).toBe(AlertType.ORCAMENTO_ESTOURADO)
    expect(alerts[0].severity).toBe('warning')
    expect(alerts[0].refId).toBe('cmp_test')
    expect(alerts[0].id).toBe(`derived:ORCAMENTO:cmp_test:${TODAY}`)
  })

  it('alerta crítico quando o gasto estoura 100% do orçamento', () => {
    const alerts = checkBudgetRule(
      [makeCampaign()],
      [makeMetric({ spend: 12000 })], // 120%
      DEFAULT_THRESHOLDS,
      NOW,
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe('critical')
    expect(alerts[0].title).toBe('Orçamento diário estourado')
  })

  it('não alerta abaixo do threshold padrão (80%)', () => {
    const alerts = checkBudgetRule(
      [makeCampaign()],
      [makeMetric({ spend: 7999 })],
      DEFAULT_THRESHOLDS,
      NOW,
    )
    expect(alerts).toHaveLength(0)
  })

  it('respeita budgetRatio customizado', () => {
    const thresholds: AlertThresholds = { ...DEFAULT_THRESHOLDS, budgetRatio: 0.5 }
    const alerts = checkBudgetRule(
      [makeCampaign()],
      [makeMetric({ spend: 6000 })], // 60% — só alerta com ratio 0.5
      thresholds,
      NOW,
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe('warning')
  })

  it('ignora campanhas pausadas e sem orçamento diário', () => {
    const alerts = checkBudgetRule(
      [
        makeCampaign({ id: 'cmp_paused', status: 'PAUSED' }),
        makeCampaign({ id: 'cmp_zero', dailyBudget: 0 }),
      ],
      [
        makeMetric({ campaignId: 'cmp_paused', spend: 10000 }),
        makeMetric({ campaignId: 'cmp_zero', spend: 10000 }),
      ],
      DEFAULT_THRESHOLDS,
      NOW,
    )
    expect(alerts).toHaveLength(0)
  })

  it('usa a métrica mais recente até `now` e ignora datas futuras', () => {
    const future = new Date(NOW)
    future.setDate(future.getDate() + 1)
    const alerts = checkBudgetRule(
      [makeCampaign()],
      [
        makeMetric({ date: TODAY, spend: 9000 }),
        makeMetric({ date: isoDate(future), spend: 100 }), // futuro: ignorado
      ],
      DEFAULT_THRESHOLDS,
      NOW,
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe('warning') // 90% < 100%
  })
})

/* ------------------------------------------------------------------ */
/* Regra 2 — CPL acima do alvo                                         */
/* ------------------------------------------------------------------ */

describe('checkCplRule', () => {
  it('alerta warning quando o CPL está acima do alvo (menos de 2×)', () => {
    const alerts = checkCplRule(
      [makeCampaign()],
      [makeMetric({ leads: 2, cpl: 4000 })], // alvo padrão: 3500
      DEFAULT_THRESHOLDS,
      NOW,
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0].type).toBe(AlertType.CPL_ACIMA_MEDIA)
    expect(alerts[0].severity).toBe('warning')
    expect(alerts[0].refId).toBe('cmp_test')
  })

  it('alerta crítico quando o CPL é ≥ 2× o alvo', () => {
    const alerts = checkCplRule(
      [makeCampaign()],
      [makeMetric({ leads: 1, cpl: 7000 })], // exatamente 2× 3500
      DEFAULT_THRESHOLDS,
      NOW,
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe('critical')
  })

  it('não alerta quando o CPL está no alvo ou abaixo', () => {
    const alerts = checkCplRule(
      [makeCampaign()],
      [makeMetric({ leads: 2, cpl: 3500 })],
      DEFAULT_THRESHOLDS,
      NOW,
    )
    expect(alerts).toHaveLength(0)
  })

  it('não alerta em dia sem leads (CPL indefinido)', () => {
    const alerts = checkCplRule(
      [makeCampaign()],
      [makeMetric({ leads: 0, cpl: 9999 })],
      DEFAULT_THRESHOLDS,
      NOW,
    )
    expect(alerts).toHaveLength(0)
  })

  it('respeita cplTargetCents customizado', () => {
    const thresholds: AlertThresholds = {
      ...DEFAULT_THRESHOLDS,
      cplTargetCents: 1000,
    }
    const alerts = checkCplRule(
      [makeCampaign()],
      [makeMetric({ leads: 1, cpl: 2500 })], // 2.5× o alvo customizado
      thresholds,
      NOW,
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe('critical')
  })
})

/* ------------------------------------------------------------------ */
/* Regra 3 — pico de mensagens                                         */
/* ------------------------------------------------------------------ */

describe('checkMessageSpikeRule', () => {
  /** Histórico estável de 10 leads/dia nos últimos 7 dias. */
  function stableHistory(): DailyMetric[] {
    const metrics: DailyMetric[] = []
    for (let i = 1; i <= 7; i += 1) {
      metrics.push(makeMetric({ date: daysAgoDate(i), leads: 10 }))
    }
    return metrics
  }

  it('alerta quando o volume de hoje supera spikeMultiplier × média móvel', () => {
    const alerts = checkMessageSpikeRule(
      [...stableHistory(), makeMetric({ date: TODAY, leads: 25 })],
      DEFAULT_THRESHOLDS, // spikeMultiplier 2, média 10 → limite 20
      NOW,
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0].type).toBe('PICO_MENSAGENS')
    expect(alerts[0].severity).toBe('info')
  })

  it('soma leads de todas as campanhas no mesmo dia', () => {
    const alerts = checkMessageSpikeRule(
      [
        ...stableHistory(),
        makeMetric({ date: TODAY, leads: 12 }),
        makeMetric({ campaignId: 'cmp_outra', date: TODAY, leads: 13 }),
      ],
      DEFAULT_THRESHOLDS, // total 25 > 20
      NOW,
    )
    expect(alerts).toHaveLength(1)
  })

  it('não alerta quando o volume fica dentro do limite', () => {
    const alerts = checkMessageSpikeRule(
      [...stableHistory(), makeMetric({ date: TODAY, leads: 20 })],
      DEFAULT_THRESHOLDS, // 20 ≤ 2×10
      NOW,
    )
    expect(alerts).toHaveLength(0)
  })

  it('não alerta sem histórico mínimo (menos de 3 dias com volume)', () => {
    const alerts = checkMessageSpikeRule(
      [
        makeMetric({ date: daysAgoDate(1), leads: 5 }),
        makeMetric({ date: daysAgoDate(2), leads: 5 }),
        makeMetric({ date: TODAY, leads: 100 }),
      ],
      DEFAULT_THRESHOLDS,
      NOW,
    )
    expect(alerts).toHaveLength(0)
  })

  it('respeita spikeMultiplier customizado', () => {
    const thresholds: AlertThresholds = { ...DEFAULT_THRESHOLDS, spikeMultiplier: 3 }
    const alerts = checkMessageSpikeRule(
      [...stableHistory(), makeMetric({ date: TODAY, leads: 25 })],
      thresholds, // 25 ≤ 3×10 → sem alerta
      NOW,
    )
    expect(alerts).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/* Regra 4 — lead sem resposta                                         */
/* ------------------------------------------------------------------ */

describe('checkLeadResponseRule', () => {
  it('alerta quando a última mensagem recebida passou de 2h sem resposta', () => {
    const lead = makeLead({
      timeline: [makeEvent({ type: 'mensagem_recebida', at: hoursAgo(3) })],
    })
    const alerts = checkLeadResponseRule([lead], DEFAULT_THRESHOLDS, NOW)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].type).toBe(AlertType.LEAD_SEM_RESPOSTA)
    expect(alerts[0].severity).toBe('warning')
    expect(alerts[0].refId).toBe('lead_test')
  })

  it('não alerta dentro da janela de resposta (≤ 2h)', () => {
    const lead = makeLead({
      timeline: [makeEvent({ type: 'mensagem_recebida', at: hoursAgo(1) })],
    })
    expect(checkLeadResponseRule([lead], DEFAULT_THRESHOLDS, NOW)).toHaveLength(0)
  })

  it('não alerta quando a última interação é mensagem enviada (já respondido)', () => {
    const lead = makeLead({
      timeline: [
        makeEvent({ id: 'ev1', type: 'mensagem_recebida', at: hoursAgo(5) }),
        makeEvent({ id: 'ev2', type: 'mensagem_enviada', at: hoursAgo(4) }),
      ],
    })
    expect(checkLeadResponseRule([lead], DEFAULT_THRESHOLDS, NOW)).toHaveLength(0)
  })

  it('ignora leads fechados (vendido/perdido)', () => {
    const vendido = makeLead({
      id: 'lead_vendido',
      stage: LeadStage.VENDIDO,
      timeline: [makeEvent({ type: 'mensagem_recebida', at: hoursAgo(10) })],
    })
    const perdido = makeLead({
      id: 'lead_perdido',
      stage: LeadStage.PERDIDO,
      timeline: [makeEvent({ type: 'mensagem_recebida', at: hoursAgo(10) })],
    })
    expect(
      checkLeadResponseRule([vendido, perdido], DEFAULT_THRESHOLDS, NOW),
    ).toHaveLength(0)
  })

  it('ignora leads sem mensagens na timeline', () => {
    const lead = makeLead({ timeline: [makeEvent({ type: 'lead_criado', at: hoursAgo(10) })] })
    expect(checkLeadResponseRule([lead], DEFAULT_THRESHOLDS, NOW)).toHaveLength(0)
  })

  it('respeita leadResponseHours customizado', () => {
    const lead = makeLead({
      timeline: [makeEvent({ type: 'mensagem_recebida', at: hoursAgo(3) })],
    })
    const thresholds: AlertThresholds = {
      ...DEFAULT_THRESHOLDS,
      leadResponseHours: 4,
    }
    expect(checkLeadResponseRule([lead], thresholds, NOW)).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/* Orquestração: evaluateAlertRules + mergeWithApiAlerts               */
/* ------------------------------------------------------------------ */

describe('evaluateAlertRules', () => {
  it('combina todas as regras e ordena por data decrescente', () => {
    const campaigns = [makeCampaign()]
    const metrics = [
      ...Array.from({ length: 7 }, (_, i) =>
        makeMetric({ date: daysAgoDate(i + 1), leads: 10 }),
      ),
      makeMetric({ date: TODAY, spend: 11000, leads: 1, cpl: 8000 }),
      makeMetric({ campaignId: 'cmp_outra', date: TODAY, leads: 25 }),
    ]
    const leads = [
      makeLead({
        timeline: [makeEvent({ type: 'mensagem_recebida', at: hoursAgo(3) })],
      }),
    ]

    const alerts = evaluateAlertRules({ campaigns, metrics, leads, now: NOW })

    const types = alerts.map((a) => a.type)
    expect(types).toContain(AlertType.ORCAMENTO_ESTOURADO) // 110%
    expect(types).toContain(AlertType.CPL_ACIMA_MEDIA) // 8000 > 2×3500
    expect(types).toContain('PICO_MENSAGENS') // 26 > 2×10
    expect(types).toContain(AlertType.LEAD_SEM_RESPOSTA)

    const dates = alerts.map((a) => a.createdAt)
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates)
  })

  it('aceita thresholds parciais mesclados com os padrões', () => {
    const alerts = evaluateAlertRules({
      campaigns: [makeCampaign()],
      metrics: [makeMetric({ spend: 6000 })], // 60% — só alerta com ratio 0.5
      leads: [],
      thresholds: { budgetRatio: 0.5 },
      now: NOW,
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0].type).toBe(AlertType.ORCAMENTO_ESTOURADO)
  })

  it('retorna vazio sem dados', () => {
    expect(
      evaluateAlertRules({ campaigns: [], metrics: [], leads: [], now: NOW }),
    ).toHaveLength(0)
  })
})

describe('mergeWithApiAlerts', () => {
  it('descarta derivados duplicados quando a API já tem o mesmo tipo+refId', () => {
    const apiAlert = {
      id: 'alert_api_1',
      type: AlertType.ORCAMENTO_ESTOURADO,
      severity: 'critical' as const,
      title: 'Orçamento estourado',
      message: 'Da API',
      createdAt: NOW.toISOString(),
      read: false,
      refId: 'cmp_test',
    }
    const derived = checkBudgetRule(
      [makeCampaign()],
      [makeMetric({ spend: 12000 })],
      DEFAULT_THRESHOLDS,
      NOW,
    )
    expect(derived).toHaveLength(1)

    const merged = mergeWithApiAlerts([apiAlert], derived)
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('alert_api_1')
  })

  it('mantém derivados sem correspondente na API', () => {
    const derived = checkLeadResponseRule(
      [
        makeLead({
          timeline: [makeEvent({ type: 'mensagem_recebida', at: hoursAgo(3) })],
        }),
      ],
      DEFAULT_THRESHOLDS,
      NOW,
    )
    const merged = mergeWithApiAlerts([], derived)
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe(`derived:LEAD:lead_test:${TODAY}`)
  })
})
