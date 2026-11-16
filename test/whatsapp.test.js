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
test('connected QR state clears old connection errors and the UI removes stale warnings',async()=>{
 const page=await fetch(url+'/whatsapp.html');
 const html=await page.text();
 assert.match(html,/else error\('connectError',''\)/);
 wa._testConnect(async()=>({key:{id:'mock'}}));
 const response=await fetch(url+'/api/wa-web/status');
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.connected,true);
 assert.equal(data.state,'connected');
 assert.equal(data.error,null);
 wa._testDisconnect();
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
test('incoming PN message from test contact appears in real inbox',async()=>{
 const msg={key:{id:'in-pn-0001',fromMe:false,remoteJid:PHONE+'@s.whatsapp.net'},
   message:{conversation:'Oi do celular'}};
 await wa.receiveChatMessage(msg);
 const response=await fetch(url+'/api/wa-web/messages');
 const body=await response.json();
 assert.ok(body.messages.some(row=>row.id==='in-pn-0001'&&row.direction==='in'&&row.text==='Oi do celular'));
});
test('incoming LID with authorized alternative PN appears in inbox',async()=>{
 await wa.receiveChatMessage({key:{id:'in-lid-alt-0002',fromMe:false,
   remoteJid:'998877665544@lid',remoteJidAlt:PHONE+'@s.whatsapp.net'},
   message:{extendedTextMessage:{text:'Chegou por LID!'}}});
 const response=await fetch(url+'/api/wa-web/messages');
 const body=await response.json();
 assert.ok(body.messages.some(row=>row.id==='in-lid-alt-0002'&&row.direction==='in'&&row.text==='Chegou por LID!'));
});
test('incoming LID without phone hint uses only trusted Baileys PN mapping',async()=>{
 const lid='111222333444@lid';
 wa._testLidMapping({getPNForLID:async jid=>jid===lid?PHONE+'@s.whatsapp.net':undefined});
 await wa.receiveChatMessage({key:{id:'in-lid-mapped-0003',fromMe:false,remoteJid:lid},
  message:{ephemeralMessage:{message:{conversation:'LID verificado pelo WhatsApp'}}}});
 let r=await fetch(url+'/api/wa-web/messages');let body=await r.json();
 assert.ok(body.messages.some(row=>row.id==='in-lid-mapped-0003'));
 await wa.receiveChatMessage({key:{id:'in-lid-unmapped-0004',fromMe:false,remoteJid:'444333222111@lid'},
  message:{conversation:'Este identificador não foi autorizado'}});
 r=await fetch(url+'/api/wa-web/messages');body=await r.json();
 assert.ok(!body.messages.some(row=>row.id==='in-lid-unmapped-0004'));
 wa._testLidMapping(null);
});
test('incoming LID matching known reverse mapping is authorized',async()=>{
 wa._testLidMapping({
  getPNForLID:async()=>undefined,
  getLIDForPN:async pn=>pn===PHONE+'@s.whatsapp.net'?'887766554433@lid':undefined
 });
 await wa.receiveChatMessage({key:{id:'in-lid-reverse-0005',fromMe:false,remoteJid:'887766554433@lid'},
  message:{conversation:'LID reconhecido pelo mapa reverso'}});
 const r=await fetch(url+'/api/wa-web/messages');const body=await r.json();
 assert.ok(body.messages.some(row=>row.id==='in-lid-reverse-0005'));
 wa._testLidMapping(null);
});
test('messages from other phone, group and own account stay excluded',async()=>{
 const messages=[
  {key:{id:'ignored-other',fromMe:false,remoteJid:'5521888880000@s.whatsapp.net',
     remoteJidAlt:PHONE+'@s.whatsapp.net'},message:{conversation:'Contato diferente'}},
  {key:{id:'ignored-group',fromMe:false,remoteJid:'111222333@g.us',
     senderPn:PHONE+'@s.whatsapp.net'},message:{conversation:'Grupo'}},
  {key:{id:'ignored-own',fromMe:true,remoteJid:PHONE+'@s.whatsapp.net'},
    message:{conversation:'Minha própria mensagem'}}
 ];
 for(const msg of messages)await wa.receiveChatMessage(msg);
 const r=await fetch(url+'/api/wa-web/messages');const body=await r.json();
 for(const msg of messages)assert.ok(!body.messages.some(row=>row.id===msg.key.id));
 const status=await fetch(url+'/api/wa-web/status');const data=await status.json();
 assert.ok(data.inbound.accepted>=4);
 assert.ok(data.inbound.ignoredUnmatched>=2);
 assert.ok(data.inbound.ignoredSelf>=1);
 assert.ok(data.inbound.lastAcceptedAt);
});

test('refreshing the browser never disconnects an active WhatsApp socket',async()=>{
 wa._testConnect(async()=>({key:{id:'mock.connected'}}));
 for(let n=0;n<3;n++){
   const page=await fetch(url+'/whatsapp.html');assert.equal(page.status,200);
   const status=await fetch(url+'/api/wa-web/status');
   assert.equal(status.status,200);
   assert.equal((await status.json()).connected,true);
 }
 wa._testDisconnect();
});
test('only a previously paired, registered WhatsApp session may auto-resume',async()=>{
 const fs=require('node:fs/promises');
 const os=require('node:os');
 const path=require('node:path');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'convya-session-test-'));
 let resumed=0;
 try{
   let state=await wa.resumeSession({dir:temp,connectFn:async()=>{resumed++}});
   assert.equal(state.resumed,false);
   assert.equal(resumed,0);
   await fs.writeFile(path.join(temp,'creds.json'),JSON.stringify({registered:false}),{mode:0o600});
   state=await wa.resumeSession({dir:temp,connectFn:async()=>{resumed++}});
   assert.equal(state.resumed,false);
   assert.equal(resumed,0);
   await fs.writeFile(path.join(temp,'creds.json'),JSON.stringify({registered:true,me:{id:'5511888887777:1@s.whatsapp.net'}}),{mode:0o600});
   assert.equal(await wa.hasRegisteredSession(temp),true);
   state=await wa.resumeSession({dir:temp,connectFn:async()=>{resumed++}});
   assert.equal(state.resumed,true);
   assert.equal(state.reason,'saved-session');
   assert.equal(resumed,1);
 }finally{await fs.rm(temp,{recursive:true,force:true})}
});
test('server starts automatic restore only on startup, never on browser refresh',()=>{
 const fs=require('node:fs');
 const path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert.match(source,/waWeb\.resumeSession\(\)/);
 assert.match(source,/if\(require\.main===module\)/);
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
