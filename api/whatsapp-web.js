'use strict';
/*
 * WhatsApp Web QR connector (community Baileys, not official WhatsApp API).
 * Strictly single linked account + one authorized test recipient.
 * Auth keys are written to an instance-local private folder; for survival
 * across Railway deploys, mount a private persistent volume at that folder.
 * This module starts the socket only after the operator clicks Connect.
 */
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID,timingSafeEqual}=require('node:crypto');

const EVENTS=[];
const MAX_EVENTS=120;
let socket=null;
let connection='disconnected';
let qrImage=null;
let lastError=null;
let connecting=null;
let retryCount=0;
let reconnectTimer=null;
let manualDisconnect=false;
let engine=null;
let testConnected=false;
let testSender=null;
const SEND_TIMES=[];
let testLidMapping=null;
const INBOUND_DIAG={seen:0,accepted:0,ignoredSelf:0,ignoredUnmatched:0,lastAcceptedAt:null,lastRejectedReason:null};
const AUTH_DIR=process.env.CONVYA_WA_AUTH_DIR||path.join(os.tmpdir(),'convya-wa-auth');
let connectedAt=null;
let resumedFromDisk=false;
const bootAt=new Date().toISOString();

async function hasRegisteredSession(dir=AUTH_DIR){
  try{
    const json=JSON.parse(await fs.readFile(path.join(dir,'creds.json'),'utf8'));
    return json?.registered===true&&typeof json.me?.id==='string'&&json.me.id.length>0;
  }catch{return false}
}
async function resumeSession(options={}){
  const dir=options.dir||AUTH_DIR;
  const connectFn=options.connectFn||connect;
  if(status().connected)return {resumed:false,alreadyConnected:true};
  // Only reconnect sessions with a valid previously paired WhatsApp identity.
  // A fresh deployment without credentials must NOT generate a QR by itself.
  if(!await hasRegisteredSession(dir))return {resumed:false,reason:'not-paired'};
  resumedFromDisk=true;
  try{
    await connectFn();
    return {resumed:true,reason:'saved-session'};
  }catch(error){
    resumedFromDisk=false;
    return {resumed:false,reason:'connection-error'};
  }
}

const digits=x=>String(x||'').replace(/\D/g,'');
const validPhone=x=>/^\d{10,15}$/.test(digits(x));
const secureEqual=(x,y)=>{const a=Buffer.from(String(x||'')),b=Buffer.from(String(y||''));return a.length>0&&a.length===b.length&&timingSafeEqual(a,b)};
const onlyPhone=()=>validPhone(process.env.CONVYA_TEST_PHONE)?digits(process.env.CONVYA_TEST_PHONE):'';
// WhatsApp can represent the same contact as a PN JID or a private LID.
// Never compare a LID's digits with a phone number: they are unrelated.
const pnFromJid=x=>{
 const v=String(x||'');
 const m=/^(\d{10,15})(?::\d+)?@s\.whatsapp\.net$/.exec(v);
 return m?m[1]:'';
};
const normalizeLid=x=>{
 const m=/^(\d+)(?::\d+)?@lid$/.exec(String(x||''));
 return m?m[1]+'@lid':'';
};
async function matchesTestContact(key){
 const target=onlyPhone();
 if(!target)return false;
 const primary=String(key?.remoteJid||'');
 const normalizedLid=normalizeLid(primary);
 const directPhone=pnFromJid(primary);
 if(!normalizedLid&&!directPhone)return false; // excludes groups, broadcasts and status
 if(directPhone)return directPhone===target; // never override a different PN identity with an alternate hint
 const pnHints=[primary,key?.remoteJidAlt,key?.senderPn,key?.participantPn,key?.participantAlt,key?.remoteJidPn];
 if(pnHints.some(jid=>pnFromJid(jid)===target))return true;
 if(!normalizedLid)return false;
 // Only use explicit WhatsApp-supplied mappings for LID-only messages.
 const mapping=testLidMapping||socket?.signalRepository?.lidMapping;
 if(!mapping)return false;
 try{
   if(typeof mapping.getPNForLID==='function'){
     const pn=await mapping.getPNForLID(primary);
     if(pnFromJid(pn)===target)return true;
   }
   if(typeof mapping.getLIDForPN==='function'){
     const lid=await mapping.getLIDForPN(target+'@s.whatsapp.net');
     if(normalizeLid(lid)===normalizedLid)return true;
   }
 }catch{} // fail closed if a library does not provide mapping methods
 return false;
}
function configured(){return {
  allowedPhone:!!onlyPhone(),
  ai:!!process.env.OPENAI_API_KEY,
  pageNova:!!process.env.PAGENOVA_CONVYA_HANDOFF_SECRET,
  persistentStorage:!!process.env.CONVYA_WA_AUTH_DIR
};}
function status(){
  const connected=testConnected||connection==='connected';
  return {state:connected?'connected':connection,connected,
    qr:connected?null:qrImage,error:connected?null:lastError,
    connectedAt:connected?connectedAt:null,bootAt,resumedFromDisk:connected&&resumedFromDisk,
    configured:configured(),phoneSuffix:onlyPhone()?onlyPhone().slice(-4):null,
    transport:'WhatsApp Web (biblioteca comunitária)',official:false,
    onePhoneOnly:true,storage:process.env.CONVYA_WA_AUTH_DIR?'configured-folder':'temporary-folder',
    inbound:{seen:INBOUND_DIAG.seen,accepted:INBOUND_DIAG.accepted,
      ignoredSelf:INBOUND_DIAG.ignoredSelf,ignoredUnmatched:INBOUND_DIAG.ignoredUnmatched,
      lastAcceptedAt:INBOUND_DIAG.lastAcceptedAt,
      lastRejectedReason:INBOUND_DIAG.lastRejectedReason},
    notice:'Conexão não oficial por aparelho vinculado. Não enviar disparos em massa.'};
}
function pushEvent(e){
  const row={id:e.id||randomUUID(),at:e.at||new Date().toISOString(),phone:onlyPhone(),...e};
  EVENTS.push(row);if(EVENTS.length>MAX_EVENTS)EVENTS.splice(0,EVENTS.length-MAX_EVENTS);
  return row;
}
async function sendMessage({to,type,text}){
  if(type!=='text')return {ok:false,error:'Somente mensagens de texto são permitidas no teste QR.'};
  const recipient=onlyPhone();
  if(!recipient||digits(to)!==recipient)return {ok:false,error:'Telefone não autorizado para esta homologação.'};
  if(!status().connected||(!socket&&!testSender))return {ok:false,error:'WhatsApp ainda não conectado.'};
  if(typeof text!=='string'||!text.trim()||text.length>1000)return {ok:false,error:'Mensagem inválida.'};
  try{
    const result=testSender
      ?await testSender({to:recipient,text})
      :await socket.sendMessage(recipient+'@s.whatsapp.net',{text:text.trim()});
    return {ok:true,messageId:result?.key?.id||result?.id||randomUUID()};
  }catch(err){lastError='Falha ao enviar: verifique a conexão do WhatsApp.';return {ok:false,error:lastError}}
}
async function receiveChatMessage(message){
  if(!message?.message)return;
  INBOUND_DIAG.seen++;
  // Own-account messages are not incoming customer messages.
  if(message.key?.fromMe){INBOUND_DIAG.ignoredSelf++;INBOUND_DIAG.lastRejectedReason='own-account';return;}
  const accepted=await matchesTestContact(message.key);
  if(!accepted){
    INBOUND_DIAG.ignoredUnmatched++;
    const primary=String(message.key?.remoteJid||'');
    INBOUND_DIAG.lastRejectedReason=normalizeLid(primary)?'unmapped-lid':'other-contact-or-format';
    return; // never expose other contacts to this unauthenticated test panel
  }
  // Support ordinary text and WhatsApp's ephemeral/view-once wrappers.
  let content=message.message;
  for(let i=0;i<3;i++){
    const next=content?.ephemeralMessage?.message||
      content?.viewOnceMessage?.message||content?.viewOnceMessageV2?.message||
      content?.documentWithCaptionMessage?.message;
    if(!next)break;
    content=next;
  }
  const text=content?.conversation||content?.extendedTextMessage?.text||'';
  if(typeof text!=='string'||!text.trim())return;
  const id=String(message.key?.id||randomUUID());
  if(EVENTS.some(x=>x.id===id))return;
  INBOUND_DIAG.accepted++;
  INBOUND_DIAG.lastAcceptedAt=new Date().toISOString();
  INBOUND_DIAG.lastRejectedReason=null;
  pushEvent({id,direction:'in',real:true,text:text.slice(0,1200),status:'received'});
  try{
    await require('./sales-agent').onInbound({from:onlyPhone(),text,type:'text'},{
      sendMessage,
      event:e=>pushEvent({id:e.id,direction:e.direction,real:true,text:e.text,status:e.status})
    });
  }catch(err){lastError='Falha no processamento da mensagem. Atendimento humano recomendado.'}
}
function scheduleReconnect(){
 if(manualDisconnect||reconnectTimer||retryCount>=6)return;
 const delay=Math.min(1200*2**retryCount++,25000);
 reconnectTimer=setTimeout(()=>{reconnectTimer=null;void connect().catch(()=>{});},delay);
 reconnectTimer.unref?.();
}
async function connect(){
 if(connection==='connected')return status();
 if(connecting)return connecting;
 manualDisconnect=false;
 connecting=(async()=>{
   connection='connecting';qrImage=null;lastError=null;
   try{
     const mod=await import('@whiskeysockets/baileys');
     const qrModule=await import('qrcode');
     const qr=qrModule.default||qrModule;
     const makeWASocket=mod.default;
     const {state,saveCreds}=await mod.useMultiFileAuthState(AUTH_DIR);
     await fs.chmod(AUTH_DIR,0o700).catch(()=>{});
     if(socket){try{socket.ws?.close()}catch{}}
     socket=makeWASocket({
       auth:state,
       printQRInTerminal:false,
       syncFullHistory:false,
       markOnlineOnConnect:false,
       browser:mod.Browsers?.ubuntu('Convya Teste')||['Convya','Desktop','1.0'],
       connectTimeoutMs:30000,
       logger:{level:'silent',child(){return this},trace(){},debug(){},info(){},warn(){},error(){}}
     });
     const current=socket;
     engine=current;
     socket.ev.on('creds.update',()=>void saveCreds().catch(()=>{lastError='Não foi possível salvar a sessão do WhatsApp.'}));
     socket.ev.on('messages.upsert',payload=>{
       if(payload.type!=='notify')return;
       for(const message of payload.messages||[])void receiveChatMessage(message);
     });
     socket.ev.on('connection.update',update=>{
       if(current!==engine)return;
       if(update.qr&&connection!=='connected')void qr.toDataURL(update.qr,{errorCorrectionLevel:'M',width:270,margin:2})
         .then(data=>{if(current===engine&&connection!=='connected'){qrImage=data;connection='qr-ready'}})
         .catch(()=>{lastError='Falha ao gerar QR.'});
       if(update.connection==='open'){
         // A successful link supersedes any earlier close/retry warning.
         if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}
         connection='connected';qrImage=null;retryCount=0;lastError=null;
         connectedAt=new Date().toISOString();
       }
       if(update.connection==='close'){
         qrImage=null;connection='disconnected';
         const code=update.lastDisconnect?.error?.output?.statusCode;
         if(code===mod.DisconnectReason?.loggedOut){
           manualDisconnect=true;resumedFromDisk=false;connectedAt=null;
           lastError='Sessão encerrada no WhatsApp. Conecte novamente.';
           void fs.rm(AUTH_DIR,{recursive:true,force:true}).catch(()=>{});
         }else if(code===mod.DisconnectReason?.restartRequired){
           // WhatsApp Web normally requests a socket restart after QR pairing.
           connection='connecting';lastError=null;scheduleReconnect();
         }else{
           lastError='Conexão interrompida; tentando reconectar.';scheduleReconnect();
         }
       }
     });
     return status();
   }catch(err){
     connection='disconnected';
     lastError='Não foi possível iniciar o QR. Verifique os logs e as dependências.';
     throw Error(lastError);
   }finally{connecting=null;}
 })();
 return connecting;
}
async function disconnect(){
 manualDisconnect=true;
 if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}
 retryCount=0;qrImage=null;connection='disconnected';lastError=null;
 resumedFromDisk=false;connectedAt=null;
 const current=socket;socket=null;engine=null;
 if(current){try{await current.logout()}catch{try{current.ws?.close()}catch{}}}
 await fs.rm(AUTH_DIR,{recursive:true,force:true}).catch(()=>{});
 testConnected=false;testSender=null;
 require('./sales-agent').setModeIfExists?.('paused');
 return status();
}
function renderJson(res,code,data){
 res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
 res.end(JSON.stringify(data));
}
async function handler(req,res,url,raw=Buffer.alloc(0)){
 const route=url.pathname;
 if(req.method==='GET'&&route==='/api/wa-web/status')return renderJson(res,200,status());
 if(req.method==='GET'&&route==='/api/wa-web/messages')return renderJson(res,200,{messages:EVENTS.slice(-100),storage:'memory'});
 if(req.method!=='POST')return renderJson(res,405,{error:'Método não permitido.'});
 const payload=(()=>{try{return JSON.parse(raw.toString('utf8'))}catch{return null}})();
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return renderJson(res,400,{error:'JSON inválido.'});
 if(route==='/api/wa-web/connect'){
   try{await connect();return renderJson(res,200,status())}
   catch(e){return renderJson(res,503,{error:e.message})}
 }
 if(route==='/api/wa-web/disconnect')return renderJson(res,200,await disconnect());
 if(route==='/api/wa-web/send'){
   if(!status().connected)return renderJson(res,409,{error:'Conecte seu WhatsApp pelo QR primeiro.'});
   const now=Date.now();while(SEND_TIMES.length&&now-SEND_TIMES[0]>60000)SEND_TIMES.shift();
   if(SEND_TIMES.length>=10)return renderJson(res,429,{error:'Limite de 10 mensagens por minuto para homologação.'});
   SEND_TIMES.push(now);
   const result=await sendMessage({to:onlyPhone(),type:'text',text:payload.text});
   if(!result.ok)return renderJson(res,422,{error:result.error});
   const row=pushEvent({id:result.messageId,direction:'out',real:true,text:String(payload.text||'').trim(),status:'sent'});
   return renderJson(res,200,{ok:true,message:row});
 }
 return renderJson(res,404,{error:'Rota não encontrada.'});
}
module.exports={handler,status,connect,disconnect,sendMessage,receiveChatMessage,configured,resumeSession,hasRegisteredSession,
  _testConnect(sender){testConnected=true;testSender=sender;},
  _testLidMapping(mapping){testLidMapping=mapping},
  _testDisconnect(){testConnected=false;testSender=null;testLidMapping=null;EVENTS.length=0;
    INBOUND_DIAG.seen=0;INBOUND_DIAG.accepted=0;INBOUND_DIAG.ignoredSelf=0;INBOUND_DIAG.ignoredUnmatched=0;
    INBOUND_DIAG.lastAcceptedAt=null;INBOUND_DIAG.lastRejectedReason=null;}
};
