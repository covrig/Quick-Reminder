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
    put: (k, v) => { cacheStore[k] = v; },
    remove: (k) => { delete cacheStore[k]; } }) },
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

// ======================= safe retry: a request id is never sent twice =======================
cacheStore = {}; props.QUEUE = '[]'; failTo = [];
{
  const n0 = sent.length;
  assert.deepStrictEqual(ok({ id: 'abcdefg1', subject: 'Once' }), { ok: true, status: 'Sent' });
  assert.deepStrictEqual(ok({ id: 'abcdefg1', subject: 'Once' }), { ok: true, status: 'Already sent', duplicate: true });
  assert.deepStrictEqual(ok({ id: 'abcdefg1', subject: 'Once, edited', target: 'personal' }), { ok: true, status: 'Already sent', duplicate: true }, 'the id decides, not the content');
  assert.strictEqual(sent.length, n0 + 1, 'three identical requests, one email');
  assert.strictEqual(sent[n0].subj, 'Once');

  // different ids send; no id sends every time (old clients)
  ok({ id: 'abcdefg2', subject: 'Two' }); ok({ subject: 'Old client' }); ok({ subject: 'Old client' });
  assert.strictEqual(sent.length, n0 + 4);

  // scheduled: the duplicate is not queued twice and answers "Already scheduled"
  const future2 = new Date(Date.now() + 7200e3).toISOString();
  assert.deepStrictEqual(ok({ id: 'sched001', subject: 'Later', sendAt: future2 }), { ok: true, status: 'Scheduled' });
  assert.deepStrictEqual(ok({ id: 'sched001', subject: 'Later', sendAt: future2 }), { ok: true, status: 'Already scheduled', duplicate: true });
  assert.strictEqual(queue().length, 1);
  assert.strictEqual(queue()[0].id, 'sched001', 'the request id is the queue id');
  assert.strictEqual(queue()[0].target, 'work');

  // a request that is still being handled blocks a duplicate, without sending
  cacheStore['req_pending01'] = JSON.stringify({ pending: true });
  const n1 = sent.length;
  assert.deepStrictEqual(ok({ id: 'pending01', subject: 'Racing' }), { ok: false, error: 'Still sending, check again shortly' });
  assert.strictEqual(sent.length, n1);

  // a failed attempt must not block the retry
  failNext = true;
  assert.strictEqual(ok({ id: 'retry001', subject: 'Flaky' }).ok, false);
  assert.strictEqual(cacheStore['req_retry001'], undefined, 'claim released after a failure');
  assert.deepStrictEqual(ok({ id: 'retry001', subject: 'Flaky' }), { ok: true, status: 'Sent' });
  // validation failures release the claim too
  assert.match(ok({ id: 'empty001', subject: '', body: '' }).error, /both empty/);
  assert.deepStrictEqual(ok({ id: 'empty001', subject: 'Now fine' }), { ok: true, status: 'Sent' });

  // id format: 8-64 characters of A-Z a-z 0-9 _ -
  const n2 = sent.length;
  for (const bad of ['short', 'has space!', 'semi;colon', 'x'.repeat(65), '../../etc', '<b>12345678</b>']) {
    assert.deepStrictEqual(ok({ id: bad, subject: 'x' }), { ok: false, error: 'Invalid request id' }, JSON.stringify(bad));
  }
  assert.strictEqual(sent.length, n2, 'invalid ids send nothing');
  assert.strictEqual(ok({ id: 'x'.repeat(64), subject: 'edge' }).ok, true, '64 characters is allowed');
  assert.strictEqual(ok({ id: 'A_b-C_d-', subject: 'edge' }).ok, true, 'underscore and dash are allowed');
  assert.strictEqual(ok({ id: 12345678, subject: 'number' }).ok, true, 'a number with 8 digits is accepted as text');

  // the hourly limit does not eat a retry: an id that was already done still answers, a new one is refused and can be retried later
  cacheStore = {};
  assert.strictEqual(ok({ id: 'before01', subject: 'first' }).ok, true);
  for (let i = 0; i < 29; i++) ok({ subject: 'fill ' + i });
  assert.deepStrictEqual(ok({ subject: 'over the limit' }), { ok: false, error: 'Hourly limit reached' });
  assert.deepStrictEqual(ok({ id: 'before01', subject: 'first' }), { ok: true, status: 'Already sent', duplicate: true }, 'retry of a finished request still answers at the limit');
  assert.deepStrictEqual(ok({ id: 'toolate01', subject: 'new' }), { ok: false, error: 'Hourly limit reached' });
  assert.strictEqual(cacheStore['req_toolate01'], undefined, 'refused request leaves no claim behind');
}

// ======================= list and cancel scheduled reminders =======================
cacheStore = {}; props.QUEUE = '[]';
{
  const at1 = Date.now() + 3 * 3600e3, at2 = Date.now() + 1 * 3600e3;
  props.QUEUE = JSON.stringify([
    { id: 'idlate001', subject: 'Late one', body: 'secret details', addr: 'me@work.example', target: 'work', at: at1 },
    { msg: 'legacy words\nline 2', addr: 'me@example.com', at: at2 },            // queued by an old version: no id, no target, no subject
    { id: 'idodd0001', subject: 'Other place', body: '', addr: 'gone@x.example', at: at1 + 1 },
  ]);
  const before = sent.length;
  const l = post({ token: TOKEN, action: 'list' });
  assert.strictEqual(l.ok, true);
  assert.deepStrictEqual(l.items.map((i) => i.subject), ['Reminder: legacy words', 'Late one', 'Other place'], 'sorted by time, legacy subject built from its text');
  assert.deepStrictEqual(l.items.map((i) => i.target), ['personal', 'work', 'unknown'], 'recipient label from the stored target or by comparing the address');
  assert.ok(l.items.every((i) => /^[A-Za-z0-9_-]{8,64}$/.test(i.id)), 'every item has a valid id');
  const raw = JSON.stringify(l);
  assert.ok(!raw.includes('@') && !raw.includes('secret details') && !raw.includes('addr') && !raw.includes('body'), 'no email addresses and no details are ever returned');
  assert.ok(l.items.every((i) => Object.keys(i).sort().join() === 'at,id,subject,target'), 'only id, at, target, subject');
  assert.ok(queue().every((i) => i.id), 'ids handed out to old items are stored, so cancel works afterwards');
  assert.strictEqual(post({ token: TOKEN, action: 'list' }).items[0].id, l.items[0].id, 'ids are stable between calls');
  assert.strictEqual(sent.length, before, 'listing sends nothing');
  assert.strictEqual(post({ token: TOKEN, action: 'list' }).items.length, 3);
  props.QUEUE = '[]';
  assert.deepStrictEqual(post({ token: TOKEN, action: 'list' }), { ok: true, items: [] }, 'empty queue');

  // cancel
  props.QUEUE = JSON.stringify([{ id: 'cancel001', subject: 'Drop me', body: '', addr: 'me@work.example', target: 'work', at: Date.now() + 3600e3 }, { id: 'keepme001', subject: 'Keep', body: '', addr: 'me@work.example', target: 'work', at: Date.now() + 7200e3 }]);
  assert.deepStrictEqual(post({ token: TOKEN, action: 'cancel', id: 'cancel001' }), { ok: true, status: 'Cancelled' });
  assert.deepStrictEqual(queue().map((i) => i.id), ['keepme001']);
  assert.deepStrictEqual(post({ token: TOKEN, action: 'cancel', id: 'cancel001' }), { ok: false, error: 'Not found (maybe already sent)' }, 'second cancel');
  assert.deepStrictEqual(post({ token: TOKEN, action: 'cancel', id: 'nothere01' }), { ok: false, error: 'Not found (maybe already sent)' });
  for (const bad of [undefined, null, '', 'short', 'bad id here', '<script>']) assert.deepStrictEqual(post({ token: TOKEN, action: 'cancel', id: bad }), { ok: false, error: 'Invalid request id' }, JSON.stringify(bad));
  assert.deepStrictEqual(queue().map((i) => i.id), ['keepme001'], 'bad cancels remove nothing');

  // a cancelled scheduled request can be sent again with the same id
  cacheStore = {}; props.QUEUE = '[]';
  const fut = new Date(Date.now() + 5400e3).toISOString();
  assert.strictEqual(ok({ id: 'again0001', subject: 'Again', sendAt: fut }).status, 'Scheduled');
  assert.strictEqual(post({ token: TOKEN, action: 'cancel', id: 'again0001' }).status, 'Cancelled');
  assert.strictEqual(ok({ id: 'again0001', subject: 'Again', sendAt: fut }).status, 'Scheduled', 'not "Already scheduled" after a cancel');
  assert.strictEqual(queue().length, 1);

  // a reminder that was already sent cannot be cancelled
  props.QUEUE = JSON.stringify([{ id: 'late00001', subject: 'Due', body: '', addr: 'me@work.example', target: 'work', at: Date.now() - 1 }]);
  sandbox.processQueue();
  assert.deepStrictEqual(post({ token: TOKEN, action: 'cancel', id: 'late00001' }), { ok: false, error: 'Not found (maybe already sent)' });

  // list/cancel need the token, and wrong tokens count towards the lockout
  cacheStore = {};
  assert.deepStrictEqual(post({ action: 'list' }), { ok: false, error: 'Unauthorized' });
  assert.deepStrictEqual(post({ token: 'wrong', action: 'cancel', id: 'cancel001' }), { ok: false, error: 'Unauthorized' });
  for (let i = 0; i < 8; i++) post({ token: 'nope' + i, action: 'list' });
  assert.strictEqual(post({ token: 'nope', action: 'list' }).error, 'Locked, try again later');
  assert.strictEqual(post({ token: TOKEN, action: 'list' }).error, 'Locked, try again later', 'even the right token is refused while locked');
  cacheStore = {};

  // they do not use up the hourly send limit, and the limit does not block them
  for (let i = 0; i < 40; i++) post({ token: TOKEN, action: 'list' });
  assert.strictEqual(ok({ subject: 'still fine after 40 lists' }).ok, true);
  for (let i = 0; i < 29; i++) ok({ subject: 'fill ' + i });
  assert.strictEqual(ok({ subject: 'over' }).error, 'Hourly limit reached');
  assert.strictEqual(post({ token: TOKEN, action: 'list' }).ok, true, 'list works at the send limit');
  cacheStore = {};

  // unknown actions are refused and send nothing
  const n3 = sent.length;
  assert.deepStrictEqual(post({ token: TOKEN, action: 'delete-everything', subject: 'x', target: 'work' }), { ok: false, error: 'Unknown action' });
  assert.deepStrictEqual(post({ token: TOKEN, action: 'LIST' }), { ok: false, error: 'Unknown action' }, 'actions are case sensitive');
  assert.strictEqual(sent.length, n3);
  // explicit "send" and a missing action are the same thing
  assert.strictEqual(post({ token: TOKEN, action: 'send', subject: 'explicit', target: 'work' }).ok, true);
  assert.strictEqual(post({ token: TOKEN, action: null, subject: 'null action', target: 'work' }).ok, true);
}

// --- no browser-callable page: Code.gs must not use HtmlService ---
assert.ok(!/HtmlService/.test(fs.readFileSync(__dirname + '/Code.gs', 'utf8')));
assert.strictEqual(JSON.parse(fs.readFileSync(__dirname + '/appsscript.json', 'utf8')).webapp.access, 'ANYONE_ANONYMOUS');

console.log('all tests passed');
