/**
 * Testes do mockClient (src/lib/api/mockClient.ts):
 * paginação, filtros e persistência de overrides em localStorage
 * (mockado explicitamente em src/test/setup.ts — sem dependência de browser).
 *
 * As asserções de totais/ids/nº de páginas são DERIVADAS do dataset importado
 * (não hardcoded) para o seed poder crescer (ex.: 180 dias de métricas) sem
 * quebrar os testes.
 */
import { describe, expect, it } from 'vitest'
import { mockClient } from './mockClient'
import { LeadStage } from './types'
import leadsJson from '../../mocks/data/leads.json'

const STAGE_OVERRIDES_KEY = 'funiltrack:lead-stage-overrides'

/** Dataset real de leads (fonte das asserções derivadas). */
const dataset = leadsJson as unknown as Array<{
  id: string
  name: string
  phone: string
  stage: LeadStage
  utmSource: string
}>
const TOTAL = dataset.length
const PAGE_SIZE = 20

describe('getLeads — paginação (items/total/nextCursor)', () => {
  it('retorna a primeira página com total do dataset e cursor para a próxima', async () => {
    const page1 = await mockClient.getLeads({ page: 1, pageSize: PAGE_SIZE })
    expect(page1.items).toHaveLength(Math.min(PAGE_SIZE, TOTAL))
    expect(page1.total).toBe(TOTAL)
    expect(page1.nextCursor).toBe(TOTAL > PAGE_SIZE ? '2' : null)
  })

  it('avança páginas (via cursor) sem repetir itens', async () => {
    const page1 = await mockClient.getLeads({ page: 1, pageSize: PAGE_SIZE })
    expect(page1.nextCursor).not.toBeNull()
    // Segue o cursor retornado pela fachada, sem contar páginas manualmente.
    const page2 = await mockClient.getLeads({
      page: Number(page1.nextCursor),
      pageSize: PAGE_SIZE,
    })
    expect(page2.items).toHaveLength(Math.min(PAGE_SIZE, TOTAL - PAGE_SIZE))
    const ids1 = new Set(page1.items.map((l) => l.id))
    for (const lead of page2.items) {
      expect(ids1.has(lead.id)).toBe(false)
    }
  })

  it('a última página retorna nextCursor nulo', async () => {
    const lastPageNumber = Math.ceil(TOTAL / PAGE_SIZE)
    const last = await mockClient.getLeads({
      page: lastPageNumber,
      pageSize: PAGE_SIZE,
    })
    const expectedItems = TOTAL - (lastPageNumber - 1) * PAGE_SIZE
    expect(last.items).toHaveLength(expectedItems)
    expect(last.total).toBe(TOTAL)
    expect(last.nextCursor).toBeNull()
  })

  it('ordena por data de criação decrescente', async () => {
    const { items } = await mockClient.getLeads({ page: 1, pageSize: 50 })
    for (let i = 1; i < items.length; i += 1) {
      expect(items[i - 1].createdAt >= items[i].createdAt).toBe(true)
    }
  })
})

describe('getLeads — filtros', () => {
  it('busca por nome (case-insensitive)', async () => {
    const { items } = await mockClient.getLeads({ search: 'EDUARDO', pageSize: 100 })
    expect(items.length).toBeGreaterThan(0)
    for (const lead of items) {
      expect(lead.name.toLowerCase()).toContain('eduardo')
    }
  })

  it('busca por telefone ignora formatação', async () => {
    // Derivado do próprio dataset para não depender do sorteio do seed.
    const lead = await mockClient.getLead('lead_0001')
    const digits = lead.phone.replace(/\D/g, '')
    const partial = digits.slice(-9)
    const byDigits = await mockClient.getLeads({ search: partial })
    expect(byDigits.items.some((l) => l.id === 'lead_0001')).toBe(true)
  })

  it('busca mista (nome + dígitos) casa nome E telefone', async () => {
    const target = dataset[0]
    const firstName = target.name.split(' ')[0].toLowerCase()
    const phoneDigits = target.phone.replace(/\D/g, '')
    const term = `${firstName} ${phoneDigits.slice(-4)}`
    const { items } = await mockClient.getLeads({ search: term, pageSize: 100 })
    expect(items.some((l) => l.id === target.id)).toBe(true)
    // Todo resultado satisfaz as duas condições (parte textual no nome E
    // dígitos no telefone) — o comportamento antigo ignorava o nome.
    for (const lead of items) {
      expect(lead.name.toLowerCase()).toContain(firstName)
      expect(lead.phone.replace(/\D/g, '')).toContain(phoneDigits.slice(-4))
    }
  })

  it('filtra por campanha', async () => {
    const { items, total } = await mockClient.getLeads({
      campaignId: 'cmp_03',
      pageSize: 500,
    })
    expect(total).toBeGreaterThan(0)
    expect(items).toHaveLength(Math.min(500, total))
    for (const lead of items) {
      expect(lead.campaignId).toBe('cmp_03')
    }
  })

  it('filtra por origem (utmSource)', async () => {
    const { items, total } = await mockClient.getLeads({
      utmSource: 'facebook',
      pageSize: 500,
    })
    expect(total).toBeGreaterThan(0)
    for (const lead of items) {
      expect(lead.utmSource).toBe('facebook')
    }
  })

  it('filtra por estágio', async () => {
    const { items, total } = await mockClient.getLeads({
      stage: LeadStage.NOVO,
      pageSize: 500,
    })
    expect(total).toBeGreaterThan(0)
    for (const lead of items) {
      expect(lead.stage).toBe(LeadStage.NOVO)
    }
  })

  it('combina busca + filtro de campanha', async () => {
    const { items } = await mockClient.getLeads({
      search: 'eduardo',
      campaignId: 'cmp_03',
    })
    for (const lead of items) {
      expect(lead.name.toLowerCase()).toContain('eduardo')
      expect(lead.campaignId).toBe('cmp_03')
    }
  })

  it('getLeadSources retorna as origens distintas do dataset completo', async () => {
    const sources = await mockClient.getLeadSources()
    const expected = [...new Set(dataset.map((l) => l.utmSource))].sort()
    expect(sources).toEqual(expected)
    expect(sources.length).toBeGreaterThan(0)
  })
})

describe('updateLeadStage — override persistido', () => {
  it('atualiza o estágio e reflete em getLead/getLeads', async () => {
    const original = await mockClient.getLead('lead_0001')
    // Escolhe um estágio diferente do atual para a asserção valer sempre.
    const target =
      original.stage === LeadStage.QUALIFICADO
        ? LeadStage.CONTATO
        : LeadStage.QUALIFICADO

    const updated = await mockClient.updateLeadStage('lead_0001', target)
    expect(updated.id).toBe('lead_0001')
    expect(updated.stage).toBe(target)
    expect(updated.stage).not.toBe(original.stage)

    const reread = await mockClient.getLead('lead_0001')
    expect(reread.stage).toBe(target)

    const listed = await mockClient.getLeads({
      search: original.name,
      campaignId: original.campaignId,
      pageSize: 500,
    })
    const found = listed.items.find((l) => l.id === 'lead_0001')
    expect(found?.stage).toBe(target)
  })

  it('persiste o override em localStorage', async () => {
    await mockClient.updateLeadStage('lead_0001', LeadStage.CONTATO)

    const raw = localStorage.getItem(STAGE_OVERRIDES_KEY)
    expect(raw).not.toBeNull()
    const overrides = JSON.parse(raw as string) as Record<string, LeadStage>
    expect(overrides['lead_0001']).toBe(LeadStage.CONTATO)
  })

  it('ignora override corrompido (fora do enum) sem perder o lead', async () => {
    localStorage.setItem(
      STAGE_OVERRIDES_KEY,
      JSON.stringify({ lead_0002: 'estagio_inexistente' }),
    )
    const lead = await mockClient.getLead('lead_0002')
    const baseStage = dataset.find((l) => l.id === 'lead_0002')
    expect(lead.stage).toBe(baseStage?.stage)

    // E o lead segue aparecendo no funil (nenhum estágio inválido vaza).
    const stages = Object.values(LeadStage)
    const { items } = await mockClient.getLeads({ pageSize: 500 })
    for (const item of items) {
      expect(stages).toContain(item.stage)
    }
  })

  it('lança erro para lead inexistente', async () => {
    await expect(
      mockClient.updateLeadStage('lead_inexistente', LeadStage.CONTATO),
    ).rejects.toThrow('Lead não encontrado')
  })
})
