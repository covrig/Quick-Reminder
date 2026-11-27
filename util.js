// Pure helpers (no DOM). Loaded by the page as window.Util and by Node tests.
(function (root) {
  'use strict';

  var MAX_SUBJECT = 200, MAX_BODY = 1000;

  // Capitalise the first letter, but leave links alone ("https://…" must not become "Https://…").
  function capitalizeSubject(s) {
    s = String(s == null ? '' : s).trim();
    if (!s || /^(https?:\/\/|www\.)/i.test(s)) return s;
    return s.charAt(0).toLocaleUpperCase() + s.slice(1);
  }

  /**
   * Reads the launch URL's query string. It only PRE-FILLS the form; nothing is ever sent from a URL.
   *   to=personal|work          recipient (anything else is ignored)
   *   when=<preset id>          time button (unknown ids are ignored)
   *   title / text / url        Android "share" data: becomes subject and details
   * Returns only the fields that are valid. Values are plain strings, never HTML.
   */
  function parseLaunch(search, presetIds) {
    var out = {}, q;
    try { q = new URLSearchParams(search); } catch (e) { return out; }

    var to = q.get('to');
    if (to === 'personal' || to === 'work') out.to = to;

    var when = q.get('when');
    if (when && presetIds.indexOf(when) !== -1) out.when = when;

    var title = (q.get('title') || '').trim(),
        text = (q.get('text') || '').trim(),
        url = (q.get('url') || '').trim(),
        subject, parts = [];
    if (title) {
      subject = title; parts.push(text);
    } else {
      var nl = text.indexOf('\n');
      subject = nl === -1 ? text : text.slice(0, nl).trim();
      parts.push(nl === -1 ? '' : text.slice(nl + 1).trim());
    }
    if (url && text.indexOf(url) === -1 && title.indexOf(url) === -1) parts.push(url);
    var body = parts.filter(Boolean).join('\n');

    if (subject) out.subject = subject.slice(0, MAX_SUBJECT);
    if (body) out.body = body.slice(0, MAX_BODY);
    return out;
  }

  var MAX_PREFIX = 30;

  // Text saved in settings to go in front of every subject, e.g. "[Reminder]". One line, trimmed, max 30 chars.
  function sanitizePrefix(s) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PREFIX).trim();
  }

  /**
   * Subject that is actually sent.
   *  - no prefix: the subject as typed ('' is fine, the server then builds one from the details)
   *  - prefix + subject: "[Update] Call dentist" (not repeated if the subject already starts with it)
   *  - prefix + no subject: prefix + the first line of the details (50 chars)
   * Never longer than MAX_SUBJECT.
   */
  function buildSubject(prefix, subject, body) {
    prefix = sanitizePrefix(prefix);
    subject = String(subject == null ? '' : subject).trim();
    if (!prefix) return subject.slice(0, MAX_SUBJECT);
    if (subject && subject.toLowerCase().indexOf(prefix.toLowerCase()) === 0) return subject.slice(0, MAX_SUBJECT);
    var core = subject || String(body == null ? '' : body).trim().split('\n')[0].trim().slice(0, 50);
    return core ? (prefix + ' ' + core).slice(0, MAX_SUBJECT) : '';
  }

  // Vibration patterns in milliseconds (navigator.vibrate). Short ticks for the wheel, distinct buzzes for results.
  var HAPTICS = { tick: 10, tap: 20, ok: 60, error: [100, 80, 100], test: [150, 80, 150] };
  function hapticPattern(kind) {
    if (!Object.prototype.hasOwnProperty.call(HAPTICS, kind)) return null;
    var p = HAPTICS[kind];
    return Array.isArray(p) ? p.slice() : p;
  }

  // Random id for one send. The server never sends the same id twice, so a retry after a timeout cannot duplicate
  // the email. Matches the server's /^[A-Za-z0-9_-]{8,64}$/. `cryptoLike` is only for tests.
  function newRequestId(cryptoLike) {
    var c = cryptoLike || root.crypto;
    try { if (c && typeof c.randomUUID === 'function') return c.randomUUID(); } catch (e) { /* fall through */ }
    var s = '';
    for (var i = 0; i < 24; i++) s += Math.floor(Math.random() * 36).toString(36);
    return 'r' + s;
  }

  var api = { capitalizeSubject: capitalizeSubject, parseLaunch: parseLaunch, newRequestId: newRequestId,
              sanitizePrefix: sanitizePrefix, buildSubject: buildSubject, hapticPattern: hapticPattern,
              MAX_SUBJECT: MAX_SUBJECT, MAX_BODY: MAX_BODY, MAX_PREFIX: MAX_PREFIX };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Util = api;
})(typeof self !== 'undefined' ? self : this);
