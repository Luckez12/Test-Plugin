const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),{createRequire}=require('module');
const filename=path.resolve(__dirname,'../providers/pencurimovie.js');
function runtime(fetch){const ctx={require:createRequire(filename),module:{exports:{}},console:{log(){}},fetch,setTimeout,clearTimeout,AbortController};vm.createContext(ctx);vm.runInContext(fs.readFileSync(filename,'utf8'),ctx);return ctx;}
function response(url,text,status=200){return {url,ok:status>=200&&status<300,status,text:async()=>text};}
function encoded(data){const first=Buffer.from(JSON.stringify(data),'utf8').toString('base64').split('').reverse().join('');const shifted=Array.from(first,c=>String.fromCharCode(c.charCodeAt(0)+3)).join('');return Buffer.from(shifted,'latin1').toString('base64').replace(/[a-z]/gi,c=>String.fromCharCode((c.charCodeAt(0)-(c<='Z'?65:97)+13)%26+(c<='Z'?65:97)));}
const source='https://cdn.test/engine/hls2/id?token=a%2Fb&expires=123';const direct='https://cdn.test/engine/download/id?token=x';
const script='<script>var source="https://dummy.test/test-video.mp4"</script><script type="application/json">'+JSON.stringify([encoded({source,direct_access_url:direct})])+'</script>';
const page='https://ww44.pencurimovie.baby/supergirl-2026/';let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
await test('Voe extensionless decoded sources retained; dummy page video excluded',async()=>{
 const ctx=runtime(async(url)=>response(url,script));const streams=await ctx.resolveVoe('https://voe.sx/e/id',page);
 assert.strictEqual(streams.length,2);assert.strictEqual(streams[0].url,source);assert.strictEqual(streams[1].url,direct);assert.strictEqual(streams[0].headers.Origin,'https://voe.sx');assert.strictEqual(streams[0].referer,'https://voe.sx/');
});
await test('Voe raw JSON bodies work even when selector bridge lacks script text',async()=>{
 const ctx=runtime(async(url)=>response(url,script));ctx.getCheerio=()=>{throw Error('script selectors unavailable');};assert.strictEqual((await ctx.resolveVoe('https://voe.sx/e/id',page)).length,2);
});
await test('Voe redirect preserves original request referer and alias media context',async()=>{
 const requests=[];const target='https://jeremyparticipantanything.com/e/id';const ctx=runtime(async(url,options)=>{requests.push({url,options});return response(url,url.includes('voe.sx')?'<script>window.location.href = "'+target+'";</script>':script);});
 const streams=await ctx.resolveVoe('https://voe.sx/e/id',page);assert.strictEqual(requests.length,2);assert.strictEqual(requests[1].url,target);assert.strictEqual(requests[1].options.headers.Referer,page);assert.strictEqual(streams[1].referer,target);
});
await test('invalid first JSON script does not suppress valid later payload',async()=>{
 const ctx=runtime(async(url)=>response(url,'<script type="application/json">{"analytics":true}</script>'+script));assert.strictEqual((await ctx.resolveVoe('https://voe.sx/e/id',page)).length,2);
});
await test('bad encoded payload produces no dummy or guessed source',async()=>{
 const ctx=runtime(async(url)=>response(url,'<script>var source="https://dummy.test/video.mp4"</script><script type="application/json">["bad"]</script>'));assert.strictEqual((await ctx.resolveVoe('https://voe.sx/e/id',page)).length,0);
 assert.strictEqual(ctx.voeMediaUrl('javascript:alert(1)',page),'');
});
await test('HG loader uses native mirror with same video ID/query and native referer',async()=>{
 const requests=[];const ctx=runtime(async(url)=>{requests.push(url);return response(url,url.includes('hgcloud')?'<script src="/main.js"></script>':'<script>var sources={"hls2":"https://cdn.test/master.m3u8?t=a%2Fb&x=1","hls3":"https://cdn.test/master.txt"}</script>');});
 const streams=await ctx.resolveStreamWish('https://hgcloud.to/e/abcd?token=keep',page);
 assert.strictEqual(requests.length,2);assert.strictEqual(requests[1],'https://hanerix.com/e/abcd?token=keep');assert.strictEqual(streams.length,1);assert.strictEqual(streams[0].label,'HGCloud');assert.strictEqual(streams[0].referer,requests[1]);assert.ok(!requests.some(u=>u.includes('main.js')));
});
await test('HG native failures continue to next advertised host; no CDN guessing',async()=>{
 const requests=[];const ctx=runtime(async(url)=>{requests.push(url);if(url.includes('hanerix'))throw Error('offline');return response(url,url.includes('audinifer')?'file:"https://cdn.test/master.m3u8"':'loader');});
 const streams=await ctx.resolveStreamWish('https://hgcloud.to/e/id',page);assert.strictEqual(streams.length,1);assert.strictEqual(requests[2],'https://audinifer.com/e/id');assert.strictEqual(requests.length,3);
});
await test('HG original native page skips mirrors; packed relative HLS supported',async()=>{
 const requests=[];const packed="eval(function(p,a,c,k,e,d){return p}('var o={\\\"hls4\\\":\\\"/path/master.m3u8?token=a\\\\u0026x=1\\\"};',10,0,''.split('|')))".replace(/\\"/g,'"');
 const ctx=runtime(async(url)=>{requests.push(url);return response(url,packed);});const streams=await ctx.resolveStreamWish('https://hgcloud.to/e/id',page);
 assert.strictEqual(streams.length,1);assert.strictEqual(streams[0].url,'https://hgcloud.to/path/master.m3u8?token=a&x=1');assert.strictEqual(requests.length,1);
});
await test('HG aliases get existing host priority; all discovered mirrors eligible',async()=>{
 const ctx=runtime();assert.strictEqual(ctx.mirrorPriority({url:'https://hgcloud.to/e/id'}),2);assert.ok(ctx.isHgCloud('https://hanerix.com/e/id'));assert.ok(!ctx.isHgCloud('https://hgcloud.to.bad.test/e/id'));
 let selected=[];ctx.resolveMirror=async(m)=>{selected.push(m.url);return [];};await ctx.resolveMirrors(Array.from({length:8},(_,i)=>({url:i<2?'https://hgcloud.to/e/'+i:i<4?'https://voe.sx/e/'+i:i<6?'https://dsvplay.com/e/'+i:'https://streamtape.com/e/'+i})),page);
 assert.strictEqual(selected.length,8);assert.strictEqual(selected.filter(u=>u.includes('hgcloud')).length,2);
});
await test('original movie/TV getStreams format preserved',async()=>{
 for(const type of ['movie','tv']){const ctx=runtime(async(url)=>response(url,url.includes('cdn.test')?'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n720/index.m3u8\n':script));ctx.getTmdbDetails=async()=>({});ctx.findTitle=async()=>({url:page});ctx.loadPlaybackPage=async(item,mediaType,season,episode)=>{assert.strictEqual(mediaType,type);assert.strictEqual(season,2);assert.strictEqual(episode,3);return {url:page,html:'<div class="movieplay"><iframe src="https://voe.sx/e/id"></iframe></div>'};};const streams=await ctx.module.exports.getStreams(77,type,2,3);assert.strictEqual(streams.length,1);assert.strictEqual(streams[0].name,'PencuriMovie');assert.strictEqual(streams[0].url,source);assert.strictEqual(streams[0].headers.Origin,'https://voe.sx');}
});
console.log(passed+' extraction regression checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
