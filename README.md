# Convya AI — V17 (WhatsApp Cloud API de teste)

Esta implantação na Railway mantém o CRM demonstrativo da V16 e acrescenta a página **WhatsApp real** em `/whatsapp.html`.

## Primeiro teste com o seu celular

Use o **número de teste fornecido pela Meta**, sem mover ou desvincular seu WhatsApp pessoal. Em Meta for Developers > WhatsApp > API Setup, adicione seu número pessoal como destinatário autorizado e confirme a verificação.

No serviço Railway `convya-ai > Variables`, configure **exclusivamente no servidor**:

| Variável | Origem |
| --- | --- |
| `CONVYA_WA_ADMIN_KEY` | Escolha uma senha aleatória de pelo menos 16 caracteres; usada na página WhatsApp |
| `META_WA_ACCESS_TOKEN` | Meta > WhatsApp > API Setup (token com permissão de envio) |
| `META_WA_PHONE_NUMBER_ID` | Meta > WhatsApp > API Setup (Phone Number ID, **não** o telefone) |
| `META_WA_VERIFY_TOKEN` | Escolha um código aleatório longo para validar o webhook e configure o mesmo na Meta |
| `META_WA_APP_SECRET` | Meta Developers > App Settings > Basic > App Secret |
| `META_WA_GRAPH_VERSION` | Opcional, padrão `v26.0`; revise se necessário |

Configure no painel Meta o webhook `https://convya-ai-production.up.railway.app/api/whatsapp/webhook`, selecione o evento **messages** e use o mesmo VERIFY_TOKEN. A Convya valida a assinatura `X-Hub-Signature-256` com o App Secret.

Abra `/whatsapp.html`, entre com sua senha de administrador, escolha seu telefone de teste (DDI + DDD, somente números), envie o template **hello_world**, responda pelo celular e observe o retorno na caixa de entrada. Mensagens de texto livres só são enviadas durante as 24 horas após resposta recebida.

## Limites desta primeira homologação

- A integração real **só é ativada** depois da configuração na Railway e na Meta. Antes disso a página fornece uma **simulação fictícia** isolada, sem WhatsApp.
- **Não há QR Code** para vincular WhatsApp pessoal na API oficial. Se quiser usar seu número do app WhatsApp Business como remetente e continuar usando o aplicativo, o caminho é **Coexistência / Embedded Signup**, sujeito à elegibilidade da Meta e a uma integração própria.
- A caixa de mensagens é **temporária na memória da instância**: reinícios e deploys apagam histórico. Para operação comercial, precisamos banco de dados, autenticação multiusuário e retenção adequada.
- **Não** envia mensagens em massa, automações ou respostas por IA.
- Mantenha o repositório privado se possível; nunca registre tokens, telefones de clientes ou senhas no Git.

## Comandos e rotas

`npm start` — Railway fornece `PORT`. `npm test` — testes Node HTTP e webhook.

- `/health` — disponibilidade do servidor
- `/whatsapp.html` — interface de homologação
- `GET /api/whatsapp/config` — configuração (somente com Bearer admin)
- `GET /api/whatsapp/messages` — mensagens temporárias (somente com Bearer admin)
- `POST /api/whatsapp/send` — envio manual pelo Graph API (somente com Bearer admin)
- `GET /api/whatsapp/webhook` — challenge oficial Meta
- `POST /api/whatsapp/webhook` — recebimento, HMAC obrigatório
- `/api/places/*` — funções demonstrativas anteriores da V16, não alteradas

Para os módulos de prospecção da V16, a chave `GOOGLE_MAPS_API_KEY` continua opcional. O WhatsApp não depende dela.
