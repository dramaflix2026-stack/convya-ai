# Convya AI — MVP Vendedor IA (integração com PageNova)

**Objetivo único:** homologar **uma conversa real com o seu próprio WhatsApp** depois da aprovação explícita de um site publicado na PageNova. Sem busca de leads, mensagens em massa, automações de follow-up ou cobrança.

## Fluxo

1. Gere e publique um site no Builder V2 da PageNova.
2. Com a feature flag ativada, clique **Aprovar site e testar Vendedor IA**.
3. A PageNova verifica a autenticação, a propriedade e a publicação; emite uma autorização HMAC de 10 minutos sem incluir telefone nem dados de lead.
4. A Convya, em `/whatsapp.html?handoff=...`, exige senha admin, valida a assinatura e associa o site ao **único** `CONVYA_TEST_PHONE`.
5. O operador clica **Ativar IA neste site** e, manualmente, envia o template de teste `hello_world` usando o número de teste da Meta para seu celular (cadastre o destinatário na Meta antes).
6. Quando você **responde pelo WhatsApp pessoal**, a Cloud API entrega o webhook assinado; a Convya chama a Responses API (OpenAI) e envia uma resposta **somente a esse telefone** dentro da janela de atendimento.
7. A IA se identifica como assistente de IA, compartilha o link do site aprovado, trata dúvidas simples e não inventa preços/condições. **Pedir humano, preço, contrato ou pagamento → transferência para humano**; **não quero/parar → pausa**.
8. Na tela, você pode pausar, assumir ou retomar o atendimento. Há teto de 15 respostas da IA por sessão.

## Configuração segura — todas as credenciais são do SERVIDOR

Para a **Convya** em Railway:

| Variável | Finalidade |
| --- | --- |
| `CONVYA_WA_ADMIN_KEY` | Senha de administrador de **16+ caracteres**. Digite-a somente em `/whatsapp.html`. |
| `CONVYA_TEST_PHONE` | **Somente seu telefone** de teste: DDI+DDD+número, dígitos. Bloqueia envio a outros destinatários via interface manual. |
| `META_WA_ACCESS_TOKEN` | Token da Meta WhatsApp Cloud API. |
| `META_WA_PHONE_NUMBER_ID` | Phone Number ID do número de teste da Meta. |
| `META_WA_APP_SECRET` | Segredo do app da Meta (para checar a assinatura do webhook). |
| `META_WA_VERIFY_TOKEN` | Código escolhido por você; deve coincidir com o webhook cadastrado na Meta. |
| `PAGENOVA_CONVYA_HANDOFF_SECRET` | Segredo aleatório de **32+ caracteres**, **idêntico** ao definido na PageNova. |
| `OPENAI_API_KEY` | Chave da API de IA para respostas automáticas. |
| `CONVYA_AGENT_MODEL` | Opcional. Padrão `gpt-4.1-mini`; defina um modelo disponível no seu projeto. |

**Na PageNova**: `PAGENOVA_CONVYA_HANDOFF_SECRET` (mesmo valor) e `NEXT_PUBLIC_CONVYA_AGENT_MVP=enabled`.

**Webhooks na Meta:** URL `https://SEU-DOMINIO-DA-CONVYA/api/whatsapp/webhook`, campo `messages`, e Verify Token igual ao configurado. A Convya exige `X-Hub-Signature-256`. O webhook não autentica o usuário da PageNova; ele apenas reconhece eventos assinados da Meta.

**Não** compartilhe tokens, segredos ou senhas pelo chat e nunca os adicione ao GitHub.

## APIs

- `GET /api/agent/status` — estado da sessão e prontidão, com senha admin.
- `POST /api/agent/activate` — ativação com autorização HMAC da PageNova, senha admin e todas as variáveis prontas.
- `POST /api/agent/mode` — alterna entre `active`, `paused` e `human`.
- `GET/POST /api/whatsapp/webhook` — verificação e recebimento Meta.
- `POST /api/whatsapp/send` — envio manual do template ou texto, sob senha admin e telefone restrito.
- `GET /api/whatsapp/messages` — mensagens temporárias da sessão.

## Testes

Execute `npm test`. `npm run build` roda testes Node e verificações de sintaxe e impede o build se houver falhas.

Teste integrado **com stubs**, sem enviar mensagens a número real: assinatura aprovada/alterada/expirada, um telefone, resposta simulada do agente, preço/humano, pausa/opt-out, webhook HMAC e isolamento administrativo. **Não** equivale a teste com a Meta e OpenAI em produção.

## Limitações importantes do MVP

- O estado de conversas e do agente é **somente na memória**. Reiniciar/deployar perde histórico e aprovação ativa. Uma instância é requisito até existir persistência.
- Na fase de teste, ainda **não existe** autenticação multiusuário, cobrança, agendamento de follow-up, pagamento, CRM persistido na Convya nem gestão de múltiplos números.
- Sem um `CONVYA_TEST_PHONE`, senha admin, app Meta, OpenAI e segredo compartilhado, a IA não é ativada.
- O agente **não inicia mensagens**; o template inicial é enviado manualmente e só ao número cadastrado. Consentimento/opt-in e regras do WhatsApp continuam obrigatórios.
- Em indisponibilidade da IA ou erro ao enviar resposta, o agente para e marca a sessão para atendimento humano; **não** presume sucesso da venda.
- Se a Railway não possui serviço Convya, é necessário restaurar o serviço do GitHub `dramaflix2026-stack/convya-ai` antes de testar externamente.

## PageNova

A integração da PageNova está no PR **#201** (branch isolada e feature flag desligada por padrão). O gerador, o motor universal, o editor, a publicação atual, o CRM e o Machine Learning continuam intocados. **Não mescle ou publique por conta de um teste simulado**: revise o PR e faça uma única homologação com número de teste primeiro.
