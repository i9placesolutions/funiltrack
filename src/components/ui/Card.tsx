import type { HTMLAttributes, ReactNode } from 'react'

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  subtitle?: ReactNode
  footer?: ReactNode
  /** Remove o padding interno do corpo (para listas etc.). */
  flush?: boolean
  /** Painel com borda neon (destaque visual). */
  neon?: boolean
}

/** Superfície básica de conteúdo (card) do design system. */
export function Card({
  title,
  subtitle,
  footer,
  flush = false,
  neon = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={[
        neon
          ? 'neon-panel rounded-xl overflow-hidden'
          : 'bg-surface/90 border border-border/70 rounded-xl overflow-hidden shadow-[var(--shadow-card)] backdrop-blur-sm',
        className ?? '',
      ].join(' ')}
      {...rest}
    >
      {(title || subtitle) && (
        <header className="px-4 pt-4 pb-1">
          {title && (
            <h2 className="font-display text-sm font-semibold tracking-tight text-text">
              {title}
            </h2>
          )}
          {subtitle && (
            <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>
          )}
        </header>
      )}
      <div className={flush ? '' : 'p-4'}>{children}</div>
      {footer && (
        <footer className="px-4 py-3 border-t border-border/70 bg-surface-2/40">
          {footer}
        </footer>
      )}
    </div>
  )
}
