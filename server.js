'use strict';
// Convya AI Railway adapter — static CRM + WhatsApp Web QR test.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const places=require('./api/places/search');
const placesHealth=require('./api/places/health');
const salesAgent=require('./api/sales-agent');
const waWeb=require('./api/whatsapp-web');
const virtualClient=require('./api/virtual-client');
const index=fs.readFileSync(path.join(__dirname,'index.html'));
const whatsappHtml=fs.readFileSync(path.join(__dirname,'whatsapp.html'));
const safeHeader={
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'X-Frame-Options':'DENY'
};
function json(res,code,value){
 res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...safeHeader});
 res.end(JSON.stringify(value));
}
function adapter(res){
 res.status=function(c){res.statusCode=c;return res};
 res.json=function(data){if(!res.headersSent){res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff')}res.end(JSON.stringify(data));return res};
 return res;
}
async function rawBody(req,max){
 let buffers=[],length=0,oversize=false;
 for await(const chunk of req){length+=chunk.length;if(length>max){oversize=true;break;}buffers.push(chunk)}
 return oversize?null:Buffer.concat(buffers);
}
const server=http.createServer(async(req,res)=>{
 const url=(()=>{try{return new URL(req.url,'http://localhost')}catch{return null}})();
 if(!url)return json(res,400,{error:'URL inválida'});
 const pathname=url.pathname;
 if(pathname==='/'||pathname==='/index.html'||pathname==='/whatsapp.html'){
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Método não permitido'});
  const bytes=pathname==='/whatsapp.html'?whatsappHtml:index;
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache',...safeHeader});
  return res.end(req.method==='HEAD'?undefined:bytes);
 }
 if(pathname==='/health'||pathname==='/api/places/health'){
  if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
  return placesHealth(req,adapter(res));
 }
 if(pathname==='/api/places/search'){
  if(req.method!=='GET'&&req.method!=='POST')return json(res,405,{error:'Método não permitido'});
  if(req.method==='GET')return places(req,adapter(res));
  if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')return json(res,415,{error:'Envie JSON com Content-Type: application/json'});
  try{
   const raw=await rawBody(req,5000);if(!raw)return json(res,413,{error:'Solicitação muito grande'});
   let body;try{body=JSON.parse(raw.toString('utf8'))}catch{return json(res,400,{error:'JSON inválido'})}
   if(!body||typeof body!=='object'||Array.isArray(body))return json(res,400,{error:'Pesquisa inválida'});
   req.body=body;return await places(req,adapter(res));
  }catch(e){if(!res.writableEnded)return json(res,500,{error:'Falha no processamento da pesquisa'})}
  return;
 }
 if(pathname.startsWith('/api/virtual-client/')){
  const allowed=(req.method==='GET'&&pathname==='/api/virtual-client/status')||
    (req.method==='POST'&&pathname==='/api/virtual-client/chat');
  if(!allowed)return json(res,404,{error:'Rota não encontrada.'});
  try{
    if(req.method==='POST'){
      if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')
        return json(res,415,{error:'Content-Type JSON obrigatório.'});
      const raw=await rawBody(req,12000);
      if(!raw)return json(res,413,{error:'Mensagem de teste muito grande.'});
      return virtualClient.handler(req,res,url,raw);
    }
    return virtualClient.handler(req,res,url,Buffer.alloc(0));
  }catch{
    if(!res.writableEnded)return json(res,500,{error:'Falha na conversa virtual.'});
  }
  return;
 }
 if(pathname.startsWith('/api/wa-web/')){
  const getRoutes=new Set(['/api/wa-web/status','/api/wa-web/messages']);
  const postRoutes=new Set(['/api/wa-web/connect','/api/wa-web/disconnect','/api/wa-web/send']);
  if(!((req.method==='GET'&&getRoutes.has(pathname))||
       (req.method==='POST'&&postRoutes.has(pathname))))
    return json(res,404,{error:'Rota não encontrada.'});
  try{
    if(req.method==='POST'){
      if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')
        return json(res,415,{error:'Content-Type JSON obrigatório.'});
      const raw=await rawBody(req,5000);
      if(!raw)return json(res,413,{error:'Solicitação muito grande.'});
      return await waWeb.handler(req,res,url,raw);
    }
    return await waWeb.handler(req,res,url,Buffer.alloc(0));
  }catch{
    if(!res.writableEnded)return json(res,500,{error:'Falha na conexão do WhatsApp. Consulte os logs.'});
  }
  return;
 }
 if(pathname.startsWith('/api/agent/')){
  if(!((req.method==='GET'&&pathname==='/api/agent/status')||
       (req.method==='POST'&&['/api/agent/activate','/api/agent/mode'].includes(pathname))))
    return json(res,404,{error:'Rota não encontrada'});
  try{
    if(req.method==='POST'){
      if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')
        return json(res,415,{error:'Content-Type JSON obrigatório'});
      const raw=await rawBody(req,5000);
      if(!raw)return json(res,413,{error:'Solicitação muito grande'});
      return await salesAgent.handler(req,res,url,raw);
    }
    return await salesAgent.handler(req,res,url,Buffer.alloc(0));
  }catch(error){
    if(!res.writableEnded)return json(res,500,{error:'Falha temporária no Vendedor IA'});
  }
  return;
 }

 return json(res,404,{error:'Rota não encontrada'});
});
if(require.main===module){
 const port=Number(process.env.PORT)||3000;
 server.listen(port,'0.0.0.0',()=>{
   console.log('Convya AI — Railway — porta',port);
   // Reuse the paired WhatsApp identity after restarts/deploys.
   // Without saved credentials this does nothing (no unsolicited QR generation).
   void waWeb.resumeSession().then(result=>{
     console.log('[convya-whatsapp] session restore:',result.reason||'already connected');
   }).catch(()=>console.warn('[convya-whatsapp] session restore unavailable'));
 });
}
module.exports=server;
