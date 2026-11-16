# Convya AI V19 — WhatsApp por QR + Vendedor IA

## Objetivo deste MVP

Uma conversa privada: conectar seu WhatsApp pelo menu **Dispositivos conectados**, conversar com **um número de teste autorizado**, aprovar um site na PageNova e deixar o Vendedor IA responder depois que o contato mandar uma mensagem.

**Sem WhatsApp Cloud API / Meta Developers.** A conexão usa **Baileys / WhatsApp Web**, biblioteca comunitária **não oficial**. Não existe garantia de disponibilidade; desconexões e restrições de conta são possíveis. Não use para disparos, scraping ou prospecção em massa.

## Rodando

O repositório está conectado ao serviço Railway `convya-ai`, ambiente `production` do projeto `desirable-reprieve` (URL preservada: https://convya-ai-production.up.railway.app/whatsapp.html).

`npm start` inicia servidor Node. `npm test` executa testes isolados sem redes externas. `npm run build` bloqueia deploy caso testes falhem.

Abra a interface e faça:

1. Em **Railway > convya-ai > Variables**, mantenha `CONVYA_WA_ADMIN_KEY` com um valor privado de pelo menos 16 caracteres. Esta chave não será mais digitada dentro do painel.
2. Defina `CONVYA_TEST_PHONE` como **o telefone do contato que concordou em testar**, com DDI e DDD, apenas números. Deve ser **diferente** do aparelho que você vinculará via QR.
3. **Uma única vez**, no navegador que será autorizado, abra `https://convya-ai-production.up.railway.app/whatsapp.html#access=SUA_CHAVE_PRIVADA`, substituindo `SUA_CHAVE_PRIVADA` pelo valor da variável da Railway (codifique caracteres especiais de URL). O navegador envia a chave ao servidor e a remove imediatamente da barra de endereço; o servidor cria um cookie HttpOnly, Secure, SameSite=Strict, válido por 30 dias. Não compartilhe esse link completo. Nas visitas seguintes, use a URL normal, sem o fragmento de acesso.
4. Na tela da Convya, clique em **Gerar QR Code** — sem preencher senha ou login.
4. No WhatsApp do aparelho que será vinculado: **Configurações / Menu → Dispositivos conectados → Conectar dispositivo**, escaneie o QR na tela da Convya.
5. Envie uma mensagem de teste **manual** para o número autorizado ou peça que esse contato envie uma. A conversa aparece na caixa à direita.
6. Para ativar respostas com IA depois de aprovar um site na PageNova, complete as variáveis adicionais abaixo.

### Vendedor IA e site PageNova

Além da senha e do telefone, configure no serviço Convya:
- `OPENAI_API_KEY`: chave de API da OpenAI (segredo);
- `PAGENOVA_CONVYA_HANDOFF_SECRET`: segredo aleatório de no mínimo 32 caracteres.

No serviço PageNova, configure o **mesmo** `PAGENOVA_CONVYA_HANDOFF_SECRET` e `NEXT_PUBLIC_CONVYA_AGENT_MVP=enabled`. A integração na PageNova está no **PR #201**, isolado e ainda não mesclado. A PageNova valida se o site pertence ao operador e foi publicado; entrega uma autorização assinada com validade curta. A Convya valida essa autorização antes de ligar o agente.

A IA não inicia conversas sozinha; só responde ao número autorizado quando receber uma mensagem. Se perguntarem sobre **preço, contrato, pagamento ou atendimento humano**, a IA transfere o atendimento. Se pedirem para parar, ela pausa.

### Persistência e segurança

- `CONVYA_WA_AUTH_DIR` (opcional): caminho para um **volume privado persistente da Railway**. Ex.: `/data/convya-wa-auth` (o volume deve estar montado em `/data`).
- Sem volume, credenciais de sessão ficam em diretório temporário e o QR pode precisar ser escaneado novamente após reinícios e deploys. Nunca inclua o diretório de autenticação no GitHub.
- **Uma instância** do serviço por sessão. A caixa de mensagens e o estado do Vendedor IA ficam na memória: mensagens e agente ativo são perdidos em reinícios.
- A autorização do navegador protege status, QR, envio, caixa de mensagens, ativação e pausa. A chave privada continua somente no servidor Railway e é utilizada uma vez por dispositivo autorizado; nunca compartilhe o link de ativação nem o QR publicamente.
- O código filtra mensagens de outros números e limita envios manuais; nenhum envio em massa ou follow-up foi habilitado.
- O fluxo ainda não foi homologado com QR real de um celular; testes automatizados simulam conexão e resposta.

### API do conector QR (autorização Bearer admin)

- `GET /api/wa-web/status` — status e QR.
- `POST /api/wa-web/connect` — inicia conexão por QR.
- `POST /api/wa-web/disconnect` — desconecta e revoga sessão.
- `GET /api/wa-web/messages` — caixa de mensagens temporárias.
- `POST /api/wa-web/send` — envia texto manual, somente para o contato de teste.
- `GET /api/agent/status`, `POST /api/agent/activate`, `POST /api/agent/mode` — Vendedor IA.

A API oficial do WhatsApp foi retirada do servidor nesta versão. O CRM V16 e o motor de busca continuam preservados, mas **não** são usados nesta homologação.
