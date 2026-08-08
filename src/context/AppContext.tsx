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
import {
  completeCompanyOnboarding as completeCompanyOnboardingRequest,
  getActiveCompanyId,
  getCurrentSession,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
  setActiveCompanyId,
  type AuthSession,
  type AuthUser,
  type CompanySummary,
} from '../lib/api/authClient'

const IS_MOCK_MODE = (import.meta.env.VITE_USE_MOCKS ?? 'false') === 'true'

export type ThemeMode = 'light' | 'dark' | 'auto'
export type ResolvedTheme = 'light' | 'dark'

export interface AppPreferences {
  theme: ThemeMode
  onboardingSeen: boolean
  readAlertIds: string[]
}

export interface AppContextValue {
  authStatus: 'loading' | 'authenticated' | 'unauthenticated'
  user: AuthUser | null
  companies: CompanySummary[]
  activeCompany: CompanySummary | null
  login: (email: string, password: string) => Promise<AuthUser>
  register: (name: string, companyName: string, email: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  refreshAuth: () => Promise<AuthUser | null>
  selectCompany: (companyId: string) => void
  themeMode: ThemeMode
  resolvedTheme: ResolvedTheme
  setThemeMode: (mode: ThemeMode) => void
  onboardingSeen: boolean
  completeOnboarding: () => Promise<void>
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
  const [authStatus, setAuthStatus] = useState<AppContextValue['authStatus']>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [companies, setCompanies] = useState<CompanySummary[]>([])
  const [activeCompanyId, setActiveCompanyIdState] = useState<string | null>(null)

  const applySession = useCallback((session: AuthSession | null) => {
    if (!session) {
      setUser(null)
      setCompanies([])
      setActiveCompanyIdState(null)
      setActiveCompanyId(null)
      setAuthStatus('unauthenticated')
      return null
    }
    const storedCompanyId = getActiveCompanyId()
    const selectedCompanyId = session.companies.some((company) => company.id === storedCompanyId)
      ? storedCompanyId
      : session.activeCompanyId ?? session.companies[0]?.id ?? null
    setUser(session.user)
    setCompanies(session.companies)
    setActiveCompanyIdState(selectedCompanyId)
    setActiveCompanyId(selectedCompanyId)
    setAuthStatus('authenticated')
    return session.user
  }, [])

  const refreshAuth = useCallback(async () => {
    return applySession(await getCurrentSession())
  }, [applySession])

  useEffect(() => {
    if (IS_MOCK_MODE) {
      const demoUser: AuthUser = {
        id: 'demo-user',
        name: 'Workspace demo',
        email: 'demo@funiltrack.local',
        role: 'owner',
      }
      const demoCompany: CompanySummary = {
        id: 'company-demo',
        name: 'Workspace demo',
        slug: 'workspace-demo',
        role: 'owner',
        onboardingComplete: true,
      }
      setUser(demoUser)
      setCompanies([demoCompany])
      setActiveCompanyIdState(demoCompany.id)
      setActiveCompanyId(demoCompany.id)
      setAuthStatus('authenticated')
      return
    }
    void refreshAuth()
  }, [refreshAuth])

  const login = useCallback(async (email: string, password: string) => {
    if (IS_MOCK_MODE) {
      const demoUser: AuthUser = { id: 'demo-user', name: email.split('@')[0] || 'Workspace demo', email, role: 'owner' }
      setUser(demoUser)
      setCompanies([{ id: 'company-demo', name: 'Workspace demo', slug: 'workspace-demo', role: 'owner', onboardingComplete: true }])
      setActiveCompanyIdState('company-demo')
      setActiveCompanyId('company-demo')
      setAuthStatus('authenticated')
      return demoUser
    }
    const session = await loginRequest(email, password)
    return applySession(session) ?? session.user
  }, [applySession])

  const register = useCallback(async (name: string, companyName: string, email: string, password: string) => {
    if (IS_MOCK_MODE) {
      const demoUser: AuthUser = { id: 'demo-user', name, email, role: 'owner' }
      setUser(demoUser)
      setCompanies([{ id: 'company-demo', name: companyName, slug: 'workspace-demo', role: 'owner', onboardingComplete: false }])
      setActiveCompanyIdState('company-demo')
      setActiveCompanyId('company-demo')
      setAuthStatus('authenticated')
      return demoUser
    }
    const session = await registerRequest(name, companyName, email, password)
    return applySession(session) ?? session.user
  }, [applySession])

  const logout = useCallback(async () => {
    if (!IS_MOCK_MODE) await logoutRequest()
    applySession(null)
  }, [applySession])

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

  const selectCompany = useCallback((companyId: string) => {
    if (!companies.some((company) => company.id === companyId)) return
    setActiveCompanyId(companyId)
    setActiveCompanyIdState(companyId)
  }, [companies])

  const completeOnboarding = useCallback(async () => {
    if (!IS_MOCK_MODE) await completeCompanyOnboardingRequest()
    setCompanies((previous) => previous.map((company) => (
      company.id === activeCompanyId ? { ...company, onboardingComplete: true } : company
    )))
    setPrefs((prev) => ({ ...prev, onboardingSeen: true }))
  }, [activeCompanyId])

  const activeCompany = companies.find((company) => company.id === activeCompanyId) ?? null

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
      authStatus,
      user,
      companies,
      activeCompany,
      login,
      register,
      logout,
      refreshAuth,
      selectCompany,
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
      authStatus,
      user,
      companies,
      activeCompany,
      login,
      register,
      logout,
      refreshAuth,
      selectCompany,
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
