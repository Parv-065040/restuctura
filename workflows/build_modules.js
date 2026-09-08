'use strict';
// Builds 9 standalone, independently-importable n8n workflows, each exposing
// its own webhook so a single pipeline stage can be tested in isolation.
// They reuse the exact same, already syntax-checked Code node sources as
// 00_FULL_DEMO_PIPELINE.json.
const fs = require('fs');
const path = require('path');

const src = (name) => fs.readFileSync(path.join(__dirname, 'node_src', name), 'utf8');
let nid = 0;
const id = () => `m${++nid}`;

function makeSingleCodeWorkflow({ name, webhookPath, jsCode, respondExpr }) {
  const nodes = [
    {
      parameters: { httpMethod: 'POST', path: webhookPath, responseMode: 'responseNode', options: {} },
      id: id(), name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 300],
      webhookId: webhookPath.replace(/\//g, '-'),
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode },
      id: id(), name: name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [260, 300],
    },
    {
      parameters: { respondWith: 'json', responseBody: respondExpr || '={{ $json }}', options: { responseCode: 200 } },
      id: id(), name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [520, 300],
    },
  ];
  const connections = {
    Webhook: { main: [[{ node: name, type: 'main', index: 0 }]] },
    [name]: { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
  };
  return { name: `Module - ${name}`, nodes, connections, active: false, settings: { executionOrder: 'v1' }, pinData: {}, meta: { instanceId: 'restructra-demo' } };
}

const modules = [
  {
    file: '01_User_Intake.json',
    def: makeSingleCodeWorkflow({
      name: '01 User Intake',
      webhookPath: 'restructra/user-intake',
      jsCode: src('01_intake_documents_reconciliation.js'),
    }),
  },
  {
    // Document processing is the "documents"/"reconciliation" portion of the same
    // combined script — isolated here for standalone testing of doc-heavy payloads.
    file: '02_Document_Processing.json',
    def: makeSingleCodeWorkflow({
      name: '02 Document Processing',
      webhookPath: 'restructra/document-processing',
      jsCode: src('01_intake_documents_reconciliation.js'),
      respondExpr: '={{ { reconciliationResults: $json.reconciliationResults, anyExtractionFailed: $json.anyExtractionFailed, anyConflicts: $json.anyConflicts } }}',
    }),
  },
  {
    file: '03_Data_Reconciliation.json',
    def: makeSingleCodeWorkflow({
      name: '03 Data Reconciliation',
      webhookPath: 'restructra/data-reconciliation',
      jsCode: src('01_intake_documents_reconciliation.js'),
      respondExpr: '={{ $json.reconciliationResults }}',
    }),
  },
  {
    file: '04_Financial_Health_Engine.json',
    def: (() => {
      // needs data+validation+reconciliationResults as input; expects caller to POST that shape directly.
      const wf = makeSingleCodeWorkflow({
        name: '04 Financial Health Engine',
        webhookPath: 'restructra/financial-health-engine',
        jsCode: src('02_financial_engine_scenarios_diagnosis.js').replace(
          'const input = $input.first().json;',
          'const input = $input.first().json.body || $input.first().json;'
        ),
        respondExpr: '={{ $json.fin }}',
      });
      return wf;
    })(),
  },
  {
    file: '05_Stress_Diagnosis.json',
    def: (() => {
      const wf = makeSingleCodeWorkflow({
        name: '05 Stress Diagnosis',
        webhookPath: 'restructra/stress-diagnosis',
        jsCode: src('02_financial_engine_scenarios_diagnosis.js').replace(
          'const input = $input.first().json;',
          'const input = $input.first().json.body || $input.first().json;'
        ),
        respondExpr: '={{ { classifications: $json.classifications, dataConfidence: $json.dataConfidence } }}',
      });
      return wf;
    })(),
  },
  {
    file: '06_Scenario_Engine.json',
    def: (() => {
      const wf = makeSingleCodeWorkflow({
        name: '06 Scenario Engine',
        webhookPath: 'restructra/scenario-engine',
        jsCode: src('02_financial_engine_scenarios_diagnosis.js').replace(
          'const input = $input.first().json;',
          'const input = $input.first().json.body || $input.first().json;'
        ),
        respondExpr: '={{ $json.scenarioBundle }}',
      });
      return wf;
    })(),
  },
  {
    // 07_AI_Recommendation: prompt-build + HTTP call + validate, standalone
    file: '07_AI_Recommendation.json',
    def: (() => {
      const buildNode = {
        parameters: { mode: 'runOnceForAllItems', jsCode: src('03_build_recommendation_prompt.js').replace(
          'const input = $input.first().json;',
          'const input = $input.first().json.body || $input.first().json;'
        ) },
        id: id(), name: 'Build Recommendation Prompt', type: 'n8n-nodes-base.code', typeVersion: 2, position: [260, 300],
      };
      const httpNode = {
        parameters: {
          method: 'POST', url: 'https://api.anthropic.com/v1/messages',
          authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendHeaders: true,
          headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }, { name: 'content-type', value: 'application/json' }] },
          sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.aiRequest) }}', options: {},
        },
        id: id(), name: 'AI Recommendation (Anthropic)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [520, 300],
        credentials: { httpHeaderAuth: { id: 'REPLACE_WITH_YOUR_CREDENTIAL_ID', name: 'Anthropic API Key (x-api-key header)' } },
        onError: 'continueRegularOutput',
      };
      // Standalone module: the node immediately before the HTTP call ("Build
      // Recommendation Prompt") carries the engine context the caller POSTed in,
      // so it is the __ENGINE_CONTEXT_NODE__ for this workflow.
      const validateSrc = src('04_validate_parse_recommendation.js').split('__ENGINE_CONTEXT_NODE__').join(
        'Build Recommendation Prompt'
      );
      const validateNode = {
        parameters: { mode: 'runOnceForAllItems', jsCode: validateSrc },
        id: id(), name: 'Validate & Parse Recommendation', type: 'n8n-nodes-base.code', typeVersion: 2, position: [780, 300],
      };
      const webhookNode = {
        parameters: { httpMethod: 'POST', path: 'restructra/ai-recommendation', responseMode: 'responseNode', options: {} },
        id: id(), name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 300], webhookId: 'restructra-ai-recommendation',
      };
      const respondNode = {
        parameters: { respondWith: 'json', responseBody: '={{ { recommendation: $json.recommendation, validation: $json.recommendationValidation } }}', options: { responseCode: 200 } },
        id: id(), name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [1040, 300],
      };
      const nodes = [webhookNode, buildNode, httpNode, validateNode, respondNode];
      const connections = {
        Webhook: { main: [[{ node: 'Build Recommendation Prompt', type: 'main', index: 0 }]] },
        'Build Recommendation Prompt': { main: [[{ node: 'AI Recommendation (Anthropic)', type: 'main', index: 0 }]] },
        'AI Recommendation (Anthropic)': { main: [[{ node: 'Validate & Parse Recommendation', type: 'main', index: 0 }]] },
        'Validate & Parse Recommendation': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
      };
      return { name: 'Module - 07 AI Recommendation', nodes, connections, active: false, settings: { executionOrder: 'v1' }, pinData: {}, meta: { instanceId: 'restructra-demo' } };
    })(),
  },
  {
    // 08_Bank_Ready_Report: prompt-build + HTTP call + validate, standalone
    file: '08_Bank_Ready_Report.json',
    def: (() => {
      const buildNode = {
        parameters: { mode: 'runOnceForAllItems', jsCode: src('05_build_bank_report_prompt.js').replace(
          'const input = $input.first().json;',
          'const input = $input.first().json.body || $input.first().json;'
        ) },
        id: id(), name: 'Build Bank Report Prompt', type: 'n8n-nodes-base.code', typeVersion: 2, position: [260, 300],
      };
      const httpNode = {
        parameters: {
          method: 'POST', url: 'https://api.anthropic.com/v1/messages',
          authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendHeaders: true,
          headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }, { name: 'content-type', value: 'application/json' }] },
          sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.bankReportRequest) }}', options: {},
        },
        id: id(), name: 'AI Bank Report (Anthropic)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [520, 300],
        credentials: { httpHeaderAuth: { id: 'REPLACE_WITH_YOUR_CREDENTIAL_ID', name: 'Anthropic API Key (x-api-key header)' } },
        onError: 'continueRegularOutput',
      };
      // Standalone module: the node immediately before the HTTP call ("Build
      // Bank Report Prompt") carries the prior context the caller POSTed in,
      // so it is the __RECOMMENDATION_CONTEXT_NODE__ for this workflow.
      const validateSrc = src('06_validate_parse_bank_report.js').split('__RECOMMENDATION_CONTEXT_NODE__').join(
        'Build Bank Report Prompt'
      );
      const validateNode = {
        parameters: { mode: 'runOnceForAllItems', jsCode: validateSrc },
        id: id(), name: 'Validate & Parse Bank Report', type: 'n8n-nodes-base.code', typeVersion: 2, position: [780, 300],
      };
      const webhookNode = {
        parameters: { httpMethod: 'POST', path: 'restructra/bank-ready-report', responseMode: 'responseNode', options: {} },
        id: id(), name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 300], webhookId: 'restructra-bank-ready-report',
      };
      const respondNode = {
        parameters: { respondWith: 'json', responseBody: '={{ { bankReport: $json.bankReport, validation: $json.bankReportValidation } }}', options: { responseCode: 200 } },
        id: id(), name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [1040, 300],
      };
      const nodes = [webhookNode, buildNode, httpNode, validateNode, respondNode];
      const connections = {
        Webhook: { main: [[{ node: 'Build Bank Report Prompt', type: 'main', index: 0 }]] },
        'Build Bank Report Prompt': { main: [[{ node: 'AI Bank Report (Anthropic)', type: 'main', index: 0 }]] },
        'AI Bank Report (Anthropic)': { main: [[{ node: 'Validate & Parse Bank Report', type: 'main', index: 0 }]] },
        'Validate & Parse Bank Report': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
      };
      return { name: 'Module - 08 Bank Ready Report', nodes, connections, active: false, settings: { executionOrder: 'v1' }, pinData: {}, meta: { instanceId: 'restructra-demo' } };
    })(),
  },
  {
    file: '09_Early_Warning.json',
    def: makeSingleCodeWorkflow({
      name: '09 Early Warning',
      webhookPath: 'restructra/early-warning',
      jsCode: src('09_early_warning.js').replace(
        'const input = $input.first().json;',
        'const input = $input.first().json.body || $input.first().json;'
      ),
      respondExpr: '={{ $json.earlyWarning }}',
    }),
  },
];

for (const m of modules) {
  fs.writeFileSync(path.join(__dirname, m.file), JSON.stringify(m.def, null, 2));
  console.log('Wrote', m.file);
}
