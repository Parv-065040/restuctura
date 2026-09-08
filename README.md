# RESTRUCTRA Frontend — User-Friendly Prototype

RESTRUCTRA is an AI-based EMI restructuring decision-support experience for MSMEs.

## Modes

The UI supports two modes:

- `demo` (default): no n8n/Groq request is made. This is the safe mode for UI polishing and presentations.
- `live`: one POST is made to the configured n8n webhook when an assessment is submitted. There is **no automatic retry**, so a transient API/rate-limit error does not create a request loop.

Set these variables in `.env.local`:

```env
VITE_RESTRUCTRA_MODE=demo
VITE_N8N_WEBHOOK_URL=http://localhost:5678/webhook/restructra/full-pipeline
```

Change `demo` to `live` only when you are ready to test the backend. Keep all AI provider secrets inside n8n; never put a Groq/API key in this React app. The bundled workflow has been sanitised and reads `GROQ_API_KEY` from the n8n runtime environment rather than shipping a secret in the JSON.

## Current prototype mode

The frontend is intentionally **backend-off** for this iteration so repeated testing does not call or consume the Groq/n8n API.

The complete user journey is functional:

1. Landing page
2. Business information intake
3. Add multiple loan/EMI obligations
4. Upload and remove documents locally in the UI
5. Review submitted information
6. Analysis/progress experience
7. Results dashboard
8. Scenario comparison
9. Bank-ready discussion plan
10. Print / Save as PDF

The result screens use the validated RESTRUCTRA demo response in demo mode. In live mode, the intake form sends the questionnaire plus the actual uploaded files as one multipart request to n8n.

## Later backend integration

The intended request payload is already represented by the intake state:

```js
{
  companyName,
  businessType,
  monthlySales,
  monthlyExpenses,
  cashReserve,
  customersPayingLate,
  receivablesAmount,
  incomeOutlook,
  mainProblem,
  urgency,
  loans: [...],
  documents: [...]
}
```

The frontend now contains that integration. `Analysis` builds the request with `buildAssessmentRequest()`, calls `getAssessment()` once, and stores the normalized response for Dashboard → Scenarios → Bank Plan. The financial calculations remain owned by the n8n deterministic engine.

### Backend setup when you are ready
1. Import the bundled workflow into n8n.
2. Configure `GROQ_API_KEY` in the n8n runtime/environment, or replace the two Groq HTTP nodes with your preferred n8n credential.
3. Activate the workflow and confirm the POST webhook is reachable from the browser.
4. In the React app, set `VITE_RESTRUCTRA_MODE=live` and `VITE_N8N_WEBHOOK_URL` to the webhook URL.
5. Submit **one** test assessment. The frontend does not auto-retry failed requests.

### Document limitation in this iteration
The live integration now sends the actual document binaries to n8n. The supplied workflow splits the multipart upload, extracts supported PDF/XLSX/XLS/CSV/TXT/ODS/RTF/HTML/JSON/XML files with native `Extract From File` nodes, converts the extracted content into conservative financial fields, and passes those fields into the existing reconciliation + deterministic financial engine. Image-only/scanned PDFs are flagged rather than guessed; an OCR/vision provider can be added later if needed.

## Run

```powershell
npm install
npm run dev
```

Open the Vite URL shown in the terminal, normally `http://localhost:5173`.

## Important

- No n8n request is made by default.
- No Groq request is made by default in `demo` mode.
- In `live` mode, the browser makes one n8n request per submitted assessment; there is no automatic retry.
- Uploaded document contents are extracted in n8n, not in the browser. The browser only transfers the selected files to the webhook.
- Financial calculations remain backend responsibilities.
## Document extraction (V2)

The n8n workflow uses fixed native **Extract From File** operations behind file-type routing. The Operation field is intentionally not dynamic because n8n requires a supported fixed action such as `text`, `pdf`, `csv`, `xlsx`, etc. Uploaded files are routed by extension, extracted, aggregated, and then passed to reconciliation. Unsupported files are retained as extraction failures rather than guessed.

Supported routes: TXT, CSV, PDF, XLSX, XLS, ODS, RTF, HTML, JSON, XML.
