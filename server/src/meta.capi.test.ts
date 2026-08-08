import { describe, expect, it } from 'vitest'
import { buildMetaCapiEvent } from './meta.js'

describe('buildMetaCapiEvent', () => {
  it('envia os identificadores de matching sem hashear IP, user-agent, fbp, fbc ou CTWA', () => {
    const event = buildMetaCapiEvent({
      companyId: 'company_test',
      eventName: 'Lead',
      eventId: 'event_test',
      eventTime: new Date('2026-08-07T21:25:00.000Z'),
      phone: '+55 (11) 99999-0000',
      valueCents: 2590,
      currency: 'BRL',
      leadId: 'lead_test',
      matching: {
        fbp: 'fb.1.1596403881668.1116446470',
        fbc: 'fb.1.1786137900000.fbclid_test',
        ctwaClid: 'ctwa_test',
        clientIp: '2001:db8:85a3::8a2e:370:7334',
        clientUserAgent: 'Mozilla/5.0 CAPI Test',
      },
    })
    const userData = event.user_data as Record<string, unknown>

    expect(event.action_source).toBe('system_generated')
    expect(userData.client_ip_address).toBe('2001:db8:85a3::8a2e:370:7334')
    expect(userData.client_user_agent).toBe('Mozilla/5.0 CAPI Test')
    expect(userData.fbp).toBe('fb.1.1596403881668.1116446470')
    expect(userData.fbc).toBe('fb.1.1786137900000.fbclid_test')
    expect(userData.ctwa_clid).toBe('ctwa_test')
    expect(userData.ph).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/)])
    expect(userData.external_id).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/)])
  })

  it('descarta um IP inválido em vez de reportar um valor inventado à Meta', () => {
    const event = buildMetaCapiEvent({
      companyId: 'company_test',
      eventName: 'Lead',
      eventId: 'event_test_invalid_ip',
      eventTime: new Date('2026-08-07T21:25:00.000Z'),
      phone: '+55 11 99999-0000',
      valueCents: 0,
      currency: 'BRL',
      leadId: 'lead_test',
      matching: { clientIp: 'não-é-um-ip', clientUserAgent: 'Mozilla/5.0 CAPI Test' },
    })
    const userData = event.user_data as Record<string, unknown>

    expect(userData.client_ip_address).toBeUndefined()
    expect(userData.client_user_agent).toBe('Mozilla/5.0 CAPI Test')
  })
})
