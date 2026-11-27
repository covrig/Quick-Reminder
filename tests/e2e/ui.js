// Suite "ui": behaviour of the page in a phone-sized mobile browser, with the network stubbed (nothing is ever sent).
'use strict';
const { copySite, rmrf, startServer, makeChecker } = require('./lib');

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
      check('only the selected time button is coloured (Now green, 6 PM its own colour, others plain)', r.nowBg === 'rgb(30, 142, 78)' && r.sel6pm === 'rgb(100, 151, 23)' && r.idleBg === 'rgba(0, 0, 0, 0)', [r.nowBg, r.sel6pm, r.idleBg]);
      check('recipient colours: Personal blue, Work red', r.personalBg === 'rgb(26, 115, 232)' && r.workBg === 'rgb(217, 83, 79)', [r.personalBg, r.workBg]);
      check('switching to Work puts the time back to Now', r.workReset.chip === 'now' && r.workReset.hint === 'Will send immediately', r.workReset);
      check('Details start collapsed (48 px), grow when focused, collapse again when empty', r.ta.collapsed === 48 && r.ta.focused > 100 && r.ta.blurredEmpty === 48, r.ta);
      check('date field: placeholder when empty, hidden when filled, chips deselected; a chip clears the date', r.ph.empty === 'flex' && r.ph.filled === 'none' && r.ph.chipsCleared && r.ph.afterChip.at === '' && r.ph.afterChip.ph === 'flex', r.ph);
      check('no sideways scrolling; html paints its own background', r.overflowX === 0 && r.htmlBg === 'rgb(255, 255, 255)', [r.overflowX, r.htmlBg]);
      check('no script errors or CSP violations', problems.errors.length === 0 && ((await page.evaluate(() => window.__viol || [])).length === 0), [problems.errors, await page.evaluate(() => window.__viol)]);
      await browser.close();
    }

    // ---------- settings: open/close, prefix, custom time buttons, forget ----------
    {
      const { browser, page } = await newPage(pw, base);
      const r = await page.evaluate(async () => {
        const $ = (id) => document.getElementById(id), f = $('f'), setup = $('setup'), gear = $('gear'), out = {};
        const state = () => ({ setup: !setup.hidden, form: !f.hidden, gear: gear.textContent });
        gear.click(); out.open = state(); $('cfgClose').click(); out.closedByButton = state();
        gear.click(); gear.click(); out.closedByTopButton = state();
        gear.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); out.closedByEscape = state();
        gear.click(); $('cfgPrefix').value = '[Never saved]'; $('cfgPresets').value = '1:00'; $('cfgClose').click(); gear.click();
        out.discarded = { prefix: $('cfgPrefix').value, lines: $('cfgPresets').value.split('\n').length }; $('cfgClose').click();
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
      check('sending shows "Sending…" (button disabled), then "Sent ✓" in green, clears the form, returns to "Send" after 3 s', r.sending.text === 'Sending…' && r.sending.disabled && r.sent.btn === 'Sent ✓' && r.sent.done && r.sent.green === 'rgb(30, 142, 78)' && r.sent.subject === '' && r.reset.text === 'Send' && !r.reset.done, r);
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
      await page.evaluate(() => { const t = document.getElementById('wheelTrack'); t.scrollLeft = t.scrollLeft > 200 ? t.scrollLeft - 192 : t.scrollLeft + 192; });
      await page.waitForTimeout(500);
      const s1 = await state();
      check('wheel: a script-driven scroll (no touch) neither selects nor vibrates', !s1.active && s1.vib.length === 0 && s1.hint === 'Will send immediately', s1);
      await page.evaluate(() => { const t = document.getElementById('wheelTrack'); const c = t.children[Wheel.startIndex(Date.now())]; t.scrollLeft = c.offsetLeft + c.offsetWidth / 2 - t.clientWidth / 2; });
      await page.waitForTimeout(300);

      // --- a real swipe: 3 hours, one tick each, selects after it settles ---
      const startIdx = (await state()).on, dir = startIdx > 7 ? 192 : -192, wantIdx = startIdx + (dir > 0 ? -3 : 3); // finger right = earlier hours
      await clearVib(); await swipe(dir);
      const s2 = await state();
      check('wheel: swiping 3 hours selects that hour; chips deselect; hint shows the time', s2.active && s2.on === wantIdx && s2.checked === 0 && /^Will send: /.test(s2.hint), { startIdx, wantIdx, s2 });
      check('wheel: one 10 ms tick per hour passed (3 hours = 3 ticks)', s2.vib.length === 3 && s2.vib.every((v) => v === 10), s2.vib);

      // --- tap an hour two places away: slides there, ticks twice, selects ---
      await clearVib(); const before = (await state()).on; const tapTo = before + (before > 7 ? -2 : 2);
      await tapItem(tapTo);
      const s3 = await state();
      check('wheel: tapping an hour slides it to the centre and selects it (a tick for the hours it passes)', s3.on === tapTo && s3.active && s3.vib.length >= 1 && s3.vib.length <= 2 && s3.vib.every((v) => v === 10), s3);

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
        $('cfgClose').click();
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

    // ---------- dark mode paints a dark page ----------
    {
      const { browser, page } = await newPage(pw, base, { scheme: 'dark' });
      const r = await page.evaluate(() => ({ html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor }));
      check('dark mode: html and body are black', r.html === 'rgb(0, 0, 0)' && r.body === 'rgb(0, 0, 0)', r);
      await browser.close();
    }
  } finally { await server.close(); rmrf(dir); }
  return C;
};
