import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { AsyncEventQueue } from '../src/event-queue.ts';
import { createProcessLineWriter } from '../src/adapters/chatgpt-web/process-line-writer.ts';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readResourcePolicy } = require('../launcher/electron/resource-policy.cjs');

test('queue preserves FIFO including undefined and releases drained references', async () => {
  const q = new AsyncEventQueue(20000);
  q.push(undefined);
  for (let i=0;i<15000;i++) q.push(i);
  q.close();
  assert.deepEqual(await q.collect(), [undefined, ...Array.from({length:15000},(_,i)=>i)]);
  assert.equal(q.bufferedCount,0); assert.equal(q.bufferedBytes,0);
});
test('queue byte and count bounds, terminal error and cancellation', async () => {
  const q = new AsyncEventQueue({maxBuffered:3,maxBufferedBytes:10,sizeOf:x=>x.length});
  q.push('123456'); assert.throws(()=>q.push('12345'),/backlog/);
  q.fail('error'); assert.deepEqual(await q.collect(),['error']);
  q.push('ignored'); assert.equal(q.bufferedCount,0);
  const r = new AsyncEventQueue(2); r.push(1);r.push(2);
  assert.throws(()=>r.push(3),/backlog/);
  await r[Symbol.asyncIterator]().return(); assert.equal(r.bufferedCount,0);
});
test('queue delivers pending consumer and closes waiting readers', async () => {
  const q = new AsyncEventQueue(); const i=q[Symbol.asyncIterator]();
  const next=i.next();q.push(undefined);assert.deepEqual(await next,{value:undefined,done:false});
  const end=i.next();q.close();assert.equal((await end).done,true);
});
test('writer waits for drain and preserves UTF-8 line order', async () => {
  const chunks=[];const callbacks=[];const failures=[];
  const stream=new Writable({highWaterMark:1,write(c,e,cb){chunks.push(c.toString());callbacks.push(cb);}});
  const writer=createProcessLineWriter(stream,e=>failures.push(e),{maxBufferedBytes:100});
  writer.write('é');writer.write('second');writer.write('third');
  assert.equal(stream.writableLength,3);assert.deepEqual(chunks,['é\n']);
  callbacks.shift()();await new Promise(r=>setImmediate(r));
  assert.deepEqual(chunks,['é\n','second\n']);
  callbacks.shift()();await new Promise(r=>setImmediate(r));
  callbacks.shift()();await new Promise(r=>setImmediate(r));
  assert.deepEqual(chunks,['é\n','second\n','third\n']);assert.deepEqual(failures,[]);
  writer.close();assert.equal(stream.listenerCount('drain'),0);stream.destroy();
});
test('writer stalled peer is bounded, fails once and clears listeners', () => {
  const failures=[];const stream=new Writable({highWaterMark:1,write(){}});
  const writer=createProcessLineWriter(stream,e=>failures.push(e),{maxBufferedBytes:12});
  assert.equal(writer.write('12345'),true);assert.equal(writer.write('12345'),true);
  assert.equal(writer.write('x'),false);assert.equal(writer.write('x'),false);
  assert.equal(failures.length,1);assert.match(failures[0].message,/byte budget/);
  assert.equal(stream.writableLength,6);assert.equal(stream.listenerCount('drain'),0);stream.destroy();
});
test('writer consumes asynchronous pipe failures exactly once',async()=>{
  const failures=[];const stream=new Writable({write(c,e,cb){cb(new Error('write EOF'));}});
  const writer=createProcessLineWriter(stream,e=>failures.push(e));writer.write('event');
  await new Promise(r=>setImmediate(r));assert.equal(failures.length,1);assert.equal(writer.write('late'),false);
});
test('resource defaults preserve existing behavior and low preset never increases cap',()=>{
  assert.deepEqual(readResourcePolicy({}),{profile:'balanced',maxTabs:5,retainedTabTtlMs:1800000});
  assert.deepEqual(readResourcePolicy({CODEX_CHATGPT_WEB_RESOURCE_PROFILE:'low'}),{profile:'low',maxTabs:2,retainedTabTtlMs:300000});
  for(const value of ['0','6','NaN','1.5','-1']) assert.throws(()=>readResourcePolicy({CODEX_CHATGPT_WEB_MAX_TABS:value}));
  assert.throws(()=>readResourcePolicy({CODEX_CHATGPT_WEB_RESOURCE_PROFILE:'turbo'}));
  assert.throws(()=>readResourcePolicy({CODEX_CHATGPT_WEB_IDLE_TAB_SECONDS:'29'}));
});

test('timer-originated adapter overflow fails the turn without an uncaught exception',async()=>{
  const {createAdapterEventSink}=await import('../src/adapter-event-sink.ts');
  const q=new AsyncEventQueue({maxBuffered:2,maxBufferedBytes:10000,sizeOf:e=>JSON.stringify(e).length*2});
  const abort=new AbortController();let observed=0;
  const sink=createAdapterEventSink(q,abort,()=>observed++);
  sink.emit({type:'text_delta',text:'one'});sink.emit({type:'text_delta',text:'two'});
  await new Promise(resolve=>setTimeout(()=>{sink.emit({type:'heartbeat'});resolve();},0));
  assert.equal(abort.signal.aborted,true);
  sink.emit({type:'done'});sink.fail(new Error('duplicate'));
  const events=await q.collect();assert.equal(events.length,1);assert.equal(events[0].type,'error');
  assert.match(events[0].message,/backlog/);assert.equal(observed,4);
});

test('writer close explicitly discards pending output and is not a flush',()=>{
  const chunks=[];const stream=new Writable({highWaterMark:1,write(c){chunks.push(c.toString());}});
  const writer=createProcessLineWriter(stream,()=>{});writer.write('first');writer.write('pending');
  writer.close();stream.emit('drain');assert.deepEqual(chunks,['first\n']);
  assert.equal(writer.write('late'),false);assert.equal(stream.listenerCount('drain'),0);stream.destroy();
});

test('writer tiny-frame backlog has an independent object-count cap',()=>{
 const failures=[];const stream=new Writable({highWaterMark:1,write(){}});
 const writer=createProcessLineWriter(stream,e=>failures.push(e));
 let accepted=0;for(let i=0;i<10005;i++) if(writer.write(''))accepted++;
 assert.equal(accepted,10001);assert.equal(failures.length,1);assert.match(failures[0].message,/frame limit/);stream.destroy();
});

test('payload estimator handles wide strings and nested terminal state',async()=>{
 const {estimateAdapterEventBytes}=await import('../src/adapter-event-sink.ts');
 assert.equal(estimateAdapterEventBytes({type:'text_delta',text:'💡'.repeat(100)}),592);
 assert.ok(estimateAdapterEventBytes({type:'done',providerState:{test:{data:'x'.repeat(10000)}}})>20000);
});

test('fork workflow is manual, read-only, artifact-only and preserves verification',async()=>{
 const {readFileSync,readdirSync}=await import('node:fs');
 const wf=readFileSync(new URL('../.github/workflows/windows-build.yml',import.meta.url),'utf8');
 assert.match(wf,/workflow_dispatch:/);assert.doesNotMatch(wf,/^  (push|pull_request|schedule):/m);
 assert.match(wf,/contents: read/);assert.doesNotMatch(wf,/contents: write|gh release|secrets\./);
 assert.match(wf,/persist-credentials: false/);assert.match(wf,/bun run verify/);assert.match(wf,/bun run app:smoke/);
 assert.deepEqual(readdirSync(new URL('../.github/workflows/',import.meta.url)),['windows-build.yml']);
});

test('user five-tab preset overrides low default without global mutations',()=>{
 const {efficientEnvironment,launchEfficient}=require('../scripts/start-efficient.cjs');
 const original={CODEX_CHATGPT_WEB_MAX_TABS:'2',KEEP:'yes'};
 const env=efficientEnvironment(original);
 assert.deepEqual(readResourcePolicy(env),{profile:'low',maxTabs:5,retainedTabTtlMs:300000});
 assert.equal(original.CODEX_CHATGPT_WEB_MAX_TABS,'2');assert.equal(original.CODEX_CHATGPT_WEB_RESOURCE_PROFILE,undefined);
 assert.equal(env.KEEP,'yes');
 assert.equal(readResourcePolicy(efficientEnvironment({CODEX_CHATGPT_WEB_IDLE_TAB_SECONDS:'120'})).retainedTabTtlMs,120000);
 let call;
 assert.equal(launchEfficient({env:original,spawn:(command,args,options)=>{call={command,args,options};return {status:7};}}),7);
 assert.deepEqual(call.args,['run','app']);assert.equal(call.options.shell,false);
 assert.equal(call.options.env.CODEX_CHATGPT_WEB_MAX_TABS,'5');assert.equal(call.options.env.CODEX_CHATGPT_WEB_RESOURCE_PROFILE,'low');
 assert.throws(()=>launchEfficient({spawn:()=>({error:new Error('missing runtime')})}),/missing runtime/);
});
