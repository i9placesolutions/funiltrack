/**
 * Fachada assíncrona da camada de dados.
 *
 * Componentes NUNCA importam mocks diretamente — sempre usam a implementação
 * exportada por `src/lib/api/index.ts` (escolhida via VITE_USE_MOCKS).
 */
import type {
  Alert,
  Campaign,
  DailyMetric,
  Lead,
  LeadStage,
} from './types'

export interface Paginated<T> {
  items: T[]
  total: number
  /**
   * Cursor opaco da próxima página (para uso em `getNextPageParam`).
   * null quando não há mais páginas.
   */
  nextCursor: string | null
}

export interface GetLeadsParams {
  page?: number
  pageSize?: number
  /** Busca por nome ou telefone. */
  search?: string
  stage?: LeadStage
  campaignId?: string
  utmSource?: string
}

export interface GetDailyMetricsParams {
  /** ISO-8601 (YYYY-MM-DD), inclusivo. */
  from: string
  /** ISO-8601 (YYYY-MM-DD), inclusivo. */
  to: string
  campaignId?: string
}

export interface ApiClient {
  getCampaigns(): Promise<Campaign[]>
  getCampaign(id: string): Promise<Campaign>
  getDailyMetrics(params: GetDailyMetricsParams): Promise<DailyMetric[]>
  getLeads(params?: GetLeadsParams): Promise<Paginated<Lead>>
  getLead(id: string): Promise<Lead>
  updateLeadStage(id: string, stage: LeadStage): Promise<Lead>
  getAlerts(): Promise<Alert[]>
  markAlertRead(id: string): Promise<Alert>
  /**
   * Origens UTM distintas do dataset COMPLETO de leads (para o filtro de
   * origem da lista — não pode depender apenas da primeira página carregada).
   */
  getLeadSources(): Promise<string[]>
}
