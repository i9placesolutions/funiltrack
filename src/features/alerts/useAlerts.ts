/**
 * Fonte única de dados da central de alertas.
 *
 * A mesma lista exibida em `/alertas` (API + derivados do motor de regras,
 * com deduplicação por tipo+refId) alimenta também o badge de não lidos da
 * bottom nav — este módulo centraliza essa lógica para que ambos nunca
 * divirjam.
 *
 * Semântica de "lido" (idêntica nos dois lugares): flag `read` do servidor
 * OU marcação local no AppContext (`readAlertIds`).
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { queryKeys } from '../../lib/query/keys'
import { staleTimes } from '../../lib/query/queryClient'
import {
  evaluateAlertRules,
  isoDate,
  mergeWithApiAlerts,
  type DerivedAlert,
} from '../../lib/alerts/rules'
import { loadAlertTargets } from '../../lib/alerts/targets'
import { useApp } from '../../hooks/useApp'

export interface UseAllAlertsResult {
  /** Alertas da API mesclados com os derivados do motor de regras. */
  allAlerts: DerivedAlert[]
  isLoading: boolean
  isError: boolean
  refetchAlerts: () => void
}

/**
 * Carrega os alertas da API e os derivados do motor de regras (campanhas +
 * métricas + leads com os thresholds de `targets.ts`), já mesclados e
 * ordenados — exatamente o conjunto que a central `/alertas` exibe.
 */
export function useAllAlerts(): UseAllAlertsResult {
  // Thresholds configuráveis (definidos no onboarding / Config) como query
  // TanStack: todas as instâncias (central + badge) compartilham a MESMA
  // fonte reativa. `saveAlertTargets` invalida `['alert-targets']` e ambos
  // reavaliam o motor de regras juntos — sem divergência badge × central.
  const targetsQuery = useQuery({
    queryKey: queryKeys.alertTargets,
    queryFn: loadAlertTargets,
    // Só muda via invalidação explícita (saveAlertTargets).
    staleTime: Infinity,
  })
  const targets = targetsQuery.data

  // Instante de referência do motor — acompanha o dia atual (ver useAlertNow).
  const now = useAlertNow()

  const alertsQuery = useQuery({
    queryKey: queryKeys.alerts.all,
    queryFn: api.getAlerts,
    staleTime: staleTimes.dynamic,
  })

  // Dados para o motor de regras (nunca importamos os mocks diretamente).
  const campaignsQuery = useQuery({
    queryKey: queryKeys.campaigns.all,
    queryFn: api.getCampaigns,
    staleTime: staleTimes.campaigns,
  })

  const metricsParams = useMemo(
    () => ({ from: isoDate(addDays(now, -14)), to: isoDate(now) }),
    [now],
  )
  const metricsQuery = useQuery({
    queryKey: queryKeys.metrics.daily(metricsParams),
    queryFn: () => api.getDailyMetrics(metricsParams),
    staleTime: staleTimes.metrics,
  })

  const leadsParams = useMemo(() => ({ pageSize: 500 }), [])
  const leadsQuery = useQuery({
    queryKey: queryKeys.leads.list(leadsParams),
    queryFn: () => api.getLeads(leadsParams),
    staleTime: staleTimes.dynamic,
  })

  const derivedAlerts = useMemo(() => {
    // Só avalia quando todos os insumos chegaram.
    if (
      !targets ||
      !campaignsQuery.data ||
      !metricsQuery.data ||
      !leadsQuery.data
    ) {
      return []
    }
    return evaluateAlertRules({
      campaigns: campaignsQuery.data,
      metrics: metricsQuery.data,
      leads: leadsQuery.data.items,
      thresholds: {
        budgetRatio: targets.budgetThreshold,
        cplTargetCents: targets.cplTargetCents,
      },
      now,
    })
  }, [targets, campaignsQuery.data, metricsQuery.data, leadsQuery.data, now])

  const allAlerts = useMemo(() => {
    if (!alertsQuery.data) return []
    return mergeWithApiAlerts(alertsQuery.data, derivedAlerts)
  }, [alertsQuery.data, derivedAlerts])

  return {
    allAlerts,
    isLoading: alertsQuery.isPending || alertsQuery.isFetching,
    isError: alertsQuery.isError,
    refetchAlerts: () => void alertsQuery.refetch(),
  }
}

/** "Lido" efetivo: flag do servidor OU marcação local no contexto. */
export function isAlertEffectivelyRead(
  alert: DerivedAlert,
  readAlertIds: Set<string>,
): boolean {
  return alert.read || readAlertIds.has(alert.id)
}

/**
 * Instante de referência do motor de regras, derivado do DIA atual.
 *
 * Sessões longas não congelam os derivados: quando o dia vira, o estado
 * `today` muda e `now` é recalculado (métricas do dia, espera de leads,
 * janela de métricas consultada etc.).
 */
function useAlertNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => {
      const current = new Date()
      // Preserva a identidade enquanto for o mesmo dia (memoização estável).
      setNow((prev) => (isoDate(prev) === isoDate(current) ? prev : current))
    }, 60_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/**
 * Total de alertas não lidos do mesmo conjunto exibido em `/alertas`
 * (API + derivados, com a mesma semântica de "lido"). Usado pelo badge da
 * bottom nav.
 */
export function useUnreadAlertCount(): number {
  const { readAlertIds } = useApp()
  const { allAlerts } = useAllAlerts()
  const readSet = useMemo(() => new Set(readAlertIds), [readAlertIds])
  return allAlerts.filter((alert) => !isAlertEffectivelyRead(alert, readSet))
    .length
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}
