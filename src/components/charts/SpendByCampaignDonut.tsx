/**
 * Gráfico donut: distribuição de gasto por campanha (recharts).
 *
 * Export default para carregamento lazy (code-split do chunk de gráficos):
 *   const SpendByCampaignDonut = lazy(() => import('@/components/charts/SpendByCampaignDonut'))
 */
import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { formatBRL, formatPercent } from '../../lib/format'
import { DONUT_COLORS, useChartPalette } from './palette'

export interface SpendSliceInput {
  id: string
  name: string
  /** Gasto no período (centavos de BRL). */
  spend: number
}

export interface SpendByCampaignDonutProps {
  data: SpendSliceInput[]
  height?: number
}

/** Props injetadas pelo recharts no tooltip customizado. */
interface DonutTooltipProps {
  active?: boolean
  payload?: ReadonlyArray<{
    name?: string | number
    value?: number | string
    payload?: { percent?: number }
  }>
}

function DonutTooltip({ active, payload }: DonutTooltipProps) {
  const palette = useChartPalette()
  if (!active || !payload || payload.length === 0) return null
  const item = payload[0]
  if (!item || typeof item.value !== 'number') return null

  return (
    <div
      className="rounded-md border px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: palette.surface, borderColor: palette.border }}
    >
      <p className="font-semibold" style={{ color: palette.text }}>
        {item.name}
      </p>
      <p style={{ color: palette.axis }}>
        {formatBRL(item.value)}
        {typeof item.payload?.percent === 'number' &&
          ` · ${formatPercent(item.payload.percent)}`}
      </p>
    </div>
  )
}

/** Donut de gasto por campanha com total no centro e legenda própria. */
export default function SpendByCampaignDonut({
  data,
  height = 200,
}: SpendByCampaignDonutProps) {
  const total = useMemo(
    () => data.reduce((sum, slice) => sum + slice.spend, 0),
    [data],
  )

  return (
    <div>
      <div className="relative w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<DonutTooltip />} />
            <Pie
              data={data}
              dataKey="spend"
              nameKey="name"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((slice, index) => (
                <Cell
                  key={slice.id}
                  fill={DONUT_COLORS[index % DONUT_COLORS.length]}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* Total no centro do donut */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            Total
          </span>
          <span className="font-display text-sm font-bold text-text tabular-nums">
            {formatBRL(total)}
          </span>
        </div>
      </div>

      {/* Legenda com valor e participação */}
      <ul className="mt-3 space-y-1.5">
        {data.map((slice, index) => (
          <li key={slice.id} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{
                backgroundColor: DONUT_COLORS[index % DONUT_COLORS.length],
              }}
            />
            <span className="flex-1 truncate text-text">{slice.name}</span>
            <span className="text-text-muted shrink-0">
              {formatBRL(slice.spend)}
            </span>
            <span className="text-text-muted w-11 text-right shrink-0">
              {total > 0 ? formatPercent(slice.spend / total) : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
