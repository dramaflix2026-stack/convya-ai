'use strict';
/*
 * WhatsApp Web QR connector (community Baileys, not official WhatsApp API).
 * Strictly single linked account + one authorized test recipient.
 * Auth keys are written to an instance-local private folder; for survival
 * across Railway deploys, mount a private persistent volume at that folder.
 * This module never starts the socket until an authenticated user clicks Connect.
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
const AUTH_DIR=process.env.CONVYA_WA_AUTH_DIR||path.join(os.tmpdir(),'convya-wa-auth');

const digits=x=>String(x||'').replace(/\D/g,'');
const validPhone=x=>/^\d{10,15}$/.test(digits(x));
const secureEqual=(x,y)=>{const a=Buffer.from(String(x||'')),b=Buffer.from(String(y||''));return a.length>0&&a.length===b.length&&timingSafeEqual(a,b)};
const onlyPhone=()=>validPhone(process.env.CONVYA_TEST_PHONE)?digits(process.env.CONVYA_TEST_PHONE):'';
function configured(){return {
  admin:!!(process.env.CONVYA_WA_ADMIN_KEY&&process.env.CONVYA_WA_ADMIN_KEY.length>=16),
  allowedPhone:!!onlyPhone(),
  ai:!!process.env.OPENAI_API_KEY,
  pageNova:!!process.env.PAGENOVA_CONVYA_HANDOFF_SECRET,
  persistentStorage:!!process.env.CONVYA_WA_AUTH_DIR
};}
function status(){
  return {state:testConnected?'connected':connection,connected:testConnected||connection==='connected',
    qr:testConnected?null:qrImage,error:lastError,
    configured:configured(),phoneSuffix:onlyPhone()?onlyPhone().slice(-4):null,
    transport:'WhatsApp Web (biblioteca comunitária)',official:false,
    onePhoneOnly:true,storage:process.env.CONVYA_WA_AUTH_DIR?'configured-folder':'temporary-folder',
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
  if(message.key?.fromMe||!message.message)return;
  const primary=String(message.key?.remoteJid||'');
  const jid=primary.endsWith('@s.whatsapp.net')?primary:String(message.key?.remoteJidAlt||primary);
  if(!jid.endsWith('@s.whatsapp.net'))return;
  const sender=digits(jid.split('@')[0]);
  const authorized=onlyPhone();
  if(!authorized||sender!==authorized)return;
  const text=message.message.conversation||message.message.extendedTextMessage?.text||'';
  if(typeof text!=='string'||!text.trim())return;
  const id=String(message.key?.id||randomUUID());
  if(EVENTS.some(x=>x.id===id))return; // prevent duplicate agent responses on retries
  pushEvent({id,direction:'in',real:true,text:text.slice(0,1200),status:'received'});
  try{
    await require('./sales-agent').onInbound({from:sender,text,type:'text'},{
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
 if(!configured().admin)throw Error('Configure CONVYA_WA_ADMIN_KEY na Railway antes de conectar.');
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
       if(update.qr)void qr.toDataURL(update.qr,{errorCorrectionLevel:'M',width:270,margin:2})
         .then(data=>{if(current===engine){qrImage=data;connection='qr-ready'}})
         .catch(()=>{lastError='Falha ao gerar QR.'});
       if(update.connection==='open'){
         connection='connected';qrImage=null;retryCount=0;lastError=null;
       }
       if(update.connection==='close'){
         qrImage=null;connection='disconnected';
         const code=update.lastDisconnect?.error?.output?.statusCode;
         if(code===mod.DisconnectReason?.loggedOut){
           manualDisconnect=true;lastError='Sessão encerrada no WhatsApp. Conecte novamente.';
           void fs.rm(AUTH_DIR,{recursive:true,force:true}).catch(()=>{});
         }else{lastError='Conexão interrompida; tentando reconectar.';scheduleReconnect();}
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
 if(!configured().admin)return renderJson(res,503,{error:'Defina CONVYA_WA_ADMIN_KEY nas variáveis privadas da Railway para liberar a conexão QR.'});
 if(!secureEqual(String(req.headers.authorization||'').replace(/^Bearer\s+/i,''),process.env.CONVYA_WA_ADMIN_KEY))
   return renderJson(res,401,{error:'Senha de administrador inválida.'});
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
module.exports={handler,status,connect,disconnect,sendMessage,receiveChatMessage,configured,
  _testConnect(sender){testConnected=true;testSender=sender;},
  _testDisconnect(){testConnected=false;testSender=null;EVENTS.length=0}
};
