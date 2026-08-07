#!/usr/bin/env node
/**
 * FunilTrack — Gerador de dados mock DETERMINÍSTICOS.
 *
 * Uso: pnpm seed
 * Saída: src/mocks/data/*.json (versionados).
 *
 * Características:
 * - PRNG mulberry32 com seed fixa (reproduz exatamente o mesmo dataset).
 * - Datas RELATIVAS a Date.now() (hoje - N dias) para o demo nunca envelhecer,
 *   geradas no fuso LOCAL (YYYY-MM-DD via getters locais — o app usa data
 *   local em rules.ts/period.ts) e com timestamps sempre ≤ agora.
 * - 180 dias de métricas diárias (a janela anterior do período de 90 dias
 *   precisa de dados para a comparação "% vs período anterior").
 * - Curvas realistas: queda aos finais de semana; 2 campanhas estouram o
 *   orçamento diário nos últimos dias.
 * - ~400 leads com UTM completa, estágios distribuídos e timelines de
 *   conversa. Apenas um lote pequeno e intencional (~7 leads) fica na
 *   janela de "sem resposta" do motor de alertas (entre leadResponseHours
 *   e leadResponseHours + horizonte); os demais ou já foram respondidos,
 *   ou aguardam há pouco tempo, ou são histórico antigo.
 * - Todo evento de timeline tem timestamp coerente com `lastMessageAt`
 *   (sempre existe evento correspondente) e nenhum evento fica no futuro.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SEED = 20260806
const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'mocks',
  'data',
)

/* ----------------------------- PRNG (mulberry32) ---------------------------- */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(SEED)

const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const chance = (p) => rand() < p

/* --------------------------------- Datas ------------------------------------ */
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const NOW = Date.now()
const DAYS = 180

// ISO-8601 somente data no fuso LOCAL (mesma convenção de rules.ts/period.ts).
// Usar toISOString() (UTC) criaria datas de "amanhã" ao rodar o seed à noite
// em fusos negativos (ex.: 21h–23h59 em UTC-3), que o app descartaria.
const dayIso = (daysAgo) => {
  const d = new Date(NOW - daysAgo * DAY_MS)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
// Nenhum timestamp pode ficar no futuro (ex.: lead criado hoje com hora
// sorteada além da hora atual).
const clampPast = (ts) => Math.min(ts, NOW)
const isoAt = (daysAgo, hour, minute = 0) => {
  const d = new Date(NOW - daysAgo * DAY_MS)
  d.setHours(hour, minute, randInt(0, 59), 0)
  return new Date(clampPast(d.getTime())).toISOString()
}
const isWeekend = (daysAgo) => {
  const dow = new Date(NOW - daysAgo * DAY_MS).getDay()
  return dow === 0 || dow === 6
}

/* -------------------------------- Campanhas --------------------------------- */
const CAMPAIGN_DEFS = [
  {
    name: 'Promoção Inverno 2026',
    objective: 'CONVERSIONS',
    dailyBudget: 15000, // R$ 150,00
    status: 'ACTIVE',
    source: 'facebook',
    medium: 'cpc',
    slug: 'promo-inverno-2026',
    overspend: false,
    leadShare: 0.2,
  },
  {
    name: 'Leads WhatsApp B2C',
    objective: 'LEADS',
    dailyBudget: 8000, // R$ 80,00
    status: 'ACTIVE',
    source: 'instagram',
    medium: 'whatsapp',
    slug: 'leads-whatsapp-b2c',
    overspend: true,
    leadShare: 0.26,
  },
  {
    name: 'Remarketing Carrinho Abandonado',
    objective: 'CONVERSIONS',
    dailyBudget: 6000,
    status: 'ACTIVE',
    source: 'facebook',
    medium: 'cpc',
    slug: 'remarketing-carrinho',
    overspend: false,
    leadShare: 0.12,
  },
  {
    name: 'Lançamento Ebook Gratuito',
    objective: 'LEADS',
    dailyBudget: 4000,
    status: 'PAUSED',
    source: 'facebook',
    medium: 'cpc',
    slug: 'ebook-gratuito',
    overspend: false,
    leadShare: 0.1,
  },
  {
    name: 'Mensagens WhatsApp Premium',
    objective: 'MESSAGES',
    dailyBudget: 12000,
    status: 'ACTIVE',
    source: 'instagram',
    medium: 'whatsapp',
    slug: 'whatsapp-premium',
    overspend: true,
    leadShare: 0.22,
  },
  {
    name: 'Alcance Marca — Verão',
    objective: 'ENGAGEMENT',
    dailyBudget: 3000,
    status: 'ACTIVE',
    source: 'facebook',
    medium: 'cpc',
    slug: 'alcance-marca-verao',
    overspend: false,
    leadShare: 0.1,
  },
]

const ADSET_AUDIENCES = [
  'Interesse — Moda 25-44',
  'Lookalike 1% — Compradores',
  'Retargeting 30 dias',
  'Público Amplo — SP/RJ/MG',
]
const AD_CREATIVES = [
  'Vídeo 15s — Depoimento',
  'Carrossel — Vitrine',
  'Imagem Única — Oferta',
  'Stories — Bastidores',
]

const campaigns = []
const adSets = []
const ads = []

CAMPAIGN_DEFS.forEach((def, ci) => {
  const campaignId = `cmp_${String(ci + 1).padStart(2, '0')}`
  const startDate = dayIso(DAYS + randInt(5, 30))

  // 2 ad sets por campanha (~12 no total)
  for (let s = 0; s < 2; s++) {
    const adSetId = `${campaignId}_as${s + 1}`
    adSets.push({
      id: adSetId,
      campaignId,
      name: `${pick(ADSET_AUDIENCES)} ${s + 1}`,
      status: def.status,
      dailyBudget: Math.round(def.dailyBudget / 2),
      spend: 0, // calculado depois a partir das métricas
      startDate,
    })

    // 2 anúncios por ad set (~24 no total)
    for (let a = 0; a < 2; a++) {
      ads.push({
        id: `${adSetId}_ad${a + 1}`,
        adSetId,
        campaignId,
        name: `${pick(AD_CREATIVES)} v${randInt(1, 4)}`,
        status: chance(0.9) ? def.status : 'PAUSED',
        spend: 0,
        impressions: 0,
        clicks: 0,
      })
    }
  }

  campaigns.push({
    id: campaignId,
    name: def.name,
    status: def.status,
    objective: def.objective,
    dailyBudget: def.dailyBudget,
    spend: 0, // soma das métricas diárias
    startDate,
    _def: def, // interno: removido antes de escrever o JSON
  })
})

/* -------------------------- Métricas diárias (180d) ------------------------- */
const dailyMetrics = []

for (const campaign of campaigns) {
  const def = campaign._def
  const baseCpc = randInt(140, 420) // centavos
  const baseCvr = 0.05 + rand() * 0.09 // 5–14% de conversão clique→lead

  for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo--) {
    // O gasto diário é ancorado no orçamento da campanha (mesma unidade:
    // centavos). Campanhas normais consomem 60–95% do orçamento diário
    // (menos aos finais de semana); as marcadas como "estouradas" consomem
    // 100–130% nos últimos 14 dias.
    const overspending = def.overspend && daysAgo < 14
    const utilization = overspending
      ? 1 + rand() * 0.3
      : (0.6 + rand() * 0.35) * (isWeekend(daysAgo) ? 0.6 : 1)
    const spend = Math.max(1, Math.round(def.dailyBudget * utilization))

    const cpc = Math.round(baseCpc * (0.85 + rand() * 0.35))
    const clicks = Math.max(1, Math.round(spend / cpc))
    const ctr = 0.018 + rand() * 0.035 // 1,8%–5,3%
    const impressions = Math.ceil(clicks / ctr)

    const leads = Math.max(0, Math.round(clicks * baseCvr * (0.7 + rand() * 0.6)))
    const cpl = leads > 0 ? Math.round(spend / leads) : 0
    const ticketMedio = 18000 + rand() * 60000 // centavos
    const roas = spend > 0 ? Number(((leads * ticketMedio * 0.45) / spend).toFixed(2)) : 0

    dailyMetrics.push({
      campaignId: campaign.id,
      date: dayIso(daysAgo),
      impressions,
      clicks,
      spend,
      leads,
      ctr: Number((clicks / impressions).toFixed(4)),
      cpc,
      cpl,
      roas,
    })
  }
}

// Agrega totais nas entidades.
for (const campaign of campaigns) {
  campaign.spend = dailyMetrics
    .filter((m) => m.campaignId === campaign.id)
    .reduce((acc, m) => acc + m.spend, 0)
  delete campaign._def
}
for (const adSet of adSets) {
  const share = 0.35 + rand() * 0.3
  adSet.spend = Math.round(
    campaigns.find((c) => c.id === adSet.campaignId).spend * share * 0.5,
  )
}
for (const ad of ads) {
  const adSet = adSets.find((s) => s.id === ad.adSetId)
  const campaign = campaigns.find((c) => c.id === ad.campaignId)
  const campaignImpressions = dailyMetrics
    .filter((m) => m.campaignId === campaign.id)
    .reduce((acc, m) => acc + m.impressions, 0)
  const campaignClicks = dailyMetrics
    .filter((m) => m.campaignId === campaign.id)
    .reduce((acc, m) => acc + m.clicks, 0)
  const share = 0.3 + rand() * 0.4
  ad.spend = Math.round(adSet.spend * share)
  ad.impressions = Math.round(campaignImpressions * 0.5 * share)
  ad.clicks = Math.round(campaignClicks * 0.5 * share)
}

/* ---------------------------------- Leads ----------------------------------- */
const FIRST_NAMES = [
  'Ana', 'Bruno', 'Carla', 'Diego', 'Elaine', 'Felipe', 'Gabriela', 'Henrique',
  'Isabela', 'João', 'Karen', 'Lucas', 'Mariana', 'Nicolas', 'Olívia', 'Paulo',
  'Quésia', 'Rafael', 'Sabrina', 'Thiago', 'Úrsula', 'Vinícius', 'Wanessa',
  'Yasmin', 'Eduardo', 'Fernanda', 'Gustavo', 'Larissa', 'Marcos', 'Patrícia',
]
const LAST_NAMES = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Pereira', 'Costa', 'Rodrigues',
  'Almeida', 'Nascimento', 'Lima', 'Araújo', 'Fernandes', 'Carvalho', 'Gomes',
  'Martins', 'Rocha', 'Ribeiro', 'Alves', 'Monteiro', 'Barbosa',
]
const INCOMING_MESSAGES = [
  'Oi, vi o anúncio e quero saber mais!',
  'Olá! Esse produto ainda está disponível?',
  'Boa tarde, qual o valor à vista?',
  'Oi! Vocês entregam na minha região?',
  'Quero aproveitar a promoção, como faço?',
  'Olá, podem me passar mais detalhes?',
]
const OUTGOING_MESSAGES = [
  'Olá! Obrigado pelo contato. Já vou te atender. 😊',
  'Oi! Claro, posso te ajudar com isso.',
  'Olá! Segue a tabela de valores atualizada.',
  'Oi! Temos condições especiais esta semana.',
]

/**
 * Distribuição do funil: maioria "novo"/"contato".
 * novo 45% · contato 28% · qualificado 14% · vendido 8% · perdido 5%
 */
function pickStage() {
  const r = rand()
  if (r < 0.45) return 'novo'
  if (r < 0.73) return 'contato'
  if (r < 0.87) return 'qualificado'
  if (r < 0.95) return 'vendido'
  return 'perdido'
}

/** Escolhe campanha ponderada pela participação de leads. */
function pickCampaignByShare() {
  let r = rand()
  for (let i = 0; i < CAMPAIGN_DEFS.length; i++) {
    r -= CAMPAIGN_DEFS[i].leadShare
    if (r <= 0) return { campaign: campaigns[i], def: CAMPAIGN_DEFS[i] }
  }
  return { campaign: campaigns[0], def: CAMPAIGN_DEFS[0] }
}

const LEAD_COUNT = 400
const leads = []

// Lote intencional de leads "sem resposta" dentro da janela operacional do
// motor de alertas (espera entre o limite de 2h e o horizonte de ~50h).
// Mantém a regra demonstrável sem soterrar a central com o backlog inteiro.
let windowBatchRemaining = 7

for (let i = 0; i < LEAD_COUNT; i++) {
  const { campaign, def } = pickCampaignByShare()
  const campaignAdSets = adSets.filter((s) => s.campaignId === campaign.id)
  const adSet = pick(campaignAdSets)
  const ad = pick(ads.filter((a) => a.adSetId === adSet.id))

  // Leads mais recentes são mais comuns (funil ativo).
  const daysAgo = Math.floor(Math.pow(rand(), 1.6) * DAYS)
  const createdAt = isoAt(daysAgo, randInt(8, 21), randInt(0, 59))
  const stage = pickStage()

  const timeline = []
  let eventSeq = 0
  const pushEvent = (type, text, at) => {
    eventSeq += 1
    timeline.push({ id: `lead_${String(i + 1).padStart(4, '0')}_ev${eventSeq}`, type, text, at })
  }

  pushEvent('lead_criado', `Lead criado via ${def.medium === 'whatsapp' ? 'clique para WhatsApp' : 'formulário instantâneo'}`, createdAt)

  // Início de conversa (minutos depois do clique) — nunca no futuro.
  const minutesToFirstMessage = randInt(1, 25)
  const firstMessageAt = new Date(
    clampPast(new Date(createdAt).getTime() + minutesToFirstMessage * 60000),
  )
  pushEvent('mensagem_recebida', pick(INCOMING_MESSAGES), firstMessageAt.toISOString())

  // Resposta do atendente: depende do estágio.
  let replied = stage !== 'novo' || chance(0.3)
  let lastMessageAt = firstMessageAt.toISOString()
  const ageMs = NOW - new Date(createdAt).getTime()

  if (!replied) {
    // Decide em qual regime o lead sem resposta cai — sempre FORA da janela
    // operacional do motor, exceto o lote intencional acima.
    let eventAt = null
    const eligibleForWindow =
      windowBatchRemaining > 0 &&
      ageMs > 4 * HOUR_MS &&
      (stage === 'novo' || stage === 'contato')

    if (eligibleForWindow) {
      windowBatchRemaining -= 1
      // Espera entre 3h e 29h — dentro da janela (2h, 50h] do motor.
      eventAt = new Date(NOW - (3 + rand() * 26) * HOUR_MS)
      if (eventAt < firstMessageAt) eventAt = firstMessageAt
    } else if (ageMs <= 52 * HOUR_MS) {
      if (firstMessageAt.getTime() >= NOW - 2 * HOUR_MS) {
        // Espera curta: ainda dentro do SLA, não gera alerta.
        eventAt = firstMessageAt
      } else {
        // Lead recente fora do lote: vira conversa respondida.
        replied = true
      }
    } else {
      // Histórico antigo: espera além do horizonte — sai do escopo da regra.
      eventAt = firstMessageAt
    }

    if (!replied && eventAt && eventAt.getTime() !== firstMessageAt.getTime()) {
      // Coerência: `lastMessageAt` SEMPRE tem o evento correspondente na
      // timeline (clamp acima garante que não é anterior à primeira mensagem).
      // Quando eventAt coincide com a primeira mensagem, o evento já existe.
      pushEvent('mensagem_recebida', pick(INCOMING_MESSAGES), eventAt.toISOString())
      lastMessageAt = eventAt.toISOString()
    }
  }

  if (replied) {
    const replyAt = new Date(
      clampPast(firstMessageAt.getTime() + randInt(3, 45) * 60000),
    )
    pushEvent('mensagem_enviada', pick(OUTGOING_MESSAGES), replyAt.toISOString())
    lastMessageAt = replyAt.toISOString()

    // Troca adicional de mensagens para leads mais avançados.
    const extraMessages =
      stage === 'qualificado' ? randInt(1, 3) : stage === 'vendido' ? randInt(2, 4) : chance(0.5) ? 1 : 0
    let cursor = replyAt
    let lastWasIncoming = false
    for (let m = 0; m < extraMessages; m++) {
      cursor = new Date(clampPast(cursor.getTime() + randInt(5, 120) * 60000))
      const incoming = m % 2 === 0
      pushEvent(
        incoming ? 'mensagem_recebida' : 'mensagem_enviada',
        incoming ? pick(INCOMING_MESSAGES) : pick(OUTGOING_MESSAGES),
        cursor.toISOString(),
      )
      lastMessageAt = cursor.toISOString()
      lastWasIncoming = incoming
    }

    // Conversa respondida nunca termina com mensagem recebida pendente —
    // senão o motor de alertas contaria o lead como "sem resposta" e o lote
    // intencional acima deixaria de ser a única fonte dessa regra.
    if (lastWasIncoming) {
      cursor = new Date(clampPast(cursor.getTime() + randInt(3, 45) * 60000))
      pushEvent('mensagem_enviada', pick(OUTGOING_MESSAGES), cursor.toISOString())
      lastMessageAt = cursor.toISOString()
    }
  }

  if (stage === 'vendido') {
    pushEvent('estagio_alterado', 'Lead marcado como VENDIDO', isoAt(Math.max(daysAgo - 1, 0), randInt(9, 18)))
  } else if (stage === 'perdido') {
    pushEvent('estagio_alterado', 'Lead marcado como PERDIDO', isoAt(Math.max(daysAgo - 1, 0), randInt(9, 18)))
  }

  timeline.sort((a, b) => a.at.localeCompare(b.at))

  const value =
    stage === 'vendido'
      ? randInt(20000, 480000)
      : stage === 'qualificado'
        ? randInt(10000, 90000)
        : 0

  leads.push({
    id: `lead_${String(i + 1).padStart(4, '0')}`,
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    phone: `+55 ${pick(['11', '21', '31', '41', '51', '61', '71', '81'])} 9${randInt(6000, 9999)}-${randInt(1000, 9999)}`,
    stage,
    utmSource: def.source,
    utmMedium: def.medium,
    utmCampaign: def.slug,
    campaignId: campaign.id,
    adSetId: adSet.id,
    adId: ad.id,
    createdAt,
    lastMessageAt,
    value,
    timeline,
  })
}

/* --------------------------------- Alertas ---------------------------------- */
// Mesma semântica da regra derivada (checkLeadResponseRule): última mensagem
// RECEBIDA dentro da janela (2h, 50h]. Assim os alertas de API e os derivados
// se referem aos mesmos leads e a dedupe por (tipo, refId) os mescla sem ruído.
const lastMessageEventOf = (lead) => {
  let last = null
  for (const ev of lead.timeline) {
    if (ev.type !== 'mensagem_recebida' && ev.type !== 'mensagem_enviada') continue
    if (!last || ev.at > last.at) last = ev
  }
  return last
}
const staleLeads = leads
  .filter((l) => {
    if (l.stage === 'vendido' || l.stage === 'perdido') return false
    const last = lastMessageEventOf(l)
    if (!last || last.type !== 'mensagem_recebida') return false
    const age = NOW - new Date(last.at).getTime()
    return age > 2 * HOUR_MS && age <= 50 * HOUR_MS
  })
  .slice(0, 6)

const alerts = []
let alertSeq = 0
const pushAlert = (partial) => {
  alertSeq += 1
  alerts.push({ id: `alert_${String(alertSeq).padStart(2, '0')}`, read: false, ...partial })
}

// Orçamento estourado nas 2 campanhas marcadas.
for (const def of CAMPAIGN_DEFS.filter((d) => d.overspend)) {
  const campaign = campaigns.find((c) => c.name === def.name)
  pushAlert({
    type: 'ORCAMENTO_ESTOURADO',
    severity: 'critical',
    title: 'Orçamento diário estourado',
    message: `A campanha "${def.name}" ultrapassou o orçamento diário de R$ ${(def.dailyBudget / 100).toFixed(2).replace('.', ',')} nos últimos dias.`,
    createdAt: new Date(NOW - randInt(1, 5) * 60 * 60 * 1000).toISOString(),
    refId: campaign.id,
  })
}

// Leads sem resposta dentro da janela operacional (limite 2h + horizonte 48h).
for (const lead of staleLeads) {
  pushAlert({
    type: 'LEAD_SEM_RESPOSTA',
    severity: 'warning',
    title: 'Lead aguardando resposta',
    message: `${lead.name} enviou mensagem e ainda não recebeu resposta.`,
    createdAt: lead.lastMessageAt,
    refId: lead.id,
  })
}

// Alertas de CPL acima da média (histórico, já lidos).
for (const campaign of campaigns.slice(0, 2)) {
  pushAlert({
    type: 'CPL_ACIMA_MEDIA',
    severity: 'info',
    title: 'CPL acima da média',
    message: `O custo por lead de "${campaign.name}" ficou 32% acima da média dos últimos 7 dias.`,
    createdAt: new Date(NOW - randInt(26, 60) * 60 * 60 * 1000).toISOString(),
    refId: campaign.id,
    read: true,
  })
}

alerts.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

/* -------------------------------- Escrita ----------------------------------- */
mkdirSync(OUT_DIR, { recursive: true })

const datasets = {
  'campaigns.json': campaigns,
  'adsets.json': adSets,
  'ads.json': ads,
  'daily-metrics.json': dailyMetrics,
  'leads.json': leads,
  'alerts.json': alerts,
}

for (const [file, data] of Object.entries(datasets)) {
  writeFileSync(join(OUT_DIR, file), JSON.stringify(data))
  console.log(`✔ ${file} (${data.length} registros)`)
}

console.log(
  `\nSeed ${SEED} · ${campaigns.length} campanhas, ${adSets.length} ad sets, ` +
  `${ads.length} anúncios, ${dailyMetrics.length} métricas diárias, ` +
  `${leads.length} leads, ${alerts.length} alertas.`,
)
