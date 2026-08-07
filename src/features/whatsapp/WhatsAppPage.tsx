import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { PageFrame } from '../../components/layout/PageFrame'
import { useToast } from '../../components/ui/Toast'
import {
  configureWhatsAppWebhook,
  connectWhatsApp,
  createWhatsAppInstance,
  disconnectWhatsApp,
  getWhatsAppStatus,
  sendWhatsAppText,
  type WhatsAppStatus,
} from '../../lib/api/authClient'

const INITIAL_STATUS: WhatsAppStatus = {
  configured: false,
  instanceName: 'funiltrack',
  status: 'not_configured',
  connected: false,
  loggedIn: false,
  jid: null,
  qrcode: null,
  paircode: null,
  profileName: null,
  profilePicUrl: null,
  lastError: null,
  updatedAt: null,
}

function statusLabel(status: WhatsAppStatus): string {
  if (!status.configured) return 'Não configurado'
  if (status.connected && status.loggedIn) return 'Conectado'
  if (status.status === 'connecting') return 'Aguardando leitura'
  if (status.status === 'hibernated') return 'Pausado'
  return 'Desconectado'
}

function statusVariant(status: WhatsAppStatus): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status.connected && status.loggedIn) return 'success'
  if (status.status === 'connecting') return 'warning'
  if (status.lastError) return 'danger'
  return 'neutral'
}

function qrSource(value: string): string {
  return value.startsWith('data:') ? value : `data:image/png;base64,${value}`
}

export default function WhatsAppPage() {
  const { toast } = useToast()
  const [status, setStatus] = useState(INITIAL_STATUS)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'webhook' | 'create' | null>(null)
  const [number, setNumber] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      setStatus(await getWhatsAppStatus())
    } catch (error) {
      if (!silent) toast(error instanceof Error ? error.message : 'Não foi possível consultar o WhatsApp.', 'danger')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (status.status !== 'connecting') return
    const timer = window.setInterval(() => void refresh(true), 5000)
    return () => window.clearInterval(timer)
  }, [refresh, status.status])

  const qr = useMemo(() => (status.qrcode ? qrSource(status.qrcode) : null), [status.qrcode])

  const startConnection = async () => {
    setBusy('connect')
    try {
      setStatus(await connectWhatsApp({ browser: 'auto' }))
      toast('QR Code gerado. Abra o WhatsApp no celular e leia o código.', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Não foi possível gerar o QR Code.', 'danger')
    } finally {
      setBusy(null)
    }
  }

  const createInstance = async () => {
    setBusy('create')
    try {
      await createWhatsAppInstance()
      await refresh()
      toast('Instância UazAPI criada. Gere o QR Code para conectar.', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Não foi possível criar a instância.', 'danger')
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async () => {
    setBusy('disconnect')
    try {
      setStatus(await disconnectWhatsApp())
      toast('WhatsApp desconectado. Um novo QR Code será necessário.', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Não foi possível desconectar.', 'danger')
    } finally {
      setBusy(null)
    }
  }

  const configureWebhook = async () => {
    setBusy('webhook')
    try {
      await configureWhatsAppWebhook()
      toast('Webhook UazAPI configurado para receber mensagens e eventos.', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Não foi possível configurar o webhook.', 'danger')
    } finally {
      setBusy(null)
    }
  }

  const sendTest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSending(true)
    try {
      await sendWhatsAppText(number, message)
      setMessage('')
      toast('Mensagem enviada.', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Não foi possível enviar a mensagem.', 'danger')
    } finally {
      setSending(false)
    }
  }

  return (
    <PageFrame width="default" className="space-y-4 lg:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Integração</p>
          <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-text lg:text-3xl">WhatsApp</h1>
          <p className="mt-1 text-sm text-text-muted">Conecte sua instância UazAPI por QR Code e acompanhe as conversas no funil.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
          <Button size="sm" variant="secondary" onClick={() => void refresh()} disabled={loading}>Atualizar</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:gap-6">
        <Card neon title="Conexão UazAPI" subtitle={`Instância: ${status.instanceName}`}>
          {!status.configured ? (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
              <p className="text-sm font-semibold text-text">A UazAPI ainda não está configurada</p>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                Adicione UAZAPI_TOKEN no ambiente do Coolify. Se preferir criar a instância por aqui, também configure UAZAPI_ADMIN_TOKEN e UAZAPI_ENCRYPTION_KEY no backend.
              </p>
              <Button className="mt-4" size="sm" onClick={() => void createInstance()} disabled={busy !== null}>
                {busy === 'create' ? 'Criando…' : 'Criar instância pela API'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-2 text-text-muted">
                  <span className={['h-2.5 w-2.5 rounded-full', status.connected ? 'bg-accent shadow-[0_0_10px_rgb(var(--color-accent)/0.8)]' : 'bg-text-muted'].join(' ')} />
                  {status.connected ? (status.profileName ?? 'Conta conectada') : 'Conta não conectada'}
                </span>
                {status.jid && <span className="text-xs text-text-muted">{status.jid}</span>}
              </div>

              {qr && !status.connected ? (
                <div className="flex flex-col items-center rounded-2xl border border-border/70 bg-white p-5">
                  <img src={qr} alt="QR Code para conectar o WhatsApp" className="h-64 w-64 object-contain" />
                  <p className="mt-3 text-center text-xs font-medium text-slate-700">Leia este código em WhatsApp → Configurações → Aparelhos conectados.</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/80 bg-surface-2/40 p-8 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5" /><path d="M15 18h.01" /></svg>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-text">{status.connected ? 'WhatsApp pronto para operar' : 'Gere um QR Code para começar'}</p>
                  <p className="mt-1 text-xs leading-5 text-text-muted">O código é renovado pela UazAPI enquanto a instância estiver em conexão.</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void startConnection()} disabled={busy !== null || status.connected}>
                  {busy === 'connect' ? 'Gerando…' : status.connected ? 'Conectado' : 'Gerar QR Code'}
                </Button>
                <Button variant="secondary" onClick={() => void configureWebhook()} disabled={busy !== null}>
                  {busy === 'webhook' ? 'Configurando…' : 'Configurar webhook'}
                </Button>
                {status.connected && <Button variant="danger" onClick={() => void disconnect()} disabled={busy !== null}>{busy === 'disconnect' ? 'Desconectando…' : 'Desconectar'}</Button>}
              </div>
              {status.status === 'connecting' && <p className="text-xs text-warning">Aguardando leitura do QR Code… esta tela atualiza automaticamente.</p>}
              {status.lastError && <p className="text-xs text-danger">{status.lastError}</p>}
            </div>
          )}
        </Card>

        <Card title="Teste rápido" subtitle="Envie uma mensagem pela instância conectada.">
          <form onSubmit={sendTest} className="space-y-4">
            <Input label="Número" hint="Use o formato internacional, por exemplo 5511999999999." value={number} onChange={(event) => setNumber(event.target.value)} placeholder="5511999999999" inputMode="numeric" required />
            <Input label="Mensagem" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Olá! Teste do FunilTrack" required />
            <Button fullWidth type="submit" disabled={!status.connected || sending}>{sending ? 'Enviando…' : 'Enviar mensagem de teste'}</Button>
            {!status.connected && <p className="text-xs text-text-muted">Conecte a instância para habilitar o envio.</p>}
          </form>
        </Card>
      </div>

      <Card title="Como o fluxo funciona" subtitle="Tudo fica no backend, com o token fora do navegador.">
        <div className="grid gap-4 text-sm text-text-muted md:grid-cols-3">
          {[
            ['1', 'Conectar', 'O backend chama /instance/connect e exibe o QR Code retornado pela UazAPI.'],
            ['2', 'Receber', 'O webhook recebe mensagens, deduplica eventos e atualiza a timeline do lead.'],
            ['3', 'Operar', 'O time acompanha o lead no funil e pode enviar mensagens sem expor o token UazAPI.'],
          ].map(([numberLabel, title, description]) => (
            <div key={numberLabel} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-xs font-bold text-primary">{numberLabel}</span>
              <div><p className="font-semibold text-text">{title}</p><p className="mt-1 text-xs leading-5">{description}</p></div>
            </div>
          ))}
        </div>
      </Card>
    </PageFrame>
  )
}
