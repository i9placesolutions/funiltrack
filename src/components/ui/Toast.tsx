import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type ToastVariant = 'info' | 'success' | 'warning' | 'danger'

interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

export interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const AUTO_DISMISS_MS = 3200

const variantClasses: Record<ToastVariant, string> = {
  info: 'border-primary/40',
  success: 'border-accent/50',
  warning: 'border-warning/50',
  danger: 'border-danger/50',
}

/** Provider de toasts transitórios (auto-dispem). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, variant: ToastVariant = 'info') => {
      idRef.current += 1
      const id = idRef.current
      setItems((prev) => [...prev.slice(-2), { id, message, variant }])
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Viewport de toasts */}
      <div className="fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none safe-bottom lg:inset-x-auto lg:right-6 lg:bottom-6 lg:items-end lg:w-[380px]">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => dismiss(item.id)}
            className={[
              'animate-pop pointer-events-auto w-full max-w-sm lg:max-w-none text-left',
              'glass text-text text-sm border rounded-xl shadow-xl',
              'px-4 py-3',
              variantClasses[item.variant],
            ].join(' ')}
          >
            {item.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/** Hook para disparar toasts. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast deve ser usado dentro de <ToastProvider>')
  }
  return context
}
