/**
 * Detalhe do lead: dados do contato, cartão de atribuição UTM completo
 * (source/medium/campaign + campanha/conjunto/anúncio) e timeline
 * cronológica dos eventos (`lead.timeline`).
 */
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, type Lead, type LeadEvent, type LeadEventType } from '../../lib/api'
import {
  getLeadMetaConversionEvents,
  type MetaConversionEvent,
} from '../../lib/api/authClient'
import { queryKeys } from '../../lib/query/keys'
import { staleTimes } from '../../lib/query/queryClient'
import {
  formatBRL,
  formatDateTime,
  formatRelativeTime,
} from '../../lib/format'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { ErrorState } from '../_shared/ErrorState'
import { STAGE_LABELS, STAGE_VARIANTS } from '../_shared/labels'

/** Metadados de exibição por tipo de evento da timeline. */
const EVENT_META: Record<
  LeadEventType,
  { label: string; dotClass: string }
> = {
  lead_criado: { label: 'Lead criado', dotClass: 'bg-primary' },
  mensagem_recebida: { label: 'Mensagem recebida', dotClass: 'bg-accent' },
  mensagem_enviada: { label: 'Mensagem enviada', dotClass: 'bg-surface-2 border border-border' },
  estagio_alterado: { label: 'Estágio alterado', dotClass: 'bg-warning' },
  nota: { label: 'Nota', dotClass: 'bg-text-muted' },
}

function AttributionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-xs text-text-muted shrink-0">{label}</dt>
      <dd className="text-xs font-medium text-text text-right break-all">
        {value}
      </dd>
    </div>
  )
}

function TimelineItem({
  event,
  isLast,
}: {
  event: LeadEvent
  isLast: boolean
}) {
  const meta = EVENT_META[event.type]
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {/* Trilho vertical */}
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute left-[5px] top-4 bottom-0 w-px bg-border"
        />
      )}
      <span
        aria-hidden="true"
        className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${meta.dotClass}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold text-text">{meta.label}</p>
          <p className="text-[11px] text-text-muted shrink-0">
            {formatDateTime(event.at)}
          </p>
        </div>
        <p className="text-xs text-text-muted mt-0.5 break-words">
          {event.text}
        </p>
      </div>
    </li>
  )
}

function SignalChip({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={[
        'rounded-md border px-2 py-1 text-[10px] font-semibold tracking-wide',
        active
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-border bg-surface-2/60 text-text-muted',
      ].join(' ')}
    >
      {active ? '✓ ' : '— '}{label}
    </span>
  )
}

function MetaEventStatus({ status }: { status: MetaConversionEvent['status'] }) {
  const variant = status === 'sent'
    ? 'success'
    : status === 'failed'
      ? 'danger'
      : status === 'processing'
        ? 'primary'
        : 'warning'
  const label = status === 'sent'
    ? 'aceito'
    : status === 'failed'
      ? 'falhou'
      : status === 'processing'
        ? 'enviando'
        : 'na fila'
  return <Badge variant={variant}>{label}</Badge>
}

function TrackingCard({
  tracking,
}: {
  tracking: NonNullable<Lead['tracking']>
}) {
  const hasIp = Boolean(tracking.clientIp ?? tracking.maskedIp)
  const ipLabel = tracking.fullIpVisible ? tracking.clientIp : tracking.maskedIp
  const sourceLabel = tracking.ipSource === 'browser_request'
    ? 'capturado na requisição do navegador'
    : tracking.ipSource === 'first_party_payload'
      ? 'enviado por uma origem first-party confiável'
      : null

  return (
    <Card
      neon
      title="Sinal de origem"
      subtitle="O que realmente chegou com este lead para melhorar o matching da Meta."
    >
      <div className="space-y-3">
        <div className={[
          'rounded-xl border p-3',
          hasIp ? 'border-primary/35 bg-primary/5' : 'border-border bg-surface-2/40',
        ].join(' ')}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">IP do visitante</p>
              <p className="mt-1 font-mono text-sm font-bold text-text">
                {ipLabel ?? 'Não capturado'}
              </p>
              {hasIp && <p className="mt-1 text-[11px] text-text-muted">{tracking.ipVersion} · {sourceLabel}</p>}
            </div>
            <Badge variant={hasIp ? 'success' : 'neutral'}>{hasIp ? 'disponível' : 'ausente'}</Badge>
          </div>
          {!hasIp && (
            <p className="mt-3 text-xs leading-5 text-text-muted">
              Este lead veio pelo WhatsApp sem um IP first-party. O FunilTrack não substitui isso pelo IP da UazAPI, n8n ou Meta, pois seria um dado incorreto.
            </p>
          )}
          {hasIp && !tracking.fullIpVisible && (
            <p className="mt-3 text-xs leading-5 text-text-muted">Seu papel exibe o IP mascarado. Owner e admin visualizam o valor completo quando houver necessidade operacional legítima.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5" aria-label="Sinais de matching capturados">
          <SignalChip active={hasIp} label="IP" />
          <SignalChip active={tracking.clientUserAgentCaptured} label="User-agent" />
          <SignalChip active={tracking.fbpCaptured} label="_fbp" />
          <SignalChip active={tracking.fbcCaptured} label="_fbc" />
          <SignalChip active={tracking.fbclidCaptured} label="fbclid" />
          <SignalChip active={tracking.ctwaClidCaptured} label="CTWA" />
        </div>

        {tracking.capturedAt && (
          <p className="text-[11px] text-text-muted">Sinal registrado em {formatDateTime(tracking.capturedAt)}.</p>
        )}
      </div>
    </Card>
  )
}

function MetaEventsCard({
  events,
  isPending,
  isError,
}: {
  events: MetaConversionEvent[]
  isPending: boolean
  isError: boolean
}) {
  return (
    <Card
      title="Devolução para a Meta"
      subtitle="Eventos criados por este lead e o estado real da fila da Conversions API."
    >
      {isPending ? (
        <p className="text-xs text-text-muted">Lendo a auditoria de eventos…</p>
      ) : isError ? (
        <p className="text-xs text-danger">Não foi possível consultar a auditoria Meta deste lead.</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-text-muted">Nenhum evento foi criado ainda. O primeiro Lead aparece quando o contato é recebido.</p>
      ) : (
        <ol className="space-y-3">
          {events.map((event) => (
            <li key={event.id} className="rounded-lg border border-border/70 bg-surface-2/35 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-text">{event.eventName}</p>
                  <p className="mt-0.5 text-[11px] text-text-muted">Criado em {formatDateTime(event.eventTime)} · tentativa {event.attempts}</p>
                </div>
                <MetaEventStatus status={event.status} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <SignalChip active={event.matching.clientIp} label={event.matching.ipVersion ?? 'IP'} />
                <SignalChip active={event.matching.clientUserAgent} label="User-agent" />
                <SignalChip active={event.matching.fbp} label="_fbp" />
                <SignalChip active={event.matching.fbc} label="_fbc" />
                <SignalChip active={event.matching.ctwaClid} label="CTWA" />
                <SignalChip active={event.matching.phoneHashed} label="Telefone hash" />
              </div>
              {event.status === 'sent' && (
                <p className="mt-2 text-[11px] text-accent">
                  A Meta aceitou o evento{event.acceptedEvents !== null ? ` (${event.acceptedEvents} recebido${event.acceptedEvents === 1 ? '' : 's'})` : ''}.
                </p>
              )}
              {event.lastError && <p className="mt-2 text-[11px] text-danger">{event.lastError}</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()

  const leadQuery = useQuery({
    queryKey: queryKeys.leads.detail(id ?? ''),
    queryFn: () => api.getLead(id as string),
    enabled: Boolean(id),
    staleTime: staleTimes.dynamic,
  })

  const lead = leadQuery.data
  const campaignQuery = useQuery({
    queryKey: queryKeys.campaigns.detail(lead?.campaignId ?? ''),
    queryFn: () => api.getCampaign(lead?.campaignId as string),
    enabled: Boolean(lead?.campaignId),
    staleTime: staleTimes.campaigns,
  })

  const metaEventsQuery = useQuery({
    queryKey: queryKeys.leads.metaEvents(id ?? ''),
    queryFn: () => getLeadMetaConversionEvents(id as string),
    enabled: Boolean(id),
    staleTime: staleTimes.dynamic,
  })

  const timeline = useMemo(
    () =>
      [...(lead?.timeline ?? [])].sort((a, b) => a.at.localeCompare(b.at)),
    [lead?.timeline],
  )

  if (leadQuery.isPending) {
    return (
      <div className="px-4 lg:px-8 pt-4 lg:pt-8 space-y-4 max-w-3xl lg:max-w-4xl mx-auto" aria-busy="true">
        <Skeleton height="1.25rem" width="30%" />
        <Skeleton height="7rem" />
        <Skeleton height="9rem" />
        <Skeleton height="12rem" />
      </div>
    )
  }

  if (leadQuery.isError || !lead) {
    return (
      <div className="px-4 lg:px-8 pt-4 lg:pt-8 space-y-4 max-w-3xl lg:max-w-4xl mx-auto">
        <Link
          to="/leads"
          className="text-sm text-primary inline-flex min-h-11 items-center"
        >
          ← Voltar para leads
        </Link>
        <Card>
          <ErrorState
            message="Não foi possível carregar este lead."
            onRetry={() => void leadQuery.refetch()}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="px-4 lg:px-8 pt-4 lg:pt-8 space-y-4 max-w-3xl lg:max-w-4xl mx-auto">
      <Link
        to="/leads"
        className="text-sm text-primary inline-flex min-h-11 items-center"
      >
        ← Voltar para leads
      </Link>

      {/* Dados do lead */}
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold text-text truncate">{lead.name}</h1>
            <a
              href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}
              className="text-sm text-primary"
            >
              {lead.phone}
            </a>
          </div>
          <Badge variant={STAGE_VARIANTS[lead.stage]} className="shrink-0">
            {STAGE_LABELS[lead.stage]}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-surface-2/60 border border-border/60 rounded-lg px-3 py-2.5">
            <p className="text-[11px] text-text-muted">Valor</p>
            <p className="text-sm font-semibold text-text mt-0.5">
              {formatBRL(lead.value)}
            </p>
          </div>
          <div className="bg-surface-2/60 border border-border/60 rounded-lg px-3 py-2.5">
            <p className="text-[11px] text-text-muted">Última mensagem</p>
            <p className="text-sm font-semibold text-text mt-0.5">
              {lead.lastMessageAt
                ? formatRelativeTime(lead.lastMessageAt)
                : 'Sem conversa'}
            </p>
          </div>
        </div>
        <p className="text-xs text-text-muted">
          Criado em {formatDateTime(lead.createdAt)}
        </p>
      </header>

      {/* Atribuição UTM */}
      <Card title="Atribuição" subtitle="Origem completa do lead">
        <dl className="divide-y divide-border -my-1.5">
          <AttributionRow label="UTM source" value={lead.utmSource} />
          <AttributionRow label="UTM medium" value={lead.utmMedium} />
          <AttributionRow label="UTM campaign" value={lead.utmCampaign} />
          <div className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-xs text-text-muted shrink-0">Campanha</dt>
            <dd className="text-right">
              <Link
                to={`/campanhas/${lead.campaignId}`}
                className="text-xs font-medium text-primary break-all"
              >
                {campaignQuery.data?.name ?? lead.campaignId}
              </Link>
            </dd>
          </div>
          <AttributionRow label="Conjunto de anúncios" value={lead.adSetId} />
          <AttributionRow label="Anúncio" value={lead.adId} />
        </dl>
      </Card>

      {lead.tracking && <TrackingCard tracking={lead.tracking} />}

      <MetaEventsCard
        events={metaEventsQuery.data ?? []}
        isPending={metaEventsQuery.isPending}
        isError={metaEventsQuery.isError}
      />

      {/* Timeline cronológica */}
      <Card
        title="Timeline"
        subtitle={
          timeline.length > 0
            ? `${timeline.length} eventos em ordem cronológica`
            : undefined
        }
      >
        {timeline.length === 0 ? (
          <EmptyState
            title="Sem eventos"
            description="Este lead ainda não possui eventos registrados."
          />
        ) : (
          <ol>
            {timeline.map((event, index) => (
              <TimelineItem
                key={event.id}
                event={event}
                isLast={index === timeline.length - 1}
              />
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}
