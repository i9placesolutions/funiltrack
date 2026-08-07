/**
 * Período do dashboard (7/30/90 dias), persistido na sessão.
 * As datas são locais (fuso do dispositivo) no formato ISO YYYY-MM-DD,
 * compatível com `getDailyMetrics({ from, to })` da fachada de API.
 */

export type PeriodDays = 7 | 30 | 90

export const PERIOD_OPTIONS: readonly PeriodDays[] = [7, 30, 90]

const STORAGE_KEY = 'funiltrack:dashboard-period'
const LEGACY_STORAGE_KEY = 'metatrack:dashboard-period'
const DEFAULT_PERIOD: PeriodDays = 30

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
    const parsed = Number(raw)
    return (PERIOD_OPTIONS as readonly number[]).includes(parsed)
      ? (parsed as PeriodDays)
      : DEFAULT_PERIOD
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

/** Janela atual: últimos N dias (inclui hoje). */
export function periodRange(days: PeriodDays): DateRange {
  return { from: isoDate(daysAgo(days - 1)), to: isoDate(daysAgo(0)) }
}

/** Janela imediatamente anterior (mesma duração), para comparação %. */
export function previousPeriodRange(days: PeriodDays): DateRange {
  return { from: isoDate(daysAgo(2 * days - 1)), to: isoDate(daysAgo(days)) }
}
