import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BrandLogo } from '../../components/brand/BrandLogo'

type PageKind = 'privacy' | 'terms' | 'deletion'

const navItems: Array<{ href: string; label: string }> = [
  { href: '/privacidade', label: 'Privacidade' },
  { href: '/termos', label: 'Termos' },
  { href: '/exclusao-de-dados', label: 'Dados' },
]

function pageKindFromPath(pathname: string): PageKind {
  if (pathname === '/termos') return 'terms'
  if (pathname === '/exclusao-de-dados') return 'deletion'
  return 'privacy'
}

function SignalMark() {
  return (
    <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 shadow-[var(--shadow-neon)]" aria-hidden="true">
      <span className="absolute h-6 w-[2px] rounded-full bg-primary" />
      <span className="absolute h-4 w-[2px] translate-x-2 rounded-full bg-primary-2" />
      <span className="absolute h-3 w-3 -translate-x-2 rounded-full border-2 border-primary-2" />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border/70 py-7 first:border-t-0 first:pt-0">
      <h2 className="text-base font-bold text-text">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-text-muted">{children}</div>
    </section>
  )
}

function PrivacyPolicy() {
  return (
    <>
      <Section title="1. Dados que tratamos">
        <p>Tratamos os dados necessários para criar e operar uma conta FunilTrack, como nome, e-mail e credenciais protegidas. Quando você usa a plataforma, também podemos tratar dados de campanhas, leads, conversas e eventos que você envia ou conecta ao seu workspace.</p>
        <p>Registros técnicos de segurança e operação podem ser mantidos para prevenir abuso, investigar falhas e preservar a integridade do serviço.</p>
      </Section>
      <Section title="2. Como usamos esses dados">
        <p>Usamos os dados para autenticar usuários, apresentar o funil e os relatórios, registrar conversas, operar integrações solicitadas por você e manter a segurança do ambiente.</p>
        <p>Os dados de leads e campanhas inseridos no FunilTrack permanecem sob a responsabilidade do workspace que os utiliza. Você deve ter a base legal e os avisos necessários para tratar esses dados.</p>
      </Section>
      <Section title="3. Integrações e fornecedores">
        <p>Quando ativadas, integrações como Meta e UazAPI processam dados conforme as configurações e os termos de cada serviço. Credenciais de integração são mantidas no backend do FunilTrack e não são expostas no navegador.</p>
        <p>Também usamos infraestrutura de banco de dados, cache e hospedagem para executar a plataforma. Esses fornecedores atuam apenas no limite necessário para prestar o serviço.</p>
      </Section>
      <Section title="4. Retenção e seus controles">
        <p>Conservamos dados enquanto forem necessários para operar sua conta, cumprir obrigações aplicáveis ou proteger o serviço. Você pode revogar integrações no painel e solicitar exclusão dos seus dados pelo fluxo abaixo.</p>
        <p>Uma solicitação de exclusão é registrada para atendimento e pode preservar informações cuja retenção seja necessária por obrigação legal, segurança ou prevenção a fraudes.</p>
      </Section>
    </>
  )
}

function TermsOfService() {
  return (
    <>
      <Section title="1. Uso da plataforma">
        <p>O FunilTrack organiza informações de anúncios, leads, etapas de funil e conversas para equipes que administram campanhas. O acesso é pessoal e deve ser usado apenas por pessoas autorizadas pelo workspace.</p>
        <p>Você é responsável por manter suas credenciais protegidas e por garantir que os dados enviados ao sistema sejam corretos e obtidos de forma legítima.</p>
      </Section>
      <Section title="2. Integrações externas">
        <p>As conexões com Meta, UazAPI e outros provedores dependem de contas válidas, permissões concedidas e configurações feitas pelo titular dessas contas. O FunilTrack não substitui os termos, as políticas de anúncios ou as regras de mensagens desses provedores.</p>
        <p>Não use a plataforma para enviar mensagens não solicitadas, burlar limitações de provedores, manipular métricas ou violar direitos de terceiros.</p>
      </Section>
      <Section title="3. Dados e conteúdo">
        <p>Você continua responsável pelos dados do seu workspace, incluindo informações de leads, criativos, campanhas e mensagens. Ao utilizar a plataforma, você autoriza o processamento técnico necessário para entregar as funcionalidades escolhidas.</p>
      </Section>
      <Section title="4. Disponibilidade e mudanças">
        <p>Buscamos manter o FunilTrack disponível e seguro, mas integrações de terceiros e a internet podem sofrer indisponibilidades. Podemos atualizar a plataforma e estes termos para aprimorar segurança, compatibilidade e funcionalidades.</p>
      </Section>
    </>
  )
}

function DataDeletionRequest() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [details, setDetails] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('sending')
    setMessage('')
    try {
      const response = await fetch('/api/privacy/deletion-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name: name || undefined, details: details || undefined }),
      })
      const payload = (await response.json().catch(() => null)) as { message?: string } | null
      if (!response.ok) throw new Error(payload?.message ?? 'Não foi possível registrar o pedido.')
      setStatus('success')
      setMessage('Pedido registrado. A solicitação entrou na fila de atendimento.')
      setEmail('')
      setName('')
      setDetails('')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Não foi possível registrar o pedido.')
    }
  }

  return (
    <>
      <Section title="Como pedir a exclusão">
        <p>Se você possui acesso ao FunilTrack, também pode encerrar integrações e revisar configurações pelo painel. Para solicitar a exclusão de dados pessoais associados à sua conta, envie o formulário abaixo.</p>
        <p>O pedido é registrado para análise e execução. Ele não cancela automaticamente retenções necessárias para segurança, prevenção a fraude ou obrigações legais.</p>
      </Section>
      <section className="rounded-2xl border border-border/80 bg-surface/80 p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <SignalMark />
          <div>
            <h2 className="text-base font-bold text-text">Solicitar exclusão de dados</h2>
            <p className="mt-1 text-sm leading-6 text-text-muted">Informe o e-mail associado aos dados que devem ser localizados.</p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <label className="block">
            <span className="text-xs font-semibold text-text-muted">E-mail associado</span>
            <input className="mt-1.5 h-11 w-full rounded-lg border border-border/80 bg-bg/70 px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-text-muted">Nome (opcional)</span>
            <input className="mt-1.5 h-11 w-full rounded-lg border border-border/80 bg-bg/70 px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25" type="text" autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-text-muted">Detalhes para localizar os dados (opcional)</span>
            <textarea className="mt-1.5 min-h-28 w-full resize-y rounded-lg border border-border/80 bg-bg/70 px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25" maxLength={1000} value={details} onChange={(event) => setDetails(event.target.value)} />
          </label>
          {status !== 'idle' && (
            <p role="status" className={status === 'success' ? 'text-sm text-accent' : status === 'error' ? 'text-sm text-danger' : 'text-sm text-text-muted'}>{status === 'sending' ? 'Registrando pedido…' : message}</p>
          )}
          <button type="submit" disabled={status === 'sending'} className="inline-flex h-11 items-center justify-center rounded-lg bg-gradient-to-r from-primary to-primary-2 px-5 text-sm font-bold text-primary-fg shadow-[var(--shadow-glow)] transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-60">
            {status === 'sending' ? 'Enviando…' : 'Registrar solicitação'}
          </button>
        </form>
      </section>
    </>
  )
}

export default function LegalPage() {
  const location = useLocation()
  const kind = pageKindFromPath(location.pathname)
  const title = kind === 'privacy' ? 'Privacidade com controle.' : kind === 'terms' ? 'Termos para uma operação responsável.' : 'Seus dados, sua escolha.'
  const eyebrow = kind === 'privacy' ? 'POLÍTICA DE PRIVACIDADE' : kind === 'terms' ? 'TERMOS DE USO' : 'EXCLUSÃO DE DADOS'

  return (
    <main className="min-h-dvh bg-bg px-4 py-5 text-text sm:px-7 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-surface/75 px-4 py-3 shadow-[var(--shadow-card)] backdrop-blur sm:px-5">
          <Link to="/login" aria-label="Ir para o acesso do FunilTrack"><BrandLogo variant="wordmark" size={34} className="max-w-[178px]" /></Link>
          <nav className="flex items-center gap-1 text-xs font-semibold text-text-muted" aria-label="Páginas legais">
            {navItems.map((item) => <Link key={item.href} to={item.href} className={['rounded-md px-2.5 py-2 transition hover:bg-surface-2 hover:text-text', location.pathname === item.href ? 'bg-surface-2 text-primary' : ''].join(' ')}>{item.label}</Link>)}
          </nav>
        </header>

        <div className="mt-8 grid gap-7 lg:grid-cols-[minmax(0,0.76fr)_minmax(300px,0.24fr)] lg:items-start">
          <article className="rounded-3xl border border-border/75 bg-surface/90 p-6 shadow-[var(--shadow-card)] sm:p-9">
            <div className="mb-8 flex items-start gap-4">
              <SignalMark />
              <div>
                <p className="text-[11px] font-bold tracking-[0.17em] text-primary">{eyebrow}</p>
                <h1 className="mt-2 max-w-xl text-3xl font-extrabold tracking-tight text-text sm:text-4xl">{title}</h1>
                <p className="mt-3 text-sm text-text-muted">Última atualização: 7 de agosto de 2026</p>
              </div>
            </div>
            {kind === 'privacy' ? <PrivacyPolicy /> : kind === 'terms' ? <TermsOfService /> : <DataDeletionRequest />}
          </article>

          <aside className="rounded-3xl border border-primary/20 bg-[#071327] p-6 text-white shadow-[var(--shadow-card)]">
            <div className="h-1 w-16 rounded-full bg-gradient-to-r from-primary to-primary-2" />
            <p className="mt-6 text-[11px] font-bold tracking-[0.17em] text-primary-2">FUNILTRACK</p>
            <h2 className="mt-2 text-xl font-bold leading-snug">Do anúncio à conversa, com responsabilidade.</h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">Estas páginas explicam como o FunilTrack trata dados e como você mantém o controle sobre suas integrações e informações.</p>
            <Link to="/login" className="mt-6 inline-flex rounded-lg border border-white/15 px-3.5 py-2 text-sm font-semibold text-white transition hover:border-primary-2 hover:bg-white/5">Acessar o FunilTrack</Link>
          </aside>
        </div>
      </div>
    </main>
  )
}
