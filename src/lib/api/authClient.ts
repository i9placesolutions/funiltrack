export interface AuthUser {
  id: string
  name: string
  email: string
  role: 'owner' | 'admin' | 'member'
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
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

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const response = await request<{ user: AuthUser }>('/auth/me')
    return response.user
  } catch {
    return null
  }
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const response = await request<{ user: AuthUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  return response.user
}

export async function register(
  name: string,
  email: string,
  password: string,
): Promise<AuthUser> {
  const response = await request<{ user: AuthUser }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  })
  return response.user
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
