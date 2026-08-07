/**
 * Input monetário com máscara pt-BR enquanto digita.
 *
 * O valor interno é sempre em CENTAVOS de BRL (convenção da camada de dados);
 * a exibição é mascarada como moeda (ex.: "R$ 40,00"). Digitação estilo
 * bancário: cada dígto entra à direita e os dois últimos são os centavos
 * (digitar 4 → "R$ 0,04" → "4" → "R$ 0,40" → "40" → "R$ 4,00" → "4000" →
 * "R$ 40,00"). Apagar remove dígitos da direita para a esquerda.
 */
import type { InputHTMLAttributes } from 'react'
import { currencyMaskToCents, formatCurrencyMask } from '../../lib/format'
import { Input } from './Input'

export interface CurrencyInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'inputMode'
  > {
  /** Valor em centavos de BRL (null = campo vazio). */
  valueCents: number | null
  /** Chamado com o novo valor em centavos (null quando o campo fica vazio). */
  onValueChange: (cents: number | null) => void
  label?: string
  hint?: string
  error?: string
}

export function CurrencyInput({
  valueCents,
  onValueChange,
  ...rest
}: CurrencyInputProps) {
  return (
    <Input
      inputMode="numeric"
      autoComplete="off"
      value={valueCents === null ? '' : formatCurrencyMask(valueCents)}
      onChange={(e) => onValueChange(currencyMaskToCents(e.target.value))}
      {...rest}
    />
  )
}
