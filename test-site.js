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

// --- DEFAULTS are exactly the original nine buttons, ids and colours unchanged ---
assert.deepStrictEqual(P.DEFAULTS.map((p) => p.id), ['now', '0830', '0930', '1500', '1800', '1900', '1h', '3h', '6h']);
assert.deepStrictEqual(P.DEFAULTS.map((p) => p.color),
  ['#1e8e4e', '#b7791f', '#e0701b', '#0f9d9a', '#4f5bd5', '#9b51d0', '#d6459a', '#8a6d3b', '#5f6b7a']);

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
assert.deepStrictEqual(ft('1:00\n2:00').presets.map((p) => p.color), ['#1e8e4e', '#b7791f', '#e0701b']);

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

console.log('site tests passed');
