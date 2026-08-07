import type { HTMLAttributes } from 'react'

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Largura (CSS). Default: 100%. */
  width?: string
  /** Altura (CSS). Default: 1rem. */
  height?: string
  /** Forma circular (avatar/ícone). */
  circle?: boolean
}

/** Placeholder de carregamento com pulso. */
export function Skeleton({
  width = '100%',
  height = '1rem',
  circle = false,
  className,
  style,
  ...rest
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={[
        'skeleton-shimmer',
        circle ? 'rounded-full' : 'rounded-lg',
        className ?? '',
      ].join(' ')}
      style={{ width, height, ...(circle ? { aspectRatio: '1' } : {}), ...style }}
      {...rest}
    />
  )
}
