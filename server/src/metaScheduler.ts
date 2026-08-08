import type { Pool } from 'pg'
import type { AppConfig } from './config.js'
import {
  processAllPendingMetaConversions,
  syncAllMetaAds,
  type MetaSyncRange,
} from './meta.js'

export interface MetaSyncSchedulerLogger {
  info(data: Record<string, unknown>, message: string): void
  warn(data: Record<string, unknown>, message: string): void
  error(data: Record<string, unknown>, message: string): void
}

export interface MetaSyncScheduler {
  stop(): void
}

type SchedulerTimer = ReturnType<typeof setTimeout>

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function buildMetaSyncRange(now = new Date(), lookbackDays = 3): MetaSyncRange {
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1) {
    throw new Error('META_SYNC_LOOKBACK_DAYS deve ser um inteiro positivo.')
  }

  const toDate = new Date(now)
  toDate.setUTCHours(0, 0, 0, 0)
  const fromDate = new Date(toDate)
  fromDate.setUTCDate(fromDate.getUTCDate() - lookbackDays + 1)

  return { from: formatUtcDate(fromDate), to: formatUtcDate(toDate) }
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/([?&]access_token=)[^&\s]+/gi, '$1[redacted]').slice(0, 500)
}

export function startMetaSyncScheduler(
  pool: Pool,
  config: AppConfig,
  logger: MetaSyncSchedulerLogger,
): MetaSyncScheduler {
  if (!config.metaSyncEnabled) {
    logger.info({ enabled: false }, 'Sincronização automática da Meta desabilitada')
    return { stop: () => undefined }
  }

  let stopped = false
  let running = false

  const run = async (trigger: 'startup' | 'interval'): Promise<void> => {
    if (stopped || running) return

    running = true
    const range = buildMetaSyncRange(new Date(), config.metaSyncLookbackDays)
    try {
      const [result, conversions] = await Promise.all([
        syncAllMetaAds(pool, config, range),
        processAllPendingMetaConversions(pool, config, 100),
      ])
      const summary = {
        trigger,
        from: range.from,
        to: range.to,
        companies: result.companies,
        succeeded: result.succeeded,
        failed: result.failed,
        metrics: result.results.reduce((total, item) => total + (item.summary?.metrics ?? 0), 0),
        conversionsSent: conversions.sent,
        conversionsFailed: conversions.failed,
      }
      if (result.failed > 0 || conversions.failed > 0) {
        logger.warn(summary, 'Sincronização automática da Meta concluída com falhas')
      } else {
        logger.info(summary, 'Sincronização automática da Meta concluída')
      }
    } catch (error) {
      logger.error(
        { trigger, from: range.from, to: range.to, error: safeErrorMessage(error) },
        'Sincronização automática da Meta falhou',
      )
    } finally {
      running = false
    }
  }

  const intervalMs = config.metaSyncIntervalMinutes * 60_000
  const startupTimer: SchedulerTimer = setTimeout(() => void run('startup'), 10_000)
  const intervalTimer: SchedulerTimer = setInterval(() => void run('interval'), intervalMs)
  startupTimer.unref?.()
  intervalTimer.unref?.()

  logger.info(
    {
      enabled: true,
      intervalMinutes: config.metaSyncIntervalMinutes,
      lookbackDays: config.metaSyncLookbackDays,
    },
    'Sincronização automática da Meta habilitada',
  )

  return {
    stop: () => {
      if (stopped) return
      stopped = true
      if (startupTimer) clearTimeout(startupTimer)
      if (intervalTimer) clearInterval(intervalTimer)
    },
  }
}
