/**
 * Factory da camada de API.
 *
 * A implementação é escolhida pela env `VITE_USE_MOCKS` (default: backend real).
 * Componentes devem importar SEMPRE daqui:
 *
 *   import { api } from '@/lib/api' — nunca de mockClient/httpClient.
 */
import type { ApiClient } from './client'
import { httpClient } from './httpClient'
import { mockClient } from './mockClient'

export type {
  ApiClient,
  GetDailyMetricsParams,
  GetLeadsParams,
  Paginated,
} from './client'
export * from './types'

const useMocks = (import.meta.env.VITE_USE_MOCKS ?? 'false') === 'true'

export const api: ApiClient = useMocks ? mockClient : httpClient
