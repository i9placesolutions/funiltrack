/**
 * Central de alertas.
 *
 * Abordagem de dados (decisão de arquitetura):
 * - Alertas da fachada (`api.getAlerts`) são a fonte de verdade do servidor.
 * - Alertas derivados são calculados em tempo real pelo motor de regras puro
 *   (`src/lib/alerts/rules.ts`) a partir de campanhas + métricas + leads,
 *   usando os thresholds configuráveis de `src/lib/alerts/targets.ts`
 *   (definidos no onboarding e editáveis em Config).
 * - Mesclagem com deduplicação por (tipo, refId): quando o servidor já
 *   reporta o alerta, o derivado equivalente é descartado.
 * - A lista mesclada vem do hook compartilhado `useAllAlerts` (mesma fonte
 *   do badge de não lidos da bottom nav — ver `src/features/alerts/useAlerts.ts`).
 * - Estado "lido": alertas de API persistem via `api.markAlertRead`;
 *   alertas derivados (inexistentes no servidor) marcam-se apenas no
 *   AppContext (readAlertIds). Ambos atualizam o badge da bottom nav
 *   imediatamente, sem tocar no AppShell.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  api,
  AlertType,
  type AlertSeverity,
} from '../../lib/api'
import { queryKeys } from '../../lib/query/keys'
import {
  isDerivedAlertId,
  type DerivedAlert,
  type DerivedAlertType,
} from '../../lib/alerts/rules'
import { formatRelativeTime } from '../../lib/format'
import { PageFrame } from '../../components/layout/PageFrame'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { useApp } from '../../hooks/useApp'
import { isAlertEffectivelyRead, useAllAlerts } from './useAlerts'

type FilterValue = 'ALL' | 'UNREAD' | DerivedAlertType

const TYPE_LABELS: Record<DerivedAlertType, string> = {
  [AlertType.LEAD_SEM_RESPOSTA]: 'Lead sem resposta',
  [AlertType.ORCAMENTO_ESTOURADO]: 'Orçamento',
  [AlertType.CPL_ACIMA_MEDIA]: 'CPL alto',
  [AlertType.QUEDA_ENTREGA]: 'Entrega',
  PICO_MENSAGENS: 'Pico de mensagens',
}

const SEVERITY_ORDER: AlertSeverity[] = ['critical', 'warning', 'info']

const SEVERITY_META: Record<
  AlertSeverity,
  { label: string; dot: string; badge: 'danger' | 'warning' | 'primary' }
> = {
  critical: { label: 'Críticos', dot: 'bg-danger', badge: 'danger' },
  warning: { label: 'Atenção', dot: 'bg-warning', badge: 'warning' },
  info: { label: 'Informativos', dot: 'bg-primary', badge: 'primary' },
}

export default function AlertsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { readAlertIds, markAlertRead: markReadInContext } = useApp()
  const { toast } = useToast()
  const [filter, setFilter] = useState<FilterValue>('ALL')
  const [markingAll, setMarkingAll] = useState(false)

  // Mesma lista mesclada (API + derivados) que alimenta o badge da bottom nav.
  const { allAlerts, isLoading, isError, refetchAlerts } = useAllAlerts()

  // "Lido" efetivo: flag do servidor OU marcação local no contexto.
  const readSet = useMemo(() => new Set(readAlertIds), [readAlertIds])
  const isEffectivelyRead = (alert: DerivedAlert) =>
    isAlertEffectivelyRead(alert, readSet)

  const filtered = useMemo(() => {
    if (filter === 'ALL') return allAlerts
    if (filter === 'UNREAD') {
      return allAlerts.filter((alert) => !isEffectivelyRead(alert))
    }
    return allAlerts.filter((alert) => alert.type === filter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAlerts, filter, readSet])

  const grouped = useMemo(() => {
    return SEVERITY_ORDER.map((severity) => ({
      severity,
      items: filtered.filter((alert) => alert.severity === severity),
    })).filter((group) => group.items.length > 0)
  }, [filtered])

  const unreadCount = allAlerts.filter(
    (alert) => !isEffectivelyRead(alert),
  ).length

  const markRead = useMutation({
    mutationFn: async (alert: DerivedAlert) => {
      if (!isDerivedAlertId(alert.id)) await api.markAlertRead(alert.id)
    },
    onMutate: (alert) => {
      // Atualiza o contexto imediatamente → badge da bottom nav reage.
      markReadInContext(alert.id)
    },
    onError: () => {
      toast('Não foi possível marcar o alerta como lido.', 'danger')
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all })
    },
  })

  const markAllRead = async () => {
    setMarkingAll(true)
    try {
      const unread = allAlerts.filter((alert) => !isEffectivelyRead(alert))
      await Promise.all(
        unread.map((alert) => {
          markReadInContext(alert.id)
          return isDerivedAlertId(alert.id)
            ? Promise.resolve()
            : api.markAlertRead(alert.id)
        }),
      )
      await queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all })
      toast('Todos os alertas foram marcados como lidos.', 'success')
    } catch {
      toast('Não foi possível marcar todos os alertas.', 'danger')
    } finally {
      setMarkingAll(false)
    }
  }

  const openReference = (alert: DerivedAlert) => {
    if (!alert.refId) return
    if (alert.refId.startsWith('lead_')) navigate(`/leads/${alert.refId}`)
    else if (alert.refId.startsWith('cmp_'))
      navigate(`/campanhas/${alert.refId}`)
  }

  return (
    <PageFrame width="wide">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-4 lg:mb-6">
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-extrabold tracking-tight text-text">
            Alertas
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {unreadCount > 0
              ? `${unreadCount} não lido${unreadCount === 1 ? '' : 's'}`
              : 'Tudo lido por aqui'}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void markAllRead()}
            disabled={markingAll}
          >
            {markingAll ? 'Marcando…' : 'Marcar todos como lidos'}
          </Button>
        )}
      </div>

      {/* Filtros por tipo */}
      <div
        className="flex gap-2 overflow-x-auto pb-4 -mx-4 px-4 lg:mx-0 lg:px-0 lg:flex-wrap lg:overflow-visible no-scrollbar"
        role="tablist"
        aria-label="Filtrar alertas"
      >
        <FilterChip
          active={filter === 'ALL'}
          onClick={() => setFilter('ALL')}
          label="Todos"
        />
        <FilterChip
          active={filter === 'UNREAD'}
          onClick={() => setFilter('UNREAD')}
          label="Não lidos"
        />
        {(Object.keys(TYPE_LABELS) as DerivedAlertType[]).map((type) => (
          <FilterChip
            key={type}
            active={filter === type}
            onClick={() => setFilter(type)}
            label={TYPE_LABELS[type]}
          />
        ))}
      </div>

      {isLoading && !allAlerts.length && (
        <div className="space-y-3" aria-busy="true">
          <Skeleton height="6rem" />
          <Skeleton height="6rem" />
          <Skeleton height="6rem" />
        </div>
      )}

      {isError && (
        <Card>
          <EmptyState
            icon="⚠️"
            title="Não foi possível carregar os alertas"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={refetchAlerts}
              >
                Tentar novamente
              </Button>
            }
          />
        </Card>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <Card>
          <EmptyState
            icon="🎉"
            title={
              filter === 'ALL' || filter === 'UNREAD'
                ? 'Tudo em dia!'
                : 'Nenhum alerta deste tipo'
            }
            description={
              filter === 'ALL' || filter === 'UNREAD'
                ? 'Suas campanhas e leads estão saudáveis. Novos alertas aparecem aqui automaticamente.'
                : 'Ajuste o filtro para ver os demais alertas.'
            }
          />
        </Card>
      )}

      <div className="space-y-6 pb-2">
        {grouped.map(({ severity, items }) => {
          const meta = SEVERITY_META[severity]
          return (
            <section key={severity} aria-label={meta.label}>
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
                <span
                  className={`w-2 h-2 rounded-full ${meta.dot}`}
                  aria-hidden="true"
                />
                {meta.label} · {items.length}
              </h2>
              <div className="grid gap-2 lg:grid-cols-2">
                {items.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    read={isEffectivelyRead(alert)}
                    onMarkRead={() => markRead.mutate(alert)}
                    onOpen={() => openReference(alert)}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </PageFrame>
  )
}

/* ------------------------------------------------------------------ */
/* Subcomponentes                                                      */
/* ------------------------------------------------------------------ */

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'shrink-0 h-8 px-3 rounded-full text-xs font-medium border transition-colors',
        active
          ? 'bg-primary text-primary-fg border-primary'
          : 'bg-surface text-text-muted border-border hover:text-text',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

interface AlertCardProps {
  alert: DerivedAlert
  read: boolean
  onMarkRead: () => void
  onOpen: () => void
}

function AlertCard({ alert, read, onMarkRead, onOpen }: AlertCardProps) {
  const meta = SEVERITY_META[alert.severity]
  return (
    <Card
      className={read ? 'opacity-60' : ''}
      flush
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text leading-snug">
              {alert.title}
            </p>
            <p className="text-xs text-text-muted mt-1">{alert.message}</p>
          </div>
          {!read && (
            <span
              className="shrink-0 w-2 h-2 mt-1.5 rounded-full bg-primary"
              aria-label="Não lido"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          <Badge variant={meta.badge}>{TYPE_LABELS[alert.type]}</Badge>
          <span className="text-[11px] text-text-muted">
            {formatRelativeTime(alert.createdAt)}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-3">
          {!read && (
            <Button variant="secondary" size="sm" onClick={onMarkRead}>
              Marcar como lida
            </Button>
          )}
          {alert.refId && (
            <Button variant="ghost" size="sm" onClick={onOpen}>
              Ver detalhes
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
