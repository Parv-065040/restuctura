# RESTRUCTRA — Test Suite & Expected Results

All 10 fixtures live in `fixtures/*.json` and are verified by `run_tests.js`
against the exact same Code node logic used in the n8n workflow (see
`workflows/build_workflow.js`, which assembles the workflow from these
identical source files). Run:

```bash
cd tests
node run_tests.js
```

Expected: `10 passed, 0 failed out of 10`. Full computed output for every
fixture is written to `tests/actual_results.json` after each run.

---

## TEST 1 — Healthy MSME (`test1_healthy.json`)
- **Input**: Strong sales (₹32L/mo), modest expenses, one loan, low receivables, good cash buffer.
- **Expected calculations**: internalDSCR ≈ 14.7, cashBufferMonths ≈ 17.6, receivablesRatio ≈ 0.125.
- **Expected classification**: `HEALTHY` only.
- **Expected recommendation**: "Continue monitoring" — no restructuring.
- **Expected warnings**: none.

## TEST 2 — Temporary receivables-driven cash stress (`test2_temporary_liquidity_stress.json`)
- **Input**: canonical MSME. Receivables ≈ 48% of monthly sales, customers paying late = Yes.
- **Expected classification**: includes `TEMPORARY_LIQUIDITY_STRESS`.
- **Expected recommendation**: temporary relief considered/preferred over tenure extension or consolidation.

## TEST 3 — High EMI but viable business (`test3_high_emi_viable.json`)
- **Input**: single large loan, EMI consumes >60% of estimated money left after expenses.
- **Expected classification**: includes `HIGH_EMI_BURDEN`.
- **Expected**: tenure-extension scenario (`extend_50pct`) restores a positive monthly surplus — tenure extension is the sensible primary path.

## TEST 4 — Multiple loans (`test4_multiple_loans.json`)
- **Input**: 4 loans from 4 lenders.
- **Expected classification**: includes `MULTIPLE_LOAN_COMPLEXITY`.
- **Expected**: `scenarios.consolidation` is evaluated (not marked `unavailable`) and carries an explicit `recommended: true/false` — never assumed true. In this fixture the calculated benefit is negative, so `recommended: false` with a clear note.

## TEST 5 — Structural cash-flow problem (`test5_structural_problem.json`)
- **Input**: sales barely cover expenses, heavy EMI load, declining outlook, missed a payment already.
- **Expected classification**: includes `STRUCTURAL_CASH_FLOW_PROBLEM`.
- **Expected messaging**: "Restructuring alone may not solve the underlying issue" (enforced in the recommendation prompt's rule 5, and checked implicitly by the classification itself).

## TEST 6 — Missing loan tenure (`test6_missing_tenure.json`)
- **Input**: all 3 loans have `remainingTenure` and `interestRatePct` stripped.
- **Expected**: `fin.tenureAssumed === true` and `fin.interestRateAssumed === true` (documented fallback assumptions: 36 months / 14% p.a.), `dataConfidence.level` degraded from `HIGH`.
- **Expected UX**: scenario outputs are still produced, but every scenario carries its usual "illustrative" disclaimer plus the assumption is visible in `fin`.

## TEST 7 — Missing optional documents (`test7_missing_optional_documents.json`)
- **Input**: canonical MSME, `documents: []`.
- **Expected**: pipeline completes normally (`fatal` is falsy), zero reconciliation results, no crash. Matches the product rule: "Don't have the optional documents? That's okay."

## TEST 8 — User/document conflict (`test8_user_document_conflict.json`)
- **Input**: one document reports `monthlyEMI: 145000` and `totalOutstanding: 4700000` vs the user's totals of `138500` and `4600000`.
- **Expected**: `reconciliationResults[0].hasConflicts === true`, with a `monthlyEMI` conflict record showing `userValue: 138500`, `documentValue: 145000`. The engine never silently overwrites either value.

## TEST 9 — Unreadable document (`test9_unreadable_document.json`)
- **Input**: a document with `extractionFailed: true` and an empty `fields[]`.
- **Expected**: pipeline does not crash; reconciliation returns `hasConflicts: false` and flags `extractionFailed: true` for that document, matching the "manual entry fallback" behaviour.

## TEST 10 — Sharp revenue decline (`test10_sharp_revenue_decline.json`)
- **Input**: canonical MSME with `monthlySales` cut from ₹20L to ₹9L and `incomeOutlook: Decrease`.
- **Expected classification**: worsens to include `HIGH_EMI_BURDEN` and/or `STRUCTURAL_CASH_FLOW_PROBLEM` (both fire in this fixture), demonstrating the stress classification responds to a revenue shock.

---

## AI-layer tests (manual / with a configured Anthropic credential)

The 10 tests above exercise the deterministic engine only (no API key
required). Once an Anthropic credential is wired into
`00_FULL_DEMO_PIPELINE.json`, additionally verify:

- **AI-1 Numeric fidelity**: for `test1_healthy.json`, confirm the returned
  `recommendation` contains no figures other than what's in `detailedFinancialView`.
- **AI-2 Guarantee language**: grep the full response for "guarantee",
  "assured", "promise" — must return zero matches.
- **AI-3 Fail-closed path**: temporarily point the HTTP Request node at an
  invalid URL (or revoke the credential) and confirm the response still
  returns `status: "success"` with `recommendation.aiUnavailable: true` and
  a deterministic, engine-only summary — never an HTTP 500 or a fabricated
  recommendation.
