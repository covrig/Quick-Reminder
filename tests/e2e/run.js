#!/usr/bin/env node
// Browser tests for the website. Usage:
//   NODE_PATH=/opt/playwright-mcp/node_modules node tests/e2e/run.js [--only shift|sw|ui]
// Needs Playwright with Chromium (not a dependency of this repo). Writes only to the OS temp folder.
'use strict';
const { loadPlaywright } = require('./lib');

const SUITES = { shift: './shift', sw: './sw', ui: './ui' };

(async () => {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  if (only && !SUITES[only]) { console.error(`Unknown suite "${only}". Choose: ${Object.keys(SUITES).join(', ')}`); process.exit(2); }
  const pw = loadPlaywright();
  let failed = 0, total = 0;
  for (const name of Object.keys(SUITES)) {
    if (only && only !== name) continue;
    console.log(`\n=== ${name} ===`);
    const t0 = Date.now();
    let C;
    try { C = await require(SUITES[name])(pw); }
    catch (e) { console.log(`  FAIL  suite crashed: ${e.stack || e.message}`); failed++; total++; continue; }
    failed += C.failed(); total += C.results.length;
    console.log(`  -> ${C.results.length - C.failed()}/${C.results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  console.log(`\n${failed ? 'FAILED' : 'ALL PASSED'}: ${total - failed}/${total} checks`);
  process.exit(failed ? 1 : 0);
})();
