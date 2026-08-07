/**
 * Setup do ambiente de testes (Vitest, environment: node).
 *
 * O environment node não expõe a Web Storage API, então instalamos um mock
 * EXPLÍCITO de localStorage (em memória) — os testes nunca dependem de
 * storage real do navegador. Limpo automaticamente antes de cada teste.
 */
import { beforeEach } from 'vitest'

class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value))
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
})

beforeEach(() => {
  globalThis.localStorage.clear()
})
