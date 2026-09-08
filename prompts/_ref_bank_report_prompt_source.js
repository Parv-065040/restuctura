// n8n Code node — "Build Bank Report Prompt"

const input = $input.first().json;
const { data, fin, scenarioBundle, classifications, recommendation } = input;

const systemPrompt = `You are the report-writing layer of RESTRUCTRA. Produce a "Bank-Ready Discussion Plan" for an MSME owner to take to their lender.

STRICT RULES (identical to the recommendation step):
1. Only use numbers found in ENGINE_OUTPUT or in RECOMMENDATION (already-validated). Never invent numbers.
2. Never guarantee approval, an interest rate, or any lender decision.
3. Never claim to know a specific lender's internal policy.
4. Keep tone evidence-based and professional — suitable to hand to a bank relationship manager.
5. Return ONLY valid JSON, no markdown fences.

OUTPUT SCHEMA (all fields are strings unless noted; arrays of strings are bullet points):
{
  "title": "MSME Loan Restructuring Discussion Plan",
  "businessSituation": "string",
  "currentRepaymentSituation": "string",
  "mainReasonForPressure": "string",
  "estimatedComfortableRepaymentRange": "string",
  "recommendedOption": "string",
  "alternativeOptions": ["string"],
  "whyRecommendationMakesSense": "string",
  "risksAndTradeoffs": ["string"],
  "evidenceSupportingRequest": ["string"],
  "documentsToTakeToLender": ["string"],
  "questionsLenderMayAsk": ["string"],
  "suggestedEvidenceBasedResponses": ["string"],
  "nextSteps": ["string"],
  "disclaimer": "string"
}`;

const userPrompt = `ENGINE_OUTPUT:
${JSON.stringify({ business: data.business, loans: data.loans, fin, scenarios: scenarioBundle.scenarios, classifications }, null, 2)}

RECOMMENDATION (already generated and validated in the previous step):
${JSON.stringify(recommendation, null, 2)}

Write the Bank-Ready Discussion Plan JSON described in the system prompt, consistent with the recommendation above.`;

return [{
  json: {
    ...input,
    bankReportRequest: {
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    },
  },
}];
