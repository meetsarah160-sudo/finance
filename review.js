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
    const record=rvState().months[month];
    const closed=month<localDateString().slice(0,7);
    const verified=!!record && record.fingerprint===rvFingerprint(month) && pending===0 && closed;
    const has=expenses.some(e=>e.date.startsWith(month))||rvFundRows().some(e=>e.date.startsWith(month));
    return {verified,pending,has,label:verified?'已核对完整':pending?`${pending} 笔待补金额`:record?'账本变化／进行中，需重新核对':has?'有记录，尚未核对完整':'未记录／待核对（不等于零）'};
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
    const html=`<div class="scope-heading"><h3>年度预算 · 个人与创业</h3><select aria-label="年度预算年份" onchange="setScopeBudgetYear(this.value)">${years.map(y=>`<option ${y===scopeBudgetYear?'selected':''}>${y}</option>`).join('')}</select></div>${rvBudgetCards(scopeBudgetYear)}<p class="scope-note">按净付款占用年度额度，保证金／预付也占用资金；消费统计另列。个人与创业不自动互抵，年度剩余不等于可用现金。备用金年内累计使用，月均仅作参考，跨年不自动结转。</p>`;
    rvPut('dashboardScopeBudget',html);rvPut('annualScopeBudget',html);
}
function setScopeBudgetYear(value){scopeBudgetYear=Number(value);renderBudgetStatus();}
function renderBudgetStatus(){
    renderScopeBudgets();const year=scopeBudgetYear,budget=rvBudget(year);
    rvPut('summaryCards',`<p class="scope-note">预算按年度评估；房租、保险和大额购置按付款日期列示，不根据名称自动摊销。</p>`);
    rvPut('budgetList',`<div class="rv-table-wrap"><table class="rv-table"><thead><tr><th>类目</th><th>年度预算</th><th>净付款</th><th>年度剩余</th></tr></thead><tbody>${(budget||categories).map(c=>{
        const amount=rvSum(expenses.filter(e=>e.date.startsWith(String(year))&&e.categoryId===c.id))-rvSum(rvFundRows().filter(e=>e.kind==='return'&&e.date.startsWith(String(year))&&e.categoryId===c.id));
        return `<tr><td>${escapeHtml(c.name)}</td><td>${budget?scopeMoney(c.yearly):'未知'}</td><td>${scopeMoney(amount)}</td><td>${budget?scopeMoney(Number(c.yearly)-amount):'—'}</td></tr>`;
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
        if(currentUser!==profile)return true;renderBudgetStatus();renderReport();renderDashboard();renderSettings();showToast('已保存到云端','success');return true;
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
function renderDashboardBudget(){
    const year=new Date().getFullYear(),summary=scopeSummary(year);
    rvPut('dashboardBudgetProgress',Object.entries(summary).map(([k,b])=>`<p>${BUDGET_SCOPE_LABELS[k]} · ${b.known?(b.remaining<0?'年度超支 ':'年度剩余 ')+scopeMoney(Math.abs(b.remaining)):'预算未知'}</p>`).join(''));
}
function renderCompareCards(){rvPut('compareCards','<p class="scope-note">同比请查看「月／季／年复盘」：使用相同日期范围，未核对完整时只展示已记录金额，不计算误导性的增减比例。</p>');}
function renderDailyReminder(){
    const month=localDateString().slice(0,7),latest=expenses.map(e=>e.date).sort().at(-1);
    rvPut('dailyReminderContent',`<div class="rv-section"><strong>账本进度</strong><p>最新支出：${latest?escapeHtml(latest):'尚无记录'} · ${escapeHtml(rvMonthStatus(month).label)}</p><button class="btn btn-outline btn-sm" onclick="switchPage('analysis', event)">打开复盘与待核对事项</button></div>`);
}
function renderDashboardKPI(){
    const today=localDateString(),r={start:today.slice(0,7)+'-01',end:today},x=rvMetrics(r),inc=incomes.filter(e=>e.date>=r.start&&e.date<=r.end);
    const items=[['本月已记录净付款',scopeMoney(x.cash)],['本月已确认消费',scopeMoney(x.consumption)],['本月已记录收入',inc.length?scopeMoney(rvSum(inc)):'未记录'],['本月账本状态',rvMonthStatus(today.slice(0,7)).label]];
    rvPut('dashboardKPI',items.map(([label,value])=>`<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value rv-value">${value}</div></div>`).join(''));
}
function initReportMonthSelector(){
    const el=document.getElementById('reportMonth');if(!el)return;
    const value=el.value||localDateString().slice(0,7);
    el.innerHTML=rvYears().flatMap(y=>Array.from({length:12},(_,i)=>`${y}-${String(12-i).padStart(2,'0')}`)).map(m=>`<option value="${m}" ${m===value?'selected':''}>${m}</option>`).join('');
}
function rvReportRange(){
    const [y,m]=(document.getElementById('reportMonth')?.value||localDateString().slice(0,7)).split('-').map(Number);
    const mode=document.getElementById('reportMode')?.value||'month';return {...rvRange(mode,y,mode==='quarter'?Math.ceil(m/3):m),mode,year:y};
}
function rvTable(rows,headers){return `<div class="rv-table-wrap"><table class="rv-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;}
function rvReview(range,scope=''){
    if(range.future)return '<p>该期间尚未开始。</p>';
    const issues=rvFundIssues();
    const x=rvMetrics(range,scope),compare=rvComparison(range,scope),months=rvMonths(range.start,range.end);
    const known=x.count>0||x.events.length>0||rvComplete(range);
    const inc=incomes.filter(e=>e.date>=range.start&&e.date<=range.end), latest=x.rows.map(e=>e.date).sort().at(-1);
    const byCat=categories.map(c=>({c,amount:rvSum(x.rows.filter(e=>e.categoryId===c.id))})).filter(r=>r.amount!==0).sort((a,b)=>b.amount-a.amount);
    const top=x.rows.filter(e=>e.amount>0).slice().sort((a,b)=>b.amount-a.amount).slice(0,5);
    const gift=x.rows.filter(e=>e.categoryId===14),subs=x.rows.filter(e=>/会员|订阅|话费|充值|服务器/.test(e.item));
    const tips=[];
    if(months.some(m=>!rvMonthStatus(m).verified))tips.push('先补齐待核对月份，再判断是否减少消费；目前总额是已记录金额。');
    if(gift.length)tips.push(`本期自愿赠请 ${scopeMoney(rvSum(gift))}（${gift.length} 笔）。复盘哪些是自己愿意的，哪些只是碍于情面；它们不是自动判定的浪费。`);
    if(subs.length)tips.push(`检查 ${subs.length} 笔会员／充值／服务项目的使用频率；这是按名称筛出的候选，未自动认定为订阅或重复扣费。`);
    if(top.length)tips.push(`最大一笔「${top[0].item}」${scopeMoney(top[0].amount)}，先区分集中付款和持续开销，再决定是否调整年度预算。`);
    if(!tips.length)tips.push('本期暂无足够记录，先核对账本完整性。');
    const rows=['personal','business'].map(scope=>{const c=rvComparison(range,scope);return `<tr><td>${BUDGET_SCOPE_LABELS[scope]}</td><td>${c.a.count||rvComplete(range)?scopeMoney(c.a.cash):'未记录'}</td><td>${c.b.count||rvComplete(c.previous)?scopeMoney(c.b.cash):'未记录／未知'}</td><td>${c.percent===null?'数据不足／基期为零':(c.percent>=0?'+':'')+c.percent.toFixed(1)+'%'}</td></tr>`;});
    return `${issues.length?'<p class="rv-section scope-over">部分资金关联原账已变化，相关核销暂停计算；请到资金面板核对，当前消费及净付款统计可能不完整。</p>':''}<div class="rv-section"><h3>${escapeHtml(range.start)} 至 ${escapeHtml(range.end)} · ${BUDGET_SCOPE_LABELS[scope]||'全部账本'}</h3><p>最新记录：${latest?escapeHtml(latest):'无'}。${rvComplete(range)?'所涉月份已核对完整。':'本期尚未核对完整，不代表完整消费总额。'}</p><div class="scope-budget-grid"><div class="scope-budget-card"><h4>净付款 ${known?scopeMoney(x.cash):'未记录／未知'}</h4><p>原账付款 ${scopeMoney(rvSum(x.rows))} − 已登记资金退回 ${scopeMoney(x.returns)}</p></div><div class="scope-budget-card"><h4>已确认消费 ${known?scopeMoney(x.consumption):'未记录／未知'}</h4><p>剔除已确认保证金／预付款 ${scopeMoney(x.held)}，加已登记核销 ${scopeMoney(x.used)}。</p></div></div><p class="scope-note">未分类为资金占用的旧账仍按原记录统计；未核销预付资金的消费可能尚未补齐。全部账本收入${inc.length?'已记录 '+scopeMoney(rvSum(inc)):'尚未记录'}，不据此推算真实结余或储蓄率。历史手填月度汇总保留在备份；本报告统一使用可追溯明细。</p></div>
    <div class="rv-section"><h3>去年同期对比</h3><p>对比区间：${compare.previous.start} 至 ${compare.previous.end}；本年未结束时仅比较同一截止日。</p>${rvTable(rows,['归属','本期净付款','去年同期已记录','同比'])}<p class="scope-note">只有双方所涉月份均核对完整才计算比例。2024／2025 等历史数据未找到时展示未知，不补零。</p></div>
    <div class="rv-section"><h3>每月对比与完整度</h3>${rvTable(months.map(m=>{
        const end=m===range.end.slice(0,7)?range.end:`${m}-${new Date(Number(m.slice(0,4)),Number(m.slice(5)),0).getDate()}`;
        const c=rvComparison({start:m+'-01',end},scope),s=rvMonthStatus(m);
        return `<tr><td>${m}</td><td>${c.a.count||s.verified?scopeMoney(c.a.cash):'未记录'}</td><td>${c.b.count||rvComplete(c.previous)?scopeMoney(c.b.cash):'未知'}</td><td>${escapeHtml(s.label)}</td><td><button class="btn btn-outline btn-sm" onclick="rvReconcile('${m}')">核对完整</button></td></tr>`;
    }),['月份','本年净付款','去年同月同期','完整度','确认'])}</div>
    <div class="rv-section"><h3>付款结构与大额项目</h3>${rvTable(byCat.map(r=>`<tr><td>${escapeHtml(r.c.name)}</td><td>${scopeMoney(r.amount)}</td></tr>`),['类目','原账付款'])}<ul>${top.map(e=>`<li>${e.date} · ${escapeHtml(e.item)} · ${scopeMoney(e.amount)}</li>`).join('')||'<li>无记录</li>'}</ul><p class="scope-note">季度房租、年度保险和设备款可能集中支付；不自动按月摊销，不把一次性大额解释为生活费持续上涨。</p></div>
    <div class="rv-section"><h3>本期复盘建议</h3><ol>${tips.slice(0,3).map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ol></div>`;
}
function renderReport(){
    if(!document.getElementById('reportContent'))return;
    const range=rvReportRange();rvPut('reportContent',rvReview(range,document.getElementById('reportScope')?.value||'')+rvPendingUI()+rvFundsUI());
}
function renderBudgetCheckup(){rvPut('page-checkup',`<h2>年度预算复盘</h2>${rvBudgetCards(new Date().getFullYear())}${rvReview(rvRange('year',new Date().getFullYear(),1))}`);}
async function rvReconcile(month){
    const status=rvMonthStatus(month);
    if(month>=localDateString().slice(0,7))return showToast('本月仍在进行中，结束后再确认完整','warning');
    if(status.pending)return showToast('还有金额未知的记录，先补齐或说明不录入原因','warning');
    if(!confirm(`确认 ${month} 的收支已与账单核对完整？没有记录也会作为已核对的零支出月份。后续改账会自动失效。`))return;
    const d=rvCopy(rvState());d.months[month]={at:new Date().toISOString(),fingerprint:rvFingerprint(month)};await rvSave(d);
}
function rvPendingUI(){
    return `<details class="rv-section" open><summary>全部账本待补记录（不计入消费）</summary><p>金额未知保留待办，不填零、不猜金额。补入账本后可关联已有记录完成核对。</p><div class="rv-controls"><input id="rvPendingDate" type="date" aria-label="待补日期"><input id="rvPendingItem" placeholder="待补事项" aria-label="待补事项"><button class="btn btn-outline" onclick="rvAddPending()">添加待补</button></div>${rvTable(rvState().pending.map((p,i)=>`<tr><td>${escapeHtml(p.date)}</td><td>${escapeHtml(p.item)}</td><td>${p.resolvedAt?'已处理：'+escapeHtml(p.resolution):'金额未知，未计入'}</td><td>${p.resolvedAt?'':`<button class="btn btn-outline btn-sm" onclick="rvResolvePending(${i})">处理</button>`}</td></tr>`),['日期','事项','状态','操作'])}</details>`;
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
function renderDashboardVitalSigns(){
    const current=localDateString().slice(0,7),state=rvMonthStatus(current);
    rvPut('dashboardVitalSigns',`<p class="scope-note" style="grid-column:1/-1">财务判断以年度预算及完整账单为基础。${escapeHtml(state.label)}；收入未核对完整时不计算储蓄率，也不根据单月大额付款评分。</p>`);
}
function renderYearlyStats(){
    const year=Number(document.getElementById('yearSelect')?.value)||new Date().getFullYear();
    rvPut('yearSummary',rvBudgetCards(year));rvPut('yearGrid',rvReview(rvRange('year',year,1)));rvPut('yearCategoryRank','');
}
