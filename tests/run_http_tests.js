'use strict';
/**
 * Runs all 10 test fixtures against a LIVE n8n import of
 * 00_FULL_DEMO_PIPELINE.json via its webhook.
 *
 * Usage:
 *   node run_http_tests.js http://localhost:5678/webhook/restructra/full-pipeline
 *
 * This complements run_tests.js (which tests the deterministic engine
 * directly, with no n8n/LLM involved). This script exercises the whole
 * HTTP pipeline including the AI recommendation + bank report calls, so it
 * requires the Anthropic credential to be configured in n8n first.
 */
const fs = require('fs');
const path = require('path');

const url = process.argv[2];
if (!url) {
  console.error('Usage: node run_http_tests.js <webhook-url>');
  process.exit(1);
}

const fixturesDir = path.join(__dirname, 'fixtures');
const files = fs.readdirSync(fixturesDir).sort();

async function main() {
  let pass = 0, fail = 0;
  for (const file of files) {
    const body = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      const ok = res.status === 200 && json.status === 'success' && Array.isArray(json.stressClassifications);
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}  status=${res.status}  classifications=${(json.stressClassifications || []).join(',')}`);
      ok ? pass++ : fail++;
    } catch (e) {
      console.log(`FAIL  ${file}  error=${e.message}`);
      fail++;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed out of ${files.length}`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
