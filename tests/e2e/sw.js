// Suite "sw": after a deploy the installed app must always run ONE consistent version.
// GitHub Pages sends "Cache-Control: max-age=600"; a naive service worker then shows old files (or a mix of new HTML and
// old JS/CSS) for up to 10 minutes. We "deploy" new versions by editing a temp copy of the site that carries a version
// marker in index.html (meta), app.js (window.__appv) and style.css (--v), and relaunch with a persistent browser profile
// (new browser process, same HTTP cache + service worker) like an installed app that was killed and opened again.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { copySite, rmrf, startServer, makeChecker, SEED_CONFIG, sleep } = require('./lib');

const same = (o, v) => o.html === String(v) && o.js === v && o.css === String(v);
const fmt = (o) => `html=${o.html} js=${o.js} css=${o.css}`;

async function flow(pw, start, C) {
  const dir = copySite('sw');
  const edit = (f, a, b) => fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(dir, f), 'utf8').replace(a, b));
  // version 1 markers
  fs.writeFileSync(path.join(dir, 'app.js'), 'window.__appv = 1;\n' + fs.readFileSync(path.join(dir, 'app.js'), 'utf8'));
  edit('index.html', '<meta charset="utf-8">', '<meta charset="utf-8"><meta name="v" content="1">');
  fs.writeFileSync(path.join(dir, 'style.css'), ':root{--v:1}\n' + fs.readFileSync(path.join(dir, 'style.css'), 'utf8'));
  const deploy = (v) => { edit('app.js', `__appv = ${v - 1}`, `__appv = ${v}`); edit('index.html', `content="${v - 1}"`, `content="${v}"`); edit('style.css', `--v:${v - 1}`, `--v:${v}`); };

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-e2e-profile-'));
  const launch = () => pw.chromium.launchPersistentContext(profile, { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const read = (p) => p.evaluate(() => ({ html: (document.querySelector('meta[name=v]') || {}).content, js: window.__appv, css: getComputedStyle(document.documentElement).getPropertyValue('--v').trim(), chips: document.querySelectorAll('#chips label').length }));
  const open = async (ctx, url) => { const p = ctx.pages()[0] || await ctx.newPage(); await p.addInitScript(SEED_CONFIG); await p.goto(url); return p; };
  let server = await startServer(dir); const url = `http://127.0.0.1:${server.port}${start}`;
  const label = `start URL ${start}`;
  try {
    let ctx = await launch(); let p = await open(ctx, url); await p.waitForTimeout(1500); await p.goto(url); await p.waitForTimeout(500); // 2nd load: service worker in control
    C.check(`${label}: version 1 on first install`, same(await read(p), 1));
    await ctx.close();

    deploy(2); await sleep(2200); // file times have 1 s resolution; stay well inside the 10 minute max-age
    ctx = await launch(); p = await open(ctx, url); await p.waitForTimeout(900);
    let r = await read(p); C.check(`${label}: cold launch after deploy 2 shows HTML, JS and CSS of version 2`, same(r, 2), fmt(r));

    deploy(3); await sleep(2200);
    await p.reload(); await p.waitForTimeout(900); r = await read(p);
    C.check(`${label}: pull-to-refresh after deploy 3 shows version 3 everywhere`, same(r, 3), fmt(r));
    await p.reload(); await p.waitForTimeout(900); r = await read(p);
    C.check(`${label}: a second refresh stays consistent`, same(r, 3), fmt(r));
    await ctx.close();

    // offline: stop the server; the app must open from the stored copy, with its time buttons
    await server.close();
    ctx = await launch(); p = await ctx.pages()[0] || await ctx.newPage(); await p.addInitScript(SEED_CONFIG);
    for (const sub of ['/', '/index.html', '/?to=work&when=now']) {
      let out; try { await p.goto(`http://127.0.0.1:${server.port}${sub}`, { timeout: 8000 }); await p.waitForTimeout(500); out = await p.evaluate(() => ({ chips: document.querySelectorAll('#chips label').length, js: window.__appv, to: (document.querySelector('input[name=t]:checked') || {}).value })); }
      catch (e) { out = { error: e.message.split('\n')[0] }; }
      const want = sub.includes('to=work') ? 'work' : 'personal';
      C.check(`${label}: OFFLINE ${sub} opens with the stored copy`, out.chips === 9 && out.js === 3 && out.to === want, out);
    }
    await ctx.close();
  } finally { await server.close().catch(() => {}); rmrf(dir); rmrf(profile); }
}

module.exports = async function run(pw) {
  const C = makeChecker('sw');
  await flow(pw, '/', C);
  await flow(pw, '/index.html', C);
  return C;
};
