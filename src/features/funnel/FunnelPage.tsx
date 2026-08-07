/**
 * Funil de leads — kanban mobile-first com 5 colunas por estágio.
 *
 * - Drag-and-drop com @dnd-kit/core (alça de arraste em cada card).
 * - Fallback obrigatório de acessibilidade/toque: botão "Mover para…"
 *   abre uma bottom sheet com os estágios disponíveis.
 * - Mutação via `updateLeadStage` com optimistic update no TanStack Query:
 *   onMutate aplica, onError reverte, onSettled invalida.
 */
import { useMemo, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import { api, LeadStage, type Lead, type Paginated } from '../../lib/api'
import { queryKeys } from '../../lib/query/keys'
import { formatBRL, formatPercent } from '../../lib/format'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'

/** Ordem das colunas no board. */
const STAGES: LeadStage[] = [
  LeadStage.NOVO,
  LeadStage.CONTATO,
  LeadStage.QUALIFICADO,
  LeadStage.VENDIDO,
  LeadStage.PERDIDO,
]

const STAGE_LABELS: Record<LeadStage, string> = {
  [LeadStage.NOVO]: 'Novo',
  [LeadStage.CONTATO]: 'Contato',
  [LeadStage.QUALIFICADO]: 'Qualificado',
  [LeadStage.VENDIDO]: 'Vendido',
  [LeadStage.PERDIDO]: 'Perdido',
}

/** Cor do indicador de cada coluna (tokens do design system). */
const STAGE_DOT: Record<LeadStage, string> = {
  [LeadStage.NOVO]: 'bg-primary shadow-[0_0_8px_rgb(var(--color-primary)/0.7)]',
  [LeadStage.CONTATO]: 'bg-warning shadow-[0_0_8px_rgb(var(--color-warning)/0.6)]',
  [LeadStage.QUALIFICADO]: 'bg-primary-2 shadow-[0_0_8px_rgb(var(--color-primary-2)/0.7)]',
  [LeadStage.VENDIDO]: 'bg-accent shadow-[0_0_8px_rgb(var(--color-accent)/0.7)]',
  [LeadStage.PERDIDO]: 'bg-danger shadow-[0_0_8px_rgb(var(--color-danger)/0.6)]',
}

/** Parâmetros fixos da query do board (precisa de todos os leads). */
const BOARD_LEADS_PARAMS = { pageSize: 500 }

interface MoveVars {
  id: string
  stage: LeadStage
}

/** Aplica a mudança de estágio em qualquer formato de cache de leads. */
function applyStageToCache(
  data: Paginated<Lead> | Lead | undefined,
  leadId: string,
  stage: LeadStage,
): Paginated<Lead> | Lead | undefined {
  if (!data) return data
  if ('items' in data) {
    return {
      ...data,
      items: data.items.map((lead) =>
        lead.id === leadId ? { ...lead, stage } : lead,
      ),
    }
  }
  return data.id === leadId ? { ...data, stage } : data
}

export default function FunnelPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [moveSheetLead, setMoveSheetLead] = useState<Lead | null>(null)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: queryKeys.leads.list(BOARD_LEADS_PARAMS),
    queryFn: () => api.getLeads(BOARD_LEADS_PARAMS),
  })

  const leads = useMemo(() => data?.items ?? [], [data])

  const leadsByStage = useMemo(() => {
    const grouped = new Map<LeadStage, Lead[]>(
      STAGES.map((stage) => [stage, []]),
    )
    for (const lead of leads) grouped.get(lead.stage)?.push(lead)
    return grouped
  }, [leads])

  const sensors = useSensors(
    // Distância mínima evita que toques simples (botões) virem arraste.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const moveLead = useMutation({
    mutationFn: ({ id, stage }: MoveVars) => api.updateLeadStage(id, stage),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.leads.all })
      const snapshot = queryClient.getQueriesData<
        Paginated<Lead> | Lead
      >({ queryKey: queryKeys.leads.all })
      queryClient.setQueriesData(
        { queryKey: queryKeys.leads.all },
        (old: Paginated<Lead> | Lead | undefined) =>
          applyStageToCache(old, vars.id, vars.stage),
      )
      return { snapshot }
    },
    onError: (_error, _vars, context) => {
      // Reverte todos os caches ao estado anterior.
      context?.snapshot.forEach(([key, value]) => {
        queryClient.setQueryData(key as QueryKey, value)
      })
      toast('Não foi possível mover o lead. Tente novamente.', 'danger')
    },
    onSuccess: (_lead, vars) => {
      toast(`Lead movido para "${STAGE_LABELS[vars.stage]}".`, 'success')
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.leads.all })
    },
  })

  const moveTo = (leadId: string, stage: LeadStage) => {
    moveLead.mutate({ id: leadId, stage })
    setMoveSheetLead(null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const targetStage = over.id as LeadStage
    if (!STAGES.includes(targetStage)) return
    const lead = leads.find((l) => l.id === String(active.id))
    if (!lead || lead.stage === targetStage) return
    moveLead.mutate({ id: lead.id, stage: targetStage })
  }

  // KPIs do topo.
  const kpi = useMemo(() => {
    const count = (stage: LeadStage) => leadsByStage.get(stage)?.length ?? 0
    const qualificado = count(LeadStage.QUALIFICADO)
    const vendido = count(LeadStage.VENDIDO)
    const denominator = qualificado + vendido
    const pipelineValue = leads
      .filter(
        (lead) =>
          lead.stage === LeadStage.NOVO ||
          lead.stage === LeadStage.CONTATO ||
          lead.stage === LeadStage.QUALIFICADO,
      )
      .reduce((sum, lead) => sum + lead.value, 0)
    return {
      total: leads.length,
      conversion: denominator > 0 ? vendido / denominator : null,
      pipelineValue,
    }
  }, [leads, leadsByStage])

  return (
    <div className="pt-4 lg:pt-8">
      <div className="px-4 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between mb-4 lg:mb-6">
          <div>
            <h1 className="font-display text-2xl lg:text-3xl font-extrabold tracking-tight text-text">
              Funil de vendas
            </h1>
            <p className="text-sm text-text-muted mt-1">
              Arraste os cards ou use &quot;Mover&quot; para atualizar o estágio.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 lg:gap-3 lg:min-w-[420px]">
            <KpiCard label="Leads" value={String(kpi.total)} />
            <KpiCard
              label="Qualif. → Vendido"
              value={kpi.conversion === null ? '—' : formatPercent(kpi.conversion)}
            />
            <KpiCard label="Valor em funil" value={formatBRL(kpi.pipelineValue)} />
          </div>
        </div>
      </div>

      {isPending && <BoardSkeleton />}

      {isError && (
        <div className="px-4 lg:px-8">
          <EmptyState
            icon="⚠️"
            title="Não foi possível carregar o funil"
            action={
              <Button variant="secondary" size="sm" onClick={() => void refetch()}>
                Tentar novamente
              </Button>
            }
          />
        </div>
      )}

      {!isPending && !isError && leads.length === 0 && (
        <div className="px-4 lg:px-8">
          <EmptyState
            icon="🫙"
            title="Nenhum lead no funil"
            description="Quando suas campanhas gerarem leads, eles aparecem aqui por estágio."
          />
        </div>
      )}

      {!isPending && !isError && leads.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={rectIntersection}
          onDragEnd={handleDragEnd}
        >
          <div
            className="flex gap-3 overflow-x-auto px-4 pb-4 snap-x snap-mandatory lg:px-8 lg:pb-8 lg:overflow-x-visible lg:grid lg:grid-cols-5 lg:gap-3"
            role="list"
            aria-label="Colunas do funil"
          >
            {STAGES.map((stage) => (
              <FunnelColumn
                key={stage}
                stage={stage}
                leads={leadsByStage.get(stage) ?? []}
                onMoveRequest={setMoveSheetLead}
              />
            ))}
          </div>
        </DndContext>
      )}

      {/* Fallback de drag-and-drop: bottom sheet "Mover para…" */}
      <Modal
        open={moveSheetLead !== null}
        onClose={() => setMoveSheetLead(null)}
        title={
          moveSheetLead ? `Mover ${moveSheetLead.name} para…` : 'Mover lead'
        }
      >
        <div className="grid gap-2">
          {moveSheetLead &&
            STAGES.filter((stage) => stage !== moveSheetLead.stage).map(
              (stage) => (
                <Button
                  key={stage}
                  variant="secondary"
                  onClick={() => moveTo(moveSheetLead.id, stage)}
                >
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${STAGE_DOT[stage]}`}
                    aria-hidden="true"
                  />
                  {STAGE_LABELS[stage]}
                </Button>
              ),
            )}
        </div>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Subcomponentes                                                      */
/* ------------------------------------------------------------------ */

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="gradient-hairline bg-surface border border-border/80 rounded-xl px-3 py-2.5 shadow-[var(--shadow-card)]">
      <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted leading-tight">
        {label}
      </p>
      <p className="font-display text-sm font-bold text-text mt-0.5 truncate tabular-nums">{value}</p>
    </div>
  )
}

interface FunnelColumnProps {
  stage: LeadStage
  leads: Lead[]
  onMoveRequest: (lead: Lead) => void
}

function FunnelColumn({ stage, leads, onMoveRequest }: FunnelColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  const totalValue = leads.reduce((sum, lead) => sum + lead.value, 0)

  return (
    <section
      ref={setNodeRef}
      role="listitem"
      aria-label={`Coluna ${STAGE_LABELS[stage]}`}
      className={[
        'snap-start shrink-0 w-[82vw] max-w-xs flex flex-col',
        'lg:w-auto lg:max-w-none lg:min-w-0 lg:shrink lg:min-h-[min(70vh,720px)]',
        'bg-surface-2/60 border rounded-xl transition-colors',
        isOver ? 'border-primary bg-primary/10' : 'border-border/80',
      ].join(' ')}
    >
      <header className="px-3 py-2.5 border-b border-border/70">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${STAGE_DOT[stage]}`}
            aria-hidden="true"
          />
          <h2 className="font-display text-sm font-semibold text-text">
            {STAGE_LABELS[stage]}
          </h2>
          <Badge variant="neutral">{leads.length}</Badge>
        </div>
        <p className="text-[11px] text-text-muted mt-1">
          Total: {formatBRL(totalValue)}
        </p>
      </header>

      <div className="flex flex-col gap-2 p-2 min-h-24 lg:flex-1 lg:overflow-y-auto">
        {leads.length === 0 && (
          <p className="text-[11px] text-text-muted text-center py-6">
            Solte um lead aqui
          </p>
        )}
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} onMoveRequest={onMoveRequest} />
        ))}
      </div>
    </section>
  )
}

interface LeadCardProps {
  lead: Lead
  onMoveRequest: (lead: Lead) => void
}

function LeadCard({ lead, onMoveRequest }: LeadCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: lead.id })

  const style = transform
    ? {
        transform: `translate(${Math.round(transform.x)}px, ${Math.round(
          transform.y,
        )}px)`,
      }
    : undefined

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={[
        'bg-surface border border-border/80 rounded-lg p-3 shadow-[var(--shadow-card)]',
        isDragging ? 'opacity-95 shadow-lg ring-2 ring-primary z-50' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-text leading-tight">
          {lead.name}
        </p>
        {/* Alça de arraste (mantém o toque simples livre para rolagem) */}
        <button
          type="button"
          {...listeners}
          {...attributes}
          aria-label={`Arrastar ${lead.name}`}
          className="shrink-0 -m-1 p-1 text-text-muted hover:text-text cursor-grab active:cursor-grabbing touch-none"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <Badge variant="neutral">{lead.utmSource}</Badge>
        {lead.value > 0 && (
          <Badge variant="primary">{formatBRL(lead.value)}</Badge>
        )}
      </div>

      <button
        type="button"
        onClick={() => onMoveRequest(lead)}
        className="mt-2.5 w-full h-8 rounded-lg border border-border/80 text-xs font-medium text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
      >
        Mover para…
      </button>
    </article>
  )
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-hidden px-4 lg:px-8 pb-4 lg:grid lg:grid-cols-5" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="shrink-0 w-[82vw] max-w-xs lg:w-auto lg:max-w-none space-y-2 rounded-lg border border-border p-3"
        >
          <Skeleton height="1.25rem" width="60%" />
          <Skeleton height="4.5rem" />
          <Skeleton height="4.5rem" />
        </div>
      ))}
    </div>
  )
}
