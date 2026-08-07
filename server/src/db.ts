import { readFile } from 'node:fs/promises'
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
  const migrationPath = resolve(
    process.cwd(),
    'server',
    'migrations',
    '001_initial.sql',
  )
  const sql = await readFile(migrationPath, 'utf8')
  await pool.query('begin')
  try {
    await pool.query(sql)
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
