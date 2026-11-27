// Suite "ui": behaviour of the page in a phone-sized mobile browser, with the network stubbed (nothing is ever sent).
'use strict';
const { copySite, rmrf, startServer, makeChecker } = require('./lib');

// The page reports colours as rgb(...) or color(srgb ...). The app is always dark: selected buttons are their base
// colour mixed 62% with white (see style.css), so compare by value.
const rgbOf = (str) => { const m = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(str); if (m) return [m[1], m[2], m[3]].map((v) => Math.round(parseFloat(v) * 255)); const n = /rgba?\((\d+), (\d+), (\d+)/.exec(str); return n ? [+n[1], +n[2], +n[3]] : null; };
const mixWhite = (hex) => [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.62 + 255 * 0.38));
const isMix = (str, hex) => { const a = rgbOf(str), b = mixWhite(hex); return !!a && a.every((v, i) => Math.abs(v - b[i]) <= 2); };

// First visit of a tab: clean storage + saved URL/token. Reloads in the same tab keep whatever the page saved.
const SEED = () => { try {
  if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('qr_url', 'https://script.google.com/macros/s/ABC/exec'); localStorage.setItem('qr_token', 'T'.repeat(30)); sessionStorage.setItem('seeded', '1'); }
} catch (e) { /* ignore */ } };

async function newPage(pw, base, opts = {}) {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: opts.width || 412, height: opts.height || 915 }, isMobile: true, hasTouch: true, colorScheme: opts.scheme || 'light', deviceScaleFactor: opts.scale || 1 });
  const page = await ctx.newPage();
  const problems = { errors: [], violations: [], posts: [] };
  page.on('pageerror', (e) => problems.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') problems.errors.push(m.text()); });
  page.on('request', (r) => { if (r.method() === 'POST') problems.posts.push(r.url()); });
  await page.addInitScript(SEED);
  await page.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => (window.__viol = window.__viol || []).push(e.violatedDirective + ' <- ' + e.blockedURI)); });
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(base + (opts.path || '/index.html')); await page.waitForTimeout(400);
  return { browser, ctx, page, problems };
}

module.exports = async function run(pw) {
  const C = makeChecker('ui'), { check } = C;
  const dir = copySite('ui'); const server = await startServer(dir); const base = `http://127.0.0.1:${server.port}`;
  try {
    // ---------- page structure, colours, recipients, details, date field ----------
    {
      const { browser, page, problems } = await newPage(pw, base);
      const r = await page.evaluate(async () => {
        const $ = (id) => document.getElementById(id), f = $('f'), out = {};
        const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor, wait = (ms) => new Promise(r => setTimeout(r, ms));
        out.chips = [...document.querySelectorAll('#chips span')].map(e => e.textContent);
        out.labels = [...document.querySelectorAll('.lbl')].map(e => e.textContent);
        out.defaults = { recipient: f.t.value, chip: f.p.value, hint: $('when').textContent };
        out.nowBg = bg('input[name=p][value=now] + span');
        document.querySelector('input[name=p][value="1800"]').click(); out.sel6pm = bg('input[name=p][value="1800"] + span'); out.idleBg = bg('input[name=p][value="1900"] + span');
        out.personalBg = bg('input[value=personal] + span');
        document.querySelector('input[name=t][value=work]').click(); out.workBg = bg('input[value=work] + span'); out.workReset = { chip: f.p.value, hint: $('when').textContent };
        document.querySelector('input[name=t][value=personal]').click();
        const ta = $('msg'), h = () => Math.round(ta.getBoundingClientRect().height);
        out.ta = { collapsed: h() }; ta.focus(); await wait(250); out.ta.focused = h(); ta.blur(); await wait(250); out.ta.blurredEmpty = h();
        const at = $('at'), ph = document.querySelector('.dt .ph');
        out.ph = { empty: getComputedStyle(ph).display }; at.value = '2026-12-01T10:00'; at.dispatchEvent(new Event('input'));
        out.ph.filled = getComputedStyle(ph).display; out.ph.chipsCleared = !document.querySelector('#chips input:checked');
        document.querySelector('input[name=p][value="3h"]').click(); out.ph.afterChip = { at: at.value, ph: getComputedStyle(ph).display };
        out.overflowX = document.documentElement.scrollWidth - innerWidth; out.htmlBg = getComputedStyle(document.documentElement).backgroundColor;
        return out;
      });
      check('nine time buttons in the default order', JSON.stringify(r.chips) === JSON.stringify(['Now', '8:30 AM', '9:30 AM', '3:00 PM', '6:00 PM', '7:00 PM', '1 h', '3 h', '6 h']), r.chips);
      check('no "When" title and no "Or pick date and time" label (the field says it itself)', !r.labels.some((l) => /^\s*(When|Or pick date and time)\s*$/.test(l)), r.labels);
      check('defaults: Personal, Now, "Will send immediately"', r.defaults.recipient === 'personal' && r.defaults.chip === 'now' && r.defaults.hint === 'Will send immediately', r.defaults);
      check('only the selected time button is coloured (Now green, 6 PM its own colour, others plain)', isMix(r.nowBg, '#1e8e4e') && isMix(r.sel6pm, '#649717') && r.idleBg === 'rgba(0, 0, 0, 0)', [r.nowBg, r.sel6pm, r.idleBg]);
      check('recipient colours: Personal blue, Work red', isMix(r.personalBg, '#1a73e8') && isMix(r.workBg, '#d9534f'), [r.personalBg, r.workBg]);
      check('switching to Work puts the time back to Now', r.workReset.chip === 'now' && r.workReset.hint === 'Will send immediately', r.workReset);
      check('Details start collapsed (48 px), grow when focused, collapse again when empty', r.ta.collapsed === 48 && r.ta.focused > 100 && r.ta.blurredEmpty === 48, r.ta);
      check('date field: placeholder when empty, hidden when filled, chips deselected; a chip clears the date', r.ph.empty === 'flex' && r.ph.filled === 'none' && r.ph.chipsCleared && r.ph.afterChip.at === '' && r.ph.afterChip.ph === 'flex', r.ph);
      check('no sideways scrolling; html paints its own background', r.overflowX === 0 && r.htmlBg === 'rgb(0, 0, 0)', [r.overflowX, r.htmlBg]);
      check('no script errors or CSP violations', problems.errors.length === 0 && ((await page.evaluate(() => window.__viol || [])).length === 0), [problems.errors, await page.evaluate(() => window.__viol)]);
      await browser.close();
    }

    // ---------- settings: open/close, prefix, custom time buttons, forget ----------
    {
      const { browser, page } = await newPage(pw, base);
      const r = await page.evaluate(async () => {
        const $ = (id) => document.getElementById(id), f = $('f'), setup = $('setup'), gear = $('gear'), out = {};
        const state = () => ({ setup: !setup.hidden, form: !f.hidden, gear: gear.textContent });
        gear.click(); out.open = state(); gear.click(); out.closedByButton = state();
        gear.click(); gear.click(); out.closedByTopButton = state();
        gear.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); out.closedByEscape = state();
        gear.click(); $('cfgPrefix').value = '[Never saved]'; $('cfgPresets').value = '1:00'; gear.click(); gear.click();
        out.discarded = { prefix: $('cfgPrefix').value, lines: $('cfgPresets').value.split('\n').length }; gear.click();
        // bad input is rejected and nothing is saved
        gear.click(); $('cfgPresets').value = '8:30\nlunch'; setup.requestSubmit(); out.badLine = { msg: $('cfgMsg').textContent, stored: localStorage.getItem('qr_presets'), stillOpen: !setup.hidden };
        $('cfgUrl').value = 'https://evil.example/x'; $('cfgPresets').value = '8:30'; setup.requestSubmit(); out.badHost = $('cfgMsg').textContent;
        $('cfgUrl').value = 'https://script.google.com/macros/s/ABC/exec'; $('cfgToken').value = 'short'; setup.requestSubmit(); out.shortToken = $('cfgMsg').textContent;
        // valid custom list + prefix
        $('cfgToken').value = ''; $('cfgPresets').value = '7:45\n+30m'; $('cfgPrefix').value = '  [Update]  '; setup.requestSubmit();
        out.custom = { chips: [...document.querySelectorAll('#chips span')].map(e => e.textContent), prefix: localStorage.getItem('qr_prefix'), maxLen: $('subject').maxLength, formShown: !f.hidden };
        $('cfgPresets'); gear.click(); $('cfgReset').click(); $('cfgPrefix').value = ''; setup.requestSubmit();
        out.restored = { chips: document.querySelectorAll('#chips label').length, prefix: localStorage.getItem('qr_prefix'), presets: localStorage.getItem('qr_presets'), maxLen: $('subject').maxLength };
        gear.click(); $('cfgPrefix').value = '[X]'; setup.requestSubmit(); gear.click(); $('cfgClear').click();
        out.forgot = { keys: Object.keys(localStorage), setup: !setup.hidden, chips: document.querySelectorAll('#chips label').length };
        return out;
      });
      check('settings open with a ✕ and close by button, top ✕ and Escape', r.open.setup && !r.open.form && r.open.gear === '✕' && r.closedByButton.form && r.closedByButton.gear === '⚙' && r.closedByTopButton.form && r.closedByEscape.form, r);
      check('closing discards unsaved edits', r.discarded.prefix === '' && r.discarded.lines === 8, r.discarded);
      check('invalid time buttons / host / short token are rejected and nothing is saved', /^Line 2:/.test(r.badLine.msg) && r.badLine.stored === null && r.badLine.stillOpen && /script\.google\.com/.test(r.badHost) && /too short/.test(r.shortToken), r);
      check('custom time buttons and the subject prefix are saved (prefix trimmed, subject limit shrinks)', JSON.stringify(r.custom.chips) === JSON.stringify(['Now', '7:45 AM', '30 min']) && r.custom.prefix === '[Update]' && r.custom.maxLen === 191 && r.custom.formShown, r.custom);
      check('reset restores the 9 default buttons and removes the stored list and prefix', r.restored.chips === 9 && r.restored.prefix === null && r.restored.presets === null && r.restored.maxLen === 200, r.restored);
      check('"Forget this phone\'s settings" clears everything and shows the settings screen', r.forgot.keys.length === 0 && r.forgot.setup && r.forgot.chips === 9, r.forgot);
      await browser.close();
    }

    // ---------- sending: payload and every result message ----------
    {
      const { browser, page } = await newPage(pw, base);
      const r = await page.evaluate(async () => {
        const wait = (ms) => new Promise(r => setTimeout(r, ms)), $ = (id) => document.getElementById(id);
        const f = $('f'), btn = $('btn'), st = $('status'), subj = $('subject'), msg = $('msg'), out = {};
        const reqs = []; let rel;
        window.fetch = (u, o) => new Promise((res, rej) => { reqs.push({ u, body: JSON.parse(o.body), type: o.headers['Content-Type'] }); rel = { ok: (d) => res({ json: () => Promise.resolve(d) }), json: (fn) => res({ json: fn }), fail: (e) => rej(e) }; });
        const go = async (s, m, how) => { subj.value = s; msg.value = m || ''; f.requestSubmit(); await wait(20); const sending = { text: btn.textContent, disabled: btn.disabled }; how(); await wait(60); return sending; };
        // success, subject only; payload
        document.querySelector('input[name=t][value=work]').click();
        out.sending = await go('call dentist', '', () => rel.ok({ ok: true, status: 'Sent' }));
        await wait(300); // the button fades to green over 0.2 s
        out.sent = { btn: btn.textContent, done: btn.classList.contains('done'), green: getComputedStyle(btn).backgroundColor, subject: subj.value, status: st.textContent };
        out.payload = { token: reqs[0].body.token.length, subject: reqs[0].body.subject, body: reqs[0].body.body, target: reqs[0].body.target, sendAt: reqs[0].body.sendAt, type: reqs[0].type, tokenInUrl: reqs[0].u.includes('TTTT') };
        await wait(3100); out.reset = { text: btn.textContent, done: btn.classList.contains('done') };
        // scheduled
        document.querySelector('input[name=p][value="3h"]').click();
        await go('later', '', () => rel.ok({ ok: true, status: 'Scheduled' })); out.scheduled = { text: btn.textContent, sendAt: !!reqs[1].body.sendAt }; await wait(3100);
        // failures
        out.errors = {};
        await go('x', '', () => rel.ok({ ok: false, error: 'Unauthorized' })); out.errors.server = st.textContent;
        await go('x', '', () => rel.json(() => Promise.reject(new SyntaxError('Unexpected token <')))); out.errors.nonJson = st.textContent;
        await go('x', '', () => rel.fail(Object.assign(new Error('aborted'), { name: 'AbortError' }))); out.errors.timeout = st.textContent;
        await go('x', '', () => rel.fail(new TypeError('Failed to fetch'))); out.errors.network = st.textContent;
        out.afterError = { btn: btn.textContent, disabled: btn.disabled, subjectKept: subj.value };
        // validation: nothing is sent
        const n = reqs.length; subj.value = ''; msg.value = ''; f.requestSubmit(); await wait(30); out.empty = { status: st.textContent, sent: reqs.length - n };
        // capitalisation + links, prefix
        await go('buy milk', '', () => rel.ok({ ok: true, status: 'Sent' })); out.capital = reqs[reqs.length - 1].body.subject; await wait(3100);
        await go('https://a.example/x', '', () => rel.ok({ ok: true, status: 'Sent' })); out.link = reqs[reqs.length - 1].body.subject; await wait(3100);
        return out;
      });
      check('sending shows "Sending…" (button disabled), then "Sent ✓" in green, clears the form, returns to "Send" after 3 s', r.sending.text === 'Sending…' && r.sending.disabled && r.sent.btn === 'Sent ✓' && r.sent.done && r.sent.green === 'rgb(111, 207, 151)' && r.sent.subject === '' && r.reset.text === 'Send' && !r.reset.done, r);
      check('payload: token in the body (not the URL), text/plain, subject only, recipient, no time for "Now"', r.payload.token === 30 && !r.payload.tokenInUrl && /^text\/plain/.test(r.payload.type) && r.payload.subject === 'Call dentist' && r.payload.body === '' && r.payload.target === 'work' && r.payload.sendAt === '', r.payload);
      check('a time button sends an ISO time and shows "Scheduled ✓"', r.scheduled.text === 'Scheduled ✓' && r.scheduled.sendAt, r.scheduled);
      check('failure messages: server error, non-JSON reply, timeout, no connection', r.errors.server === 'Unauthorized' && /^Unexpected reply\. Not confirmed/.test(r.errors.nonJson) && /^Timed out\. Not confirmed/.test(r.errors.timeout) && r.errors.network === 'No connection. Not sent.', r.errors);
      check('after an error the button is usable again and the text is kept', r.afterError.btn === 'Send' && !r.afterError.disabled && r.afterError.subjectKept === 'X', r.afterError);
      check('empty subject and details: error shown, nothing sent', /Enter a subject or details/.test(r.empty.status) && r.empty.sent === 0, r.empty);
      check('subject: first letter capitalised, links left alone', r.capital === 'Buy milk' && r.link === 'https://a.example/x', [r.capital, r.link]);
      await browser.close();
    }

    // ---------- share target and shortcut parameters ----------
    {
      const { browser, page, problems } = await newPage(pw, base, { path: '/index.html?to=work&when=3h&title=Great%20article&text=Worth%20reading&url=https%3A%2F%2Fa.example%2Fx' });
      const r = await page.evaluate(() => { const f = document.getElementById('f'); return { to: f.t.value, when: f.p.value, subject: document.getElementById('subject').value, body: document.getElementById('msg').value, search: location.search, visible: !f.hidden }; });
      check('share / shortcut link pre-fills recipient, time, subject and details and cleans the address', r.to === 'work' && r.when === '3h' && r.subject === 'Great article' && r.body === 'Worth reading\nhttps://a.example/x' && r.search === '' && r.visible, r);
      check('opening a link never sends anything', problems.posts.length === 0, problems.posts);
      await browser.close();
      const h = await newPage(pw, base, { path: '/index.html?title=' + encodeURIComponent('<img src=x onerror=window.__pwned=1>') + '&text=' + encodeURIComponent('<script>window.__pwned=1</script>') + '&to=evil@x.com&when=bogus' });
      const x = await h.page.evaluate(() => ({ pwned: window.__pwned === 1, imgs: document.querySelectorAll('img').length, subject: document.getElementById('subject').value, to: document.getElementById('f').t.value, when: document.getElementById('f').p.value }));
      check('hostile share text stays plain text; unknown recipient/time values are ignored', !x.pwned && x.imgs === 0 && x.subject.startsWith('<img') && x.to === 'personal' && x.when === 'now', x);
      await h.browser.close();
    }

    // ---------- hour wheel + vibration (navigator.vibrate replaced by a recorder; real touch gestures via CDP) ----------
    const RECORD = () => { window.__vib = []; Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p) => { window.__vib.push(p); return true; } }); };
    {
      const { browser, ctx, page, problems } = await newPage(pw, base, { init: RECORD });
      const cdp = await ctx.newCDPSession(page);
      const state = () => page.evaluate(() => {
        const items = [...document.querySelectorAll('.wheel-item')], on = items.findIndex((e) => e.classList.contains('on'));
        return { active: document.getElementById('wheel').classList.contains('active'), on, onText: on >= 0 ? items[on].textContent : null, checked: document.querySelectorAll('#chips input:checked').length,
                 hint: document.getElementById('when').textContent, vib: window.__vib.slice(), at: document.getElementById('at').value, chip: document.getElementById('f').p.value };
      });
      const clearVib = () => page.evaluate(() => { window.__vib.length = 0; });
      const trackBox = async () => page.locator('#wheelTrack').boundingBox();
      // A real finger drag: touchStart, many small touchMoves, touchEnd (the browser then takes over and scrolls, like on a phone).
      const swipe = async (dx) => {
        const b = await trackBox(), x0 = b.x + b.width / 2, y0 = b.y + b.height / 2, steps = 16;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
        for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx * i / steps, y: y0 }] }); await page.waitForTimeout(18); }
        await page.waitForTimeout(120); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(700);
      };
      const tapItem = async (idx) => { const bb = await page.locator('.wheel-item').nth(idx).boundingBox(); await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(700); };

      // --- structure and resting state ---
      const s0 = await state();
      const meta = await page.evaluate(() => ({ labels: [...document.querySelectorAll('.wheel-item')].map((e) => e.textContent), start: Wheel.startIndex(Date.now()), tmrw: [...document.querySelectorAll('.wheel-item.tmrw')].length, aria: document.getElementById('wheelTrack').getAttribute('aria-label'), widthOk: Math.round(document.querySelector('.wheel-item').getBoundingClientRect().width) }));
      check('wheel: 16 hours from 7 AM to 10 PM, in a labelled listbox', meta.labels.length === 16 && meta.labels[0] === '7 AM' && meta.labels[5] === '12 PM' && meta.labels[15] === '10 PM' && /7 AM to 10 PM/.test(meta.aria), meta);
      check('wheel: rests dimmed on the next hour, nothing selected, no vibration at load', !s0.active && s0.on === meta.start && s0.hint === 'Will send immediately' && s0.chip === 'now' && s0.vib.length === 0, s0);
      await page.evaluate(() => { const t = document.getElementById('wheelTrack'); t.scrollLeft = t.scrollLeft > 200 ? t.scrollLeft - 144 : t.scrollLeft + 144; });
      await page.waitForTimeout(500);
      const s1 = await state();
      check('wheel: a script-driven scroll (no touch) neither selects nor vibrates', !s1.active && s1.vib.length === 0 && s1.hint === 'Will send immediately', s1);
      await page.evaluate(() => { const t = document.getElementById('wheelTrack'); const c = t.children[Wheel.startIndex(Date.now())]; t.scrollLeft = c.offsetLeft + c.offsetWidth / 2 - t.clientWidth / 2; });
      await page.waitForTimeout(300);

      // --- a real swipe: 3 hours, one tick each, selects after it settles ---
      const iw = await page.evaluate(() => document.querySelector('.wheel-item').offsetWidth), startIdx = (await state()).on, dir = startIdx > 7 ? 3 * iw : -3 * iw, wantIdx = startIdx + (dir > 0 ? -3 : 3); // finger right = earlier hours
      await clearVib(); await swipe(dir);
      const s2 = await state();
      check('wheel: swiping 3 hours selects that hour; chips deselect; hint shows the time', s2.active && s2.on === wantIdx && s2.checked === 0 && /^Will send: /.test(s2.hint), { startIdx, wantIdx, s2 });
      check('wheel: one 25 ms tick per hour passed (3 hours = 3 ticks)', s2.vib.length === 3 && s2.vib.every((v) => v === 25), s2.vib);

      // --- tap an hour two places away: slides there, ticks twice, selects ---
      await clearVib(); const before = (await state()).on; const tapTo = before + (before > 7 ? -2 : 2);
      await tapItem(tapTo);
      const s3 = await state();
      check('wheel: tapping an hour slides it to the centre and selects it (a tick for the hours it passes)', s3.on === tapTo && s3.active && s3.vib.length >= 1 && s3.vib.length <= 2 && s3.vib.every((v) => v === 25), s3);

      // --- reliability: every kind of touch must select the hour and click once per hour passed ---
      // (regression: a finger resting 500 ms or more before dragging was ignored completely; quick swipes gave no click)
      const toFirstHour = async () => { await page.evaluate(() => { document.querySelector('input[name=p][value=now]').click(); const t = document.getElementById('wheelTrack'), f = t.firstElementChild; t.style.scrollSnapType = 'none'; t.scrollLeft = f.offsetLeft + f.offsetWidth / 2 - t.clientWidth / 2; setTimeout(() => (t.style.scrollSnapType = ''), 0); window.__vib.length = 0; }); await page.waitForTimeout(300); };
      const touchDrag = async (holdMs, dx, pauseAtStep) => {
        const b = await trackBox(), x0 = b.x + b.width / 2, y0 = b.y + b.height / 2, steps = 16;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] }); await page.waitForTimeout(holdMs);
        for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx * i / steps, y: y0 }] }); await page.waitForTimeout(18); if (i === pauseAtStep) await page.waitForTimeout(900); }
        await page.waitForTimeout(100); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(800);
      };
      const three = 3 * iw, ticksOf = async () => (await state()).vib;
      const rel = {};
      for (const hold of [0, 300, 600, 1200]) { await toFirstHour(); await touchDrag(hold, -three); const s = await state(); rel['rest' + hold] = { on: s.on, active: s.active, ticks: s.vib.length }; }
      check('finger resting 0 / 300 / 600 / 1200 ms before dragging: always selects the hour 3 further on, with 3 ticks', Object.values(rel).every((x) => x.on === 3 && x.active && x.ticks === 3), rel);
      await toFirstHour(); await touchDrag(0, -three, 8); const sp = await state();
      check('a drag with a long pause in the middle (finger held still 0.9 s) still ticks 3 times and selects', sp.on === 3 && sp.active && sp.vib.length === 3, sp);
      await toFirstHour();
      const quick = async (dx) => { const b = await trackBox(), x0 = b.x + b.width / 2, y0 = b.y + b.height / 2; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] }); for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx * i / 6, y: y0 }] }); await page.waitForTimeout(12); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
      await quick(-2 * iw); await page.waitForTimeout(60); await quick(-2 * iw); await page.waitForTimeout(1200); const sq = await state();
      check('two quick swipes back to back: both count (4 hours further, at least one click per swipe, selected)', sq.on === 4 && sq.active && sq.vib.length >= 2 && sq.vib.every((v) => v === 25), sq);
      await toFirstHour(); await tapItem(2); const afterTap = (await state()).on; await touchDrag(0, -2 * iw); const st2 = await state();
      check('a swipe right after tapping an hour works too', afterTap === 2 && st2.on === 4 && st2.active && st2.vib.length >= 2, [afterTap, st2]);
      await toFirstHour(); await page.evaluate(() => { const t = document.getElementById('wheelTrack'); t.dispatchEvent(new TouchEvent('touchstart', { touches: [], bubbles: true })); }); await page.waitForTimeout(150); await page.evaluate(() => { document.getElementById('wheelTrack').dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true })); }); await page.waitForTimeout(700);
      await page.evaluate(() => { const t = document.getElementById('wheelTrack'); t.scrollLeft += 96; }); await page.waitForTimeout(500); const idle = await state();
      check('a touch that never scrolled (tap / long press) does not leave the wheel live: a later script scroll neither selects nor clicks', !idle.active && idle.vib.length === 0, idle);

      await tapItem(5); await page.waitForTimeout(300); await clearVib(); // realign: the script scroll above left the highlight and the position apart

      // --- the other ways of choosing a time clear the wheel, and the wheel clears them ---
      await page.evaluate(() => document.querySelector('input[name=p][value="3h"]').click());
      const s4 = await state();
      check('choosing a time button deselects the wheel', !s4.active && s4.chip === '3h' && /^Will send: /.test(s4.hint), s4);
      await clearVib(); const centred = (await state()).on; await tapItem(centred);
      const s5 = await state();
      check('tapping the already-centred hour selects it (no scrolling, so no tick)', s5.active && s5.checked === 0 && s5.vib.length === 0, s5);
      await page.evaluate(() => { const at = document.getElementById('at'); at.value = '2026-12-01T10:00'; at.dispatchEvent(new Event('input')); });
      const s6 = await state();
      check('typing a date deselects the wheel and the time buttons', !s6.active && s6.checked === 0 && /Dec 1|Tue/.test(s6.hint), s6);
      await tapItem(centred);
      const s7 = await state();
      check('picking an hour clears the typed date', s7.active && s7.at === '' && /^Will send: /.test(s7.hint), s7);
      await page.evaluate(() => document.querySelector('input[name=t][value=work]').click());
      const s8 = await state();
      check('switching to Work puts the time back to Now and dims the wheel', !s8.active && s8.chip === 'now' && s8.hint === 'Will send immediately', s8);
      await page.evaluate(() => document.querySelector('input[name=t][value=personal]').click());

      // --- keyboard ---
      await page.focus('#wheelTrack'); const k0 = (await state()).on; await page.keyboard.press(k0 < 15 ? 'ArrowRight' : 'ArrowLeft'); await page.waitForTimeout(700);
      const s9 = await state();
      check('keyboard: arrow keys move the wheel one hour and select it', s9.active && s9.on === (k0 < 15 ? k0 + 1 : k0 - 1), { k0, s9 });

      // --- sending with the wheel: right time in the payload, wheel resets afterwards; vibration patterns ---
      const sent = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const f = document.getElementById('f'), subj = document.getElementById('subject');
        const hourPicked = Wheel.HOURS[[...document.querySelectorAll('.wheel-item')].findIndex((e) => e.classList.contains('on'))];
        let reply, body; window.fetch = (u, o) => new Promise((res, rej) => { body = JSON.parse(o.body); reply = { ok: (d) => res({ json: () => Promise.resolve(d) }), fail: (e) => rej(e), nonJson: () => res({ json: () => Promise.reject(new SyntaxError('x')) }) }; });
        window.__vib.length = 0; subj.value = 'wheel test'; f.requestSubmit(); await wait(30);
        const afterTap = window.__vib.slice(); reply.ok({ ok: true, status: 'Scheduled' }); await wait(100);
        const d = new Date(body.sendAt);
        const out = { hourPicked, sendHour: d.getHours(), sendMin: d.getMinutes(), future: d.getTime() > Date.now(), afterTap, all: window.__vib.slice(), wheelActive: document.getElementById('wheel').classList.contains('active'), chip: f.p.value, btn: document.getElementById('btn').textContent };
        await wait(3100);
        // failures: each one gives the double buzz, once
        out.errors = {};
        for (const [name, how] of [['server', () => reply.ok({ ok: false, error: 'Unauthorized' })], ['nonJson', () => reply.nonJson()], ['timeout', () => reply.fail(Object.assign(new Error('a'), { name: 'AbortError' }))], ['network', () => reply.fail(new TypeError('Failed to fetch'))]]) {
          window.__vib.length = 0; subj.value = 'x'; f.requestSubmit(); await wait(20); how(); await wait(60); out.errors[name] = window.__vib.slice();
        }
        window.__vib.length = 0; subj.value = ''; document.getElementById('msg').value = ''; f.requestSubmit(); await wait(30); out.empty = window.__vib.slice();
        return out;
      });
      check('wheel send: the payload carries the chosen hour sharp (future time), the wheel resets afterwards', sent.sendHour === sent.hourPicked && sent.sendMin === 0 && sent.future && !sent.wheelActive && sent.chip === 'now' && sent.btn === 'Scheduled ✓', sent);
      check('vibration on send: a 20 ms tick when it starts, a 60 ms buzz when it works', JSON.stringify(sent.afterTap) === '[20]' && JSON.stringify(sent.all) === '[20,60]', [sent.afterTap, sent.all]);
      check('vibration on every kind of failure: one double buzz (server error, non-JSON, timeout, no connection)', Object.values(sent.errors).every((v) => JSON.stringify(v) === JSON.stringify([20, [100, 80, 100]])), sent.errors);
      check('vibration for validation errors: only the double buzz (no start tick)', JSON.stringify(sent.empty) === JSON.stringify([[100, 80, 100]]), sent.empty);

      // --- settings: switch, test button, persistence, forget ---
      const set = await page.evaluate(async () => {
        const $ = (id) => document.getElementById(id), wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
        $('gear').click(); out.defaultChecked = $('cfgHaptics').checked;
        window.__vib.length = 0; $('cfgBuzz').click(); out.testOn = { msg: $('cfgMsg').textContent, vib: window.__vib.slice() };
        const real = navigator.vibrate; Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => false });
        $('cfgBuzz').click(); out.testBlocked = $('cfgMsg').textContent;
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value: real });
        $('cfgHaptics').checked = false; $('setup').requestSubmit(); out.stored = localStorage.getItem('qr_haptics');
        // off: sending and the wheel are silent
        window.__vib.length = 0; window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, status: 'Sent' }) });
        $('subject').value = 'quiet'; $('f').requestSubmit(); await wait(100); out.offSend = window.__vib.slice();
        $('gear').click(); window.__vib.length = 0; $('cfgBuzz').click(); out.testWhileOff = window.__vib.length; // the test ignores the switch
        $('gear').click();
        return out;
      });
      check('settings: vibration is on by default; "Test vibration" buzzes 150-80-150 and says so; "blocked" is reported', set.defaultChecked && /^Buzz sent\./.test(set.testOn.msg) && JSON.stringify(set.testOn.vib) === '[[150,80,150]]' && /blocked/.test(set.testBlocked), set);
      check('settings: switching it off is saved, silences sending, but the test button still works', set.stored === '0' && set.offSend.length === 0 && set.testWhileOff === 1, set);
      await page.reload(); await page.waitForTimeout(500);
      const again = await page.evaluate(() => { document.getElementById('gear').click(); return { checked: document.getElementById('cfgHaptics').checked, stored: localStorage.getItem('qr_haptics') }; });
      check('settings: the switch survives a reload', again.checked === false && again.stored === '0', again);
      const forgot = await page.evaluate(() => { document.getElementById('cfgClear').click(); document.getElementById('gear').click(); return { stored: localStorage.getItem('qr_haptics'), checked: document.getElementById('cfgHaptics').checked }; });
      check('settings: "Forget this phone\'s settings" turns vibration back on', forgot.stored === null && forgot.checked === true, forgot);
      const viol = await page.evaluate(() => window.__viol || []);
      check('wheel and vibration: no script errors or CSP violations', problems.errors.length === 0 && viol.length === 0, [problems.errors, viol]);
      await browser.close();

      // a browser without the Vibration API: nothing breaks, the test button says so
      const nv = await newPage(pw, base, { init: () => { try { delete Navigator.prototype.vibrate; } catch (e) { /* ignore */ } } });
      const nvr = await nv.page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const $ = (id) => document.getElementById(id), out = { has: 'vibrate' in navigator };
        window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, status: 'Sent' }) });
        $('subject').value = 'x'; $('f').requestSubmit(); await wait(100); out.sent = $('btn').textContent;
        document.querySelectorAll('.wheel-item')[3].click(); await wait(600); out.wheel = document.getElementById('wheel').classList.contains('active');
        $('gear').click(); $('cfgBuzz').click(); out.msg = $('cfgMsg').textContent; return out;
      });
      check('no Vibration API: sending and the wheel still work, "Test vibration" says the browser cannot vibrate', nvr.has === false && nvr.sent === 'Sent ✓' && nvr.wheel === true && /cannot vibrate/.test(nvr.msg) && nv.problems.errors.length === 0, [nvr, nv.problems.errors]);
      await nv.browser.close();
    }

    // ---------- safe retry: the request id ----------
    {
      const { browser, page, problems } = await newPage(pw, base);
      const r = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms)), $ = (id) => document.getElementById(id), f = $('f'), subj = $('subject'), out = {};
        const bodies = []; let rel;
        window.fetch = (u, o) => new Promise((res, rej) => { bodies.push(JSON.parse(o.body)); rel = { ok: (d) => res({ json: () => Promise.resolve(d) }), fail: (e) => rej(e) }; });
        const go = async (s, how) => { subj.value = s; f.requestSubmit(); await wait(20); how(); await wait(80); return bodies[bodies.length - 1].id; };
        const timeout = () => rel.fail(Object.assign(new Error('a'), { name: 'AbortError' }));
        const good = () => rel.ok({ ok: true, status: 'Sent' });
        const ID = /^[A-Za-z0-9_-]{8,64}$/;
        const a = await go('call dentist', timeout), b = await go('call dentist', timeout);
        out.valid = ID.test(a); out.sameRetry = a === b;
        out.afterTimeoutBtn = { text: $('btn').textContent, disabled: $('btn').disabled };
        const c = await go('call dentist now', timeout); out.newOnTextChange = c !== b;
        const d = await go('call dentist now', timeout); out.sameAgain = d === c;
        document.querySelector('input[name=p][value="3h"]').click(); const e1 = await go('call dentist now', timeout); out.newOnTimeButton = e1 !== d;
        const e2 = await go('call dentist now', timeout); out.sameTimeButtonRetry = e2 === e1;
        document.querySelectorAll('.wheel-item')[4].click(); await wait(600); const w1 = await go('call dentist now', timeout); out.newOnWheel = w1 !== e2;
        document.querySelector('input[name=p][value="now"]').click(); document.querySelector('input[name=t][value=work]').click(); const w2 = await go('call dentist now', timeout); out.newOnRecipient = w2 !== w1;
        const at = $('at'); at.value = '2026-12-01T10:00'; at.dispatchEvent(new Event('input')); const w3 = await go('call dentist now', timeout); out.newOnDate = w3 !== w2;
        // success ends the attempt: the next identical send is a NEW request
        document.querySelector('input[name=t][value=personal]').click(); at.value = ''; at.dispatchEvent(new Event('input'));
        const s1 = await go('hello there', timeout), s2 = await go('hello there', good); out.retryThenSuccessSame = s1 === s2; await wait(3100);
        const s3 = await go('hello there', good); out.newAfterSuccess = s3 !== s2; await wait(3100);
        // the server's answers
        subj.value = 'dup'; f.requestSubmit(); await wait(20); rel.ok({ ok: true, status: 'Already sent', duplicate: true }); await wait(80);
        out.duplicate = { text: $('btn').textContent, done: $('btn').classList.contains('done') }; await wait(3100);
        subj.value = 'busy'; f.requestSubmit(); await wait(20); rel.ok({ ok: false, error: 'Still sending, check again shortly' }); await wait(80);
        out.busy = { status: $('status').textContent, btn: $('btn').textContent, disabled: $('btn').disabled };
        // ten fresh sends give ten different ids
        const many = []; for (let i = 0; i < 10; i++) many.push(await go('unique ' + i, good)); out.unique = new Set(many).size; await wait(100);
        return out;
      });
      check('retry id: valid for the server; kept for an identical retry after a timeout; the button is usable again', r.valid && r.sameRetry && r.afterTimeoutBtn.text === 'Send' && !r.afterTimeoutBtn.disabled && r.sameAgain, r);
      check('retry id: a new id when the text, time button, wheel hour, recipient or date changes', r.newOnTextChange && r.newOnTimeButton && r.newOnWheel && r.newOnRecipient && r.newOnDate && r.sameTimeButtonRetry, r);
      check('retry id: the same id until it works, then a NEW id for the next identical send', r.retryThenSuccessSame && r.newAfterSuccess, r);
      check('server answers "Already sent" -> shown as success; "Still sending" -> shown as an error, button usable', r.duplicate.text === 'Already sent ✓' && r.duplicate.done && /Still sending/.test(r.busy.status) && r.busy.btn === 'Send' && !r.busy.disabled, [r.duplicate, r.busy]);
      check('retry id: ten different sends use ten different ids', r.unique === 10, r.unique);
      check('retry id: no script errors or CSP violations', problems.errors.length === 0 && (await page.evaluate(() => window.__viol || [])).length === 0, problems.errors);
      await browser.close();
    }

    // ---------- scheduled reminders screen ----------
    {
      const { browser, page, problems } = await newPage(pw, base, { init: RECORD });
      const r = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms)), $ = (id) => document.getElementById(id), out = {};
        const now = Date.now(), calls = []; let hold = null;
        window.__items = [{ id: 'idaaaaaa1', at: now + 3600e3, target: 'work', subject: 'Call dentist' }, { id: 'idcccccc3', at: now + 7200e3, target: 'unknown', subject: 'Mystery' }, { id: 'idbbbbbb2', at: now + 2 * 86400e3, target: 'personal', subject: 'Pay rent' }];
        window.__mode = 'ok';
        window.fetch = (u, o) => {
          const b = JSON.parse(o.body); calls.push(b);
          const reply = () => {
            if (window.__mode === 'net') return Promise.reject(new TypeError('Failed to fetch'));
            if (window.__mode === 'abort') return Promise.reject(Object.assign(new Error('a'), { name: 'AbortError' }));
            if (window.__mode === 'nonjson') return Promise.resolve({ json: () => Promise.reject(new SyntaxError('x')) });
            if (window.__mode === 'old') return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: 'Subject and details are both empty' }) });
            if (window.__mode === 'oldsend') return Promise.resolve({ json: () => Promise.resolve({ ok: true, status: 'Sent' }) });
            if (window.__mode === 'locked') return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: 'Locked, try again later' }) });
            if (b.action === 'list') return Promise.resolve({ json: () => Promise.resolve({ ok: true, items: window.__items.slice() }) });
            if (b.action === 'cancel') {
              if (window.__mode === 'cancel-unauth') return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: 'Unauthorized' }) });
              if (window.__mode === 'cancel-gone') { window.__items = window.__items.filter((i) => i.id !== b.id); return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: 'Not found (maybe already sent)' }) }); }
              window.__items = window.__items.filter((i) => i.id !== b.id); return Promise.resolve({ json: () => Promise.resolve({ ok: true, status: 'Cancelled' }) });
            }
            return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: 'Unknown action' }) });
          };
          return hold ? hold(reply) : reply();
        };
        const vis = () => ({ form: !$('f').hidden, setup: !$('setup').hidden, sched: !$('sched').hidden, gear: $('gear').textContent, clockShown: getComputedStyle($('schedIco')).display !== 'none', xShown: getComputedStyle($('schedX')).display !== 'none' });
        const rows = () => [...document.querySelectorAll('.srow')].map((li) => ({ time: li.querySelector('.stime').textContent, pill: li.querySelector('.pill').textContent, sub: li.querySelector('.ssub').textContent, btn: li.querySelector('.scancel').textContent }));
        const state = () => ({ text: $('schedState').textContent, err: $('schedState').classList.contains('err') });
        const open = async () => { $('schedBtn').click(); await wait(60); };

        out.header = { clock: $('schedBtn').getAttribute('aria-label'), gear: $('gear').getAttribute('aria-label') };
        await open(); out.opened = vis(); out.rows = rows(); out.listCall = calls[0]; out.stateAfterLoad = state();
        // one screen at a time
        $('gear').click(); out.settingsOver = vis(); $('schedBtn').click(); await wait(60); out.schedOver = vis();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); out.escape = vis();
        await open(); $('schedBtn').click(); out.closeBtn = vis(); await open(); $('schedBtn').click(); out.topX = vis();
        // refresh
        await open(); const n = calls.length; $('schedRefresh').click(); await wait(60); out.refresh = { requests: calls.length - n, last: calls[calls.length - 1].action, rows: rows().length };
        // cancel: two taps, the first only arms the button
        const first = () => document.querySelector('.srow .scancel'); window.__vib.length = 0;
        const c0 = calls.length; first().click(); out.armed = { text: first().textContent, requests: calls.length - c0 };
        await wait(3300); out.disarmed = { text: first().textContent, requests: calls.length - c0 };
        first().click(); first().click(); await wait(120);
        const cancelCall = calls[calls.length - 1]; out.cancelled = { call: cancelCall, rows: rows().map((x) => x.sub), state: state(), vib: window.__vib.slice() };
        // server refuses: the row stays and the button is usable again
        window.__mode = 'cancel-unauth'; window.__vib.length = 0; first().click(); first().click(); await wait(120);
        out.refused = { rows: rows().length, btn: first().textContent, disabled: first().disabled, state: state(), vib: window.__vib.slice() }; window.__mode = 'ok';
        // already sent / gone: the row disappears and the server's text is shown
        window.__mode = 'cancel-gone'; first().click(); first().click(); await wait(120);
        out.gone = { rows: rows().length, state: state() }; window.__mode = 'ok';
        // cancel the last one: empty message; refresh keeps it empty
        first().click(); first().click(); await wait(120); out.last = { rows: rows().length, state: state() };
        $('schedRefresh').click(); await wait(80); out.emptyAfterRefresh = { rows: rows().length, state: state() };
        $('schedBtn').click();
        // failures when loading
        for (const m of ['net', 'abort', 'nonjson', 'locked', 'old', 'oldsend']) { window.__mode = m; await open(); out['load_' + m] = { state: state(), rows: rows().length, refreshEnabled: !$('schedRefresh').disabled }; $('schedBtn').click(); }
        window.__mode = 'ok';
        // a slow, outdated reply must not overwrite the newer one
        window.__items = [{ id: 'idnewone01', at: now + 3600e3, target: 'work', subject: 'NEW list' }]; let releaseSlow;
        hold = (reply) => { hold = null; return new Promise((res) => { releaseSlow = () => res(Promise.resolve({ json: () => Promise.resolve({ ok: true, items: [{ id: 'idoldone01', at: now, target: 'work', subject: 'OLD list' }] }) })); }); };
        await open(); $('schedBtn').click(); await open(); await wait(80); releaseSlow(); await wait(80);
        out.stale = rows().map((x) => x.sub); $('schedBtn').click();
        // no settings saved: opens the settings with a note, no request
        const keep = [localStorage.getItem('qr_url'), localStorage.getItem('qr_token')]; localStorage.removeItem('qr_url'); localStorage.removeItem('qr_token'); const c1 = calls.length;
        $('schedBtn').click(); await wait(60); out.noConfig = { vis: vis(), note: $('cfgMsg').textContent, requests: calls.length - c1 };
        localStorage.setItem('qr_url', keep[0]); localStorage.setItem('qr_token', keep[1]);
        return out;
      });
      check('header has a "Scheduled reminders" button next to the settings gear', r.header.clock === 'Scheduled reminders' && r.header.gear === 'Settings', r.header);
      check('opening it asks the server for the list (token + action only) and shows the form-free screen; its button becomes ✕', r.opened.sched && !r.opened.form && !r.opened.setup && r.opened.xShown && !r.opened.clockShown && r.opened.gear === '⚙' && Object.keys(r.listCall).sort().join() === 'action,token' && r.listCall.action === 'list', [r.opened, r.listCall]);
      check('rows: time, recipient label (Work / Personal / ?) and subject, in the server order, each with a Cancel button',
        r.rows.length === 3 && r.rows[0].sub === 'Call dentist' && r.rows[0].pill === 'Work' && r.rows[1].pill === '?' && r.rows[2].pill === 'Personal' && r.rows.every((x) => x.btn === 'Cancel' && x.time.length > 3) && r.stateAfterLoad.text === '', r.rows);
      check('only one screen at a time: the gear switches to settings, the clock back; Escape, Close and the ✕ return to the form',
        r.settingsOver.setup && !r.settingsOver.sched && r.settingsOver.gear === '✕' && r.settingsOver.clockShown && r.schedOver.sched && !r.schedOver.setup && r.escape.form && !r.escape.sched && r.closeBtn.form && r.topX.form && r.topX.clockShown, [r.settingsOver, r.schedOver, r.escape, r.closeBtn, r.topX]);
      check('Refresh asks the server again', r.refresh.requests === 1 && r.refresh.last === 'list' && r.refresh.rows === 3, r.refresh);
      check('cancel needs two taps: "Sure? Tap again", no request yet; it disarms itself after 3 s', r.armed.text === 'Sure? Tap again' && r.armed.requests === 0 && r.disarmed.text === 'Cancel' && r.disarmed.requests === 0, [r.armed, r.disarmed]);
      check('second tap cancels: request {action cancel, id, token}, row removed, message, short buzz', r.cancelled.call.action === 'cancel' && r.cancelled.call.id === 'idaaaaaa1' && r.cancelled.rows.join() === 'Mystery,Pay rent' && r.cancelled.state.text === 'Cancelled.' && JSON.stringify(r.cancelled.vib) === '[60]', r.cancelled);
      check('a refused cancel keeps the row, re-enables the button, shows the error and double-buzzes', r.refused.rows === 2 && r.refused.btn === 'Cancel' && !r.refused.disabled && r.refused.state.err && r.refused.state.text === 'Unauthorized' && JSON.stringify(r.refused.vib) === '[[100,80,100]]', r.refused);
      check('"Not found (maybe already sent)" removes the row and shows the server\'s text', r.gone.rows === 1 && r.gone.state.err && /Not found/.test(r.gone.state.text), r.gone);
      check('cancelling the last one says nothing else is scheduled; Refresh shows "Nothing scheduled."', r.last.rows === 0 && /Nothing else is scheduled/.test(r.last.state.text) && r.emptyAfterRefresh.state.text === 'Nothing scheduled.' && r.emptyAfterRefresh.rows === 0, [r.last, r.emptyAfterRefresh]);
      check('load failures: no connection, timeout, unreadable reply, lockout; the server error text is shown and Refresh is usable', r.load_net.state.text === 'No connection.' && r.load_abort.state.text === 'Timed out. Try again.' && r.load_nonjson.state.text === 'Unexpected reply from the server.' && r.load_locked.state.text === 'Locked, try again later' && [r.load_net, r.load_abort, r.load_nonjson, r.load_locked].every((x) => x.state.err && x.rows === 0 && x.refreshEnabled), r);
      check('an old backend (does not know list/cancel) gets a clear "paste the new Code.gs" message', /too old.*new Code\.gs/.test(r.load_old.state.text) && r.load_old.state.err && /too old/.test(r.load_oldsend.state.text), [r.load_old, r.load_oldsend]);
      check('a slow, outdated reply never replaces a newer list', r.stale.join() === 'NEW list', r.stale);
      check('without saved settings the clock opens the settings with a note and sends nothing', r.noConfig.vis.setup && !r.noConfig.vis.sched && /URL and token/.test(r.noConfig.note) && r.noConfig.requests === 0, r.noConfig);
      check('scheduled screen: no script errors or CSP violations', problems.errors.length === 0 && (await page.evaluate(() => window.__viol || [])).length === 0, [problems.errors, await page.evaluate(() => window.__viol)]);
      await browser.close();
    }

    // ---------- build stamp in settings ----------
    {
      const { browser, page } = await newPage(pw, base);
      const r = await page.evaluate(() => { document.getElementById('gear').click(); const v = document.getElementById('cfgVersion'); return { text: v.textContent, err: v.classList.contains('err'), meta: document.querySelector('meta[name=build]').content, css: getComputedStyle(document.documentElement).getPropertyValue('--build').replace(/["'\s]/g, '') }; });
      check('settings show "Version <build>" (the same id in the page, the stylesheet and the script) with no warning', /^Version [0-9a-f]{8}$/.test(r.text) && !r.err && r.text === 'Version ' + r.meta && r.meta === r.css, r);
      await browser.close();
      // a phone that loaded an old script with the new page: the warning names all three
      const dir2 = copySite('stamp'), server2 = await startServer(dir2);
      try {
        const fs = require('fs'), path = require('path');
        fs.writeFileSync(path.join(dir2, 'app.js'), fs.readFileSync(path.join(dir2, 'app.js'), 'utf8').replace(/var BUILD = '[0-9a-f]{8}'/, "var BUILD = 'deadbeef'"));
        const m = await newPage(pw, `http://127.0.0.1:${server2.port}`);
        const w = await m.page.evaluate(() => { document.getElementById('gear').click(); const v = document.getElementById('cfgVersion'); return { text: v.textContent, err: v.classList.contains('err'), meta: document.querySelector('meta[name=build]').content }; });
        check('an old script with a new page: settings warn "Files are out of sync" and name page, script and style versions', w.err && /^Files are out of sync \(page [0-9a-f]{8}, script deadbeef, style [0-9a-f]{8}\)\. Close and reopen the app\.$/.test(w.text) && w.text.includes('page ' + w.meta), w);
        await m.browser.close();
      } finally { await server2.close(); rmrf(dir2); }
    }

    // ---------- the page is exactly as tall as it needs to be (no spare pixels to scroll) + the screen info probe ----------
    {
      const { browser, page, problems } = await newPage(pw, base);
      const size = async (w, h) => { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(150); return page.evaluate(() => ({ doc: document.documentElement.scrollHeight, win: window.innerHeight, content: Math.round(document.getElementById('f').getBoundingClientRect().bottom + window.scrollY + 16) })); };
      const tall = [[412, 915], [412, 860], [412, 800], [390, 844], [360, 780], [412, 760]];
      const fits = [];
      for (const [w, h] of tall) { const r = await size(w, h); fits.push({ w, h, ...r, ok: r.doc === r.win }); }
      check('the form never scrolls when it fits: the document is exactly as tall as the window at six phone sizes (no min-height:100dvh spill)', fits.every((x) => x.ok || x.content > x.win), fits);
      const small = await size(412, 500);
      check('when the window is too small the page still scrolls (the form is taller than 500 px)', small.doc > small.win, small);
      // the hidden dvh/svh/lvh measuring sticks must not add height
      await size(412, 915);
      const withProbes = await page.evaluate(() => document.documentElement.scrollHeight);
      const without = await page.evaluate(() => { document.querySelectorAll('.vhprobe').forEach((e) => e.remove()); return document.documentElement.scrollHeight; });
      check('the measuring sticks do not change the page height', withProbes === without, [withProbes, without]);
      // reload to get them back, then: settings show the screen numbers; a scroll of the FORM is recorded, one of the long settings page is not
      await page.reload(); await page.waitForTimeout(400); await size(412, 500);
      const info0 = await page.evaluate(() => { document.getElementById('gear').click(); const t = document.getElementById('cfgInfo').textContent; document.getElementById('gear').click(); return t; });
      check('settings show window size, dvh, svh, lvh and "The form has not scrolled since launch."', /^Screen: window 412x500, dvh 500, svh 500, lvh 500\. The form has not scrolled since launch\.$/.test(info0), info0);
      await page.evaluate(() => { document.getElementById('gear').click(); window.scrollTo(0, 30); }); await page.waitForTimeout(150); // scrolling the long settings page
      const info1 = await page.evaluate(() => { document.getElementById('gear').click(); document.getElementById('gear').click(); const t = document.getElementById('cfgInfo').textContent; document.getElementById('gear').click(); return t; });
      check('scrolling the settings page is not recorded as a form scroll', /has not scrolled since launch/.test(info1), info1);
      await page.evaluate(() => window.scrollTo(0, 40)); await page.waitForTimeout(150);
      const info2 = await page.evaluate(() => { document.getElementById('gear').click(); const t = document.getElementById('cfgInfo').textContent; document.getElementById('gear').click(); return t; });
      check('a scroll of the form is recorded with scrollY, document height, window height and visual viewport', /^Screen: window 412x500, dvh 500, svh 500, lvh 500\. The form scrolled: y=40 of \d+ \(window 500, visual 500, after \d+ ms\)$/.test(info2), info2);
      check('screen info: no script errors', problems.errors.length === 0, problems.errors);
      await browser.close();
    }

    // ---------- the app is always dark, whatever the phone's light/dark mode says ----------
    for (const scheme of ['light', 'dark']) {
      const { browser, page } = await newPage(pw, base, { scheme });
      const r = await page.evaluate(() => ({ html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.body).color, canvas: getComputedStyle(document.documentElement).colorScheme }));
      check(`phone in ${scheme} mode: the page is still black with light text (always dark)`, r.html === 'rgb(0, 0, 0)' && r.body === 'rgb(0, 0, 0)' && r.text === 'rgb(241, 241, 241)' && r.canvas === 'dark', r);
      await browser.close();
    }
  } finally { await server.close(); rmrf(dir); }
  return C;
};
