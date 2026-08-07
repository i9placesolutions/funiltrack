import type { ReactNode } from 'react'

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

/** Estado vazio padrão para listas/telas sem conteúdo. */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center py-10 px-6">
      {icon && (
        <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary-2/20 border border-primary/30 text-2xl leading-none shadow-[var(--shadow-neon)]">
          {icon}
        </div>
      )}
      <h3 className="font-display text-sm font-semibold text-text mt-1">{title}</h3>
      {description && (
        <p className="text-xs text-text-muted max-w-xs">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
