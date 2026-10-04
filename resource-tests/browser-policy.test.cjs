const test=require('node:test');const assert=require('node:assert/strict');
const {BrowserHost}=require('../launcher/electron/browser-host.cjs');
const {readResourcePolicy}=require('../launcher/electron/resource-policy.cjs');
const policy=readResourcePolicy({CODEX_CHATGPT_WEB_RESOURCE_PROFILE:'low'});
test('low profile rejects third active tab including pending approvals',async()=>{
 const turnTabs=new Map([['a',{status:'running',approvalPending:true}],['b',{status:'running'}]]);
 await assert.rejects(BrowserHost.prototype.createTurnTab.call({turnTabs,resourcePolicy:policy},'trace_3',123),/already has 2 browser tabs/);
 assert.equal(turnTabs.size,2);
});
test('low profile reaps only completed idle tabs at five minutes in both modes',()=>{
 for(const interactionMode of ['manual','automatic']){
  const ready={id:'ready',status:'ready',lastHeartbeatAt:100,interactionMode};
  const running={id:'running',status:'running',bootstrapReady:true,lastHeartbeatAt:300100,approvalPending:true,interactionMode:'automatic'};
  const removed=[];const f={resourcePolicy:policy,turnTabs:new Map([['ready',ready],['running',running]]),logger:{info(){}},removeTurnTab(t,a){removed.push([t.id,a]);this.turnTabs.delete(t.id);}};
  BrowserHost.prototype.reapExpiredTurnTabs.call(f,300099);assert.deepEqual(removed,[]);
  BrowserHost.prototype.reapExpiredTurnTabs.call(f,300100);assert.deepEqual(removed,[['ready',false]]);assert.equal(f.turnTabs.has('running'),true);
 }
});

test('user five-tab policy permits capacity five and rejects sixth active owner',async()=>{
 const resourcePolicy=readResourcePolicy({CODEX_CHATGPT_WEB_RESOURCE_PROFILE:'low',CODEX_CHATGPT_WEB_MAX_TABS:'5'});
 assert.equal(resourcePolicy.maxTabs,5);assert.equal(resourcePolicy.retainedTabTtlMs,300000);
 const turnTabs=new Map(Array.from({length:5},(_,i)=>[String(i),{status:'running',approvalPending:i===0}]));
 await assert.rejects(BrowserHost.prototype.createTurnTab.call({turnTabs,resourcePolicy},'trace_6',123),/already has 5 browser tabs/);
 assert.equal(turnTabs.size,5);assert.equal(turnTabs.get('0').approvalPending,true);
});
