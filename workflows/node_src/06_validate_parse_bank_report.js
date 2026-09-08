// n8n Code node — "Validate & Parse Bank Report (fail-closed)"
//
// DATA-FLOW NOTE (fix): after the "AI Bank Report" HTTP Request node runs,
// $input.first().json is the Anthropic HTTP response — NOT the deterministic
// engine output or the already-validated recommendation. Both must be
// fetched explicitly from the node that produced them, by name, via
// $node[...]. The placeholder __RECOMMENDATION_CONTEXT_NODE__ below is
// substituted at build time (see workflows/build_workflow.js /
// build_modules.js) with the exact name of the upstream node that carries
// {data, fin, scenarioBundle, classifications, dataConfidence,
// reconciliationResults, recommendation, recommendationValidation} for
// whichever workflow this file is assembled into.
//
// If ANY validation check fails, we do NOT fabricate a fallback report with
// invented numbers — we fail closed to a deterministic, engine-only summary.

const httpResponse = $input.first().json;
const priorContext = ($node["__RECOMMENDATION_CONTEXT_NODE__"] && $node["__RECOMMENDATION_CONTEXT_NODE__"].json) || {};
const { data, validation, reconciliationResults, fin, scenarioBundle, classifications, dataConfidence, recommendation, recommendationValidation } = priorContext;

function extractText(httpResponse) {
  try {
    const content = httpResponse?.content || httpResponse?.body?.content;
    if (!Array.isArray(content)) return null;
    const textBlock = content.find((b) => b.type === 'text');
    return textBlock ? textBlock.text : null;
  } catch (e) { return null; }
}
function safeParseJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch (e) { return null; }
}
function collectEngineNumbers(fin, scenarioBundle) {
  const nums = [];
  const push = (v) => { if (typeof v === 'number' && Number.isFinite(v)) nums.push(Math.round(v)); };
  Object.values(fin || {}).forEach((v) => push(v));
  if (fin?.comfortableEMIRange) { push(fin.comfortableEMIRange.lower); push(fin.comfortableEMIRange.upper); }
  const walk = (obj) => { if (!obj || typeof obj !== 'object') return; Object.values(obj).forEach((v) => { if (typeof v === 'number') push(v); else if (typeof v === 'object') walk(v); }); };
  walk(scenarioBundle?.scenarios);
  return nums;
}
function extractNumbersFromText(text) {
  const matches = text.match(/-?\d{3,}(\.\d+)?/g) || [];
  return matches.map((m) => Math.round(Number(m))).filter((n) => Number.isFinite(n));
}

const REQUIRED_SECTIONS = ['title', 'businessSituation', 'currentRepaymentSituation', 'mainReasonForPressure', 'estimatedComfortableRepaymentRange', 'recommendedOption', 'alternativeOptions', 'whyRecommendationMakesSense', 'risksAndTradeoffs', 'evidenceSupportingRequest', 'documentsToTakeToLender', 'questionsLenderMayAsk', 'suggestedEvidenceBasedResponses', 'nextSteps', 'disclaimer'];

function validateBankReport(report, fin, scenarioBundle) {
  const errors = [];
  if (!report || typeof report !== 'object') return { valid: false, errors: ['Bank report is not valid JSON.'] };
  REQUIRED_SECTIONS.forEach((k) => { if (!(k in report)) errors.push(`Missing section: ${k}`); });

  const bannedPhrases = ['guarantee', 'guaranteed', 'will be approved', 'assured approval', 'promise'];
  const allText = JSON.stringify(report).toLowerCase();
  bannedPhrases.forEach((p) => { if (allText.includes(p)) errors.push(`Bank report contains a disallowed guarantee-style phrase: "${p}".`); });

  const engineNumbers = collectEngineNumbers(fin, scenarioBundle);
  const citedNumbers = extractNumbersFromText(JSON.stringify(report));
  const unverifiable = citedNumbers.filter((n) => !engineNumbers.some((e) => Math.abs(e - n) < Math.max(1, e * 0.01)));
  const materialUnverifiable = unverifiable.filter((n) => n > 100);
  if (materialUnverifiable.length > 0) errors.push(`Bank report cites figures not found in engine output: ${materialUnverifiable.slice(0, 5).join(', ')}`);

  if (!fin) errors.push('Deterministic engine context unavailable — cannot verify bank report output.');

  return { valid: errors.length === 0, errors };
}

function buildFailClosedReport(fin, recommendation) {
  // Every field uses optional chaining / nullish coalescing so this can never throw,
  // even if the upstream context could not be retrieved at all.
  return {
    aiUnavailable: true,
    title: 'MSME Loan Restructuring Discussion Plan (Basic Version)',
    businessSituation: 'Automated narrative could not be safely verified this time. Figures below are from the deterministic financial engine and are accurate.',
    currentRepaymentSituation: `Total monthly EMI: Rs. ${fin?.totalMonthlyEMI ?? 'N/A'}. Estimated money left after expenses: Rs. ${fin?.availableAfterExpenses ?? 'N/A'}.`,
    mainReasonForPressure: 'Not available in fallback mode — see detailed financial view.',
    estimatedComfortableRepaymentRange: fin?.comfortableEMIRange ? `Rs. ${fin.comfortableEMIRange.lower} to Rs. ${fin.comfortableEMIRange.upper} (illustrative).` : 'Not available.',
    recommendedOption: recommendation?.primaryRecommendation?.title || 'See detailed financial view.',
    alternativeOptions: [],
    whyRecommendationMakesSense: 'Not available in fallback mode.',
    risksAndTradeoffs: ['This is a fallback summary generated without AI narrative. Please review the full numbers before your lender meeting.'],
    evidenceSupportingRequest: [],
    documentsToTakeToLender: ['Last 6 months bank statement', 'Latest loan statement(s)', 'GST/sales summary (if available)'],
    questionsLenderMayAsk: [],
    suggestedEvidenceBasedResponses: [],
    nextSteps: ['Review the detailed financial view', 'Consult a Chartered Accountant if numbers are unclear', 'Contact your lender to discuss options'],
    disclaimer: 'This is an estimate based on the information provided. It is not a loan approval, lender decision, or financial guarantee of any kind.',
  };
}

const text = extractText(httpResponse);
const parsed = safeParseJSON(text);
const validation2 = validateBankReport(parsed, fin, scenarioBundle);
const bankReport = validation2.valid ? parsed : buildFailClosedReport(fin, recommendation);

return [{
  json: {
    data,
    validation,
    reconciliationResults,
    fin,
    scenarioBundle,
    classifications,
    dataConfidence,
    recommendation,
    recommendationValidation,
    bankReport,
    bankReportValidation: validation2,
  },
}];
