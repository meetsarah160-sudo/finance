const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const source = [...fs.readFileSync(__dirname + '/index.html', 'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim()).join('\n')+'\n'+fs.readFileSync(__dirname+'/review.js','utf8');
const clone = x => JSON.parse(JSON.stringify(x));
function harness(overrides = {}) {
  const row = {id:'config-1',user_id:'test',owner_id:'owner',updated_at:'2026-01-01T00:00:00Z', categories:[],assets_data:[{id:'bank',typeId:'liquid',name:'bank',value:100}],asset_history:[{date:'2026-01-01',month:'2026-01',total:100}], asset_types:[],expense_overrides:{},bucket_map:{},incomes_data:[{id:'old-income',date:'2026-01-01',item:'legacy',type:'工资',amount:100}],goals_data:[{id:'old-goal',name:'goal',targetAmount:1000,currentAmount:0,deadline:''}],...overrides};
  const tables = {user_configs:[row],expenses:[],incomes:[{id:'partial-table-income',date:'2026-02-01',amount:5}],goals:[]};
  const writes=[], toasts=[], cache=new Map();let failure=false;
  const db={from(table){let op='select',payload,filters=[],range;const query={
    select(){return query;},eq(k,v){filters.push(r=>r[k]===v);return query;},is(k,v){filters.push(r=>r[k]===v);return query;},order(){return query;},range(a,b){range=[a,b];return query;},
    upsert(p){op='upsert';payload=p;return query;},update(p){op='update';payload=p;return query;},insert(p){op='insert';payload=p;return query;},delete(){op='delete';return query;},
    maybeSingle(){return resolve(true);},single(){return resolve(true);},then(a,b){return resolve(false).then(a,b);}
  };async function resolve(single){
    if(failure)return {error:{message:'simulated network failure'}};
    let rows=tables[table].filter(r=>filters.every(f=>f(r)));
    if(op!=='select'){
      writes.push({table,op,payload:clone(payload||{})});
      if(op==='update')rows.forEach(r=>Object.assign(r,clone(payload),{updated_at:new Date().toISOString()}));
      if(op==='upsert'){const old=tables[table].find(r=>r.id===payload.id);if(old)rows=[];else {const r=clone(payload);tables[table].push(r);rows=[r];}}
      if(op==='insert'){const r={id:crypto.randomUUID(),...clone(payload)};tables[table].push(r);rows=[r];}
    }
    if(range)rows=rows.slice(range[0],range[1]+1);
    if(single && rows.length!==1)return {data:null,error:rows.length?{message:'multiple rows'}:(op==='select'||op==='upsert')?null:{message:'conflict: no matching revision'}};
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
test('default asset groups preserve investment classification',()=>{const h=harness();assert.equal(h.run('bucketOf("invest")'),'invest');assert.equal(h.run('bucketOf("protect")'),'invest');assert.equal(h.run('BUCKET_MAP.invest="invalid";bucketOf("invest")'),'invest');});
test('net worth subtracts positive debt balances',()=>{const h=harness();h.run('BUCKET_MAP.loan="debt";assets=[{typeId:"liquid",value:1000},{typeId:"loan",value:300}]');assert.equal(h.run('assetTotals().net'),700);assert.equal(h.run('assetTotals().gross'),1000);});
test('category deletion cannot break historical references',async()=>{const h=harness();await h.run('loadDataFromCloud()');h.run('categories=[{id:1,name:"used",yearly:100},{id:9,name:"unused",yearly:100},{id:12,name:"keep",yearly:100}];expenses=[{id:"e",categoryId:1,date:"2026-01-01",amount:10}]');await h.run('deleteCategory(0)');assert.equal(h.run('categories.length'),3);h.run('renderSettings=renderCategoryGrid=renderBudgetTip=renderBudgetStatus=renderDashboard=renderReport=()=>{}');await h.run('deleteCategory(1)');assert.equal(h.run('categories[1].id'),12);});
test('editing legacy income updates the authoritative config',async()=>{const h=harness();await h.run('loadDataFromCloud()');h.run('renderIncomeTable=closeIncomeEditModal=()=>{};document.getElementById=id=>({value:({editIncomeDate:"2026-03-01",editIncomeType:"工资",editIncomeItem:"edited",editIncomeAmount:"123"})[id]})');await h.run('saveIncomeEdit("old-income")');await h.run('loadDataFromCloud()');assert.equal(h.run('incomes[0].amount'),123);assert.equal(h.run('incomes[0].item'),'edited');});

function importFixture(){return {version:'v5',user:'test',categories:[{id:1,name:'food',type:'日常',yearly:100}],expenses:[],incomes:[],goals:[],assets:[],assetHistory:[],assetTypes:[],monthlyExpenseOverrides:{},bucketMap:{}};}
test('receivables are in net worth but never available cash',()=>{const h=harness();h.run('assets=[{typeId:"liquid",value:100},{typeId:"pending",value:900},{typeId:"other",value:30}]');assert.equal(h.run('assetTotals().net'),1030);assert.equal(h.run('assetBuckets().liquid'),100);assert.equal(h.run('assetBuckets().receivable'),930);});
test('missing months suppress averages instead of assuming zero',()=>{const h=harness();h.run('expenses=[{date:"2026-09-01",amount:600}];incomes=[{date:"2026-09-01",amount:1200}]');assert.equal(h.run('cashflowWindow(new Date(2026,9,11)).avgExp'),null);assert.equal(h.run('cashflowWindow(new Date(2026,9,11)).missing.length'),5);});
test('shared six-month window excludes partial current month',()=>{const h=harness();h.run('expenses=[];incomes=[];for(let m=4;m<=9;m++){expenses.push({date:`2026-${String(m).padStart(2,"0")}-01`,amount:100});incomes.push({date:`2026-${String(m).padStart(2,"0")}-01`,amount:200});}expenses.push({date:"2026-10-01",amount:9999})');assert.equal(h.run('cashflowWindow(new Date(2026,9,11)).avgExp'),100);assert.equal(h.run('cashflowWindow(new Date(2026,9,11)).avgInc'),200);});
test('validates every imported row before any write',()=>{const h=harness();const fixture=importFixture();fixture.expenses=[{date:'2026-10-01',item:'ok',amount:1,categoryId:1},{date:'2026-02-30',item:'bad',amount:2,categoryId:1}];assert.throws(()=>h.run(`validateBackup(${JSON.stringify(fixture)},true)`),/第 2 条/);assert.equal(h.writes.length,0);});
test('append deduplicates within file and preserves existing records',()=>{const h=harness();const base=importFixture();const row={id:1,date:'2026-10-01',item:'new',amount:10,categoryId:1,type:'日常'};const data={user:'test',expenses:[row,row]};const plan=h.run(`buildImportPlan(${JSON.stringify(data)},${JSON.stringify(base)},'追加')`);assert.equal(plan.result.expenses.length,1);assert.match(plan.result.expenses[0].id,/^[0-9a-f-]{36}$/);});
test('partial overwrite and foreign profile imports fail closed',()=>{const h=harness();const base=JSON.stringify(importFixture());assert.throws(()=>h.run(`buildImportPlan({expenses:[]},${base},'覆盖')`),/categories/);assert.throws(()=>h.run(`buildImportPlan({user:'other'},${base},'追加')`),/其他账本/);});
test('category ID collision fails rather than misclassifying expenses',()=>{const h=harness();assert.throws(()=>h.run(`buildImportPlan({categories:[{id:1,name:'rent',yearly:1}]},${JSON.stringify(importFixture())},'追加')`),/不同名称/);});
test('expense retry uses same ID and inserts exactly once',async()=>{const h=harness();await h.run('loadDataFromCloud()');h.run('expenses=[{id:123,date:"2026-10-11",item:"retry",amount:1,categoryId:1}];');assert.equal(await h.run('saveExpenseToCloud(expenses[0])'),true);const id=h.run('expenses[0].id');assert.equal(await h.run('saveExpenseToCloud(expenses[0])'),true);assert.equal(h.tables.expenses.length,1);assert.equal(h.run('expenses[0].id'),id);});
test('category reset refuses to invalidate historical references',async()=>{const h=harness();h.run('categories=[{id:999,name:"custom",yearly:100}];expenses=[{categoryId:999,categoryName:"custom"}]');await h.run('resetToDefaultCategories()');assert.equal(h.run('categories[0].id'),999);assert.equal(h.writes.length,0);});

test('22 legacy categories inherit agreed scopes without rewriting history or budgets',async()=>{
  const categories=Array.from({length:22},(_,i)=>({id:i+1,name:'category '+(i+1),type:'日常',yearly:100}));
  const h=harness({categories});await h.run('loadDataFromCloud()');
  assert.equal(h.run('categories.filter(c=>categoryBudgetScope(c)==="business").map(c=>c.id).join(",")'),'3,22');
  assert.equal(h.run('scopeSummary(2026).personal.budget'),2000);
  assert.equal(h.run('scopeSummary(2026).business.budget'),200);
  assert.deepEqual(h.tables.user_configs[0].categories,categories);assert.equal(h.writes.length,0);
});
test('single-entry overrides move spending only; refunds, totals, and annual boundaries stay correct',()=>{
  const h=harness();h.run(`categories=[{id:7,yearly:100},{id:22,yearly:200}];expenses=[
    {id:'a',date:'2026-01-01',amount:30,categoryId:7,budgetScope:'business'},
    {id:'b',date:'2026-02-01',amount:40,categoryId:22,budgetScope:'personal'},
    {id:'c',date:'2026-03-01',amount:-10,categoryId:22},
    {id:'d',date:'2025-01-01',amount:999,categoryId:22}];`);
  assert.equal(h.run('scopeSummary(2026).personal.spent'),40);
  assert.equal(h.run('scopeSummary(2026).business.spent'),20);
  assert.equal(h.run('scopeSummary(2026).personal.budget'),100);
  h.run('expenses[0].budgetScope=null');assert.equal(h.run('scopeSummary(2026).personal.spent'),70);
});
test('new explicit scope survives save and cloud reload, retry remains idempotent',async()=>{
  const h=harness();await h.run('loadDataFromCloud()');h.run(`expenses=[{id:123,date:'2026-10-11',item:'business taxi',amount:25,categoryId:7,budgetScope:'business'}]`);
  await h.run('saveExpenseToCloud(expenses[0])');await h.run('saveExpenseToCloud(expenses[0])');await h.run('loadDataFromCloud()');
  assert.equal(h.tables.expenses.length,1);assert.equal(h.run('expenses[0].budgetScope'),'business');
});
test('portable cloud backups and both import modes retain explicit scope',()=>{
  const h=harness(),base=importFixture();base.expenses=[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',date:'2026-01-01',item:'taxi',amount:10,type:'日常',categoryId:1,budgetScope:'business'}];
  for(const mode of ['追加','覆盖']){
    const plan=h.run(`buildImportPlan(${JSON.stringify(base)},${JSON.stringify(base)},'${mode}')`);
    assert.equal(plan.result.expenses[0].budgetScope,'business');
  }
  const old=clone(base);delete old.expenses[0].budgetScope;
  assert.equal(h.run(`buildImportPlan(${JSON.stringify(old)},${JSON.stringify(base)},'覆盖').result.expenses[0].budgetScope`),'business');
  old.expenses[0].budgetScope=null;
  assert.equal(h.run(`buildImportPlan(${JSON.stringify(old)},${JSON.stringify(base)},'覆盖').result.expenses[0].budgetScope`),null);
  assert.equal(h.run(`portableCloudState({config:{user_id:'test'},expenses:[{id:'x',budget_scope:'business'}]}).expenses[0].budgetScope`),'business');
  assert.throws(()=>h.run(`validateBackup({expenses:[{date:'2026-01-01',amount:1,item:'x',budgetScope:'wrong'}]})`),/归属无效/);
});
test('scope edit is atomic and failure/stale rows do not change local ledger',async()=>{
  const h=harness({categories:[{id:7,name:'交通',type:'日常',yearly:6000}]});
  const row={id:'row',owner_id:'owner',user_id:'test',date:'2026-10-11',item:'taxi',amount:25,category_id:7,category_name:'交通',type:'日常',budget_scope:null};
  h.tables.expenses.push(clone(row));await h.run('loadDataFromCloud()');
  h.run(`renderHistory=renderBudgetStatus=renderDashboard=closeEditModal=()=>{};document.getElementById=id=>id==='historyModal'?null:({value:({editDate:'2026-10-11',editItem:'taxi',editAmount:'25',editCategory:'7',editScope:'business'})[id]})`);
  h.setFailure(true);await h.run(`saveEditExpense('row')`);assert.equal(h.run('expenses[0].budgetScope'),null);
  h.setFailure(false);await h.run(`saveEditExpense('row')`);assert.equal(h.run('expenses[0].budgetScope'),'business');
  assert.equal(h.tables.expenses[0].amount,25);assert.equal(h.tables.expenses[0].category_id,7);
  h.tables.expenses[0].amount=30;h.run(`document.getElementById=id=>id==='historyModal'?null:({value:({editDate:'2026-10-11',editItem:'taxi',editAmount:'25',editCategory:'7',editScope:'personal'})[id]})`);
  await h.run(`saveEditExpense('row')`);assert.equal(h.run('expenses[0].budgetScope'),'business');assert.equal(h.tables.expenses[0].amount,30);
});

test('annual snapshots are independent; absent historical budget is unknown',()=>{const h=harness();h.run(`categories=[{id:1,yearly:100}];reviewData={budgetYears:{2025:{original:[{id:1,yearly:90}],current:[{id:1,yearly:120}],history:[]}}}`);assert.equal(h.run('scopeSummary(2025).personal.budget'),120);assert.equal(h.run('rvBudget(2024)'),null);assert.equal(h.run('categories[0].yearly'),100);});
test('annual and quarterly ranges cap at today; prior leap day is clamped',()=>{const h=harness();assert.equal(h.run(`rvRange('year',2026,1,'2026-10-12').end`),'2026-10-12');assert.equal(h.run(`rvRange('quarter',2026,3,'2026-10-12').start`),'2026-07-01');assert.equal(h.run(`rvRange('quarter',2026,3,'2026-10-12').end`),'2026-09-30');assert.equal(h.run(`rvPreviousYear({start:'2024-02-01',end:'2024-02-29'}).end`),'2023-02-28');});
test('missing month is not zero; percentages require both sides reconciled',()=>{const h=harness();h.run(`expenses=[{id:'x',date:'2026-09-01',amount:100,categoryId:1}];reviewData={}`);assert.equal(h.run(`rvMonthStatus('2025-09').verified`),false);assert.equal(h.run(`rvComparison({start:'2026-09-01',end:'2026-09-30'}).percent`),null);});
test('expense edit or pending amount invalidates reconciled month',()=>{const h=harness();h.run(`expenses=[{id:'x',date:'2026-09-01',amount:100,categoryId:1}];reviewData=rvState();reviewData.months['2026-09']={fingerprint:rvFingerprint('2026-09')};`);assert.equal(h.run(`rvMonthStatus('2026-09').verified`),true);h.run('expenses[0].amount=101');assert.equal(h.run(`rvMonthStatus('2026-09').verified`),false);h.run(`reviewData.pending.push({id:'p',date:'2026-09-16',item:'金额未知'});reviewData.months['2026-09'].fingerprint=rvFingerprint('2026-09')`);assert.equal(h.run(`rvMonthStatus('2026-09').verified`),false);});
function fundSetup(h){h.run(`categories=[{id:22,name:'business',yearly:1000}];expenses=[{id:'fund',date:'2026-08-01',item:'prepaid',amount:500,categoryId:22}];reviewData=rvState();reviewData.funds.fund={kind:'prepayment',sourceSignature:rvExpenseSignature(expenses[0]),events:[{id:'use',date:'2026-09-01',amount:100,kind:'use',note:'statement'},{id:'return',date:'2026-09-02',amount:50,kind:'return',note:'refund'}]};`);}
test('prepayment, consumption, and return are counted once across periods and scopes',()=>{const h=harness();fundSetup(h);assert.equal(h.run(`rvMetrics({start:'2026-01-01',end:'2026-12-31'},'business').cash`),450);assert.equal(h.run(`rvMetrics({start:'2026-01-01',end:'2026-12-31'},'business').consumption`),100);assert.equal(h.run(`rvMetrics({start:'2026-09-01',end:'2026-09-30'}).cash`),-50);assert.equal(h.run(`rvMetrics({start:'2026-08-01',end:'2026-08-31'}).consumption`),0);assert.equal(h.run(`scopeSummary(2026).business.spent`),450);assert.equal(h.run('expenses[0].amount'),500);});
test('fund validation rejects overdraw, missing source, changed principal, and duplicate event IDs',()=>{const h=harness();fundSetup(h);assert.doesNotThrow(()=>h.run('rvValidate(reviewData,expenses)'));h.run('reviewData.funds.fund.events[0].amount=501');assert.throws(()=>h.run('rvValidate(reviewData,expenses)'),/不能超过/);fundSetup(h);h.run('expenses[0].amount=499');assert.throws(()=>h.run('rvValidate(reviewData,expenses)'),/已变化/);assert.throws(()=>h.run('rvValidate(reviewData,[])'),/已变化/);fundSetup(h);h.run(`reviewData.funds.fund.events[1].id='use'`);assert.throws(()=>h.run('rvValidate(reviewData,expenses)'),/无效/);});
test('linked fund source cannot be deleted through any cloud deletion path',async()=>{const h=harness();fundSetup(h);assert.equal(await h.run(`deleteExpenseFromCloud('fund')`),false);assert.equal(h.writes.length,0);});
test('review settings survive reload without hydration writes',async()=>{const h=harness({review_data:{pending:[{id:'p',date:'2026-09-16',item:'taxi'}]}});await h.run('loadDataFromCloud()');assert.equal(h.run('reviewData.pending.length'),1);assert.equal(h.writes.length,0);await h.run('syncAllToCloud()');await h.run('loadDataFromCloud()');assert.equal(h.run('reviewData.pending[0].item'),'taxi');});
test('failed review save rolls back visible config and leaves pending recovery copy',async()=>{const h=harness();await h.run('loadDataFromCloud()');h.setFailure(true);assert.equal(await h.run(`rvSave({...rvState(),pending:[{id:'p',date:'2026-09-16',item:'taxi'}]})`),false);assert.equal(h.run('rvState().pending.length'),0);assert.ok(h.cache.has('finance_pending_config_test'));});
test('budget adjustment retains original and survives cloud reload; stale update cannot overwrite',async()=>{const h=harness({categories:[{id:1,name:'food',yearly:100}]});await h.run('loadDataFromCloud()');h.run('renderSettings=renderBudgetStatus=renderReport=renderDashboard=()=>{}');assert.equal(await h.run(`rvChangeBudget(new Date().getFullYear(),1,120,'annual adjustment')`),true);await h.run('loadDataFromCloud()');assert.equal(h.run('reviewData.budgetYears[new Date().getFullYear()].original[0].yearly'),100);assert.equal(h.run('categories[0].yearly'),120);h.tables.user_configs[0].updated_at='2099-01-01';assert.equal(await h.run(`rvChangeBudget(new Date().getFullYear(),1,200,'conflict')`),false);assert.equal(h.run('categories[0].yearly'),120);});
test('legacy overwrite preserves review data, conflicting append refuses silently dropping review changes',()=>{const h=harness();const base=importFixture();base.reviewData={pending:[{id:'p',date:'2026-09-16',item:'taxi'}]};const old=importFixture();const p=h.run(`buildImportPlan(${JSON.stringify(old)},${JSON.stringify(base)},'覆盖')`);assert.deepEqual(clone(p.config.review_data),base.reviewData);assert.throws(()=>h.run(`buildImportPlan({reviewData:{pending:[]}},${JSON.stringify(base)},'追加')`),/不合并/);});

// Regression coverage for simplification: financial semantics and failure recovery.
test('calendar trend windows exclude stale rows, handle year boundary and empty ranges',()=>{
 const h=harness(),rows=[{month:'2024-01',total:1},{month:'2025-11',total:2},{month:'2025-12',total:3},{month:'2026-01',total:4},{month:'2026-03',total:5}];
 assert.equal(h.run(`rvTrendRows(${JSON.stringify(rows)},'3M','2026-01-15').map(x=>x.month).join(',')`),'2025-11,2025-12,2026-01');
 assert.equal(h.run(`rvTrendRows(${JSON.stringify(rows)},'3M','2026-10-12').length`),0);
 assert.equal(h.run(`rvTrendRows(${JSON.stringify(rows)},'ALL','2026-01-15').length`),4);
 assert.match(h.run('rvTrendDelta([{total:100},{total:70}])'),/−¥30\.00.*-30\.0%/);
 assert.equal(h.run('rvTrendDelta([])'),'—');assert.match(h.run('rvTrendDelta([{total:5}])'),/仅一条/);
});
test('current month report has no close-month action or repeated unknown table',()=>{
 const h=harness();h.run(`categories=[{id:1,name:'food',yearly:100}];expenses=[{id:'x',date:localDateString(),amount:10,categoryId:1,item:'food'}];`);
 const html=h.run(`rvReview({...rvRange('month',new Date().getFullYear(),new Date().getMonth()+1),mode:'month'})`);
 assert.match(html,/进行中/);assert.doesNotMatch(html,/onclick="rvReconcile/);assert.doesNotMatch(html,/每月付款/);assert.match(html,/去年同期缺少记录/);assert.match(html,/¥10\.00/);
});
test('quarter report produces per-month rows and no fabricated historical expense zeros',()=>{
 const h=harness();h.run(`categories=[{id:1,name:'food',yearly:100}];expenses=[{id:'x',date:'2026-09-01',amount:10,categoryId:1,item:'food'}];`);
 const html=h.run(`rvReview({...rvRange('quarter',2026,3,'2026-10-12'),mode:'quarter'})`);
 assert.match(html,/每月付款/);assert.match(html,/2026-07<\/td><td>未记录/);assert.doesNotMatch(html,/去年同期<\/th>/);
});
test('declared no-income and carry-forward policy survives reload and backup',async()=>{
 const policy={noIncomeEntryMeansZero:true,assetsCarryForward:true};const h=harness({review_data:{recordingPolicy:policy},incomes_data:[]});await h.run('loadDataFromCloud()');
 assert.equal(h.run('rvRecordingPolicy().noIncomeEntryMeansZero'),true);await h.run('syncAllToCloud()');await h.run('loadDataFromCloud()');
 assert.deepEqual(clone(h.run('configPayload().review_data.recordingPolicy')),policy);assert.equal(h.run('incomes.length'),0);assert.equal(h.run('assets[0].value'),100);
});
function assetFixture(){const h=harness({asset_types:[{id:'liquid',name:'cash',items:[{id:'bank',name:'bank'}]}]});return h;}
function assetForm(h,value,month=null){h.run(`document.getElementById=id=>({value:id==='assetMonth'?${month?JSON.stringify(month):'localDateString().slice(0,7)'}:${JSON.stringify(value)}});renderAssets=renderDashboard=closeUpdateAssetsModal=()=>{}`);}
test('blank, negative and excessive precision asset amounts never write or change a balance',async()=>{
 for(const value of ['', '-1','1.234','NaN']){const h=assetFixture();await h.run('loadDataFromCloud()');assetForm(h,value);await h.run('saveUpdatedAssets()');assert.equal(h.run('assets[0].value'),100);assert.equal(h.run('assetHistory.length'),1);assert.equal(h.writes.length,0);}
});
test('failed snapshot save restores all balances and history and retains recovery copy',async()=>{
 const h=assetFixture();await h.run('loadDataFromCloud()');assetForm(h,'0');h.setFailure(true);await h.run('saveUpdatedAssets()');assert.equal(h.run('assets[0].value'),100);assert.equal(h.run('assetHistory.length'),1);assert.ok(h.cache.has('finance_pending_config_test'));assert.equal(h.run('assetWriteBusy'),false);
});
test('historical snapshot appends without rewriting current balances or older snapshots',async()=>{
 const h=assetFixture();await h.run('loadDataFromCloud()');assetForm(h,'55.25','2025-12');await h.run('saveUpdatedAssets()');await h.run('loadDataFromCloud()');assert.equal(h.run('assets[0].value'),100);assert.equal(h.run('assetHistory[0].total'),100);assert.equal(h.run('assetHistory.at(-1).total'),55.25);
});
test('explicit zero current balance is supported and snapshot is appended once',async()=>{
 const h=assetFixture();await h.run('loadDataFromCloud()');assetForm(h,'0');await h.run('Promise.all([saveUpdatedAssets(),saveUpdatedAssets()])');await h.run('loadDataFromCloud()');assert.equal(h.run('assets[0].value'),0);assert.equal(h.run('assetHistory.length'),2);assert.equal(h.run('assetHistory[0].total'),100);
});
test('snapshot delete failure restores history',async()=>{
 const h=assetFixture();await h.run('loadDataFromCloud()');h.setFailure(true);await h.run(`deleteAssetHistoryEntry('legacy_2026-01-01')`);assert.equal(h.run('assetHistory.length'),1);
});
test('unsaved asset type draft cannot leak into other config saves',async()=>{
 const h=assetFixture();await h.run('loadDataFromCloud()');h.run(`assetTypeDraft=rvCopy(ASSET_TYPES);assetTypeDraft[0].items.push({id:'draft',name:'draft'})`);await h.run('syncAllToCloud()');assert.equal(h.tables.user_configs[0].asset_types[0].items.length,1);
 h.setFailure(true);await h.run('saveAssetTypes()');assert.equal(h.run('ASSET_TYPES[0].items.length'),1);assert.equal(h.run('assets.length'),1);
});
test('failed new income keeps form and source income unchanged',async()=>{
 const h=harness();await h.run('loadDataFromCloud()');h.run(`document.getElementById=id=>({value:({incomeDate:'2026-10-12',incomeItem:'new',incomeAmount:'10',incomeType:'工资'})[id]})`);h.setFailure(true);await h.run('saveIncome()');assert.equal(h.run('incomes.length'),1);assert.equal(h.run('incomes[0].id'),'old-income');assert.ok(h.cache.has('finance_pending_config_test'));
});
test('failed income and goal deletions do not appear to succeed locally',async()=>{
 const h=harness();await h.run('loadDataFromCloud()');h.setFailure(true);await h.run(`deleteIncome('old-income')`);assert.equal(h.run('incomes.length'),1);await h.run('deleteGoal(0)');assert.equal(h.run('goals.length'),1);
});
test('category additions start with no invented budget and retain original annual budget',async()=>{
 const h=harness({categories:[{id:1,name:'food',yearly:100,type:'日常'}]});await h.run('loadDataFromCloud()');h.run('renderCategoryGrid=renderBudgetTip=renderBudgetStatus=renderSettings=renderReport=renderDashboard=()=>{}');await h.run('addCategory()');assert.equal(h.run('categories[1].yearly'),0);assert.equal(h.run('reviewData.budgetYears[new Date().getFullYear()].original[0].yearly'),100);assert.equal(h.run('scopeSummary(new Date().getFullYear()).personal.budget'),100);
});
