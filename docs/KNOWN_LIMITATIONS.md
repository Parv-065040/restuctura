# RESTRUCTRA — Known Limitations

Read this before treating any part of RESTRUCTRA as production-ready.

## Financial modelling

1. **Aggregate amortization, not loan-by-loan.** Scenario recalculation
   (tenure extension, temporary relief, step-down, consolidation) treats all
   loans as one combined balance at a weighted-average interest rate and
   tenure, then applies the standard reducing-balance EMI formula. This is a
   deliberate simplification (spec §50, "do not overengineer") — a
   fully accurate result would require a loan-by-loan amortization schedule
   with each loan's own compounding convention. Treat every scenario figure
   as **illustrative**, exactly as it is labelled in the output.
2. **Step-down scenario's principal/interest split is approximated**, not a
   true amortization split — flagged explicitly in that scenario's
   `simplification` field.
3. **Fallback assumptions when data is missing**: interest rate defaults to
   14% p.a. and remaining tenure defaults to 36 months when not provided.
   These are documented, flagged (`interestRateAssumed` /
   `tenureAssumed`), and factored into the data-confidence score — but they
   are still assumptions, not facts.
4. **Comfortable EMI Range (40%–55% of money left after expenses)** is an
   illustrative safety-cushion heuristic, not a validated affordability
   model, and is labelled as such everywhere it appears.
5. **Stress test magnitudes (-20% / +15% revenue)** are fixed, documented
   assumptions, not statistically derived from the business's own
   volatility. They exist to sanity-check scenario robustness, not to
   forecast the business's future.

## Document processing

6. **No built-in OCR/PDF parser.** RESTRUCTRA's pipeline consumes documents
   in an already-extracted `fields[]` shape (see
   `docs/ARCHITECTURE.md` §5). Wiring in a real extraction service (OCR +
   LLM vision, Textract, Azure Document Intelligence, etc.) requires adding
   one HTTP Request node before the intake stage — no other node changes.
   Building a bespoke extraction model was judged unnecessary complexity for
   an MVP per spec §50.
7. **Reconciliation only compares three aggregate fields**
   (`monthlyEMI`, `totalOutstanding`, `monthlySales`) out of the box. Adding
   more reconciled fields (e.g., per-loan EMI, business name matching) means
   extending the `userLookup` map in `reconcile()` — the mechanism is
   general-purpose, the field list is intentionally minimal for the MVP.
8. **GST/sales vs. actual cash received are tracked as separate concepts**
   in the sample data and prompts, but the engine does not yet
   automatically reconcile GST-reported turnover against bank-statement
   credits — that cross-check is a natural V2 addition.

## AI layer

9. **Numeric-claim validation is a heuristic, not a formal proof.** It
   flags any number ≥100 in the AI's output that isn't within 1% of some
   number the engine produced. This catches invented or miscalculated
   figures reliably but could, in rare phrasing, reject a legitimate
   restatement (e.g., a sum of two engine numbers the AI computed itself) —
   by design, in that case the pipeline fails closed rather than risk
   showing an unverified figure. If this causes too many false rejections
   in practice, consider having the AI reference numbers by scenario key
   rather than restating them, and have the assembly step substitute the
   real value.
10. **Single-shot LLM calls, no conversation/agentic loop.** This is
    intentional (spec §50 — no unnecessary AI agents) and keeps the
    validation surface small and auditable.
11. **Banned-phrase list is not exhaustive.** It catches the obvious
    guarantee-style phrasings named in the spec (`guarantee`, `assured`,
    `promise`, `will be approved`) but a sufficiently creative model could
    phrase a guarantee-adjacent claim differently. The disclaimer and
    numeric-claim check are the stronger backstops.

## n8n / import mechanics

12. **Credentials never travel with the JSON export**, by n8n design. After
    import, you must create and assign a Header Auth credential (`x-api-key`
    → your Anthropic key) to both HTTP Request nodes — see
    `docs/TESTING_GUIDE.md` §2.1.
13. **The `IF` node's condition object was authored to the current n8n v2
    filter schema** (`n8n-nodes-base.if`, typeVersion 2). n8n's condition UI
    has changed across versions historically; if your instance shows the
    condition as blank or invalid after import, simply re-create it as a
    single Boolean condition: `{{ $json.validation.isValid }}` is `true`.
    Every other node in the workflow (Webhook, Code, HTTP Request, Respond
    to Webhook) uses stable, long-standing schemas and should import
    cleanly.
14. **Modular workflows (01–09) are standalone demo/test workflows**, not
    wired together via `Execute Workflow` nodes. This avoids the brittleness
    of hard-coding another workflow's ID (which differs per n8n instance) —
    see `docs/ARCHITECTURE.md` §8. If you want true cross-workflow
    composition in production, replace the merged pipeline's Code nodes with
    `Execute Workflow` nodes pointing at the imported modules, using your
    instance's actual workflow IDs.
15. **No retry/backoff on the Anthropic HTTP Request nodes.** Both are set
    to `continueRegularOutput` on error so a transient API failure falls
    through to the fail-closed path rather than crashing the execution —
    but there's no automatic retry. Add n8n's built-in retry option on the
    HTTP Request node if you want one before failing closed.

## Data & security

16. **No authentication on the webhook itself.** `00_FULL_DEMO_PIPELINE.json`
    exposes a public POST endpoint for demo purposes. Add n8n's built-in
    webhook authentication (header/basic auth) or place it behind an API
    gateway before handling real user data.
17. **Raw document bytes are not persisted** by the schema (§38 minimize raw
    retention) — only extracted fields and reconciliation results are
    stored. If you need to retain original files for audit purposes, add
    object storage and reference it via `documents.storage_reference`.
18. **Currency is assumed to be INR throughout** (₹ symbols, lakh-scale
    sample data). Adapting to other currencies means removing the
    India-specific formatting in the assembly/report layer — the underlying
    math is currency-agnostic.

## Scope intentionally left out (per spec §42, §50)

19. Early Warning (module 09) ships as a standalone, rule-based module only
    — it is **not** wired into a scheduled/cron trigger or the main
    pipeline, since ongoing monitoring infrastructure (storing snapshots
    over time, scheduling, notification delivery) was explicitly marked
    optional/V2 in the spec.
20. No real lender/banking API integrations, no fake ones either — by
    design.
