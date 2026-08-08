import { describe, expect, it } from 'vitest'
import {
  periodDescription,
  periodLabel,
  periodRange,
  previousPeriodRange,
} from './period'

describe('períodos do painel', () => {
  it('expõe todo o histórico sem limitar a janela a 90 dias', () => {
    const range = periodRange('all')

    expect(range.from).toBe('1970-01-01')
    expect(range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(periodLabel('all')).toBe('Todos')
    expect(periodDescription('all')).toBe('Todo o período')
  })

  it('não cria uma comparação anterior artificial para todo o histórico', () => {
    expect(previousPeriodRange('all')).toBeNull()
    expect(previousPeriodRange(90)).toEqual(
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
    )
  })
})
