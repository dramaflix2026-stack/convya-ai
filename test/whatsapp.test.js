'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {createHmac}=require('node:crypto');
const server=require('../server');
let base, original={};
for(const k of ['CONVYA_WA_ADMIN_KEY','META_WA_ACCESS_TOKEN','META_WA_PHONE_NUMBER_ID','META_WA_APP_SECRET','META_WA_VERIFY_TOKEN']){original[k]=process.env[k];delete process.env[k]}
const secret='admin-test-password-very-long-and-private';
const app='test-app-secret';
const verify='test-whatsapp-verify';
test('start and serve real inbox',async()=>{
 server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
 const r=await fetch(base+'/whatsapp.html');assert.equal(r.status,200);
 const html=await r.text();assert.match(html,/canal oficial da Meta/);assert.match(html,/Conversa real/);assert.match(html,/Simulação fictícia/);
});
test('admin is required; missing secrets disable connection',async()=>{
 const r=await fetch(base+'/api/whatsapp/config');assert.equal(r.status,503);
 const raw=await r.json();assert.match(raw.error,/CONVYA_WA_ADMIN_KEY/);
 process.env.CONVYA_WA_ADMIN_KEY=secret;
 const a=await fetch(base+'/api/whatsapp/config',{headers:{Authorization:'Bearer wrong'}});
 assert.equal(a.status,401);
 const b=await fetch(base+'/api/whatsapp/config',{headers:{Authorization:'Bearer '+secret}});
 assert.equal(b.status,200);const x=await b.json();assert.equal(x.configured.send,false);assert.equal(x.configured.webhook,false);assert.equal(x.realMessaging,false);
 assert.ok(!JSON.stringify(x).includes(secret));
});
test('without Meta credentials no real messages are sent',async()=>{
 const r=await fetch(base+'/api/whatsapp/send',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({to:'5511999999999',type:'template'})});
 assert.equal(r.status,503);
});
test('webhook challenge verifies only matching token',async()=>{
 process.env.META_WA_APP_SECRET=app;process.env.META_WA_VERIFY_TOKEN=verify;process.env.META_WA_PHONE_NUMBER_ID='1234567890';
 const x=await fetch(base+'/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=123456');
 assert.equal(x.status,403);
 const y=await fetch(base+'/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token='+verify+'&hub.challenge=123456');
 assert.equal(y.status,200);assert.equal(await y.text(),'123456');
});
test('webhook rejects unsigned bodies and accepts a correctly signed message',async()=>{
 const payload={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'1234567890'},messages:[{id:'wamid.TEST123',from:'5511999999999',type:'text',text:{body:'Olá da minha conta pessoal!'}}]}}]}]};
 const raw=JSON.stringify(payload);
 const a=await fetch(base+'/api/whatsapp/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:raw});assert.equal(a.status,401);
 const signature='sha256='+createHmac('sha256',app).update(raw).digest('hex');
 const b=await fetch(base+'/api/whatsapp/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':signature},body:raw});assert.equal(b.status,200);assert.equal((await b.json()).received,1);
 const c=await fetch(base+'/api/whatsapp/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':signature},body:raw});assert.equal(c.status,200);assert.equal((await c.json()).received,0);
});
test('protected inbox returns received messages without exposing secrets',async()=>{
 const a=await fetch(base+'/api/whatsapp/messages');assert.equal(a.status,401);
 const b=await fetch(base+'/api/whatsapp/messages',{headers:{Authorization:'Bearer '+secret}});assert.equal(b.status,200);
 const data=await b.json();assert.ok(data.messages.some(m=>m.id==='wamid.TEST123'&&m.real===true&&m.text.includes('conta pessoal')));
 assert.ok(!JSON.stringify(data).includes(app));
});
test('clearly labeled mock message never calls the WhatsApp API',async()=>{
 const r=await fetch(base+'/api/whatsapp/mock',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({phone:'55119988887777',text:'Teste fictício'})});
 assert.equal(r.status,201);const x=await r.json();assert.equal(x.message.real,false);assert.equal(x.message.status,'simulated');
});
after(async()=>{for(const [k,v] of Object.entries(original)){if(v===undefined)delete process.env[k];else process.env[k]=v}await new Promise(resolve=>server.close(resolve))});
