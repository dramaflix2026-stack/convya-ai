'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const server=require('../server');
const owner=require('../api/owner-access');
const original=process.env.CONVYA_WA_ADMIN_KEY;
const secret='one-time-browser-pairing-secret-for-qa-1234567';
let base,cookie;
test('start isolated server and prevent public QR access',async()=>{
 delete process.env.CONVYA_WA_ADMIN_KEY;
 server.listen(0,'127.0.0.1');await once(server,'listening');
 base='http://127.0.0.1:'+server.address().port;
 const page=await fetch(base+'/whatsapp.html');assert.equal(page.status,200);
 const html=await page.text();
 assert.doesNotMatch(html,/id="admin"|Senha do painel Convya/);
 assert.match(html,/api\/owner\/claim/);
 const anonymous=await fetch(base+'/api/wa-web/status');assert.equal(anonymous.status,503);
});
test('unpaired devices cannot read connector status',async()=>{
 process.env.CONVYA_WA_ADMIN_KEY=secret;
 const status=await fetch(base+'/api/owner/session');const state=await status.json();
 assert.equal(status.status,200);assert.equal(state.authorized,false);
 const anonymous=await fetch(base+'/api/wa-web/status');assert.equal(anonymous.status,401);
});
test('wrong access code and foreign origin cannot pair',async()=>{
 const invalid=await fetch(base+'/api/owner/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessKey:'incorrect-link'})});
 assert.equal(invalid.status,401);
 const origin=await fetch(base+'/api/owner/claim',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://malicious.example'},body:JSON.stringify({accessKey:secret})});
 assert.equal(origin.status,403);
});
test('one-time private link pairs browser with HttpOnly SameSite cookie',async()=>{
 const claim=await fetch(base+'/api/owner/claim',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({accessKey:secret})});
 assert.equal(claim.status,200);
 cookie=claim.headers.get('set-cookie');
 assert.ok(cookie);assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);
 assert.ok(!cookie.includes(secret));
 const session=await fetch(base+'/api/owner/session',{headers:{Cookie:cookie}});
 assert.equal((await session.json()).authorized,true);
 const qr=await fetch(base+'/api/wa-web/status',{headers:{Cookie:cookie}});
 assert.equal(qr.status,200);
 const agent=await fetch(base+'/api/agent/status',{headers:{Cookie:cookie}});
 assert.equal(agent.status,200);
});
test('invalid or expired browser cookie is rejected',()=>{
 assert.equal(owner.verify('random.invalid'),false);
 const one=owner.issue();
 assert.equal(owner.verify(one),true);
 process.env.CONVYA_WA_ADMIN_KEY='a-new-secret-which-invalidates-old-browser-cookies';
 assert.equal(owner.verify(one),false);
 process.env.CONVYA_WA_ADMIN_KEY=secret;
});
test('browser logout clears trusted cookie',async()=>{
 const response=await fetch(base+'/api/owner/logout',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:'{}'});
 assert.equal(response.status,200);
 assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
});
after(async()=>{
 if(original===undefined)delete process.env.CONVYA_WA_ADMIN_KEY;else process.env.CONVYA_WA_ADMIN_KEY=original;
 await new Promise(resolve=>server.close(resolve));
});
