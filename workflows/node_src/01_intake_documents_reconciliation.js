// n8n Code node — "01-03: Intake, Documents, Reconciliation"
// Mode: Run Once for All Items. Expects the webhook body at items[0].json.body
// (Mode A: direct JSON; Mode B: same shape produced by the questionnaire frontend).
//
// NOTE ON DOCUMENT PROCESSING (see README "Known Limitations"):
// RESTRUCTRA does not ship its own OCR/PDF-parsing model. Each item in
// `documents[]` is expected to already carry a `fields[]` array — the output
// of an extraction step (an OCR + LLM extraction call, or a human-reviewed
// upload). This keeps the deterministic engine identical whether the fields
// came from a real extraction pipeline or from the bundled sample documents.
// A placeholder HTTP Request node ("Document Extraction (OCR/LLM)") is
// provided upstream of this node in the modular version for teams who want
// to wire in a real extraction service (Textract, Azure Doc Intelligence,
// an LLM vision call, etc.) — see docs/ARCHITECTURE.md §Document Processing.

const raw = $input.first().json.body || $input.first().json;

// ---------- normalize ----------
function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '' || v === "I don't know" || v === 'Not sure') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function normalizeTenure(value, unit) {
  const n = toNumberOrNull(value);
  if (n === null) return null;
  if (unit === 'years') return Math.round(n * 12);
  return Math.round(n);
}
function normalizeInput(r) {
  return {
    business: {
      type: r?.business?.type ?? null,
      monthlySales: toNumberOrNull(r?.business?.monthlySales),
      monthlyExpenses: toNumberOrNull(r?.business?.monthlyExpenses),
      customersPayingLate: r?.business?.customersPayingLate ?? 'Not sure',
      receivablesAmount: toNumberOrNull(r?.business?.receivablesAmount),
      incomeOutlook: r?.business?.incomeOutlook ?? 'Not sure',
      cashReserve: toNumberOrNull(r?.business?.cashReserve),
    },
    loans: Array.isArray(r?.loans)
      ? r.loans.map((l, i) => ({
          id: l.id || `loan_${i + 1}`,
          lender: l.lender ?? null,
          loanType: l.loanType ?? "Don't know",
          outstandingAmount: toNumberOrNull(l.outstandingAmount),
          emi: toNumberOrNull(l.emi),
          remainingTenureMonths: normalizeTenure(l.remainingTenure, l.remainingTenureUnit),
          interestRatePct: toNumberOrNull(l.interestRatePct),
          secured: l.secured ?? null,
        }))
      : [],
    mainProblem: r?.mainProblem ?? "I'm not sure",
    urgency: r?.urgency ?? "I'm not sure",
    documents: Array.isArray(r?.documents) ? r.documents : [],
    businessName: r?.businessName ?? null,
  };
}

// ---------- validate ----------
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

// ---------- reconciliation ----------
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
function reconcile(userData, extractedDoc) {
  const conflicts = [];
  const confirmations = [];
  if (!extractedDoc || extractedDoc.extractionFailed || !Array.isArray(extractedDoc.fields) || extractedDoc.fields.length === 0) {
    return {
      documentType: extractedDoc?.documentType || 'unknown',
      fileName: extractedDoc?.fileName || null,
      conflicts,
      confirmations,
      hasConflicts: false,
      extractionFailed: !!extractedDoc?.extractionFailed || (extractedDoc && extractedDoc.fields && extractedDoc.fields.length === 0),
    };
  }
  const TOLERANCE = 0.03;
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
    if (diffRatio > TOLERANCE) conflicts.push({ ...record, status: 'CONFLICT', actionRequired: true });
    else confirmations.push({ ...record, status: 'CONFIRMED', actionRequired: false });
  });
  return {
    documentType: extractedDoc.documentType || 'unknown',
    fileName: extractedDoc.fileName || null,
    conflicts,
    confirmations,
    hasConflicts: conflicts.length > 0,
    extractionFailed: false,
  };
}

// ---------- run ----------
const data = normalizeInput(raw);
const validation = validateInput(data);
const reconciliationResults = (data.documents || []).map((doc) => reconcile(data, doc));
const anyExtractionFailed = reconciliationResults.some((r) => r.extractionFailed);
const anyConflicts = reconciliationResults.some((r) => r.hasConflicts);

return [
  {
    json: {
      data,
      validation,
      reconciliationResults,
      anyExtractionFailed,
      anyConflicts,
    },
  },
];
