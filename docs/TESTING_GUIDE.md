# RESTRUCTRA — Testing Guide

There are two independent layers of testing. Run both.

## Layer 1 — Deterministic engine tests (no n8n, no API key needed)

This proves the financial engine, scenario engine, and stress diagnosis are
correct, deterministic, and match the exact code embedded in the n8n
workflow.

```bash
cd tests
node run_tests.js
```

Expected output: `10 passed, 0 failed out of 10`, plus a per-fixture
classification summary. Full computed detail for every fixture is written
to `tests/actual_results.json`. Compare against `tests/EXPECTED_RESULTS.md`.

Re-run this any time you edit `workflows/node_src/*.js` — it imports those
exact files (indirectly, via `workflows/build_workflow.js` at workflow-build
time) so a passing run here means the workflow's Code nodes behave
identically.

## Layer 2 — Full HTTP pipeline test (requires a running n8n + Anthropic credential)

### 2.1 Import into n8n

1. Open your n8n instance → **Workflows → Import from File**.
2. Import `workflows/00_FULL_DEMO_PIPELINE.json`.
3. n8n will show the two HTTP Request nodes ("AI Recommendation (Anthropic)"
   and "AI Bank Report (Anthropic)") with a missing credential. Create a
   **Header Auth** credential:
   - Name: `Anthropic API Key (x-api-key header)`
   - Header Name: `x-api-key`
   - Header Value: your Anthropic API key
   Assign this credential to both HTTP Request nodes.
4. Save and **Activate** the workflow (or run it in test mode — the webhook
   works either way; test mode gives you a temporary URL).
5. Note the webhook URL, e.g. `http://localhost:5678/webhook/restructra/full-pipeline`.

### 2.2 Run your first test

```bash
curl -X POST http://localhost:5678/webhook/restructra/full-pipeline \
  -H "Content-Type: application/json" \
  -d @samples/sample_mode_a_request.json
```

You should get back a JSON response with `status: "success"`, a `dashboard`
block, `stressClassifications`, `scenarios`, a `recommendation`, and a
`bankReadyDiscussionPlan`. Cross-check the deterministic figures
(`detailedFinancialView`) against `tests/sample_mode_a_expected_output.json`
— they must match exactly (these numbers never touch the LLM).

### 2.3 Run all 10 tests against the live webhook

```bash
cd tests
node run_http_tests.js http://localhost:5678/webhook/restructra/full-pipeline
```

This posts every fixture in `tests/fixtures/` and checks for a `200` status,
`status: "success"`, and a populated `stressClassifications` array. For
deeper per-test assertions (exact classification values, conflict details,
etc.) rely on Layer 1 (`run_tests.js`) — Layer 2 is primarily a smoke test
that the whole HTTP chain, including the two live LLM calls, completes
without failing closed unexpectedly.

### 2.4 Test the contradiction / reconciliation path specifically

```bash
curl -X POST http://localhost:5678/webhook/restructra/full-pipeline \
  -H "Content-Type: application/json" \
  -d @tests/fixtures/test8_user_document_conflict.json
```

Check `reconciliation.needsUserConfirmation` is `true` and
`reconciliation.results[0].conflicts` contains the `monthlyEMI` mismatch.

### 2.5 Test the fail-closed AI path

Temporarily break the Anthropic credential (revoke the key, or point the
HTTP Request node's URL at a typo'd endpoint) and re-run test 1. You should
still get `status: "success"` (HTTP 200) with
`recommendation.aiUnavailable: true` and a deterministic, engine-only
summary — never a raw n8n error surfaced to the caller, and never a
fabricated explanation. This is the most important safety property to
verify before considering RESTRUCTRA production-ready.

## Layer 3 — Testing individual modules in isolation

Each file in `workflows/01_User_Intake.json` … `09_Early_Warning.json` is
independently importable with its own webhook path (see
`docs/ARCHITECTURE.md` §8). Useful when you've changed one stage and don't
want to re-run the whole pipeline. Example — test just the scenario engine:

```bash
curl -X POST http://localhost:5678/webhook/restructra/scenario-engine \
  -H "Content-Type: application/json" \
  -d '{"data": <output of 04-06 stage>, "fin": <...>}'
```

The `04_Financial_Health_Engine`, `05_Stress_Diagnosis`, and
`06_Scenario_Engine` modules all expect the same input shape (the object
produced by the `01-03 Intake` module: `{data, validation,
reconciliationResults}`) since they share the combined
`02_financial_engine_scenarios_diagnosis.js` source — pipe the intake
module's output straight into any of them for a quick check.

## Validating the workflow JSON itself

Before importing, you can sanity-check the JSON offline with Node (no n8n
required) — this is exactly what was run while building this package:

```bash
cd workflows
node -e "
const wf = require('./00_FULL_DEMO_PIPELINE.json');
const names = new Set(wf.nodes.map(n=>n.name));
for (const [from, obj] of Object.entries(wf.connections)) {
  if (!names.has(from)) throw new Error('bad source ' + from);
  obj.main.forEach(arr => arr.forEach(c => { if (!names.has(c.node)) throw new Error('bad target ' + c.node); }));
}
wf.nodes.filter(n => n.type === 'n8n-nodes-base.code').forEach(n => new Function('\$input', '\$node', n.parameters.jsCode));
console.log('Structurally valid:', wf.nodes.length, 'nodes,', Object.keys(wf.connections).length, 'connected sources.');
"
```
