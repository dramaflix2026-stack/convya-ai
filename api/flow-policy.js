'use strict';
// Shared customer-intent rules for both WhatsApp agent and the dry-run simulator.
const HANDOFF=/\b(humano|atendente|pessoa real|falar com algu[eé]m|contrato|pagamento|pre[cç]o|pre[cç]os|valores?|or[cç]amento|quanto custa|cart[aã]o|pix|boleto|comprar agora|fechar (neg[oó]cio|venda))\b/i;
const OPT_OUT=/\b(pare|parar|n[aã]o quero|n[aã]o me (chame|mande)|cancelar conversa|stop)\b/i;
function classify(text){
  const input=String(text||'');
  if(OPT_OUT.test(input))return 'opt_out';
  if(HANDOFF.test(input))return 'handoff';
  return 'normal';
}
module.exports={HANDOFF,OPT_OUT,classify};
