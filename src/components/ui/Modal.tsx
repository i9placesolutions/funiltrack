import { useEffect, type ReactNode } from 'react'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
}

/**
 * Modal mobile-first: abre como bottom sheet em telas pequenas
 * (alinhado ao fim do eixo vertical) e centraliza em telas maiores.
 */
export function Modal({ open, onClose, title, children }: ModalProps) {
  // Fecha com Escape.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
      />
      {/* Painel */}
      <div className="animate-pop relative w-full sm:max-w-md lg:max-w-lg neon-panel rounded-t-2xl sm:rounded-2xl shadow-2xl safe-bottom overflow-hidden">
        <div
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
          aria-hidden="true"
        />
        {title && (
          <header className="flex items-center justify-between px-4 py-3 border-b border-border/70">
            <h2 className="font-display text-sm font-semibold tracking-tight text-text">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-text-muted hover:text-text text-lg leading-none px-1 transition-colors"
              aria-label="Fechar"
            >
              ✕
            </button>
          </header>
        )}
        <div className="p-4 max-h-[70dvh] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
