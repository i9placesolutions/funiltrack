import { describe, expect, it } from 'vitest'
import { buildMetaSyncRange } from './metaScheduler.js'

describe('buildMetaSyncRange', () => {
  it('retorna uma janela inclusiva de três dias em UTC', () => {
    expect(buildMetaSyncRange(new Date('2026-08-07T21:25:00.000Z'), 3)).toEqual({
      from: '2026-08-05',
      to: '2026-08-07',
    })
  })

  it('aceita uma janela de apenas um dia', () => {
    expect(buildMetaSyncRange(new Date('2026-01-02T03:00:00.000Z'), 1)).toEqual({
      from: '2026-01-02',
      to: '2026-01-02',
    })
  })

  it('recusa uma janela inválida', () => {
    expect(() => buildMetaSyncRange(new Date('2026-01-02T03:00:00.000Z'), 0)).toThrow(
      'META_SYNC_LOOKBACK_DAYS',
    )
  })
})
