// Offline microbenchmarks. No browser, credentials, network, or account is used.
import { spawnSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { Writable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
const baseline='b6ca2d3f91f8a2ba140b522fe3b3c50b4ebffa2d';
if (!process.argv[2]) {
  const runs=[];
  for(const scenario of ['fifo','fifo-with-production-budget','blocked-pipe']) for(const variant of ['upstream','efficient']) for(let trial=1;trial<=3;trial++) {
    const p=spawnSync(process.execPath,['--expose-gc',import.meta.filename,scenario,variant],{encoding:'utf8'});
    if(p.status!==0) throw new Error(p.stderr);
    runs.push({...JSON.parse(p.stdout),trial});
  }
  console.log(JSON.stringify({baseline,node:process.version,platform:process.platform,arch:process.arch,
    caveat:'Synthetic source-level Node microbenchmarks, not Bun/Electron or live ChatGPT RAM/CPU measurements. Peak RSS is process-wide; separate process per trial. Pipe baseline buffers all writes; efficient version explicitly fails at budget.',runs},null,2));
  process.exit(0);
}
const [scenario,variant]=process.argv.slice(2);
const file=scenario.startsWith('fifo')?'src/event-queue.ts':'src/adapters/chatgpt-web/process-line-writer.ts';
const source=variant==='upstream'?readFileSync(`scripts/resource/baseline/${file.split('/').pop()}`,'utf8'):readFileSync(file,'utf8');
const code=stripTypeScriptTypes(source,{mode:'transform'});
const sinkCode=stripTypeScriptTypes(readFileSync('src/adapter-event-sink.ts','utf8'),{mode:'transform'});
const {estimateAdapterEventBytes}=await import(`data:text/javascript;base64,${Buffer.from(sinkCode).toString('base64')}`);
const mod=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
global.gc?.();const start=performance.now();const cpu=process.cpuUsage();const before=process.memoryUsage();
let details;
if(scenario.startsWith('fifo')) {
  let checksum=0;
  // Same 10k event backlog and repeated drain in both versions; no byte-budget serialization here.
  for(let round=0;round<100;round++) {
    const payload=scenario==='fifo-with-production-budget';
    const q=new mod.AsyncEventQueue(payload && variant==='efficient'
      ? {maxBuffered:10000,maxBufferedBytes:16*1024*1024,sizeOf:estimateAdapterEventBytes} : 10000);
    for(let i=0;i<10000;i++)q.push(payload ? {type:'text_delta',text:'x'.repeat(128),id:i} : i);
    q.close();for await(const n of q)checksum+=payload ? n.id : n;
  }
  details={events:1000000,checksum};
} else {
  const stream=new Writable({highWaterMark:1024,write(){}});
  let failureCount=0,accepted=0;
  const writer=mod.createProcessLineWriter(stream,()=>failureCount++);
  for(let i=0;i<10000;i++) if(writer.write(`${i}:`+'x'.repeat(16384))) accepted++;
  details={attempted:10000,accepted,failureCount,writableBytes:stream.writableLength};
}
const used=process.cpuUsage(cpu);const after=process.memoryUsage();
console.log(JSON.stringify({scenario,variant,elapsedMs:performance.now()-start,cpuMs:(used.user+used.system)/1000,heapDeltaBytes:after.heapUsed-before.heapUsed,rssDeltaBytes:after.rss-before.rss,maxRssKiB:process.resourceUsage().maxRSS,...details}));
