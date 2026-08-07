# Workflows n8n do FunilTrack

Os arquivos JSON desta pasta são exportações importáveis no n8n:

- `funiltrack-uazapi-ingress.json`: recebe o webhook da UazAPI, valida a presença do segredo, encaminha o payload bruto para o endpoint autenticado do FunilTrack e sempre responde 200, 401 ou 502 de forma explícita. O HTTP Request usa três tentativas com espera de 5 segundos.
- `funiltrack-health.json`: consulta `/api/health` a cada cinco minutos e registra um diagnóstico sanitizado no histórico do n8n.
- `funiltrack-meta-sync.json`: a cada 30 minutos solicita ao backend a sincronização dos últimos três dias da Meta Marketing API (campanhas, conjuntos, anúncios e Insights).
- `funiltrack-meta-conversions.json`: a cada minuto solicita o processamento da fila idempotente de `Lead`, `QualifiedLead` e `Purchase` pela Meta Conversions API.

## Ativação segura

1. No n8n, importe os quatro JSONs em **Workflows → Import from File**.
2. Confirme que o webhook do primeiro workflow está em `POST /webhook/funiltrack/uazapi`.
3. Configure no serviço n8n a variável `FUNILTRACK_WEBHOOK_TOKEN` com o mesmo valor de `WEBHOOK_TOKEN` do backend. O JSON referencia essa variável sem armazenar o segredo.
4. Configure no Coolify do FunilTrack:

   `N8N_UAZAPI_WEBHOOK_URL=https://SEU_N8N/webhook/funiltrack/uazapi`

5. Depois de salvar/redeployar o app, abra **WhatsApp → Configurar webhook**. O backend registrará a URL com o segredo e os eventos `messages`, `messages_update`, `connection` e `history`, excluindo `wasSentByApi` para evitar loop.
6. Ative os workflows somente depois de o endpoint público do n8n responder. O fallback direto `/api/whatsapp/uazapi-webhook` continua disponível quando `N8N_UAZAPI_WEBHOOK_URL` estiver vazio.

O workflow de entrada não guarda o segredo no JSON: ele apenas repassa o segredo recebido na URL ao endpoint do FunilTrack, que faz a comparação de forma segura. Não coloque tokens em Code nodes ou em URLs fixas.

O healthcheck é independente de login porque consulta somente `/api/health`. Para um monitor que consulte o status da instância, crie uma credencial Header Auth no n8n para `Authorization: Bearer <API_TOKEN>` e aponte um HTTP Request para `/api/whatsapp/status`; o token deve ficar na credencial, nunca no workflow.

Os workflows Meta chamam endpoints autenticados pelo header `x-webhook-token`; eles não recebem token da Meta. O `META_ACCESS_TOKEN` fica somente no backend, que chama a Marketing API e a Conversions API. Para validar eventos em desenvolvimento, configure `META_TEST_EVENT_CODE` no Coolify.

## Limite atual de acesso

O n8n instalado no Coolify está saudável, mas a sessão de automação disponível abriu a tela de login. Por isso os arquivos estão prontos para importação, porém não foram ativados remotamente nesta execução. A conexão UazAPI direta do backend não depende dessa ativação.
