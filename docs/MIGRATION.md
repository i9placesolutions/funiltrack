# Backend real do FunilTrack

O FunilTrack já está integrado a um backend real. A fachada de API continua
isolando a UI, mas agora `VITE_USE_MOCKS=false` aponta para a API Fastify, que
persiste dados no PostgreSQL e usa Redis para cache com invalidação após
mutações.

## 1. Subir localmente

```bash
cp .env.example .env.local
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev:backend # terminal 1
pnpm dev         # terminal 2
```

Endpoints de saúde:

- `GET /api/health` — visão combinada da API, PostgreSQL e Redis;
- `GET /api/health/db` — conexão do PostgreSQL;
- `GET /api/health/redis` — conexão do Redis.

O backend também serve `dist/` quando iniciado com `pnpm start` ou dentro do
`Dockerfile`.

## 2. Fábrica de API e contratos

Toda a aplicação consome dados por um único ponto: `src/lib/api/index.ts`.

```ts
const useMocks = (import.meta.env.VITE_USE_MOCKS ?? 'false') === 'true'

export const api: ApiClient = useMocks ? mockClient : httpClient
```

Ou seja, existem duas implementações do contrato `ApiClient` (`src/lib/api/client.ts`):

- `mockClient.ts` — lê os JSONs de `src/mocks/data` (usado em demonstração);
- `httpClient.ts` — cliente real, apontando para `VITE_API_BASE_URL`.

Endpoints implementados:

- `GET /api/campaigns` · `GET /api/campaigns/:id`;
- `GET /api/metrics/daily?from=…&to=…&campaign_id=…`;
- `GET /api/leads?page=&page_size=&search=&stage=&campaign_id=&utm_source=` → `{ items, total, nextCursor }`;
- `GET /api/leads/:id` · `PATCH /api/leads/:id/stage`;
- `GET /api/leads/sources`;
- `GET /api/alerts` · `POST /api/alerts/:id/read`.

Defina as variáveis de ambiente (veja `.env.example`):

   ```bash
   VITE_USE_MOCKS=false
   VITE_API_BASE_URL=/api
   ```

Como a escolha é feita em tempo de build via `import.meta.env`, os mocks
deixam de ser usados quando `VITE_USE_MOCKS=false`.

> Os tipos de contrato vivem em `src/lib/api/types.ts`. Mantenha o backend aderente a eles (especialmente: valores monetários em **centavos** e datas ISO-8601).

## 3. Persistência e cache

`server/migrations/001_initial.sql` cria as entidades de campanhas, conjuntos,
anúncios, métricas diárias, leads, timeline e alertas. O schema usa centavos
para valores monetários, `timestamptz` para eventos e índices nas chaves
estrangeiras, filtros de funil e datas.

O Redis é usado por `ioredis` para cachear leituras de campanhas, métricas,
leads, alertas e origens UTM. Alterar estágio, marcar alerta, receber webhook
ou gravar métrica incrementa a versão do cache e força a próxima leitura no
PostgreSQL.

## 4. Mapeamento para a Meta Marketing API

O backend deve consultar a [Meta Marketing API](https://developers.facebook.com/docs/marketing-api) e converter para o contrato do FunilTrack. Recomenda-se um worker agendado (ex.: a cada 15 min) que persista `DailyMetric` por campanha.

| Campo FunilTrack (`DailyMetric`) | Origem na Meta Marketing API | Observações |
| --- | --- | --- |
| `spend` | `GET /act_<AD_ACCOUNT_ID>/insights?fields=spend` | A Meta devolve string em unidades inteiras da moeda (ex.: `"123.45"`); converter para **centavos** (int). |
| `impressions` | `fields=impressions` | Direto (inteiro). |
| `clicks` | `fields=clicks` | Cliques totais; se quiser só cliques em link, use `inline_link_clicks`. |
| `ctr` | `fields=ctr` | A Meta devolve percentual 0–100 (ex.: `3.42`); o contrato usa fração 0–1 → dividir por 100. |
| `cpc` | `fields=cpc` | Converter para centavos, como `spend`. |
| `leads` | `fields=actions` (action_type `lead` / `onsite_conversion.lead_grouped`) ou formulário de Instant Forms | Para campanhas de mensagens, considere também `action_type` de conversas iniciadas. |
| `cpl` | Derivado | `spend / leads` (em centavos) quando `leads > 0`; senão `0`. |
| `roas` | Derivado ou `fields=roas` | Se não houver receita rastreada, manter `0`. |
| `date` | Parâmetro `time_range` + `date_preset`/`date_start` | Granularidade diária (`time_increment=1`). |
| `campaignId` / `name` / `dailyBudget` | `GET /campaigns?fields=id,name,status,daily_budget` | `daily_budget` também é string → converter para centavos. |

Boas práticas:

- Use **Webhooks da Meta** (`ad_account`, `leadgen`) ou polling curto para reduzir latência; o campo `status` (`ACTIVE`/`PAUSED`/…) já espelha o enum da Meta.
- Respeite rate limits e pagine resultados (`after` cursor da Meta → não confundir com o `nextCursor` do FunilTrack, que é offset serializado).

## 5. Webhooks do n8n/WhatsApp e integrações externas

Os endpoints de entrada já estão disponíveis e exigem `x-webhook-token` igual
ao `WEBHOOK_TOKEN` configurado no backend:

- `POST /api/webhooks/whatsapp` — cria ou deduplica lead por telefone e grava a mensagem na timeline;
- `POST /api/webhooks/alerts` — grava/atualiza um alerta;
- `POST /api/webhooks/metrics` — faz upsert da métrica diária por campanha/data.

Os fluxos do n8n (WhatsApp/evolution, CRMs, planilhas etc.) entram como **webhooks HTTP no backend**, que por sua vez alimenta o contrato já consumido pelo app:

- **Mensagens/leads do WhatsApp** → um endpoint interno (ex.: `POST /webhooks/whatsapp`) recebe o payload do n8n e:
  - cria/atualiza o `Lead` (telefone → dedupe) e adiciona `LeadEvent`s (`mensagem_recebida`/`mensagem_enviada`) à `timeline`;
  - isso alimenta automaticamente a regra **"lead sem resposta"** (`src/lib/alerts/rules.ts`) e a timeline do `LeadDetailPage`.
- **Alertas externos** → `POST /webhooks/alerts` pode gravar `Alert` diretamente (a UI mescla alertas da API com os derivados no cliente via `mergeWithApiAlerts`, sem duplicar por `type`+`refId`).
- **Push de métricas** → se o n8n consolidar dados de outras fontes, basta escrever em `DailyMetric` respeitando o formato (datas `YYYY-MM-DD`, centavos).

No n8n, configure o nó **Webhook** (método POST, autenticação por header/token) apontando para esses endpoints. O app não precisa saber de onde vieram os dados — apenas consome a fachada.

As notificações in-app já existem: o motor de regras roda no cliente e a central de alertas exibe tudo. Para notificar fora do app, veja a seção de Web Push abaixo.

## 6. Web Push real (VAPID + PushManager)

A camada de notificações (`src/lib/notifications/service.ts`) já foi modelada por **canais** (`NotificationChannel`). Hoje existe o canal `local` (Notification API do navegador). Para Web Push:

1. **Gere as chaves VAPID** no backend (`npx web-push generate-vapid-keys`) e exponha a chave pública (ex.: `GET /vapid-public-key`).
2. **Implemente um novo canal** `web-push` em `src/lib/notifications/service.ts`:
   ```ts
   const registration = await navigator.serviceWorker.ready
   const subscription = await registration.pushManager.subscribe({
     userVisibleOnly: true,
     applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
   })
   await fetch(`${BASE_URL}/push/subscriptions`, {
     method: 'POST',
     body: JSON.stringify(subscription),
   })
   ```
   e adicione-o ao array `channels` (a interface de `notify()` permanece a mesma — o resto do app não muda).
3. **No backend**, ao receber a subscription, armazene por usuário; ao gerar um alerta (orçamento estourado, lead sem resposta…), envie com a lib [`web-push`](https://github.com/web-push-libs/web-push) usando o par VAPID privado.
4. **No service worker**, trate `push` e `notificationclick`. Importante: o SW atual é gerado pelo `vite-plugin-pwa` (Workbox, `generateSW`). Para listeners de push, migre para `injectRegister`/`strategies: injectManifest` com um `src/sw.ts` próprio (ou use o plugin Workbox de push no backend). O restante da config PWA (precache, runtime caching) se mantém.
5. Lembre-se: push exige **HTTPS** (exceto localhost) e funciona melhor com o app instalado/visitado ao menos uma vez.

## 7. Checklist de produção

- [x] Backend com endpoints do `httpClient.ts` implementados
- [x] PostgreSQL com migrations, constraints, índices e seed idempotente
- [x] Redis com cache e invalidação após mutações
- [x] Webhooks autenticados para WhatsApp, alertas e métricas
- [x] `VITE_USE_MOCKS=false` + `VITE_API_BASE_URL=/api` no exemplo de produção
- [x] Mutações `updateLeadStage`/`markAlertRead` persistidas
- [ ] Configurar credenciais da Meta/n8n no ambiente de produção
- [ ] Worker de sync da Meta Marketing API → `DailyMetric`/`Campaign`
- [ ] Apontar os fluxos reais do n8n para os webhooks autenticados
- [ ] (Opcional) Web Push com VAPID + canal `web-push`
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` passando no CI/deploy
