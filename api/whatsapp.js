'use strict';
/** Convya WhatsApp Cloud API testing adapter; no third-party npm packages.
 * No unsolicited automation. Messages live only in worker memory (temporary).
 * Do not put access tokens into frontend code or Git.
 */
const {createHmac,timingSafeEqual,randomUUID}=require('node:crypto');
const EVENTS=[],SEEN=new Set(),LAST_INBOUND=new Map(),LIMITS=new Map();
const MAX_EVENTS=250;
const digits=v=>String(v||'').replace(/\D/g,'');
const configured=()=>({
 admin:!!(process.env.CONVYA_WA_ADMIN_KEY&&process.env.CONVYA_WA_ADMIN_KEY.length>=16),
 send:!!(process.env.META_WA_ACCESS_TOKEN&&process.env.META_WA_PHONE_NUMBER_ID),
 webhook:!!(process.env.META_WA_APP_SECRET&&process.env.META_WA_VERIFY_TOKEN)
});
const secure=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length>0&&x.length===y.length&&timingSafeEqual(x,y)};
const sendJson=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
function event(e) {const v={id:e.id||randomUUID(),at:new Date().toISOString(),...e};EVENTS.push(v);if(EVENTS.length>MAX_EVENTS)EVENTS.splice(0,EVENTS.length-MAX_EVENTS);return v}
function recentLimit(ip,label,max=8) {const key=(ip||'unknown')+':'+label;const now=Date.now();const list=(LIMITS.get(key)||[]).filter(t=>now-t<60000);if(list.length>=max){LIMITS.set(key,list);return false;}list.push(now);LIMITS.set(key,list);if(LIMITS.size>2000)LIMITS.clear();return true}
function authorized(req,res){const cfg=configured();if(!cfg.admin){sendJson(res,503,{error:'Configure CONVYA_WA_ADMIN_KEY (mínimo 16 caracteres) no serviço Railway.'});return false;}const header=String(req.headers.authorization||'');if(!secure(header.replace(/^Bearer\s+/i,''),process.env.CONVYA_WA_ADMIN_KEY)){sendJson(res,401,{error:'Senha de administrador inválida.'});return false;}return true}
const isValidPhone=p=>/^\d{10,15}$/.test(p);
async function sendMessage({to,type,text}){
 const id=process.env.META_WA_PHONE_NUMBER_ID;
 const token=process.env.META_WA_ACCESS_TOKEN;
 const ver=/^v\d{1,2}\.0$/.test(process.env.META_WA_GRAPH_VERSION||'')?process.env.META_WA_GRAPH_VERSION:'v26.0';
 const body=type==='template'
  ?{messaging_product:'whatsapp',recipient_type:'individual',to,type:'template',template:{name:'hello_world',language:{code:'en_US'}}}
  :{messaging_product:'whatsapp',recipient_type:'individual',to,type:'text',text:{preview_url:false,body:text}};
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);
 try{const response=await fetch('https://graph.facebook.com/'+ver+'/'+encodeURIComponent(id)+'/messages',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:ctl.signal});
  const result=await response.json().catch(()=>({}));
  if(!response.ok){const msg=String(result?.error?.message||'Meta recusou a mensagem.').slice(0,250);return {ok:false,providerStatus:response.status,error:msg}};
  return {ok:true,messageId:result?.messages?.[0]?.id||null};
 }catch(e){return {ok:false,error:e?.name==='AbortError'?'A API da Meta não respondeu a tempo.':'Falha temporária na API da Meta.'}}
 finally{clearTimeout(timer)}
}
function webhookVerify(req,res,url){
 const cfg=configured();if(!cfg.webhook)return sendJson(res,503,{error:'Webhook indisponível'});
 const mode=url.searchParams.get('hub.mode'),token=url.searchParams.get('hub.verify_token'),challenge=url.searchParams.get('hub.challenge');
 if(mode==='subscribe'&&secure(token,process.env.META_WA_VERIFY_TOKEN)&&challenge&&/^\d{1,40}$/.test(challenge)){res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end(challenge);return}
 return sendJson(res,403,{error:'Verificação do webhook recusada'});
}
function webhookReceive(req,res,raw){
 if(!configured().webhook)return sendJson(res,503,{error:'Webhook indisponível'});
 const expected='sha256='+createHmac('sha256',process.env.META_WA_APP_SECRET).update(raw).digest('hex');
 if(!secure(req.headers['x-hub-signature-256'],expected))return sendJson(res,401,{error:'Assinatura inválida'});
 let data;try{data=JSON.parse(raw.toString('utf8'))}catch{return sendJson(res,400,{error:'JSON inválido'})}
 if(data?.object!=='whatsapp_business_account')return sendJson(res,200,{ok:true,ignored:true});
 let count=0;
 for(const entry of data.entry||[])for(const change of entry.changes||[]){
  if(change.field!=='messages')continue;const value=change.value||{};
  const sourceId=digits(value.metadata?.phone_number_id);
  if(sourceId!==digits(process.env.META_WA_PHONE_NUMBER_ID))continue;
  for(const m of value.messages||[]){
   const mid=String(m.id||'');if(!mid||SEEN.has(mid))continue;SEEN.add(mid);if(SEEN.size>800)SEEN.clear();
   const from=digits(m.from);
   const body=m.type==='text'?String(m.text?.body||'').slice(0,4000):'[Mídia ou mensagem do tipo '+String(m.type||'desconhecido').slice(0,30)+']';
   if(isValidPhone(from))LAST_INBOUND.set(from,Date.now());
   event({id:mid,direction:'in',real:true,phone:from,text:body,messageType:m.type||'unknown',status:'received'});count++;
  }
  for(const s of value.statuses||[]){
   const original=EVENTS.find(e=>e.id===s.id);if(original)original.status=String(s.status||'unknown');
  }
 }
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,received:count}));
}
async function admin(req,res,url,raw) {
 if(!authorized(req,res))return;
 const path=url.pathname,cfg=configured();
 const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].slice(0,70);
 if(req.method==='GET'&&path==='/api/whatsapp/config')return sendJson(res,200,{ok:true,configured:cfg,phoneIdSuffix:cfg.send?String(process.env.META_WA_PHONE_NUMBER_ID).slice(-4):null,webhookUrl:'https://'+String(req.headers.host||'').replace(/[^a-zA-Z0-9.:\-]/g,'')+'/api/whatsapp/webhook',storage:'temporary-in-memory',realMessaging:cfg.send&&cfg.webhook,mode:'manual-test'});
 if(req.method==='GET'&&path==='/api/whatsapp/messages'){const phone=digits(url.searchParams.get('phone'));const items=phone?EVENTS.filter(e=>e.phone===phone):EVENTS;return sendJson(res,200,{messages:items.slice(-150),count:items.length,storage:'temporary-in-memory'})}
 if(req.method==='POST'&&path==='/api/whatsapp/mock'){
   if(!recentLimit(ip,'mock',20))return sendJson(res,429,{error:'Limite de simulação atingido.'});
   const data=parseRaw(raw);if(!data)return sendJson(res,400,{error:'JSON inválido.'});
   const phone=digits(data.phone)||'5511999999999';
   const text=String(data.text||'Olá! Esta é uma resposta simulada, sem envio pelo WhatsApp.').slice(0,700);
   const entry=event({direction:'in',real:false,phone,text,messageType:'text',status:'simulated'});
   return sendJson(res,201,{ok:true,message:entry,notice:'Simulação local do servidor; não veio do WhatsApp.'});
 }
 if(req.method==='POST'&&path==='/api/whatsapp/send'){
   if(!recentLimit(ip,'send',5))return sendJson(res,429,{error:'Limite de 5 envios por minuto para homologação.'});
   if(!cfg.send)return sendJson(res,503,{error:'Configure META_WA_ACCESS_TOKEN e META_WA_PHONE_NUMBER_ID na Railway.'});
   const data=parseRaw(raw);if(!data)return sendJson(res,400,{error:'JSON inválido.'});
   const to=digits(data.to),type=data.type==='template'?'template':data.type==='text'?'text':null;
   if(!isValidPhone(to)||!type)return sendJson(res,400,{error:'Informe telefone com DDI e tipo de mensagem válido.'});
   const text=String(data.text||'').trim();
   if(type==='text'&&(text.length<1||text.length>1000))return sendJson(res,400,{error:'O texto precisa conter de 1 a 1000 caracteres.'});
   // User-initiated conversation opens a 24h customer-service window.
   if(type==='text'&&(!LAST_INBOUND.get(to)||Date.now()-LAST_INBOUND.get(to)>24*3600*1000))return sendJson(res,409,{error:'Envie primeiro o template hello_world ou aguarde o contato responder: texto livre só após mensagem recebida nas últimas 24h.'});
   const result=await sendMessage({to,type,text});
   if(!result.ok)return sendJson(res,502,{error:result.error,providerStatus:result.providerStatus||null});
   const item=event({id:result.messageId||randomUUID(),direction:'out',real:true,phone:to,text:type==='template'?'[Template Meta: hello_world]':text,messageType:type,status:'accepted'});
   return sendJson(res,200,{ok:true,message:item,provider:'Meta WhatsApp Cloud API'});
 }
 return sendJson(res,404,{error:'Rota não encontrada.'})
}
function parseRaw(raw){try{const d=JSON.parse(raw.toString('utf8'));return d&&typeof d==='object'&&!Array.isArray(d)?d:null}catch{return null}}
module.exports={admin,webhookReceive,webhookVerify,configured};
