'use strict';
const fs = require('fs');
const path = require('path');
const engine = require('../engine/engine.js');

function runPipeline(raw) {
  const data = engine.normalizeInput(raw);
  const validation = engine.validateInput(data);
  if (!validation.isValid) {
    return { fatal: true, validation };
  }

  const reconciliationResults = (data.documents || []).map((doc) => engine.reconcile(data, doc));

  const fin = engine.computeFinancials(data);
  const scenarioBundle = engine.buildScenarios(data, fin);
  const classifications = engine.diagnoseStress(data, fin, scenarioBundle);
  const dataConfidence = engine.computeDataConfidence(data, validation, reconciliationResults, fin);

  return { data, validation, reconciliationResults, fin, scenarioBundle, classifications, dataConfidence };
}

const fixturesDir = path.join(__dirname, 'fixtures');
const files = fs.readdirSync(fixturesDir).sort();

const expectations = {
  'test1_healthy.json': (r) => {
    assertTrue(r.classifications.includes('HEALTHY'), 'expected HEALTHY');
    assertTrue(!r.classifications.includes('STRUCTURAL_CASH_FLOW_PROBLEM'), 'should not be structural');
  },
  'test2_temporary_liquidity_stress.json': (r) => {
    assertTrue(r.classifications.includes('TEMPORARY_LIQUIDITY_STRESS'), 'expected TEMPORARY_LIQUIDITY_STRESS');
  },
  'test3_high_emi_viable.json': (r) => {
    assertTrue(r.classifications.includes('HIGH_EMI_BURDEN'), 'expected HIGH_EMI_BURDEN');
    assertTrue(r.scenarioBundle.scenarios.longerRepayment.extend_50pct.monthlySurplusDeficit.base > 0,
      'tenure extension should restore positive cash flow (viable business)');
  },
  'test4_multiple_loans.json': (r) => {
    assertTrue(r.classifications.includes('MULTIPLE_LOAN_COMPLEXITY'), 'expected MULTIPLE_LOAN_COMPLEXITY');
    assertTrue(r.scenarioBundle.scenarios.consolidation.unavailable !== true, 'consolidation should be evaluable');
    assertTrue(typeof r.scenarioBundle.scenarios.consolidation.recommended === 'boolean',
      'consolidation must carry an explicit recommended flag, never assumed true');
  },
  'test5_structural_problem.json': (r) => {
    assertTrue(r.classifications.includes('STRUCTURAL_CASH_FLOW_PROBLEM'), 'expected STRUCTURAL_CASH_FLOW_PROBLEM');
  },
  'test6_missing_tenure.json': (r) => {
    assertTrue(r.fin.tenureAssumed === true, 'tenure should be flagged as assumed');
    assertTrue(r.fin.interestRateAssumed === true, 'interest rate should be flagged as assumed');
    assertTrue(r.dataConfidence.level !== 'HIGH', 'confidence should be degraded when key loan terms are missing');
  },
  'test7_missing_optional_documents.json': (r) => {
    assertTrue(!r.fatal, 'pipeline must not fail when documents are absent');
    assertTrue(Array.isArray(r.reconciliationResults) && r.reconciliationResults.length === 0, 'no reconciliation needed without documents');
  },
  'test8_user_document_conflict.json': (r) => {
    assertTrue(r.reconciliationResults[0].hasConflicts === true, 'expected a reconciliation conflict');
    const emiConflict = r.reconciliationResults[0].conflicts.find((c) => c.field === 'monthlyEMI');
    assertTrue(!!emiConflict, 'expected monthlyEMI conflict specifically');
    assertTrue(emiConflict.userValue === 138500 && emiConflict.documentValue === 145000, 'conflict values must match input exactly');
  },
  'test9_unreadable_document.json': (r) => {
    assertTrue(!r.fatal, 'pipeline must not crash on an unreadable document');
    assertTrue(r.reconciliationResults[0].hasConflicts === false, 'no conflicts possible with zero extracted fields');
  },
  'test10_sharp_revenue_decline.json': (r) => {
    assertTrue(
      r.classifications.includes('HIGH_EMI_BURDEN') || r.classifications.includes('STRUCTURAL_CASH_FLOW_PROBLEM'),
      'sharp revenue decline should trigger a worse classification'
    );
  },
};

let pass = 0, fail = 0;
const results = {};

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg);
}

files.forEach((file) => {
  const raw = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
  let result, error = null;
  try {
    result = runPipeline(raw);
    if (expectations[file]) expectations[file](result);
  } catch (e) {
    error = e.message;
  }
  results[file] = { result, error };
  if (error) {
    fail++;
    console.log(`FAIL  ${file} -> ${error}`);
  } else {
    pass++;
    console.log(`PASS  ${file}` + (result.classifications ? `  [${result.classifications.join(', ')}]` : ''));
  }
});

console.log(`\n${pass} passed, ${fail} failed out of ${files.length}`);

fs.writeFileSync(
  path.join(__dirname, 'actual_results.json'),
  JSON.stringify(
    Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.error ? { error: v.error } : v.result])),
    null,
    2
  )
);

process.exit(fail > 0 ? 1 : 0);
