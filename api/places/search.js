'use strict';
/** Convya V16 — Google Places (New), chamadas somente no servidor.
 * O limite em memória é auxiliar; configure cota e orçamento no Google Cloud.
 */
const { timingSafeEqual } = require('node:crypto');
const FIELD_MASK = ['places.id','places.displayName','places.formattedAddress','places.nationalPhoneNumber','places.internationalPhoneNumber','places.websiteUri','places.businessStatus','places.googleMapsUri','places.rating','places.userRatingCount','nextPageToken'].join(',');
const STATE = new Map();
const UF = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
function json(res,code,obj){res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/json; charset=utf-8');return res.status(code).json(obj)}
function eqSecret(actual,expected){const a=Buffer.from(actual||''),b=Buffer.from(expected||'');return a.length===b.length&&a.length>0&&timingSafeEqual(a,b)}
function limited(v,max){return typeof v==='string'?v.trim().slice(0,max):''}
function classify(u){if(!u)return 'NONE';let h='';try{const parsed=new URL(u);if(!['https:','http:'].includes(parsed.protocol))return 'UNKNOWN';h=parsed.hostname.replace(/^www\./,'').toLowerCase()}catch{return 'UNKNOWN'};if(/(^|\.)(instagram\.com|facebook\.com|tiktok\.com|youtube\.com|wa\.me|whatsapp\.com)$/.test(h))return 'SOCIAL';if(/(^|\.)(linktr\.ee|beacons\.ai|bio\.link|taplink\.cc)$/.test(h))return 'BIO';if(/(^|\.)(ifood\.com\.br|doctoralia\.com\.br|tripadvisor\.com|google\.com|google\.com\.br|wixsite\.com|myshopify\.com|business\.site|mercadolivre\.com\.br)$/.test(h))return 'PLATFORM';return 'OWN_PROBABLE'}
module.exports = async function handler(req,res){
 if(req.method==='GET')return json(res,200,{ok:true,configured:Boolean(process.env.GOOGLE_MAPS_API_KEY&&process.env.CONVYA_SEARCH_ACCESS_TOKEN),requiresAccessToken:true,maxPerPage:20,provider:'Google Places (New)',automaticSending:false});
 if(req.method!=='POST')return json(res,405,{error:'Método não permitido'});
 if(!process.env.GOOGLE_MAPS_API_KEY||!process.env.CONVYA_SEARCH_ACCESS_TOKEN)return json(res,503,{error:'A pesquisa real está desativada: configure GOOGLE_MAPS_API_KEY e CONVYA_SEARCH_ACCESS_TOKEN na Railway.'});
 const authorization=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 if(!eqSecret(authorization,process.env.CONVYA_SEARCH_ACCESS_TOKEN))return json(res,401,{error:'Código de acesso à pesquisa inválido.'});
 const length=Number(req.headers['content-length']||0);if(length>5000)return json(res,413,{error:'Solicitação muito grande.'});
 let body=req.body;if(typeof body==='string'){try{body=JSON.parse(body)}catch{return json(res,400,{error:'JSON inválido.'})}}
 if(!body||typeof body!=='object'||Array.isArray(body))return json(res,400,{error:'Pesquisa inválida.'});
 const niche=limited(body.niche,75),city=limited(body.city,75),uf=limited(body.state,2).toUpperCase();
 if(niche.length<2||city.length<2||!UF.has(uf)||!(/^[\p{L}\p{N}\s.,'&/\-]+$/u.test(niche))||!/^[\p{L}\s.'\-]+$/u.test(city))return json(res,400,{error:'Informe nicho, cidade e UF brasileiros válidos.'});
 const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'anon').split(',')[0].trim().slice(0,70);
 const now=Date.now();for(const [k,v] of STATE)if(now-v.start>3600000)STATE.delete(k);
 const usage=STATE.get(ip)||{start:now,count:0};if(usage.count>=25)return json(res,429,{error:'Limite auxiliar de consultas nesta instância atingido.'});usage.count++;STATE.set(ip,usage);
 const pageToken=limited(body.pageToken,1200);
 const params={textQuery:niche+' em '+city+', '+uf+', Brasil',languageCode:'pt-BR',regionCode:'BR',pageSize:20};if(pageToken)params.pageToken=pageToken;
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000);
 try{
  const r=await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':process.env.GOOGLE_MAPS_API_KEY,'X-Goog-FieldMask':FIELD_MASK},body:JSON.stringify(params),signal:ctl.signal});
  if(!r.ok)return json(res,502,{error:r.status===403?'A API Google Places recusou esta chave ou não está habilitada.':'Não foi possível concluir a pesquisa no Google.',providerStatus:r.status});
  const data=await r.json();
  const places=(Array.isArray(data.places)?data.places:[]).filter(x=>x.businessStatus!=='CLOSED_PERMANENTLY').slice(0,20).map(x=>{
   const rawSite=typeof x.websiteUri==='string'?x.websiteUri:null,site=rawSite&&/^https?:\/\//i.test(rawSite)?rawSite:null;
   const id=typeof x.id==='string'?x.id.slice(0,150):'';
   const rawMap=typeof x.googleMapsUri==='string'?x.googleMapsUri:'';
   const mapsUrl=/^https:\/\/(www\.)?google\.com\/maps/i.test(rawMap)?rawMap:'https://www.google.com/maps/search/?api=1&query=Google&query_place_id='+encodeURIComponent(id);
   return {placeId:id,name:x.displayName?.text||'Empresa sem nome',address:x.formattedAddress||'',phone:x.internationalPhoneNumber||x.nationalPhoneNumber||'',website:site,websiteClass:classify(site),status:x.businessStatus||'UNKNOWN',rating:Number.isFinite(x.rating)?x.rating:null,ratings:Number.isFinite(x.userRatingCount)?x.userRatingCount:null,mapsUrl};
  });
  return json(res,200,{provider:'Google Places (New)',isDemo:false,results:places,nextPageToken:data.nextPageToken||null,notice:'O filtro sem site considera apenas o site informado no perfil do Google. Confirme manualmente antes de prospectar.',attribution:'Dados de estabelecimentos: Google Maps · Google Places API'});
 }catch(e){return json(res,504,{error:e?.name==='AbortError'?'A busca no Google excedeu o tempo limite.':'Falha temporária de comunicação com o Google.'})}finally{clearTimeout(timer)}
};
