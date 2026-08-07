/**
 * Gráfico de linha: custo (R$) e leads por dia (recharts).
 *
 * Export default para carregamento lazy (code-split do chunk de gráficos):
 *   const TrendLineChart = lazy(() => import('@/components/charts/TrendLineChart'))
 */
import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  formatBRL,
  formatCompact,
  formatNumber,
  formatShortDate,
} from '../../lib/format'
import { useChartPalette } from './palette'

export interface TrendLineChartProps {
  /** Série diária; `spend` em centavos de BRL. */
  data: Array<{ date: string; spend: number; leads: number }>
  height?: number
}

interface TrendPointView {
  date: string
  /** Gasto em reais (convertido de centavos para o eixo). */
  spend: number
  leads: number
}

/** Props injetadas pelo recharts no tooltip customizado. */
interface TrendTooltipProps {
  active?: boolean
  label?: string | number
  payload?: ReadonlyArray<{
    dataKey?: string | number
    value?: number | string
    name?: string | number
    color?: string
  }>
}

function TrendTooltip({ active, label, payload }: TrendTooltipProps) {
  const palette = useChartPalette()
  if (!active || !payload || payload.length === 0) return null

  return (
    <div
      className="rounded-md border px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: palette.surface, borderColor: palette.border }}
    >
      {typeof label === 'string' && (
        <p className="font-semibold mb-1" style={{ color: palette.text }}>
          {formatShortDate(label)}
        </p>
      )}
      {payload.map((item) => (
        <p
          key={String(item.dataKey)}
          className="flex items-center gap-1.5"
          style={{ color: palette.text }}
        >
          <span
            aria-hidden="true"
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span style={{ color: palette.axis }}>{item.name}:</span>{' '}
          {item.dataKey === 'spend' && typeof item.value === 'number'
            ? formatBRL(Math.round(item.value * 100))
            : formatNumber(Number(item.value))}
        </p>
      ))}
    </div>
  )
}

/** Gráfico de linha custo × leads com eixos Y independentes. */
export default function TrendLineChart({
  data,
  height = 240,
}: TrendLineChartProps) {
  const palette = useChartPalette()

  const chartData = useMemo<TrendPointView[]>(
    () => data.map((point) => ({ ...point, spend: point.spend / 100 })),
    [data],
  )

  return (
    <div className="w-full" style={{ height }} aria-hidden="false">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={palette.grid}
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={(value: string) => formatShortDate(value)}
            tick={{ fontSize: 11, fill: palette.axis }}
            axisLine={{ stroke: palette.grid }}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            yAxisId="spend"
            tickFormatter={(value: number) => formatCompact(value)}
            tick={{ fontSize: 11, fill: palette.axis }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <YAxis
            yAxisId="leads"
            orientation="right"
            allowDecimals={false}
            tick={{ fontSize: 11, fill: palette.axis }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            content={<TrendTooltip />}
            cursor={{ stroke: palette.grid }}
          />
          <Line
            yAxisId="spend"
            type="monotone"
            dataKey="spend"
            name="Custo"
            stroke={palette.primary}
            strokeWidth={2.5}
            dot={false}
            activeDot={{
              r: 5,
              fill: palette.primary,
              stroke: palette.surface,
              strokeWidth: 2,
            }}
            style={{ filter: `drop-shadow(0 0 4px ${palette.primary})` }}
          />
          <Line
            yAxisId="leads"
            type="monotone"
            dataKey="leads"
            name="Leads"
            stroke={palette.accent}
            strokeWidth={2.5}
            dot={false}
            activeDot={{
              r: 5,
              fill: palette.accent,
              stroke: palette.surface,
              strokeWidth: 2,
            }}
            style={{ filter: `drop-shadow(0 0 4px ${palette.accent})` }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
