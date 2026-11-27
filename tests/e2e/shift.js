// Suite "shift": the page must not move while it loads (the time buttons used to appear late and push everything down).
// Measured with the Layout Instability API plus the position of the date field on every animation frame.
'use strict';
const { copySite, rmrf, startServer, makeChecker } = require('./lib');

const INIT = () => {
  window.__ls = []; window.__frames = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ls.push({ v: e.value, t: Math.round(e.startTime), moved: (e.sources || []).map(s => ((s.node && (s.node.id || s.node.className || s.node.nodeName)) || '?') + ' ' + Math.round(s.currentRect.y - s.previousRect.y) + 'px') }); }).observe({ type: 'layout-shift', buffered: true }); } catch (e) { /* ignore */ }
  const t0 = performance.now();
  const tick = () => { const at = document.getElementById('at'), ch = document.getElementById('chips');
    window.__frames.push({ t: Math.round(performance.now() - t0), atTop: at ? Math.round(at.getBoundingClientRect().top) : null, chips: ch ? ch.children.length : null });
    if (performance.now() - t0 < 3000) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};

async function scenario(pw, port, label, { latency, cpu, warm, mode }, C) {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(INIT);
  await page.addInitScript((mode) => { try {
    if (mode !== 'firstrun') { localStorage.setItem('qr_url', 'https://script.google.com/macros/s/ABC/exec'); localStorage.setItem('qr_token', 'T'.repeat(30)); }
    if (mode === 'custom') localStorage.setItem('qr_presets', '7:45\n12:00 pm\n+30m\n+2h');
  } catch (e) { /* ignore */ } }, mode || 'configured');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (latency) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: 4 * 1024 * 1024 / 8, uploadThroughput: 1024 * 1024 / 8 });
  if (cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const url = `http://127.0.0.1:${port}/index.html`;
  if (warm) { await page.goto(url); await page.waitForTimeout(1500); }
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({ shifts: window.__ls, frames: window.__frames, chips: document.querySelectorAll('#chips label').length, setupShown: !document.getElementById('setup').hidden }));
  await browser.close();
  const total = r.shifts.reduce((a, s) => a + s.v, 0);
  const tops = [...new Set(r.frames.map((f) => f.atTop))];
  const firstWithChips = r.frames.find((f) => f.chips > 0);
  C.check(`${label}: no layout shift`, r.shifts.length === 0, `${r.shifts.length} shift(s), CLS ${total.toFixed(4)}: ${JSON.stringify(r.shifts)}`);
  C.check(`${label}: nothing moves between frames`, tops.length === 1, `date field top took values ${tops.join(' -> ')}`);
  C.check(`${label}: time buttons are there from the first painted frame`, firstWithChips && firstWithChips.t === r.frames[0].t, `first frame t=${r.frames[0] && r.frames[0].t}, buttons from t=${firstWithChips && firstWithChips.t}`);
  C.check(`${label}: no script errors`, errors.length === 0, errors);
  if (mode === 'firstrun') C.check(`${label}: first run shows the settings screen`, r.setupShown);
  if (mode === 'custom') C.check(`${label}: custom list of 4 + Now is rendered`, r.chips === 5, r.chips);
}

module.exports = async function run(pw) {
  const C = makeChecker('shift');
  const dir = copySite('shift'); const server = await startServer(dir);
  try {
    await scenario(pw, server.port, 'fast local load', {}, C);
    await scenario(pw, server.port, 'cold start, 150 ms latency + 4x CPU', { latency: 150, cpu: 4 }, C);
    await scenario(pw, server.port, '2nd launch (service worker active), throttled', { latency: 150, cpu: 4, warm: true }, C);
    await scenario(pw, server.port, 'custom time buttons, cold + throttled', { latency: 150, cpu: 4, mode: 'custom' }, C);
    await scenario(pw, server.port, 'first run (no settings saved), cold + throttled', { latency: 150, cpu: 4, mode: 'firstrun' }, C);
  } finally { await server.close(); rmrf(dir); }
  return C;
};
