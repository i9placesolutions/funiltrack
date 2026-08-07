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
import { useEffect, useState } from 'react'
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
import { changePassword, getMetaStatus, syncMetaAds, type MetaStatus } from '../../lib/api/authClient'

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

function syncRange(): { from: string; to: string } {
  const today = new Date()
  const from = new Date(today)
  from.setDate(today.getDate() - 29)
  return {
    from: from.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  }
}

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
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null)
  const [metaBusy, setMetaBusy] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)

  useEffect(() => {
    if (isUsingMocks) return
    void getMetaStatus()
      .then(setMetaStatus)
      .catch((error: unknown) => {
        setMetaError(error instanceof Error ? error.message : 'Não foi possível consultar a Meta.')
      })
  }, [])

  const runMetaSync = async () => {
    setMetaBusy(true)
    setMetaError(null)
    try {
      const range = syncRange()
      await syncMetaAds(range.from, range.to)
      setMetaStatus(await getMetaStatus())
      await queryClient.invalidateQueries()
      toast('Campanhas e métricas da Meta sincronizadas.', 'success')
    } catch (error) {
      setMetaError(error instanceof Error ? error.message : 'Não foi possível sincronizar os anúncios.')
    } finally {
      setMetaBusy(false)
    }
  }

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

  const savePassword = async () => {
    setPasswordError(null)
    if (newPassword !== confirmNewPassword) {
      setPasswordError('As novas senhas não conferem.')
      return
    }
    setPasswordBusy(true)
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
      toast('Senha alterada. As outras sessões foram encerradas.', 'success')
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Não foi possível alterar a senha.')
    } finally {
      setPasswordBusy(false)
    }
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

      {/* Integração real da Meta Ads */}
      {!isUsingMocks && (
        <Card
          neon
          title="Meta Ads e conversões"
          subtitle="Atribuição real: Insights das campanhas e eventos do funil enviados à Meta."
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-text">Marketing API</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {metaStatus?.adsConfigured
                    ? `Conta ${metaStatus.adAccountId ?? 'configurada'}`
                    : 'Não configurada no ambiente do Coolify'}
                </p>
              </div>
              <span className={metaStatus?.adsConfigured ? 'text-xs font-semibold text-accent' : 'text-xs font-semibold text-warning'}>
                {metaStatus?.adsConfigured ? 'Conectada' : 'Pendente'}
              </span>
            </div>
            <p className="text-xs leading-5 text-text-muted">
              Configure <code>META_ACCESS_TOKEN</code> e <code>META_AD_ACCOUNT_ID</code> no Coolify.
              Para devolver Lead, QualifiedLead e Purchase à Meta, configure também <code>META_DATASET_ID</code>.
            </p>
            {metaStatus?.lastSyncAt && (
              <p className="text-[11px] text-text-muted">
                Última sincronização: {new Date(metaStatus.lastSyncAt).toLocaleString('pt-BR')}
              </p>
            )}
            {metaError && <p className="text-xs text-danger">{metaError}</p>}
            <Button fullWidth variant="secondary" onClick={() => void runMetaSync()} disabled={metaBusy || !metaStatus?.adsConfigured}>
              {metaBusy ? 'Sincronizando…' : 'Sincronizar anúncios agora'}
            </Button>
          </div>
        </Card>
      )}

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

      <Card neon title="Segurança da conta" subtitle="Atualize sua senha sem sair desta sessão.">
        <div className="space-y-3">
          <Input label="Senha atual" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          <Input label="Nova senha" type="password" autoComplete="new-password" hint="Use pelo menos 8 caracteres com letras e números." value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          <Input label="Confirmar nova senha" type="password" autoComplete="new-password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} />
          {passwordError && <p className="text-xs text-danger">{passwordError}</p>}
          <Button fullWidth variant="secondary" onClick={() => void savePassword()} disabled={passwordBusy || !currentPassword || !newPassword || !confirmNewPassword}>
            {passwordBusy ? 'Salvando…' : 'Alterar senha'}
          </Button>
        </div>
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
