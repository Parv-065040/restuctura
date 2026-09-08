'use strict';
// Assembles workflows/00_FULL_DEMO_PIPELINE.json from the syntax-checked
// Code node sources in node_src/. Run: node build_workflow.js
const fs = require('fs');
const path = require('path');

const src = (name) => fs.readFileSync(path.join(__dirname, 'node_src', name), 'utf8');

let nid = 0;
const id = () => `n${++nid}`;

const nodes = [];
const connections = {};

function addNode(node) {
  nodes.push(node);
  return node;
}
function connect(fromName, toName, fromOutput = 0, fromIndex = 0, toIndex = 0) {
  connections[fromName] = connections[fromName] || { main: [] };
  while (connections[fromName].main.length <= fromOutput) connections[fromName].main.push([]);
  connections[fromName].main[fromOutput].push({ node: toName, type: 'main', index: toIndex });
}

let x = 0;
const Y = 300;
const STEP = 260;
function pos() { const p = [x, Y]; x += STEP; return p; }

// 1. Webhook
const webhook = addNode({
  parameters: {
    httpMethod: 'POST',
    path: 'restructra/full-pipeline',
    responseMode: 'responseNode',
    options: {},
  },
  id: id(),
  name: 'Webhook',
  type: 'n8n-nodes-base.webhook',
  typeVersion: 2,
  position: pos(),
  webhookId: 'restructra-full-pipeline',
});

// 2. Code: Intake + Documents + Reconciliation
const code01 = addNode({
  parameters: { mode: 'runOnceForAllItems', jsCode: src('01_intake_documents_reconciliation.js') },
  id: id(),
  name: '01-03 Intake, Documents, Reconciliation',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: pos(),
});
connect('Webhook', '01-03 Intake, Documents, Reconciliation');

// 3. IF: validation passed?
const ifValid = addNode({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
      conditions: [
        {
          id: 'cond1',
          leftValue: '={{ $json.validation.isValid }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
  id: id(),
  name: 'Input Valid?',
  type: 'n8n-nodes-base.if',
  typeVersion: 2,
  position: pos(),
});
connect('01-03 Intake, Documents, Reconciliation', 'Input Valid?');

// 3b. Respond - validation error (IF output 1 / false)
const respondError = addNode({
  parameters: {
    respondWith: 'json',
    responseBody:
      "={{ { status: 'error', userMessage: \"We couldn't understand some of the numbers you entered. Please check them and try again.\", validationErrors: $json.validation.errors } }}",
    options: { responseCode: 400 },
  },
  id: id(),
  name: 'Respond - Validation Error',
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.1,
  position: [x, Y + 260],
});
connect('Input Valid?', 'Respond - Validation Error', 0, 1); // false branch (index 1)

// 4. Code: Financial Engine + Scenarios + Diagnosis (IF output 0 / true)
const code02 = addNode({
  parameters: { mode: 'runOnceForAllItems', jsCode: src('02_financial_engine_scenarios_diagnosis.js') },
  id: id(),
  name: '04-06 Financial Engine, Scenarios, Diagnosis',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: pos(),
});
connect('Input Valid?', '04-06 Financial Engine, Scenarios, Diagnosis', 0, 0);

// 5. Code: Build Recommendation Prompt
const code03 = addNode({
  parameters: { mode: 'runOnceForAllItems', jsCode: src('03_build_recommendation_prompt.js') },
  id: id(),
  name: 'Build Recommendation Prompt',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: pos(),
});
connect('04-06 Financial Engine, Scenarios, Diagnosis', 'Build Recommendation Prompt');

// 6. HTTP Request: AI Recommendation
const httpRec = addNode({
  parameters: {
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'anthropic-version', value: '2023-06-01' },
        { name: 'content-type', value: 'application/json' },
      ],
    },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.aiRequest) }}',
    options: {},
  },
  id: id(),
  name: 'AI Recommendation (Anthropic)',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: pos(),
  credentials: { httpHeaderAuth: { id: 'REPLACE_WITH_YOUR_CREDENTIAL_ID', name: 'Anthropic API Key (x-api-key header)' } },
  onError: 'continueRegularOutput',
});
connect('Build Recommendation Prompt', 'AI Recommendation (Anthropic)');

// 7. Code: Validate & Parse Recommendation (fail-closed)
// __ENGINE_CONTEXT_NODE__ -> the node that produced {data, fin, scenarioBundle,
// classifications, dataConfidence, reconciliationResults}, so it survives the
// "AI Recommendation" HTTP Request node overwriting $json.
const code04Src = src('04_validate_parse_recommendation.js').split('__ENGINE_CONTEXT_NODE__').join(
  '04-06 Financial Engine, Scenarios, Diagnosis'
);
const code04 = addNode({
  parameters: { mode: 'runOnceForAllItems', jsCode: code04Src },
  id: id(),
  name: 'Validate & Parse Recommendation',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: pos(),
});
connect('AI Recommendation (Anthropic)', 'Validate & Parse Recommendation');

// 8. Code: Build Bank Report Prompt
const code05 = addNode({
  parameters: { mode: 'runOnceForAllItems', jsCode: src('05_build_bank_report_prompt.js') },
  id: id(),
  name: 'Build Bank Report Prompt',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: pos(),
});
connect('Validate & Parse Recommendation', 'Build Bank Report Prompt');

// 9. HTTP Request: AI Bank Report
const httpBank = addNode({
  parameters: {
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'anthropic-version', value: '2023-06-01' },
        { name: 'content-type', value: 'application/json' },
      ],
    },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.bankReportRequest) }}',
    options: {},
  },
  id: id(),
  name: 'AI Bank Report (Anthropic)',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: pos(),
  credentials: { httpHeaderAuth: { id: 'REPLACE_WITH_YOUR_CREDENTIAL_ID', name: 'Anthropic API Key (x-api-key header)' } },
  onError: 'continueRegularOutput',
});
connect('Build Bank Report Prompt', 'AI Bank Report (Anthropic)');

// 10. Code: Validate & Parse Bank Report (fail-closed)
// __RECOMMENDATION_CONTEXT_NODE__ -> the node that produced {data, fin,
// scenarioBundle, classifications, dataConfidence, reconciliationResults,
// recommendation, recommendationValidation}, so it survives the
// "AI Bank Report" HTTP Request node overwriting $json.
const code06Src = src('06_validate_parse_bank_report.js').split('__RECOMMENDATION_CONTEXT_NODE__').join(
  'Validate & Parse Recommendation'
);
const code06 = addNode({
  parameters: { mode: 'runOnceForAllItems', jsCode: code06Src },
  id: id(),
  name: 'Validate & Parse Bank Report',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: pos(),
});
connect('AI Bank Report (Anthropic)', 'Validate & Parse Bank Report');

// 11. Code: Assemble Final Response
const code07 = addNode({
  parameters: { mode: 'runOnceForAllItems', jsCode: src('07_assemble_final_response.js') },
  id: id(),
  name: 'Assemble Final Response',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: pos(),
});
connect('Validate & Parse Bank Report', 'Assemble Final Response');

// 12. Respond to Webhook - success
const respondSuccess = addNode({
  parameters: {
    respondWith: 'json',
    responseBody: '={{ $json }}',
    options: { responseCode: 200 },
  },
  id: id(),
  name: 'Respond - Success',
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.1,
  position: pos(),
});
connect('Assemble Final Response', 'Respond - Success');

const workflow = {
  name: '00_FULL_DEMO_PIPELINE — RESTRUCTRA',
  nodes,
  connections,
  active: false,
  settings: { executionOrder: 'v1' },
  pinData: {},
  meta: { instanceId: 'restructra-demo' },
};

fs.writeFileSync(path.join(__dirname, '00_FULL_DEMO_PIPELINE.json'), JSON.stringify(workflow, null, 2));
console.log('Wrote 00_FULL_DEMO_PIPELINE.json with', nodes.length, 'nodes.');
