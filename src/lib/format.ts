/**
 * Formatadores pt-BR / BRL.
 * Convenção monetária: a camada de dados trabalha com CENTAVOS de BRL;
 * `formatBRL` recebe centavos e exibe em reais.
 */

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const numberFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 2,
})

const compactFormatter = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 2,
})

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const shortDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
})

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const relativeFormatter = new Intl.RelativeTimeFormat('pt-BR', {
  numeric: 'auto',
})

/** Formata centavos de BRL como moeda (ex.: 123456 → "R$ 1.234,56"). */
export function formatBRL(cents: number): string {
  return brlFormatter.format(cents / 100)
}

/** Formata centavos como máscara monetária de input (ex.: 4000 → "R$ 40,00"). */
export function formatCurrencyMask(cents: number): string {
  return brlFormatter.format(cents / 100)
}

/**
 * Converte texto digitado em centavos de BRL (máscara monetária: consideram-
 * se apenas os dígitos; os dois últimos são os centavos). Vazio → null.
 *
 * Limita os dígitos antes da conversão para não perder precisão acima de
 * Number.MAX_SAFE_INTEGER (13 dígitos = até ~R$ 99,9 bilhões).
 */
export function currencyMaskToCents(raw: string): number | null {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  const cleaned = digits.replace(/^0+(?=\d)/, '').slice(0, 13)
  return cleaned ? Number(cleaned) : 0
}

/** Formata número em pt-BR. */
export function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

/** Formata número em notação compacta (ex.: 12500 → "12,5 mil"). */
export function formatCompact(value: number): string {
  return compactFormatter.format(value)
}

/** Formata fração como percentual (ex.: 0.0342 → "3,42%"). */
export function formatPercent(fraction: number): string {
  return percentFormatter.format(fraction)
}

/** Data curta dd/mm/aaaa. Aceita Date, timestamp ou string ISO. */
export function formatDate(value: Date | number | string): string {
  return dateFormatter.format(toDate(value))
}

/** Data curta sem ano (ex.: "6 de ago."). */
export function formatShortDate(value: Date | number | string): string {
  return shortDateFormatter.format(toDate(value))
}

/** Data e hora dd/mm/aaaa hh:mm. */
export function formatDateTime(value: Date | number | string): string {
  return dateTimeFormatter.format(toDate(value))
}

/**
 * Tempo relativo em pt-BR: "agora", "há 5 minutos", "há 2 horas", "há 3 dias".
 */
export function formatRelativeTime(value: Date | number | string): string {
  const target = toDate(value).getTime()
  const diffSeconds = Math.round((target - Date.now()) / 1000)
  const abs = Math.abs(diffSeconds)

  if (abs < 45) return relativeFormatter.format(0, 'second')
  if (abs < 60 * 60) return relativeFormatter.format(Math.round(diffSeconds / 60), 'minute')
  if (abs < 60 * 60 * 24) return relativeFormatter.format(Math.round(diffSeconds / 3600), 'hour')
  if (abs < 60 * 60 * 24 * 30) return relativeFormatter.format(Math.round(diffSeconds / 86400), 'day')
  if (abs < 60 * 60 * 24 * 365) return relativeFormatter.format(Math.round(diffSeconds / 2592000), 'month')
  return relativeFormatter.format(Math.round(diffSeconds / 31536000), 'year')
}

function toDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value)
}
