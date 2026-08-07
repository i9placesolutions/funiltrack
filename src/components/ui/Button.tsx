import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Ocupa toda a largura disponível. */
  fullWidth?: boolean
}

const baseClasses =
  'inline-flex items-center justify-center gap-2 font-semibold rounded-lg ' +
  'transition-all select-none disabled:opacity-50 disabled:pointer-events-none ' +
  'active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg'

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-gradient-to-r from-primary via-primary to-primary-2 text-primary-fg ' +
    'shadow-[var(--shadow-glow)] hover:brightness-110 animate-gradient',
  secondary:
    'bg-surface-2/80 text-text border border-border/80 hover:border-primary/40 ' +
    'hover:shadow-[var(--shadow-neon)] hover:text-primary',
  ghost: 'bg-transparent text-text-muted hover:bg-surface-2 hover:text-text',
  danger:
    'bg-danger text-white shadow-[0_0_20px_-4px_rgb(var(--color-danger)/0.55)] hover:brightness-110',
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        fullWidth ? 'w-full' : '',
        className ?? '',
      ].join(' ')}
      {...rest}
    />
  )
}
