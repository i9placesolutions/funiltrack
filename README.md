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

## Empresas, acessos e isolamento de dados

O FunilTrack funciona como uma plataforma **multiempresa**. Cada cadastro cria
uma empresa (workspace) própria, e o usuário que a criou é o `owner`. O owner
pode criar outros workspaces, convidar usuários já cadastrados e atribuir os
papéis `owner`, `admin` ou `member`.

Todas as consultas e escritas de campanhas, métricas, leads, alertas,
conversas, eventos e conversões recebem o contexto da empresa no backend. O
PostgreSQL reforça essa separação com `company_id`, chaves estrangeiras
compostas e índices por empresa; trocar o identificador no navegador não dá
acesso a outra empresa sem uma associação válida no banco.

Há um único app central da Meta — o app **FunilTrack/i9Place**. Uma empresa
cliente não precisa criar outro app da Meta: ela precisa conceder acesso aos
ativos dela (conta de anúncios e Dataset/Pixel) pelo botão **Conectar Meta**.
O owner/admin escolhe somente os ativos que a Meta listou após a autorização;
não cola token, ID de Pixel ou Dataset. O token devolvido à plataforma é
guardado cifrado no backend e nunca é entregue ao navegador.

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

Para cada cliente, salve URL base, nome da instância e token da UazAPI em
**Configurações → Integrações da empresa**. O backend registra uma URL de
webhook exclusiva com segredo por empresa e armazena apenas o hash desse
segredo. Assim, QR Code, mensagens e histórico de um WhatsApp não se misturam
com os de outro cliente.

No Coolify, defina `INTEGRATIONS_ENCRYPTION_KEY` (32+ caracteres) antes de
salvar credenciais de clientes. `UAZAPI_BASE_URL` e `UAZAPI_TOKEN` servem
apenas como bootstrap compatível da empresa inicial; `UAZAPI_ADMIN_TOKEN` é
necessário somente para a plataforma criar instâncias na conta UazAPI dela.

## Meta Ads: rastreamento real de anúncios e conversões

O painel não usa métricas mock quando está em produção. A integração Meta
consulta campanhas, conjuntos, anúncios e o endpoint de Insights pela
Marketing API e grava o resultado em `campaigns`, `ad_sets`, `ads` e
`daily_metrics`. Mensagens novas e mudanças para `qualificado` ou `vendido`
geram eventos idempotentes em `meta_conversion_events`. O backend tenta a fila
logo após a mudança e também na rotina automática; o workflow n8n é uma
redundância opcional, não a única forma de enviar a Conversions API.

### Matching da Conversions API

Cada evento `Lead`, `QualifiedLead` ou `Purchase` envia telefone normalizado
em SHA-256 e um `external_id` SHA-256. Quando a origem tiver esses dados, o
evento também envia sem hash os parâmetros oficiais de matching da Meta:
`client_ip_address` (IPv4 ou IPv6), `client_user_agent`, `fbp`, `fbc` e
`ctwa_clid`.

O endpoint protegido de entrada de leads aceita estes campos opcionais:

```json
{
  "clientIp": "2001:db8:85a3::8a2e:370:7334",
  "clientUserAgent": "Mozilla/5.0 ...",
  "fbp": "fb.1.1596403881668.1116446470",
  "fbc": "fb.1.1554763741205.<fbclid>",
  "ctwaClid": "..."
}
```

O backend valida o IP antes de enviá-lo e aproveita IP/UA do próprio request
somente se ele parecer uma requisição de navegador. Webhooks da UazAPI e do
n8n não carregam o IP/UA real da pessoa que enviou uma mensagem, portanto eles
**não** são usados como substitutos. A UazAPI preserva `ctwa_clid` e `fbclid`
quando a referência os entrega; na ausência de `fbc`, o backend monta o valor
no formato oficial a partir do `fbclid` recebido.

No detalhe do lead, owner/admin vê o IP completo quando ele foi capturado;
membros recebem somente a versão mascarada. A tela também mostra se `_fbp`,
`_fbc`, `fbclid`, `ctwa_clid` e user-agent estavam disponíveis, além da fila
por evento (`na fila`, `enviando`, `aceito` ou `falhou`). `Aceito` indica que a
Meta respondeu com sucesso — não é uma promessa de atribuição ao anúncio.

O cliente que envia dados first-party é responsável por coletá-los com base
legal/consentimento aplicável e por não encaminhar IP, cookies ou user-agent
inventados. Isso melhora o Event Match Quality sem reportar dados errados.

Antes de liberar o botão no painel, a plataforma configura uma única vez no
Coolify `META_APP_ID`, `META_APP_SECRET`, `META_BUSINESS_LOGIN_CONFIG_ID` e
`META_OAUTH_REDIRECT_URI`. A URI deve ser cadastrada exatamente no Meta
Developers como URI de redirecionamento OAuth válida. A configuração Business
Login deve solicitar os ativos e permissões aprovados para a integração de
parceiro da Conversions API. As variáveis globais de token/conta/Dataset são
somente bootstrap compatível da empresa inicial i9Place; não devem ser usadas
para cadastrar clientes novos.

O app central da Meta deve estar vinculado ao Business da plataforma e ter as
permissões/aprovações compatíveis com os ativos que serão lidos. Cada cliente
concede acesso à própria conta de anúncios/Dataset/Pixel no fluxo oficial de
autorização. A plataforma não consegue consultar ativos que o Business cliente
não compartilhou.

O token não é enviado ao navegador nem versionado. O backend sincroniza
automaticamente todas as empresas que têm uma integração Meta habilitada. Por
padrão, essa rotina executa na inicialização e a cada 30 minutos, atualizando
os últimos três dias para capturar alterações e métricas recentes. Ajuste
`META_SYNC_ENABLED`, `META_SYNC_INTERVAL_MINUTES` e
`META_SYNC_LOOKBACK_DAYS` no ambiente do backend quando necessário.

A rota autenticada `POST /api/meta/sync` continua disponível para uma
atualização manual do workspace selecionado. A rota protegida
`POST /api/webhooks/meta/sync` e o workflow n8n permanecem como opção externa,
útil quando o n8n já é o orquestrador da instalação. A configuração do app e
do token é feita no Meta Developers/Business Manager; UazAPI continua sendo o
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
