#!/usr/bin/env node
// Build stamp: a short fingerprint (8 hex characters) of ALL website files, written into three of them
// (index.html, style.css, app.js). Settings shows it and warns if the three disagree, i.e. if the phone loaded a
// mix of old and new files. Run this after every change to the site, before committing:
//     node tools/stamp.js          write the stamp
//     node tools/stamp.js --check  only verify (used by test-site.js); exit code 1 if it is out of date
// The stamp lines themselves are left out of the fingerprint, so running it twice changes nothing.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

// The three stamp lines. Each file needs exactly one of them (placeholder 00000000 the first time).
const STAMPS = {
  'index.html': { re: /^<meta name="build" content="[0-9a-f]{8}">\r?\n/m, line: (h) => `<meta name="build" content="${h}">\n` },
  'style.css': { re: /^:root \{ --build:"[0-9a-f]{8}"; \}\r?\n/m, line: (h) => `:root { --build:"${h}"; }\n` },
  'app.js': { re: /^  var BUILD = '[0-9a-f]{8}'; \/\/ build stamp[^\n]*\r?\n/m, line: (h) => `  var BUILD = '${h}'; // build stamp, written by tools/stamp.js\n` },
};

// Every website file: the same rule the browser tests use when they copy the site.
function siteFiles(dir) {
  return fs.readdirSync(dir).filter((f) => /\.(html|css|js|webmanifest|png)$/.test(f) && f !== 'test-site.js' && fs.statSync(path.join(dir, f)).isFile()).sort();
}

function normalised(dir, name) {
  let buf = fs.readFileSync(path.join(dir, name));
  if (STAMPS[name]) buf = Buffer.from(buf.toString('utf8').replace(STAMPS[name].re, ''), 'utf8');
  return buf;
}

function fingerprint(dir) {
  const h = crypto.createHash('sha256');
  for (const name of siteFiles(dir)) { h.update(name + '\0'); h.update(normalised(dir, name)); h.update('\0'); }
  return h.digest('hex').slice(0, 8);
}

// What is written in the three files right now ('' if a line is missing).
function stamped(dir) {
  const out = {};
  for (const [name, s] of Object.entries(STAMPS)) {
    const m = s.re.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
    out[name] = m ? /[0-9a-f]{8}/.exec(m[0])[0] : '';
  }
  return out;
}

function check(dir) {
  const want = fingerprint(dir), have = stamped(dir);
  const ok = Object.values(have).every((v) => v === want);
  return { ok, want, have };
}

function write(dir) {
  const want = fingerprint(dir);
  for (const [name, s] of Object.entries(STAMPS)) {
    const p = path.join(dir, name), text = fs.readFileSync(p, 'utf8');
    if (!s.re.test(text)) throw new Error(`${name} has no build stamp line yet (expected ${s.line('00000000').trim()})`);
    fs.writeFileSync(p, text.replace(s.re, s.line(want)));
  }
  return want;
}

module.exports = { siteFiles, fingerprint, stamped, check, write, STAMPS, ROOT };

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const r = check(ROOT);
    if (r.ok) console.log('build stamp is up to date: ' + r.want);
    else { console.error(`Build stamp is OUT OF DATE (files hash to ${r.want}, stamped ${JSON.stringify(r.have)}). Run: node tools/stamp.js`); process.exit(1); }
  } else {
    console.log('build stamp written: ' + write(ROOT));
  }
}
