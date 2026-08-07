/**
 * Testes dos formatadores pt-BR (src/lib/format.ts).
 * A camada de dados trabalha com CENTAVOS de BRL.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currencyMaskToCents,
  formatBRL,
  formatCompact,
  formatCurrencyMask,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatShortDate,
} from './format'

/** Normaliza espaços (Intl pode usar NBSP/narrow spaces dependendo da ICU). */
function norm(value: string): string {
  return value.replace(/[\u00a0\u202f\u2009]/g, ' ')
}

describe('formatBRL (centavos → reais)', () => {
  it('converte centavos para R$ com separadores pt-BR', () => {
    expect(norm(formatBRL(123456))).toBe('R$ 1.234,56')
  })

  it('formata zero e valores menores que um real', () => {
    expect(norm(formatBRL(0))).toBe('R$ 0,00')
    expect(norm(formatBRL(99))).toBe('R$ 0,99')
  })

  it('formata valores negativos', () => {
    expect(norm(formatBRL(-5000))).toBe('-R$ 50,00')
  })

  it('usa milhar com ponto', () => {
    expect(norm(formatBRL(193853675))).toBe('R$ 1.938.536,75')
  })
})

describe('máscara monetária de input (pt-BR)', () => {
  it('formatCurrencyMask exibe centavos como moeda', () => {
    expect(norm(formatCurrencyMask(4000))).toBe('R$ 40,00')
    expect(norm(formatCurrencyMask(4))).toBe('R$ 0,04')
    expect(norm(formatCurrencyMask(0))).toBe('R$ 0,00')
  })

  it('currencyMaskToCents extrai apenas dígitos (últimos dois = centavos)', () => {
    expect(currencyMaskToCents('R$ 40,00')).toBe(4000)
    expect(currencyMaskToCents('4')).toBe(4)
    expect(currencyMaskToCents('R$ 1.234,56')).toBe(123456)
  })

  it('currencyMaskToCents retorna null para vazio e ignora zeros à esquerda', () => {
    expect(currencyMaskToCents('')).toBeNull()
    expect(currencyMaskToCents('R$ 0,00')).toBe(0)
    expect(currencyMaskToCents('R$ 00,40')).toBe(40)
  })

  it('currencyMaskToCents limita dígitos para não estourar MAX_SAFE_INTEGER', () => {
    // 20 dígitos: sem o limite, Number() perderia precisão silenciosamente.
    const result = currencyMaskToCents('9'.repeat(20))
    expect(result).toBe(Number('9'.repeat(13)))
    expect(result!).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)
    // Dentro do limite nada muda.
    expect(currencyMaskToCents('1234567890123')).toBe(1234567890123)
  })
})

describe('formatNumber / formatCompact', () => {
  it('formata inteiros e decimais em pt-BR', () => {
    expect(norm(formatNumber(1234))).toBe('1.234')
    expect(norm(formatNumber(3.42))).toBe('3,42')
  })

  it('usa notação compacta', () => {
    expect(norm(formatCompact(12500))).toBe('12,5 mil')
  })
})

describe('formatPercent', () => {
  it('converte fração em percentual', () => {
    expect(norm(formatPercent(0.0342))).toBe('3,42%')
  })

  it('formata 0 e 100%', () => {
    expect(norm(formatPercent(0))).toBe('0%')
    expect(norm(formatPercent(1))).toBe('100%')
  })
})

describe('datas (pt-BR)', () => {
  const date = new Date(2026, 7, 6, 14, 30) // 06/08/2026 14:30 (mês 0-based)

  it('formatDate retorna dd/mm/aaaa', () => {
    expect(formatDate(date)).toBe('06/08/2026')
  })

  it('formatDate aceita timestamp e string ISO', () => {
    expect(formatDate(date.getTime())).toBe('06/08/2026')
    expect(formatDate('2026-08-06T14:30:00')).toBe('06/08/2026')
  })

  it('formatShortDate retorna dia e mês abreviado', () => {
    expect(norm(formatShortDate(date))).toMatch(/^0?6 de ago\.$/)
  })

  it('formatDateTime inclui data e hora', () => {
    const result = norm(formatDateTime(date))
    expect(result).toContain('06/08/2026')
    expect(result).toContain('14:30')
  })
})

describe('formatRelativeTime (tempo relativo pt-BR)', () => {
  const now = new Date('2026-08-06T12:00:00')

  function ago(ms: number): Date {
    return new Date(now.getTime() - ms)
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('menos de 45s → "agora"', () => {
    vi.useFakeTimers({ now })
    expect(formatRelativeTime(ago(10_000))).toBe('agora')
  })

  it('minutos atrás', () => {
    vi.useFakeTimers({ now })
    expect(formatRelativeTime(ago(5 * 60_000))).toBe('há 5 minutos')
    expect(formatRelativeTime(ago(60_000))).toBe('há 1 minuto')
  })

  it('horas atrás', () => {
    vi.useFakeTimers({ now })
    expect(formatRelativeTime(ago(2 * 3_600_000))).toBe('há 2 horas')
  })

  it('dias atrás', () => {
    vi.useFakeTimers({ now })
    expect(formatRelativeTime(ago(3 * 86_400_000))).toBe('há 3 dias')
  })

  it('aceita string ISO como entrada', () => {
    vi.useFakeTimers({ now })
    expect(formatRelativeTime(ago(5 * 60_000).toISOString())).toBe('há 5 minutos')
  })

  it('datas futuras usam "em …"', () => {
    vi.useFakeTimers({ now })
    expect(formatRelativeTime(new Date(now.getTime() + 2 * 3_600_000))).toBe(
      'em 2 horas',
    )
  })
})
