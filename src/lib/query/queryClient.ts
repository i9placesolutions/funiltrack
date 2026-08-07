/**
 * QueryClient global do FunilTrack.
 *
 * Estratégia de staleTime:
 * - Métricas históricas são imutáveis → staleTime alto (cache agressivo).
 * - Alertas e leads ativos mudam com frequência → staleTime curto (~30 s).
 */
import { QueryClient } from '@tanstack/react-query'

/** Política de cache por domínio de dados. */
export const staleTimes = {
  /** Métricas diárias históricas: dados imutáveis. */
  metrics: 60 * 60 * 1000,
  /** Cadastros de campanhas/ad sets: mudam pouco. */
  campaigns: 5 * 60 * 1000,
  /** Leads e alertas: dados quentes. */
  dynamic: 30 * 1000,
} as const

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Default conservador; queries específicas sobrescrevem via queryOptions.
      staleTime: staleTimes.dynamic,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
