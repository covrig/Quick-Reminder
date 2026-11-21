// Run: node test.js  (mocks Apps Script globals, loads Code.gs)
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const TOKEN = 'a'.repeat(10) + 'B'.repeat(10) + '1234567890';
const props = { PERSONAL_EMAIL: 'me@example.com', WORK_EMAIL: 'me@work.example', API_TOKEN: TOKEN };
const sent = [];
let failNext = false;
let failTo = []; // addresses that always fail
let cacheStore = {};
const sandbox = {
  console, Date, JSON, String, Error, isNaN, Math, parseInt, Object,
  PropertiesService: { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; } }) },
  CacheService: { getScriptCache: () => ({
    get: (k) => (k in cacheStore ? cacheStore[k] : null),
    put: (k, v) => { cacheStore[k] = v; } }) },
  GmailApp: { sendEmail: (to, subj, body) => {
    if (failNext) { failNext = false; throw new Error('boom'); }
    if (failTo.includes(to)) throw new Error('cannot deliver to ' + to);
    sent.push({ to, subj, body }); } },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: {
    MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
    createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/Code.gs', 'utf8'), sandbox);

const post = (obj, raw) => JSON.parse(sandbox.doPost({ postData: { contents: raw !== undefined ? raw : JSON.stringify(obj) } }).text);
const ok = (o) => post(Object.assign({ token: TOKEN, target: 'work', sendAt: '' }, o));
const queue = () => JSON.parse(props.QUEUE || '[]');

// --- doGet serves no page ---
assert.strictEqual(sandbox.doGet().text, 'Quick Reminder API');

// --- auth ---
assert.deepStrictEqual(post({ subject: 'x', target: 'work' }), { ok: false, error: 'Unauthorized' });
assert.deepStrictEqual(post({ token: 'wrong', subject: 'x', target: 'work' }), { ok: false, error: 'Unauthorized' });
assert.deepStrictEqual(post(null, 'not json'), { ok: false, error: 'Unauthorized' });
assert.deepStrictEqual(sandbox.doPost({}) && JSON.parse(sandbox.doPost({}).text), { ok: false, error: 'Unauthorized' });
assert.strictEqual(sent.length, 0, 'nothing sent without a valid token');

// --- server not configured / weak token ---
const saved = props.API_TOKEN;
delete props.API_TOKEN;
assert.strictEqual(post({ token: '', subject: 'x', target: 'work' }).error, 'Server not configured');
props.API_TOKEN = 'short';
assert.strictEqual(post({ token: 'short', subject: 'x', target: 'work' }).error, 'Server not configured');
props.API_TOKEN = saved;
cacheStore = {}; // earlier failures should not count against later tests

// --- subject-only email, Work ---
assert.deepStrictEqual(ok({ subject: 'Buy milk', body: '' }), { ok: true, status: 'Sent' });
assert.deepStrictEqual(sent[0], { to: 'me@work.example', subj: 'Buy milk', body: ' ' });

// --- subject + body, personal ---
ok({ subject: 'Call', body: 'Ask about invoice', target: 'personal' });
assert.deepStrictEqual(sent[1], { to: 'me@example.com', subj: 'Call', body: 'Ask about invoice' });

// --- body only: subject derived from first line ---
ok({ subject: '', body: 'First line\nsecond' });
assert.strictEqual(sent[2].subj, 'Reminder: First line');

// --- recipients cannot be chosen by the caller ---
const before = sent.length;
assert.strictEqual(ok({ subject: 's', target: 'evil@attacker.example' }).error, 'Invalid recipient');
assert.strictEqual(ok({ subject: 's', target: undefined }).error, 'Invalid recipient');
assert.strictEqual(ok({ subject: 's', to: 'evil@attacker.example', addr: 'evil@attacker.example' }).ok, true);
assert.strictEqual(sent[sent.length - 1].to, 'me@work.example');
assert.strictEqual(sent.length, before + 1);

// --- validation ---
assert.match(ok({ subject: '  ', body: ' ' }).error, /both empty/);
assert.match(ok({ subject: 's'.repeat(201) }).error, /Subject too long/);
assert.match(ok({ subject: 's', body: 'a'.repeat(1001) }).error, /Details too long/);
assert.match(ok({ subject: 's', sendAt: 'garbage' }).error, /Invalid date/);
delete props.WORK_EMAIL;
assert.match(ok({ subject: 's' }).error, /Missing script property/);
props.WORK_EMAIL = 'me@work.example';
cacheStore = {};

// --- scheduling ---
let n = sent.length;
const future = new Date(Date.now() + 3600e3).toISOString();
assert.deepStrictEqual(ok({ subject: 'Later', sendAt: future }), { ok: true, status: 'Scheduled' });
assert.strictEqual(sent.length, n);
sandbox.processQueue();
assert.strictEqual(sent.length, n, 'not due yet');
assert.strictEqual(queue()[0].subject, 'Later');
assert.strictEqual(ok({ subject: 'Past', sendAt: new Date(Date.now() - 1000).toISOString() }).status, 'Sent');

// --- queue processing: due sent+removed, failures retried, legacy {msg} items ---
props.QUEUE = JSON.stringify([
  { subject: 'due1', body: '', addr: 'a@x', at: Date.now() - 1 },
  { msg: 'legacy body', addr: 'b@x', at: Date.now() - 1 },
  { subject: 'later', body: '', addr: 'c@x', at: Date.now() + 99999 },
]);
n = sent.length;
failNext = true;
sandbox.processQueue();
assert.deepStrictEqual(sent[n], { to: 'b@x', subj: 'Reminder: legacy body', body: 'legacy body' });
assert.deepStrictEqual(queue().map((i) => i.subject || i.msg), ['due1', 'later']);
sandbox.processQueue();
assert.deepStrictEqual(sent[n + 1], { to: 'a@x', subj: 'due1', body: ' ' });
assert.deepStrictEqual(queue().map((i) => i.subject), ['later']);

// --- repeated failure: retried, then dropped with ONE alert to the personal address ---
const errors = [];
sandbox.console = { error: (m) => errors.push(m), warn() {}, log() {} };
props.QUEUE = JSON.stringify([{ subject: 'Dentist', body: 'at 3', addr: 'bad@x', at: Date.now() - 1 }]);
failTo = ['bad@x'];
n = sent.length;
for (let run = 1; run <= 4; run++) {
  sandbox.processQueue();
  assert.strictEqual(queue().length, 1, 'still queued after failed run ' + run);
  assert.strictEqual(queue()[0].tries, run);
  assert.strictEqual(sent.length, n, 'no alert before the limit');
}
sandbox.processQueue(); // 5th failure
assert.strictEqual(queue().length, 0, 'dropped after 5 failures');
assert.strictEqual(sent.length, n + 1, 'exactly one alert');
assert.strictEqual(sent[n].to, 'me@example.com');
assert.strictEqual(sent[n].subj, 'Reminder failed: Dentist');
assert.ok(sent[n].body.includes('bad@x') && sent[n].body.includes('Details: at 3') && sent[n].body.includes('cannot deliver to bad@x'));
sandbox.processQueue();
assert.strictEqual(sent.length, n + 1, 'no second alert');

// a mail that fails twice and then works is delivered, with no alert
props.QUEUE = JSON.stringify([{ subject: 'Flaky', body: '', addr: 'flaky@x', at: Date.now() - 1 }]);
failTo = ['flaky@x']; n = sent.length;
sandbox.processQueue(); sandbox.processQueue();
failTo = [];
sandbox.processQueue();
assert.deepStrictEqual(sent.slice(n), [{ to: 'flaky@x', subj: 'Flaky', body: ' ' }]);
assert.strictEqual(queue().length, 0);

// if the alert itself cannot be sent the item is still dropped (queue never grows forever) and it is logged
props.QUEUE = JSON.stringify([{ subject: 'Lost', body: '', addr: 'bad@x', at: Date.now() - 1, tries: 4 }]);
failTo = ['bad@x', 'me@example.com']; n = sent.length;
sandbox.processQueue();
assert.strictEqual(queue().length, 0);
assert.strictEqual(sent.length, n);
assert.ok(errors.some((m) => m.includes('Could not send failure alert for "Lost"')));

// missing PERSONAL_EMAIL: still dropped and logged, no crash
props.QUEUE = JSON.stringify([{ subject: 'NoAddr', body: '', addr: 'bad@x', at: Date.now() - 1, tries: 4 }]);
failTo = ['bad@x']; const p = props.PERSONAL_EMAIL; delete props.PERSONAL_EMAIL;
sandbox.processQueue();
assert.strictEqual(queue().length, 0);
props.PERSONAL_EMAIL = p; failTo = [];

// --- hourly send limit ---
cacheStore = {};
let accepted = 0;
for (let i = 0; i < 40; i++) if (ok({ subject: 'spam ' + i }).ok) accepted++;
assert.strictEqual(accepted, 30);
assert.strictEqual(ok({ subject: 'one more' }).error, 'Hourly limit reached');

// --- lockout after repeated wrong tokens (even a correct token is refused until the window ends) ---
cacheStore = {};
for (let i = 0; i < 10; i++) assert.strictEqual(post({ token: 'nope' + i, subject: 'x', target: 'work' }).error, 'Unauthorized');
assert.strictEqual(post({ token: 'nope', subject: 'x', target: 'work' }).error, 'Locked, try again later');
assert.strictEqual(ok({ subject: 'x' }).error, 'Locked, try again later');

// --- token compare ---
assert.strictEqual(sandbox.safeEqual_('abc', 'abc'), true);
assert.strictEqual(sandbox.safeEqual_('abc', 'abd'), false);
assert.strictEqual(sandbox.safeEqual_('abc', 'abcd'), false);
assert.strictEqual(sandbox.safeEqual_('', ''), true);

// --- no browser-callable page: Code.gs must not use HtmlService ---
assert.ok(!/HtmlService/.test(fs.readFileSync(__dirname + '/Code.gs', 'utf8')));
assert.strictEqual(JSON.parse(fs.readFileSync(__dirname + '/appsscript.json', 'utf8')).webapp.access, 'ANYONE_ANONYMOUS');

console.log('all tests passed');
