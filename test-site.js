// Run: node test-site.js  (pure logic of site/presets.js; DOM behaviour is checked in a browser)
const assert = require('assert');
const P = require('./presets.js');

// Fixed "now": Friday 2026-11-20 21:23:06 local time.
const now = new Date(2026, 10, 20, 21, 23, 6).getTime();
const at = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()].join(',');

// --- defaults ---
assert.strictEqual(P.DEFAULTS[0].id, 'now');
assert.deepStrictEqual(P.DEFAULTS.map((p) => p.label),
  ['Now', '8:30 AM', '9:30 AM', '3:00 PM', '6:00 PM', '7:00 PM', '1 h', '3 h', '6 h']);
assert.strictEqual(new Set(P.DEFAULTS.map((p) => p.id)).size, P.DEFAULTS.length, 'ids unique');
assert.strictEqual(new Set(P.DEFAULTS.map((p) => p.color)).size, P.DEFAULTS.length, 'colours unique');

// --- resolve ---
assert.strictEqual(P.resolve(P.DEFAULTS, 'now', now), null);
assert.strictEqual(P.resolve(P.DEFAULTS, 'nonsense', now), null);
assert.strictEqual(at(P.resolve(P.DEFAULTS, '0830', now)), '2026,11,21,8,30,0', '8:30 already passed today -> tomorrow');
assert.strictEqual(at(P.resolve(P.DEFAULTS, '1h', now)), '2026,11,20,22,23,6');
assert.strictEqual(at(P.resolve(P.DEFAULTS, '6h', now)), '2026,11,21,3,23,6');
// a clock time still ahead today stays today
const morning = new Date(2026, 10, 20, 7, 0, 0).getTime();
assert.strictEqual(at(P.resolve(P.DEFAULTS, '0830', morning)), '2026,11,20,8,30,0');
// exactly at the clock time counts as passed -> tomorrow
const exact = new Date(2026, 10, 20, 8, 30, 0).getTime();
assert.strictEqual(at(P.resolve(P.DEFAULTS, '0830', exact)), '2026,11,21,8,30,0');
// month/year rollover
const nye = new Date(2026, 11, 31, 20, 0, 0).getTime();
assert.strictEqual(at(P.resolve(P.DEFAULTS, '0830', nye)), '2027,1,1,8,30,0');

// --- DEFAULTS are exactly the original nine buttons (same ids), with the distinct colour palette ---
assert.deepStrictEqual(P.DEFAULTS.map((p) => p.id), ['now', '0830', '0930', '1500', '1800', '1900', '1h', '3h', '6h']);
assert.deepStrictEqual(P.DEFAULTS.map((p) => p.color),
  ['#1e8e4e', '#822b2b', '#c31dc3', '#171797', '#649717', '#1d81c3', '#329595', '#c31d70', '#ad811a']);

// --- colours stay clearly different from each other (CIE76 ΔE) in light AND dark mode, and readable with white text ---
{
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const lab = (h) => {
    const [r, g, b] = hex(h).map(lin);
    const x = 0.4124 * r + 0.3576 * g + 0.1805 * b, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
    const fx = f(x / 0.95047), fy = f(y), fz = f(z / 1.08883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
  const lum = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrastWhite = (h) => 1.05 / (lum(h) + 0.05);
  // same lightening the stylesheet applies in dark mode: color-mix(colour 62%, white)
  const dark = (h) => '#' + hex(h).map((c) => Math.round(c * 0.62 + 255 * 0.38).toString(16).padStart(2, '0')).join('');
  const cols = P.DEFAULTS.map((p) => p.color);
  let minLight = 999, minDark = 999, pair = '';
  for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
    const a = dE(cols[i], cols[j]), b = dE(dark(cols[i]), dark(cols[j]));
    if (a < minLight) { minLight = a; pair = P.DEFAULTS[i].label + ' / ' + P.DEFAULTS[j].label; }
    minDark = Math.min(minDark, b);
  }
  assert.ok(minLight >= 30, 'light-mode colours too similar: ' + pair + ' = ' + minLight.toFixed(1));
  assert.ok(minDark >= 20, 'dark-mode colours too similar: ' + minDark.toFixed(1));
  cols.forEach((c) => assert.ok(contrastWhite(c) >= 3.4, 'white text hard to read on ' + c));
  // the colours must also stay away from the two recipient buttons (Personal blue, Work red)
  cols.forEach((c) => { assert.ok(dE(c, '#1a73e8') >= 28, c + ' too close to Personal blue'); assert.ok(dE(c, '#d9534f') >= 26, c + ' too close to Work red'); });
}

// --- fromText: valid input ---
const ft = (t) => P.fromText(t);
const labels = (t) => ft(t).presets.map((p) => p.label);
const ok1 = ft('8:30\n3:00 pm\n18:00\n+1h\n+90m\n+45 min');
assert.strictEqual(ok1.ok, true);
assert.deepStrictEqual(ok1.presets.map((p) => p.label), ['Now', '8:30 AM', '3:00 PM', '6:00 PM', '1 h', '1 h 30 min', '45 min']);
assert.deepStrictEqual(ok1.presets.map((p) => p.id), ['now', '0830', '1500', '1800', '1h', '90m', '45m']);
assert.deepStrictEqual(labels('12 am\n12:00 PM\n12:15 am\n0:05\n23:59'), ['Now', '12:00 AM', '12:00 PM', '12:15 AM', '12:05 AM', '11:59 PM']);
assert.deepStrictEqual(labels('3PM\n  9:30 am'), ['Now', '3:00 PM', '9:30 AM']);
assert.deepStrictEqual(labels('+2 hours\n+30 minutes'), ['Now', '2 h', '30 min']);
assert.deepStrictEqual(labels('+48h'), ['Now', '48 h']);
assert.deepStrictEqual(labels(''), ['Now'], 'empty = only Now');
assert.deepStrictEqual(labels('\n  \n8:30\n\n'), ['Now', '8:30 AM'], 'blank lines ignored');
assert.deepStrictEqual(labels('8:30\r\n9:30'), ['Now', '8:30 AM', '9:30 AM'], 'windows line endings');
assert.deepStrictEqual(ft(P.DEFAULT_TEXT).presets, P.DEFAULTS);
// colours follow position
assert.deepStrictEqual(ft('1:00\n2:00').presets.map((p) => p.color), ['#1e8e4e', '#822b2b', '#c31dc3']);

// --- fromText: errors carry the line number and never throw ---
const err = (t) => { const r = ft(t); assert.strictEqual(r.ok, false, JSON.stringify(t)); return r.error; };
assert.match(err('8:30\nlunch'), /^Line 2: not understood/);
assert.match(err('25:00'), /^Line 1: the hour must be 0 to 23/);
assert.match(err('8:75'), /^Line 1: the minutes must be 0 to 59/);
assert.match(err('13 pm'), /^Line 1: with am\/pm the hour must be 1 to 12/);
assert.match(err('0 am'), /^Line 1: with am\/pm the hour must be 1 to 12/);
assert.match(err('8'), /^Line 1: write a time like/, 'bare number is ambiguous');
assert.match(err('+0h'), /^Line 1: an offset must be between/);
assert.match(err('+49h'), /^Line 1: an offset must be between/);
assert.match(err('+2881m'), /^Line 1: an offset must be between/);
assert.match(err('+h'), /^Line 1: not understood/);
assert.match(err('-1h'), /^Line 1: not understood/);
assert.match(err('\n\n  tomorrow'), /^Line 3: not understood/, 'line numbers count blank lines');
assert.match(err('8:30\n8:30 am'), /^Line 2: same time as an earlier line/);
assert.match(err('+60m\n+1h'), /^Line 2: same time as an earlier line/, '60 min and 1 h are the same');
assert.match(err('1:00\n2:00\n3:00\n4:00\n5:00\n6:00\n7:00\n8:00\n9:00'), /At most 8 time buttons/);
assert.strictEqual(ft('1:00\n2:00\n3:00\n4:00\n5:00\n6:00\n7:00\n8:00').ok, true, 'exactly 8 is fine');
assert.match(err('<script>alert(1)</script>'), /^Line 1: not understood/);
assert.strictEqual(ft(null).ok, true);
assert.strictEqual(ft(undefined).ok, true);

// --- resolve with offsets in minutes ---
const custom = ft('+90m\n+45 min').presets;
assert.strictEqual(at(P.resolve(custom, '90m', now)), '2026,11,20,22,53,6');
assert.strictEqual(at(P.resolve(custom, '45m', now)), '2026,11,20,22,8,6');

// ===================== util.js =====================
const U = require('./util.js');
const ids = P.DEFAULTS.map((p) => p.id);

// --- capitalizeSubject ---
assert.strictEqual(U.capitalizeSubject('buy milk'), 'Buy milk');
assert.strictEqual(U.capitalizeSubject('  call dentist'), 'Call dentist');
assert.strictEqual(U.capitalizeSubject('Call Bob'), 'Call Bob');
assert.strictEqual(U.capitalizeSubject('élan'), 'Élan');
assert.strictEqual(U.capitalizeSubject('3pm meeting'), '3pm meeting');
assert.strictEqual(U.capitalizeSubject(''), '');
assert.strictEqual(U.capitalizeSubject(null), '');
assert.strictEqual(U.capitalizeSubject('https://example.com/a'), 'https://example.com/a', 'links untouched');
assert.strictEqual(U.capitalizeSubject('www.example.com'), 'www.example.com');
assert.strictEqual(U.capitalizeSubject('http'), 'Http', 'a plain word that starts with http is still capitalised');

// --- parseLaunch: shortcuts ---
assert.deepStrictEqual(U.parseLaunch('?to=work&when=now', ids), { to: 'work', when: 'now' });
assert.deepStrictEqual(U.parseLaunch('?to=personal&when=3h', ids), { to: 'personal', when: '3h' });
assert.deepStrictEqual(U.parseLaunch('', ids), {});
assert.deepStrictEqual(U.parseLaunch('?to=evil@x.com&when=bogus', ids), {}, 'unknown values ignored');
assert.deepStrictEqual(U.parseLaunch('?to=WORK', ids), {}, 'case sensitive whitelist');
assert.deepStrictEqual(U.parseLaunch('?token=abc&target=work&sendAt=now', ids), {}, 'unrelated params ignored');

// --- parseLaunch: share ---
assert.deepStrictEqual(U.parseLaunch('?title=Great+article&text=Worth+reading&url=https%3A%2F%2Fa.example%2Fx', ids),
  { subject: 'Great article', body: 'Worth reading\nhttps://a.example/x' });
// Chrome typically shares: title = page title, text = the URL
assert.deepStrictEqual(U.parseLaunch('?title=Page&text=https%3A%2F%2Fa.example%2Fx', ids),
  { subject: 'Page', body: 'https://a.example/x' });
// text only, multi-line: first line is the subject
assert.deepStrictEqual(U.parseLaunch('?text=Pick+up+parcel%0AAt+the+post+office', ids),
  { subject: 'Pick up parcel', body: 'At the post office' });
// text only, one line
assert.deepStrictEqual(U.parseLaunch('?text=Buy+milk', ids), { subject: 'Buy milk' });
// url already inside text is not repeated
assert.deepStrictEqual(U.parseLaunch('?title=T&text=see+https%3A%2F%2Fa.example&url=https%3A%2F%2Fa.example', ids),
  { subject: 'T', body: 'see https://a.example' });
// url only
assert.deepStrictEqual(U.parseLaunch('?url=https%3A%2F%2Fa.example', ids), { body: 'https://a.example' });
// combined with shortcut params
assert.deepStrictEqual(U.parseLaunch('?to=work&text=Hi', ids), { to: 'work', subject: 'Hi' });

// --- parseLaunch: limits and hostile input stay plain strings ---
const long = U.parseLaunch('?title=' + 'a'.repeat(500) + '&text=' + 'b'.repeat(5000), ids);
assert.strictEqual(long.subject.length, 200);
assert.strictEqual(long.body.length, 1000);
const xss = U.parseLaunch('?title=' + encodeURIComponent('<img src=x onerror=alert(1)>') + '&text=' + encodeURIComponent('<script>alert(1)</script>'), ids);
assert.strictEqual(xss.subject, '<img src=x onerror=alert(1)>', 'kept verbatim as text (page assigns it with .value)');
assert.strictEqual(xss.body, '<script>alert(1)</script>');
assert.deepStrictEqual(U.parseLaunch('?%E0%A4%A', ids), {}, 'malformed query does not throw');
assert.deepStrictEqual(U.parseLaunch('?title=%20%20&text=%20', ids), {}, 'blank values ignored');

// --- launch colours: the manifest, the light theme-color meta and the light page background must be the same colour ---
{
  const fs = require('fs');
  const norm = (c) => { c = c.trim().toLowerCase(); return c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c; };
  const manifest = JSON.parse(fs.readFileSync(__dirname + '/manifest.webmanifest', 'utf8'));
  const html = fs.readFileSync(__dirname + '/index.html', 'utf8'), css = fs.readFileSync(__dirname + '/style.css', 'utf8');
  const metaLight = /<meta name="theme-color" media="\(prefers-color-scheme: light\)" content="(#[0-9a-fA-F]{3,6})">/.exec(html);
  const metaDark = /<meta name="theme-color" media="\(prefers-color-scheme: dark\)" content="(#[0-9a-fA-F]{3,6})">/.exec(html);
  const bgLight = /:root\s*\{[^}]*--bg:\s*(#[0-9a-fA-F]{3,6})/.exec(css);
  const bgDark = /prefers-color-scheme: dark\)\s*\{\s*:root\s*\{[^}]*--bg:\s*(#[0-9a-fA-F]{3,6})/.exec(css);
  assert.ok(metaLight && metaDark && bgLight && bgDark, 'theme-color metas and --bg values must be found');
  assert.strictEqual(norm(manifest.theme_color), norm(metaLight[1]), 'manifest theme_color must equal the light theme-color meta');
  assert.strictEqual(norm(manifest.background_color), norm(bgLight[1]), 'manifest background_color must equal the light page background');
  assert.strictEqual(norm(metaLight[1]), norm(bgLight[1]), 'light theme-color meta must equal the light page background');
  assert.strictEqual(norm(metaDark[1]), norm(bgDark[1]), 'dark theme-color meta must equal the dark page background');
  assert.ok(!/for="at"/.test(html) && /id="at"[^>]*aria-label="Pick date and time"/.test(html), 'the date field has no visible label but an accessible name');
}

// --- sanitizePrefix ---
assert.strictEqual(U.sanitizePrefix('[Reminder]'), '[Reminder]');
assert.strictEqual(U.sanitizePrefix('  [Update]  '), '[Update]');
assert.strictEqual(U.sanitizePrefix('[A]\n[B]'), '[A] [B]', 'line breaks become a space');
assert.strictEqual(U.sanitizePrefix('a\t\tb'), 'a b');
assert.strictEqual(U.sanitizePrefix('\u0000\u0007x\u007f'), 'x', 'control characters removed');
assert.strictEqual(U.sanitizePrefix(''), '');
assert.strictEqual(U.sanitizePrefix(null), '');
assert.strictEqual(U.sanitizePrefix(undefined), '');
assert.strictEqual(U.sanitizePrefix('x'.repeat(50)).length, 30);
assert.strictEqual(U.sanitizePrefix('word '.repeat(10)).endsWith(' '), false, 'no trailing space after cutting');
assert.strictEqual(U.sanitizePrefix('<b>Hi</b>'), '<b>Hi</b>', 'kept as plain text (it is only ever put in a mail subject)');

// --- buildSubject ---
assert.strictEqual(U.buildSubject('', 'Buy milk', ''), 'Buy milk', 'no prefix: unchanged');
assert.strictEqual(U.buildSubject('', '', 'details only'), '', 'no prefix, no subject: server decides');
assert.strictEqual(U.buildSubject('[Reminder]', 'Buy milk', ''), '[Reminder] Buy milk');
assert.strictEqual(U.buildSubject('  [Update] ', '  Call dentist ', 'x'), '[Update] Call dentist');
assert.strictEqual(U.buildSubject('[Update]', '[Update] Call', ''), '[Update] Call', 'not doubled');
assert.strictEqual(U.buildSubject('[Update]', '[update] call', ''), '[update] call', 'not doubled, case-insensitive');
assert.strictEqual(U.buildSubject('[Update]', '[Updates] x', ''), '[Update] [Updates] x', 'only an exact start counts');
assert.strictEqual(U.buildSubject('[Update]', '', 'First line\nsecond line'), '[Update] First line', 'subject from details');
assert.strictEqual(U.buildSubject('[Update]', '', 'x'.repeat(80)), '[Update] ' + 'x'.repeat(50));
assert.strictEqual(U.buildSubject('[Update]', '', ''), '', 'nothing to send: stays empty');
assert.strictEqual(U.buildSubject('[Update]', '   ', '  \n  '), '');
assert.strictEqual(U.buildSubject('[Update]', null, null), '');
assert.strictEqual(U.buildSubject('x'.repeat(30), 's'.repeat(300), '').length, 200, 'capped at the server limit');
assert.strictEqual(U.buildSubject('', 's'.repeat(300), '').length, 200);
assert.strictEqual(U.buildSubject('\n', 'Hi', ''), 'Hi', 'a prefix that is only whitespace counts as none');

console.log('site tests passed');
