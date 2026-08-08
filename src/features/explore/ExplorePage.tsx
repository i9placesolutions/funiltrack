/**
 * Explorador do rastreamento: mostra a rota do lead entre o anúncio, a
 * conversa e o resultado. Todos os números são derivados da fachada da API;
 * a página não cria estado paralelo para representar eventos.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, type LeadEventType } from '../../lib/api'
import { queryKeys } from '../../lib/query/keys'
import { staleTimes } from '../../lib/query/queryClient'
import {
  formatBRL,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from '../../lib/format'
import { PageFrame } from '../../components/layout/PageFrame'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { ErrorState } from '../_shared/ErrorState'
import {
  OBJECTIVE_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  STATUS_VARIANTS,
} from '../_shared/labels'
import {
  PERIOD_OPTIONS,
  periodDescription,
  periodLabel,
  periodRange,
  readPeriodDays,
  writePeriodDays,
  type PeriodDays,
} from '../_shared/period'

const EXPLORE_LEADS_PAGE_SIZE = 500

const EVENT_LABELS: Record<LeadEventType, string> = {
  lead_criado: 'Lead capturado',
  mensagem_recebida: 'Mensagem recebida',
  mensagem_enviada: 'Mensagem enviada',
  estagio_alterado: 'Estágio atualizado',
  nota: 'Nota registrada',
}

const EVENT_DOT_CLASSES: Record<LeadEventType, string> = {
  lead_criado: 'bg-primary shadow-[0_0_10px_rgb(var(--color-primary)/0.8)]',
  mensagem_recebida: 'bg-accent shadow-[0_0_10px_rgb(var(--color-accent)/0.8)]',
  mensagem_enviada: 'bg-primary-2 shadow-[0_0_10px_rgb(var(--color-primary-2)/0.8)]',
  estagio_alterado: 'bg-warning shadow-[0_0_10px_rgb(var(--color-warning)/0.8)]',
  nota: 'bg-text-muted',
}

function SignalIcon({ type }: { type: 'campaign' | 'capture' | 'conversation' | 'result' }) {
  const paths = {
    campaign: 'M4 19V5h16v14M8 9h8M8 13h5M8 17h3',
    capture: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
    conversation: 'M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v4a3.5 3.5 0 0 1-3.5 3.5H12l-4.5 4v-4.1A3.5 3.5 0 0 1 5 10.5z',
    result: 'M5 12.5 9.5 17 19 7',
  } as const

  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[type]} />
    </svg>
  )
}

function FlowNode({
  index,
  label,
  detail,
  value,
  type,
  accent,
}: {
  index: string
  label: string
  detail: string
  value: string
  type: 'campaign' | 'capture' | 'conversation' | 'result'
  accent: string
}) {
  return (
    <div className="relative z-10 gradient-hairline rounded-xl border border-border/70 bg-surface/95 p-3.5 shadow-[var(--shadow-card)] backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}>
          <SignalIcon type={type} />
        </span>
        <span className="font-mono text-[10px] font-bold tracking-[0.18em] text-text-muted">
          {index}
        </span>
      </div>
      <p className="mt-4 text-sm font-semibold text-text">{label}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{detail}</p>
      <p className="mt-3 font-display text-xl font-extrabold tracking-tight text-text tabular-nums">
        {value}
      </p>
    </div>
  )
}

function ExploreSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Skeleton height="8rem" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} height="9rem" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.85fr]">
        <Skeleton height="24rem" />
        <Skeleton height="24rem" />
      </div>
    </div>
  )
}

export default function ExplorePage() {
  const [period, setPeriod] = useState<PeriodDays>(() => readPeriodDays())
  const [selectedCampaignId, setSelectedCampaignId] = useState('')
  const range = useMemo(() => periodRange(period), [period])

  const campaignsQuery = useQuery({
    queryKey: queryKeys.campaigns.all,
    queryFn: api.getCampaigns,
    staleTime: staleTimes.campaigns,
  })
  const metricsQuery = useQuery({
    queryKey: queryKeys.metrics.daily(range),
    queryFn: () => api.getDailyMetrics(range),
    staleTime: staleTimes.metrics,
  })
  const leadsQuery = useQuery({
    queryKey: queryKeys.leads.list({ page: 1, pageSize: EXPLORE_LEADS_PAGE_SIZE }),
    queryFn: () => api.getLeads({ page: 1, pageSize: EXPLORE_LEADS_PAGE_SIZE }),
    staleTime: staleTimes.dynamic,
  })

  const campaigns = useMemo(() => campaignsQuery.data ?? [], [campaignsQuery.data])
  const metrics = useMemo(() => metricsQuery.data ?? [], [metricsQuery.data])
  const leads = useMemo(() => leadsQuery.data?.items ?? [], [leadsQuery.data?.items])
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId)

  const periodLeads = useMemo(
    () =>
      leads.filter((lead) => {
        const createdDate = lead.createdAt.slice(0, 10)
        return createdDate >= range.from && createdDate <= range.to
      }),
    [leads, range.from, range.to],
  )

  const filteredLeads = useMemo(
    () =>
      selectedCampaignId
        ? periodLeads.filter((lead) => lead.campaignId === selectedCampaignId)
        : periodLeads,
    [periodLeads, selectedCampaignId],
  )

  const filteredMetrics = useMemo(
    () =>
      selectedCampaignId
        ? metrics.filter((metric) => metric.campaignId === selectedCampaignId)
        : metrics,
    [metrics, selectedCampaignId],
  )

  const overview = useMemo(() => {
    const conversations = filteredLeads.filter((lead) => lead.lastMessageAt).length
    const qualified = filteredLeads.filter(
      (lead) => lead.stage === 'qualificado' || lead.stage === 'vendido',
    ).length
    const sold = filteredLeads.filter((lead) => lead.stage === 'vendido').length
    const events = filteredLeads.reduce((total, lead) => total + lead.timeline.length, 0)

    return {
      campaigns: selectedCampaignId ? 1 : campaigns.length,
      leads: filteredLeads.length,
      conversations,
      qualified,
      sold,
      events,
    }
  }, [campaigns.length, filteredLeads, selectedCampaignId])

  const campaignRows = useMemo(() => {
    const metricsByCampaign = new Map<string, { spend: number; leads: number }>()
    for (const metric of filteredMetrics) {
      const current = metricsByCampaign.get(metric.campaignId) ?? { spend: 0, leads: 0 }
      current.spend += metric.spend
      current.leads += metric.leads
      metricsByCampaign.set(metric.campaignId, current)
    }

    const leadsByCampaign = new Map<string, { total: number; conversations: number; sold: number }>()
    for (const lead of filteredLeads) {
      const current = leadsByCampaign.get(lead.campaignId) ?? {
        total: 0,
        conversations: 0,
        sold: 0,
      }
      current.total += 1
      if (lead.lastMessageAt) current.conversations += 1
      if (lead.stage === 'vendido') current.sold += 1
      leadsByCampaign.set(lead.campaignId, current)
    }

    return campaigns
      .filter((campaign) => !selectedCampaignId || campaign.id === selectedCampaignId)
      .map((campaign) => {
        const metric = metricsByCampaign.get(campaign.id) ?? { spend: 0, leads: 0 }
        const attributed = leadsByCampaign.get(campaign.id) ?? {
          total: 0,
          conversations: 0,
          sold: 0,
        }
        return {
          campaign,
          ...metric,
          ...attributed,
          cpl: metric.leads > 0 ? Math.round(metric.spend / metric.leads) : 0,
        }
      })
      .sort((a, b) => b.conversations - a.conversations || b.spend - a.spend)
  }, [campaigns, filteredLeads, filteredMetrics, selectedCampaignId])

  const sourceRows = useMemo(() => {
    const bySource = new Map<
      string,
      { leads: number; conversations: number; sold: number; medium: string }
    >()
    for (const lead of filteredLeads) {
      const current = bySource.get(lead.utmSource) ?? {
        leads: 0,
        conversations: 0,
        sold: 0,
        medium: lead.utmMedium,
      }
      current.leads += 1
      if (lead.lastMessageAt) current.conversations += 1
      if (lead.stage === 'vendido') current.sold += 1
      bySource.set(lead.utmSource, current)
    }
    return [...bySource.entries()]
      .map(([source, data]) => ({ source, ...data }))
      .sort((a, b) => b.leads - a.leads)
  }, [filteredLeads])

  const eventRows = useMemo(
    () =>
      filteredLeads
        .flatMap((lead) =>
          lead.timeline.map((event) => ({
            ...event,
            leadName: lead.name,
            leadId: lead.id,
          })),
        )
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 9),
    [filteredLeads],
  )

  const selectPeriod = (days: PeriodDays) => {
    setPeriod(days)
    writePeriodDays(days)
  }

  const retryAll = () => {
    void campaignsQuery.refetch()
    void metricsQuery.refetch()
    void leadsQuery.refetch()
  }

  const isLoading =
    campaignsQuery.isPending || metricsQuery.isPending || leadsQuery.isPending
  const hasError =
    campaignsQuery.isError || metricsQuery.isError || leadsQuery.isError

  return (
    <PageFrame width="wide" className="space-y-5 lg:space-y-6">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between animate-rise">
        <div className="max-w-2xl">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Sinal do rastreamento
          </p>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-text lg:text-3xl">
            Explore a rota do seu lead
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-text-muted">
            Do anúncio à conversa: veja de onde o contato veio, quais sinais foram
            registrados e em que ponto ele avançou no funil.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
          <label className="sr-only" htmlFor="explore-campaign-filter">
            Filtrar por campanha
          </label>
          <select
            id="explore-campaign-filter"
            value={selectedCampaignId}
            onChange={(event) => setSelectedCampaignId(event.target.value)}
            className="h-10 min-w-52 rounded-lg border border-border/70 bg-surface/90 px-3 text-xs font-semibold text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">Todas as campanhas</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
          <div
            className="grid grid-cols-4 gap-1 rounded-xl p-1 neon-panel sm:min-w-[300px]"
            role="group"
            aria-label="Período de análise"
          >
            {PERIOD_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => selectPeriod(days)}
                aria-pressed={period === days}
                className={[
                  'h-8 rounded-lg px-2 text-[11px] font-semibold transition-all',
                  period === days
                    ? 'bg-gradient-to-r from-primary to-primary-2 text-primary-fg shadow-[var(--shadow-glow)]'
                    : 'text-text-muted hover:bg-surface-2/70 hover:text-text',
                ].join(' ')}
              >
                {periodLabel(days)}
              </button>
            ))}
          </div>
        </div>
      </header>

      {isLoading ? (
        <ExploreSkeleton />
      ) : hasError ? (
        <Card>
          <ErrorState
            message="Não foi possível carregar os sinais do rastreamento."
            onRetry={retryAll}
          />
        </Card>
      ) : (
        <>
          <section
            aria-label="Rota do lead"
            className="relative overflow-hidden rounded-2xl border border-primary/25 bg-surface/80 p-4 shadow-[var(--shadow-glow)] lg:p-5"
          >
            <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
            <div className="relative flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                  {selectedCampaign ? selectedCampaign.name : 'Visão do workspace'}
                </p>
                <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-text">
                  O sinal está chegando até o resultado?
                </h2>
              </div>
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                {formatNumber(overview.events)} eventos registrados
              </span>
            </div>

            <div className="relative mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
              <span
                className="pointer-events-none absolute left-[12%] right-[12%] top-11 hidden h-px bg-gradient-to-r from-primary/40 via-primary-2/80 to-accent/50 lg:block"
                aria-hidden="true"
              />
              <FlowNode
                index="01"
                label="Anúncio"
                detail="Campanha e origem UTM"
                value={formatNumber(overview.campaigns)}
                type="campaign"
                accent="bg-primary/12 text-primary"
              />
              <FlowNode
                index="02"
                label="Captura"
                detail="Lead identificado"
                value={formatNumber(overview.leads)}
                type="capture"
                accent="bg-primary-2/12 text-primary-2"
              />
              <FlowNode
                index="03"
                label="WhatsApp"
                detail="Conversa iniciada"
                value={formatNumber(overview.conversations)}
                type="conversation"
                accent="bg-accent/12 text-accent"
              />
              <FlowNode
                index="04"
                label="Resultado"
                detail="Qualificado ou vendido"
                value={formatNumber(overview.qualified)}
                type="result"
                accent="bg-warning/12 text-warning"
              />
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo do rastreamento">
            <div className="gradient-hairline neon-panel rounded-xl px-4 py-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                Conversas rastreadas
              </p>
              <p className="mt-1.5 font-display text-2xl font-extrabold tracking-tight text-text tabular-nums">
                {formatNumber(overview.conversations)}
              </p>
              <p className="mt-1 text-[11px] text-text-muted">
                {formatPercent(overview.leads ? overview.conversations / overview.leads : 0)} dos leads capturados
              </p>
            </div>
            <div className="gradient-hairline neon-panel rounded-xl px-4 py-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                Qualificados
              </p>
              <p className="mt-1.5 font-display text-2xl font-extrabold tracking-tight text-text tabular-nums">
                {formatNumber(overview.qualified)}
              </p>
              <p className="mt-1 text-[11px] text-text-muted">avançaram no funil</p>
            </div>
            <div className="gradient-hairline neon-panel rounded-xl px-4 py-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                Vendas atribuídas
              </p>
              <p className="mt-1.5 font-display text-2xl font-extrabold tracking-tight text-text tabular-nums">
                {formatNumber(overview.sold)}
              </p>
              <p className="mt-1 text-[11px] text-text-muted">resultado registrado no CRM</p>
            </div>
            <div className="gradient-hairline neon-panel rounded-xl px-4 py-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                Investimento no período
              </p>
              <p className="mt-1.5 font-display text-2xl font-extrabold tracking-tight text-text tabular-nums">
                {formatBRL(filteredMetrics.reduce((total, metric) => total + metric.spend, 0))}
              </p>
              <p className="mt-1 text-[11px] text-text-muted">métricas da Meta Ads</p>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.35fr_0.85fr]">
            <Card
              neon
              title="Campanhas que puxam conversa"
              subtitle={`${campaignRows.length} campanhas · ${periodDescription(period)}`}
              flush
              footer={
                <Link to="/leads" className="text-sm font-medium text-primary">
                  Abrir lista completa de leads →
                </Link>
              }
            >
              <div className="hidden grid-cols-[minmax(0,1.6fr)_90px_100px_110px_100px] gap-3 border-b border-border/70 bg-surface-2/35 px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-text-muted lg:grid">
                <span>Campanha</span>
                <span>Leads</span>
                <span>Conversas</span>
                <span>Custo</span>
                <span>CPL</span>
              </div>
              <ul className="divide-y divide-border/70">
                {campaignRows.map((row) => (
                  <li key={row.campaign.id}>
                    <Link
                      to={`/campanhas/${row.campaign.id}`}
                      className="grid min-h-[76px] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60 lg:grid-cols-[minmax(0,1.6fr)_90px_100px_110px_100px]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-text">{row.campaign.name}</p>
                          <Badge variant={STATUS_VARIANTS[row.campaign.status]}>
                            {STATUS_LABELS[row.campaign.status]}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[11px] text-text-muted">
                          {OBJECTIVE_LABELS[row.campaign.objective]} · {row.sold} vendas atribuídas
                        </p>
                      </div>
                      <div className="text-right lg:text-left">
                        <p className="text-sm font-semibold text-text tabular-nums">{formatNumber(row.total)}</p>
                        <p className="text-[10px] text-text-muted lg:hidden">leads</p>
                      </div>
                      <div className="text-right lg:text-left">
                        <p className="text-sm font-semibold text-text tabular-nums">{formatNumber(row.conversations)}</p>
                        <p className="text-[10px] text-text-muted lg:hidden">conversas</p>
                      </div>
                      <div className="text-right lg:text-left">
                        <p className="text-sm font-semibold text-text tabular-nums">{formatBRL(row.spend)}</p>
                        <p className="text-[10px] text-text-muted lg:hidden">custo</p>
                      </div>
                      <div className="hidden text-sm font-semibold text-text tabular-nums lg:block">
                        {row.cpl ? formatBRL(row.cpl) : '—'}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>

            <Card
              title="Origens que viraram conversa"
              subtitle="UTM source · atribuição dos leads"
            >
              {sourceRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-text-muted">Nenhuma origem registrada.</p>
              ) : (
                <ul className="space-y-4">
                  {sourceRows.map((row, index) => {
                    const maxLeads = sourceRows[0]?.leads ?? 1
                    const width = Math.max(8, (row.leads / maxLeads) * 100)
                    return (
                      <li key={row.source}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-text">{row.source}</p>
                            <p className="mt-0.5 text-[11px] text-text-muted">utm_medium: {row.medium}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold text-text tabular-nums">{formatNumber(row.leads)}</p>
                            <p className="text-[10px] text-text-muted">{formatNumber(row.conversations)} conversas</p>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <span
                            className="block h-full rounded-full bg-gradient-to-r from-primary to-primary-2 transition-[width] duration-500"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                        <p className="mt-1 text-right text-[10px] text-text-muted">
                          {formatNumber(row.sold)} {row.sold === 1 ? 'venda' : 'vendas'}
                        </p>
                        {index === 0 && (
                          <Badge variant="primary" className="mt-1">
                            Principal origem
                          </Badge>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          </section>

          <section className="grid gap-5 xl:grid-cols-[0.95fr_1.25fr]">
            <Card
              title="Padrão do sinal"
              subtitle="A estrutura que conecta anúncio, WhatsApp e resultado"
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-border/70 bg-surface-2/45 p-3.5">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--color-accent)/0.8)]" />
                  Campos acompanhados
                </div>
                <dl className="mt-3 divide-y divide-border/70 font-mono text-[11px]">
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-text-muted">utm_source</dt>
                    <dd className="text-primary">origem do anúncio</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-text-muted">utm_campaign</dt>
                    <dd className="text-primary">campanha atribuída</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-text-muted">last_message_at</dt>
                    <dd className="text-accent">conversa iniciada</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-text-muted">stage</dt>
                    <dd className="text-warning">resultado no funil</dd>
                  </div>
                </dl>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-text-muted">
                O n8n pode transportar esses sinais entre o WhatsApp e a Meta. Aqui,
                cada etapa só aparece depois que o dado correspondente foi registrado.
              </p>
            </Card>

            <Card title="Últimos sinais capturados" subtitle="Linha do tempo das conversas" flush>
              {eventRows.length === 0 ? (
                <p className="p-4 text-sm text-text-muted">Ainda não há eventos para explorar.</p>
              ) : (
                <ol className="divide-y divide-border/70">
                  {eventRows.map((event) => (
                    <li key={`${event.leadId}-${event.id}`}>
                      <Link
                        to={`/leads/${event.leadId}`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60"
                      >
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${EVENT_DOT_CLASSES[event.type]}`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <p className="text-xs font-semibold text-text">{EVENT_LABELS[event.type]}</p>
                            <p className="text-[11px] text-text-muted">{event.leadName}</p>
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-text-muted">{event.text}</p>
                        </div>
                        <span className="shrink-0 text-[10px] text-text-muted">{formatRelativeTime(event.at)}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </section>

          <p className="text-center text-[11px] text-text-muted">
            Dados sincronizados no período selecionado · {STAGE_LABELS.qualificado} e{' '}
            {STAGE_LABELS.vendido} contam como avanço no resultado.
          </p>
        </>
      )}
    </PageFrame>
  )
}
