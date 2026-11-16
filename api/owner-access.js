'use strict';
/**
 * Single-owner access for the public Convya URL.
 * One-time private activation link (#access=...) exchanges the existing Railway
 * CONVYA_WA_ADMIN_KEY for a 30-day HttpOnly cookie. The key is never persisted
 * by frontend JavaScript or sent in query strings / logs.
 */
const {createHmac,randomBytes,timingSafeEqual}=require('node:crypto');
const COOKIE='convya_owner';
const TTL=30*24*60*60; // 30 days
const ATTEMPTS=new Map();
function key(){const v=process.env.CONVYA_WA_ADMIN_KEY;return typeof v==='string'&&v.length>=16?v:''}
function safeEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length>0&&x.length===y.length&&timingSafeEqual(x,y)}
function sign(payload){return createHmac('sha256',key()).update(payload).digest('base64url')}
function issue(){const at=Math.floor(Date.now()/1000);const value=Buffer.from(JSON.stringify({v:1,iat:at,exp:at+TTL,n:randomBytes(16).toString('hex')})).toString('base64url');return value+'.'+sign(value)}
function verify(session){
  if(!key()||typeof session!=='string'||session.length>512)return false;
  const parts=session.split('.');if(parts.length!==2||!safeEqual(parts[1],sign(parts[0])))return false;
  try{
    const body=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    const at=Math.floor(Date.now()/1000);
    return body.v===1&&Number.isInteger(body.iat)&&Number.isInteger(body.exp)&&body.iat<=at+60&&body.exp>at&&body.exp-body.iat===TTL;
  }catch{return false}
}
function fromCookie(req){
  const cookie=String(req.headers.cookie||'');
  const match=cookie.match(/(?:^|;\s*)convya_owner=([^;\s]+)/);
  return match?decodeURIComponent(match[1]):'';
}
function authenticated(req){
  if(verify(fromCookie(req)))return true;
  const bearer=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  // Support legacy API clients and existing automated tests without weakening
  // the public browser experience.
  return !!key()&&safeEqual(bearer,key());
}
function send(res,status,data){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  res.end(JSON.stringify(data));
}
function sameOrigin(req){
 const origin=String(req.headers.origin||'');
 if(!origin)return !req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']);
 try{return new URL(origin).host.toLowerCase()===String(req.headers.host||'').toLowerCase()}catch{return false}
}
function rateLimit(req){
 const now=Date.now(),ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].slice(0,80);
 if(ATTEMPTS.size>500)for(const [k,v] of ATTEMPTS)if(now-v.start>900000)ATTEMPTS.delete(k);
 const item=ATTEMPTS.get(ip);
 if(!item||now-item.start>900000){ATTEMPTS.set(ip,{start:now,count:1});return true}
 if(item.count>=5)return false;
 item.count++;return true;
}
function handler(req,res,url,raw){
 if(req.method==='GET'&&url.pathname==='/api/owner/session')
  return send(res,200,{authorized:authenticated(req),configured:!!key(),expiresDays:30});
 if(req.method!=='POST')return send(res,405,{error:'Método não permitido.'});
 if(!sameOrigin(req))return send(res,403,{error:'Origem não autorizada.'});
 if(url.pathname==='/api/owner/logout'){
   res.setHeader('Set-Cookie',COOKIE+'=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
   return send(res,200,{ok:true});
 }
 if(url.pathname!=='/api/owner/claim')return send(res,404,{error:'Rota não encontrada.'});
 if(!key())return send(res,503,{error:'Configure uma chave privada de pelo menos 16 caracteres na Railway.'});
 if(!rateLimit(req))return send(res,429,{error:'Muitas tentativas de acesso. Tente novamente depois.'});
 let data;try{data=JSON.parse(raw.toString('utf8'))}catch{return send(res,400,{error:'Pedido inválido.'})}
 if(!safeEqual(data?.accessKey,key()))return send(res,401,{error:'Link de acesso inválido.'});
 res.setHeader('Set-Cookie',COOKIE+'='+issue()+'; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age='+TTL);
 return send(res,200,{ok:true,notice:'Navegador autorizado por 30 dias.'});
}
module.exports={handler,authenticated,verify,issue,key};
