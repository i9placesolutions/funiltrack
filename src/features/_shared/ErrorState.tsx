import { Button } from '../../components/ui/Button'

export interface ErrorStateProps {
  message?: string
  /** Reexecuta as queries que falharam. */
  onRetry?: () => void
}

/** Estado de erro padrão com ação de retry. */
export function ErrorState({
  message = 'Não foi possível carregar os dados. Verifique sua conexão.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 text-center py-10 px-6"
    >
      <div className="text-danger text-3xl leading-none" aria-hidden="true">
        ⚠
      </div>
      <p className="text-sm text-text-muted max-w-xs">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  )
}
