import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import type { AppConfig } from './config.js'

const scrypt = (password: string, salt: Buffer, keyLength: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      keyLength,
      {
        N: PASSWORD_COST,
        r: PASSWORD_BLOCK_SIZE,
        p: PASSWORD_PARALLELIZATION,
        maxmem: 128 * PASSWORD_COST * PASSWORD_BLOCK_SIZE + 1024 * 1024,
      },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey as Buffer)),
    )
  })
const SESSION_COOKIE = 'funiltrack_session'
const PASSWORD_VERSION = 'scrypt'
const PASSWORD_COST = 64 * 1024
const PASSWORD_BLOCK_SIZE = 8
const PASSWORD_PARALLELIZATION = 1
const PASSWORD_KEY_LENGTH = 64

export interface AuthUser {
  id: string
  name: string
  email: string
  role: 'owner' | 'admin' | 'member'
}

interface PasswordRecord {
  version: string
  salt: string
  hash: string
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function safeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, PASSWORD_KEY_LENGTH)
  const record: PasswordRecord = {
    version: PASSWORD_VERSION,
    salt: salt.toString('base64url'),
    hash: derived.toString('base64url'),
  }
  return `${record.version}$${record.salt}$${record.hash}`
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [version, saltText, hashText] = encoded.split('$')
  if (version !== PASSWORD_VERSION || !saltText || !hashText) return false
  try {
    const salt = Buffer.from(saltText, 'base64url')
    const expected = Buffer.from(hashText, 'base64url')
    const actual = await scrypt(password, salt, expected.length)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function mapAuthUser(row: Record<string, unknown>): AuthUser {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: (String(row.role) as AuthUser['role']) ?? 'member',
  }
}

export function setSessionCookie(reply: FastifyReply, token: string, config: AppConfig): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.authSecureCookie,
    sameSite: 'lax',
    path: '/',
    maxAge: config.authSessionTtlDays * 24 * 60 * 60,
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}

export async function createSession(
  pool: Pool,
  userId: string,
  config: AppConfig,
): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + config.authSessionTtlDays * 24 * 60 * 60 * 1000)
  await pool.query(
    `insert into sessions (id, user_id, token_hash, expires_at)
     values ($1, $2, $3, $4)`,
    [`session_${randomBytes(12).toString('hex')}`, userId, hashSessionToken(token), expiresAt],
  )
  return token
}

export async function getSessionUser(
  request: FastifyRequest,
  pool: Pool,
): Promise<AuthUser | null> {
  const token = request.cookies[SESSION_COOKIE]
  if (!token) return null
  const result = await pool.query<Record<string, unknown>>(
    `select u.id, u.name, u.email, u.role
       from sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1
        and s.expires_at > now()
        and u.active = true`,
    [hashSessionToken(token)],
  )
  const row = result.rows[0]
  if (!row) return null
  await pool.query('update sessions set last_seen_at = now() where token_hash = $1', [hashSessionToken(token)])
  return mapAuthUser(row)
}

export async function deleteSession(request: FastifyRequest, pool: Pool): Promise<void> {
  const token = request.cookies[SESSION_COOKIE]
  if (!token) return
  await pool.query('delete from sessions where token_hash = $1', [hashSessionToken(token)])
}

export async function deleteAllUserSessions(pool: Pool, userId: string): Promise<void> {
  await pool.query('delete from sessions where user_id = $1', [userId])
}

export async function hasUsers(pool: Pool): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>('select exists(select 1 from users) as exists')
  return Boolean(result.rows[0]?.exists)
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.'
  if (password.length > 128) return 'A senha não pode ter mais de 128 caracteres.'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'A senha precisa conter pelo menos uma letra e um número.'
  }
  return null
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function authUserFromRequest(request: FastifyRequest): AuthUser | undefined {
  return (request as FastifyRequest & { authUser?: AuthUser }).authUser
}

export function attachAuthUser(request: FastifyRequest, user: AuthUser): void {
  ;(request as FastifyRequest & { authUser?: AuthUser }).authUser = user
}

export function isApiTokenRequest(request: FastifyRequest, config: AppConfig): boolean {
  const authorization = request.headers.authorization
  return Boolean(config.apiToken && authorization === `Bearer ${config.apiToken}`)
}

export function sessionCookieName(): string {
  return SESSION_COOKIE
}

export { safeEqualHex }
