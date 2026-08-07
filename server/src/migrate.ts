import { config as loadDotenv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { loadConfig } from './config.js'
import { createPool, runMigrations } from './db.js'

loadDotenv({ path: '.env.local' })
loadDotenv({ path: '.env' })

async function run(): Promise<void> {
  const config = loadConfig()
  const pool = createPool(config)
  try {
    await runMigrations(pool)
    console.log('Migrations do FunilTrack aplicadas.')
  } finally {
    await pool.end()
  }
}

const currentFile = process.argv[1] ? resolve(process.argv[1]) : ''
if (currentFile === fileURLToPath(import.meta.url)) {
  void run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
