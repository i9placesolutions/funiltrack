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

## Autenticação e WhatsApp UazAPI

O acesso real da aplicação usa cadastro/login, cookie de sessão `httpOnly`,
expiração configurável, logout e troca de senha. A senha nunca é armazenada em
texto puro: o backend usa `scrypt` com salt por usuário. O primeiro usuário
cadastrado recebe o papel `owner`; para impedir novos cadastros depois do
onboarding, defina `AUTH_ALLOW_REGISTRATION=false` no ambiente do backend.

Na rota **WhatsApp**, o backend chama a UazAPI sem expor o token ao navegador:

- `GET /api/whatsapp/status` consulta a instância e atualiza o QR Code;
- `POST /api/whatsapp/connect` inicia a conexão sem informar telefone, portanto gera QR Code;
- `POST /api/whatsapp/configure-webhook` registra mensagens, conexão e histórico;
- `POST /api/whatsapp/send/text` envia e grava a mensagem na timeline do lead;
- `POST /api/whatsapp/uazapi-webhook` recebe eventos, deduplica e persiste mensagens.

Configure `UAZAPI_BASE_URL` e `UAZAPI_TOKEN` no Coolify. Para criar uma
instância pelo próprio painel, use também `UAZAPI_ADMIN_TOKEN` e uma
`UAZAPI_ENCRYPTION_KEY` com pelo menos 32 caracteres. Para utilizar o n8n como
ponte, importe os arquivos de `docs/n8n/` e só então preencha
`N8N_UAZAPI_WEBHOOK_URL`.

## Meta Ads: rastreamento real de anúncios e conversões

O painel não usa métricas mock quando está em produção. A integração Meta
consulta campanhas, conjuntos, anúncios e o endpoint de Insights pela
Marketing API e grava o resultado em `campaigns`, `ad_sets`, `ads` e
`daily_metrics`. Mensagens novas e mudanças para `qualificado` ou `vendido`
geram eventos idempotentes em `meta_conversion_events`; o workflow n8n pode
processá-los pela Conversions API.

No Coolify, configure no backend:

- `META_ACCESS_TOKEN` e `META_AD_ACCOUNT_ID` para ler campanhas e métricas;
- `META_DATASET_ID` (ou `META_PIXEL_ID`) para enviar `Lead`, `QualifiedLead` e
  `Purchase` à Meta;
- opcionalmente `META_TEST_EVENT_CODE` durante o teste no Events Manager.

O token não é enviado ao navegador nem versionado. A rota autenticada
`POST /api/meta/sync` sincroniza um período; o workflow agendado usa
`POST /api/webhooks/meta/sync` com `WEBHOOK_TOKEN`. A configuração do app e do
token é feita no Meta Developers/Business Manager; UazAPI continua sendo o
canal de WhatsApp conectado por QR Code.

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
