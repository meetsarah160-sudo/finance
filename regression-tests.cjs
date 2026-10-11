const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const source = [...fs.readFileSync(__dirname + '/index.html', 'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim()).join('\n');
const clone = x => JSON.parse(JSON.stringify(x));
function harness(overrides = {}) {
  const row = {id:'config-1',user_id:'test',owner_id:'owner',updated_at:'2026-01-01T00:00:00Z', categories:[],assets_data:[{id:'bank',typeId:'liquid',name:'bank',value:100}],asset_history:[{date:'2026-01-01',month:'2026-01',total:100}], asset_types:[],expense_overrides:{},bucket_map:{},incomes_data:[{id:'old-income',date:'2026-01-01',item:'legacy',type:'工资',amount:100}],goals_data:[{id:'old-goal',name:'goal',targetAmount:1000,currentAmount:0,deadline:''}],...overrides};
  const tables = {user_configs:[row],expenses:[],incomes:[{id:'partial-table-income',date:'2026-02-01',amount:5}],goals:[]};
  const writes=[], toasts=[], cache=new Map();let failure=false;
  const db={from(table){let op='select',payload,filters=[],range;const query={
    select(){return query;},eq(k,v){filters.push(r=>r[k]===v);return query;},is(k,v){filters.push(r=>r[k]===v);return query;},order(){return query;},range(a,b){range=[a,b];return query;},
    update(p){op='update';payload=p;return query;},insert(p){op='insert';payload=p;return query;},delete(){op='delete';return query;},
    maybeSingle(){return resolve(true);},single(){return resolve(true);},then(a,b){return resolve(false).then(a,b);}
  };async function resolve(single){
    if(failure)return {error:{message:'simulated network failure'}};
    let rows=tables[table].filter(r=>filters.every(f=>f(r)));
    if(op!=='select'){
      writes.push({table,op,payload:clone(payload||{})});
      if(op==='update')rows.forEach(r=>Object.assign(r,clone(payload),{updated_at:new Date().toISOString()}));
      if(op==='insert'){const r={id:crypto.randomUUID(),...clone(payload)};tables[table].push(r);rows=[r];}
    }
    if(range)rows=rows.slice(range[0],range[1]+1);
    if(single && rows.length!==1)return {data:null,error:rows.length?{message:'multiple rows'}:op==='select'?null:{message:'conflict: no matching revision'}};
    return {data:clone(single?rows[0]:rows),error:null};
  }return query;}};
  const elem={value:'',style:{},classList:{add(){},remove(){},contains(){return false;}},addEventListener(){},getContext(){return {}},options:[]};
  const context=vm.createContext({console,crypto,Date,setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},localStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},window:{supabase:{createClient:()=>db},addEventListener(){}},document:{getElementById:()=>elem,querySelectorAll:()=>[],querySelector:()=>elem,addEventListener(){},documentElement:{style:{}}},navigator:{},location:{},confirm:()=>true});
  vm.runInContext(source,context);
  vm.runInContext(`authUserId='owner';currentUser='test';init=()=>initAssets();autoBackupToIndexedDB=async()=>{};setSyncStatus=s=>window.status=s;showToast=(m,t)=>window.toasts.push({m,t});`,context);
  context.window.toasts=toasts;
  return {run:s=>vm.runInContext(s,context),tables,writes,cache,toasts,setFailure:v=>failure=v};
}
test('cloud history survives init, and hydration never writes',async()=>{const h=harness();await h.run('loadDataFromCloud()');assert.equal(h.run('assetHistory.length'),1);assert.equal(h.writes.length,0);assert.equal(h.run('incomes[0].id'),'old-income');assert.ok(h.cache.has('finance_asset_history_test'));});
test('empty cloud arrays do not resurrect stale local data',async()=>{const h=harness({assets_data:[],asset_history:[],incomes_data:[],goals_data:[]});h.cache.set('finance_asset_history_test','[{"total":999}]');await h.run('loadDataFromCloud()');assert.equal(h.run('assetHistory.length+assets.length+incomes.length+goals.length'),0);});
test('new income preserves full config history after reload without writing legacy table',async()=>{const h=harness();await h.run('loadDataFromCloud()');assert.equal(await h.run(`incomes.push({id:'new-income',date:'2026-10-11',item:'new',type:'工资',amount:20});saveIncomeToCloud(incomes.at(-1))`),true);await h.run('loadDataFromCloud()');assert.equal(h.run('incomes.length'),2);assert.equal(h.run('assetHistory.length'),1);assert.ok(h.writes.every(w=>w.table==='user_configs'));});
test('deleting final income stays deleted on reload despite legacy table',async()=>{const h=harness();await h.run('loadDataFromCloud()');assert.equal(await h.run('incomes=[];deleteIncomeFromCloud("old-income")'),true);await h.run('loadDataFromCloud()');assert.equal(h.run('incomes.length'),0);});
test('stale revision refuses overwrite and retains pending backup',async()=>{const h=harness();await h.run('loadDataFromCloud()');h.tables.user_configs[0].updated_at='2030-01-01';h.tables.user_configs[0].asset_history.push({month:'2030-01'});assert.equal(await h.run('syncAllToCloud()'),false);assert.equal(h.tables.user_configs[0].asset_history.length,2);assert.ok(h.cache.has('finance_pending_config_test'));});
test('failed load cannot save empty configuration',async()=>{const h=harness();h.setFailure(true);assert.equal(await h.run('loadDataFromCloud()'),false);h.setFailure(false);assert.equal(await h.run('syncAllToCloud()'),false);assert.equal(h.writes.length,0);});
test('config writes are serialized with revision returned by each update',async()=>{const h=harness();await h.run('loadDataFromCloud()');const results=await h.run(`Promise.all([syncAllToCloud(),syncAllToCloud()])`);assert.deepEqual(Array.from(results),[true,true]);});
test('refresh failure does not show sync success',async()=>{const h=harness();await h.run('loadDataFromCloud()');h.setFailure(true);await h.run('syncData()');assert.ok(!h.toasts.some(t=>t.m==='已从云端刷新'));});
test('local date does not use the previous UTC calendar date',()=>{const h=harness();assert.equal(h.run(`localDateString(new Date(2026,9,11,0,1))`),'2026-10-11');});
test('default asset groups preserve investment classification',()=>{const h=harness();assert.equal(h.run('bucketOf("invest")'),'invest');assert.equal(h.run('bucketOf("protect")'),'invest');assert.equal(h.run('BUCKET_MAP.invest="invalid";bucketOf("invest")'),'liquid');});
test('net worth subtracts positive debt balances',()=>{const h=harness();h.run('BUCKET_MAP.loan="debt";assets=[{typeId:"liquid",value:1000},{typeId:"loan",value:300}]');assert.equal(h.run('assetTotals().net'),700);assert.equal(h.run('assetTotals().gross'),1000);});
test('category deletion cannot break historical references',async()=>{const h=harness();await h.run('loadDataFromCloud()');h.run('categories=[{id:1,name:"used"},{id:9,name:"unused"},{id:12,name:"keep"}];expenses=[{categoryId:1}]');await h.run('deleteCategory(0)');assert.equal(h.run('categories.length'),3);h.run('renderSettings=renderCategoryGrid=renderBudgetTip=renderBudgetStatus=()=>{}');await h.run('deleteCategory(1)');assert.equal(h.run('categories[1].id'),12);});
test('editing legacy income updates the authoritative config',async()=>{const h=harness();await h.run('loadDataFromCloud()');h.run('renderIncomeTable=closeIncomeEditModal=()=>{};document.getElementById=id=>({value:({editIncomeDate:"2026-03-01",editIncomeType:"工资",editIncomeItem:"edited",editIncomeAmount:"123"})[id]})');await h.run('saveIncomeEdit("old-income")');await h.run('loadDataFromCloud()');assert.equal(h.run('incomes[0].amount'),123);assert.equal(h.run('incomes[0].item'),'edited');});
