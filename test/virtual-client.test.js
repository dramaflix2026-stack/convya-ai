'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {Script}=require('node:vm');
const server=require('../server');
const virtual=require('../api/virtual-client');
const fs=require('node:fs');
const path=require('node:path');
const previous=Object.fromEntries(['OPENAI_API_KEY','CONVYA_VIRTUAL_AI_ENABLED'].map(k=>[k,process.env[k]]));
let url,realFetch;
const post=(body,headers={'Content-Type':'application/json'})=>
 fetch(url+'/api/virtual-client/chat',{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});
test('start server: client virtual tab is visible and browser script is syntactically valid',async()=>{
 delete process.env.OPENAI_API_KEY;
 delete process.env.CONVYA_VIRTUAL_AI_ENABLED;
 server.listen(0,'127.0.0.1');await once(server,'listening');
 url='http://127.0.0.1:'+server.address().port;realFetch=global.fetch;
 const result=await fetch(url+'/whatsapp.html');
 assert.equal(result.status,200);
 const html=await result.text();
 assert.match(html,/Cliente Virtual/);
 assert.match(html,/id="demoTools"/);
 assert.match(html,/id="resetDemo"/);
 assert.match(html,/api\/virtual-client\/chat/);
 assert.match(html,/Simulação guiada/);
 assert.match(html,/id="demoWait"/);
 assert.match(html,/id="demoFlow"/);
 assert.match(html,/showVirtualFlow\(result\.trace\)/);
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
 assert.equal(scripts.length,1);
 assert.doesNotThrow(()=>new Script(scripts[0][1],{filename:'whatsapp-inline.js'}));
});
test('scripted virtual customer chat works without phone number, linked QR or AI key',async()=>{
 const status=await fetch(url+'/api/virtual-client/status');
 assert.equal(status.status,200);
 const info=await status.json();
 assert.equal(info.engine,'scripted');
 assert.equal(info.whatsapp,false);
 const hello=await post({text:'Oi',history:[]});assert.equal(hello.status,200);
 const reply=await hello.json();
 assert.equal(reply.whatsappSent,false);
 assert.equal(reply.engine,'scripted');
 assert.match(reply.reply,/PageNova|Convya/i);
 assert.match(reply.notice,/roteiro|simula/i);
});
test('different example questions get coherent replies without fake prices',async()=>{
 const price=await (await post({text:'Quanto custa um site?',history:[]})).json();
 assert.match(price.reply,/valor|preço|proposta/i);
 assert.doesNotMatch(price.reply,/R\$\s?\d+/i);
 const site=await (await post({text:'Quero um site para minha empresa',history:[]})).json();
 assert.match(site.reply,/site|empresa|PageNova/i);
 const human=await (await post({text:'Quero falar com um humano',history:[]})).json();
 assert.match(human.reply,/equipe|pessoa|simulando/i);
});
test('complete virtual flow traces message, simulated wait, intent and response without WhatsApp',async()=>{
 const res=await post({text:'Quero criar um site para meu negócio',history:[],waitSeconds:60});
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.action,'continue');
 assert.equal(data.whatsappSent,false);
 assert.deepEqual(data.trace.map(x=>x.id),['inbound','wait','condition','reply','send']);
 assert.match(data.trace[1].result,/1 minuto simulado/i);
 assert.equal(data.trace[2].result,'Atendimento normal');
});
test('price and human requests follow the same handoff condition as live agent',async()=>{
 const res=await post({text:'Quanto custa um site?',history:[],waitSeconds:0});
 const data=await res.json();
 assert.equal(data.intent,'handoff');
 assert.equal(data.action,'human');
 assert.equal(data.engine,'scripted');
 assert.deepEqual(data.trace.map(x=>x.id),['inbound','wait','condition','action','send']);
 assert.match(data.trace[3].result,/humano/i);
 assert.equal(data.whatsappSent,false);
});
test('stop requests simulate opt-out without sending a real message',async()=>{
 const res=await post({text:'Não quero, parar',history:[]});
 const data=await res.json();
 assert.equal(data.intent,'opt_out');
 assert.equal(data.action,'paused');
 assert.match(data.reply,/pausaria|pausada/i);
 assert.equal(data.whatsappSent,false);
});
test('flow simulation enforces allowed timing values',async()=>{
 const res=await post({text:'Oi',history:[],waitSeconds:7200});
 assert.equal(res.status,422);
});

test('virtual client refuses invalid and overly long payloads',async()=>{
 const bad=await post({text:'',history:[]});
 assert.equal(bad.status,422);
 const long=await post({text:'x'.repeat(851),history:[]});
 assert.equal(long.status,422);
 const tooMany=await post({text:'Olá',history:Array.from({length:17},()=>({role:'customer',text:'teste'}))});
 assert.equal(tooMany.status,422);
 const malformed=await post('{');
 assert.equal(malformed.status,400);
 const type=await post({text:'oi'},{});
 assert.equal(type.status,415);
});
test('cross-origin websites cannot invoke virtual chat',async()=>{
 const r=await post({text:'oi'},{'Content-Type':'application/json',Origin:'https://other.example'});
 assert.equal(r.status,403);
});
test('virtual conversation never touches WhatsApp connector or changes its message list',async()=>{
 const before=await (await fetch(url+'/api/wa-web/messages')).json();
 const result=await post({text:'Oi, cliente virtual!',history:[]});assert.equal(result.status,200);
 const after=await (await fetch(url+'/api/wa-web/messages')).json();
 assert.deepEqual(after,before);
 const status=await fetch(url+'/api/wa-web/status');assert.equal(status.status,200);
});
test('optional AI uses provider only after explicit opt-in and falls back safely',async()=>{
 process.env.OPENAI_API_KEY='test-not-a-real-openai-key';
 process.env.CONVYA_VIRTUAL_AI_ENABLED='true';
 const state=await (await fetch(url+'/api/virtual-client/status')).json();
 assert.equal(state.engine,'ai');
 let called=0;
 global.fetch=async(input,options)=>{
  if(String(input).startsWith(url))return realFetch(input,options);
  assert.equal(String(input),'https://api.openai.com/v1/responses');
  called++;
  const body=JSON.parse(options.body);
  assert.equal(body.store,false);
  assert.match(body.instructions,/SIMULAÇÃO/);
  return new Response(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'Olá! Posso explicar como um site ajuda sua empresa.'}]}]}),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  const r=await post({text:'Oi',history:[]});
  assert.equal(r.status,200);
  const answer=await r.json();
  assert.equal(answer.engine,'ai');
  assert.equal(answer.whatsappSent,false);
  assert.match(answer.reply,/site ajuda/);
  assert.equal(called,1);
 }finally{
  global.fetch=realFetch;
  delete process.env.CONVYA_VIRTUAL_AI_ENABLED;
  delete process.env.OPENAI_API_KEY;
 }
});
after(async()=>{
 global.fetch=realFetch||global.fetch;
 for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v}
 await new Promise(resolve=>server.close(resolve));
});
