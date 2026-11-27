// Shared helpers for the browser tests. Node only, no dependencies besides Playwright.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const REPO = path.resolve(__dirname, '..', '..');

// Playwright is not a dependency of this repo. Look for it in the normal place first, then in the
// shared location of the dev container (/opt/playwright-mcp), or wherever NODE_PATH points.
function loadPlaywright() {
  const tries = ['playwright', '/opt/playwright-mcp/node_modules/playwright'];
  for (const t of tries) { try { return require(t); } catch (e) { /* try next */ } }
  throw new Error('Playwright not found. Run with NODE_PATH=/opt/playwright-mcp/node_modules (dev container) or install playwright.');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Static server that mimics GitHub Pages: "Cache-Control: max-age=600", Last-Modified, and 304 for If-Modified-Since.
function startServer(dir) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname); if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(dir, path.normalize(rel));
    if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
    const st = fs.statSync(file), mtime = Math.floor(st.mtimeMs / 1000) * 1000;
    const ims = req.headers['if-modified-since'];
    requests.push({ path: url.pathname, ims: !!ims });
    const headers = { 'Cache-Control': 'max-age=600', 'Last-Modified': new Date(mtime).toUTCString(), 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' };
    if (ims && Date.parse(ims) >= mtime) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, headers); if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port, requests, close: () => new Promise((r) => { server.close(r); server.closeAllConnections && server.closeAllConnections(); }),
  })));
}

// Copy the website (never the tests or tools) into a fresh temp folder so tests can edit files ("deploy").
function copySite(name) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), `qr-e2e-${name}-`));
  for (const f of fs.readdirSync(REPO)) {
    const p = path.join(REPO, f);
    if (!fs.statSync(p).isFile() || f === 'test-site.js') continue;
    if (/\.(html|css|js|webmanifest|png)$/.test(f)) fs.copyFileSync(p, path.join(dest, f));
  }
  return dest;
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* ignore */ } }

// Collects results; a suite calls check(name, ok, detail).
function makeChecker(suite) {
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `\n        got: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  };
  return { suite, results, check, failed: () => results.filter((r) => !r.ok).length };
}

const SEED_CONFIG = () => {
  try { localStorage.setItem('qr_url', 'https://script.google.com/macros/s/ABC/exec'); localStorage.setItem('qr_token', 'T'.repeat(30)); } catch (e) { /* ignore */ }
};

module.exports = { REPO, loadPlaywright, startServer, copySite, rmrf, makeChecker, SEED_CONFIG, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
