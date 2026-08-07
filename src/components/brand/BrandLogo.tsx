/**
 * Logo FunilTrack — mark (ícone) e wordmark (logo completa).
 * Arquivos em /public/brand (fundo preto nativo da identidade).
 */
import type { ImgHTMLAttributes } from 'react'

type Variant = 'mark' | 'wordmark'

export interface BrandLogoProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  variant?: Variant
  /** Altura do mark (wordmark escala pela altura). */
  size?: number
}

const SRC: Record<Variant, string> = {
  mark: '/brand/funiltrack-mark.png',
  wordmark: '/brand/funiltrack-logo.png',
}

export function BrandLogo({
  variant = 'mark',
  size = 32,
  className,
  ...rest
}: BrandLogoProps) {
  const isMark = variant === 'mark'
  return (
    <img
      src={SRC[variant]}
      alt="FunilTrack"
      width={isMark ? size : Math.round(size * 3.15)}
      height={size}
      draggable={false}
      className={['select-none object-contain', className ?? ''].join(' ')}
      style={{ height: size, width: isMark ? size : 'auto' }}
      {...rest}
    />
  )
}
