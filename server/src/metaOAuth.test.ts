import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { loadConfig } from './config.js'
import {
  isMetaBusinessLoginConfigured,
  startMetaBusinessLogin,
} from './metaOAuth.js'

function testConfig(overrides: Record<string, string | undefined> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/funiltrack_test',
    INTEGRATIONS_ENCRYPTION_KEY: 'test-encryption-key-with-more-than-thirty-two-chars',
    APP_PUBLIC_URL: 'https://funiltrack.example',
    META_APP_ID: '123456789',
    META_APP_SECRET: 'test-app-secret',
    META_BUSINESS_LOGIN_CONFIG_ID: '987654321',
    ...overrides,
  })
}

describe('Meta Business Login', () => {
  it('gera uma autorização por empresa com state opaco e config_id', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 })
    const pool = { query } as unknown as Pool

    const result = await startMetaBusinessLogin(pool, testConfig(), 'company_a', 'user_a')
    const url = new URL(result.authorizationUrl)

    expect(url.origin).toBe('https://www.facebook.com')
    expect(url.pathname).toBe('/v25.0/dialog/oauth')
    expect(url.searchParams.get('client_id')).toBe('123456789')
    expect(url.searchParams.get('config_id')).toBe('987654321')
    expect(url.searchParams.get('redirect_uri')).toBe('https://funiltrack.example/api/meta/oauth/callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('override_default_response_type')).toBe('true')
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{40,}$/)

    const inserted = query.mock.calls[0]?.[1] as unknown[]
    expect(inserted[0]).toMatch(/^meta_oauth_[a-f0-9]{24}$/)
    expect(inserted[1]).toBe('company_a')
    expect(inserted[2]).toBe('user_a')
    expect(inserted[3]).toMatch(/^[a-f0-9]{64}$/)
    expect(inserted).not.toContain(url.searchParams.get('state'))
  })

  it('só libera Business Login quando a configuração global está completa', () => {
    expect(isMetaBusinessLoginConfigured(testConfig())).toBe(true)
    expect(isMetaBusinessLoginConfigured(testConfig({ META_APP_SECRET: undefined }))).toBe(false)
  })
})
