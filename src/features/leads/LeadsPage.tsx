/**
 * Lista de leads virtualizada (@tanstack/react-virtual) com paginação
 * infinita via useInfiniteQuery sobre a fachada de API.
 *
 * Filtros: busca por nome/telefone (debounce), campanha e origem UTM.
 * Aceita deep-links via query string: /leads?campanha=<id>&origem=<utm_source>
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { api, type GetLeadsParams } from '../../lib/api'
import { queryKeys } from '../../lib/query/keys'
import { staleTimes } from '../../lib/query/queryClient'
import { formatNumber, formatRelativeTime } from '../../lib/format'
import { PageFrame } from '../../components/layout/PageFrame'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Input'
import { Skeleton } from '../../components/ui/Skeleton'
import { ErrorState } from '../_shared/ErrorState'
import { STAGE_LABELS, STAGE_VARIANTS } from '../_shared/labels'

const PAGE_SIZE = 20
const ROW_ESTIMATE_PX = 76

/** Valor com debounce (busca enquanto digita sem martelar a API). */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

const selectClasses = [
  'h-11 px-3 rounded-lg bg-surface text-text text-sm border border-border',
  'outline-none transition-all focus:ring-2 focus:ring-primary/50 focus:border-primary',
].join(' ')

export default function LeadsPage() {
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 300)
  const [campaignId, setCampaignId] = useState(
    () => searchParams.get('campanha') ?? '',
  )
  const [utmSource, setUtmSource] = useState(
    () => searchParams.get('origem') ?? '',
  )

  const campaignsQuery = useQuery({
    queryKey: queryKeys.campaigns.all,
    queryFn: api.getCampaigns,
    staleTime: staleTimes.campaigns,
  })

  const listParams = useMemo<GetLeadsParams>(
    () => ({
      pageSize: PAGE_SIZE,
      search: debouncedSearch.trim() || undefined,
      campaignId: campaignId || undefined,
      utmSource: utmSource || undefined,
    }),
    [debouncedSearch, campaignId, utmSource],
  )

  const leadsQuery = useInfiniteQuery({
    queryKey: queryKeys.leads.list(listParams),
    queryFn: ({ pageParam }) =>
      api.getLeads({ ...listParams, page: Number(pageParam) }),
    initialPageParam: '1',
    // Usa o cursor retornado pela fachada em vez de contar páginas.
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: staleTimes.dynamic,
  })

  const leads = useMemo(
    () => leadsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [leadsQuery.data],
  )
  const total = leadsQuery.data?.pages[0]?.total ?? 0

  // Origens derivadas do dataset COMPLETO (não da página carregada) —
  // o filtro não pode perder opções quando a lista é paginada/filtrada.
  const sourcesQuery = useQuery({
    queryKey: queryKeys.leads.sources,
    queryFn: api.getLeadSources,
    staleTime: staleTimes.campaigns,
  })
  const sources = useMemo(() => {
    const list = sourcesQuery.data ?? []
    return utmSource && !list.includes(utmSource)
      ? [...list, utmSource].sort()
      : list
  }, [sourcesQuery.data, utmSource])

  /* ---------- Virtualização (scroll da janela) ---------- */
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  useEffect(() => {
    // Distância do início da lista até o topo do documento (offset da sticky bar).
    if (listRef.current) setScrollMargin(listRef.current.offsetTop)
  }, [])

  const rowVirtualizer = useWindowVirtualizer({
    count: leads.length,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 10,
    scrollMargin,
  })

  // Carrega a próxima página quando o fim da lista renderizada se aproxima.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = leadsQuery
  const virtualItems = rowVirtualizer.getVirtualItems()
  const lastRenderedIndex = virtualItems[virtualItems.length - 1]?.index ?? -1
  useEffect(() => {
    if (
      lastRenderedIndex >= 0 &&
      lastRenderedIndex >= leads.length - 5 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      void fetchNextPage()
    }
  }, [lastRenderedIndex, leads.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  const hasFilters = Boolean(search || campaignId || utmSource)
  const clearFilters = () => {
    setSearch('')
    setCampaignId('')
    setUtmSource('')
  }

  const campaigns = campaignsQuery.data ?? []

  return (
    <PageFrame width="wide" className="!pt-0 lg:!pt-0">
      <header className="pt-4 lg:pt-8 pb-3 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-extrabold tracking-tight text-text">
            Leads
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Base de contatos gerados pelas campanhas
          </p>
        </div>
        {total > 0 && (
          <span className="text-sm text-text-muted tabular-nums shrink-0">
            {formatNumber(total)} leads
          </span>
        )}
      </header>

      {/* Barra de busca/filtros — sticky abaixo da topbar */}
      <div className="sticky top-14 lg:top-14 z-30 -mx-4 px-4 lg:-mx-8 lg:px-8 py-3 space-y-2 lg:space-y-0 lg:flex lg:items-center lg:gap-3 border-b border-border/70 bg-bg/90 backdrop-blur-md">
        <div className="flex-1 min-w-0">
          <Input
            type="search"
            placeholder="Buscar por nome ou telefone"
            aria-label="Buscar leads por nome ou telefone"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 lg:flex lg:w-auto lg:shrink-0">
          <select
            aria-label="Filtrar por campanha"
            className={`${selectClasses} lg:min-w-[220px]`}
            value={campaignId}
            onChange={(event) => setCampaignId(event.target.value)}
          >
            <option value="">Todas as campanhas</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
            {campaignId &&
              !campaigns.some((campaign) => campaign.id === campaignId) && (
                <option value={campaignId}>{campaignId}</option>
              )}
          </select>
          <select
            aria-label="Filtrar por origem"
            className={`${selectClasses} lg:min-w-[180px]`}
            value={utmSource}
            onChange={(event) => setUtmSource(event.target.value)}
          >
            <option value="">Todas as origens</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Cabeçalho de tabela (desktop) */}
      <div className="hidden lg:grid grid-cols-[minmax(0,1.4fr)_140px_140px_160px] gap-4 px-1 py-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        <span>Lead</span>
        <span>Origem</span>
        <span>Estágio</span>
        <span className="text-right">Última atividade</span>
      </div>

      <div ref={listRef} className="neon-panel rounded-xl overflow-hidden">
        {leadsQuery.isPending ? (
          <div className="px-4 py-3 space-y-2" aria-busy="true">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} height="4.5rem" />
            ))}
          </div>
        ) : leadsQuery.isError ? (
          <div className="p-4">
            <ErrorState onRetry={() => void leadsQuery.refetch()} />
          </div>
        ) : leads.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="Nenhum lead encontrado"
            description="Ajuste a busca ou os filtros para ver resultados."
            action={
              hasFilters ? (
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div
              style={{
                height: rowVirtualizer.getTotalSize(),
                position: 'relative',
              }}
            >
              {virtualItems.map((virtualItem) => {
                const lead = leads[virtualItem.index]
                if (!lead) return null
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start - scrollMargin}px)`,
                    }}
                  >
                    <Link
                      to={`/leads/${lead.id}`}
                      className="flex items-center gap-3 px-4 py-3 min-h-[76px] border-b border-border/80 hover:bg-surface-2/60 active:bg-surface-2 transition-colors lg:grid lg:grid-cols-[minmax(0,1.4fr)_140px_140px_160px] lg:gap-4 lg:min-h-0 lg:py-3.5"
                    >
                      <div className="flex-1 min-w-0 lg:flex-none">
                        <p className="text-sm font-medium text-text truncate">
                          {lead.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1 lg:hidden">
                          <Badge variant="primary">{lead.utmSource}</Badge>
                          <Badge variant={STAGE_VARIANTS[lead.stage]}>
                            {STAGE_LABELS[lead.stage]}
                          </Badge>
                        </div>
                      </div>
                      <div className="hidden lg:flex items-center">
                        <Badge variant="primary">{lead.utmSource}</Badge>
                      </div>
                      <div className="hidden lg:flex items-center">
                        <Badge variant={STAGE_VARIANTS[lead.stage]}>
                          {STAGE_LABELS[lead.stage]}
                        </Badge>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[11px] lg:text-sm text-text-muted">
                          {formatRelativeTime(
                            lead.lastMessageAt ?? lead.createdAt,
                          )}
                        </p>
                        <p className="text-text-muted mt-1 lg:hidden" aria-hidden="true">
                          ›
                        </p>
                      </div>
                    </Link>
                  </div>
                )
              })}
            </div>

            {isFetchingNextPage && (
              <div className="px-4 py-3 space-y-2" aria-busy="true">
                <Skeleton height="4rem" />
                <Skeleton height="4rem" />
              </div>
            )}
            {!hasNextPage && leads.length > 0 && (
              <p className="text-center text-xs text-text-muted py-4">
                Todos os {formatNumber(total)} leads carregados
              </p>
            )}
          </>
        )}
      </div>
    </PageFrame>
  )
}
