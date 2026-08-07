import { useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../../components/brand/BrandLogo'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useApp } from '../../hooks/useApp'

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18M10.58 10.58a2 2 0 002.83 2.83M9.88 4.24A10.8 10.8 0 0112 4c5 0 8.27 4.11 9 5-.26.32-.86 1.06-1.76 1.84M6.71 6.71C4.56 8.17 3.39 9.74 3 10c.73.89 4 5 9 5a9.2 9.2 0 003.11-.54" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  )
}

export default function AuthPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { login, register } = useApp()
  const isRegister = location.pathname === '/register'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const title = isRegister ? 'Crie seu workspace' : 'Bem-vindo de volta'
  const subtitle = isRegister
    ? 'Comece a acompanhar campanhas, leads e conversas em um só lugar.'
    : 'Entre para continuar acompanhando seu funil.'

  const passwordHint = useMemo(() => {
    if (!isRegister || password.length === 0) return null
    const valid = password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password)
    return valid ? 'Senha forte o suficiente.' : 'Use 8 caracteres, com letras e números.'
  }, [isRegister, password])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (isRegister && password !== confirmPassword) {
      setError('As senhas não conferem.')
      return
    }
    setBusy(true)
    try {
      if (isRegister) await register(name, email, password)
      else await login(email, password)
      navigate('/', { replace: true })
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Não foi possível concluir o acesso.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-dvh grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,560px)] bg-bg">
      <section className="hidden lg:flex relative overflow-hidden bg-[#0a0f1e] p-12 flex-col justify-between">
        <div className="absolute -top-36 -left-24 h-[420px] w-[420px] rounded-full bg-primary/20 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-36 right-0 h-[520px] w-[520px] rounded-full bg-primary-2/15 blur-3xl" aria-hidden="true" />
        <div className="relative z-10">
          <BrandLogo variant="wordmark" size={46} className="max-w-[240px]" />
          <p className="mt-6 max-w-md text-4xl font-display font-extrabold leading-tight text-white">
            O caminho entre o anúncio e a venda, finalmente visível.
          </p>
          <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">
            Centralize investimento, leads, estágios do funil e WhatsApp em uma operação que sua equipe consegue acompanhar.
          </p>
        </div>
        <div className="relative z-10 grid grid-cols-3 gap-3 max-w-lg">
          {[
            ['Métricas', 'Campanhas em foco'],
            ['Leads', 'Cada conversa importa'],
            ['WhatsApp', 'QR Code pela UazAPI'],
          ].map(([label, detail]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-sm font-semibold text-white">{label}</p>
              <p className="mt-1 text-[11px] leading-4 text-slate-400">{detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-8 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <BrandLogo variant="wordmark" size={38} className="max-w-[210px]" />
          </div>
          <div className="mb-8">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">FunilTrack</p>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-text">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-text-muted">{subtitle}</p>
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            {isRegister && (
              <Input
                label="Nome"
                placeholder="Como podemos chamar você?"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            )}
            <Input
              label="E-mail"
              type="email"
              placeholder="voce@empresa.com"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <div className="relative">
              <Input
                label="Senha"
                type={showPassword ? 'text' : 'password'}
                placeholder={isRegister ? 'Mínimo de 8 caracteres' : 'Digite sua senha'}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-8 flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                <EyeIcon hidden={!showPassword} />
              </button>
              {passwordHint && (
                <p className={['mt-1.5 text-[11px]', passwordHint.startsWith('Senha') ? 'text-accent' : 'text-text-muted'].join(' ')}>
                  {passwordHint}
                </p>
              )}
            </div>
            {isRegister && (
              <Input
                label="Confirme sua senha"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            )}
            {error && (
              <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
                {error}
              </div>
            )}
            <Button type="submit" fullWidth size="lg" disabled={busy}>
              {busy ? 'Aguarde…' : isRegister ? 'Criar acesso' : 'Entrar no FunilTrack'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-text-muted">
            {isRegister ? 'Já possui um acesso?' : 'Ainda não possui um acesso?'}{' '}
            <Link className="font-semibold text-primary hover:text-primary-2" to={isRegister ? '/login' : '/register'}>
              {isRegister ? 'Entrar' : 'Criar conta'}
            </Link>
          </p>
          <p className="mt-10 text-center text-[11px] leading-5 text-text-muted">
            Sua sessão é protegida por cookie seguro e o backend nunca armazena a senha em texto puro.
          </p>
        </div>
      </section>
    </main>
  )
}
