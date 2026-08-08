/**
 * Período do dashboard (7/30/90 dias ou todo o histórico), persistido na sessão.
 * As datas são locais (fuso do dispositivo) no formato ISO YYYY-MM-DD,
 * compatível com `getDailyMetrics({ from, to })` da fachada de API.
 */

export type PeriodDays = 7 | 30 | 90 | 'all'

export const PERIOD_OPTIONS: readonly PeriodDays[] = [7, 30, 90, 'all']

const STORAGE_KEY = 'funiltrack:dashboard-period'
const LEGACY_STORAGE_KEY = 'metatrack:dashboard-period'
const DEFAULT_PERIOD: PeriodDays = 30
const ALL_TIME_FROM = '1970-01-01'

/** Data local (não-UTC) em YYYY-MM-DD. */
function isoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function daysAgo(n: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - n)
  return date
}

/** Lê o período salvo na sessão (default: 30 dias). */
export function readPeriodDays(): PeriodDays {
  try {
    const raw =
      sessionStorage.getItem(STORAGE_KEY) ??
      sessionStorage.getItem(LEGACY_STORAGE_KEY)
    if (raw === 'all') return 'all'
    const parsed = Number(raw)
    if (parsed === 7 || parsed === 30 || parsed === 90) return parsed
    return DEFAULT_PERIOD
  } catch {
    return DEFAULT_PERIOD
  }
}

/** Persiste o período escolhido na sessão. */
export function writePeriodDays(days: PeriodDays): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, String(days))
  } catch {
    // sessionStorage indisponível — período vale só para a renderização atual.
  }
}

export interface DateRange {
  /** ISO YYYY-MM-DD, inclusivo. */
  from: string
  /** ISO YYYY-MM-DD, inclusivo. */
  to: string
}

/** Texto curto para os controles de período. */
export function periodLabel(days: PeriodDays): string {
  return days === 'all' ? 'Todos' : `${days} dias`
}

/** Texto descritivo para títulos e subtítulos. */
export function periodDescription(days: PeriodDays): string {
  return days === 'all' ? 'Todo o período' : `Últimos ${days} dias`
}

/** Janela atual: últimos N dias (inclui hoje) ou todo o histórico disponível. */
export function periodRange(days: PeriodDays): DateRange {
  if (days === 'all') {
    return { from: ALL_TIME_FROM, to: isoDate(daysAgo(0)) }
  }
  return { from: isoDate(daysAgo(days - 1)), to: isoDate(daysAgo(0)) }
}

/** Janela imediatamente anterior (mesma duração), para comparação %. */
export function previousPeriodRange(days: PeriodDays): DateRange | null {
  if (days === 'all') return null
  return { from: isoDate(daysAgo(2 * days - 1)), to: isoDate(daysAgo(days)) }
}
