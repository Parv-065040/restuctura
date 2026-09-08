import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer} from 'recharts';
import {ArrowRight, ArrowLeft, Check, ChevronRight, Clock3, FileText, ShieldCheck, AlertTriangle, Download, Plus, Upload, Menu, X, Info, Trash2, Building2, CreditCard, Sparkles, CircleHelp, FileCheck2} from 'lucide-react';
import './styles.css';
import {demoData, buildAssessmentRequest, getAssessment} from './services/api';

const money = n => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 10000000) return '₹' + (v / 10000000).toFixed(2) + 'Cr';
  if (abs >= 100000) return '₹' + (v / 100000).toFixed(2) + 'L';
  return '₹' + Math.round(v).toLocaleString('en-IN');
};
const compact = n => money(n);
const pct = n => n === null || n === undefined ? '—' : Math.round(Number(n) * 100) + '%';
const loanFromDemo = demoData.loans.map((l, i) => ({
  id: `loan_${i + 1}`,
  lender: l[0], loanType: l[1], outstandingAmount: l[2], emi: l[3], remainingTenure: l[4], interestRatePct: String(l[5]).replace('%',''), secured: l[6]
}));

const initialForm = {
  companyName: '',
  businessType: '',
  monthlySales: '',
  monthlyExpenses: '',
  cashReserve: '',
  customersPayingLate: '',
  receivablesAmount: '',
  incomeOutlook: '',
  mainProblem: '',
  urgency: '',
  loans: [],
  documents: []
};

function Logo(){return <div className="logo"><span className="logoMark">R</span><span>RESTRUCTRA</span></div>}
function Pill({children,tone=''}){return <span className={'pill '+tone}>{children}</span>}
function Header({page,setPage}){
  const [open,setOpen]=useState(false);
  const links=[['Overview','dashboard'],['Analysis','analysis'],['Scenarios','scenarios'],['Bank Plan','bank']];
  return <header>
    <button className="brandButton" onClick={()=>setPage('landing')} aria-label="Go to RESTRUCTRA home"><Logo/></button>
    <nav className={open?'open':''}>{links.map(([label,p])=><button key={p} className={page===p?'active':''} onClick={()=>{setPage(p);setOpen(false)}}>{label}</button>)}</nav>
    <button className="newBtn" onClick={()=>{setPage('intake');setOpen(false)}}><Plus size={16}/> New assessment</button>
    <button className="menu" onClick={()=>setOpen(!open)} aria-label="Open navigation">{open?<X/>:<Menu/>}</button>
  </header>
}

function Landing({setPage}){
  return <main className="landing">
    <section className="hero">
      <div className="heroCopy">
        <Pill>AI-POWERED MSME DECISION SUPPORT</Pill>
        <h1>Turn EMI pressure<br/><em>into a plan.</em></h1>
        <p>Tell us about your business, upload the documents you already have, and get a clear view of what is putting pressure on cash flow — plus what to discuss with your lenders.</p>
        <div className="actions">
          <button className="primary" onClick={()=>setPage('intake')}>Start my assessment <ArrowRight size={18}/></button>
          <button className="ghost" onClick={()=>document.getElementById('how-it-works')?.scrollIntoView({behavior:'smooth'})}>See how it works</button>
        </div>
        <div className="trust"><ShieldCheck size={17}/> Your information is used for decision support. RESTRUCTRA is not a lender.</div>
      </div>
      <div className="heroVisual">
        <div className="flowCard">
          <div className="flowHead"><span>What RESTRUCTRA does</span><Pill tone="green">3 STEPS</Pill></div>
          <div className="productFlow">
            <div><span className="flowIcon"><Building2 size={18}/></span><b>Understand</b><small>Business + loans + documents</small></div>
            <ChevronRight/>
            <div><span className="flowIcon"><Sparkles size={18}/></span><b>Analyse</b><small>Cash flow + repayment pressure</small></div>
            <ChevronRight/>
            <div><span className="flowIcon"><FileCheck2 size={18}/></span><b>Prepare</b><small>Scenarios + lender discussion plan</small></div>
          </div>
          <div className="miniInsight"><Check size={16}/><span>Simple questions. Deep analysis.</span></div>
        </div>
        <div className="floating"><Check size={16}/><span>Recommendation validated</span></div>
      </div>
    </section>
    <section className="how" id="how-it-works">
      <div className="sectionIntro"><Pill>HOW IT WORKS</Pill><h2>Simple for the owner.<br/>Deep under the hood.</h2><p>You do not need to know finance terminology. We translate your inputs into a repayment picture you can understand.</p></div>
      <div className="steps">{[
        ['01','Tell us','Answer a few plain-language questions about sales, expenses, receivables and your loans.'],
        ['02','Upload','Add the statements and reports you already have. You can also say “I don’t know”.'],
        ['03','Analyse','The backend will reconcile the documents, run the financial engine and compare restructuring options.'],
        ['04','Act','Get a clear recommendation, trade-offs and a lender-ready discussion plan.']
      ].map(x=><div className="step" key={x[0]}><span>{x[0]}</span><h3>{x[1]}</h3><p>{x[2]}</p></div>)}</div>
    </section>
  </main>
}

function Field({label,help,children,required=true}){
  return <label className="field"><span>{label} {required && <i>*</i>}</span>{help&&<small>{help}</small>}{children}</label>
}
function OptionGrid({value,onChange,options}){
  return <div className="options">{options.map(x=><button type="button" className={value===x?'selected':''} key={x} onClick={()=>onChange(x)}>{x}</button>)}</div>
}
function EmptyLoan({onAdd}){
  return <div className="emptyState"><CreditCard size={28}/><b>Add your business loans</b><p>Add the loans you want RESTRUCTRA to consider. You can enter “I don’t know” for details you do not have.</p><button type="button" className="secondary" onClick={onAdd}><Plus size={16}/> Add a loan</button></div>
}
function LoanCard({loan,index,onChange,onRemove}){
  const set=(key,val)=>onChange({...loan,[key]:val});
  return <div className="loanCard">
    <div className="loanCardHead"><div><span className="loanNumber">LOAN {index+1}</span><h3>{loan.lender || 'New loan'}</h3></div>{index>0&&<button type="button" className="iconBtn" onClick={onRemove} aria-label={`Remove loan ${index+1}`}><Trash2 size={16}/></button>}</div>
    <div className="grid2">
      <Field label="Lender / bank"><input value={loan.lender} onChange={e=>set('lender',e.target.value)} placeholder="e.g. HDFC Bank"/></Field>
      <Field label="Loan type"><select value={loan.loanType} onChange={e=>set('loanType',e.target.value)}><option value="">Select loan type</option><option>Business loan</option><option>Machinery / equipment loan</option><option>Cash credit / overdraft</option><option>Working capital loan</option><option>Other</option><option>I don't know</option></select></Field>
      <Field label="Amount still outstanding" help="Approximate is fine"><input inputMode="numeric" value={loan.outstandingAmount} onChange={e=>set('outstandingAmount',e.target.value)} placeholder="₹ amount or I don't know"/></Field>
      <Field label="Monthly EMI" help="The amount you normally pay each month"><input inputMode="numeric" value={loan.emi} onChange={e=>set('emi',e.target.value)} placeholder="₹ amount or I don't know"/></Field>
      <Field label="Remaining tenure"><input inputMode="numeric" value={loan.remainingTenure} onChange={e=>set('remainingTenure',e.target.value)} placeholder="Months or I don't know"/></Field>
      <Field label="Interest rate" required={false}><input inputMode="decimal" value={loan.interestRatePct} onChange={e=>set('interestRatePct',e.target.value)} placeholder="% or I don't know"/></Field>
    </div>
    <Field label="Is the loan secured?" required={false}><OptionGrid value={loan.secured} onChange={v=>set('secured',v)} options={['Yes','No','I don’t know']}/></Field>
  </div>
}

function Intake({setPage,setResultInput}){
  const [step,setStep]=useState(1);
  const [form,setForm]=useState(initialForm);
  const [errors,setErrors]=useState([]);
  const [dragging,setDragging]=useState(false);
  const set=(key,value)=>setForm(f=>({...f,[key]:value}));
  const addLoan=()=>set('loans',[...form.loans,{id:`loan_${Date.now()}`,lender:'',loanType:'',outstandingAmount:'',emi:'',remainingTenure:'',interestRatePct:'',secured:''}]);
  const updateLoan=(index,loan)=>set('loans',form.loans.map((x,i)=>i===index?loan:x));
  const removeLoan=index=>set('loans',form.loans.filter((_,i)=>i!==index));
  const addFiles=files=>{
    const next=Array.from(files||[]).map(file=>({name:file.name,size:file.size,type:file.type||'unknown',file}));
    set('documents',[...form.documents,...next.filter(f=>!form.documents.some(x=>x.name===f.name))]);
  };
  const removeFile=name=>set('documents',form.documents.filter(f=>f.name!==name));
  const validate=()=>{
    const e=[];
    if(step===1){
      if(!form.businessType)e.push('Choose your business type.');
      if(!form.monthlySales)e.push('Add your approximate monthly sales.');
      if(!form.monthlyExpenses)e.push('Add your approximate monthly expenses.');
      if(!form.mainProblem)e.push('Tell us what is causing the most pressure.');
      if(!form.urgency)e.push('Tell us how urgent the situation is.');
    }
    if(step===2 && form.loans.length===0)e.push('Add at least one business loan.');
    setErrors(e); return e.length===0;
  };
  const next=()=>{if(validate())setStep(s=>Math.min(4,s+1));};
  const back=()=>{setErrors([]);setStep(s=>Math.max(1,s-1));};
  const analyse=()=>{
    if(!validate())return;
    setResultInput({form, request:buildAssessmentRequest(form), files:form.documents.map(d=>d.file).filter(Boolean)});
    setPage('analysis');
  };
  const fileInputId='doc-upload';
  return <main className="page intakePage">
    <div className="formWrap wideForm">
      <div className="pageTitle">
        <Pill>ASSESSMENT</Pill>
        <h1>Let’s understand your business.</h1>
        <p>No finance jargon. Give us your best estimate — we’ll handle the complexity.</p>
      </div>
      <div className="stepper">{['Business','Loans','Documents','Review'].map((x,i)=><div className={i+1<=step?'done':''} key={x}><span>{i+1<step?<Check size={13}/>:i+1}</span>{x}</div>)}</div>
      {errors.length>0&&<div className="formError"><AlertTriangle size={17}/><div>{errors.map(x=><div key={x}>{x}</div>)}</div></div>}
      <div className="formCard">
        {step===1&&<>
          <div className="formSectionIntro"><div className="sectionIcon"><Building2 size={19}/></div><div><h2>About your business</h2><p>A rough estimate is completely fine. You can update this later.</p></div></div>
          <div className="grid2">
            <Field label="Business / company name"><input value={form.companyName} onChange={e=>set('companyName',e.target.value)} placeholder="e.g. Shree Balaji Engineering Works"/></Field>
            <Field label="What does your business do?"><select value={form.businessType} onChange={e=>set('businessType',e.target.value)}><option value="">Select one</option><option>Manufacturing</option><option>Trading</option><option>Services</option><option>Retail</option><option>Other</option></select></Field>
            <Field label="How much do you usually sell in a month?" help="Use an approximate average"><input inputMode="numeric" value={form.monthlySales} onChange={e=>set('monthlySales',e.target.value)} placeholder="e.g. ₹20,00,000"/></Field>
            <Field label="About how much does it cost to run the business each month?" help="Include your usual operating costs"><input inputMode="numeric" value={form.monthlyExpenses} onChange={e=>set('monthlyExpenses',e.target.value)} placeholder="e.g. ₹16,80,000"/></Field>
            <Field label="How much cash is currently available?" required={false} help="Bank + cash you can use for business payments"><input inputMode="numeric" value={form.cashReserve} onChange={e=>set('cashReserve',e.target.value)} placeholder="₹ amount or I don't know"/></Field>
            <Field label="Are customers taking longer than usual to pay?"><OptionGrid value={form.customersPayingLate} onChange={v=>set('customersPayingLate',v)} options={['Yes','No','Sometimes','Not sure']}/></Field>
            <Field label="How much money are customers currently supposed to pay you?" required={false} help="A rough receivables estimate is enough"><input inputMode="numeric" value={form.receivablesAmount} onChange={e=>set('receivablesAmount',e.target.value)} placeholder="₹ amount or I don't know"/></Field>
            <Field label="What do you expect from the next 3–6 months?"><OptionGrid value={form.incomeOutlook} onChange={v=>set('incomeOutlook',v)} options={['Increase','Stay similar','Decrease','Not sure']}/></Field>
          </div>
          <div className="subsection"><h3>What feels hardest right now?</h3><OptionGrid value={form.mainProblem} onChange={v=>set('mainProblem',v)} options={['EMI is too high','Not enough cash right now','Customers haven’t paid','Seasonal business','Multiple EMIs are hard to manage','Worried about future payments','I’m not sure']}/></div>
          <div className="subsection"><h3>How urgent is the situation?</h3><OptionGrid value={form.urgency} onChange={v=>set('urgency',v)} options={['Managing comfortably','Next 1–3 months','Next few weeks','Already missed a payment','Not sure']}/></div>
        </>}
        {step===2&&<>
          <div className="formSectionIntro"><div className="sectionIcon"><CreditCard size={19}/></div><div><h2>Your business loans</h2><p>Add each EMI obligation. If you don’t know a detail, just write “I don’t know”.</p></div></div>
          {form.loans.length===0?<EmptyLoan onAdd={addLoan}/>:<div className="loanStack">{form.loans.map((loan,i)=><LoanCard key={loan.id} loan={loan} index={i} onChange={x=>updateLoan(i,x)} onRemove={()=>removeLoan(i)}/>)}</div>}
          {form.loans.length>0&&<button type="button" className="addLoan" onClick={addLoan}><Plus size={16}/> Add another loan</button>}
          <div className="helperBox"><CircleHelp size={17}/><span>You do not need to have every number. Missing optional details will be flagged later rather than guessed.</span></div>
        </>}
        {step===3&&<>
          <div className="formSectionIntro"><div className="sectionIcon"><Upload size={19}/></div><div><h2>Upload the documents you already have</h2><p>Required files are enough to start. More context can improve the analysis.</p></div></div>
          <div className="docGuide"><div><b>Start with these</b><span>Last 6 months bank statement</span><span>Latest business loan statement(s)</span></div><div><b>Helpful if available</b><span>GST return / sales summary</span><span>Customer receivables list</span><span>Loan sanction letter / agreement</span></div></div>
          <input id={fileInputId} className="srOnly" type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.txt" onChange={e=>addFiles(e.target.files)}/>
          <label className={'drop '+(dragging?'dragging':'')} htmlFor={fileInputId} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files)}}>
            <span className="uploadCircle"><Upload size={21}/></span><b>Drop files here or click to browse</b><span>PDF, XLSX, CSV or TXT</span><small>Files stay staged in this prototype until the document-analysis backend is connected.</small>
          </label>
          {form.documents.length>0&&<div className="selectedFiles"><div className="selectedFilesHead"><b>{form.documents.length} file{form.documents.length===1?'':'s'} added</b><span>Ready for analysis</span></div>{form.documents.map(f=><div className="selectedFile" key={f.name}><FileText size={18}/><div><b>{f.name}</b><small>{f.size?`${Math.max(1,Math.round(f.size/1024))} KB`:'File staged'}</small></div><button type="button" className="iconBtn" onClick={()=>removeFile(f.name)} aria-label={`Remove ${f.name}`}><Trash2 size={15}/></button></div>)}</div>}
          <div className="helperBox"><ShieldCheck size={17}/><span>For the demo, document files are captured by the UI only. The future backend will extract and reconcile their contents before making recommendations.</span></div>
        </>}
        {step===4&&<Review form={form}/>} 
        <div className="formActions">
          {step>1&&<button type="button" className="ghost" onClick={back}><ArrowLeft size={17}/> Back</button>}
          {step<4?<button type="button" className="primary" onClick={next}>Continue <ArrowRight size={17}/></button>:<button type="button" className="primary" onClick={analyse}>Analyse my business <Sparkles size={17}/></button>}
        </div>
      </div>
      <div className="formFoot"><ShieldCheck size={15}/> Decision support only · You remain in control of the lender conversation.</div>
    </div>
  </main>
}

function Review({form}){
  const totalEMI=form.loans.reduce((s,l)=>s+(Number(String(l.emi).replace(/[^0-9.-]/g,''))||0),0);
  return <div className="review">
    <div className="reviewTop"><div><Pill tone="green">READY TO ANALYSE</Pill><h2>Here’s what we’ll work with</h2><p>Check the summary before you start. You can go back and edit anything.</p></div><div className="reviewCount"><b>{form.loans.length}</b><span>loan{form.loans.length===1?'':'s'}</span></div></div>
    <div className="reviewGrid">
      <div className="reviewBlock"><span>BUSINESS</span><b>{form.companyName||'Business'}</b><p>{form.businessType||'—'} · {form.monthlySales?money(Number(form.monthlySales)): 'Sales not entered'}</p></div>
      <div className="reviewBlock"><span>MONTHLY COSTS</span><b>{form.monthlyExpenses?money(Number(form.monthlyExpenses)):'—'}</b><p>Approximate operating expenses</p></div>
      <div className="reviewBlock"><span>CUSTOMER PAYMENTS</span><b>{form.customersPayingLate||'Not specified'}</b><p>{form.receivablesAmount?money(Number(form.receivablesAmount))+' receivables':''}</p></div>
      <div className="reviewBlock"><span>MONTHLY EMI ENTERED</span><b>{totalEMI?money(totalEMI):'Not entered'}</b><p>Across {form.loans.length} loan{form.loans.length===1?'':'s'}</p></div>
    </div>
    <div className="reviewDocs"><span>DOCUMENTS</span><b>{form.documents.length} uploaded</b>{form.documents.slice(0,4).map(f=><small key={f.name}><Check size={13}/>{f.name}</small>)}</div>
    <div className="analysisPromise"><Sparkles size={18}/><div><b>What happens next</b><p>RESTRUCTRA will turn this information into a cash-flow diagnosis, stress test, scenario comparison and lender discussion plan.</p></div></div>
  </div>
}

function Analysis({setPage,resultInput,onResult}){
  const [active,setActive]=useState(0);
  const [status,setStatus]=useState('running');
  const [error,setError]=useState('');
  const items=['Checking your business information','Reviewing uploaded documents','Calculating cash-flow pressure','Stress-testing repayment capacity','Comparing restructuring scenarios','Preparing your recommendation'];

  useEffect(()=>{
    let alive=true;
    const timer=setInterval(()=>setActive(v=>Math.min(v+1,items.length-1)),650);
    (async()=>{
      try{
        const result=await getAssessment(resultInput?.request, resultInput?.files || []);
        if(!alive)return;
        onResult(result);
        setActive(items.length);
        setStatus('success');
      }catch(err){
        if(!alive)return;
        setError(err?.message||'The analysis could not be completed.');
        setStatus('error');
      }
    })();
    return()=>{alive=false;clearInterval(timer)};
  },[resultInput,onResult]);

  const done=status==='success';
  return <main className="page analysisPage"><div className="analysisCard">
    <div className="analysisOrb"><div className="orbInner"><Sparkles size={27}/></div></div>
    <Pill tone={done?'green':status==='error'?'red':''}>{done?'ANALYSIS COMPLETE':status==='error'?'ANALYSIS NEEDS ATTENTION':'ANALYSING YOUR BUSINESS'}</Pill>
    <h1>{done?'Your plan is ready.':status==='error'?'We couldn’t complete the analysis.':'Building your repayment picture…'}</h1>
    <p>{done?`${resultInput?.form?.companyName || 'Your business'} has been analysed. The results below come from the selected analysis mode.`:status==='error'?error:'We’re moving from your simple answers to the deeper financial analysis.'}</p>
    <div className="checks">{items.map((x,i)=><div className={i<active?'checked':''} key={x}><span>{i<active?<Check size={14}/>:<Clock3 size={14}/>}</span>{x}{i<active&&<small>Done</small>}</div>)}</div>
    {done?<><div className="prototypeNotice"><Info size={16}/><span><b>{resultInput?.form?.companyName || 'Your business'}:</b> your analysis is complete. Financial calculations come from the deterministic engine; AI is used for explanation and prioritisation. {status==='success'?'':''}</span></div><button className="primary" onClick={()=>setPage('dashboard')}>View my restructuring plan <ArrowRight size={17}/></button></>:status==='error'?<div className="analysisError"><AlertTriangle size={17}/><span>{error}</span><button className="ghost" onClick={()=>window.location.reload()}>Try again</button></div>:<div className="analysisWait">Analysing securely in the background…</div>}
  </div></main>
}

function Stress({data=demoData}){const h=data.financialHealth;return <div className="stressPanel"><div><span>ILLUSTRATIVE DOWNSIDE</span><h3>What if revenue falls 20%?</h3><p>The model holds expenses constant and shows the monthly cash-flow position under that scenario.</p></div><div className="stressNumbers"><div><small>Current</small><b>{compact(h.availableAfterEMI)}</b><span>monthly surplus</span></div><ArrowRight/><div className="bad"><small>-20% revenue</small><b>−{compact(Math.abs(data.stress.stress))}</b><span>monthly gap</span></div></div></div>}

function Dashboard({setPage,data=demoData}){
  const h=data.financialHealth, rec=data.recommended, classifications=data.classifications||['WATCH','TEMPORARY_LIQUIDITY_STRESS','MULTIPLE_LOAN_COMPLEXITY'];
  return <main className="page dashboard">
    <div className="dashHead"><div><Pill>YOUR RESTRUCTURING PICTURE</Pill><h1>Your business has headroom.<br/><em>EMI pressure is still worth addressing.</em></h1><p>The analysis shows the business’s current cash-flow position, repayment pressure and downside exposure. Customer payment delays and multiple EMI obligations are considered where supported by the supplied information.</p></div><div className="confidence"><ShieldCheck size={18}/><div><b>{data.dataConfidence?.level || 'Analysis complete'}</b><span>{data.dataConfidence?.score != null ? `${data.dataConfidence.score}% · based on supplied data` : 'Based on supplied data'}</span></div></div></div>
    <Stress data={data}/>
    <section className="recommend">
      <div className="recMain"><Pill tone="green">RECOMMENDED STARTING POINT</Pill><h2>Ask your lender about a 50% tenure extension.</h2><p>This illustrative option reduces the combined monthly EMI from <b>{money(h.totalMonthlyEMI)}</b> to <b>{money(rec.newEMI)}</b>. That creates a base-case monthly surplus of <b>{compact(rec.base)}</b>.</p><div className="recNumbers"><div><small>CURRENT EMI</small><b>{money(h.totalMonthlyEMI)}</b></div><ArrowRight/><div><small>ILLUSTRATIVE NEW EMI</small><b className="greenText">{money(rec.newEMI)}</b></div><div><small>MONTHLY REDUCTION</small><b className="greenText">{money(rec.emiReduction)}</b></div></div><button className="primary" onClick={()=>setPage('scenarios')}>Compare all options <ArrowRight size={17}/></button></div>
      <div className="recSide"><div><small>BASE-CASE SURPLUS</small><strong>{compact(rec.base)}</strong></div><div><small>NEW TENURE</small><strong>{rec.newTenure} months</strong></div><div><small>ADDITIONAL ILLUSTRATIVE INTEREST</small><strong>{compact(rec.interest)}</strong></div><div className="warning"><AlertTriangle size={17}/><span>Lower EMI comes with higher total illustrative interest and a longer repayment period.</span></div></div>
    </section>
    <section><div className="sectionHeader"><div><Pill>FINANCIAL SNAPSHOT</Pill><h2>The numbers behind the diagnosis</h2></div><button className="textBtn" onClick={()=>setPage('bank')}>View bank plan <ArrowRight size={15}/></button></div><div className="snapshotGrid">{[['Outstanding debt',compact(h.totalOutstandingDebt)],['Cash reserve',compact(h.cashReserve)],['Receivables',compact(h.receivables)],['Internal DSCR',h.internalDSCR+'×'],['EMI / sales',pct(h.emiToSalesRatio)],['EMI / available cash',pct(h.emiToAvailableRatio)],['EMI coverage',h.cashReserveCoverageMonths+' months'],['Weighted interest',h.weightedAvgInterestRate+'%']].map(x=><div key={x[0]}><small>{x[0]}</small><b>{x[1]}</b></div>)}</div></section>
    <section><div className="sectionHeader"><div><Pill>DIAGNOSIS</Pill><h2>What’s putting pressure on cash flow?</h2></div></div><div className="diagnosis">{classifications.map((c,i)=><div className={'diag '+(['amber','blue','red'][i%3])} key={c}><span>{c.replaceAll('_',' ')}</span><h3>{c==='TEMPORARY_LIQUIDITY_STRESS'?'Reported receivables are high while customers are paying late.':c==='MULTIPLE_LOAN_COMPLEXITY'?'Multiple reported EMI obligations create several repayment commitments.':'The position is worth monitoring, especially under downside revenue stress.'}</h3><p>{c==='TEMPORARY_LIQUIDITY_STRESS'?'The analysis does not assume when receivables will be collected.':''}</p></div>)}</div></section>
    <div className="prototypeStrip"><Info size={16}/><span><b>Prototype result:</b> this page is powered by the selected analysis response. In live mode, the values come from the n8n financial engine and validated AI outputs.</span></div>
  </main>
}

function Scenarios({data=demoData}){
  const s=data.scenarios;
  const rows=[['Current',s.current],['25% extension',s.extend25],['50% extension',s.extend50],['100% extension',s.extend100],['3-mo relief',s.relief],['Step-down',s.step],['Consolidation',s.consolidation]].map(([name,x])=>({name,...(x||{})}));
  const chart=rows.map(r=>({name:r.name,emi:(r.emi||0)/1000,base:(r.base||0)/1000,stress:(r.stress||0)/1000}));
  return <main className="page"><div className="dashHead scenarioHead"><div><Pill>SCENARIO LAB</Pill><h1>See the trade-offs<br/><em>before you choose.</em></h1><p>A lower EMI is not automatically a better deal. Compare monthly relief against longer repayment and additional illustrative interest.</p></div><div className="scenarioNote"><Info size={18}/><span>All scenarios are illustrative. Actual terms depend on lender assessment and approval.</span></div></div>
    <section className="charts"><div className="chartCard"><h3>Monthly EMI</h3><ResponsiveContainer width="100%" height={260}><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tickFormatter={v=>'₹'+v+'k'} tick={{fontSize:10}}/><Tooltip formatter={v=>money(v*1000)}/><Bar dataKey="emi" fill="var(--accent)" radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></div><div className="chartCard"><h3>Base vs downside cash-flow</h3><ResponsiveContainer width="100%" height={260}><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tickFormatter={v=>'₹'+v+'k'} tick={{fontSize:10}}/><Tooltip formatter={v=>money(v*1000)}/><ReferenceLine y={0} stroke="var(--ink)"/><Bar dataKey="base" fill="var(--positive)" radius={[5,5,0,0]}/><Bar dataKey="stress" fill="var(--negative)" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer><div className="legend"><span><i className="dot positive"/>Base case</span><span><i className="dot negative"/>−20% revenue stress</span></div></div></section>
    <section className="tableCard"><div className="tableTop"><div><Pill tone="green">RECOMMENDED</Pill><h2>50% tenure extension</h2></div><div className="tableWhy">Illustrative EMI becomes <b>{money(data.recommended.newEMI)}</b>, creating <b>{compact(data.recommended.base)}</b> base-case surplus. The stress case remains negative.</div></div><div className="scenarioTable"><div className="tr th"><span>Option</span><span>EMI</span><span>Base surplus</span><span>Stress</span><span>Extra interest</span></div>{rows.map(r=><div className={'tr '+(r.name==='50% extension'?'selectedRow':'')} key={r.name}><span><b>{r.name}</b>{r.name==='50% extension'&&<Pill tone="green">Recommended</Pill>}</span><span>{money(r.emi)}</span><span className="greenText">{money(r.base)}</span><span className="redText">{money(r.stress)}</span><span>{r.interest!=null?compact(r.interest):'—'}</span></div>)}</div></section>
    <section className="tradeoff"><div><AlertTriangle/><div><b>The important part</b><p>The recommended option improves base-case cash-flow headroom, but the −20% revenue stress scenario remains negative. Restructuring does not eliminate downside risk.</p></div></div><div><Clock3/><div><b>Alternative: temporary relief</b><p>Three months at ₹0 EMI creates short-term headroom, but the illustrative post-relief EMI rises to {money(s.relief?.postEMI||174543.99)}.</p></div></div></section>
  </main>
}

function Bank({data=demoData}){
  const h=data.financialHealth, rec=data.recommended;
  const loans=data.loans?.length?data.loans:loanFromDemo;
  const report=data.bankReport||{};
  const reportSummary=report.executiveSummary || `Reported receivables total ${compact(h.receivables)}, and customers are reported as paying late. Current combined EMI is ${compact(h.totalMonthlyEMI)} against ${compact(h.availableAfterExpenses)} available after reported monthly expenses. An illustrative 50% tenure extension reduces EMI to ${money(rec.newEMI)} and increases base-case monthly surplus to ${compact(rec.base)}.`;
  return <main className="page bankPage"><div className="bankHero"><div><Pill tone="green">BANK-READY PLAN</Pill><h1>Walk into the lender<br/><em>conversation prepared.</em></h1><p>Turn the analysis into a structured conversation: what to ask for, why you’re asking, and what to take with you.</p></div><button className="primary" onClick={()=>window.print()}><Download size={17}/> Print / save report</button></div>
    <div className="report"><div className="reportHeader"><Logo/><span>RESTRUCTURING DISCUSSION PLAN · CONFIDENTIAL</span></div>
      <section><h2>Executive summary</h2><p>{reportSummary}</p></section>
      <section><h2>Current financial position</h2><div className="reportStats">{[['Monthly sales',compact(h.monthlySales)],['Monthly expenses',compact(h.monthlyExpenses)],['Cash reserve',compact(h.cashReserve)],['Receivables',compact(h.receivables)],['Total EMI',compact(h.totalMonthlyEMI)],['Outstanding debt',compact(h.totalOutstandingDebt)],['Base surplus',compact(h.availableAfterEMI)],['Stress position',money(data.stress.stress)]].map(x=><div key={x[0]}><small>{x[0]}</small><b>{x[1]}</b></div>)}</div></section>
      <section><h2>Loan exposure</h2><div className="loanTable">{loans.map(l=><div className="loanRow" key={l.id||l[0]}><b>{l.lender||l[0]}</b><span>{l.loanType||l[1]}</span><span>{compact(l.outstandingAmount??l[2])}</span><span>{money(l.emi??l[3])} EMI</span><span>{l.remainingTenure??l[4]} mo</span><span>{l.interestRatePct??l[5]}</span><span>{l.secured??l[6]}</span></div>)}</div></section>
      <section className="preferred"><Pill tone="green">PREFERRED DISCUSSION OPTION</Pill><h2>Ask each lender to discuss an illustrative 50% extension of the remaining tenure.</h2><div className="prefGrid"><div><small>Illustrative new EMI</small><b>{money(rec.newEMI)}</b></div><div><small>Monthly EMI reduction</small><b>{money(rec.emiReduction)}</b></div><div><small>Base surplus</small><b>{compact(rec.base)}</b></div><div><small>Additional interest</small><b>{compact(rec.interest)}</b></div></div></section>
      <section><h2>What to discuss with the lender</h2><div className="checklist">{['Request the exact revised repayment schedule.','Confirm revised EMI and total interest payable.','Ask about processing fees, documentation and other charges.','If a tenure extension is not suitable, discuss temporary payment relief as an alternative.','Confirm lender-specific documentation requirements before submission.'].map(x=><div key={x}><span>□</span>{x}</div>)}</div></section>
      <section><h2>Documents to take</h2><div className="docs"><Pill tone="green">SUPPLIED</Pill><span>Bank statements — last 6 months</span><span>Loan statements — all lenders</span><span>GST sales summary</span><span>Receivables aging list</span><Pill>ADDITIONAL</Pill><span>12-month cash-flow projection, if available</span></div></section>
      <div className="disclaimer"><ShieldCheck size={17}/><span>The restructuring improves base-case cash-flow headroom but does not eliminate downside risk. All figures are illustrative decision-support outputs based on supplied information and deterministic scenario calculations. RESTRUCTRA is not a lender, credit decision engine, approval, offer or guarantee. Actual restructuring terms depend on lender assessment and approval.</span></div>
    </div>
  </main>
}

function App(){
  const [page,setPage]=useState('landing');
  const [resultInput,setResultInput]=useState(null);
  const [assessment,setAssessment]=useState({data:demoData,mode:'demo'});
  const startNew=()=>{setResultInput(null);setAssessment({data:demoData,mode:'demo'});setPage('intake')};
  const liveMode=(import.meta.env.VITE_RESTRUCTRA_MODE||'demo').toLowerCase()==='live';
  return <><Header page={page} setPage={setPage}/><div className="modeBadge">{liveMode?'LIVE N8N DATA':'PROTOTYPE · BACKEND OFF'}</div>
    {page==='landing'&&<Landing setPage={setPage}/>} 
    {page==='intake'&&<Intake setPage={setPage} setResultInput={setResultInput}/>} 
    {page==='analysis'&&<Analysis setPage={setPage} resultInput={resultInput} onResult={setAssessment}/>} 
    {page==='dashboard'&&<Dashboard setPage={setPage} data={assessment.data}/>} 
    {page==='scenarios'&&<Scenarios data={assessment.data}/>} 
    {page==='bank'&&<Bank data={assessment.data}/>} 
    {page!=='landing'&&page!=='intake'&&<></>}
    <footer><button className="brandButton footerBrand" onClick={startNew}><Logo/></button><span>ASK SIMPLE. ANALYSE DEEPLY. EXPLAIN SIMPLY.</span><span>Illustrative decision support · © 2026</span></footer>
  </>
}

createRoot(document.getElementById('root')).render(<App/>);
