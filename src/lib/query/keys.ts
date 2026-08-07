/**
 * Convenção central de query keys do TanStack Query.
 * Estrutura em cascata para permitir invalidação em grupo:
 * ex.: invalidateQueries({ queryKey: queryKeys.leads.all }).
 */
import type { GetDailyMetricsParams, GetLeadsParams } from '../api/client'

export const queryKeys = {
  campaigns: {
    all: ['campaigns'] as const,
    detail: (id: string) => ['campaigns', id] as const,
  },
  metrics: {
    daily: (params: GetDailyMetricsParams) =>
      ['metrics', 'daily', params] as const,
  },
  leads: {
    all: ['leads'] as const,
    list: (params: GetLeadsParams) => ['leads', 'list', params] as const,
    detail: (id: string) => ['leads', 'detail', id] as const,
    /** Origens UTM distintas (dataset completo). */
    sources: ['leads', 'sources'] as const,
  },
  alerts: {
    all: ['alerts'] as const,
  },
  /** Metas/thresholds de alerta (localStorage) — fonte reativa do motor de regras. */
  alertTargets: ['alert-targets'] as const,
} as const
