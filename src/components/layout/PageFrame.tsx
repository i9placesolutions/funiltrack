import type { HTMLAttributes, ReactNode } from 'react'

export interface PageFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /**
   * `wide` = painel de trabalho (dashboard, funil, leads).
   * `default` = formulários / config.
   * `narrow` = detalhes em leitura.
   */
  width?: 'narrow' | 'default' | 'wide' | 'full'
}

const widthClasses: Record<NonNullable<PageFrameProps['width']>, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-5xl',
  wide: 'max-w-[1440px]',
  full: 'max-w-none',
}

/**
 * Container de página responsivo: coluna confortável no mobile,
 * largura de console desktop a partir de `lg`.
 */
export function PageFrame({
  children,
  width = 'wide',
  className,
  ...rest
}: PageFrameProps) {
  return (
    <div
      className={[
        'w-full mx-auto',
        'px-4 pt-4 pb-6',
        'lg:px-8 lg:pt-8 lg:pb-10',
        widthClasses[width],
        className ?? '',
      ].join(' ')}
      {...rest}
    >
      {children}
    </div>
  )
}
