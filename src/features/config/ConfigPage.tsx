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
import {
  addCompanyMember,
  changePassword,
  createCompany as createCompanyRequest,
  getCompanyMembers,
  getMetaStatus,
  saveMetaIntegration,
  saveUazApiIntegration,
  setActiveCompanyId,
  syncMetaAds,
  updateCurrentCompany,
  type CompanyMember,
  type CompanyRole,
  type MetaStatus,
} from '../../lib/api/authClient'

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
  const { activeCompany, clearReadAlerts, refreshAuth } = useApp()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const activeCompanyId = activeCompany?.id

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
  const [companyName, setCompanyName] = useState('')
  const [newCompanyName, setNewCompanyName] = useState('')
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [metaAccountId, setMetaAccountId] = useState('')
  const [metaDatasetId, setMetaDatasetId] = useState('')
  const [metaToken, setMetaToken] = useState('')
  const [integrationBusy, setIntegrationBusy] = useState<'meta' | 'uazapi' | null>(null)
  const [integrationError, setIntegrationError] = useState<string | null>(null)
  const [uazApiUrl, setUazApiUrl] = useState('https://api.uazapi.com')
  const [uazInstanceName, setUazInstanceName] = useState('funiltrack')
  const [uazToken, setUazToken] = useState('')
  const [members, setMembers] = useState<CompanyMember[]>([])
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<CompanyRole>('member')
  const [memberBusy, setMemberBusy] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)

  useEffect(() => {
    setCompanyName(activeCompany?.name ?? '')
  }, [activeCompany?.id, activeCompany?.name])

  useEffect(() => {
    if (isUsingMocks) return
    void getMetaStatus()
      .then((status) => {
        setMetaStatus(status)
        setMetaAccountId(status.adAccountId ?? '')
        setMetaDatasetId(status.datasetId ?? '')
      })
      .catch((error: unknown) => {
        setMetaError(error instanceof Error ? error.message : 'Não foi possível consultar a Meta.')
      })
  }, [activeCompany?.id])

  useEffect(() => {
    if (isUsingMocks || !activeCompanyId) return
    void getCompanyMembers().then(setMembers).catch(() => setMembers([]))
  }, [activeCompanyId])

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

  const saveWorkspace = async () => {
    setWorkspaceBusy(true)
    setWorkspaceError(null)
    try {
      await updateCurrentCompany(companyName)
      await refreshAuth()
      toast('Empresa atualizada.', 'success')
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Não foi possível atualizar a empresa.')
    } finally {
      setWorkspaceBusy(false)
    }
  }

  const createWorkspace = async () => {
    setWorkspaceBusy(true)
    setWorkspaceError(null)
    try {
      const company = await createCompanyRequest(newCompanyName)
      await refreshAuth()
      setActiveCompanyId(company.id)
      window.location.assign('/onboarding')
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Não foi possível criar a empresa.')
    } finally {
      setWorkspaceBusy(false)
    }
  }

  const saveMeta = async () => {
    setIntegrationBusy('meta')
    setIntegrationError(null)
    try {
      const status = await saveMetaIntegration({
        adAccountId: metaAccountId,
        ...(metaDatasetId.trim() ? { datasetId: metaDatasetId } : {}),
        ...(metaToken.trim() ? { accessToken: metaToken } : {}),
      })
      setMetaStatus(status)
      setMetaToken('')
      toast('Credenciais Meta salvas neste workspace.', 'success')
    } catch (error) {
      setIntegrationError(error instanceof Error ? error.message : 'Não foi possível salvar a Meta.')
    } finally {
      setIntegrationBusy(null)
    }
  }

  const saveUazApi = async () => {
    setIntegrationBusy('uazapi')
    setIntegrationError(null)
    try {
      await saveUazApiIntegration({
        baseUrl: uazApiUrl,
        instanceName: uazInstanceName,
        ...(uazToken.trim() ? { token: uazToken } : {}),
      })
      setUazToken('')
      toast('Credenciais UazAPI salvas neste workspace.', 'success')
    } catch (error) {
      setIntegrationError(error instanceof Error ? error.message : 'Não foi possível salvar a UazAPI.')
    } finally {
      setIntegrationBusy(null)
    }
  }

  const inviteMember = async () => {
    setMemberBusy(true)
    setMemberError(null)
    try {
      const member = await addCompanyMember(memberEmail, memberRole)
      setMembers((previous) => [...previous.filter((item) => item.id !== member.id), member])
      setMemberEmail('')
      toast('Acesso do membro atualizado.', 'success')
    } catch (error) {
      setMemberError(error instanceof Error ? error.message : 'Não foi possível adicionar o membro.')
    } finally {
      setMemberBusy(false)
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
      {!isUsingMocks && (
        <Card
          neon
          className="lg:col-span-2"
          title="Empresa e workspaces"
          subtitle="Cada empresa possui dados, membros e credenciais de integração totalmente separados."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              <Input
                label="Nome da empresa atual"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                disabled={activeCompany?.role !== 'owner'}
              />
              <Button variant="secondary" onClick={() => void saveWorkspace()} disabled={workspaceBusy || activeCompany?.role !== 'owner'}>
                {workspaceBusy ? 'Salvando…' : 'Salvar empresa'}
              </Button>
              {activeCompany?.role !== 'owner' && <p className="text-xs text-text-muted">Somente o owner pode alterar o nome da empresa.</p>}
            </div>
            <div className="space-y-3 rounded-xl border border-border/70 bg-surface-2/40 p-3">
              <p className="text-sm font-semibold text-text">Adicionar outra empresa</p>
              <Input
                label="Nome do novo workspace"
                placeholder="Ex.: Cliente ACME"
                value={newCompanyName}
                onChange={(event) => setNewCompanyName(event.target.value)}
              />
              <Button onClick={() => void createWorkspace()} disabled={workspaceBusy || newCompanyName.trim().length < 2}>
                {workspaceBusy ? 'Criando…' : 'Criar workspace'}
              </Button>
            </div>
          </div>
          {workspaceError && <p className="mt-3 text-xs text-danger">{workspaceError}</p>}
        </Card>
      )}

      {!isUsingMocks && (
        <Card
          neon
          className="lg:col-span-2"
          title="Ativos e credenciais deste workspace"
          subtitle="Os tokens são enviados por HTTPS, criptografados no servidor e nunca voltam para o navegador."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-border/70 bg-surface-2/40 p-3">
              <div>
                <p className="text-sm font-semibold text-text">Meta Ads</p>
                <p className="mt-0.5 text-xs text-text-muted">Use a conta, Pixel/Dataset e token com permissão do cliente.</p>
              </div>
              <Input label="Conta de anúncios" placeholder="act_123456789" value={metaAccountId} onChange={(event) => setMetaAccountId(event.target.value)} />
              <Input label="Pixel ou Dataset" placeholder="1715250949780818" value={metaDatasetId} onChange={(event) => setMetaDatasetId(event.target.value)} />
              <Input label="Novo token Meta (opcional ao atualizar)" type="password" autoComplete="off" value={metaToken} onChange={(event) => setMetaToken(event.target.value)} />
              <Button fullWidth variant="secondary" onClick={() => void saveMeta()} disabled={integrationBusy !== null || activeCompany?.role === 'member' || !metaAccountId.trim()}>
                {integrationBusy === 'meta' ? 'Salvando Meta…' : 'Salvar Meta Ads'}
              </Button>
            </div>
            <div className="space-y-3 rounded-xl border border-border/70 bg-surface-2/40 p-3">
              <div>
                <p className="text-sm font-semibold text-text">UazAPI / WhatsApp</p>
                <p className="mt-0.5 text-xs text-text-muted">Use uma instância exclusiva por empresa e conecte o QR Code na aba WhatsApp.</p>
              </div>
              <Input label="URL da UazAPI" placeholder="https://empresa.uazapi.com" value={uazApiUrl} onChange={(event) => setUazApiUrl(event.target.value)} />
              <Input label="Nome da instância" placeholder="cliente-acme" value={uazInstanceName} onChange={(event) => setUazInstanceName(event.target.value)} />
              <Input label="Novo token UazAPI (opcional ao atualizar)" type="password" autoComplete="off" value={uazToken} onChange={(event) => setUazToken(event.target.value)} />
              <Button fullWidth variant="secondary" onClick={() => void saveUazApi()} disabled={integrationBusy !== null || activeCompany?.role === 'member' || !uazApiUrl.trim() || !uazInstanceName.trim()}>
                {integrationBusy === 'uazapi' ? 'Salvando UazAPI…' : 'Salvar UazAPI'}
              </Button>
            </div>
          </div>
          {integrationError && <p className="mt-3 text-xs text-danger">{integrationError}</p>}
        </Card>
      )}

      {!isUsingMocks && (
        <Card neon className="lg:col-span-2" title="Equipe da empresa" subtitle="Adicione usuários que já possuam uma conta FunilTrack; o papel vale somente neste workspace.">
          {activeCompany?.role === 'owner' ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_150px_auto] md:items-end">
                <Input label="E-mail do membro" type="email" placeholder="pessoa@empresa.com" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} />
                <label className="block text-xs font-medium text-text-muted">
                  Papel
                  <select value={memberRole} onChange={(event) => setMemberRole(event.target.value as CompanyRole)} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text">
                    <option value="member">Membro</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                </label>
                <Button onClick={() => void inviteMember()} disabled={memberBusy || !memberEmail.trim()}>{memberBusy ? 'Salvando…' : 'Adicionar'}</Button>
              </div>
              {memberError && <p className="text-xs text-danger">{memberError}</p>}
              <div className="divide-y divide-border/60 rounded-xl border border-border/70">
                {members.map((member) => (
                  <div key={member.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <div className="min-w-0"><p className="truncate font-medium text-text">{member.name}</p><p className="truncate text-xs text-text-muted">{member.email}</p></div>
                    <span className="rounded-md bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">{member.role}</span>
                  </div>
                ))}
                {members.length === 0 && <p className="px-3 py-3 text-xs text-text-muted">Nenhum membro encontrado.</p>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-muted">Somente o owner desta empresa gerencia os membros.</p>
          )}
        </Card>
      )}

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
                    : 'Ainda não configurada neste workspace'}
                </p>
              </div>
              <span className={metaStatus?.adsConfigured ? 'text-xs font-semibold text-accent' : 'text-xs font-semibold text-warning'}>
                {metaStatus?.adsConfigured ? 'Conectada' : 'Pendente'}
              </span>
            </div>
            <p className="text-xs leading-5 text-text-muted">
              Salve acima a conta, o token e o Pixel/Dataset deste cliente.
              Para devolver Lead, QualifiedLead e Purchase à Meta, informe também o Pixel ou Dataset.
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
