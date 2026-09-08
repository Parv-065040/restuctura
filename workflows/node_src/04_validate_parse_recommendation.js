// n8n Code node — "Validate & Parse Recommendation (fail-closed)"
//
// DATA-FLOW NOTE (fix): after the "AI Recommendation" HTTP Request node runs,
// $input.first().json is the Anthropic HTTP response — NOT the deterministic
// engine output. The engine output must be fetched explicitly from the node
// that produced it, by name, via $node[...]. The placeholder
// __ENGINE_CONTEXT_NODE__ below is substituted at build time
// (see workflows/build_workflow.js / build_modules.js) with the exact name
// of the upstream node that carries {data, fin, scenarioBundle,
// classifications, dataConfidence, reconciliationResults} for whichever
// workflow this file is assembled into.
//
// If ANY validation check fails, we do NOT fabricate a fallback
// recommendation with invented numbers — we fail closed to a deterministic,
// engine-only summary, built only from values already present in engineContext.

const httpResponse = $input.first().json;
const engineContext = ($node["__ENGINE_CONTEXT_NODE__"] && $node["__ENGINE_CONTEXT_NODE__"].json) || {};
const { data, validation, reconciliationResults, fin, scenarioBundle, classifications, dataConfidence } = engineContext;

function extractText(httpResponse) {
  try {
    const content = httpResponse?.content || httpResponse?.body?.content;
    if (!Array.isArray(content)) return null;
    const textBlock = content.find((b) => b.type === 'text');
    return textBlock ? textBlock.text : null;
  } catch (e) {
    return null;
  }
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
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    Object.values(obj).forEach((v) => { if (typeof v === 'number') push(v); else if (typeof v === 'object') walk(v); });
  };
  walk(scenarioBundle?.scenarios);
  return nums;
}
function extractNumbersFromText(text) {
  const matches = text.match(/-?\d{3,}(\.\d+)?/g) || [];
  return matches.map((m) => Math.round(Number(m))).filter((n) => Number.isFinite(n));
}

function validateRecommendationOutput(aiJson, fin, scenarioBundle) {
  const errors = [];
  if (!aiJson || typeof aiJson !== 'object') return { valid: false, errors: ['AI output is not valid JSON.'] };
  if (!aiJson.primaryRecommendation) errors.push('Missing primaryRecommendation.');
  if (!Array.isArray(aiJson.alternativeOptions)) errors.push('Missing alternativeOptions array.');
  if (!Array.isArray(aiJson.notPreferredOptions)) errors.push('Missing notPreferredOptions array.');
  if (!aiJson.disclaimer || typeof aiJson.disclaimer !== 'string' || aiJson.disclaimer.length < 10) errors.push('Missing or insufficient disclaimer.');

  const bannedPhrases = ['guarantee', 'guaranteed', 'will be approved', 'assured approval', 'promise'];
  const allText = JSON.stringify(aiJson).toLowerCase();
  bannedPhrases.forEach((p) => { if (allText.includes(p)) errors.push(`AI output contains a disallowed guarantee-style phrase: "${p}".`); });

  const engineNumbers = collectEngineNumbers(fin, scenarioBundle);
  const citedNumbers = extractNumbersFromText(JSON.stringify(aiJson));
  const unverifiable = citedNumbers.filter((n) => !engineNumbers.some((e) => Math.abs(e - n) < Math.max(1, e * 0.01)));
  const materialUnverifiable = unverifiable.filter((n) => n > 100);
  if (materialUnverifiable.length > 0) errors.push(`AI output cites figures not found in engine output: ${materialUnverifiable.slice(0, 5).join(', ')}`);

  // If the engine context itself failed to load, we cannot trust any AI output that claims to be based on it.
  if (!fin) errors.push('Deterministic engine context unavailable — cannot verify AI output.');

  return { valid: errors.length === 0, errors };
}

function buildFailClosedRecommendation(classifications, fin) {
  // A deterministic, engine-only fallback used ONLY if the AI output cannot be trusted
  // (or the engine context itself could not be retrieved). Every field below uses
  // optional chaining so this function itself can never throw.
  const safeClassifications = Array.isArray(classifications) ? classifications : [];
  const isHealthy = safeClassifications.length === 1 && safeClassifications[0] === 'HEALTHY';
  return {
    aiUnavailable: true,
    summaryForOwner: isHealthy
      ? 'Based on the numbers provided, your current loan payments appear manageable.'
      : 'We were not able to generate a fully verified explanation this time, but here is what the numbers show.',
    primaryRecommendation: isHealthy
      ? { title: 'Continue monitoring', explanation: 'No restructuring is indicated by the current numbers. Keep an eye on your cash cushion and upcoming EMIs.', supportingNumbers: [] }
      : { title: 'Review the figures below with a financial advisor or your lender', explanation: 'An automated explanation could not be safely verified. The underlying calculations (available below) are accurate and can be used as-is for a discussion with your lender or a Chartered Accountant.', supportingNumbers: [] },
    alternativeOptions: [],
    notPreferredOptions: [],
    risksAndTradeoffs: ['This is a fallback summary. Please review the detailed financial view before making decisions.'],
    technicalDetails: { internalDSCR: fin?.internalDSCR ?? null, emiToAvailableRatio: fin?.emiToAvailableRatio ?? null, note: 'Fallback path — AI explanation failed validation or the deterministic engine context was unavailable.' },
    disclaimer: 'This is an estimate based on the information provided. It is not a loan approval, lender decision, or financial guarantee of any kind.',
  };
}

const text = extractText(httpResponse);
const parsed = safeParseJSON(text);
const validation2 = validateRecommendationOutput(parsed, fin, scenarioBundle);

const recommendation = validation2.valid ? parsed : buildFailClosedRecommendation(classifications, fin);

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
    recommendationValidation: validation2,
  },
}];
