import { Redis as RedisClient } from 'ioredis'
import type { AppConfig } from './config.js'

const CACHE_PREFIX = 'funiltrack:api'
const CACHE_VERSION_KEY = `${CACHE_PREFIX}:version`

export class RedisCache {
  private readonly client: RedisClient | null

  private connected = false

  constructor(private readonly config: AppConfig) {
    this.client = config.redisUrl
      ? new RedisClient(config.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 5_000,
        })
      : null

    this.client?.on('error', () => {
      this.connected = false
    })
  }

  get enabled(): boolean {
    return this.client !== null
  }

  async connect(): Promise<void> {
    if (!this.client || this.connected) return
    try {
      await this.client.connect()
      await this.client.ping()
      this.connected = true
    } catch (error) {
      this.connected = false
      this.client.disconnect()
      if (this.config.redisRequired) {
        throw new Error('Redis configurado, mas indisponível.')
      }
      // O cache é opcional no desenvolvimento; o banco continua sendo a fonte
      // de verdade mesmo quando o Redis não estiver rodando localmente.
      void error
    }
  }

  async ping(): Promise<boolean> {
    if (!this.client || !this.connected) return false
    try {
      await this.client.ping()
      return true
    } catch {
      this.connected = false
      return false
    }
  }

  private async versionedKey(namespace: string): Promise<string | null> {
    if (!this.client || !this.connected) return null
    const version = (await this.client.get(CACHE_VERSION_KEY)) ?? '1'
    return `${CACHE_PREFIX}:${version}:${namespace}`
  }

  async getJson<T>(namespace: string): Promise<T | null> {
    const key = await this.versionedKey(namespace)
    if (!key || !this.client) return null
    try {
      const value = await this.client.get(key)
      return value ? (JSON.parse(value) as T) : null
    } catch {
      return null
    }
  }

  async setJson(namespace: string, value: unknown, ttlSeconds: number): Promise<void> {
    const key = await this.versionedKey(namespace)
    if (!key || !this.client) return
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds)
    } catch {
      // Uma falha de cache não pode derrubar uma resposta que veio do banco.
    }
  }

  async invalidate(): Promise<void> {
    if (!this.client || !this.connected) return
    try {
      await this.client.incr(CACHE_VERSION_KEY)
    } catch {
      // As chaves antigas expiram sozinhas; a próxima leitura consulta o DB.
    }
  }

  async close(): Promise<void> {
    if (!this.client) return
    try {
      await this.client.quit()
    } catch {
      this.client.disconnect()
    }
    this.connected = false
  }
}
