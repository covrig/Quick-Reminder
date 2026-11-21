/**
 * Quick email reminder - Google Apps Script backend.
 * Script Properties required: PERSONAL_EMAIL, WORK_EMAIL, API_TOKEN (random, 24+ chars).
 */

var QUEUE_KEY = 'QUEUE';
var MAX_LEN = 1000;
var MAX_SUBJECT = 200;

var MAX_SENDS_PER_HOUR = 30;   // all sends and schedules together
var MAX_FAILS_PER_WINDOW = 10; // wrong tokens per 15 minutes before lockout
var MAX_TRIES = 5;             // failed delivery attempts of a scheduled mail before it is dropped + alerted

/**
 * The web app is deployed with access "Anyone", so the ONLY protection is the
 * API_TOKEN script property. There is deliberately no HTML page and no function
 * callable from a browser besides doPost/doGet. Recipients are never taken from the
 * request: only the keys 'work' / 'personal' that map to script properties.
 */
function doGet() {
  return ContentService.createTextOutput('Quick Reminder API').setMimeType(ContentService.MimeType.TEXT);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Compares without bailing out at the first differing character. */
function safeEqual_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Counts one event in a time window; returns the new count. Lock-protected. */
function bump_(prefix, windowSec) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cache = CacheService.getScriptCache();
    var key = prefix + Math.floor(Date.now() / (windowSec * 1000));
    var n = (parseInt(cache.get(key), 10) || 0) + 1;
    cache.put(key, String(n), windowSec);
    return n;
  } finally {
    lock.releaseLock();
  }
}

function peek_(prefix, windowSec) {
  var key = prefix + Math.floor(Date.now() / (windowSec * 1000));
  return parseInt(CacheService.getScriptCache().get(key), 10) || 0;
}

function doPost(e) {
  try {
    return json_(handle_(e));
  } catch (err) {
    return json_({ ok: false, error: 'Server error' });
  }
}

function handle_(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected || expected.length < 24) return { ok: false, error: 'Server not configured' };
  if (peek_('fails_', 900) >= MAX_FAILS_PER_WINDOW) return { ok: false, error: 'Locked, try again later' };

  var req;
  try { req = JSON.parse(e && e.postData && e.postData.contents); } catch (x) { req = null; }
  if (!req || typeof req !== 'object' || !safeEqual_(req.token || '', expected)) {
    bump_('fails_', 900);
    return { ok: false, error: 'Unauthorized' };
  }

  if (peek_('sends_', 3600) >= MAX_SENDS_PER_HOUR) return { ok: false, error: 'Hourly limit reached' };
  try {
    var status = sendReminder_(req.subject, req.body, req.target, req.sendAt);
    bump_('sends_', 3600);
    return { ok: true, status: status };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function getAddress_(target) {
  if (target !== 'work' && target !== 'personal') throw new Error('Invalid recipient');
  var key = target === 'work' ? 'WORK_EMAIL' : 'PERSONAL_EMAIL';
  var addr = PropertiesService.getScriptProperties().getProperty(key);
  if (!addr) throw new Error('Missing script property ' + key);
  return addr;
}

function makeSubject_(msg) {
  var first = String(msg).split('\n')[0];
  return 'Reminder: ' + (first.length > 50 ? first.slice(0, 50) + '…' : first);
}

function deliver_(addr, subject, body) {
  // Body may be empty (subject-only email); pass a space in that case.
  GmailApp.sendEmail(addr, subject, body || ' ');
}

/**
 * Called from doPost after the token check.
 * @param {string} subject email subject (may be empty if body is given)
 * @param {string} body    email body (may be empty if subject is given)
 * @param {string} target  'personal' | 'work'
 * @param {string} sendAt  optional ISO datetime ('' = send now)
 * @return {string} status text shown to the user
 */
function sendReminder_(subject, body, target, sendAt) {
  subject = String(subject || '').trim();
  body = String(body || '').trim();
  if (!subject && !body) throw new Error('Subject and details are both empty');
  if (subject.length > MAX_SUBJECT) throw new Error('Subject too long (max ' + MAX_SUBJECT + ')');
  if (body.length > MAX_LEN) throw new Error('Details too long (max ' + MAX_LEN + ')');
  if (!subject) subject = makeSubject_(body);
  var addr = getAddress_(target);

  if (sendAt) {
    var when = new Date(sendAt).getTime();
    if (isNaN(when)) throw new Error('Invalid date');
    if (when > Date.now()) {
      enqueue_({ subject: subject, body: body, addr: addr, at: when });
      return 'Scheduled';
    }
  }
  deliver_(addr, subject, body);
  return 'Sent';
}

function readQueue_() {
  var raw = PropertiesService.getScriptProperties().getProperty(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function writeQueue_(q) {
  PropertiesService.getScriptProperties().setProperty(QUEUE_KEY, JSON.stringify(q));
}

function enqueue_(item) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var q = readQueue_();
    q.push(item);
    writeQueue_(q);
  } finally {
    lock.releaseLock();
  }
}

/**
 * A scheduled mail that cannot be delivered is no longer retried forever:
 * after MAX_TRIES failed runs (about 25 minutes) it is dropped and an alert
 * is mailed to PERSONAL_EMAIL.
 */
function alertFailure_(item, subject, body, err) {
  try {
    var to = PropertiesService.getScriptProperties().getProperty('PERSONAL_EMAIL');
    if (!to) throw new Error('PERSONAL_EMAIL not set');
    GmailApp.sendEmail(
      to,
      'Reminder failed: ' + subject,
      'This scheduled reminder could not be sent after ' + MAX_TRIES + ' attempts and was dropped.\n\n' +
      'To: ' + item.addr + '\n' +
      'Was due: ' + new Date(item.at).toISOString() + '\n' +
      'Subject: ' + subject + '\n' +
      'Details: ' + (body || '(none)') + '\n\n' +
      'Last error: ' + String(err && err.message || err)
    );
  } catch (e) {
    console.error('Could not send failure alert for "' + subject + '": ' + e);
  }
}

/** Time-driven trigger: send everything that is due. */
function processQueue() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var now = Date.now();
    var remaining = [];
    readQueue_().forEach(function (item) {
      if (item.at > now) { remaining.push(item); return; }
      // Items queued by the older version only have `msg`.
      var body = item.body !== undefined ? item.body : item.msg;
      var subject = item.subject || makeSubject_(body);
      try {
        deliver_(item.addr, subject, body);
      } catch (e) {
        item.tries = (item.tries || 0) + 1;
        if (item.tries >= MAX_TRIES) alertFailure_(item, subject, body, e);
        else remaining.push(item); // retry on next run
      }
    });
    writeQueue_(remaining);
  } finally {
    lock.releaseLock();
  }
}

/** Run once manually to install the 5-minute trigger. */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processQueue') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processQueue').timeBased().everyMinutes(5).create();
}
