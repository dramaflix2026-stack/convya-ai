'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {once}=require('node:events');
const http=require('node:http');
const agent=require('../api/sales-agent');
const server=require('../server');

const vars=['CONVYA_TEST_PHONE','CONVYA_WA_ADMIN_KEY','PAGENOVA_CONVYA_HANDOFF_SECRET','META_WA_ACCESS_TOKEN','META_WA_PHONE_NUMBER_ID','META_WA_APP_SECRET','META_WA_VERIFY_TOKEN','OPENAI_API_KEY'];
const old=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
const SECRET='some-private-bridge-secret-for-test-01234567890';
const ADM='only-an-admin-can-activate-this-01';
const PHONE='5511987654321';
const timestamp=()=>Math.floor(Date.now()/1000);
let base;
function approvedToken(expires=timestamp()+500){
  const payload={v:1,kind:'approved-test-site',projectId:'site-test-123456',
    businessName:'Barbearia Exemplo',siteUrl:'https://www.pagenovaai.com.br/p/v2-barbearia-demo',
    iat:timestamp(),exp:expires};
  const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
  return encoded+'.'+createHmac('sha256',SECRET).update(encoded).digest('base64url');
}
test('bootstrap isolated test server',async()=>{
 server.listen(0,'127.0.0.1');await once(server,'listening');
 base='http://127.0.0.1:'+server.address().port;
});
test('without setup admin cannot see agent session',async()=>{
 for(const k of vars)delete process.env[k];
 const r=await fetch(base+'/api/agent/status');
 assert.equal(r.status,503);
});
test('approval is signed and expires, never trusts arbitrary URLs',()=>{
 process.env.PAGENOVA_CONVYA_HANDOFF_SECRET=SECRET;
 const ok=agent.validateApproval(approvedToken());
 assert.equal(ok.businessName,'Barbearia Exemplo');
 assert.equal(ok.projectId,'site-test-123456');
 assert.throws(()=>agent.validateApproval(approvedToken().replace(/.$/,'x')),/assinatura|inválida/i);
 assert.throws(()=>agent.validateApproval(approvedToken(timestamp()-1)),/expirou/i);
});
test('agent activation requires allowlist, Meta and OpenAI',()=>{
 process.env.CONVYA_WA_ADMIN_KEY=ADM;process.env.CONVYA_TEST_PHONE=PHONE;
 assert.throws(()=>agent.activate(approvedToken()),/Configure/);
 process.env.META_WA_ACCESS_TOKEN='fake-meta-token-not-real';process.env.META_WA_PHONE_NUMBER_ID='123456';
 process.env.META_WA_APP_SECRET='fake-app-secret';process.env.META_WA_VERIFY_TOKEN='verify';
 process.env.OPENAI_API_KEY='fake-openai-token-not-real';
 const current=agent.activate(approvedToken());
 assert.equal(current.session.status,'active');
 assert.equal(current.session.phoneSuffix,PHONE.slice(-4));
 assert.equal(current.session.siteUrl,'https://www.pagenovaai.com.br/p/v2-barbearia-demo');
});
test('authenticated status, human takeover and resume via HTTP',async()=>{
 const headers={'Authorization':'Bearer '+ADM,'Content-Type':'application/json'};
 const anon=await fetch(base+'/api/agent/status');assert.equal(anon.status,401);
 const ok=await fetch(base+'/api/agent/status',{headers});assert.equal(ok.status,200);
 const status=await ok.json();assert.equal(status.session.status,'active');
 assert.ok(!JSON.stringify(status).includes(SECRET));
 const human=await fetch(base+'/api/agent/mode',{method:'POST',headers,body:JSON.stringify({mode:'human'})});
 assert.equal(human.status,200);assert.equal((await human.json()).session.status,'human');
 const resumed=await fetch(base+'/api/agent/mode',{method:'POST',headers,body:JSON.stringify({mode:'active'})});
 assert.equal(resumed.status,200);assert.equal((await resumed.json()).session.status,'active');
});
test('one approved personal phone gets AI response; another phone is ignored',async()=>{
 let sent=[],audits=[];
 const deps={sendMessage:async msg=>{sent.push(msg);return {ok:true,messageId:'wamid.TEST.01'}},
   event:x=>audits.push(x),generate:async ctx=>('Sou a assistente de IA da PageNova. Veja o site: '+ctx.siteUrl)};
 const rejected=await agent.onInbound({from:'5521999999999',text:'Oi',type:'text'},deps);
 assert.equal(rejected.ignored,true);assert.equal(sent.length,0);
 const answer=await agent.onInbound({from:PHONE,text:'Olá, gostaria de ver a prévia',type:'text'},deps);
 assert.equal(answer.handled,true);assert.equal(sent.length,1);
 assert.equal(sent[0].to,PHONE);assert.match(sent[0].text,/p\/v2-barbearia-demo/);
 assert.equal(agent.publicState().session.aiReplies,1);
 assert.equal(audits.length,1);
});
test('business negotiation and human request end agent autonomy',async()=>{
 let sent=[];
 const deps={sendMessage:async msg=>{sent.push(msg);return {ok:true,messageId:'wamid.HUMAN.02'}},event:()=>{},generate:async()=>{throw Error('AI must not run')}};
 const result=await agent.onInbound({from:PHONE,text:'Quero falar com humano para fechar a venda',type:'text'},deps);
 assert.equal(result.handoff,true);assert.equal(agent.publicState().session.status,'human');
 assert.equal(sent.length,1);
 const after=await agent.onInbound({from:PHONE,text:'Me diz o preço',type:'text'},deps);
 assert.equal(after.ignored,true);assert.equal(sent.length,1);
});
test('pausing or opt-out suppresses all automatic sends',async()=>{
 agent.setMode('active');
 let sends=0;const deps={sendMessage:async()=>{sends++;return{ok:true}},event:()=>{},generate:async()=>'hi'};
 const result=await agent.onInbound({from:PHONE,text:'Não quero, parar',type:'text'},deps);
 assert.equal(result.paused,true);assert.equal(sends,0);
 assert.equal(agent.publicState().session.status,'paused');
});
after(async()=>{
 agent._reset();
 for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v}
 await new Promise(resolve=>server.close(resolve));
});
