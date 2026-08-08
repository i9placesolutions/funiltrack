/**
 * Dashboard: KPIs do período com variação % vs. período anterior,
 * gráfico de linha (custo × leads/dia), donut de gasto por campanha
 * e lista de campanhas navegável.
 *
 * Layout: coluna no mobile; grid de console no desktop (lg+).
 * Gráficos são carregados via lazy() para code-split do chunk recharts.
 */
import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { queryKeys } from '../../lib/query/keys'
import { staleTimes } from '../../lib/query/queryClient'
import {
  formatBRL,
  formatDate,
  formatNumber,
  formatPercent,
} from '../../lib/format'
import { PageFrame } from '../../components/layout/PageFrame'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { ErrorState } from '../_shared/ErrorState'
import { STATUS_LABELS, STATUS_VARIANTS } from '../_shared/labels'
import {
  aggregateMetrics,
  dailySeries,
  percentDelta,
  spendByCampaign,
} from '../_shared/metrics'
import {
  PERIOD_OPTIONS,
  periodRange,
  previousPeriodRange,
  periodDescription,
  periodLabel,
  readPeriodDays,
  writePeriodDays,
  type PeriodDays,
} from '../_shared/period'

const TrendLineChart = lazy(
  () => import('../../components/charts/TrendLineChart'),
)
const SpendByCampaignDonut = lazy(
  () => import('../../components/charts/SpendByCampaignDonut'),
)

/** KPI com variação percentual colorida pela direção "boa" do indicador. */
interface KpiView {
  label: string
  value: string
  delta: number | null
  /** Direção em que o indicador é positivo para o negócio. */
  goodWhen: 'up' | 'down'
}

function KpiCard({ kpi }: { kpi: KpiView }) {
  const { delta, goodWhen } = kpi
  const improving = delta !== null && (goodWhen === 'up' ? delta > 0 : delta < 0)
  const worsening = delta !== null && (goodWhen === 'up' ? delta < 0 : delta > 0)
  const deltaClass = improving
    ? 'bg-accent/15 text-accent border border-accent/30'
    : worsening
      ? 'bg-danger/15 text-danger border border-danger/30'
      : 'bg-surface-2 text-text-muted border border-border/60'
  const deltaText =
    delta === null
      ? '— vs. período anterior'
      : `${delta >= 0 ? '▲' : '▼'} ${formatPercent(Math.abs(delta))} vs. anterior`

  return (
    <div className="gradient-hairline neon-panel min-w-44 shrink-0 snap-start rounded-xl px-4 py-3.5 lg:min-w-0 lg:shrink lg:px-5 lg:py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        {kpi.label}
      </p>
      <p className="font-display text-xl lg:text-2xl font-extrabold text-text mt-1.5 tabular-nums tracking-tight">
        {kpi.value}
      </p>
      <span
        className={`inline-flex items-center gap-1 mt-2 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${deltaClass}`}
      >
        {deltaText}
      </span>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} height="5.5rem" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-5">
        <Skeleton height="20rem" className="lg:col-span-3" />
        <Skeleton height="20rem" className="lg:col-span-2" />
      </div>
      <Skeleton height="14rem" />
    </div>
  )
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<PeriodDays>(() => readPeriodDays())

  const currentRange = useMemo(() => periodRange(period), [period])
  const previousRange = useMemo(() => previousPeriodRange(period), [period])
  const previousQueryRange = previousRange ?? { from: '1970-01-01', to: '1970-01-01' }

  const metricsQuery = useQuery({
    queryKey: queryKeys.metrics.daily(currentRange),
    queryFn: () => api.getDailyMetrics(currentRange),
    staleTime: staleTimes.metrics,
  })
  const previousMetricsQuery = useQuery({
    queryKey: queryKeys.metrics.daily(previousQueryRange),
    queryFn: () => api.getDailyMetrics(previousQueryRange),
    enabled: Boolean(previousRange),
    staleTime: staleTimes.metrics,
  })
  const campaignsQuery = useQuery({
    queryKey: queryKeys.campaigns.all,
    queryFn: api.getCampaigns,
    staleTime: staleTimes.campaigns,
  })

  const metrics = metricsQuery.data
  const campaigns = campaignsQuery.data

  const current = useMemo(() => aggregateMetrics(metrics ?? []), [metrics])
  const previous = useMemo(
    () => aggregateMetrics(previousMetricsQuery.data ?? []),
    [previousMetricsQuery.data],
  )
  const series = useMemo(() => dailySeries(metrics ?? []), [metrics])
  const donutData = useMemo(() => {
    const names = new Map((campaigns ?? []).map((c) => [c.id, c.name]))
    return spendByCampaign(metrics ?? []).map((slice) => ({
      ...slice,
      name: names.get(slice.id) ?? slice.id,
    }))
  }, [metrics, campaigns])

  const campaignRows = useMemo(() => {
    const byCampaign = new Map<string, { spend: number; leads: number }>()
    for (const m of metrics ?? []) {
      const agg = byCampaign.get(m.campaignId) ?? { spend: 0, leads: 0 }
      agg.spend += m.spend
      agg.leads += m.leads
      byCampaign.set(m.campaignId, agg)
    }
    return (campaigns ?? [])
      .map((campaign) => ({
        campaign,
        ...(byCampaign.get(campaign.id) ?? { spend: 0, leads: 0 }),
      }))
      .sort((a, b) => b.spend - a.spend)
  }, [metrics, campaigns])

  const kpis: KpiView[] = [
    {
      label: 'Gasto',
      value: formatBRL(current.spend),
      delta: previousRange ? percentDelta(current.spend, previous.spend) : null,
      goodWhen: 'down',
    },
    {
      label: 'Leads',
      value: formatNumber(current.leads),
      delta: previousRange ? percentDelta(current.leads, previous.leads) : null,
      goodWhen: 'up',
    },
    {
      label: 'CPL',
      value: formatBRL(current.cpl),
      delta: previousRange ? percentDelta(current.cpl, previous.cpl) : null,
      goodWhen: 'down',
    },
    {
      label: 'CTR',
      value: formatPercent(current.ctr),
      delta: previousRange ? percentDelta(current.ctr, previous.ctr) : null,
      goodWhen: 'up',
    },
    {
      label: 'CPC',
      value: formatBRL(current.cpc),
      delta: previousRange ? percentDelta(current.cpc, previous.cpc) : null,
      goodWhen: 'down',
    },
    {
      label: 'ROAS',
      value: `${formatNumber(Math.round(current.roas * 100) / 100)}×`,
      delta: previousRange ? percentDelta(current.roas, previous.roas) : null,
      goodWhen: 'up',
    },
  ]

  const selectPeriod = (days: PeriodDays) => {
    setPeriod(days)
    writePeriodDays(days)
  }

  const retryAll = () => {
    void metricsQuery.refetch()
    void previousMetricsQuery.refetch()
    void campaignsQuery.refetch()
  }

  const isLoading =
    metricsQuery.isPending ||
    (Boolean(previousRange) && previousMetricsQuery.isPending) ||
    campaignsQuery.isPending
  const hasError =
    metricsQuery.isError ||
    (Boolean(previousRange) && previousMetricsQuery.isError) ||
    campaignsQuery.isError
  const hasMetrics = (metrics ?? []).length > 0

  return (
    <PageFrame width="wide" className="space-y-5 lg:space-y-6">
      {/* Cabeçalho + seletor de período */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between animate-rise">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary mb-1">
            Visão geral
          </p>
          <h1 className="font-display text-2xl lg:text-3xl font-extrabold tracking-tight text-text">
            Dashboard
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {formatDate(currentRange.from)} – {formatDate(currentRange.to)}
          </p>
        </div>
        <div
          className="grid grid-cols-4 gap-1 p-1 neon-panel rounded-xl w-full lg:w-auto lg:min-w-[360px]"
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
                'h-9 lg:h-10 px-3 rounded-lg text-xs lg:text-sm font-semibold transition-all',
                period === days
                  ? 'bg-gradient-to-r from-primary to-primary-2 text-primary-fg shadow-[var(--shadow-glow)]'
                  : 'text-text-muted hover:text-text hover:bg-surface-2/70',
              ].join(' ')}
            >
              {periodLabel(days)}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <DashboardSkeleton />
      ) : hasError ? (
        <ErrorState onRetry={retryAll} />
      ) : (
        <>
          {hasMetrics ? (
            <>
              {/* KPIs: carrossel no mobile, grade no desktop */}
              <section aria-label="Indicadores do período">
                <div className="flex gap-3 overflow-x-auto -mx-4 px-4 pb-1 snap-x no-scrollbar lg:mx-0 lg:px-0 lg:pb-0 lg:overflow-visible lg:grid lg:grid-cols-3 xl:grid-cols-6 lg:gap-3">
                  {kpis.map((kpi) => (
                    <KpiCard key={kpi.label} kpi={kpi} />
                  ))}
                </div>
              </section>

              {/* Gráficos lado a lado no desktop */}
              <section className="grid gap-5 lg:grid-cols-5 lg:gap-6">
                <Card
                  neon
                  className="lg:col-span-3"
                  title="Custo e leads por dia"
                  subtitle={periodDescription(period)}
                >
                  <Suspense fallback={<Skeleton height="18rem" />}>
                    <TrendLineChart data={series} height={320} />
                  </Suspense>
                  <div className="flex items-center gap-4 mt-2 text-[11px] text-text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_rgb(var(--color-primary)/0.8)]"
                        aria-hidden="true"
                      />
                      Custo (R$)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--color-accent)/0.8)]"
                        aria-hidden="true"
                      />
                      Leads
                    </span>
                  </div>
                </Card>

                <Card
                  neon
                  className="lg:col-span-2"
                  title="Gasto por campanha"
                  subtitle={periodDescription(period)}
                >
                  {donutData.length === 0 ? (
                    <EmptyState
                      title="Sem gasto no período"
                      description="Nenhuma campanha teve gasto nos dias selecionados."
                    />
                  ) : (
                    <Suspense fallback={<Skeleton height="18rem" />}>
                      <SpendByCampaignDonut data={donutData} height={240} />
                    </Suspense>
                  )}
                </Card>
              </section>
            </>
          ) : (
            <Card>
              <EmptyState
                icon="📊"
                title="Sem métricas no período"
                description="As campanhas sincronizadas continuam visíveis abaixo. Não há dados de entrega para os dias selecionados."
              />
            </Card>
          )}

          {/* Lista / tabela de campanhas */}
          <Card
            neon
            title="Campanhas"
            subtitle={`${campaignRows.length} campanhas sincronizadas`}
            flush
          >
            {campaignRows.length === 0 ? (
              <EmptyState
                title="Nenhuma campanha sincronizada"
                description="Sincronize a integração Meta para carregar as campanhas reais desta conta."
              />
            ) : (
              <>
                {/* Cabeçalho de tabela (desktop) */}
                <div className="hidden lg:grid grid-cols-[minmax(0,1.6fr)_120px_120px_120px_120px] gap-4 px-5 py-3 border-b border-border/70 text-[11px] font-semibold uppercase tracking-wide text-text-muted bg-surface-2/40">
                  <span>Campanha</span>
                  <span>Status</span>
                  <span className="text-right">Leads</span>
                  <span className="text-right">Gasto</span>
                  <span className="text-right">CPL</span>
                </div>
                <ul className="divide-y divide-border/80">
                  {campaignRows.map(({ campaign, spend, leads }) => (
                    <li key={campaign.id}>
                      <Link
                        to={`/campanhas/${campaign.id}`}
                        className="flex items-center gap-3 px-4 py-3 min-h-14 hover:bg-surface-2/60 active:bg-surface-2 transition-colors lg:grid lg:grid-cols-[minmax(0,1.6fr)_120px_120px_120px_120px] lg:gap-4 lg:px-5 lg:min-h-0 lg:py-3.5"
                      >
                        <div className="flex-1 min-w-0 lg:flex-none">
                          <p className="text-sm font-medium text-text truncate">
                            {campaign.name}
                          </p>
                          <div className="flex items-center gap-2 mt-1 lg:hidden">
                            <Badge variant={STATUS_VARIANTS[campaign.status]}>
                              {STATUS_LABELS[campaign.status]}
                            </Badge>
                            <span className="text-[11px] text-text-muted">
                              {formatNumber(leads)} leads
                            </span>
                          </div>
                        </div>
                        <div className="hidden lg:flex items-center">
                          <Badge variant={STATUS_VARIANTS[campaign.status]}>
                            {STATUS_LABELS[campaign.status]}
                          </Badge>
                        </div>
                        <p className="hidden lg:block text-sm text-text text-right tabular-nums">
                          {formatNumber(leads)}
                        </p>
                        <div className="text-right shrink-0 lg:contents">
                          <p className="text-sm font-semibold text-text tabular-nums lg:text-right">
                            {formatBRL(spend)}
                          </p>
                          <p className="text-[11px] text-text-muted lg:text-sm lg:text-text lg:text-right lg:font-medium tabular-nums">
                            <span className="lg:hidden">CPL </span>
                            {leads > 0 ? formatBRL(Math.round(spend / leads)) : '—'}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </>
      )}
    </PageFrame>
  )
}
