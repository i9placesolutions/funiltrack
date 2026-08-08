export interface AuthUser {
  id: string
  name: string
  email: string
  role: 'owner' | 'admin' | 'member'
}

export type CompanyRole = 'owner' | 'admin' | 'member'

export interface CompanySummary {
  id: string
  name: string
  slug: string
  role: CompanyRole
  onboardingComplete: boolean
}

export interface CompanyMember {
  id: string
  name: string
  email: string
  role: CompanyRole
  createdAt: string
}

export interface AuthSession {
  user: AuthUser
  companies: CompanySummary[]
  activeCompanyId: string | null
}

export interface WhatsAppStatus {
  configured: boolean
  instanceName: string
  status: string
  connected: boolean
  loggedIn: boolean
  jid: string | null
  qrcode: string | null
  paircode: string | null
  profileName: string | null
  profilePicUrl: string | null
  lastError: string | null
  updatedAt: string | null
}

export interface MetaStatus {
  configured: boolean
  adsConfigured: boolean
  conversionsConfigured: boolean
  adAccountId: string | null
  datasetId: string | null
  graphApiVersion: string
  lastSyncAt: string | null
  lastError: string | null
}

export interface MetaSyncSummary {
  from: string
  to: string
  campaigns: number
  adSets: number
  ads: number
  metrics: number
}

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')
const ACTIVE_COMPANY_KEY = 'funiltrack:active-company-id'

export function getActiveCompanyId(): string | null {
  try {
    const value = localStorage.getItem(ACTIVE_COMPANY_KEY)
    return value && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

export function setActiveCompanyId(companyId: string | null): void {
  try {
    if (companyId) localStorage.setItem(ACTIVE_COMPANY_KEY, companyId)
    else localStorage.removeItem(ACTIVE_COMPANY_KEY)
  } catch {
    // Storage indisponível: o cabeçalho ficará no estado de React desta sessão.
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const companyId = getActiveCompanyId()
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
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
    throw new Error(message ?? `Erro da API (${response.status}).`)
  }
  return payload as T
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  try {
    return await request<AuthSession>('/auth/me')
  } catch {
    return null
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  return (await getCurrentSession())?.user ?? null
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const response = await request<AuthSession>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  return response
}

export async function register(
  name: string,
  companyName: string,
  email: string,
  password: string,
): Promise<AuthSession> {
  const response = await request<AuthSession>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, companyName, email, password }),
  })
  return response
}

export async function logout(): Promise<void> {
  await request<{ ok: true }>('/auth/logout', { method: 'POST' })
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request<{ ok: true }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}

export async function createCompany(name: string): Promise<CompanySummary> {
  const response = await request<{ company: CompanySummary }>('/companies', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  return response.company
}

export async function updateCurrentCompany(name: string): Promise<CompanySummary> {
  const response = await request<{ company: CompanySummary }>('/company', {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
  return response.company
}

export async function completeCompanyOnboarding(): Promise<void> {
  await request<{ ok: true }>('/company/onboarding/complete', { method: 'POST' })
}

export async function getCompanyMembers(): Promise<CompanyMember[]> {
  const response = await request<{ members: CompanyMember[] }>('/company/members')
  return response.members
}

export async function addCompanyMember(email: string, role: CompanyRole): Promise<CompanyMember> {
  const response = await request<{ member: CompanyMember }>('/company/members', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  })
  return response.member
}

export async function removeCompanyMember(userId: string): Promise<void> {
  await request<{ ok: true }>(`/company/members/${encodeURIComponent(userId)}`, { method: 'DELETE' })
}

export async function saveMetaIntegration(input: {
  adAccountId: string
  accessToken?: string
  datasetId?: string
  pixelId?: string
  currency?: string
  testEventCode?: string
}): Promise<MetaStatus> {
  return request<MetaStatus>('/integrations/meta', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function saveUazApiIntegration(input: {
  baseUrl: string
  instanceName: string
  token?: string
}): Promise<{ saved: true }> {
  return request<{ saved: true }>('/integrations/uazapi', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function getWhatsAppStatus(): Promise<WhatsAppStatus> {
  return request<WhatsAppStatus>('/whatsapp/status')
}

export async function connectWhatsApp(options: {
  browser?: 'auto' | 'safari' | 'firefox' | 'edge' | 'chrome'
  phone?: string
  systemName?: string
} = {}): Promise<WhatsAppStatus> {
  return request<WhatsAppStatus>('/whatsapp/connect', {
    method: 'POST',
    body: JSON.stringify(options),
  })
}

export async function disconnectWhatsApp(): Promise<WhatsAppStatus> {
  return request<WhatsAppStatus>('/whatsapp/disconnect', { method: 'POST' })
}

export async function createWhatsAppInstance(): Promise<{ created: boolean; instanceName: string }> {
  return request<{ created: boolean; instanceName: string }>('/whatsapp/instance', {
    method: 'POST',
  })
}

export async function configureWhatsAppWebhook(): Promise<{ configured: boolean; urlPath: string }> {
  return request<{ configured: boolean; urlPath: string }>('/whatsapp/configure-webhook', {
    method: 'POST',
  })
}

export async function sendWhatsAppText(number: string, text: string): Promise<void> {
  await request<{ ok: true }>('/whatsapp/send/text', {
    method: 'POST',
    body: JSON.stringify({ number, text }),
  })
}

export async function getMetaStatus(): Promise<MetaStatus> {
  return request<MetaStatus>('/meta/status')
}

export async function syncMetaAds(from: string, to: string): Promise<MetaSyncSummary> {
  return request<MetaSyncSummary>('/meta/sync', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  })
}

export async function processMetaConversions(limit = 25): Promise<{
  configured: boolean
  claimed: number
  sent: number
  failed: number
  skipped: number
}> {
  return request('/meta/conversions/process', {
    method: 'POST',
    body: JSON.stringify({ limit }),
  })
}
