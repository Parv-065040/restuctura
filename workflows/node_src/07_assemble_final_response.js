// n8n Code node — "Assemble Final Response"

const input = $input.first().json;
const { data, fin, reconciliationResults, classifications, dataConfidence, recommendation, bankReport } = input;
// Defensive fallbacks: this node runs directly after "Validate & Parse Bank
// Report" (no HTTP node in between), so these should always be present —
// but we never assume it, per the fail-closed requirement.
const safeFin = fin || {};
const safeReconciliation = Array.isArray(reconciliationResults) ? reconciliationResults : [];
const safeClassifications = Array.isArray(classifications) ? classifications : [];

const FRIENDLY_LABELS = {
  HEALTHY: 'Your business appears financially healthy',
  WATCH: 'Manageable now, but your safety cushion is limited',
  TEMPORARY_LIQUIDITY_STRESS: 'Cash timing / customer payment delays are creating pressure',
  HIGH_EMI_BURDEN: 'Your monthly loan payments are consuming too much of your available cash',
  SEASONAL_CASH_FLOW_STRESS: 'Your business income varies significantly by season',
  HIGH_INTEREST_BURDEN: 'High interest costs are adding to your repayment pressure',
  MULTIPLE_LOAN_COMPLEXITY: 'Multiple loans are adding complexity to your repayments',
  STRUCTURAL_CASH_FLOW_PROBLEM: 'Restructuring alone may not fully solve the underlying cash-flow problem',
};

const dashboard = {
  monthlySales: data?.business?.monthlySales ?? null,
  monthlyBusinessExpenses: data?.business?.monthlyExpenses ?? null,
  monthlyLoanPayments: safeFin.totalMonthlyEMI ?? null,
  estimatedMoneyLeftAfterExpenses: safeFin.availableAfterExpenses ?? null,
  estimatedMoneyLeftAfterLoanPayments: safeFin.availableAfterEMI ?? null,
  totalLoanAmountLeft: safeFin.totalOutstandingDebt ?? null,
  financialHealth: safeClassifications.map((c) => FRIENDLY_LABELS[c] || c),
  mainConcern: data?.mainProblem ?? null,
  estimatedComfortableEMIRange: safeFin.comfortableEMIRange ?? null,
  recommendedAction: recommendation?.primaryRecommendation?.title || 'Not available',
  dataConfidence,
};

const needsUserConfirmation = safeReconciliation.some((r) => r.hasConflicts);

return [{
  json: {
    status: 'success',
    disclaimer: 'RESTRUCTRA is financial decision-support and lender-preparation software for MSMEs. It is not a lender, does not approve loans, and does not guarantee any outcome. All figures are estimates based on the information you provided.',
    dashboard,
    detailedFinancialView: safeFin,
    stressClassifications: safeClassifications,
    reconciliation: { needsUserConfirmation, results: safeReconciliation },
    scenarios: input.scenarioBundle?.scenarios ?? null,
    stressTestAssumptions: input.scenarioBundle?.stressAssumptions ?? null,
    recommendation,
    bankReadyDiscussionPlan: bankReport,
    dataConfidence,
  },
}];
