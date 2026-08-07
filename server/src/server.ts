import { config as loadDotenv } from 'dotenv'
import { loadConfig } from './config.js'
import { createPool, runMigrations } from './db.js'
import { buildApp } from './app.js'
import { RedisCache } from './redis.js'
import { seedDemoData } from './seed.js'

loadDotenv({ path: '.env.local' })
loadDotenv({ path: '.env' })

async function start(): Promise<void> {
  const config = loadConfig()
  const pool = createPool(config)
  const cache = new RedisCache(config)

  await runMigrations(pool)
  await cache.connect()

  if (config.seedDemoData) {
    const summary = await seedDemoData(pool)
    if (!summary.skipped) {
      console.log(
        `Seed demo aplicado: ${summary.campaigns} campanhas, ${summary.leads} leads, ${summary.metrics} métricas.`,
      )
    }
  }

  const app = await buildApp({ pool, cache, config })

  const close = async (signal: string) => {
    app.log.info({ signal }, 'Encerrando FunilTrack')
    await app.close()
    await cache.close()
    await pool.end()
    process.exit(0)
  }

  process.once('SIGINT', () => void close('SIGINT'))
  process.once('SIGTERM', () => void close('SIGTERM'))

  await app.listen({ host: config.host, port: config.port })
  app.log.info({ port: config.port }, 'FunilTrack API disponível')
}

void start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
