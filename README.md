# FunilTrack

O **FunilTrack** é um console de tracking para quem anuncia e atende pelo WhatsApp: a métrica fica no gerenciador de anúncios, a conversa fica no WhatsApp, e ninguém enxerga o meio do caminho. Ele conecta campanhas, gasto e leads em um único painel — com dashboard de métricas, funil de estágios, central de alertas (orçamento estourado, CPL acima do alvo, pico de mensagens, lead sem resposta) e visão detalhada por campanha e por lead.

> **Nota:** o projeto possui backend real com PostgreSQL e Redis. Os dados determinísticos em `src/mocks/data` continuam disponíveis para demonstração e também podem ser carregados no banco com `pnpm db:seed`.

## Como rodar

Pré-requisitos: [Node.js](https://nodejs.org/) 20+ e [pnpm](https://pnpm.io/).

```bash
pnpm install     # instala as dependências
cp .env.example .env.local
pnpm seed        # (re)gera os dados demo determinísticos em src/mocks/data
pnpm db:migrate  # cria/atualiza as tabelas no PostgreSQL
pnpm db:seed     # carrega os dados demo no PostgreSQL (somente banco vazio)
pnpm dev:backend # API em http://localhost:3333 (outro terminal)
pnpm dev         # frontend em http://localhost:5173
```

O `.env.local` precisa apontar `DATABASE_URL` e `REDIS_URL` para as instâncias
locais ou para os serviços ligados no Coolify. Em desenvolvimento, o Vite
encaminha `/api` para a API na porta 3333. Para usar dados reais no frontend,
mantenha `VITE_USE_MOCKS=false`.

Build de produção:

```bash
pnpm build      # typecheck + build do frontend e backend
pnpm preview    # serve o build localmente (PWA ativo só em produção)
```

## Scripts

| Script          | Descrição                                                        |
| --------------- | ---------------------------------------------------------------- |
| `pnpm dev`      | Servidor de desenvolvimento com hot reload                       |
| `pnpm dev:backend` | API Fastify com migrations automáticas e health checks         |
| `pnpm build`    | Typecheck + build de produção do frontend e backend              |
| `pnpm start`    | Inicia o backend compilado e serve o build do frontend           |
| `pnpm db:migrate` | Aplica o schema PostgreSQL idempotente                         |
| `pnpm db:seed`  | Carrega os datasets demo no banco vazio                         |
| `pnpm preview`  | Serve o build de produção localmente                             |
| `pnpm typecheck`| Checagem de tipos TypeScript (strict)                            |
| `pnpm lint`     | ESLint                                                           |
| `pnpm test`     | Testes unitários com Vitest                                      |
| `pnpm seed`     | Gera os dados mock (`src/mocks/data/*.json`)                     |
| `pnpm icons`    | Regenera os ícones PWA (`public/icons/`, sem dependências nativas) |

## Stack

- **Vite 7** + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4** (design tokens via CSS variables, dark mode por `data-theme`)
- **React Router 7** (SPA) + **TanStack Query 5** (cache/estado de servidor)
- **recharts** (gráficos) + **@dnd-kit** (drag and drop do funil)
- **vite-plugin-pwa** (manifest + service worker/Workbox, offline e atualização "prompt")
- **Vitest** (testes unitários)
- **Fastify** + **PostgreSQL** (`pg`) + **Redis** (`ioredis`) no backend
- **Dockerfile** único para frontend/API no Coolify

## Estrutura de pastas (resumo)

```
src/
├── components/
│   ├── charts/        # gráficos (recharts) + paleta
│   ├── layout/        # AppShell (topbar + bottom nav)
│   └── ui/            # primitivos (Badge, Button, Card, Modal, Toast, banner PWA…)
├── context/           # estado global leve (AppContext)
├── features/          # páginas por domínio: dashboard, leads, funnel, alerts, config…
├── hooks/             # useApp, useTheme
├── lib/
│   ├── alerts/        # motor de regras de alertas (puro, testável) + targets
│   ├── api/           # fachada de API: factory (mock/http), tipos e clientes
│   ├── notifications/ # abstração de notificações (local hoje, Web Push no futuro)
│   ├── query/         # queryClient + query keys (TanStack Query)
│   └── format.ts      # formatadores pt-BR / BRL (centavos → R$)
├── mocks/data/        # datasets mock (JSON) gerados por pnpm seed
└── test/              # setup do Vitest (mock de localStorage)
server/
├── src/                # API Fastify, pool PostgreSQL, cache Redis e seed
├── migrations/         # schema persistente e índices
└── tsconfig.json       # compilação independente do backend
docs/                  # guias (ex.: MIGRATION.md — mock → backend real)
scripts/               # geradores (dados mock, ícones PWA)
public/icons/          # ícones PWA (192, 512, maskable, apple-touch)
```

## Convenções rápidas

- UI toda em **pt-BR**; valores monetários trafegam em **centavos** e são formatados por `formatBRL`.
- Componentes consomem dados **somente** pela fachada `src/lib/api` (`import { api } from '../../lib/api'`), nunca de `mockClient`/`httpClient` diretamente.
- O tema (claro/escuro/auto) é aplicado antes do primeiro paint (script inline no `index.html`).
