'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const {createRequire} = require('module');
const file = path.resolve(__dirname, '../providers/msm21.js');
const source = fs.readFileSync(file, 'utf8');
let passes = 0;
const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nvideo/index.m3u8?token=a%2Fb\n';
function response(url, body, status=200, headers={}) { return {url, status, ok:status>=200&&status<300, headers:{get:k=>headers[k.toLowerCase()]||null},text:async()=>body}; }
function encrypt(data) { const c=crypto.createCipheriv('aes-128-cbc',Buffer.from('kiemtienmua911ca'),Buffer.from('1234567890oiuytr'));return Buffer.concat([c.update(JSON.stringify(data)),c.final()]).toString('hex'); }
function instance(fetch, runtimeTimers=false) {
  const timers = new Set();
  const ctx={module:{exports:{}},require:createRequire(file),console:{log(){}},URL,fetch,AbortController:runtimeTimers?undefined:AbortController,
    setTimeout:(f,ms)=>{const t=setTimeout(()=>{timers.delete(t);f();},Math.min(ms,ms===6500?120:80));timers.add(t);return t;},
    clearTimeout:runtimeTimers?()=>{}:t=>{clearTimeout(t);timers.delete(t);}};
  vm.createContext(ctx);
  vm.runInContext(source.replace('return { getStreams };','return { getStreams, resolvePlayerX, resolveAbyss, firstChecked, firstResult, scanPlayback, checkSource, formatStreams, extractPlayerOptions };'),ctx);
  return {api:ctx.createMsmProvider(fetch),factory:ctx.createMsmProvider,public:ctx.module.exports,close:()=>{for(const t of timers)clearTimeout(t);}};
}
async function test(name, run) { await run();passes++;console.log('PASS '+name); }
(async()=>{
await test('PlayerX AES extraction matches Cloudstream fields and exact signed URLs',async()=>{
 const signed='https://cdn.example/master.m3u8?sig=a%2Fb%2Bz&dup=1&dup=2';let request;
 const x=instance(async(u,o)=>{request={u,o};return response(u,encrypt({cfNative:signed,source:'/v4/hls/video.m3u8?sig=x%2Fy',hlsVideoGoogle:'https://google.example/a.m3u8',streamingConfig:JSON.stringify({adjust:{Google:{disabled:true},'In-House':{domain:'edge',params:{hello:'a b'}}}}),pk:{k:'abc+',kx:'xyz/'}}));});
 const links=await x.api.resolvePlayerX('https://playerx.rpmplay.online/#video123','https://www.movie.example/item/');
 assert.equal(links.length,2);assert.equal(links[0].url,signed);assert(links[1].url.startsWith('https://playerx.rpmplay.online/v4/hlsmod/edge/'));assert(links[1].url.includes('sig=x%2Fy'));assert(links[1].url.includes('hello=a+b'));assert(links[1].url.includes('k=abc%2B&kx=xyz%2F'));assert(request.u.endsWith('&r=movie.example'));assert.equal(request.o.headers.Origin,'https://playerx.rpmplay.online');x.close();
});
await test('all five exact PlayerX hosts supported; bad hosts and IDs rejected',async()=>{
 let calls=0;const x=instance(async u=>{calls++;return response(u,encrypt({cfNative:'https://cdn.example/a.m3u8'}));});
 for(const host of ['player4me.online','rpmplay.online','seekplays.online','p2pstream.online','upns.live'])assert.equal((await x.api.resolvePlayerX('https://playerx.'+host+'/#abc','https://movie.example/')).length,1);
 for(const u of ['https://playerx.rpmplay.online.evil/#abc','http://playerx.rpmplay.online/#abc','https://playerx.rpmplay.online/#bad!','https://playerx.rpmplay.online/'])assert.equal((await x.api.resolvePlayerX(u,'https://movie.example/')).length,0);
 assert.equal(calls,5);x.close();
});
await test('invalid API payloads, disabled fields and telemetry do not become sources',async()=>{
 for(const body of ['<html>blocked</html>','f'.repeat(32),encrypt({cfNative:'https://google-analytics.com/a.m3u8',source:'javascript:alert(1)'})]){
 const x=instance(async u=>response(u,body));assert.equal((await x.api.resolvePlayerX('https://playerx.rpmplay.online/#abc','https://movie.example/')).length,0);x.close();}
});
await test('option selector retains slug labels and every option beyond six',async()=>{
 const x=instance(()=>{});const html=Array.from({length:9},(_,i)=>`<div data-post="1" data-nume="${i+1}" data-type="movie"><span class="opt-titl">RPM</span> <span>${i+1}</span> <span>MalaySub</span></div>`).join('');
 const opts=x.api.extractPlayerOptions(html);assert.equal(opts.length,9);assert.equal(opts[8].label,'RPM 9 MalaySub');x.close();
});
await test('only valid manifests and HTTP video responses pass; HTML and 403 fail',async()=>{
 const x=instance(async(u,o)=>{if(u.includes('403'))return response(u,master,403);if(u.includes('html'))return response(u,'<html>error</html>');if(u.includes('file')){assert.equal(o.headers.Range,'bytes=0-511');return response(u,'',206,{'content-type':'video/mp4'});}return response(u,master,200,{'content-type':'application/vnd.apple.mpegurl'});});
 for(const u of ['https://cdn.example/403.m3u8','https://cdn.example/html.m3u8'])assert.equal(await x.api.checkSource({url:u}),null);
 const h=await x.api.checkSource({url:'https://cdn.example/extensionless'});assert(h.checkedHls);assert(h.masterHls);
 const v=await x.api.checkSource({url:'https://cdn.example/file.mp4'});assert(v);assert(!x.api.formatStreams([v])[0].headers.Range);
 const out=x.api.formatStreams([h])[0];assert.equal(out.quality,'Auto');assert.equal(out.mimeType,'application/x-mpegURL');x.close();
});
await test('empty early result and rejection cannot win the race',async()=>{
 const x=instance(()=>{});const r=await x.api.firstResult([Promise.resolve([]),Promise.reject(Error('fail')),new Promise(r=>setTimeout(()=>r(['valid']),10))]);assert.equal(r[0],'valid');assert.equal((await x.api.firstResult([Promise.resolve([])])).length,0);x.close();
});
await test('parallel AJAX -> extraction includes choices beyond six without losing winners',async()=>{
 let calls=0,aborts=0;const x=instance((u,o)=>{
 if(u.includes('admin-ajax')){calls++;if(o.body.includes('nume=9&'))return Promise.resolve(response(u,JSON.stringify({embed_url:'https://cdn.example/master.m3u8?sig=a%2Fb'})));
 return new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>{aborts++;reject(Error('cancelled'));}));}
 return Promise.resolve(response(u,master));});
 const html=Array.from({length:9},(_,i)=>`<li data-post="1" data-nume="${i+1}" data-type="movie">RPM ${i+1} MalaySub</li>`).join('');
 const start=Date.now();const groups=await x.api.scanPlayback('https://movie.example',{url:'https://movie.example/item',html});assert.equal(calls,9);assert.equal(groups[0].length,1);assert.equal(groups[0][0].label,'RPM 9 MalaySub');assert.equal(aborts,8);assert(Date.now()-start<180);x.close();
});
await test('Abyss resolver stays byte-for-byte identical',async()=>{
 const body=source.slice(source.indexOf('function resolveAbyss('),source.indexOf('function resolveGeneric('));
 assert.equal(crypto.createHash('sha256').update(body).digest('hex'),'23ef04549f52efbefab955fb465dfd9d4e7a91c5b8a11214455b7b4996d1384e');
});
await test('working Abyss remains eligible and can win the same race',async()=>{
 const x=instance(async u=>{if(u.includes('admin-ajax'))return response(u,JSON.stringify({embed_url:'https://abyss.example/video'}));if(u.includes('abyss.example'))return response(u,'const datas = "encrypted-data";');if(u.includes('dec-abyss'))return response(u,JSON.stringify({status:200,result:{url:'https://cdn.example/video.mp4'}}));return response(u,'',206,{'content-type':'video/mp4'});});
 const g=await x.api.scanPlayback('https://movie.example',{url:'https://movie.example/item',html:'<li data-post="1" data-nume="8" data-type="movie">Abyss 8 MalaySub</li>'});assert.equal(g[0].length,1);assert.equal(g[0][0].url,'https://cdn.example/video.mp4');assert.equal(g[0][0].label,'Abyss 8 MalaySub');x.close();
});
await test('separate scan cancellation states do not interfere',async()=>{
 const x=instance(async u=>response(u,master));const a=x.factory(async u=>response(u,master)),b=x.factory(async u=>response(u,master));
 await a.scanPlayback('https://movie.example',{url:'https://movie.example/item',html:'<iframe src="https://cdn.example/master.m3u8"></iframe>'});
 assert(await b.checkSource({url:'https://cdn.example/master.m3u8'}));x.close();
});
await test('VUEO timer semantics (clearTimeout no-op, no AbortController) still return winner',async()=>{
 const x=instance(async u=>response(u,master),true);const g=await x.api.scanPlayback('https://movie.example',{url:'https://movie.example/item',html:'<iframe src="https://cdn.example/master.m3u8"></iframe>'});assert.equal(g[0].length,1);await new Promise(r=>setTimeout(r,140));assert.equal(g[0].length,1);x.close();
});
await test('public export completes movie and selected TV episode through encrypted PlayerX',async()=>{
 const signed='https://cdn.example/master.m3u8?sig=a%2Fb';
 const option='<li data-post="1" data-nume="7" data-type="movie">Seek 7 MalaySub</li>';
 const x=instance(async(u,o)=>{
  if(u.includes('themoviedb'))return response(u,JSON.stringify({title:'Example',name:'Example',release_date:'2026-01-01',first_air_date:'2026-01-01'}));
  if(u.includes('/movies/'))return response(u,'<title>Example (2026)</title>'+option);
  if(u.includes('/tvshows/'))return response(u,'<title>Example (2026)</title><ul class="episodes-list" id="season-2"><li><a href="/episode/3">Episode 3</a></li></ul>');
  if(u.includes('/episode/3'))return response(u,option);
  if(u.includes('admin-ajax'))return response(u,JSON.stringify({embed_url:'https://playerx.seekplays.online/#abc'}));
  if(u.includes('/api/v1/video'))return response(u,encrypt({cfNative:signed}));
  if(u===signed)return response(u,master);
  throw Error('Unexpected request '+u);
 });
 for(const type of ['movie','tv']){const out=await x.public.getStreams(123,type,2,3);assert.equal(out.length,1);assert.equal(out[0].url,signed);assert.equal(out[0].mimeType,'application/x-mpegURL');assert.equal(out[0].title,'Seek 7 • Auto • MalaySub');}
 x.close();
});
await test('all blocked mirrors complete within the common bounded wait',async()=>{
 const x=instance(()=>new Promise(()=>{}));const start=Date.now();const g=await x.api.scanPlayback('https://movie.example',{url:'https://movie.example/item',html:'<li data-post="1" data-nume="1" data-type="movie">Abyss</li>'});assert.equal(g.length,0);assert(Date.now()-start<180);x.close();
});
await test('each option retains its fastest checked source, without global winner cancellation',async()=>{
 const x=instance(async(u,o)=>{
  if(u.includes('admin-ajax')){const n=o.body.match(/nume=(\d+)/)[1];return response(u,JSON.stringify({embed_url:'<iframe src="https://cdn.example/'+n+'-fast.m3u8"></iframe><iframe src="https://cdn.example/'+n+'-slow.m3u8"></iframe>'}));}
  await new Promise(r=>setTimeout(r,u.includes('-slow')?35:u.includes('/2-')?15:2));return response(u,master);
 });
 const html=[1,2].map(n=>`<li data-post="1" data-nume="${n}" data-type="movie">Server ${n}</li>`).join('');
 const g=await x.api.scanPlayback('https://movie.example',{url:'https://movie.example/item',html});assert.equal(g.length,2);assert(g.every(a=>a.length===1&&a[0].url.includes('-fast')));assert.deepEqual(g.map(a=>a[0].label).sort(),['Server 1','Server 2']);x.close();
});
await test('common scan deadline preserves completed sources and rejects late results',async()=>{
 const x=instance(async(u,o)=>{
  if(u.includes('admin-ajax')&&o.body.includes('nume=2&')){await new Promise(r=>setTimeout(r,65));const res=response(u,'');res.text=async()=>{await new Promise(r=>setTimeout(r,65));return JSON.stringify({embed_url:'https://cdn.example/late.m3u8'});};return res;}
  if(u.includes('admin-ajax'))return response(u,JSON.stringify({embed_url:'https://cdn.example/fast.m3u8'}));
  return response(u,master);
 });
 const html=[1,2].map(n=>`<li data-post="1" data-nume="${n}" data-type="movie">Server ${n}</li>`).join('');
 const start=Date.now();const g=await x.api.scanPlayback('https://movie.example',{url:'https://movie.example/item',html});assert.equal(g.length,1);assert(g[0][0].url.includes('/fast'));assert(Date.now()-start>=100);await new Promise(r=>setTimeout(r,30));assert.equal(g.length,1);x.close();
});
await test('all failures or no options stop as soon as work is exhausted',async()=>{
 const x=instance(async u=>response(u,'',404));let start=Date.now();let g=await x.api.scanPlayback('https://movie.example',{url:'https://movie.example/item',html:'<li data-post="1" data-nume="1" data-type="movie">Missing</li>'});assert.equal(g.length,0);assert(Date.now()-start<50);x.close();
 const y=instance(()=>{throw Error('No request expected');});g=await y.api.scanPlayback('https://movie.example',{url:'https://movie.example/item',html:'<p>No server</p>'});assert.equal(g.length,0);y.close();
});
console.log(`${passes} MSM regression tests passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
