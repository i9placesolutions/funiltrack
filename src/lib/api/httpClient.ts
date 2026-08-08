/**
 * Cliente HTTP real (mesmo contrato do mockClient).
 *
 * Aponta para `VITE_API_BASE_URL` e é usado quando VITE_USE_MOCKS=false.
 */
import type {
  ApiClient,
  GetDailyMetricsParams,
  GetLeadsParams,
  Paginated,
} from './client'
import type {
  Alert,
  Campaign,
  DailyMetric,
  Lead,
  LeadStage,
} from './types'
import { getActiveCompanyId } from './authClient'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')
const API_TOKEN = import.meta.env.VITE_API_TOKEN?.trim()

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const companyId = getActiveCompanyId()
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
      ...(companyId ? { 'X-FunilTrack-Company-ID': companyId } : {}),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const payload = (await response.json().catch(() => null)) as
    | { message?: string }
    | T
    | null
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? payload.message
        : undefined
    throw new Error(message ?? `Erro da API (${response.status}) em ${path}`)
  }
  return payload as T
}

export const httpClient: ApiClient = {
  getCampaigns(): Promise<Campaign[]> {
    return request<Campaign[]>('/campaigns')
  },

  getCampaign(id: string): Promise<Campaign> {
    return request<Campaign>(`/campaigns/${encodeURIComponent(id)}`)
  },

  getDailyMetrics(params: GetDailyMetricsParams): Promise<DailyMetric[]> {
    const query = new URLSearchParams({ from: params.from, to: params.to })
    if (params.campaignId) query.set('campaign_id', params.campaignId)
    return request<DailyMetric[]>(`/metrics/daily?${query.toString()}`)
  },

  getLeads(params?: GetLeadsParams): Promise<Paginated<Lead>> {
    const query = new URLSearchParams()
    if (params?.page) query.set('page', String(params.page))
    if (params?.pageSize) query.set('page_size', String(params.pageSize))
    if (params?.search) query.set('search', params.search)
    if (params?.stage) query.set('stage', params.stage)
    if (params?.campaignId) query.set('campaign_id', params.campaignId)
    if (params?.utmSource) query.set('utm_source', params.utmSource)
    return request<Paginated<Lead>>(`/leads?${query.toString()}`)
  },

  getLead(id: string): Promise<Lead> {
    return request<Lead>(`/leads/${encodeURIComponent(id)}`)
  },

  updateLeadStage(id: string, stage: LeadStage): Promise<Lead> {
    return request<Lead>(`/leads/${encodeURIComponent(id)}/stage`, {
      method: 'PATCH',
      body: JSON.stringify({ stage }),
    })
  },

  getAlerts(): Promise<Alert[]> {
    return request<Alert[]>('/alerts')
  },

  markAlertRead(id: string): Promise<Alert> {
    return request<Alert>(`/alerts/${encodeURIComponent(id)}/read`, {
      method: 'POST',
    })
  },

  getLeadSources(): Promise<string[]> {
    return request<string[]>('/leads/sources')
  },
}
