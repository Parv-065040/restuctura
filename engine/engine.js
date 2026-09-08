/**
 * RESTRUCTRA — Deterministic Financial Engine
 * ---------------------------------------------------------------
 * This file is the single source of truth for every numeric calculation
 * in RESTRUCTRA. It is intentionally framework-free (plain JS, no deps)
 * so the exact same functions can be:
 *   1. unit-tested here with Node directly (see tests/run_tests.js)
 *   2. pasted into n8n Code nodes verbatim (see workflows/*.json)
 *
 * HARD RULE: The LLM is NEVER allowed to compute a number. Every figure
 * that reaches the user must originate from a function in this file.
 */

'use strict';

// ---------------------------------------------------------------------
// 1. NORMALIZE + VALIDATE
// ---------------------------------------------------------------------

const CRITICAL_FIELDS = ['monthlySales', 'monthlyExpenses'];

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '' || v === "I don't know" || v === 'Not sure') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizeInput(raw) {
  const out = {
    business: {
      type: raw?.business?.type ?? null,
      monthlySales: toNumberOrNull(raw?.business?.monthlySales),
      monthlyExpenses: toNumberOrNull(raw?.business?.monthlyExpenses),
      customersPayingLate: raw?.business?.customersPayingLate ?? 'Not sure',
      receivablesAmount: toNumberOrNull(raw?.business?.receivablesAmount),
      incomeOutlook: raw?.business?.incomeOutlook ?? 'Not sure',
      cashReserve: toNumberOrNull(raw?.business?.cashReserve),
    },
    loans: Array.isArray(raw?.loans)
      ? raw.loans.map((l, i) => ({
          id: l.id || `loan_${i + 1}`,
          lender: l.lender ?? null,
          loanType: l.loanType ?? 'Don\'t know',
          outstandingAmount: toNumberOrNull(l.outstandingAmount),
          emi: toNumberOrNull(l.emi),
          remainingTenureMonths: normalizeTenure(l.remainingTenure, l.remainingTenureUnit),
          interestRatePct: toNumberOrNull(l.interestRatePct),
          secured: l.secured ?? null,
        }))
      : [],
    mainProblem: raw?.mainProblem ?? "I'm not sure",
    urgency: raw?.urgency ?? "I'm not sure",
    documents: Array.isArray(raw?.documents) ? raw.documents : [],
  };
  return out;
}

function normalizeTenure(value, unit) {
  const n = toNumberOrNull(value);
  if (n === null) return null;
  if (unit === 'years') return Math.round(n * 12);
  return Math.round(n); // default months
}

function validateInput(data) {
  const errors = [];
  const warnings = [];

  if (data.business.monthlySales === null) warnings.push({ field: 'monthlySales', message: 'Monthly sales not provided.' });
  if (data.business.monthlyExpenses === null) warnings.push({ field: 'monthlyExpenses', message: 'Monthly expenses not provided.' });
  if (data.business.monthlySales !== null && data.business.monthlySales < 0) errors.push({ field: 'monthlySales', message: 'Monthly sales cannot be negative.' });
  if (data.business.monthlyExpenses !== null && data.business.monthlyExpenses < 0) errors.push({ field: 'monthlyExpenses', message: 'Monthly expenses cannot be negative.' });

  if (!Array.isArray(data.loans) || data.loans.length === 0) {
    warnings.push({ field: 'loans', message: 'No loans provided.' });
  } else {
    data.loans.forEach((l) => {
      if (l.emi === null) warnings.push({ field: `${l.id}.emi`, message: `EMI missing for loan ${l.id}.` });
      if (l.outstandingAmount === null) warnings.push({ field: `${l.id}.outstandingAmount`, message: `Outstanding amount missing for loan ${l.id}.` });
      if (l.emi !== null && l.emi < 0) errors.push({ field: `${l.id}.emi`, message: 'EMI cannot be negative.' });
      if (l.outstandingAmount !== null && l.outstandingAmount < 0) errors.push({ field: `${l.id}.outstandingAmount`, message: 'Outstanding amount cannot be negative.' });
      if (l.interestRatePct !== null && (l.interestRatePct < 0 || l.interestRatePct > 60)) errors.push({ field: `${l.id}.interestRatePct`, message: 'Interest rate looks invalid.' });
    });
  }

  return { isValid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------
// 2. RECONCILIATION (user input vs. extracted document data)
// ---------------------------------------------------------------------

function reconcile(userData, extractedDoc) {
  // extractedDoc: { fields: [{field, value, source, confidence}], documentType, businessNameOnDoc }
  const conflicts = [];
  const confirmations = [];
  if (!extractedDoc || !Array.isArray(extractedDoc.fields)) {
    return { conflicts, confirmations, hasConflicts: false };
  }

  const TOLERANCE = 0.03; // 3% tolerance before flagging a conflict

  const userLookup = {
    monthlyEMI: sumEMI(userData.loans),
    totalOutstanding: sumOutstanding(userData.loans),
    monthlySales: userData.business.monthlySales,
  };

  extractedDoc.fields.forEach((f) => {
    if (!(f.field in userLookup)) return;
    const userValue = userLookup[f.field];
    const docValue = toNumberOrNull(f.value);
    if (userValue === null || docValue === null) return;

    const diffRatio = userValue === 0 ? (docValue === 0 ? 0 : 1) : Math.abs(userValue - docValue) / Math.abs(userValue);
    const record = {
      field: f.field,
      userValue,
      documentValue: docValue,
      source: f.source,
      confidence: f.confidence,
      diffPct: Math.round(diffRatio * 1000) / 10,
    };

    if (diffRatio > TOLERANCE) {
      conflicts.push({ ...record, status: 'CONFLICT', actionRequired: true });
    } else {
      confirmations.push({ ...record, status: 'CONFIRMED', actionRequired: false });
    }
  });

  return { conflicts, confirmations, hasConflicts: conflicts.length > 0 };
}

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

// ---------------------------------------------------------------------
// 3. FINANCIAL ENGINE (deterministic)
// ---------------------------------------------------------------------

function round2(n) {
  return n === null || n === undefined ? null : Math.round(n * 100) / 100;
}

function computeFinancials(data) {
  const sales = data.business.monthlySales;
  const expenses = data.business.monthlyExpenses;
  const loans = data.loans || [];

  const totalMonthlyEMI = sumEMI(loans);
  const totalOutstandingDebt = sumOutstanding(loans);
  const missingEMICount = loans.filter((l) => l.emi === null).length;

  const availableAfterExpenses = sales !== null && expenses !== null ? round2(sales - expenses) : null;
  const availableAfterEMI =
    availableAfterExpenses !== null && totalMonthlyEMI !== null ? round2(availableAfterExpenses - totalMonthlyEMI) : null;

  const internalDSCR =
    availableAfterExpenses !== null && totalMonthlyEMI ? round2(availableAfterExpenses / totalMonthlyEMI) : null;

  const emiToSalesRatio = sales && totalMonthlyEMI !== null ? round2(totalMonthlyEMI / sales) : null;

  const emiToAvailableRatio =
    availableAfterExpenses !== null && availableAfterExpenses > 0 && totalMonthlyEMI !== null
      ? round2(totalMonthlyEMI / availableAfterExpenses)
      : null;

  const cashReserve = data.business.cashReserve;

// Months of current EMI payments that the reported cash reserve could cover.
// This is NOT an operating-expense runway metric.
const cashReserveCoverageMonths =
  cashReserve !== null && totalMonthlyEMI > 0
    ? round2(cashReserve / totalMonthlyEMI)
    : null;

  const receivables = data.business.receivablesAmount;
  const receivablesRatio = receivables !== null && sales ? round2(receivables / sales) : null;

  // Debt concentration
  let debtConcentration = 'UNKNOWN';
  const knownOutstanding = loans.filter((l) => l.outstandingAmount !== null);
  if (loans.length === 1) debtConcentration = 'SINGLE_LOAN';
  else if (knownOutstanding.length >= 2 && totalOutstandingDebt) {
    const maxShare = Math.max(...knownOutstanding.map((l) => l.outstandingAmount)) / totalOutstandingDebt;
    debtConcentration = maxShare > 0.6 ? 'CONCENTRATED' : 'DISTRIBUTED';
  }

  // Weighted average interest rate (loans with known rate + outstanding only)
  const rated = loans.filter((l) => l.interestRatePct !== null && l.outstandingAmount !== null);
  let weightedAvgInterestRate = null;
  let interestRateAssumed = false;
  if (rated.length > 0) {
    const sumOut = rated.reduce((s, l) => s + l.outstandingAmount, 0);
    weightedAvgInterestRate = round2(rated.reduce((s, l) => s + l.outstandingAmount * l.interestRatePct, 0) / sumOut);
  } else {
    weightedAvgInterestRate = 14.0; // documented fallback assumption
    interestRateAssumed = true;
  }

  // Weighted average remaining tenure
  const tenured = loans.filter((l) => l.remainingTenureMonths !== null && l.outstandingAmount !== null);
  let weightedAvgTenureMonths = null;
  let tenureAssumed = false;
  if (tenured.length > 0) {
    const sumOut = tenured.reduce((s, l) => s + l.outstandingAmount, 0);
    weightedAvgTenureMonths = Math.round(
      tenured.reduce((s, l) => s + l.outstandingAmount * l.remainingTenureMonths, 0) / sumOut
    );
  } else {
    weightedAvgTenureMonths = 36; // documented fallback assumption
    tenureAssumed = true;
  }

  // Comfortable EMI range — illustrative safety-cushion calculation
  let comfortableEMIRange = null;
  if (availableAfterExpenses !== null && availableAfterExpenses > 0) {
    comfortableEMIRange = {
      lower: round2(availableAfterExpenses * 0.4),
      upper: round2(availableAfterExpenses * 0.55),
      basis:
        'Illustrative safety-cushion calculation: 40%-55% of estimated money left after business expenses. Not a lender-approved affordability limit.',
    };
  }

  return {
    totalMonthlyEMI,
    totalOutstandingDebt,
    missingEMICount,
    availableAfterExpenses,
    availableAfterEMI,
    internalDSCR,
    emiToSalesRatio,
    emiToAvailableRatio,
    cashReserveCoverageMonths,
    receivablesRatio,
    debtConcentration,
    weightedAvgInterestRate,
    interestRateAssumed,
    weightedAvgTenureMonths,
    tenureAssumed,
    comfortableEMIRange,
  };
}

// ---------------------------------------------------------------------
// 4. AMORTIZATION HELPERS (reducing balance, standard EMI formula)
// ---------------------------------------------------------------------

function emiForLoan(principal, annualRatePct, tenureMonths) {
  if (!principal || !tenureMonths) return null;
  const r = annualRatePct / 12 / 100;
  if (r === 0) return round2(principal / tenureMonths);
  const factor = Math.pow(1 + r, tenureMonths);
  return round2((principal * r * factor) / (factor - 1));
}

function totalRepayment(emi, months) {
  if (emi === null || !months) return null;
  return round2(emi * months);
}

// ---------------------------------------------------------------------
// 5. SCENARIO ENGINE
// ---------------------------------------------------------------------

const STRESS_ASSUMPTIONS = {
  stressRevenueChangePct: -20,
  recoveryRevenueChangePct: 15,
  expensesHeldConstant: true,
};

function availableUnderRevenueChange(sales, expenses, changePct) {
  if (sales === null || expenses === null) return null;
  const adjSales = sales * (1 + changePct / 100);
  return round2(adjSales - expenses);
}

function buildScenarios(data, fin) {
  const sales = data.business.monthlySales;
  const expenses = data.business.monthlyExpenses;
  const outstanding = fin.totalOutstandingDebt;
  const rate = fin.weightedAvgInterestRate;
  const tenure = fin.weightedAvgTenureMonths;
  const currentEMI = fin.totalMonthlyEMI;

  const availBase = fin.availableAfterExpenses;
  const availStress = availableUnderRevenueChange(sales, expenses, STRESS_ASSUMPTIONS.stressRevenueChangePct);
  const availRecovery = availableUnderRevenueChange(sales, expenses, STRESS_ASSUMPTIONS.recoveryRevenueChangePct);

  function testCase(emi, label) {
    if (emi === null) return null;
    return {
      base: availBase !== null ? round2(availBase - emi) : null,
      stress: availStress !== null ? round2(availStress - emi) : null,
      recovery: availRecovery !== null ? round2(availRecovery - emi) : null,
    };
  }

  const scenarios = {};

  // SCENARIO 0 — CURRENT
  scenarios.current = {
    label: 'Current repayment (no change)',
    emi: currentEMI,
    tenureMonths: tenure,
    estimatedRemainingRepayment: totalRepayment(currentEMI, tenure),
    monthlySurplusDeficit: testCase(currentEMI),
    note: 'Reflects the loan terms as currently reported.',
  };

  // SCENARIO A — LONGER REPAYMENT (default +50%, configurable +25/+50/+100)
  if (outstanding && tenure && rate !== null) {
    scenarios.longerRepayment = {};
    [0.25, 0.5, 1.0].forEach((extPct) => {
      const key = `extend_${Math.round(extPct * 100)}pct`;
      const newTenure = Math.round(tenure * (1 + extPct));
      const newEMI = emiForLoan(outstanding, rate, newTenure);
      scenarios.longerRepayment[key] = {
        label: `Extend remaining tenure by ${Math.round(extPct * 100)}%`,
        newTenureMonths: newTenure,
        newEMI,
        emiReduction: currentEMI !== null && newEMI !== null ? round2(currentEMI - newEMI) : null,
        estimatedAdditionalInterest:
          totalRepayment(newEMI, newTenure) !== null && totalRepayment(currentEMI, tenure) !== null
            ? round2(totalRepayment(newEMI, newTenure) - totalRepayment(currentEMI, tenure))
            : null,
        monthlySurplusDeficit: testCase(newEMI),
        disclaimer: 'Illustrative scenario only. Actual terms depend on lender approval.',
      };
    });
    scenarios.longerRepayment.default = 'extend_50pct';
  } else {
    scenarios.longerRepayment = { unavailable: true, reason: 'Insufficient data (outstanding amount, tenure, or interest rate missing).' };
  }

  // SCENARIO B — TEMPORARY RELIEF (3-month illustrative relief)
  if (outstanding && tenure && rate !== null) {
    const reliefMonths = 3;
    const monthlyRate = rate / 12 / 100;
    // Simple-interest accrual during relief added to principal; tenure extended by reliefMonths so EMI doesn't spike.
    const accruedInterest = round2(outstanding * monthlyRate * reliefMonths);
    const newPrincipal = round2(outstanding + accruedInterest);
    const postReliefTenure = tenure; // extended implicitly (total timeline = tenure + reliefMonths)
    const postReliefEMI = emiForLoan(newPrincipal, rate, postReliefTenure);
    scenarios.temporaryRelief = {
      label: `${reliefMonths}-month illustrative payment relief`,
      reliefMonths,
      paymentDuringRelief: 0,
      assumedInterestTreatment: 'Interest continues to accrue during relief and is added to outstanding principal.',
      accruedInterestDuringRelief: accruedInterest,
      postReliefEMI,
      postReliefTenureMonths: postReliefTenure,
      totalTimelineMonths: postReliefTenure + reliefMonths,
      monthlySurplusDeficitDuringRelief: testCase(0),
      monthlySurplusDeficitAfterRelief: testCase(postReliefEMI),
      disclaimer: 'Illustrative scenario only. The lender may or may not offer this exact structure.',
    };
  } else {
    scenarios.temporaryRelief = { unavailable: true, reason: 'Insufficient data (outstanding amount, tenure, or interest rate missing).' };
  }

  // SCENARIO C — STEP-DOWN / RECOVERY (6-month reduced EMI, then higher)
  if (outstanding && tenure && rate !== null && currentEMI !== null) {
    const stepMonths = 6;
    const reducedEMI = round2(currentEMI * 0.6);
    const principalPaidInStep = round2(reducedEMI * stepMonths); // simplified — not a true amortization split
    const monthlyRate = rate / 12 / 100;
    const interestDuringStep = round2(outstanding * monthlyRate * stepMonths);
    const remainingPrincipalAfterStep = round2(Math.max(outstanding + interestDuringStep - principalPaidInStep, 0));
    const remainingTenureAfterStep = Math.max(tenure - stepMonths, 1);
    const subsequentEMI = emiForLoan(remainingPrincipalAfterStep, rate, remainingTenureAfterStep);
    scenarios.stepDown = {
      label: `Reduced EMI for ${stepMonths} months, then step up`,
      stepMonths,
      reducedEMI,
      subsequentEMI,
      subsequentTenureMonths: remainingTenureAfterStep,
      totalTimelineMonths: stepMonths + remainingTenureAfterStep,
      monthlySurplusDeficitDuringStep: testCase(reducedEMI),
      monthlySurplusDeficitAfterStep: testCase(subsequentEMI),
      simplification: 'Principal/interest split during the step-down period is approximated, not a full amortization schedule.',
      disclaimer: 'Illustrative scenario only. Actual terms depend on lender approval.',
    };
  } else {
    scenarios.stepDown = { unavailable: true, reason: 'Insufficient data.' };
  }

  // SCENARIO D — CONSOLIDATION (only if 2+ loans, and only recommend if meaningfully beneficial)
  const loans = data.loans || [];
  if (loans.length >= 2) {
    const allHaveData = loans.every((l) => l.outstandingAmount !== null && l.interestRatePct !== null && l.remainingTenureMonths !== null);
    if (allHaveData) {
      const consolidatedTenure = Math.max(...loans.map((l) => l.remainingTenureMonths));
      const consolidatedEMI = emiForLoan(outstanding, rate, consolidatedTenure);
      const emiReductionPct = currentEMI ? round2(((currentEMI - consolidatedEMI) / currentEMI) * 100) : null;
      const meaningfullyBeneficial = emiReductionPct !== null && emiReductionPct >= 15;
      scenarios.consolidation = {
        label: 'Consolidate all loans into a single facility',
        consolidatedOutstanding: outstanding,
        consolidatedEMI,
        consolidatedTenureMonths: consolidatedTenure,
        emiReduction: currentEMI !== null ? round2(currentEMI - consolidatedEMI) : null,
        emiReductionPct,
        recommended: meaningfullyBeneficial,
        monthlySurplusDeficit: testCase(consolidatedEMI),
        note: meaningfullyBeneficial
          ? 'Calculated reduction is meaningful (>=15%). Presented as an option, not an automatic recommendation.'
          : 'Calculated benefit is not large enough to recommend consolidation on its own.',
        disclaimer: 'Illustrative scenario only. Actual consolidated terms depend on lender approval.',
      };
    } else {
      scenarios.consolidation = { unavailable: true, reason: 'Consolidation cannot be reliably assessed from the available information (missing rate/tenure/outstanding on at least one loan).' };
    }
  } else {
    scenarios.consolidation = { notApplicable: true, reason: 'Only one loan reported.' };
  }

  return { scenarios, stressAssumptions: STRESS_ASSUMPTIONS };
}

// ---------------------------------------------------------------------
// 6. STRESS DIAGNOSIS (deterministic classification)
// ---------------------------------------------------------------------

function diagnoseStress(data, fin, scenarioBundle) {
  const classifications = new Set();
  const {
  internalDSCR,
  cashReserveCoverageMonths,
  receivablesRatio,
  emiToAvailableRatio,
  weightedAvgInterestRate,
  interestRateAssumed
} = fin;
  const loans = data.loans || [];

  const dscrKnown = internalDSCR !== null;
  const bufferKnown = cashReserveCoverageMonths !== null;

  if (dscrKnown && internalDSCR >= 1.6 && (!bufferKnown || cashReserveCoverageMonths >= 2) && (receivablesRatio === null || receivablesRatio < 0.3)) {
    classifications.add('HEALTHY');
  } else if (dscrKnown && internalDSCR >= 1.15) {
    classifications.add('WATCH');
  }

  if (emiToAvailableRatio !== null && emiToAvailableRatio > 0.6) {
    classifications.add('HIGH_EMI_BURDEN');
  }

  if (receivablesRatio !== null && receivablesRatio > 0.35 && ['Yes', 'Sometimes'].includes(data.business.customersPayingLate)) {
    classifications.add('TEMPORARY_LIQUIDITY_STRESS');
  }

  if (data.mainProblem === 'My business is seasonal') {
    classifications.add('SEASONAL_CASH_FLOW_STRESS');
  }

  if (!interestRateAssumed && weightedAvgInterestRate !== null && weightedAvgInterestRate > 16) {
    classifications.add('HIGH_INTEREST_BURDEN');
  }

  if (loans.length >= 3) {
    classifications.add('MULTIPLE_LOAN_COMPLEXITY');
  }

  if (dscrKnown && internalDSCR < 1.0 && classifications.size === 0) {
    classifications.add('WATCH'); // safety net — never leave unclassified when data is thin but negative
  }

  // Structural check — uses scenario engine output.
  if (scenarioBundle && scenarioBundle.scenarios) {
    const s = scenarioBundle.scenarios;
    const candidateBaseValues = [];
    if (s.current?.monthlySurplusDeficit?.base !== undefined) candidateBaseValues.push(s.current.monthlySurplusDeficit.base);
    if (s.longerRepayment && !s.longerRepayment.unavailable) {
      Object.values(s.longerRepayment).forEach((v) => {
        if (v && typeof v === 'object' && v.monthlySurplusDeficit) candidateBaseValues.push(v.monthlySurplusDeficit.base);
      });
    }
    if (s.temporaryRelief && !s.temporaryRelief.unavailable) candidateBaseValues.push(s.temporaryRelief.monthlySurplusDeficitAfterRelief?.base);
    if (s.stepDown && !s.stepDown.unavailable) candidateBaseValues.push(s.stepDown.monthlySurplusDeficitAfterStep?.base);
    if (s.consolidation && !s.consolidation.unavailable && !s.consolidation.notApplicable) candidateBaseValues.push(s.consolidation.monthlySurplusDeficit?.base);

    const validCandidates = candidateBaseValues.filter((v) => v !== null && v !== undefined);
    if (validCandidates.length > 0) {
      const bestBase = Math.max(...validCandidates);
      if (bestBase < 0) {
        classifications.add('STRUCTURAL_CASH_FLOW_PROBLEM');
      }
    }
  }

  if (classifications.size === 0) classifications.add('WATCH');

  return Array.from(classifications);
}

// ---------------------------------------------------------------------
// 7. DATA CONFIDENCE SCORE
// ---------------------------------------------------------------------

function computeDataConfidence(data, validation, reconciliationResults, fin) {
  let score = 100;
  score -= validation.warnings.length * 8;
  const conflictCount = (reconciliationResults || []).reduce((s, r) => s + (r.conflicts ? r.conflicts.length : 0), 0);
  score -= conflictCount * 15;
  if (data.documents.length === 0) score -= 10;
  if (fin && fin.tenureAssumed) score -= 12;
  if (fin && fin.interestRateAssumed) score -= 12;
  if (fin && fin.missingEMICount > 0) score -= fin.missingEMICount * 10;
  // Cap confidence below absolute certainty.
// RESTRUCTRA provides decision support, not guaranteed financial truth.
score = Math.max(0, Math.min(95, score));

  let level = 'HIGH';
  if (score < 50) level = 'LOW';
  else if (score < 80) level = 'MEDIUM';

  return { score, level };
}

// ---------------------------------------------------------------------
// 8. AI OUTPUT VALIDATION (numeric-claim + schema checks — fail closed)
// ---------------------------------------------------------------------

function validateRecommendationOutput(aiJson, fin, scenarioBundle) {
  const errors = [];
  if (!aiJson || typeof aiJson !== 'object') return { valid: false, errors: ['AI output is not valid JSON.'] };

  if (!aiJson.primaryRecommendation) errors.push('Missing primaryRecommendation.');
  if (!Array.isArray(aiJson.alternativeOptions)) errors.push('Missing alternativeOptions array.');
  if (!Array.isArray(aiJson.notPreferredOptions)) errors.push('Missing notPreferredOptions array.');
  if (!aiJson.disclaimer || typeof aiJson.disclaimer !== 'string' || aiJson.disclaimer.length < 10) {
    errors.push('Missing or insufficient disclaimer.');
  }

  const bannedPhrases = ['guarantee', 'guaranteed', 'will be approved', 'assured approval', 'promise'];
  const allText = JSON.stringify(aiJson).toLowerCase();
  bannedPhrases.forEach((p) => {
    if (allText.includes(p)) errors.push(`AI output contains a disallowed guarantee-style phrase: "${p}".`);
  });

  // Numeric claim validation: every number the AI cites must trace back to engine output.
  const engineNumbers = collectEngineNumbers(fin, scenarioBundle);
  const citedNumbers = extractNumbersFromText(JSON.stringify(aiJson));
  const unverifiable = citedNumbers.filter((n) => !engineNumbers.some((e) => Math.abs(e - n) < Math.max(1, e * 0.01)));
  // Small integers (percentages, counts) are exempt from strict matching.
  const materialUnverifiable = unverifiable.filter((n) => n > 100);
  if (materialUnverifiable.length > 0) {
    errors.push(`AI output cites figures not found in engine output: ${materialUnverifiable.slice(0, 5).join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

function collectEngineNumbers(fin, scenarioBundle) {
  const nums = [];
  const push = (v) => { if (typeof v === 'number' && Number.isFinite(v)) nums.push(Math.round(v)); };
  Object.values(fin || {}).forEach((v) => push(v));
  if (fin?.comfortableEMIRange) { push(fin.comfortableEMIRange.lower); push(fin.comfortableEMIRange.upper); }
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    Object.values(obj).forEach((v) => {
      if (typeof v === 'number') push(v);
      else if (typeof v === 'object') walk(v);
    });
  };
  walk(scenarioBundle?.scenarios);
  return nums;
}

function extractNumbersFromText(text) {
  const matches = text.match(/-?\d{3,}(\.\d+)?/g) || [];
  return matches.map((m) => Math.round(Number(m))).filter((n) => Number.isFinite(n));
}

// (computeDataConfidence signature: data, validation, reconciliationResults, fin)

module.exports = {
  normalizeInput,
  validateInput,
  reconcile,
  computeFinancials,
  buildScenarios,
  diagnoseStress,
  computeDataConfidence,
  validateRecommendationOutput,
  emiForLoan,
  STRESS_ASSUMPTIONS,
};
