'use strict';
// Convya AI V16: Railway adapter (zero external dependencies).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const search = require('./api/places/search');
const health = require('./api/places/health');
const indexPath = path.join(__dirname,'index.html');
const html = fs.readFileSync(indexPath);
const limit = 5000;
function respond(res, status, payload) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(payload));
}
function adapter(res) {
  res.status = function(code){res.statusCode=code;return res;};
  res.json = function(payload){if(!res.headersSent){res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');}res.end(JSON.stringify(payload));return res;};
  return res;
}
const server=http.createServer(async(req,res)=>{
  const pathname = (()=>{try{return new URL(req.url,'http://localhost').pathname}catch{return ''}})();
  if(pathname==='/'||pathname==='/index.html'){
    if(req.method!=='GET'&&req.method!=='HEAD')return respond(res,405,{error:'Método não permitido.'});
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    return res.end(req.method==='HEAD'?undefined:html);
  }
  if(pathname==='/health'||pathname==='/api/places/health'){
    if(req.method!=='GET')return respond(res,405,{error:'Método não permitido.'});
    return health(req,adapter(res));
  }
  if(pathname==='/api/places/search'){
    if(req.method!=='GET'&&req.method!=='POST')return respond(res,405,{error:'Método não permitido.'});
    if(req.method==='GET')return search(req,adapter(res));
    const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
    if(type!=='application/json')return respond(res,415,{error:'Envie JSON com Content-Type: application/json.'});
    let chunks=[],length=0,tooLarge=false;
    try{
      for await(const part of req){length+=part.length;if(length>limit){tooLarge=true;break}chunks.push(part)}
      if(tooLarge)return respond(res,413,{error:'Solicitação muito grande.'});
      let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return respond(res,400,{error:'JSON inválido.'})}
      if(!data||typeof data!=='object'||Array.isArray(data))return respond(res,400,{error:'Pesquisa inválida.'});
      req.body=data;
      return await search(req,adapter(res));
    }catch(err){if(!res.writableEnded)return respond(res,500,{error:'Falha no processamento da pesquisa.'});return;}
  }
  return respond(res,404,{error:'Rota não encontrada.'});
});
if(require.main===module){
  const port=Number(process.env.PORT)||3000;
  server.listen(port,'0.0.0.0',()=>console.log('Convya V16 pronta na porta',port));
}
module.exports=server;
