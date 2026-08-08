# Workflows n8n do FunilTrack

Os arquivos JSON desta pasta são exportações importáveis no n8n:

- `funiltrack-uazapi-ingress.json`: ponte opcional de compatibilidade para a
  instância inicial. As novas empresas recebem webhook direto, exclusivo e
  assinado pelo backend; isso preserva o contexto do cliente sem depender de
  uma variável global no n8n.
- `funiltrack-health.json`: consulta `/api/health` a cada cinco minutos e registra um diagnóstico sanitizado no histórico do n8n.
- `funiltrack-meta-sync.json`: a cada 30 minutos solicita ao backend a sincronização dos últimos três dias da Meta Marketing API (campanhas, conjuntos, anúncios e Insights).
- `funiltrack-meta-conversions.json`: a cada minuto solicita o processamento da fila idempotente de `Lead`, `QualifiedLead` e `Purchase` pela Meta Conversions API.

## Ativação segura

1. No n8n, importe os quatro JSONs em **Workflows → Import from File**.
2. Confirme que o webhook do primeiro workflow está em `POST /webhook/funiltrack/uazapi`.
3. Configure no serviço n8n a variável `FUNILTRACK_WEBHOOK_TOKEN` com o mesmo valor de `WEBHOOK_TOKEN` do backend. O JSON referencia essa variável sem armazenar o segredo.
4. Configure no Coolify do FunilTrack:

   `N8N_UAZAPI_WEBHOOK_URL=https://SEU_N8N/webhook/funiltrack/uazapi`

5. Para cada empresa nova, abra **Configurações → Integrações da empresa**, salve a UazAPI dela e depois use **WhatsApp → Configurar webhook**. O backend registrará uma URL direta com `companyId` e segredo único, para os eventos `messages`, `messages_update`, `connection` e `history`, excluindo `wasSentByApi` para evitar loop.
6. Os workflows Meta podem ficar ativos: os endpoints agendados sincronizam e processam todas as empresas com integração Meta habilitada. O workflow de entrada UazAPI é opcional e fica reservado à rota global legada da empresa inicial.

O workflow de entrada não guarda o segredo no JSON: ele apenas repassa o segredo recebido na URL ao endpoint do FunilTrack, que faz a comparação de forma segura. Não coloque tokens em Code nodes ou em URLs fixas.

O healthcheck é independente de login porque consulta somente `/api/health`. Para um monitor que consulte o status da instância, crie uma credencial Header Auth no n8n para `Authorization: Bearer <API_TOKEN>` e aponte um HTTP Request para `/api/whatsapp/status`; o token deve ficar na credencial, nunca no workflow.

Os workflows Meta chamam endpoints autenticados pelo header `x-webhook-token`; eles não recebem token da Meta. Cada token Meta fica criptografado somente no backend, no respectivo workspace, que chama a Marketing API e a Conversions API. Para validar eventos de uma empresa em desenvolvimento, salve o código de teste daquela empresa nas integrações.

O n8n não inventa dados de matching. Se um formulário/CRM first-party recebeu
`clientIp`, `clientUserAgent`, `fbp`, `fbc` ou `ctwaClid`, preserve esses
campos no payload ao encaminhá-lo ao FunilTrack. A API valida IP IPv4/IPv6 e
envia os valores corretos à Conversions API. O IP e o user-agent do próprio
n8n/UazAPI são infraestrutura, não o navegador do lead, e não devem ser
copiados para esses campos.

## Fluxo multiempresa

Os endpoints Meta agendados não aceitam `companyId` vindo do n8n: o backend
descobre internamente as integrações habilitadas e executa cada empresa no
escopo correto. Isso evita que uma automação com token global consiga escrever
dados em um workspace errado. Para ingressos de WhatsApp, o segredo exclusivo
da URL de cada empresa é validado antes de qualquer persistência.
