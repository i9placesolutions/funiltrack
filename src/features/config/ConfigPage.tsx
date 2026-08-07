/**
 * Configurações do FunilTrack.
 *
 * - Aparência: claro / escuro / auto (integra com o hook de tema existente).
 * - Metas de alerta: CPL alvo e % de orçamento — persistidos em
 *   `src/lib/alerts/targets.ts` e consumidos pelo motor de regras.
 * - Dados de demonstração: reset limpa os overrides de localStorage criados
 *   pelo mock client. O controle só aparece quando o modo mock está ativo;
 *   dados reais devem ser preservados no PostgreSQL.
 * - Sobre: informações breves do produto.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BrandLogo } from '../../components/brand/BrandLogo'
import { PageFrame } from '../../components/layout/PageFrame'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { CurrencyInput } from '../../components/ui/CurrencyInput'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { useTheme } from '../../hooks/useTheme'
import { useApp } from '../../hooks/useApp'
import type { ThemeMode } from '../../context/AppContext'
import { loadAlertTargets, saveAlertTargets } from '../../lib/alerts/targets'
import { queryKeys } from '../../lib/query/keys'

/** Chaves de override criadas pelo mock client (ver src/lib/api/mockClient.ts). */
const DEMO_OVERRIDE_KEYS = [
  'funiltrack:lead-stage-overrides',
  'funiltrack:alert-read-overrides',
  // Chaves legadas (pré-renomeação)
  'metatrack:lead-stage-overrides',
  'metatrack:alert-read-overrides',
]

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'light', label: 'Claro', icon: '☀️' },
  { value: 'dark', label: 'Escuro', icon: '🌙' },
  { value: 'auto', label: 'Auto', icon: '🌗' },
]

const isUsingMocks = (import.meta.env.VITE_USE_MOCKS ?? 'false') === 'true'

export default function ConfigPage() {
  const { themeMode, setThemeMode } = useTheme()
  const { clearReadAlerts } = useApp()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [targets, setTargets] = useState(loadAlertTargets)
  const [cplCents, setCplCents] = useState<number | null>(
    targets.cplTargetCents,
  )
  const [budgetPctInput, setBudgetPctInput] = useState(() =>
    String(Math.round(targets.budgetThreshold * 100)),
  )
  const [budgetCents, setBudgetCents] = useState<number | null>(
    targets.dailyBudgetCents,
  )
  const [targetsError, setTargetsError] = useState<string | null>(null)
  const [resetOpen, setResetOpen] = useState(false)

  const saveTargets = () => {
    // parseFloat (não parseInt): "80,5" vira 80.5 em vez de truncar para 80.
    const pct = Number.parseFloat(budgetPctInput.trim().replace(',', '.'))
    if (
      cplCents === null ||
      cplCents <= 0 ||
      budgetCents === null ||
      budgetCents <= 0
    ) {
      setTargetsError('Informe valores monetários válidos (ex.: R$ 35,00).')
      return
    }
    if (!Number.isFinite(pct) || pct < 50 || pct > 100) {
      setTargetsError('O percentual de orçamento deve estar entre 50 e 100.')
      return
    }
    setTargetsError(null)
    const next = {
      cplTargetCents: cplCents,
      dailyBudgetCents: budgetCents,
      budgetThreshold: pct / 100,
    }
    setTargets(next)
    saveAlertTargets(next)
    // Metas são fonte reativa do motor de regras: invalidar faz a central E
    // o badge da bottom nav reavaliarem juntos (ver useAlerts).
    void queryClient.invalidateQueries({ queryKey: queryKeys.alertTargets })
    toast('Metas de alerta atualizadas.', 'success')
  }

  const resetDemoData = () => {
    try {
      for (const key of DEMO_OVERRIDE_KEYS) localStorage.removeItem(key)
    } catch {
      // Storage indisponível — nada a limpar.
    }
    // Sem isso o badge seguiria zerado/contaminado pelos ids lidos anteriores.
    clearReadAlerts()
    void queryClient.invalidateQueries()
    setResetOpen(false)
    toast('Dados de demonstração restaurados.', 'success')
  }

  return (
    <PageFrame width="default" className="space-y-4 lg:space-y-6">
      <div>
        <h1 className="font-display text-2xl lg:text-3xl font-extrabold tracking-tight text-text">
          Configurações
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Preferências do workspace e metas de monitoramento
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
      {/* Aparência */}
      <Card neon title="Aparência" subtitle="O modo auto acompanha o tema do sistema.">
        <div
          className="grid grid-cols-3 gap-2"
          role="radiogroup"
          aria-label="Tema do aplicativo"
        >
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={themeMode === option.value}
              onClick={() => setThemeMode(option.value)}
              className={[
                'h-14 rounded-lg border text-xs font-medium flex flex-col items-center justify-center gap-1 transition-all',
                themeMode === option.value
                  ? 'border-primary/60 bg-primary/10 text-primary shadow-[0_0_16px_-6px_rgb(var(--color-primary)/0.5)]'
                  : 'border-border bg-surface text-text-muted hover:text-text',
              ].join(' ')}
            >
              <span aria-hidden="true">{option.icon}</span>
              {option.label}
            </button>
          ))}
        </div>
      </Card>

      {/* Metas de alerta */}
      <Card
        neon
        title="Metas de alerta"
        subtitle="Estes alvos alimentam os alertas inteligentes da central."
      >
        <div className="space-y-4">
          <CurrencyInput
            label="CPL alvo"
            hint="Alerta quando o custo por lead ultrapassar este valor."
            valueCents={cplCents}
            onValueChange={setCplCents}
          />
          <CurrencyInput
            label="Orçamento diário de referência"
            hint="Base para o alerta de consumo de orçamento."
            valueCents={budgetCents}
            onValueChange={setBudgetCents}
          />
          <Input
            label="Alertar quando o orçamento atingir (%)"
            hint="Ex.: 80 dispara alerta ao consumir 80% do orçamento do dia."
            inputMode="numeric"
            value={budgetPctInput}
            onChange={(e) => setBudgetPctInput(e.target.value)}
          />
          {targetsError && <p className="text-xs text-danger">{targetsError}</p>}
          <Button fullWidth variant="primary" onClick={saveTargets}>
            Salvar metas
          </Button>
        </div>
      </Card>

      {/* Dados de demonstração — nunca oferece reset destrutivo no modo real. */}
      {isUsingMocks && (
        <Card
          neon
          title="Dados de demonstração"
          subtitle="Desfaz alterações locais (estágios de leads e alertas lidos)."
        >
          <Button fullWidth variant="danger" onClick={() => setResetOpen(true)}>
            Resetar dados demo
          </Button>
        </Card>
      )}

      {/* Sobre */}
      <Card neon title="Sobre">
        <BrandLogo variant="wordmark" size={28} className="max-w-[160px]" />
        <p className="text-xs text-text-muted mt-3">
          Console de funil e ads: métricas, leads, WhatsApp e alertas
          inteligentes em um só lugar.
        </p>
        <p className="text-[11px] text-text-muted mt-2">Versão 0.1.0</p>
      </Card>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Resetar dados demo?"
      >
        <p className="text-sm text-text-muted">
          As alterações locais (leads movidos no funil e alertas marcados como
          lidos) serão descartadas. Os dados originais de demonstração voltam
          ao estado inicial.
        </p>
        <div className="flex gap-2 mt-4">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => setResetOpen(false)}
          >
            Cancelar
          </Button>
          <Button variant="danger" className="flex-1" onClick={resetDemoData}>
            Resetar
          </Button>
        </div>
      </Modal>
    </PageFrame>
  )
}
