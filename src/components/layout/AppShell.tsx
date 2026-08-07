/**
 * Shell responsivo:
 * - Mobile: TopBar + conteúdo + bottom navigation
 * - Desktop (lg+): sidebar fixa + área de trabalho larga (console web)
 */
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { BrandLogo } from '../brand/BrandLogo'
import { useUnreadAlertCount } from '../../features/alerts/useAlerts'
import { useTheme } from '../../hooks/useTheme'
import { useApp } from '../../hooks/useApp'

interface NavItem {
  to: string
  label: string
  icon: (active: boolean) => ReactNode
  /** Exige NavLink com `end` (rota raiz). */
  end?: boolean
}

function icon(path: string) {
  return (active: boolean) => (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5 lg:w-[18px] lg:h-[18px]"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  )
}

const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    end: true,
    icon: icon('M3 3h8v10H3zM13 3h8v6h-8zM13 11h8v10h-8zM3 15h8v6H3z'),
  },
  {
    to: '/leads',
    label: 'Leads',
    icon: icon(
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    ),
  },
  {
    to: '/explorar',
    label: 'Explorar',
    icon: icon(
      'M12 3a9 9 0 1 0 9 9M12 3a9 9 0 0 1 9 9M12 3l-2.5 8.5L12 14l2.5-2.5L12 3z',
    ),
  },
  {
    to: '/funil',
    label: 'Funil',
    icon: icon('M3 4h18l-7 8v6l-4 2v-8L3 4z'),
  },
  {
    to: '/alertas',
    label: 'Alertas',
    icon: icon(
      'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
    ),
  },
  {
    to: '/whatsapp',
    label: 'WhatsApp',
    icon: icon('M20 11.5a8 8 0 0 1-11.86 7L4 20l1.5-4.14A8 8 0 1 1 20 11.5zM8.5 9.5c.3 2.1 2 3.8 4 4.1l1.2-1.2 1.5.7c.2.1.3.4.2.6-.3.8-1.1 1.3-2 1.1-3.7-.7-5.5-2.5-6.2-5.5-.2-.9.3-1.7 1.1-2 .2-.1.5 0 .6.2l.7 1.5-1.1.5z'),
  },
  {
    to: '/config',
    label: 'Configurações',
    icon: icon(
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    ),
  },
]

function BrandMark({ compact = false }: { compact?: boolean }) {
  return compact ? (
    <BrandLogo variant="mark" size={36} />
  ) : (
    <BrandLogo variant="wordmark" size={40} className="max-w-[220px]" />
  )
}

function ThemeToggleButton() {
  const { resolvedTheme, toggleTheme } = useTheme()
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={
        resolvedTheme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'
      }
      className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 border border-transparent hover:border-primary/30 transition-all"
    >
      {resolvedTheme === 'dark' ? (
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  )
}

function DesktopNavLink({ item, unreadAlerts }: { item: NavItem; unreadAlerts: number }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        [
          'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
          isActive
            ? 'bg-primary/12 text-primary shadow-[inset_0_0_0_1px_rgb(var(--color-primary)/0.25)]'
            : 'text-text-muted hover:text-text hover:bg-surface-2/80',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              className="absolute left-0 inset-y-2 w-0.5 rounded-full bg-gradient-to-b from-primary to-primary-2 shadow-[0_0_8px_rgb(var(--color-primary)/0.7)]"
              aria-hidden="true"
            />
          )}
          <span className={isActive ? 'text-primary' : 'text-text-muted group-hover:text-text'}>
            {item.icon(isActive)}
          </span>
          <span className="flex-1 truncate">{item.label}</span>
          {item.to === '/alertas' && unreadAlerts > 0 && (
            <span
              className="min-w-5 h-5 px-1.5 rounded-md bg-danger text-white text-[11px] font-bold flex items-center justify-center shadow-[0_0_12px_rgb(var(--color-danger)/0.55)]"
              aria-label={`${unreadAlerts} alertas não lidos`}
            >
              {unreadAlerts > 99 ? '99+' : unreadAlerts}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

export function AppShell() {
  const unreadAlerts = useUnreadAlertCount()
  const navigate = useNavigate()
  const { user, logout } = useApp()

  const signOut = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-dvh flex bg-bg">
      {/* Sidebar desktop */}
      <aside
        className="hidden lg:flex w-[260px] shrink-0 flex-col border-r border-border/70 glass sticky top-0 h-dvh"
        aria-label="Navegação principal"
      >
        <div className="px-5 py-5 border-b border-border/60">
          <BrandMark />
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
            Menu
          </p>
          {NAV_ITEMS.map((item) => (
            <DesktopNavLink key={item.to} item={item} unreadAlerts={unreadAlerts} />
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-border/60 flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-text truncate">{user?.name ?? 'Workspace'}</p>
            <p className="text-[11px] text-text-muted truncate">{user?.email ?? 'Ads + WhatsApp'}</p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggleButton />
            <button type="button" onClick={() => void signOut()} className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/10" aria-label="Sair">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M21 4v16" /></svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Coluna principal */}
      <div className="flex-1 flex flex-col min-w-0 min-h-dvh">
        {/* TopBar mobile */}
        <header className="lg:hidden sticky top-0 z-40 glass border-b border-border/60 safe-top">
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" aria-hidden="true" />
          <div className="flex items-center justify-between h-14 px-4">
            <BrandMark compact />
            <div className="flex items-center gap-1">
              <ThemeToggleButton />
              <button type="button" onClick={() => void signOut()} className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/10" aria-label="Sair">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M21 4v16" /></svg>
              </button>
            </div>
          </div>
        </header>

        {/* TopBar desktop (toolbar de console) */}
        <header className="hidden lg:flex sticky top-0 z-40 h-14 items-center justify-between gap-4 px-8 glass border-b border-border/60">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">Central de mídia</p>
            <p className="text-[11px] text-text-muted">
              Campanhas, leads e alertas em tempo real
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-accent/30 bg-accent/10 text-[11px] font-semibold text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-glow neon-dot" />
              Dados sincronizados
            </span>
          </div>
        </header>

        {/* Conteúdo */}
        <main className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
          <Outlet />
        </main>

        {/* Bottom nav mobile */}
        <nav
          className="lg:hidden fixed inset-x-0 bottom-0 z-40 glass border-t border-border/60 safe-bottom"
          aria-label="Navegação principal"
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-2/45 to-transparent" aria-hidden="true" />
          <div className="grid grid-cols-7">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    'relative flex flex-col items-center justify-center gap-1',
                    'py-2 min-h-14 text-[11px] transition-all',
                    isActive ? 'text-primary font-semibold' : 'text-text-muted',
                  ].join(' ')
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span
                        className="absolute top-0 inset-x-6 h-0.5 rounded-full bg-gradient-to-r from-primary to-primary-2 shadow-[0_0_10px_rgb(var(--color-primary)/0.8)]"
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={[
                        'relative flex items-center justify-center h-8 w-12 rounded-lg transition-all',
                        isActive
                          ? 'bg-primary/15 text-primary shadow-[inset_0_0_12px_rgb(var(--color-primary)/0.15)]'
                          : '',
                      ].join(' ')}
                    >
                      {item.icon(isActive)}
                      {item.to === '/alertas' && unreadAlerts > 0 && (
                        <span
                          className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-md bg-danger text-white text-[10px] font-bold flex items-center justify-center shadow-[0_0_12px_rgb(var(--color-danger)/0.7)]"
                          aria-label={`${unreadAlerts} alertas não lidos`}
                        >
                          {unreadAlerts > 99 ? '99+' : unreadAlerts}
                        </span>
                      )}
                    </span>
                    {item.label === 'Configurações' ? 'Config' : item.label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  )
}
