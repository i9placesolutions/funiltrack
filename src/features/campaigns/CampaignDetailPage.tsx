/**
 * Detalhe da campanha: header com status/objetivo, KPIs do período
 * (o mesmo salvo na sessão pelo dashboard), tendência diária e leads
 * atribuídos à campanha.
 */
import { lazy, Suspense, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { queryKeys } from '../../lib/query/keys'
import { staleTimes } from '../../lib/query/queryClient'
import {
  formatBRL,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from '../../lib/format'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { ErrorState } from '../_shared/ErrorState'
import {
  OBJECTIVE_LABELS,
  STAGE_LABELS,
  STAGE_VARIANTS,
  STATUS_LABELS,
  STATUS_VARIANTS,
} from '../_shared/labels'
import { aggregateMetrics, dailySeries } from '../_shared/metrics'
import { periodRange, readPeriodDays } from '../_shared/period'

const TrendLineChart = lazy(
  () => import('../../components/charts/TrendLineChart'),
)

const LEADS_PREVIEW_SIZE = 50

function KpiCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-2/60 border border-border/60 rounded-lg px-3 py-2.5">
      <p className="text-[11px] text-text-muted">{label}</p>
      <p className="text-sm font-semibold text-text mt-0.5 tabular-nums">{value}</p>
    </div>
  )
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>()
  // Mesmo período persistido pelo dashboard (sessão).
  const periodDays = readPeriodDays()
  const range = useMemo(() => periodRange(periodDays), [periodDays])

  const campaignQuery = useQuery({
    queryKey: queryKeys.campaigns.detail(id ?? ''),
    queryFn: () => api.getCampaign(id as string),
    enabled: Boolean(id),
    staleTime: staleTimes.campaigns,
  })

  const metricsQuery = useQuery({
    queryKey: queryKeys.metrics.daily({ ...range, campaignId: id ?? '' }),
    queryFn: () => api.getDailyMetrics({ ...range, campaignId: id as string }),
    enabled: Boolean(id),
    staleTime: staleTimes.metrics,
  })

  const leadsQuery = useQuery({
    queryKey: queryKeys.leads.list({
      campaignId: id ?? '',
      page: 1,
      pageSize: LEADS_PREVIEW_SIZE,
    }),
    queryFn: () =>
      api.getLeads({
        campaignId: id as string,
        page: 1,
        pageSize: LEADS_PREVIEW_SIZE,
      }),
    enabled: Boolean(id),
    staleTime: staleTimes.dynamic,
  })

  const campaign = campaignQuery.data
  const metrics = metricsQuery.data
  const leadsPage = leadsQuery.data

  const kpis = useMemo(() => aggregateMetrics(metrics ?? []), [metrics])
  const series = useMemo(() => dailySeries(metrics ?? []), [metrics])

  const retryAll = () => {
    void campaignQuery.refetch()
    void metricsQuery.refetch()
    void leadsQuery.refetch()
  }

  const isLoading =
    campaignQuery.isPending || metricsQuery.isPending || leadsQuery.isPending
  const hasError =
    campaignQuery.isError || metricsQuery.isError || leadsQuery.isError

  if (isLoading) {
    return (
      <div className="px-4 lg:px-8 pt-4 lg:pt-8 space-y-4 max-w-3xl lg:max-w-5xl mx-auto" aria-busy="true">
        <Skeleton height="1.25rem" width="30%" />
        <Skeleton height="3.5rem" />
        <Skeleton height="7rem" />
        <Skeleton height="15rem" />
        <Skeleton height="10rem" />
      </div>
    )
  }

  if (hasError || !campaign) {
    return (
      <div className="px-4 lg:px-8 pt-4 lg:pt-8 space-y-4 max-w-3xl lg:max-w-5xl mx-auto">
        <Link to="/" className="text-sm text-primary inline-flex min-h-11 items-center">
          ← Voltar ao dashboard
        </Link>
        <Card>
          <ErrorState
            message="Não foi possível carregar esta campanha."
            onRetry={retryAll}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="px-4 lg:px-8 pt-4 lg:pt-8 space-y-4 max-w-3xl lg:max-w-5xl mx-auto">
      <Link to="/" className="text-sm text-primary inline-flex min-h-11 items-center">
        ← Voltar ao dashboard
      </Link>

      {/* Header da campanha */}
      <header className="space-y-2">
        <h1 className="font-display text-xl font-bold text-text leading-snug">
          {campaign.name}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_VARIANTS[campaign.status]}>
            {STATUS_LABELS[campaign.status]}
          </Badge>
          <Badge variant="neutral">
            Objetivo: {OBJECTIVE_LABELS[campaign.objective]}
          </Badge>
        </div>
        <p className="text-xs text-text-muted">
          Orçamento diário {formatBRL(campaign.dailyBudget)} · desde{' '}
          {formatDate(campaign.startDate)}
          {campaign.endDate ? ` até ${formatDate(campaign.endDate)}` : ''}
        </p>
      </header>

      {/* KPIs do período */}
      <section aria-label="Indicadores da campanha">
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 lg:gap-3">
          <KpiCell label="Gasto" value={formatBRL(kpis.spend)} />
          <KpiCell label="Leads" value={formatNumber(kpis.leads)} />
          <KpiCell label="CPL" value={formatBRL(kpis.cpl)} />
          <KpiCell label="CTR" value={formatPercent(kpis.ctr)} />
          <KpiCell label="CPC" value={formatBRL(kpis.cpc)} />
          <KpiCell
            label="ROAS"
            value={`${formatNumber(Math.round(kpis.roas * 100) / 100)}×`}
          />
        </div>
        <p className="text-[11px] text-text-muted mt-1.5">
          Últimos {periodDays} dias ({formatDate(range.from)} –{' '}
          {formatDate(range.to)})
        </p>
      </section>

      {/* Tendência diária */}
      <Card title="Tendência diária" subtitle="Custo e leads por dia">
        {series.length === 0 ? (
          <EmptyState
            title="Sem métricas no período"
            description="Esta campanha não teve entrega nos dias selecionados."
          />
        ) : (
          <Suspense fallback={<Skeleton height="13rem" />}>
            <TrendLineChart data={series} height={280} />
          </Suspense>
        )}
      </Card>

      {/* Leads atribuídos */}
      <Card
        title="Leads da campanha"
        subtitle={
          leadsPage ? `${leadsPage.total} leads atribuídos` : undefined
        }
        flush
        footer={
          <Link
            to={`/leads?campanha=${campaign.id}`}
            className="text-sm text-primary font-medium"
          >
            Ver todos os leads →
          </Link>
        }
      >
        {!leadsPage || leadsPage.items.length === 0 ? (
          <EmptyState
            icon="👥"
            title="Nenhum lead ainda"
            description="Nenhum lead foi atribuído a esta campanha até agora."
          />
        ) : (
          <ul className="divide-y divide-border">
            {leadsPage.items.map((lead) => (
              <li key={lead.id}>
                <Link
                  to={`/leads/${lead.id}`}
                  className="flex items-center gap-3 px-4 py-3 min-h-14 active:bg-surface-2 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text truncate">
                      {lead.name}
                    </p>
                    <p className="text-[11px] text-text-muted truncate mt-0.5">
                      {lead.phone}
                    </p>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <Badge variant={STAGE_VARIANTS[lead.stage]}>
                      {STAGE_LABELS[lead.stage]}
                    </Badge>
                    <p className="text-[11px] text-text-muted">
                      {formatRelativeTime(lead.lastMessageAt ?? lead.createdAt)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
