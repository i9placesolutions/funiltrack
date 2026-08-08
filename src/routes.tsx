/**
 * Definição central de rotas (React Router).
 *
 * Convenção estável: cada rota aponta para o arquivo definitivo da feature
 * (ex.: features/dashboard/DashboardPage.tsx). As equipes substituem apenas o
 * conteúdo das pastas de feature — este arquivo não deve mudar de estrutura.
 */
import { lazy, Suspense, type ComponentType, type ReactElement } from 'react'
import { Navigate, Outlet, useRoutes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { Skeleton } from './components/ui/Skeleton'
import { useApp } from './hooks/useApp'

// Code-splitting por página.
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'))
const ExplorePage = lazy(() => import('./features/explore/ExplorePage'))
const CampaignDetailPage = lazy(
  () => import('./features/campaigns/CampaignDetailPage'),
)
const LeadsPage = lazy(() => import('./features/leads/LeadsPage'))
const LeadDetailPage = lazy(() => import('./features/leads/LeadDetailPage'))
const FunnelPage = lazy(() => import('./features/funnel/FunnelPage'))
const AlertsPage = lazy(() => import('./features/alerts/AlertsPage'))
const ConfigPage = lazy(() => import('./features/config/ConfigPage'))
const WhatsAppPage = lazy(() => import('./features/whatsapp/WhatsAppPage'))
const AuthPage = lazy(() => import('./features/auth/AuthPage'))
const OnboardingPage = lazy(
  () => import('./features/onboarding/OnboardingPage'),
)
const LegalPage = lazy(() => import('./features/legal/LegalPage'))

/** Fallback de carregamento (enquanto o chunk lazy baixa). */
function PageFallback() {
  return (
    <div className="px-4 pt-4 space-y-4" aria-busy="true">
      <Skeleton height="1.5rem" width="40%" />
      <Skeleton height="7rem" />
      <Skeleton height="7rem" />
      <Skeleton height="7rem" />
    </div>
  )
}

function withSuspense(Component: ComponentType): ReactElement {
  return (
    <Suspense fallback={<PageFallback />}>
      <Component />
    </Suspense>
  )
}

/**
 * Guarda de onboarding por empresa. A conclusão fica no PostgreSQL, portanto
 * trocar de workspace não reaproveita a configuração do cliente anterior.
 */
function RequireOnboarding() {
  const { activeCompany } = useApp()
  if (!activeCompany?.onboardingComplete) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

function RequireAuth() {
  const { authStatus } = useApp()
  if (authStatus === 'loading') {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-bg" aria-busy="true">
        <div className="h-8 w-8 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
      </div>
    )
  }
  if (authStatus === 'unauthenticated') return <Navigate to="/login" replace />
  return <Outlet />
}

export function AppRoutes() {
  return useRoutes([
    {
      element: <RequireAuth />,
      children: [
        {
          element: <RequireOnboarding />,
          children: [
            {
              element: <AppShell />,
              children: [
                { path: '/', element: withSuspense(DashboardPage) },
                { path: '/explorar', element: withSuspense(ExplorePage) },
                { path: '/campanhas/:id', element: withSuspense(CampaignDetailPage) },
                { path: '/leads', element: withSuspense(LeadsPage) },
                { path: '/leads/:id', element: withSuspense(LeadDetailPage) },
                { path: '/funil', element: withSuspense(FunnelPage) },
                { path: '/alertas', element: withSuspense(AlertsPage) },
                { path: '/config', element: withSuspense(ConfigPage) },
                { path: '/whatsapp', element: withSuspense(WhatsAppPage) },
              ],
            },
          ],
        },
        { path: '/onboarding', element: withSuspense(OnboardingPage) },
      ],
    },
    { path: '/login', element: withSuspense(AuthPage) },
    { path: '/register', element: withSuspense(AuthPage) },
    { path: '/privacidade', element: withSuspense(LegalPage) },
    { path: '/termos', element: withSuspense(LegalPage) },
    { path: '/exclusao-de-dados', element: withSuspense(LegalPage) },
    { path: '*', element: <Navigate to="/" replace /> },
  ])
}
