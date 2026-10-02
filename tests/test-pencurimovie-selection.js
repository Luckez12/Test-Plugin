const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert'),{createRequire}=require('module');
const filename=path.resolve(__dirname,'../providers/pencurimovie.js');
function runtime(fetch){const c={require:createRequire(filename),module:{exports:{}},fetch,console:{log(){}},setTimeout,clearTimeout,AbortController};vm.createContext(c);vm.runInContext(fs.readFileSync(filename,'utf8').replace('const MEDIA_CHECK_MS = 2000;','const MEDIA_CHECK_MS = 45;'),c);return c;}
const master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\n720/index.m3u8\n';
const media='#EXTM3U\n#EXTINF:5,\nchunk.ts\n';
function response(url,body,status=200,type='video/mp4'){return {ok:status===200||status===206,status,url,text:async()=>body,headers:{get:k=>k==='content-type'?type:k==='content-range'?'bytes 0-0/30000000':null}};}
function stream(url,label='HGCloud'){return {url,referer:'https://hanerix.com/e/id',label};}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
await test('first valid HLS wins within choice; sibling aborted; MP4 not probed',async()=>{
 let aborted=false;let mp4=false;const c=runtime(async(url,opts)=>{if(url.includes('slow'))return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>{aborted=true;reject(Error('abort'));}));if(url.includes('mp4'))mp4=true;return response(url,master);});
 const selected=await c.selectServerStream([stream('https://cdn.test/slow.m3u8'),stream('https://cdn.test/1080/master.m3u8'),stream('https://cdn.test/video.mp4')],{url:'https://hgcloud.to/e/id',label:'Server 3'},3);
 assert.strictEqual(selected.length,1);assert.ok(aborted);assert.ok(!mp4);const formatted=c.formatStreams(selected)[0];assert.strictEqual(formatted.title,'HGCloud 3 • Auto • MalaySub');assert.strictEqual(formatted.quality,'Auto');
});
await test('valid media can win before slower master; failed first response cannot win',async()=>{
 const c=runtime(async(url)=>{if(url.includes('master'))await new Promise(r=>setTimeout(r,15));return response(url,url.includes('invalid')?'challenge':url.includes('master')?master:media);});
 const selected=await c.selectServerStream(['invalid','media','master'].map(x=>stream('https://cdn.test/'+x+'.m3u8')),{url:'https://hgcloud.to/e/a',label:'Server 4'},4);
 assert.strictEqual(selected.length,1);assert.ok(selected[0].url.includes('media'));
});
await test('failed HLS permits verified MP4 fallback and preserves noReferer',async()=>{
 let probeHeaders;const c=runtime(async(url,opts)=>{if(url.includes('mp4'))probeHeaders=opts.headers;return response(url,'HTML',url.includes('m3u8')?404:206);});
 const direct={url:'https://cdn.test/video.mp4',label:'VOE MP4',noReferer:true,headers:{referer:'remove',Authorization:'keep'}};
 const selected=await c.selectServerStream([stream('https://cdn.test/dead.m3u8','VOE'),direct],{url:'https://voe.sx/e/a',label:'Server 5'},5);
 assert.strictEqual(selected.length,1);assert.strictEqual(probeHeaders.Range,'bytes=0-0');assert.ok(!probeHeaders.Referer&&!probeHeaders.referer);const output=c.formatStreams(selected)[0];assert.ok(!output.headers.Range);assert.strictEqual(output.headers.Authorization,'keep');assert.ok(!output.headers.Referer&&!output.headers.referer);
});
await test('HTML, 404, malformed playlists and MP4 failures return no candidate',async()=>{
 const c=runtime(async(url)=>response(url,'<html>error</html>',url.includes('dead')?404:200,'text/html'));
 assert.strictEqual((await c.selectServerStream(['bad.m3u8','dead.m3u8','bad.mp4'].map(x=>stream('https://cdn.test/'+x)),{url:'https://hgcloud.to/e/a',label:'Server 3'},3)).length,0);
});
await test('timeout common to all hosts; fallback handled without AbortController',async()=>{
 const c=runtime(()=>new Promise(()=>{}));c.AbortController=undefined;const t=Date.now();assert.strictEqual((await c.selectServerStream([stream('https://cdn.test/hang.m3u8')],{url:'https://voe.sx/e/a'},1)).length,0);assert.ok(Date.now()-t<250);
});
await test('one source per website choice; same-host choices remain distinct',async()=>{
 const c=runtime(async(url)=>response(url,master));c.resolveMirror=async(m)=>[stream('https://cdn.test/shared.m3u8'),stream('https://cdn.test/other.m3u8')];
 const selected=await c.resolveMirrors([{url:'https://hgcloud.to/e/a',label:'Server 3'},{url:'https://hgcloud.to/e/b',label:'Server 4'}],'https://site.test/movie/');const output=c.formatStreams(selected);assert.strictEqual(output.length,2);assert.strictEqual(output[0].title,'HGCloud 3 • Auto • MalaySub');assert.strictEqual(output[1].title,'HGCloud 4 • Auto • MalaySub');
});
await test('website tab label wins over generic iframe discovery',async()=>{
 const c=runtime();const html='<div class="player_nav"><ul class="idTabs"><li><span class="les-title"><strong>Server 6</strong></span><a href="#player6">Play</a></li></ul></div><div id="player6"><iframe src="https://voe.sx/e/id"></iframe></div>';
 const options=c.collectEmbedUrls(html,'https://site.test/movie/');assert.strictEqual(options.length,1);assert.strictEqual(options[0].label,'Server 6');
});
await test('server without number uses discovery order; lowercase Referer preserved',async()=>{
 const c=runtime(async(url)=>response(url,master));const selected=await c.selectServerStream([{url:'https://cdn.test/a.m3u8',label:'VOE',headers:{referer:'https://original.test/'}}],{url:'https://voe.sx/e/a',label:'Server'},6);
 const output=c.formatStreams(selected)[0];assert.strictEqual(output.title,'Voe 6 • Auto • MalaySub');assert.strictEqual(output.headers.referer,'https://original.test/');assert.ok(!output.headers.Referer);
});
console.log(passed+' per-server selection checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
