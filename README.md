# Convya AI V16

CRM de prospecção com demonstração local e integração preparada para Google Places (New).

## Railway

Start: `npm start` (Node.js 20+). O servidor usa a variável `PORT` definida pela Railway.

Para habilitar a busca real, configure `GOOGLE_MAPS_API_KEY` e `CONVYA_SEARCH_ACCESS_TOKEN` **somente nas variáveis do serviço Railway**. Nunca envie os valores pelo GitHub ou chat.

Sem essas variáveis, o teste integrado fictício funciona, mas a busca Google retorna `503`. Não há envio real de WhatsApp nem banco de dados — leads da demonstração ficam no `localStorage` do navegador.

Endpoints: `/health`, `/api/places/health` e `/api/places/search`.
