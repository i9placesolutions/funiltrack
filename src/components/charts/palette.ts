/**
 * Paleta de cores dos gráficos, sincronizada com os tokens de tema
 * de `src/index.css` (espelhados aqui em hex porque o recharts aplica
 * cores como atributos SVG, onde `rgb(var(--…))` não resolve).
 */
import { useTheme } from '../../hooks/useTheme'

export interface ChartPalette {
  /** Texto secundário (rótulos de eixos). */
  axis: string
  /** Linhas de grade. */
  grid: string
  /** Superfície (fundo de tooltip). */
  surface: string
  /** Borda (tooltip). */
  border: string
  /** Texto principal (tooltip). */
  text: string
  /** Cor da série principal (custo). */
  primary: string
  /** Cor da série secundária (leads). */
  accent: string
}

const LIGHT: ChartPalette = {
  axis: '#526884',
  grid: '#BED2E8',
  surface: '#FFFFFF',
  border: '#BED2E8',
  text: '#081428',
  primary: '#0072FF',
  accent: '#10B981',
}

const DARK: ChartPalette = {
  axis: '#8296B2',
  grid: '#203048',
  surface: '#0A0E16',
  border: '#203048',
  text: '#ECF4FF',
  primary: '#00BFFF',
  accent: '#34D399',
}

/** Paleta ativa conforme o tema resolvido (claro/escuro). */
export function useChartPalette(): ChartPalette {
  const { resolvedTheme } = useTheme()
  return resolvedTheme === 'dark' ? DARK : LIGHT
}

/** Cores categóricas do donut — blues/cyan da identidade FunilTrack. */
export const DONUT_COLORS = [
  '#00BFFF',
  '#0072FF',
  '#34D399',
  '#38BDF8',
  '#FACC15',
  '#FB7185',
  '#60A5FA',
  '#22D3EE',
] as const
