import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Pool, type PoolClient } from 'pg'
import type { AppConfig } from './config.js'

export function createPool(config: AppConfig): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: config.pgPoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
    ...(config.databaseSsl
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
  })
}

export async function runMigrations(pool: Pool): Promise<void> {
  const migrationsDir = resolve(process.cwd(), 'server', 'migrations')
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort()
  await pool.query('begin')
  try {
    for (const migrationFile of migrationFiles) {
      await pool.query(await readFile(resolve(migrationsDir, migrationFile), 'utf8'))
    }
    await pool.query('commit')
  } catch (error) {
    await pool.query('rollback')
    throw error
  }
}

export async function withTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await callback(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function checkDatabase(pool: Pool): Promise<boolean> {
  try {
    await pool.query('select 1')
    return true
  } catch {
    return false
  }
}
