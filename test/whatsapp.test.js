'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const server=require('../server');
const wa=require('../api/whatsapp-web');
const PHONE='5511999887766';
let url;
const OLD=Object.fromEntries(['CONVYA_TEST_PHONE'].map(k=>[k,process.env[k]]));
// Each test starts without the Railway production allowlist; explicitly enable it
// only in the relevant scenario. Restore the original value in after().
delete process.env.CONVYA_TEST_PHONE;
const auth={'Content-Type':'application/json'};
test('start server and render premium white/green QR page',async()=>{
 server.listen(0,'127.0.0.1');await once(server,'listening');
 url='http://127.0.0.1:'+server.address().port;
 const r=await fetch(url+'/whatsapp.html');assert.equal(r.status,200);
 const h=await r.text();
 assert.match(h,/--bg:#f6f9f7/);
 assert.match(h,/Gerar QR Code/);
 assert.match(h,/api\/wa-web\/connect/);
 assert.doesNotMatch(h,/META_WA_ACCESS_TOKEN|hello_world|Meta Developers/);
});
test('QR status is accessible without passwords, with the one-phone guard still active',async()=>{
 const status=await fetch(url+'/api/wa-web/status');
 assert.equal(status.status,200);
 const data=await status.json();
 assert.equal(data.connected,false);
 assert.equal(data.configured.allowedPhone,false);
});
test('unconfigured test number blocks messages even when a socket is simulated',async()=>{
 const sent=[];
 wa._testConnect(async data=>{sent.push(data);return {key:{id:'out.fake'}}});
 const resp=await fetch(url+'/api/wa-web/send',{method:'POST',headers:auth,body:JSON.stringify({text:'Olá, teste'})});
 assert.equal(resp.status,422);assert.equal(sent.length,0);
});
test('reject unrelated number even when connected',async()=>{
 process.env.CONVYA_TEST_PHONE=PHONE;
 let sent=[];
 wa._testConnect(async x=>{sent.push(x);return {key:{id:'wamid.qr.mock'}}});
 const other=await wa.sendMessage({to:'5521999000000',type:'text',text:'Oi'});
 assert.equal(other.ok,false);assert.equal(sent.length,0);
 const m=await wa.receiveChatMessage({key:{id:'wa.unrelated',remoteJid:'5521999000000@s.whatsapp.net'},message:{conversation:'olá'}});
 const inbox=await fetch(url+'/api/wa-web/messages',{headers:auth});
 assert.equal(inbox.status,200);assert.equal((await inbox.json()).messages.length,0);
});
test('allow a single explicitly authorized contact; no unsolicited autopilot',async()=>{
 const resp=await fetch(url+'/api/wa-web/send',{method:'POST',headers:auth,body:JSON.stringify({text:'Teste manual autorizado'})});
 assert.equal(resp.status,200);
 const data=await resp.json();assert.equal(data.ok,true);
 const inbox=await fetch(url+'/api/wa-web/messages',{headers:auth});
 const rows=(await inbox.json()).messages;
 assert.equal(rows.length,1);assert.equal(rows[0].direction,'out');
 assert.equal(rows[0].phone,PHONE);
});
test('inbound to disconnected or other number does not turn on agent',async()=>{
 const result=await wa.receiveChatMessage({key:{id:'wa.unrelated2',remoteJid:'552188877766@s.whatsapp.net'},message:{conversation:'Mensagem externa'}});
 assert.equal(result,undefined);
 const inbox=await fetch(url+'/api/wa-web/messages',{headers:auth});
 assert.equal((await inbox.json()).messages.length,1);
});
test('GET cannot mutate and invalid send payload fails closed',async()=>{
 const r=await fetch(url+'/api/wa-web/connect',{headers:auth});assert.equal(r.status,404);
 const bad=await fetch(url+'/api/wa-web/send',{method:'POST',headers:{},body:JSON.stringify({text:'teste'})});assert.equal(bad.status,415);
 const invalid=await fetch(url+'/api/wa-web/send',{method:'POST',headers:auth,body:'{' });assert.equal(invalid.status,400);
});
after(async()=>{
 wa._testDisconnect();
 for(const [k,v] of Object.entries(OLD)){if(v===undefined)delete process.env[k];else process.env[k]=v}
 await new Promise(resolve=>server.close(resolve));
});
