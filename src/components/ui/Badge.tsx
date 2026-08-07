import type { HTMLAttributes } from 'react'

type Variant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant
}

const variantClasses: Record<Variant, string> = {
  neutral: 'bg-surface-2 text-text-muted border-border/80',
  primary:
    'bg-primary/12 text-primary border-primary/40 shadow-[0_0_12px_-4px_rgb(var(--color-primary)/0.55)]',
  success:
    'bg-accent/12 text-accent border-accent/40 shadow-[0_0_12px_-4px_rgb(var(--color-accent)/0.45)]',
  warning:
    'bg-warning/12 text-warning border-warning/40 shadow-[0_0_12px_-4px_rgb(var(--color-warning)/0.4)]',
  danger:
    'bg-danger/12 text-danger border-danger/40 shadow-[0_0_12px_-4px_rgb(var(--color-danger)/0.45)]',
}

/** Selo curto para status/contagens. */
export function Badge({
  variant = 'neutral',
  className,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md',
        'text-[11px] font-semibold leading-4 border whitespace-nowrap tracking-wide uppercase',
        variantClasses[variant],
        className ?? '',
      ].join(' ')}
      {...rest}
    />
  )
}
