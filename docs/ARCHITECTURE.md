# RESTRUCTRA — Architecture

## 1. Product framing

RESTRUCTRA is **financial decision-support and lender-preparation software
for MSMEs**. It is not a lender, not a loan-approval system, not a
guarantee, and not a replacement for a Chartered Accountant. Every number
shown to the user is either (a) a fact the user or a document provided, or
(b) a clearly-labelled deterministic calculation/assumption. The AI layer
is only ever allowed to *explain* numbers that already exist — never to
invent, approve, or guarantee anything. This rule is enforced in code (see
§6) not just in prompt wording.

## 2. Pipeline stages → implementation mapping

| Spec stage | Where it lives |
|---|---|
| 01 User Intake | `node_src/01_intake_documents_reconciliation.js` (normalize + validate) |
| 02 Document Processing | same file — document `fields[]` are consumed as already-extracted (see §5) |
| 03 Data Reconciliation | same file — `reconcile()` |
| 04 Financial Health Engine | `node_src/02_financial_engine_scenarios_diagnosis.js` (`computeFinancials`) |
| 05 Stress Diagnosis | same file — `diagnoseStress()` (runs *after* the scenario engine so the structural check can see restructuring outcomes) |
| 06 Scenario Engine | same file — `buildScenarios()` |
| 07 AI Recommendation | `03_build_recommendation_prompt.js` → HTTP Request → `04_validate_parse_recommendation.js` |
| 08 Bank-Ready Report | `05_build_bank_report_prompt.js` → HTTP Request → `06_validate_parse_bank_report.js` |
| 09 Early Warning (optional/V2) | `node_src/09_early_warning.js`, shipped as a standalone module only (not wired into the main pipeline, per spec §42 "do not build unnecessary... implement as optional if it makes MVP unstable") |

The merged demo pipeline (`workflows/00_FULL_DEMO_PIPELINE.json`) chains
stages 01→08 behind one webhook: `POST /restructra/full-pipeline`. It is
built by `workflows/build_workflow.js` directly from the same JS files
listed above — there is no drift between "the code that was tested" and
"the code inside the n8n JSON" (see `tests/run_tests.js`, which imports and
runs the same logic outside of n8n and is asserted to produce identical
classifications, `docs/TESTING_GUIDE.md`).

## 3. Why this order: Scenario Engine before final Stress Diagnosis

The spec explicitly says a business should only be classified
`STRUCTURAL_CASH_FLOW_PROBLEM` if it "remains unable to sustainably cover
repayment even under reasonable restructuring assumptions" (§20). That
requires knowing the *best* outcome across every scenario (current, longer
tenure at 3 extension levels, temporary relief, step-down, consolidation)
under the BASE stress case. So the engine computes financials → runs every
scenario → then makes the final classification call, folding in
`STRUCTURAL_CASH_FLOW_PROBLEM` only if the best available option among all
computed scenarios still shows a negative `monthlySurplusDeficit.base`.

## 4. Deterministic financial engine

All arithmetic lives in plain, dependency-free JavaScript
(`engine/engine.js` is the canonical, unit-tested copy; the n8n Code nodes
contain the identical logic — verified node-for-node in
`tests/run_tests.js`). Key calculations:

- **Estimated money left after business expenses** = monthly sales − monthly expenses (never called "cash available for debt service" — see spec §17).
- **Estimated money left after loan payments** = the above − total monthly EMI.
- **Internal DSCR** = money left after expenses ÷ total monthly EMI (calculated internally; the user-facing dashboard never shows the acronym).
- **Estimated Comfortable EMI Range** = 40%–55% of money left after expenses, explicitly labelled as an illustrative safety-cushion calculation, never as "Minimum Sustainable EMI" (spec §18).
- **Amortization**: scenario EMI recalculation uses the standard reducing-balance formula `EMI = P·r·(1+r)^n / ((1+r)^n − 1)` against the combined outstanding balance and a weighted-average interest rate/tenure across loans. This is a documented simplification (see `KNOWN_LIMITATIONS.md`) — a fully loan-by-loan amortization schedule was judged unnecessary complexity for the MVP (spec §50).
- **Stress testing**: every scenario is evaluated under BASE (no change), STRESS (revenue −20%), and RECOVERY (revenue +15%), with expenses held constant — assumptions are always returned alongside the numbers, never silently applied.

## 5. Document processing — what's actually implemented

RESTRUCTRA's pipeline **does** process documents end-to-end: type
identification → structured extraction → confidence scoring →
reconciliation against user input → financial engine. What it does **not**
ship is its own OCR/PDF-parsing model — building one would violate spec §50
("do not overengineer... unnecessary APIs"). Instead:

- Each `documents[]` entry the pipeline receives already carries a
  `fields: [{field, value, source, confidence}]` array — exactly the shape
  a real extraction step (Textract, Azure Document Intelligence, or an LLM
  vision call) would produce.
- The bundled sample documents (`samples/documents/*.txt`) are realistic,
  human-readable fictional documents. Their corresponding
  `samples/documents/extracted_documents.json` shows what an extraction
  step's output looks like for each one — this is the file that actually
  feeds the pipeline in the Mode-A sample request.
- Swapping in a real OCR/LLM extraction service means adding one HTTP
  Request node in front of `01-03 Intake, Documents, Reconciliation` that
  turns an uploaded file into that same `fields[]` shape. No other node
  needs to change.
- A document with no usable fields (`extractionFailed: true` or an empty
  `fields[]`) is handled gracefully — reconciliation returns zero conflicts
  and the pipeline continues (`TEST 9`).

## 6. AI safety enforcement (not just prompt wording)

The LLM is used for exactly two calls: "explain the recommendation" and
"write the bank-ready report." Both are single-shot JSON completions over a
pre-computed `ENGINE_OUTPUT` block. After each call:

1. The response is parsed as JSON (markdown fences stripped defensively).
2. Required keys/schema are checked.
3. Every phrase from a banned list (`guarantee`, `guaranteed`, `assured`,
   `promise`, `will be approved`) is checked for and rejected.
4. **Numeric-claim validation**: every number ≥100 that appears anywhere in
   the AI's JSON is checked against a flattened list of every number the
   engine actually produced (financials + every scenario). Any number that
   doesn't trace back to the engine (within 1% tolerance for rounding)
   fails validation.
5. If validation fails for any reason, the workflow **fails closed** to a
   deterministic, engine-numbers-only fallback object
   (`aiUnavailable: true`) — it never fabricates a replacement explanation.

This logic lives in `04_validate_parse_recommendation.js` and
`06_validate_parse_bank_report.js`.

## 7. Data model

See `db/schema.sql`. Nine tables, no unnecessary complexity:
`businesses`, `loans`, `documents`, `extracted_document_data`,
`reconciliation_results`, `financial_snapshots`, `scenarios`,
`recommendations`, `reports`. Raw document bytes are intentionally not
stored in the primary schema (§38 — minimize raw retention); wire in an
object-storage reference (`documents.storage_reference`) if retention is
required.

## 8. n8n workflow inventory

- `workflows/00_FULL_DEMO_PIPELINE.json` — the single merged, importable
  pipeline. `POST /restructra/full-pipeline`.
- `workflows/01_User_Intake.json` … `09_Early_Warning.json` — nine
  standalone modules, each with its own webhook, for testing one pipeline
  stage in isolation without running the whole thing (see
  `docs/TESTING_GUIDE.md`). They call the exact same Code node source files
  as the merged pipeline.
- Both are generated by `workflows/build_workflow.js` and
  `workflows/build_modules.js` respectively — re-run these after editing
  any file in `workflows/node_src/` to keep everything in sync.

## 9. Known engineering trade-offs

See `docs/KNOWN_LIMITATIONS.md` for the full list (amortization
simplification, document extraction boundary, single-currency/INR
assumption, no real bank/lender integrations, IF-node condition syntax may
need a one-time check after import, etc).
