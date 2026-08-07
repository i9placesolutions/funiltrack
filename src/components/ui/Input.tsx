import { useId, type InputHTMLAttributes } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
}

/** Campo de entrada com label, hint e estado de erro. */
export function Input({ label, hint, error, className, id, ...rest }: InputProps) {
  const autoId = useId()
  const inputId = id ?? autoId

  return (
    <div className={['flex flex-col gap-1.5', className ?? ''].join(' ')}>
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-text-muted">
          {label}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={[
          'h-11 px-3 rounded-lg bg-surface/90 text-text text-sm',
          'border outline-none transition-all backdrop-blur-sm',
          'placeholder:text-text-muted/70',
          'focus:ring-2 focus:ring-primary/40 focus:shadow-[var(--shadow-neon)]',
          error
            ? 'border-danger'
            : 'border-border/80 focus:border-primary/70',
        ].join(' ')}
        {...rest}
      />
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-text-muted">{hint}</p>
      ) : null}
    </div>
  )
}
