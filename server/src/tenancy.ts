import { randomUUID } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import { authUserFromRequest, isApiTokenRequest } from './auth.js'
import type { AppConfig } from './config.js'

type Queryable = Pool | PoolClient

export type CompanyRole = 'owner' | 'admin' | 'member'

export interface CompanySummary {
  id: string
  name: string
  slug: string
  role: CompanyRole
  onboardingComplete: boolean
}

export interface CompanyContext extends CompanySummary {
  platformToken: boolean
}

export interface CompanyMember {
  id: string
  name: string
  email: string
  role: CompanyRole
  createdAt: string
}

export class CompanyAccessError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 403,
  ) {
    super(message)
  }
}

const COMPANY_HEADER = 'x-funiltrack-company-id'

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function companyRole(value: unknown): CompanyRole {
  return value === 'owner' || value === 'admin' || value === 'member' ? value : 'member'
}

function requestedCompanyId(request: FastifyRequest): string | null {
  const value = request.headers[COMPANY_HEADER]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function slugify(value: string): string {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return normalized || 'workspace'
}

function mapSummary(row: Record<string, unknown>): CompanySummary {
  return {
    id: text(row.id),
    name: text(row.name),
    slug: text(row.slug),
    role: companyRole(row.role),
    onboardingComplete: Boolean(row.onboarding_completed_at),
  }
}

export async function listCompaniesForUser(pool: Queryable, userId: string): Promise<CompanySummary[]> {
  const result = await pool.query<Record<string, unknown>>(
    `select c.id, c.name, c.slug, c.onboarding_completed_at, cm.role
       from company_members cm
       join companies c on c.id = cm.company_id
      where cm.user_id = $1
      order by c.created_at asc, c.id asc`,
    [userId],
  )
  return result.rows.map(mapSummary)
}

export async function resolveCompanyContext(
  request: FastifyRequest,
  pool: Queryable,
  config: AppConfig,
): Promise<CompanyContext> {
  const companyId = requestedCompanyId(request)
  const platformToken = isApiTokenRequest(request, config)

  if (platformToken) {
    if (!companyId) {
      throw new CompanyAccessError(`Informe o header ${COMPANY_HEADER} para a credencial de automação.`, 400)
    }
    const result = await pool.query<Record<string, unknown>>(
      `select id, name, slug, onboarding_completed_at
         from companies where id = $1`,
      [companyId],
    )
    const row = result.rows[0]
    if (!row) throw new CompanyAccessError('Empresa não encontrada.', 404)
    return { ...mapSummary({ ...row, role: 'owner' }), platformToken: true }
  }

  const user = authUserFromRequest(request)
  if (!user) throw new CompanyAccessError('Sessão ausente ou expirada.', 401)

  const values: unknown[] = [user.id]
  const where = ['cm.user_id = $1']
  if (companyId) {
    values.push(companyId)
    where.push(`c.id = $${values.length}`)
  }
  const result = await pool.query<Record<string, unknown>>(
    `select c.id, c.name, c.slug, c.onboarding_completed_at, cm.role
       from company_members cm
       join companies c on c.id = cm.company_id
      where ${where.join(' and ')}
      order by c.created_at asc, c.id asc
      limit 1`,
    values,
  )
  const row = result.rows[0]
  if (!row) {
    throw new CompanyAccessError(
      companyId ? 'Você não possui acesso a esta empresa.' : 'Seu usuário ainda não possui uma empresa.',
      403,
    )
  }
  return { ...mapSummary(row), platformToken: false }
}

export function requireCompanyRole(context: CompanyContext, roles: CompanyRole[]): void {
  if (context.platformToken || roles.includes(context.role)) return
  throw new CompanyAccessError('Seu papel nesta empresa não permite esta ação.', 403)
}

export async function createCompany(
  pool: Queryable,
  userId: string,
  name: string,
): Promise<CompanySummary> {
  const id = `company_${randomUUID()}`
  const slug = `${slugify(name)}-${randomUUID().slice(0, 8)}`
  const result = await pool.query<Record<string, unknown>>(
    `insert into companies (id, name, slug)
     values ($1, $2, $3)
     returning id, name, slug, onboarding_completed_at`,
    [id, name.trim(), slug],
  )
  await pool.query(
    `insert into company_members (company_id, user_id, role)
     values ($1, $2, 'owner')`,
    [id, userId],
  )
  return mapSummary({ ...result.rows[0], role: 'owner' })
}

export async function updateCompanyName(
  pool: Queryable,
  companyId: string,
  name: string,
): Promise<CompanySummary> {
  const result = await pool.query<Record<string, unknown>>(
    `update companies
        set name = $2, updated_at = now()
      where id = $1
      returning id, name, slug, onboarding_completed_at`,
    [companyId, name.trim()],
  )
  const row = result.rows[0]
  if (!row) throw new CompanyAccessError('Empresa não encontrada.', 404)
  return mapSummary({ ...row, role: 'owner' })
}

export async function completeCompanyOnboarding(pool: Queryable, companyId: string): Promise<void> {
  await pool.query(
    `update companies
        set onboarding_completed_at = coalesce(onboarding_completed_at, now()), updated_at = now()
      where id = $1`,
    [companyId],
  )
}

export async function listCompanyMembers(pool: Queryable, companyId: string): Promise<CompanyMember[]> {
  const result = await pool.query<Record<string, unknown>>(
    `select u.id, u.name, u.email, cm.role, cm.created_at
       from company_members cm
       join users u on u.id = cm.user_id
      where cm.company_id = $1
      order by case cm.role when 'owner' then 0 when 'admin' then 1 else 2 end, lower(u.name), u.id`,
    [companyId],
  )
  return result.rows.map((row) => ({
    id: text(row.id),
    name: text(row.name),
    email: text(row.email),
    role: companyRole(row.role),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }))
}

export async function addCompanyMember(
  pool: Queryable,
  companyId: string,
  email: string,
  role: CompanyRole,
): Promise<CompanyMember> {
  const user = await pool.query<Record<string, unknown>>(
    `select id, name, email from users where lower(email) = lower($1) and active = true`,
    [email.trim()],
  )
  const row = user.rows[0]
  if (!row) throw new CompanyAccessError('A pessoa precisa criar a conta FunilTrack antes de ser adicionada.', 404)
  const membership = await pool.query<Record<string, unknown>>(
    `insert into company_members (company_id, user_id, role)
     values ($1, $2, $3)
     on conflict (company_id, user_id) do update set role = excluded.role, updated_at = now()
     returning role, created_at`,
    [companyId, row.id, role],
  )
  return {
    id: text(row.id),
    name: text(row.name),
    email: text(row.email),
    role: companyRole(membership.rows[0]?.role),
    createdAt: new Date(String(membership.rows[0]?.created_at)).toISOString(),
  }
}

export async function removeCompanyMember(
  pool: Queryable,
  companyId: string,
  userId: string,
): Promise<void> {
  const owners = await pool.query<{ count: string }>(
    `select count(*)::text as count from company_members
      where company_id = $1 and role = 'owner'`,
    [companyId],
  )
  const target = await pool.query<{ role: CompanyRole }>(
    `select role from company_members where company_id = $1 and user_id = $2`,
    [companyId, userId],
  )
  if (!target.rows[0]) throw new CompanyAccessError('Membro não encontrado.', 404)
  if (target.rows[0].role === 'owner' && Number(owners.rows[0]?.count ?? 0) <= 1) {
    throw new CompanyAccessError('A empresa precisa manter pelo menos um owner.', 400)
  }
  await pool.query(
    `delete from company_members where company_id = $1 and user_id = $2`,
    [companyId, userId],
  )
}
