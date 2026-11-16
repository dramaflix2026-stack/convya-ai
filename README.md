# Convya AI V19 — WhatsApp QR sem login
Acesso direto: https://convya-ai-production.up.railway.app/whatsapp.html

Nesta versão **não existe senha, cadastro, autenticação do navegador ou link de ativação**. Abra a página e clique em **Gerar QR Code**.

**Alerta importante:** a URL é pública. Sem autenticação, qualquer pessoa que conheça o endereço pode acessar o QR, ler a caixa de mensagens de teste, iniciar ou encerrar a conexão e enviar mensagens para o número autorizado. Não use essa configuração para dados confidenciais nem em operação comercial. Para uso além da homologação, proteja o serviço em nível de rede/proxy ou adote uma autenticação sem senha.

## Teste básico
1. Na Railway, mantenha somente `CONVYA_TEST_PHONE` como número **destinatário** autorizado, usando DDI+DDD+número (sem `+`); ele deve ser diferente do aparelho que você conectará por QR.
2. Abra `/whatsapp.html` e clique em **Gerar QR Code**.
3. No WhatsApp do aparelho, abra **Dispositivos conectados → Conectar dispositivo** e escaneie o QR.
4. Converse exclusivamente com o destinatário de teste autorizado.
5. Para ligar o agente comercial, também configure `OPENAI_API_KEY` e `PAGENOVA_CONVYA_HANDOFF_SECRET` na Railway, além do segredo idêntico na PageNova. A aprovação de site da PageNova segue em PR separado (#201).

A integração por Baileys usa protocolo **não oficial** do WhatsApp Web, sujeito a restrições e desconexões. Não habilite disparos em massa ou contatos sem consentimento. O histórico de mensagens e a sessão ativa do agente são mantidos apenas na memória; podem desaparecer ao reiniciar. A sessão de login do WhatsApp só persiste se houver volume privado configurado por `CONVYA_WA_AUTH_DIR`.

## APIs
- `GET /api/wa-web/status`: estado, incluindo QR.
- `POST /api/wa-web/connect`: gerar QR.
- `POST /api/wa-web/disconnect`: desconectar.
- `GET /api/wa-web/messages`: mensagens de teste.
- `POST /api/wa-web/send`: envio manual limitado ao número autorizado.
- `GET /api/agent/status`, `POST /api/agent/activate`, `POST /api/agent/mode`: Vendedor IA (só ativa após aprovação assinada do site e integração disponível).

`npm test` e `npm run build` executam testes. O build da Railway só é promovido se os testes passarem.
