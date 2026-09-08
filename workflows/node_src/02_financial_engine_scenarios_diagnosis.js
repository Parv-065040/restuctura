// n8n Code node — "04-06: Financial Engine, Scenario Engine, Stress Diagnosis"
// All figures here are DETERMINISTIC. The LLM downstream is only allowed to
// explain these numbers in simple language — never to invent or recompute them.

const input = $input.first().json;
const data = input.data;
const validation = input.validation;
const reconciliationResults = input.reconciliationResults;

function round2(n) { return n === null || n === undefined ? null : Math.round(n * 100) / 100; }
function sumEMI(loans) {
  const known = (loans || []).filter((l) => l.emi !== null);
  if (known.length === 0) return null;
  return known.reduce((s, l) => s + l.emi, 0);
}
function sumOutstanding(loans) {
  const known = (loans || []).filter((l) => l.outstandingAmount !== null);
  if (known.length === 0) return null;
  return known.reduce((s, l) => s + l.outstandingAmount, 0);
}

function computeFinancials(data) {
  const sales = data.business.monthlySales;
  const expenses = data.business.monthlyExpenses;
  const loans = data.loans || [];
  const totalMonthlyEMI = sumEMI(loans);
  const totalOutstandingDebt = sumOutstanding(loans);
  const missingEMICount = loans.filter((l) => l.emi === null).length;
  const availableAfterExpenses = sales !== null && expenses !== null ? round2(sales - expenses) : null;
  const availableAfterEMI = availableAfterExpenses !== null && totalMonthlyEMI !== null ? round2(availableAfterExpenses - totalMonthlyEMI) : null;
  const internalDSCR = availableAfterExpenses !== null && totalMonthlyEMI ? round2(availableAfterExpenses / totalMonthlyEMI) : null;
  const emiToSalesRatio = sales && totalMonthlyEMI !== null ? round2(totalMonthlyEMI / sales) : null;
  const emiToAvailableRatio = availableAfterExpenses !== null && availableAfterExpenses > 0 && totalMonthlyEMI !== null ? round2(totalMonthlyEMI / availableAfterExpenses) : null;
  const cashReserve = data.business.cashReserve;
  const cashBufferMonths = cashReserve !== null && totalMonthlyEMI ? round2(cashReserve / totalMonthlyEMI) : null;
  const receivables = data.business.receivablesAmount;
  const receivablesRatio = receivables !== null && sales ? round2(receivables / sales) : null;

  let debtConcentration = 'UNKNOWN';
  const knownOutstanding = loans.filter((l) => l.outstandingAmount !== null);
  if (loans.length === 1) debtConcentration = 'SINGLE_LOAN';
  else if (knownOutstanding.length >= 2 && totalOutstandingDebt) {
    const maxShare = Math.max(...knownOutstanding.map((l) => l.outstandingAmount)) / totalOutstandingDebt;
    debtConcentration = maxShare > 0.6 ? 'CONCENTRATED' : 'DISTRIBUTED';
  }

  const rated = loans.filter((l) => l.interestRatePct !== null && l.outstandingAmount !== null);
  let weightedAvgInterestRate = null, interestRateAssumed = false;
  if (rated.length > 0) {
    const sumOut = rated.reduce((s, l) => s + l.outstandingAmount, 0);
    weightedAvgInterestRate = round2(rated.reduce((s, l) => s + l.outstandingAmount * l.interestRatePct, 0) / sumOut);
  } else { weightedAvgInterestRate = 14.0; interestRateAssumed = true; }

  const tenured = loans.filter((l) => l.remainingTenureMonths !== null && l.outstandingAmount !== null);
  let weightedAvgTenureMonths = null, tenureAssumed = false;
  if (tenured.length > 0) {
    const sumOut = tenured.reduce((s, l) => s + l.outstandingAmount, 0);
    weightedAvgTenureMonths = Math.round(tenured.reduce((s, l) => s + l.outstandingAmount * l.remainingTenureMonths, 0) / sumOut);
  } else { weightedAvgTenureMonths = 36; tenureAssumed = true; }

  let comfortableEMIRange = null;
  if (availableAfterExpenses !== null && availableAfterExpenses > 0) {
    comfortableEMIRange = {
      lower: round2(availableAfterExpenses * 0.4),
      upper: round2(availableAfterExpenses * 0.55),
      basis: 'Illustrative safety-cushion calculation: 40%-55% of estimated money left after business expenses. Not a lender-approved affordability limit.',
    };
  }

  return { totalMonthlyEMI, totalOutstandingDebt, missingEMICount, availableAfterExpenses, availableAfterEMI, internalDSCR, emiToSalesRatio, emiToAvailableRatio, cashBufferMonths, receivablesRatio, debtConcentration, weightedAvgInterestRate, interestRateAssumed, weightedAvgTenureMonths, tenureAssumed, comfortableEMIRange };
}

function emiForLoan(principal, annualRatePct, tenureMonths) {
  if (!principal || !tenureMonths) return null;
  const r = annualRatePct / 12 / 100;
  if (r === 0) return round2(principal / tenureMonths);
  const factor = Math.pow(1 + r, tenureMonths);
  return round2((principal * r * factor) / (factor - 1));
}
function totalRepayment(emi, months) { if (emi === null || !months) return null; return round2(emi * months); }

const STRESS_ASSUMPTIONS = { stressRevenueChangePct: -20, recoveryRevenueChangePct: 15, expensesHeldConstant: true };
function availableUnderRevenueChange(sales, expenses, changePct) {
  if (sales === null || expenses === null) return null;
  return round2(sales * (1 + changePct / 100) - expenses);
}

function buildScenarios(data, fin) {
  const sales = data.business.monthlySales, expenses = data.business.monthlyExpenses;
  const outstanding = fin.totalOutstandingDebt, rate = fin.weightedAvgInterestRate, tenure = fin.weightedAvgTenureMonths, currentEMI = fin.totalMonthlyEMI;
  const availBase = fin.availableAfterExpenses;
  const availStress = availableUnderRevenueChange(sales, expenses, STRESS_ASSUMPTIONS.stressRevenueChangePct);
  const availRecovery = availableUnderRevenueChange(sales, expenses, STRESS_ASSUMPTIONS.recoveryRevenueChangePct);
  function testCase(emi) {
    if (emi === null) return null;
    return { base: availBase !== null ? round2(availBase - emi) : null, stress: availStress !== null ? round2(availStress - emi) : null, recovery: availRecovery !== null ? round2(availRecovery - emi) : null };
  }

  const scenarios = {};
  scenarios.current = { label: 'Current repayment (no change)', emi: currentEMI, tenureMonths: tenure, estimatedRemainingRepayment: totalRepayment(currentEMI, tenure), monthlySurplusDeficit: testCase(currentEMI), note: 'Reflects the loan terms as currently reported.' };

  if (outstanding && tenure && rate !== null) {
    scenarios.longerRepayment = {};
    [0.25, 0.5, 1.0].forEach((extPct) => {
      const key = `extend_${Math.round(extPct * 100)}pct`;
      const newTenure = Math.round(tenure * (1 + extPct));
      const newEMI = emiForLoan(outstanding, rate, newTenure);
      scenarios.longerRepayment[key] = {
        label: `Extend remaining tenure by ${Math.round(extPct * 100)}%`,
        newTenureMonths: newTenure, newEMI,
        emiReduction: currentEMI !== null && newEMI !== null ? round2(currentEMI - newEMI) : null,
        estimatedAdditionalInterest: totalRepayment(newEMI, newTenure) !== null && totalRepayment(currentEMI, tenure) !== null ? round2(totalRepayment(newEMI, newTenure) - totalRepayment(currentEMI, tenure)) : null,
        monthlySurplusDeficit: testCase(newEMI),
        disclaimer: 'Illustrative scenario only. Actual terms depend on lender approval.',
      };
    });
    scenarios.longerRepayment.default = 'extend_50pct';
  } else scenarios.longerRepayment = { unavailable: true, reason: 'Insufficient data (outstanding amount, tenure, or interest rate missing).' };

  if (outstanding && tenure && rate !== null) {
    const reliefMonths = 3, monthlyRate = rate / 12 / 100;
    const accruedInterest = round2(outstanding * monthlyRate * reliefMonths);
    const newPrincipal = round2(outstanding + accruedInterest);
    const postReliefEMI = emiForLoan(newPrincipal, rate, tenure);
    scenarios.temporaryRelief = {
      label: `${reliefMonths}-month illustrative payment relief`, reliefMonths, paymentDuringRelief: 0,
      assumedInterestTreatment: 'Interest continues to accrue during relief and is added to outstanding principal.',
      accruedInterestDuringRelief: accruedInterest, postReliefEMI, postReliefTenureMonths: tenure,
      totalTimelineMonths: tenure + reliefMonths,
      monthlySurplusDeficitDuringRelief: testCase(0),
      monthlySurplusDeficitAfterRelief: testCase(postReliefEMI),
      disclaimer: 'Illustrative scenario only. The lender may or may not offer this exact structure.',
    };
  } else scenarios.temporaryRelief = { unavailable: true, reason: 'Insufficient data (outstanding amount, tenure, or interest rate missing).' };

  if (outstanding && tenure && rate !== null && currentEMI !== null) {
    const stepMonths = 6, reducedEMI = round2(currentEMI * 0.6);
    const principalPaidInStep = round2(reducedEMI * stepMonths);
    const monthlyRate = rate / 12 / 100;
    const interestDuringStep = round2(outstanding * monthlyRate * stepMonths);
    const remainingPrincipalAfterStep = round2(Math.max(outstanding + interestDuringStep - principalPaidInStep, 0));
    const remainingTenureAfterStep = Math.max(tenure - stepMonths, 1);
    const subsequentEMI = emiForLoan(remainingPrincipalAfterStep, rate, remainingTenureAfterStep);
    scenarios.stepDown = {
      label: `Reduced EMI for ${stepMonths} months, then step up`, stepMonths, reducedEMI, subsequentEMI,
      subsequentTenureMonths: remainingTenureAfterStep, totalTimelineMonths: stepMonths + remainingTenureAfterStep,
      monthlySurplusDeficitDuringStep: testCase(reducedEMI), monthlySurplusDeficitAfterStep: testCase(subsequentEMI),
      simplification: 'Principal/interest split during the step-down period is approximated, not a full amortization schedule.',
      disclaimer: 'Illustrative scenario only. Actual terms depend on lender approval.',
    };
  } else scenarios.stepDown = { unavailable: true, reason: 'Insufficient data.' };

  const loans = data.loans || [];
  if (loans.length >= 2) {
    const allHaveData = loans.every((l) => l.outstandingAmount !== null && l.interestRatePct !== null && l.remainingTenureMonths !== null);
    if (allHaveData) {
      const consolidatedTenure = Math.max(...loans.map((l) => l.remainingTenureMonths));
      const consolidatedEMI = emiForLoan(outstanding, rate, consolidatedTenure);
      const emiReductionPct = currentEMI ? round2(((currentEMI - consolidatedEMI) / currentEMI) * 100) : null;
      const meaningfullyBeneficial = emiReductionPct !== null && emiReductionPct >= 15;
      scenarios.consolidation = {
        label: 'Consolidate all loans into a single facility', consolidatedOutstanding: outstanding, consolidatedEMI,
        consolidatedTenureMonths: consolidatedTenure, emiReduction: currentEMI !== null ? round2(currentEMI - consolidatedEMI) : null,
        emiReductionPct, recommended: meaningfullyBeneficial, monthlySurplusDeficit: testCase(consolidatedEMI),
        note: meaningfullyBeneficial ? 'Calculated reduction is meaningful (>=15%). Presented as an option, not an automatic recommendation.' : 'Calculated benefit is not large enough to recommend consolidation on its own.',
        disclaimer: 'Illustrative scenario only. Actual consolidated terms depend on lender approval.',
      };
    } else scenarios.consolidation = { unavailable: true, reason: 'Consolidation cannot be reliably assessed from the available information (missing rate/tenure/outstanding on at least one loan).' };
  } else scenarios.consolidation = { notApplicable: true, reason: 'Only one loan reported.' };

  return { scenarios, stressAssumptions: STRESS_ASSUMPTIONS };
}

function diagnoseStress(data, fin, scenarioBundle) {
  const classifications = new Set();
  const { internalDSCR, cashBufferMonths, receivablesRatio, emiToAvailableRatio, weightedAvgInterestRate, interestRateAssumed } = fin;
  const loans = data.loans || [];
  const dscrKnown = internalDSCR !== null, bufferKnown = cashBufferMonths !== null;

  if (dscrKnown && internalDSCR >= 1.6 && (!bufferKnown || cashBufferMonths >= 2) && (receivablesRatio === null || receivablesRatio < 0.3)) classifications.add('HEALTHY');
  else if (dscrKnown && internalDSCR >= 1.15) classifications.add('WATCH');

  if (emiToAvailableRatio !== null && emiToAvailableRatio > 0.6) classifications.add('HIGH_EMI_BURDEN');
  if (receivablesRatio !== null && receivablesRatio > 0.35 && ['Yes', 'Sometimes'].includes(data.business.customersPayingLate)) classifications.add('TEMPORARY_LIQUIDITY_STRESS');
  if (data.mainProblem === 'My business is seasonal') classifications.add('SEASONAL_CASH_FLOW_STRESS');
  if (!interestRateAssumed && weightedAvgInterestRate !== null && weightedAvgInterestRate > 16) classifications.add('HIGH_INTEREST_BURDEN');
  if (loans.length >= 3) classifications.add('MULTIPLE_LOAN_COMPLEXITY');
  if (dscrKnown && internalDSCR < 1.0 && classifications.size === 0) classifications.add('WATCH');

  if (scenarioBundle && scenarioBundle.scenarios) {
    const s = scenarioBundle.scenarios;
    const candidateBaseValues = [];
    if (s.current?.monthlySurplusDeficit?.base !== undefined) candidateBaseValues.push(s.current.monthlySurplusDeficit.base);
    if (s.longerRepayment && !s.longerRepayment.unavailable) Object.values(s.longerRepayment).forEach((v) => { if (v && typeof v === 'object' && v.monthlySurplusDeficit) candidateBaseValues.push(v.monthlySurplusDeficit.base); });
    if (s.temporaryRelief && !s.temporaryRelief.unavailable) candidateBaseValues.push(s.temporaryRelief.monthlySurplusDeficitAfterRelief?.base);
    if (s.stepDown && !s.stepDown.unavailable) candidateBaseValues.push(s.stepDown.monthlySurplusDeficitAfterStep?.base);
    if (s.consolidation && !s.consolidation.unavailable && !s.consolidation.notApplicable) candidateBaseValues.push(s.consolidation.monthlySurplusDeficit?.base);
    const validCandidates = candidateBaseValues.filter((v) => v !== null && v !== undefined);
    if (validCandidates.length > 0 && Math.max(...validCandidates) < 0) classifications.add('STRUCTURAL_CASH_FLOW_PROBLEM');
  }

  if (classifications.size === 0) classifications.add('WATCH');
  return Array.from(classifications);
}

function computeDataConfidence(data, validation, reconciliationResults, fin) {
  let score = 100;
  score -= validation.warnings.length * 8;
  const conflictCount = (reconciliationResults || []).reduce((s, r) => s + (r.conflicts ? r.conflicts.length : 0), 0);
  score -= conflictCount * 15;
  if (data.documents.length === 0) score -= 10;
  if (fin.tenureAssumed) score -= 12;
  if (fin.interestRateAssumed) score -= 12;
  if (fin.missingEMICount > 0) score -= fin.missingEMICount * 10;
  score = Math.max(0, Math.min(100, score));
  let level = 'HIGH';
  if (score < 50) level = 'LOW'; else if (score < 80) level = 'MEDIUM';
  return { score, level };
}

const fin = computeFinancials(data);
const scenarioBundle = buildScenarios(data, fin);
const classifications = diagnoseStress(data, fin, scenarioBundle);
const dataConfidence = computeDataConfidence(data, validation, reconciliationResults, fin);

return [{ json: { data, validation, reconciliationResults, fin, scenarioBundle, classifications, dataConfidence } }];
