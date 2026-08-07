import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'

export interface PlaceholderPageProps {
  /** Nome da feature (ex.: "Dashboard"). */
  title: string
  description?: string
}

/**
 * Página-placeholder padrão da fase de fundação.
 * As equipes de feature substituirão o conteúdo de cada pasta mantendo os
 * nomes de arquivo definitivos.
 */
export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="px-4 pt-4">
      <Card>
        <EmptyState
          icon="🚧"
          title={`${title} — em construção`}
          description={
            description ??
            'Esta tela será implementada na próxima fase. A estrutura de rotas, dados e navegação já está pronta.'
          }
        />
      </Card>
    </div>
  )
}
