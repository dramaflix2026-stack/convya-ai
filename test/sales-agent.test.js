'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {once}=require('node:events');
const agent=require('../api/sales-agent');
const wa=require('../api/whatsapp-web');
const server=require('../server');
const keys=['CONVYA_TEST_PHONE','PAGENOVA_CONVYA_HANDOFF_SECRET','OPENAI_API_KEY'];
const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
const SECRET='private-bridge-secret-for-QA-0123456789';
const PHONE='5511987654321';
let origin,realFetch,realSent=[];
const now=()=>Math.floor(Date.now()/1000);
function sign(expires=now()+500,url='https://www.pagenovaai.com.br/p/v2-barbearia-demo'){
 const payload={v:1,kind:'approved-test-site',projectId:'site-test-123456',businessName:'Barbearia Exemplo',siteUrl:url,iat:now(),exp:expires};
 const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
 return body+'.'+createHmac('sha256',SECRET).update(body).digest('base64url');
}
function setUp(){
 process.env.CONVYA_TEST_PHONE=PHONE;
 process.env.PAGENOVA_CONVYA_HANDOFF_SECRET=SECRET;
 process.env.OPENAI_API_KEY='test-only-key-openai-not-valid';
 wa._testConnect(async args=>{realSent.push(args);return {key:{id:'wa.test.'+realSent.length}}});
}
const headers={'Content-Type':'application/json'};
test('start isolated Node server',async()=>{
 server.listen(0,'127.0.0.1');await once(server,'listening');origin='http://127.0.0.1:'+server.address().port;realFetch=global.fetch;
});
test('status is accessible without passwords; missing environment blocks activation',async()=>{
 for(const k of keys)delete process.env[k];
 const response=await fetch(origin+'/api/agent/status');
 assert.equal(response.status,200);
 const status=await response.json();
 assert.equal(status.configured.phone,false);
});
test('signed approved site is mandatory, time limited and restricted to PageNova',()=>{
 setUp();
 assert.equal(agent.validateApproval(sign()).projectId,'site-test-123456');
 assert.throws(()=>agent.validateApproval(sign(now()-1)),/expirou/i);
 assert.throws(()=>agent.validateApproval(sign(now()+400,'https://attacker.example/p/site-test')),/PageNova|inválido/i);
 const token=sign();const forged=(token[0]==='A'?'B':'A')+token.slice(1);assert.throws(()=>agent.validateApproval(forged),/assinatura|inválida/i);
});
test('agent cannot activate unless an authorized QR session is linked',()=>{
 wa._testDisconnect();
 assert.throws(()=>agent.activate(sign()),/Configure/);
 wa._testConnect(async msg=>{realSent.push(msg);return {key:{id:'wa.test.'+realSent.length}}});
 assert.equal(agent.activate(sign()).session.status,'active');
 assert.equal(agent.publicState().session.phoneSuffix,PHONE.slice(-4));
});
test('operator can pause, take over and resume from HTTP',async()=>{
 const s=await fetch(origin+'/api/agent/status',{headers});
 assert.equal(s.status,200);assert.equal((await s.json()).session.status,'active');
 const human=await fetch(origin+'/api/agent/mode',{method:'POST',headers,body:JSON.stringify({mode:'human'})});
 assert.equal(human.status,200);assert.equal((await human.json()).session.status,'human');
 const restart=await fetch(origin+'/api/agent/mode',{method:'POST',headers,body:JSON.stringify({mode:'active'})});
 assert.equal(restart.status,200);assert.equal((await restart.json()).session.status,'active');
});
test('unrelated phone never triggers agent or sends messages',async()=>{
 const count=realSent.length;
 await wa.receiveChatMessage({key:{id:'not-allowed-001',remoteJid:'5521999999999@s.whatsapp.net'},message:{conversation:'Quero conhecer a PageNova'}});
 assert.equal(realSent.length,count);
 assert.equal(agent.publicState().session.aiReplies,0);
});
test('QR webhook equivalent: linked WhatsApp text -> AI Responses mock -> WhatsApp reply',async()=>{
 agent.activate(sign()); // clean session
 let aiCalls=0;
 global.fetch=async(input,options)=>{
  const path=String(input);
  if(path.startsWith(origin))return realFetch(input,options);
  if(path==='https://api.openai.com/v1/responses'){
   aiCalls++;
   const req=JSON.parse(options.body);
   assert.equal(req.store,false);
   assert.match(req.instructions,/Barbearia Exemplo/);
   return new Response(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'Conheça o site de demonstração: https://www.pagenovaai.com.br/p/v2-barbearia-demo'}]}]}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  throw Error('Unexpected outgoing request '+path);
 };
 try{
  const count=realSent.length;
  await wa.receiveChatMessage({key:{id:'inbound-wa-001',remoteJid:PHONE+'@s.whatsapp.net'},message:{conversation:'Olá, me mostra o site?' }});
  assert.equal(aiCalls,1);
  assert.equal(realSent.length,count+1);
  assert.equal(realSent.at(-1).to,PHONE);
  assert.match(realSent.at(-1).text,/assistente de IA/i);
  assert.match(realSent.at(-1).text,/v2-barbearia-demo/);
  assert.equal(agent.publicState().session.aiReplies,1);
  const inbox=await realFetch(origin+'/api/wa-web/messages',{headers});
  const content=await inbox.json();
  assert.ok(content.messages.some(x=>x.id==='inbound-wa-001'));
  assert.ok(content.messages.some(x=>x.direction==='out'&&x.text.includes('v2-barbearia-demo')));
 }finally{global.fetch=realFetch}
});
test('human/price request suspends AI and hands conversation to operator',async()=>{
 const count=realSent.length;
 await wa.receiveChatMessage({key:{id:'inbound-wa-002',remoteJid:PHONE+'@s.whatsapp.net'},message:{conversation:'Quanto custa? Quero falar com humano'}});
 assert.equal(agent.publicState().session.status,'human');
 assert.equal(realSent.length,count+1);
 await wa.receiveChatMessage({key:{id:'inbound-wa-003',remoteJid:PHONE+'@s.whatsapp.net'},message:{conversation:'Pode enviar agora?' }});
 assert.equal(realSent.length,count+1);
});
test('opt-out pauses automation with zero additional messages',async()=>{
 agent.setMode('active');
 const count=realSent.length;
 await wa.receiveChatMessage({key:{id:'inbound-wa-004',remoteJid:PHONE+'@s.whatsapp.net'},message:{conversation:'Não quero, parar'}});
 assert.equal(agent.publicState().session.status,'paused');
 assert.equal(realSent.length,count);
});
after(async()=>{
 global.fetch=realFetch||global.fetch;agent._reset();wa._testDisconnect();
 for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v}
 await new Promise(resolve=>server.close(resolve));
});
