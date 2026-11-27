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
      check('no "When" title above the time buttons', !r.labels.some((l) => l.trim() === 'When'), r.labels);
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
