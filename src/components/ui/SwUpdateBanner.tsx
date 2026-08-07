/**
 * Banner discreto de atualização do PWA.
 *
 * Com `registerType: 'prompt'` (vite-plugin-pwa), o service worker novo
 * fica aguardando ativação até o usuário aceitar — este componente mostra
 * "Nova versão disponível" com ação de atualizar. Nada aparece quando o
 * service worker não está ativo (ex.: desenvolvimento).
 */
import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function SwUpdateBanner() {
  const [dismissed, setDismissed] = useState(false)

  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW()

  if (dismissed || (!needRefresh && !offlineReady)) return null

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-20 z-50 px-4 safe-bottom lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-[380px] lg:px-0"
    >
      <div className="animate-pop mx-auto max-w-sm lg:max-w-none glass text-text border border-primary/40 rounded-xl shadow-xl px-4 py-3 flex items-center gap-3">
        <p className="flex-1 text-sm">
          {needRefresh
            ? 'Nova versão disponível — atualizar para continuar em dia.'
            : 'Pronto para uso offline.'}
        </p>
        {needRefresh && (
          <button
            type="button"
            onClick={() => void updateServiceWorker(true)}
            className="shrink-0 text-sm font-semibold text-primary rounded px-2 py-1 hover:bg-surface-2 transition-colors"
          >
            Atualizar
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dispensar aviso"
          className="shrink-0 text-text-muted rounded p-1 hover:bg-surface-2 transition-colors"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
