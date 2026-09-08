import demoRequest from '../data_demo.json';
import finalResponse from '../final_response.json';

export const demoData = {
  businessName:'Shree Balaji Engineering Works', analysisDate:'2026-09-03',
  financialHealth:{monthlySales:2000000,monthlyExpenses:1680000,cashReserve:350000,receivables:950000,totalMonthlyEMI:138500,totalOutstandingDebt:4600000,availableAfterExpenses:320000,availableAfterEMI:181500,internalDSCR:2.31,emiToSalesRatio:.07,emiToAvailableRatio:.43,cashReserveCoverageMonths:2.53,receivablesRatio:.48,weightedAvgInterestRate:13.96,weightedAvgTenureMonths:33,debtConcentration:'CONCENTRATED'},
  stress:{current:181500,stress:-218500,recovery:481500},
  recommended:{newEMI:121855.45,emiReduction:16644.55,newTenure:50,base:198144.55,stress:-201855.45,interest:1522272.5},
  scenarios:{current:{label:'Current repayment',emi:138500,tenure:33,base:181500,stress:-218500},extend25:{label:'25% tenure extension',emi:141709.98,tenure:41,base:178290.02,stress:-221709.98,interest:1239609.18},extend50:{label:'50% tenure extension',emi:121855.45,tenure:50,base:198144.55,stress:-201855.45,interest:1522272.5},extend100:{label:'100% tenure extension',emi:100229.85,tenure:66,base:219770.15,stress:-180229.85,interest:2044670.1},relief:{label:'3-month payment relief',emi:0,tenure:36,base:320000,stress:-80000,postEMI:174543.99,interest:160540},step:{label:'6-month step-down',emi:83100,tenure:33,base:236900,stress:-163100,postEMI:191807.27},consolidation:{label:'Loan consolidation',emi:157127.74,tenure:36,base:162872.26,stress:-237127.74}},
  loans:[['HDFC Bank','Business loan',2800000,78500,36,'13.5%','Secured'],['Bajaj Finserv','Machinery / equipment',1200000,42000,30,'15%','Secured'],['ICICI Bank','Cash credit / overdraft',600000,18000,24,'14%','Unsecured']]
};

function normalizeFinalAssembly(payload){
  const root=Array.isArray(payload)?payload[0]:payload;
  if(!root) throw new Error('Empty response from RESTRUCTRA');
  if(root.status && root.status!=='SUCCESS') throw new Error(root.userMessage||'Assessment could not be completed');

  const h=root.dashboard?.financialHealth || root.financialSnapshot || {};
  const bundle=root.scenarios?.scenarios || root.scenarioBundle?.scenarios || {};
  const bank=root.bankReport || {};
  const snap=bank.currentFinancialSnapshot || root.financialSnapshot || {};
  const recScenario=root.dashboard?.restructuring?.recommendedScenario || bundle.extend_50pct || {};

  const mapScenario=(x={})=>({
    label:x.label||'Scenario',
    emi:x.emi ?? x.newEMI ?? x.paymentDuringRelief ?? x.reducedEMI ?? x.consolidatedEMI ?? 0,
    tenure:x.tenureMonths ?? x.newTenureMonths ?? x.totalTimelineMonths ?? x.consolidatedTenureMonths ?? null,
    base:x.monthlySurplusDeficit?.base ?? x.monthlySurplusDeficitDuringRelief?.base ?? x.monthlySurplusDeficitDuringStep?.base ?? x.monthlySurplusDeficitAfterRelief?.base ?? x.monthlySurplusDeficitAfterStep?.base ?? 0,
    stress:x.monthlySurplusDeficit?.stress ?? x.monthlySurplusDeficitDuringRelief?.stress ?? x.monthlySurplusDeficitDuringStep?.stress ?? x.monthlySurplusDeficitAfterRelief?.stress ?? x.monthlySurplusDeficitAfterStep?.stress ?? 0,
    recovery:x.monthlySurplusDeficit?.recovery ?? x.monthlySurplusDeficitDuringRelief?.recovery ?? x.monthlySurplusDeficitDuringStep?.recovery ?? x.monthlySurplusDeficitAfterRelief?.recovery ?? x.monthlySurplusDeficitAfterStep?.recovery ?? 0,
    interest:x.estimatedAdditionalInterest ?? x.accruedInterestDuringRelief ?? null,
    raw:x
  });

  const scenarios={
    current:mapScenario(bundle.current),
    extend25:mapScenario(bundle.longerRepayment?.extend_25pct),
    extend50:mapScenario(bundle.longerRepayment?.extend_50pct),
    extend100:mapScenario(bundle.longerRepayment?.extend_100pct),
    relief:mapScenario(bundle.temporaryRelief),
    step:mapScenario(bundle.stepDown),
    consolidation:mapScenario(bundle.consolidation)
  };

  const primary=root.recommendation?.primaryRecommendation || {};
  const hWithFallback={...h,
    monthlySales:h.monthlySales ?? snap.monthlySales,
    monthlyExpenses:h.monthlyExpenses ?? snap.monthlyExpenses,
    cashReserve:h.cashReserve ?? snap.cashReserve,
    receivables:h.receivables ?? snap.receivables,
  };

  return {
    businessName:root.business?.name||root.dashboard?.businessName||bank.businessName||'Business',
    analysisDate:root.business?.analysisDate||root.dashboard?.analysisDate||bank.date||new Date().toISOString().slice(0,10),
    financialHealth:hWithFallback,
    stress:{
      current:scenarios.current.base,
      stress:scenarios.current.stress,
      recovery:scenarios.current.recovery,
      classifications:root.classifications||root.dashboard?.stressDiagnosis?.classifications||[],
      stressRevenueChangePct:root.scenarios?.stressAssumptions?.stressRevenueChangePct ?? -20,
      recoveryRevenueChangePct:root.scenarios?.stressAssumptions?.recoveryRevenueChangePct ?? 15
    },
    recommended:{
      title:primary.title || 'Extend loan tenure by 50%',
      newEMI:recScenario.newEMI ?? scenarios.extend50.emi,
      emiReduction:recScenario.emiReduction ?? scenarios.extend50.raw?.emiReduction,
      newTenure:recScenario.newTenureMonths ?? scenarios.extend50.tenure,
      base:recScenario.monthlySurplusDeficit?.base ?? scenarios.extend50.base,
      stress:recScenario.monthlySurplusDeficit?.stress ?? scenarios.extend50.stress,
      interest:recScenario.estimatedAdditionalInterest ?? scenarios.extend50.interest
    },
    recommendation:root.recommendation||{},
    bankReport:bank,
    reconciliation:root.reconciliation||{},
    classifications:root.classifications||[],
    dataConfidence:root.dataConfidence||{},
    scenarios,
    loans:(snap.loans||[]).map(l=>[l.lender,l.loanType||'Business loan',l.outstandingAmount,l.emi,l.remainingTenureMonths,l.interestRatePct!=null?`${l.interestRatePct}%`:'—',l.secured||'—']),
    raw:root
  };
}
export function buildAssessmentRequest(form){
  return {
    businessName: form.companyName || null,
    business: {
      type: form.businessType || null,
      monthlySales: form.monthlySales,
      monthlyExpenses: form.monthlyExpenses,
      customersPayingLate: form.customersPayingLate || 'Not sure',
      receivablesAmount: form.receivablesAmount,
      incomeOutlook: form.incomeOutlook || 'Not sure',
      cashReserve: form.cashReserve,
    },
    loans: (form.loans || []).map(l => ({
      id: l.id,
      lender: l.lender || null,
      loanType: l.loanType || "Don't know",
      outstandingAmount: l.outstandingAmount,
      emi: l.emi,
      remainingTenure: l.remainingTenure,
      remainingTenureUnit: 'months',
      interestRatePct: l.interestRatePct,
      secured: l.secured || null,
    })),
    mainProblem: form.mainProblem || "I'm not sure",
    urgency: form.urgency || "I'm not sure",
    // Current workflow accepts already-extracted document objects.
    // The browser UI currently sends staged metadata only; extraction is a backend step.
    documents: (form.documents || []).map(d => ({
      fileName: d.name,
      documentType: d.documentType || 'unknown',
      mimeType: d.type,
      size: d.size,
      extractionStatus: 'PENDING_BACKEND_EXTRACTION'
    }))
  };
}

export async function getAssessment(request=demoRequest, files=[]){
  const mode=(import.meta.env.VITE_RESTRUCTRA_MODE || 'demo').toLowerCase();
  if(mode !== 'live') return {data:normalizeFinalAssembly(finalResponse),mode:'demo'};

  const url=import.meta.env.VITE_N8N_WEBHOOK_URL;
  if(!url) throw new Error('Live mode is enabled but VITE_N8N_WEBHOOK_URL is missing.');

  const formData=new FormData();
  formData.append('payload', JSON.stringify(request));
  (files || []).forEach(file => formData.append('documents', file, file.name));

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(), 120000);
  try{
    const res=await fetch(url,{method:'POST',headers:{'Accept':'application/json'},body:formData,signal:controller.signal});
    const text=await res.text();
    let payload; try{payload=JSON.parse(text)}catch{throw new Error(`n8n returned non-JSON (${res.status})`)}
    if(!res.ok) throw new Error(payload?.userMessage||payload?.message||`n8n request failed (${res.status})`);
    return {data:normalizeFinalAssembly(payload),mode:'live'};
  }catch(err){
    if(err?.name==='AbortError') throw new Error('The analysis took longer than 2 minutes. No automatic retry was made.');
    throw err;
  }finally{clearTimeout(timeout)}
}

export {demoRequest};
