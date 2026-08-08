import { config as loadDotenv } from 'dotenv'
import { loadConfig } from './config.js'
import { createPool, runMigrations } from './db.js'
import { buildApp } from './app.js'
import { bootstrapLegacyIntegrations } from './integrations.js'
import { RedisCache } from './redis.js'
import { seedDemoData } from './seed.js'
import { startMetaSyncScheduler } from './metaScheduler.js'

loadDotenv({ path: '.env.local' })
loadDotenv({ path: '.env' })

async function start(): Promise<void> {
  const config = loadConfig()
  const pool = createPool(config)
  const cache = new RedisCache(config)

  await runMigrations(pool)
  await bootstrapLegacyIntegrations(pool, config)
  await cache.connect()

  // Nunca repopular um ambiente de produção com dados de demonstração,
  // mesmo que SEED_DEMO_DATA tenha sido configurado incorretamente.
  if (config.seedDemoData && config.nodeEnv !== 'production') {
    const summary = await seedDemoData(pool)
    if (!summary.skipped) {
      console.log(
        `Seed demo aplicado: ${summary.campaigns} campanhas, ${summary.leads} leads, ${summary.metrics} métricas.`,
      )
    }
  }

  const app = await buildApp({ pool, cache, config })
  let stopMetaSyncScheduler = (): void => undefined

  const close = async (signal: string) => {
    app.log.info({ signal }, 'Encerrando FunilTrack')
    stopMetaSyncScheduler()
    await app.close()
    await cache.close()
    await pool.end()
    process.exit(0)
  }

  process.once('SIGINT', () => void close('SIGINT'))
  process.once('SIGTERM', () => void close('SIGTERM'))

  await app.listen({ host: config.host, port: config.port })
  stopMetaSyncScheduler = startMetaSyncScheduler(pool, config, app.log).stop
  app.log.info({ port: config.port }, 'FunilTrack API disponível')
}

void start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
