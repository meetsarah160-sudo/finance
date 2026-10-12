/* Annual budgets and evidence-based reviews. No inferred writes to historical expenses. */
const REVIEW_VERSION = 1;
const rvCopy = x => JSON.parse(JSON.stringify(x));
const rvAmountOK = x => typeof x !== 'boolean' && String(x??'').trim()!=='' && Number.isFinite(Number(x)) && Math.abs(Number(x)*100-Math.round(Number(x)*100))<1e-6 && Number.isSafeInteger(Math.round(Number(x)*100));
const rvCents = x => Math.round(Number(x || 0) * 100);
const rvSum = rows => rows.reduce((s,r)=>s+rvCents(r.amount),0)/100;
const rvDateOK = s => /^\d{4}-\d{2}-\d{2}$/.test(s||'') && !isNaN(Date.parse(s)) && new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const rvPut = (id, html) => { const e=document.getElementById(id); if(e)e.innerHTML=html; };
function rvState(d=reviewData) { return {version:REVIEW_VERSION,budgetYears:{},months:{},pending:[],funds:{},...d}; }
function rvBudget(year) {
    const version=rvState().budgetYears[String(year)];
    return version ? version.current : Number(year)===new Date().getFullYear() ? categories : null;
}
function rvBudgetVersion(year, source=categories) {
    return {createdAt:new Date().toISOString(),original:rvCopy(source),current:rvCopy(source),history:[]};
}
function rvYears() { return [...new Set([...Array.from({length:4},(_,i)=>new Date().getFullYear()-i),...expenses.map(e=>Number(e.date.slice(0,4))),...Object.keys(rvState().budgetYears).map(Number)])].filter(y=>Number.isInteger(y)&&y>1900&&y<2200).sort((a,b)=>b-a); }
function rvMonths(start,end) {
    const a=[]; let y=Number(start.slice(0,4)),m=Number(start.slice(5,7));
    while(`${y}-${String(m).padStart(2,'0')}`<=end.slice(0,7)){a.push(`${y}-${String(m).padStart(2,'0')}`);if(++m===13){m=1;y++;}}
    return a;
}
function rvRange(mode,year,part,today=localDateString()) {
    year=Number(year);part=Number(part);let first=1,last=12;
    if(mode==='month')first=last=Math.max(1,Math.min(12,part));
    if(mode==='quarter'){first=(Math.max(1,Math.min(4,part))-1)*3+1;last=first+2;}
    const start=`${year}-${String(first).padStart(2,'0')}-01`;
    const end=`${year}-${String(last).padStart(2,'0')}-${new Date(year,last,0).getDate()}`;
    return {start,end:end>today?today:end,plannedEnd:end,future:start>today};
}
function rvPreviousYear(range) {
    const shift=s=>{const y=Number(s.slice(0,4))-1,m=Number(s.slice(5,7)),day=Math.min(Number(s.slice(8)),new Date(y,m,0).getDate());return `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;};
    return {start:shift(range.start),end:shift(range.end)};
}
function rvExpenseSignature(e){return JSON.stringify([e.id,e.date,e.item,rvCents(e.amount),e.categoryId,e.budgetScope??null]);}
function rvFundIssues(){return Object.entries(rvState().funds).filter(([id,f])=>{const e=expenses.find(e=>String(e.id)===id);return !e||rvExpenseSignature(e)!==f.sourceSignature;});}
function rvFundRows(){
    const rows=[];
    for(const [id,f] of Object.entries(rvState().funds)) {
        const e=expenses.find(r=>String(r.id)===id);
        if(!e || rvExpenseSignature(e)!==f.sourceSignature)continue;
        for(const event of f.events||[])rows.push({...event,categoryId:e.categoryId,categoryName:e.categoryName,budgetScope:e.budgetScope,sourceId:id,item:`${event.kind==='return'?'退回':'核销'}：${e.item}`});
    }
    return rows;
}
function rvMetrics(range,scope='') {
    const inRange=e=>e.date>=range.start&&e.date<=range.end&&scopeMatches(e,scope);
    const rows=expenses.filter(inRange), events=rvFundRows().filter(inRange);
    const returns=rvSum(events.filter(e=>e.kind==='return'));
    const holds=rows.filter(e=>{const f=rvState().funds[e.id];return f&&f.sourceSignature===rvExpenseSignature(e);});
    const used=rvSum(events.filter(e=>e.kind==='use'));
    return {rows,events,count:rows.length,cash:Math.round((rvSum(rows)-returns)*100)/100,consumption:Math.round((rvSum(rows)-rvSum(holds)+used)*100)/100,held:rvSum(holds),returns,used};
}
function rvFingerprint(month) {
    return JSON.stringify({expenses:expenses.filter(e=>e.date.startsWith(month)).map(rvExpenseSignature).sort(),incomes:incomes.filter(e=>e.date.startsWith(month)).map(e=>JSON.stringify([e.id,e.date,e.item,e.amount])).sort(),funds:rvFundRows().filter(e=>e.date.startsWith(month)).map(e=>JSON.stringify(e)).sort(),classifications:Object.entries(rvState().funds).filter(([id])=>expenses.some(e=>String(e.id)===id&&e.date.startsWith(month))).sort(),pending:rvState().pending.filter(e=>e.date.startsWith(month))});
}
function rvMonthStatus(month) {
    const pending=rvState().pending.filter(p=>p.date.startsWith(month)&&!p.resolvedAt).length;
    const record=rvState().months[month],current=localDateString().slice(0,7),closed=month<current;
    const verified=!!record&&record.fingerprint===rvFingerprint(month)&&pending===0&&closed;
    const has=expenses.some(e=>e.date.startsWith(month))||rvFundRows().some(e=>e.date.startsWith(month));
    const label=month>current?'未开始':month===current?'进行中':verified?'已核对':pending?`${pending} 笔待补金额`:record?'改账后待复核':has?'待核对':'未记录';
    return {verified,pending,has,closed,label};
}

function rvComplete(range){return !range.future && rvMonths(range.start,range.end).every(m=>rvMonthStatus(m).verified);}
function rvComparison(range,scope='') {
    const previous=rvPreviousYear(range),a=rvMetrics(range,scope),b=rvMetrics(previous,scope);
    const comparable=rvComplete(range)&&rvComplete(previous);
    return {previous,a,b,comparable,percent:comparable&&b.cash!==0?(a.cash-b.cash)/Math.abs(b.cash)*100:null};
}
function scopeSummary(year) {
    const result={personal:{budget:0,spent:0,count:0},business:{budget:0,spent:0,count:0}};
    for(const cat of rvBudget(year)||[])result[categoryBudgetScope(cat)].budget+=rvCents(cat.yearly);
    for(const [scope,b] of Object.entries(result)){
        const x=rvMetrics({start:`${year}-01-01`,end:`${year}-12-31`},scope);
        b.budget/=100;b.spent=x.cash;b.count=x.count;b.remaining=Math.round((b.budget-b.spent)*100)/100;b.known=!!rvBudget(year);
    }
    return result;
}
function rvBudgetCards(year) {
    return `<div class="scope-budget-grid">${Object.entries(scopeSummary(year)).map(([k,b])=>`<section class="scope-budget-card"><h4>${BUDGET_SCOPE_LABELS[k]} · ${year}</h4><p>年度预算 <strong>${b.known?scopeMoney(b.budget):'未保存该年度预算'}</strong></p><p>已记录净付款 <strong>${scopeMoney(b.spent)}</strong></p><p class="${b.remaining<0?'scope-over':''}">${b.known?(b.remaining<0?'超出年度预算 ':'年度剩余 ')+scopeMoney(Math.abs(b.remaining)):'历史预算未知，不判断超支'}</p><p class="scope-note">${b.count} 笔${b.known?' · 月均参考 '+scopeMoney(b.budget/12):''}</p><button class="btn btn-outline btn-sm" onclick="showScopeRecords('${k}',${Number(year)})">查看付款明细</button></section>`).join('')}</div>`;
}
function renderScopeBudgets(){
    const years=rvYears();if(!years.includes(scopeBudgetYear))scopeBudgetYear=years[0];
    rvPut('annualScopeBudget',`<div class="scope-heading"><h3>个人与创业</h3><select aria-label="年度预算年份" onchange="setScopeBudgetYear(this.value)">${years.map(y=>`<option ${y===scopeBudgetYear?'selected':''}>${y}</option>`).join('')}</select></div>${rvBudgetCards(scopeBudgetYear)}<p class="scope-note">年度额度累计使用，月均仅作参考；个人与创业分别计算。预算剩余不等于可用现金。</p>`);
}

function setScopeBudgetYear(value){scopeBudgetYear=Number(value);renderBudgetStatus();}
function renderBudgetStatus(){
    renderScopeBudgets();const year=scopeBudgetYear,budget=rvBudget(year);
    rvPut('summaryCards',`<p class="scope-note">预算按年度评估；房租、保险和大额购置按付款日期列示，不根据名称自动摊销。</p>`);
    rvPut('budgetList',`<div class="rv-table-wrap"><table class="rv-table"><thead><tr><th>类目</th><th>年度预算</th><th>净付款</th><th>年度剩余</th></tr></thead><tbody>${(budget||categories).map(c=>{
        const amount=rvSum(expenses.filter(e=>e.date.startsWith(String(year))&&e.categoryId===c.id))-rvSum(rvFundRows().filter(e=>e.kind==='return'&&e.date.startsWith(String(year))&&e.categoryId===c.id));
        return `<tr><td><button class="text-button" onclick="rvCategoryRecords(${Number(c.id)},${year})">${escapeHtml(c.name)}</button></td><td>${budget?scopeMoney(c.yearly):'未知'}</td><td>${scopeMoney(amount)}</td><td>${budget?scopeMoney(Number(c.yearly)-amount):'—'}</td></tr>`;
    }).join('')}</tbody></table></div>${rvBudgetEditor(year)}`);
}
function rvBudgetEditor(year){
    const v=rvState().budgetYears[year],cats=rvBudget(year)||categories;
    return `<details class="rv-section"><summary>年度预算版本与调整</summary><p>原始预算保留，调整必须填写原因。设置页修改的是当前年度；这里可建立其他年度的独立版本。</p><div class="rv-controls"><label>年份 <input id="rvBudgetYear" type="number" min="2000" max="2199" value="${year}"></label><button class="btn btn-outline" onclick="rvCreateBudget()">复制当前设置建立该年预算</button></div><div class="rv-controls"><select id="rvBudgetCat" aria-label="调整预算类目">${cats.map(c=>`<option value="${Number(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select><input id="rvBudgetAmount" type="number" step="0.01" min="0" placeholder="新的全年金额" aria-label="新年度预算金额"><input id="rvBudgetReason" placeholder="调整原因" aria-label="预算调整原因"><button class="btn btn-primary" onclick="rvAdjustBudget()">保存调整</button></div><p>${v?'版本建立于 '+escapeHtml(v.createdAt.slice(0,10))+'；初始合计 '+scopeMoney((v.original||[]).reduce((s,c)=>s+Number(c.yearly),0)):'尚未建立版本；当前年度展示现有预算，历史年度不推测。'}</p><ul>${(v?.history||[]).slice().reverse().map(h=>`<li>${escapeHtml(h.at.slice(0,10))} · ${escapeHtml(h.name)}：${scopeMoney(h.before)} → ${scopeMoney(h.after)} · ${escapeHtml(h.reason)}</li>`).join('')||'<li>暂无调整记录</li>'}</ul></details>`;
}
let rvBusy=false;
async function rvSave(next,nextCategories=null){
    if(rvBusy){showToast('正在保存，请稍候','warning');return false;}
    try{rvValidate(next,expenses);}catch(e){showToast(e.message,'error');return false;}
    rvBusy=true;const old=rvCopy(reviewData),oldCats=rvCopy(categories),profile=currentUser;
    reviewData=next;if(nextCategories)categories=nextCategories;
    try{
        if(!await syncAllToCloud()){if(currentUser===profile){reviewData=old;categories=oldCats;saveConfigLocalBackup();}return false;}
        if(currentUser!==profile)return true;renderBudgetStatus();renderReport();renderDashboard();renderSettings();rvPut('recordPending',rvPendingUI());rvPut('assetFunds',rvFundsUI());showToast('已保存到云端','success');return true;
    }finally{rvBusy=false;}
}
async function rvCreateBudget(){
    const year=Number(document.getElementById('rvBudgetYear').value);
    if(!Number.isInteger(year)||year<2000||year>2199)return showToast('年份无效','error');
    const d=rvCopy(rvState());if(d.budgetYears[year])return showToast('该年度已有版本，不能覆盖原始预算','warning');
    d.budgetYears[year]=rvBudgetVersion(year);if(await rvSave(d)){scopeBudgetYear=year;renderBudgetStatus();}
}
async function rvChangeBudget(year,id,amount,reason){
    if(!rvAmountOK(amount)||amount<0||!reason?.trim())return showToast('请填写非负预算金额和调整原因','error');
    const d=rvCopy(rvState());if(!d.budgetYears[year]){
        if(Number(year)!==new Date().getFullYear())return showToast('先建立该年度预算版本','warning');
        d.budgetYears[year]=rvBudgetVersion(year);
    }
    const v=d.budgetYears[year],c=v.current.find(c=>String(c.id)===String(id));if(!c)return;
    if(rvCents(c.yearly)===rvCents(amount))return;
    v.history.push({at:new Date().toISOString(),categoryId:c.id,name:c.name,before:c.yearly,after:amount,reason:cleanText(reason,200)});c.yearly=amount;
    const next=Number(year)===new Date().getFullYear()?categories.map(c=>String(c.id)===String(id)?{...c,yearly:amount}:c):null;
    return rvSave(d,next);
}
async function rvAdjustBudget(){const el=id=>document.getElementById(id).value;const raw=el('rvBudgetAmount');if(raw.trim()==='')return showToast('请填写金额','error');return rvChangeBudget(Number(el('rvBudgetYear')),el('rvBudgetCat'),Number(raw),el('rvBudgetReason'));}
async function updateCategory(index,field,value){
    if(field==='yearly'){
        if(value==null||!Number.isFinite(Number(value))||Number(value)<0)return showToast('预算金额无效','error');
        const reason=prompt('请输入本次年度预算调整原因（原预算会保留）');if(reason===null){renderSettings();return;}
        await rvChangeBudget(new Date().getFullYear(),categories[index].id,Number(value),reason);renderSettings();return;
    }
    const next=rvCopy(categories);next[index][field]=cleanText(value,field==='name'?80:20);
    const d=rvCopy(rvState()),v=d.budgetYears[new Date().getFullYear()];if(v){const c=v.current.find(c=>c.id===next[index].id);if(c)c[field]=next[index][field];}
    await rvSave(d,next);
}
function renderBudgetTip(){rvPut('budgetTip','年度预算累计使用；生活费是日常消耗，小零用是小额个人支出，备用金用于临时升级。月均不是每月额度上限。');}
function renderCompareCards(){rvPut('compareCards','<p class="scope-note">同比请查看「月／季／年复盘」：使用相同日期范围，未核对完整时只展示已记录金额，不计算误导性的增减比例。</p>');}
function renderDashboardKPI(){
    const today=localDateString(),x=rvMetrics({start:today.slice(0,7)+'-01',end:today}),y=rvMetrics({start:today.slice(0,4)+'-01-01',end:today});
    const inc=incomes.filter(e=>e.date>=today.slice(0,7)+'-01'&&e.date<=today);
    const items=[['本月净付款',scopeMoney(x.cash),'支出减已登记退回'],['今年净付款',scopeMoney(y.cash),'个人与创业合计'],['本月收入',inc.length||rvRecordingPolicy().noIncomeEntryMeansZero?scopeMoney(rvSum(inc)):'未记录',rvRecordingPolicy().noIncomeEntryMeansZero?'未新增即无进账':'仅展示已录入金额'],['已记录净资产',scopeMoney(assetTotals().net),'余额日期见资产页']];
    rvPut('dashboardKPI',items.map(([label,value,note])=>`<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value rv-value">${value}</div><p class="muted">${note}</p></div>`).join(''));
}

function initReportMonthSelector(){
    const el=document.getElementById('reportMonth');if(!el)return;
    const mode=document.getElementById('reportMode')?.value||'month',value=el.value||localDateString().slice(0,7),today=localDateString().slice(0,7);
    const [y,m]=value.split('-').map(Number),selected=mode==='year'?`${y}-01`:mode==='quarter'?`${y}-${String(Math.floor((m-1)/3)*3+1).padStart(2,'0')}`:value;
    const months=mode==='year'?[1]:mode==='quarter'?[10,7,4,1]:[12,11,10,9,8,7,6,5,4,3,2,1];
    el.innerHTML=rvYears().flatMap(y=>months.map(m=>({value:`${y}-${String(m).padStart(2,'0')}`,label:mode==='year'?`${y} 年`:mode==='quarter'?`${y} 年第 ${Math.ceil(m/3)} 季度`:`${y} 年 ${m} 月`}))).filter(o=>o.value<=today).map(o=>`<option value="${o.value}" ${o.value===selected?'selected':''}>${o.label}</option>`).join('');
}

function rvReportRange(){
    const [y,m]=(document.getElementById('reportMonth')?.value||localDateString().slice(0,7)).split('-').map(Number);
    const mode=document.getElementById('reportMode')?.value||'month';return {...rvRange(mode,y,mode==='quarter'?Math.ceil(m/3):m),mode,year:y};
}
function rvTable(rows,headers){return `<div class="rv-table-wrap"><table class="rv-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;}
function rvReview(range,scope=''){
    if(range.future)return '<p>该期间尚未开始。</p>';
    const x=rvMetrics(range,scope),compare=rvComparison(range,scope),months=rvMonths(range.start,range.end),current=localDateString().slice(0,7);
    const known=x.count>0||x.events.length>0||rvComplete(range),latest=x.rows.map(e=>e.date).sort().at(-1);
    const previousKnown=compare.b.count>0||compare.b.events.length>0||rvComplete(compare.previous);
    const byId=new Map();for(const e of x.rows){const id=String(e.categoryId);if(!byId.has(id))byId.set(id,{name:categories.find(c=>String(c.id)===id)?.name||e.categoryName||'待归类',amount:0});byId.get(id).amount+=rvCents(e.amount);}
    const byCat=[...byId.values()].sort((a,b)=>b.amount-a.amount);
    const top=x.rows.filter(e=>e.amount>0).slice().sort((a,b)=>b.amount-a.amount).slice(0,5);
    const gifts=x.rows.filter(e=>e.categoryId===14),subs=x.rows.filter(e=>/会员|订阅|服务器|App|软件/i.test(e.item));
    const tips=[];
    if(gifts.length)tips.push(`自愿赠请 ${scopeMoney(rvSum(gifts))}，共 ${gifts.length} 笔：优先复盘哪些赠送、请客符合你的本意，哪些下次可以不花。`);
    if(subs.length)tips.push(`会员及软件候选 ${scopeMoney(rvSum(subs))}，共 ${subs.length} 笔：检查实际使用频率和重叠服务。按摘要筛选，需你核实用途。`);
    if(top.length)tips.push(`最大一笔「${top[0].item}」${scopeMoney(top[0].amount)}：结合全年额度判断；集中交租、保险或设备款不代表日常生活费持续上涨。`);
    if(!tips.length)tips.push('本期记录不足，暂不生成省钱结论。');
    const state=range.mode==='month'?rvMonthStatus(months[0]).label:rvComplete(range)?'已核对':range.end<range.plannedEnd?'进行中':'待核对';
    const monthly=months.length>1?`<section class="rv-section"><h3>每月付款</h3>${rvTable(months.map(m=>{
        const end=m===range.end.slice(0,7)?range.end:`${m}-${new Date(Number(m.slice(0,4)),Number(m.slice(5)),0).getDate()}`,c=rvComparison({start:m+'-01',end},scope),s=rvMonthStatus(m);
        return `<tr><td>${m}</td><td>${c.a.count||c.a.events.length||s.verified?scopeMoney(c.a.cash):'未记录'}</td>${previousKnown?`<td>${c.b.count||c.b.events.length||rvComplete(c.previous)?scopeMoney(c.b.cash):'未记录'}</td>`:''}<td>${escapeHtml(s.label)}</td></tr>`;
    }),['月份','本期净付款',...(previousKnown?['去年同期']:[]),'状态'])}</section>`:'';
    const incomeRows=incomes.filter(e=>e.date>=range.start&&e.date<=range.end),incomeKnown=incomeRows.length>0||rvRecordingPolicy().noIncomeEntryMeansZero;
    const incomeText=!scope&&incomeKnown?`<p class="muted">本期收入 ${scopeMoney(rvSum(incomeRows))}${known?' · 已记收支差额 '+scopeMoney(rvSum(incomeRows)-x.cash):''}</p>`:'';
    const split=!scope?`<p class="muted">个人 ${scopeMoney(rvMetrics(range,'personal').cash)} · 创业 ${scopeMoney(rvMetrics(range,'business').cash)}</p>`:'';
    const compareText=previousKnown?`去年同期已记录 ${scopeMoney(compare.b.cash)}${compare.percent!==null?' · 同比 '+(compare.percent>=0?'+':'')+compare.percent.toFixed(1)+'%':' · 尚不满足完整同比条件'}`:'去年同期缺少记录，暂不比较。';
    const catRows=byCat.map(c=>`<tr><td>${escapeHtml(c.name)}</td><td>${scopeMoney(c.amount/100)}</td></tr>`);
    const reconciliation=months.map(m=>{const s=rvMonthStatus(m);return `<tr><td>${m}</td><td>${escapeHtml(s.label)}</td><td>${s.closed&&!s.verified&&!s.pending?`<button class="btn btn-outline btn-sm" onclick="rvReconcile('${m}')">确认已核对</button>`:s.pending?`<button class="btn btn-outline btn-sm" onclick="switchPage('record');document.querySelector('#recordPending details').open=true">处理待补记录</button>`:'—'}</td></tr>`;});
    return `<section class="rv-section"><div class="card-header-flex"><h3>${escapeHtml(range.start)} — ${escapeHtml(range.end)}</h3><span class="status-label">${state}</span></div><p class="muted">${BUDGET_SCOPE_LABELS[scope]||'全部账本'} · 支出 ${x.count} 笔${latest?' · 最新 '+escapeHtml(latest):''}</p><div class="report-amount">${known?scopeMoney(x.cash):'未记录'}</div><p>已记录净付款</p>${split}${incomeText}<p class="muted">${compareText}</p>${x.held||x.used||x.returns?`<p class="muted">按已登记资金用途调整后消费 ${scopeMoney(x.consumption)}；资金退回 ${scopeMoney(x.returns)}。</p>`:''}</section>
    ${rvFundIssues().length?'<p class="scope-over">资金关联原账有变化，请到资产页核对；相关统计暂不完整。</p>':''}${monthly}
    <section class="rv-section"><h3>本期复盘</h3><ol>${tips.slice(0,3).map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ol></section>
    <section class="rv-section"><h3>钱花在哪里</h3>${catRows.length?rvTable(catRows.slice(0,6),['类目','原账付款']):'<p class="muted">暂无支出记录。</p>'}${catRows.length>6?`<details><summary>其余 ${catRows.length-6} 个类目</summary>${rvTable(catRows.slice(6),['类目','原账付款'])}</details>`:''}<details><summary>大额支出前 ${top.length} 笔</summary>${rvTable(top.map(e=>`<tr><td>${escapeHtml(e.date)}</td><td>${escapeHtml(e.item)}</td><td>${scopeMoney(e.amount)}</td></tr>`),['日期','事项','金额'])}</details></section>
    <details class="rv-section"><summary>账本核对与统计说明</summary><p class="muted">当月记账仍在进行，月末后再确认。未记录不等于零；同比仅在两期均核对完整后计算。季度房租、年度保险按实际付款日期列示。</p>${rvTable(reconciliation,['月份','状态','操作'])}<p class="muted">本页使用可追溯明细；旧版手填月度汇总保留在备份中。金额未知的事项不计入总额；支出未核齐时不推算完整结余。保证金、预付的确认与核销在资产页管理。</p></details>`;
}

function renderReport(){
    const range=rvReportRange();rvPut('reportContent',rvReview(range,document.getElementById('reportScope')?.value||''));
}

async function rvReconcile(month){
    const status=rvMonthStatus(month);
    if(month>=localDateString().slice(0,7))return showToast('本月仍在进行中，结束后再确认完整','warning');
    if(status.pending)return showToast('还有金额未知的记录，先补齐或说明不录入原因','warning');
    if(!confirm(`确认 ${month} 的收支已与账单核对完整？没有记录也会作为已核对的零支出月份。后续改账会自动失效。`))return;
    const d=rvCopy(rvState());d.months[month]={at:new Date().toISOString(),fingerprint:rvFingerprint(month)};await rvSave(d);
}
function rvPendingUI(){
    return `<details class="rv-section"><summary>待补记录 · ${rvState().pending.filter(p=>!p.resolvedAt).length} 笔</summary><p>金额未知保留待办，不填零、不猜金额。补入账本后可关联已有记录完成核对。</p><div class="rv-controls"><input id="rvPendingDate" type="date" aria-label="待补日期"><input id="rvPendingItem" placeholder="待补事项" aria-label="待补事项"><button class="btn btn-outline" onclick="rvAddPending()">添加待补</button></div>${rvTable(rvState().pending.map((p,i)=>`<tr><td>${escapeHtml(p.date)}</td><td>${escapeHtml(p.item)}</td><td>${p.resolvedAt?'已处理：'+escapeHtml(p.resolution):'金额未知，未计入'}</td><td>${p.resolvedAt?'':`<button class="btn btn-outline btn-sm" onclick="rvResolvePending(${i})">处理</button>`}</td></tr>`),['日期','事项','状态','操作'])}</details>`;
}
async function rvAddPending(){const date=document.getElementById('rvPendingDate').value,item=cleanText(document.getElementById('rvPendingItem').value,160);if(!rvDateOK(date)||!item.trim())return showToast('填写日期和事项','error');const d=rvCopy(rvState());d.pending.push({id:crypto.randomUUID(),date,item});await rvSave(d);}
async function rvResolvePending(i){
    const d=rvCopy(rvState()),p=d.pending[i];if(!p||p.resolvedAt)return;
    const matches=expenses.filter(e=>e.date===p.date);
    const reply=prompt('已补录可输入以下记录序号；确定不录入请输入“不录入：原因”。金额仍未知请取消。\n'+matches.map((e,i)=>`${i+1}. ${e.item} ${scopeMoney(e.amount)}`).join('\n'));
    if(reply===null)return;let resolution;
    if(/^不录入：\S/.test(reply))resolution=cleanText(reply,200);
    else if(/^\d+$/.test(reply)&&matches[Number(reply)-1]){const e=matches[Number(reply)-1];resolution=`已关联 ${e.item} ${scopeMoney(e.amount)}`;p.expenseId=e.id;}
    else return showToast('未匹配到记录，待补事项保持原样','warning');
    p.resolvedAt=new Date().toISOString();p.resolution=resolution;await rvSave(d);
}
function rvFundsUI(){
    const funds=Object.entries(rvState().funds);
    return `<details class="rv-section"><summary>保证金与预付资金（手动确认）</summary><p>仅在你确认后调整消费统计，原账付款保留。这里的余额是未核销账面金额，不是银行余额，也不会自动加入资产总额。</p><div class="rv-controls"><input id="rvFundSearch" placeholder="搜索已记账项目，如保证金、充值" aria-label="资金项目搜索" oninput="rvFindFunds(this.value)"><select id="rvFundSource" aria-label="选择原付款"><option value="">先搜索原付款</option></select><select id="rvFundKind" aria-label="资金类型"><option value="deposit">可退保证金</option><option value="prepayment">预付充值</option></select><button class="btn btn-outline" onclick="rvAddFund()">确认登记</button></div>${funds.map(([id,f],i)=>{
        const e=expenses.find(e=>String(e.id)===id),balance=e?(rvCents(e.amount)-(f.events||[]).reduce((s,r)=>s+rvCents(r.amount),0))/100:0;
        return `<section class="rv-section"><h4>${escapeHtml(e?.item||'原记录缺失')} · ${f.kind==='deposit'?'保证金':'预付资金'}</h4><p>原付款 ${e?scopeMoney(e.amount):'未知'} · 未核销余额 ${scopeMoney(balance)}</p>${rvTable((f.events||[]).map((r,j)=>`<tr><td>${escapeHtml(r.date)}</td><td>${r.kind==='use'?'消费核销':'资金退回'}</td><td>${scopeMoney(r.amount)}</td><td>${escapeHtml(r.note)}</td><td><button class="btn btn-outline btn-sm" onclick="rvRemoveFundEvent(${i},${j})">撤销登记</button></td></tr>`),['日期','类型','金额','凭据说明','操作'])}<div class="rv-controls"><input id="rvEventDate${i}" type="date" value="${localDateString()}" aria-label="核销日期"><select id="rvEventKind${i}" aria-label="核销类型"><option value="use">消费核销（不再付款）</option><option value="return">退回资金（非收入）</option></select><input id="rvEventAmount${i}" type="number" min="0.01" step="0.01" placeholder="金额" aria-label="核销金额"><input id="rvEventNote${i}" placeholder="凭据或说明" aria-label="核销凭据"><button class="btn btn-outline" onclick="rvAddFundEvent(${i})">登记</button><button class="btn btn-outline" onclick="rvRemoveFund(${i})">撤销资金分类</button></div></section>`;
    }).join('')||'<p>暂无已确认项目。不会按名称自动更改旧账。</p>'}</details>`;
}
function rvFindFunds(text){rvPut('rvFundSource','<option value="">选择一笔原付款</option>'+expenses.filter(e=>e.amount>0&&e.item.includes(text)&&!rvState().funds[e.id]).slice(0,60).map(e=>`<option value="${escapeHtml(String(e.id))}">${e.date} ${escapeHtml(e.item)} ${scopeMoney(e.amount)}</option>`).join(''));}
async function rvAddFund(){
    const id=document.getElementById('rvFundSource').value,kind=document.getElementById('rvFundKind').value,e=expenses.find(e=>String(e.id)===id);
    if(!e||e.amount<=0)return showToast('先选择原付款','warning');
    if(!confirm(`确认「${e.item}」${scopeMoney(e.amount)} 是${kind==='deposit'?'可退保证金':'预付充值'}？原付款保留，消费统计剔除这笔本金，后续实际消费另行核销。`))return;
    const d=rvCopy(rvState());if(d.funds[id])return;d.funds[id]={kind,sourceSignature:rvExpenseSignature(e),events:[],createdAt:new Date().toISOString()};await rvSave(d);
}
async function rvAddFundEvent(i){
    const d=rvCopy(rvState()),[id,f]=Object.entries(d.funds)[i]||[];if(!f)return;const e=expenses.find(e=>String(e.id)===id);
    const val=k=>document.getElementById(k+i).value,date=val('rvEventDate'),amount=Number(val('rvEventAmount')),kind=val('rvEventKind'),note=cleanText(val('rvEventNote'),200);
    if(!rvDateOK(date)||date<e.date||date>localDateString()||!rvAmountOK(amount)||amount<=0||!note.trim())return showToast('填写有效日期、正数金额和凭据说明','warning');
    if(expenses.some(r=>r.id!==e.id&&r.date===date&&Math.abs(rvCents(r.amount))===rvCents(amount)))return showToast('同日已有相同金额的账本记录，请先核对，避免重复登记','warning');
    if(!confirm('确认这笔核销／退回尚未在收支账本或本面板登记？若已记过，请取消，避免重复计算。'))return;
    f.events.push({id:crypto.randomUUID(),date,amount,kind,note});await rvSave(d);
}
async function rvRemoveFundEvent(i,j){const d=rvCopy(rvState()),f=Object.values(d.funds)[i];if(!f||!confirm('撤销这笔核销登记？原付款不会删除。'))return;f.events.splice(j,1);await rvSave(d);}
async function rvRemoveFund(i){const d=rvCopy(rvState()),[id,f]=Object.entries(d.funds)[i]||[];if(!f)return;const source=expenses.find(e=>String(e.id)===id),stale=!source||rvExpenseSignature(source)!==f.sourceSignature;if(stale){if(!confirm('原账已变化。撤销此资金分类及其核销登记？修改前版本仍保留在云端审计和备份中。'))return;delete d.funds[id];return rvSave(d);}if(f.events.length)return showToast('请先核对并撤销核销记录，再取消分类','warning');if(!confirm('取消资金分类，恢复原有消费统计？'))return;delete d.funds[id];await rvSave(d);}
function rvValidate(value,rows=null){
    const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
    if(!object(value))throw new Error('复盘配置格式无效');const d=rvState(value);
    if(!object(d.budgetYears)||!object(d.months)||!object(d.funds)||!Array.isArray(d.pending))throw new Error('复盘字段格式无效');
    for(const [year,v] of Object.entries(d.budgetYears)){
        if(!/^\d{4}$/.test(year)||!object(v)||!Array.isArray(v.original)||!Array.isArray(v.current)||!Array.isArray(v.history))throw new Error('年度预算版本无效');
        for(const list of [v.original,v.current]){const ids=new Set();for(const c of list){if(!c||!Number.isInteger(Number(c.id))||ids.has(c.id)||!rvAmountOK(c.yearly)||Number(c.yearly)<0)throw new Error('年度预算金额或分类无效');ids.add(c.id);}}
    }
    for(const [month,m] of Object.entries(d.months))if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!object(m)||typeof m.fingerprint!=='string')throw new Error('核对状态无效');
    for(const p of d.pending)if(!p||!rvDateOK(p.date)||!p.item||!p.id)throw new Error('待补记录无效');
    for(const [id,f] of Object.entries(d.funds)){
        if(!object(f)||!['deposit','prepayment'].includes(f.kind)||!Array.isArray(f.events)||typeof f.sourceSignature!=='string')throw new Error('资金分类无效');
        const e=rows?.find(e=>String(e.id)===id);if(rows&&(!e||rvExpenseSignature(e)!==f.sourceSignature||Number(e.amount)<=0))throw new Error('资金关联原账已变化，请先核对资金记录');
        let used=0;const seen=new Set();for(const r of f.events){if(!r||!r.id||seen.has(r.id)||!rvDateOK(r.date)||!rvAmountOK(r.amount)||Number(r.amount)<=0||!['use','return'].includes(r.kind)||!String(r.note||'').trim()||(e&&r.date<e.date))throw new Error('资金核销记录无效');used+=rvCents(r.amount);seen.add(r.id);}
        if(e&&used>rvCents(e.amount))throw new Error('核销和退回合计不能超过原付款金额');
    }
    return value;
}

// Presentation helpers do not mutate financial records.
function rvTrendRows(rows,range,today=localDateString()) {
    const count=rangeMonths[range]||12,end=today.slice(0,7),d=new Date(Number(end.slice(0,4)),Number(end.slice(5,7))-(Number.isFinite(count)?count:1),1);
    const start=count===Infinity?'0000-01':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    return rows.filter(h=>h.month>=start&&h.month<=end).sort((a,b)=>a.month.localeCompare(b.month));
}
function rvTrendDelta(rows){
    if(rows.length<2)return rows.length?'仅一条快照，暂无变化可比较':'—';
    const first=Number(rows[0].total),diff=Math.round((Number(rows.at(-1).total)-first)*100)/100;
    return `${diff<0?'−':diff>0?'+':''}${scopeMoney(Math.abs(diff))}${first>0?' ('+(diff>0?'+':'')+(diff/first*100).toFixed(1)+'%)':''}`;
}
function rvAttention(){
    const pending=rvState().pending.filter(p=>!p.resolvedAt),policy=rvRecordingPolicy();
    return `<h3>账本进度</h3><p class="muted">${policy.noIncomeEntryMeansZero?'按你的约定：未新增收入即无进账；资产沿用上次登记余额。':'收入及资产按已登记记录展示。'}</p>${pending.length?`<div class="attention-row"><span>${pending.length} 笔金额待补，未计入支出</span><button class="text-button" onclick="switchPage('record');document.querySelector('#recordPending details').open=true">处理</button></div>`:'<p class="muted">没有待补金额的事项。</p>'}`;
}
function rvRecordingPolicy(){return rvState().recordingPolicy||{};}
function rvCategoryRecords(id,year){
    const rows=expenses.filter(e=>Number(e.categoryId)===Number(id)&&e.date.startsWith(String(year))).sort((a,b)=>b.date.localeCompare(a.date));
    const modal=document.createElement('div');modal.className='modal-overlay';modal.id='categoryRecordsModal';
    modal.innerHTML=`<div class="modal"><div class="card-header-flex"><h3>${escapeHtml(categories.find(c=>c.id===id)?.name||'类目')} · ${year}</h3><button class="btn btn-outline btn-sm" onclick="document.getElementById('categoryRecordsModal').remove()">关闭</button></div><p class="muted">${rows.length} 笔原账付款 · ${scopeMoney(rvSum(rows))}</p>${rvTable(rows.map(e=>`<tr><td>${escapeHtml(e.date)}</td><td>${escapeHtml(e.item)}</td><td>${scopeMoney(e.amount)}</td></tr>`),['日期','事项','金额'])}</div>`;
    document.body.appendChild(modal);
}

async function rvSaveGoals(next){
    if(rvBusy)return false;const before=rvCopy(goals),profile=currentUser;rvBusy=true;goals=next;
    try{if(!await syncAllToCloud()){if(currentUser===profile){goals=before;saveConfigLocalBackup();}return false;}renderGoals();showToast('目标已保存到云端','success');return true;}finally{rvBusy=false;}
}
async function rvSaveCategories(next,reason){
    const d=rvCopy(rvState()),year=new Date().getFullYear();if(!d.budgetYears[year])d.budgetYears[year]=rvBudgetVersion(year);
    const v=d.budgetYears[year],before=rvSum(v.current.map(c=>({amount:c.yearly}))),after=rvSum(next.map(c=>({amount:c.yearly})));
    v.history.push({at:new Date().toISOString(),name:'类目结构',before,after,reason});v.current=rvCopy(next);
    const ok=await rvSave(d,next);if(ok){renderCategoryGrid();renderBudgetTip();}return ok;
}
