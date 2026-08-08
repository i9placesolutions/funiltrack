/**
 * Onboarding — wizard guiado de 3 passos (mobile-first, com progresso):
 *
 * 1. Conectar contas: consulta as integrações reais de Meta Ads e UazAPI.
 * 2. Definir metas: alvo de CPL e orçamento diário — persistidos em
 *    localStorage (src/lib/alerts/targets.ts) e usados pelos thresholds
 *    do motor de regras de alertas.
 * 3. Notificações: opt-in explícito — botão "Ativar notificações" pede a
 *    permissão e trata o resultado com honestidade (concedido / negado /
 *    indisponível); "Pular por agora" segue o fluxo sem pedir nada.
 *
 * Ao concluir, marca a flag existente (AppContext.completeOnboarding)
 * e navega para "/".
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { BrandLogo } from '../../components/brand/BrandLogo'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { CurrencyInput } from '../../components/ui/CurrencyInput'
import { useApp } from '../../hooks/useApp'
import { loadAlertTargets, saveAlertTargets } from '../../lib/alerts/targets'
import { queryKeys } from '../../lib/query/keys'
import {
  connectWhatsApp,
  getMetaStatus,
  getWhatsAppStatus,
  startMetaBusinessLogin,
} from '../../lib/api/authClient'
import {
  getNotificationPermission,
  requestNotificationPermission,
  type NotificationPermissionState,
} from '../../lib/notifications/service'

const STEP_TITLES = ['Conectar contas', 'Definir metas', 'Notificações']

type ConnectionStatus = 'idle' | 'checking' | 'connected' | 'error'

const IS_MOCK_MODE = (import.meta.env.VITE_USE_MOCKS ?? 'false') === 'true'

export default function OnboardingPage() {
  const { completeOnboarding } = useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(0)
  const [finishBusy, setFinishBusy] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)

  // Estado compartilhado entre passos.
  const [metaStatus, setMetaStatus] = useState<ConnectionStatus>('idle')
  const [whatsStatus, setWhatsStatus] = useState<ConnectionStatus>('idle')
  const [metaError, setMetaError] = useState<string | null>(null)
  const [whatsError, setWhatsError] = useState<string | null>(null)

  const [initialTargets] = useState(loadAlertTargets)
  const [cplCents, setCplCents] = useState<number | null>(
    initialTargets.cplTargetCents,
  )
  const [budgetCents, setBudgetCents] = useState<number | null>(
    initialTargets.dailyBudgetCents,
  )
  const [targetsError, setTargetsError] = useState<string | null>(null)

  const [permission, setPermission] = useState<NotificationPermissionState>(
    getNotificationPermission,
  )
  const [requestingPermission, setRequestingPermission] = useState(false)
  // "Ativadas" só depois que o usuário pede a permissão e ela é concedida —
  // nunca exibimos sucesso automático.
  const [activated, setActivated] = useState(false)
  // Resultado do último pedido (para feedback honesto quando o prompt é
  // fechado sem responder — estado 'default').
  const [promptResult, setPromptResult] =
    useState<NotificationPermissionState | null>(null)

  useEffect(() => {
    if (IS_MOCK_MODE) {
      setMetaStatus('connected')
      setWhatsStatus('connected')
      return
    }
    let active = true
    void Promise.all([getMetaStatus(), getWhatsAppStatus()])
      .then(([meta, whatsapp]) => {
        if (!active) return
        setMetaStatus(meta.adsConfigured ? 'connected' : 'idle')
        setWhatsStatus(whatsapp.connected ? 'connected' : 'idle')
      })
      .catch(() => {
        if (!active) return
        setMetaError('Não foi possível consultar as integrações. Tente novamente.')
      })
    return () => {
      active = false
    }
  }, [])

  const finish = async () => {
    setFinishBusy(true)
    setFinishError(null)
    try {
      await completeOnboarding()
      navigate('/', { replace: true })
    } catch (error) {
      setFinishError(error instanceof Error ? error.message : 'Não foi possível concluir a configuração.')
    } finally {
      setFinishBusy(false)
    }
  }

  const goToGoals = () => {
    if (metaStatus === 'checking' || whatsStatus === 'checking') return
    setStep(1)
  }

  const checkMetaConnection = async () => {
    setMetaStatus('checking')
    setMetaError(null)
    try {
      const status = await getMetaStatus()
      if (status.adsConfigured) setMetaStatus('connected')
      else if (!status.businessLoginConfigured) {
        setMetaStatus('error')
        setMetaError('A conexão global da Meta ainda está sendo finalizada pela equipe da plataforma. O cliente não precisa informar token nem Pixel.')
      }
      else {
        const { authorizationUrl } = await startMetaBusinessLogin()
        window.location.assign(authorizationUrl)
      }
    } catch (error) {
      setMetaStatus('error')
      setMetaError(error instanceof Error ? error.message : 'Meta Ads indisponível.')
    }
  }

  const checkWhatsAppConnection = async () => {
    setWhatsStatus('checking')
    setWhatsError(null)
    try {
      const current = await getWhatsAppStatus()
      if (current.connected) {
        setWhatsStatus('connected')
        return
      }
      if (!current.configured) {
        setWhatsStatus('error')
        setWhatsError('Salve a URL, a instância e o token UazAPI nas Configurações deste workspace antes de conectar o QR Code.')
        return
      }
      const next = await connectWhatsApp({ browser: 'auto' })
      if (next.connected) setWhatsStatus('connected')
      else {
        setWhatsStatus('error')
        setWhatsError('QR Code gerado. Após concluir o onboarding, abra WhatsApp para escanear o código.')
      }
    } catch (error) {
      setWhatsStatus('error')
      setWhatsError(error instanceof Error ? error.message : 'WhatsApp indisponível.')
    }
  }

  const goToNotifications = () => {
    if (
      cplCents === null ||
      cplCents <= 0 ||
      budgetCents === null ||
      budgetCents <= 0
    ) {
      setTargetsError('Informe valores válidos (ex.: R$ 35,00).')
      return
    }
    setTargetsError(null)
    saveAlertTargets({
      cplTargetCents: cplCents,
      dailyBudgetCents: budgetCents,
      budgetThreshold: initialTargets.budgetThreshold,
    })
    // Metas são fonte reativa do motor de alertas (ver useAlerts).
    void queryClient.invalidateQueries({ queryKey: queryKeys.alertTargets })
    setStep(2)
  }

  const askPermission = async () => {
    setRequestingPermission(true)
    const result = await requestNotificationPermission()
    setPermission(result)
    setPromptResult(result)
    if (result === 'granted') setActivated(true)
    setRequestingPermission(false)
  }

  return (
    <div className="min-h-dvh flex flex-col px-6 py-8 bg-bg safe-top safe-bottom lg:items-center lg:justify-center">
      <div className="w-full max-w-lg lg:neon-panel lg:rounded-2xl lg:p-8 lg:shadow-[var(--shadow-card)]">
      {/* Cabeçalho com progresso */}
      <header className="mb-8">
        <div className="mb-6">
          <BrandLogo variant="wordmark" size={36} className="max-w-[200px]" />
          <p className="mt-2 text-[10px] font-medium text-text-muted">
            Configuração inicial do FunilTrack
          </p>
        </div>
        <p className="text-xs font-medium text-text-muted mb-2">
          Passo {step + 1} de {STEP_TITLES.length} · {STEP_TITLES[step]}
        </p>
        <div
          className="flex gap-1.5"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEP_TITLES.length}
          aria-valuenow={step + 1}
          aria-label="Progresso do onboarding"
        >
          {STEP_TITLES.map((title, index) => (
            <span
              key={title}
              className={[
                'h-1.5 flex-1 rounded-full transition-colors',
                index <= step
                  ? 'bg-gradient-to-r from-primary to-primary-2'
                  : 'bg-surface-2',
              ].join(' ')}
            />
          ))}
        </div>
      </header>

      <main className="flex-1">
        {step === 0 && (
          <ConnectStep
            metaStatus={metaStatus}
            whatsStatus={whatsStatus}
            metaError={metaError}
            whatsError={whatsError}
            onMetaConnect={() => void checkMetaConnection()}
            onWhatsConnect={() => void checkWhatsAppConnection()}
          />
        )}

        {step === 1 && (
          <div className="space-y-4">
            <StepHeading
              title="Defina suas metas"
              description="Esses alvos alimentam os alertas inteligentes: avisamos quando o CPL passar do alvo ou o orçamento se aproximar do limite."
            />
            <Card className="space-y-4">
              <CurrencyInput
                label="CPL alvo"
                hint="Custo máximo desejado por lead."
                valueCents={cplCents}
                onValueChange={setCplCents}
                placeholder="Ex.: R$ 35,00"
              />
              <CurrencyInput
                label="Orçamento diário"
                hint="Alertamos quando o gasto do dia se aproximar deste valor."
                valueCents={budgetCents}
                onValueChange={setBudgetCents}
                placeholder="Ex.: R$ 80,00"
              />
              {targetsError && (
                <p className="text-xs text-danger">{targetsError}</p>
              )}
            </Card>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <StepHeading
              title="Ativar notificações?"
              description="Receba avisos quando um lead ficar sem resposta ou o orçamento estourar — mesmo com o app fechado. Você pode ativar depois nas configurações do navegador."
            />
            <Card>
              {activated ? (
                <p className="text-sm text-accent flex items-center gap-2">
                  ✅ Notificações ativadas!
                </p>
              ) : permission === 'denied' ? (
                <p className="text-sm text-text-muted">
                  Sem problemas — você acompanha tudo na central de alertas
                  dentro do app. Se mudar de ideia, ajuste nas configurações
                  do navegador.
                </p>
              ) : permission === 'unsupported' ? (
                <p className="text-sm text-text-muted">
                  Este navegador não suporta notificações — mas a central de
                  alertas do app cobre tudo por você.
                </p>
              ) : (
                <div className="space-y-3">
                  <Button
                    fullWidth
                    variant="secondary"
                    onClick={() => void askPermission()}
                    disabled={requestingPermission}
                  >
                    {requestingPermission
                      ? 'Aguardando permissão…'
                      : 'Ativar notificações'}
                  </Button>
                  {promptResult === 'default' && (
                    <p className="text-xs text-text-muted">
                      O pedido foi fechado sem resposta. Sem problemas — você
                      pode ativar depois nas configurações do navegador.
                    </p>
                  )}
                  <Button fullWidth variant="ghost" onClick={() => void finish()} disabled={finishBusy}>
                    Pular por agora
                  </Button>
                </div>
              )}
            </Card>
          </div>
        )}
      </main>

      {/* Navegação do wizard */}
      <footer className="mt-8 flex gap-3">
        {step > 0 && (
          <Button variant="ghost" size="lg" onClick={() => setStep(step - 1)}>
            Voltar
          </Button>
        )}
        {step === 0 && (
          <Button
            fullWidth
            size="lg"
            onClick={goToGoals}
            disabled={metaStatus === 'checking' || whatsStatus === 'checking'}
          >
            Continuar
          </Button>
        )}
        {step === 1 && (
          <Button fullWidth size="lg" onClick={goToNotifications}>
            Continuar
          </Button>
        )}
        {step === 2 && (
          <Button fullWidth size="lg" onClick={() => void finish()} disabled={finishBusy}>
            {finishBusy ? 'Salvando…' : 'Concluir e ir para o Dashboard'}
          </Button>
        )}
      </footer>
      {finishError && <p className="mt-3 text-center text-xs text-danger">{finishError}</p>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Passo 1 — conectar contas (simulação com progresso animado)         */
/* ------------------------------------------------------------------ */

interface ConnectStepProps {
  metaStatus: ConnectionStatus
  whatsStatus: ConnectionStatus
  metaError: string | null
  whatsError: string | null
  onMetaConnect: () => void
  onWhatsConnect: () => void
}

function ConnectStep({
  metaStatus,
  whatsStatus,
  metaError,
  whatsError,
  onMetaConnect,
  onWhatsConnect,
}: ConnectStepProps) {
  return (
    <div className="space-y-4">
      <StepHeading
        title="Conecte suas contas"
        description="O FunilTrack acompanha campanhas, gastos e conversas automaticamente. Levamos menos de um minuto."
      />
      <ConnectionCard
        icon="📣"
        name="Meta Ads"
        description="Campanhas, gastos e leads dos seus anúncios."
        status={metaStatus}
        onConnect={onMetaConnect}
        errorMessage={metaError}
      />
      <ConnectionCard
        icon="💬"
        name="WhatsApp"
        description="Conversas e tempo de resposta dos leads."
        status={whatsStatus}
        onConnect={onWhatsConnect}
        errorMessage={whatsError}
      />
    </div>
  )
}

interface ConnectionCardProps {
  icon: string
  name: string
  description: string
  status: ConnectionStatus
  onConnect: () => void
  errorMessage: string | null
}

function ConnectionCard({
  icon,
  name,
  description,
  status,
  onConnect,
  errorMessage,
}: ConnectionCardProps) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none" aria-hidden="true">
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text">{name}</p>
          <p className="text-xs text-text-muted mt-0.5">{description}</p>

          {status === 'checking' && (
            <p className="text-xs text-text-muted mt-2">Consultando a integração real…</p>
          )}

          {status === 'connected' && (
            <p className="text-xs font-medium text-accent mt-2">
              ✓ Conta conectada
            </p>
          )}
          {status === 'error' && errorMessage && (
            <p className="text-xs leading-5 text-danger mt-2">{errorMessage}</p>
          )}
        </div>

        {(status === 'idle' || status === 'error') && (
          <Button size="sm" onClick={onConnect}>
            {status === 'error' ? 'Tentar novamente' : 'Verificar'}
          </Button>
        )}
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Auxiliares                                                          */
/* ------------------------------------------------------------------ */

function StepHeading({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div>
      <h1 className="text-xl font-bold text-text">{title}</h1>
      <p className="text-sm text-text-muted mt-1">{description}</p>
    </div>
  )
}
