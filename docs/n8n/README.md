# Workflows n8n do FunilTrack

Os arquivos JSON desta pasta são exportações importáveis no n8n:

- `funiltrack-uazapi-ingress.json`: recebe o webhook da UazAPI, valida a presença do segredo, encaminha o payload bruto para o endpoint autenticado do FunilTrack e sempre responde 200, 401 ou 502 de forma explícita. O HTTP Request usa três tentativas com espera de 5 segundos.
- `funiltrack-health.json`: consulta `/api/health` a cada cinco minutos e registra um diagnóstico sanitizado no histórico do n8n.

## Ativação segura

1. No n8n, importe os dois JSONs em **Workflows → Import from File**.
2. Confirme que o webhook do primeiro workflow está em `POST /webhook/funiltrack/uazapi`.
3. Configure no Coolify do FunilTrack:

   `N8N_UAZAPI_WEBHOOK_URL=https://SEU_N8N/webhook/funiltrack/uazapi`

4. Depois de salvar/redeployar o app, abra **WhatsApp → Configurar webhook**. O backend registrará a URL com o segredo e os eventos `messages`, `messages_update`, `connection` e `history`, excluindo `wasSentByApi` para evitar loop.
5. Ative o workflow somente depois de o endpoint público do n8n responder. O fallback direto `/api/whatsapp/uazapi-webhook` continua disponível quando `N8N_UAZAPI_WEBHOOK_URL` estiver vazio.

O workflow de entrada não guarda o segredo no JSON: ele apenas repassa o segredo recebido na URL ao endpoint do FunilTrack, que faz a comparação de forma segura. Não coloque tokens em Code nodes ou em URLs fixas.

O healthcheck é independente de login porque consulta somente `/api/health`. Para um monitor que consulte o status da instância, crie uma credencial Header Auth no n8n para `Authorization: Bearer <API_TOKEN>` e aponte um HTTP Request para `/api/whatsapp/status`; o token deve ficar na credencial, nunca no workflow.

## Limite atual de acesso

O n8n instalado no Coolify está saudável, mas a sessão de automação disponível abriu a tela de login. Por isso os arquivos estão prontos para importação, porém não foram ativados remotamente nesta execução. A conexão UazAPI direta do backend não depende dessa ativação.
