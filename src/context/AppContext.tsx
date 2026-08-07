/**
 * Estado global mínimo do FunilTrack (preferências persistidas em localStorage):
 * - tema (light | dark | auto)
 * - onboarding visto
 * - alertas lidos (cache local para badge da bottom nav)
 *
 * O atributo `data-theme` no <html> também é aplicado por script inline no
 * index.html antes do paint; este provider mantém tudo sincronizado depois.
 */
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ThemeMode = 'light' | 'dark' | 'auto'
export type ResolvedTheme = 'light' | 'dark'

export interface AppPreferences {
  theme: ThemeMode
  onboardingSeen: boolean
  readAlertIds: string[]
}

export interface AppContextValue {
  themeMode: ThemeMode
  resolvedTheme: ResolvedTheme
  setThemeMode: (mode: ThemeMode) => void
  onboardingSeen: boolean
  completeOnboarding: () => void
  readAlertIds: string[]
  markAlertRead: (id: string) => void
  /** Esvazia a marcação local de alertas lidos (usado no reset demo). */
  clearReadAlerts: () => void
}

const PREFS_KEY = 'funiltrack:preferences'
const LEGACY_PREFS_KEY = 'metatrack:preferences'
// Chave simples lida pelo script inline do index.html (antes do paint).
const THEME_KEY = 'funiltrack:theme'
const LEGACY_THEME_KEY = 'metatrack:theme'
// Teto de ids de alertas lidos mantidos em memória/storage (poda os mais
// antigos) — evita crescimento indefinido do registro de preferências.
const MAX_READ_ALERT_IDS = 500

/** Poda a lista mantendo apenas strings e limitando o tamanho. */
function sanitizeReadAlertIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value.filter((id): id is string => typeof id === 'string')
  return ids.length > MAX_READ_ALERT_IDS
    ? ids.slice(ids.length - MAX_READ_ALERT_IDS)
    : ids
}

export const AppContext = createContext<AppContextValue | null>(null)

function loadPreferences(): AppPreferences {
  const defaults: AppPreferences = {
    // "auto" respeita prefers-color-scheme do sistema.
    theme: 'auto',
    // Primeira visita passa pelo onboarding.
    onboardingSeen: false,
    readAlertIds: [],
  }
  try {
    const raw =
      localStorage.getItem(PREFS_KEY) ?? localStorage.getItem(LEGACY_PREFS_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<AppPreferences>
    return {
      theme:
        parsed.theme === 'light' || parsed.theme === 'dark'
          ? parsed.theme
          : defaults.theme,
      onboardingSeen: Boolean(parsed.onboardingSeen),
      // Storage pode conter lixo (números, null…) — só strings sobrevivem.
      readAlertIds: sanitizeReadAlertIds(parsed.readAlertIds),
    }
  } catch {
    return defaults
  }
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }
  return mode
}

function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode)
  const root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.themeMode = mode
  try {
    localStorage.setItem(THEME_KEY, mode === 'auto' ? 'auto' : mode)
    localStorage.removeItem(LEGACY_THEME_KEY)
  } catch {
    // Storage indisponível — tema segue apenas em memória.
  }
  return resolved
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<AppPreferences>(loadPreferences)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(prefs.theme),
  )

  // Persiste preferências sempre que mudam.
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      // Modo privado / storage cheio — ignora silenciosamente.
    }
  }, [prefs])

  // Aplica o tema e acompanha mudanças do sistema no modo "auto".
  useEffect(() => {
    setResolvedTheme(applyTheme(prefs.theme))
    if (prefs.theme !== 'auto') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolvedTheme(applyTheme('auto'))
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [prefs.theme])

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setPrefs((prev) => ({ ...prev, theme: mode }))
  }, [])

  const completeOnboarding = useCallback(() => {
    setPrefs((prev) => ({ ...prev, onboardingSeen: true }))
  }, [])

  const markAlertRead = useCallback((id: string) => {
    setPrefs((prev) => {
      if (prev.readAlertIds.includes(id)) return prev
      const next = [...prev.readAlertIds, id]
      // Mantém o teto: descarta os ids mais antigos.
      return {
        ...prev,
        readAlertIds:
          next.length > MAX_READ_ALERT_IDS
            ? next.slice(next.length - MAX_READ_ALERT_IDS)
            : next,
      }
    })
  }, [])

  const clearReadAlerts = useCallback(() => {
    setPrefs((prev) =>
      prev.readAlertIds.length === 0
        ? prev
        : { ...prev, readAlertIds: [] },
    )
  }, [])

  const value = useMemo<AppContextValue>(
    () => ({
      themeMode: prefs.theme,
      resolvedTheme,
      setThemeMode,
      onboardingSeen: prefs.onboardingSeen,
      completeOnboarding,
      readAlertIds: prefs.readAlertIds,
      markAlertRead,
      clearReadAlerts,
    }),
    [
      prefs.theme,
      prefs.onboardingSeen,
      prefs.readAlertIds,
      resolvedTheme,
      setThemeMode,
      completeOnboarding,
      markAlertRead,
      clearReadAlerts,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
