import { useApp } from './useApp'
import type { ResolvedTheme, ThemeMode } from '../context/AppContext'

export interface UseThemeResult {
  /** Preferência salva: light | dark | auto. */
  themeMode: ThemeMode
  /** Tema efetivamente aplicado no <html data-theme>. */
  resolvedTheme: ResolvedTheme
  setThemeMode: (mode: ThemeMode) => void
  /** Alterna claro ↔ escuro mantendo a preferência explícita. */
  toggleTheme: () => void
}

/**
 * Hook de tema. Persistência em localStorage e aplicação sem FOUC ficam por
 * conta do AppProvider + script inline do index.html.
 */
export function useTheme(): UseThemeResult {
  const { themeMode, resolvedTheme, setThemeMode } = useApp()

  const toggleTheme = () => {
    setThemeMode(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  return { themeMode, resolvedTheme, setThemeMode, toggleTheme }
}
