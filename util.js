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

  var api = { capitalizeSubject: capitalizeSubject, parseLaunch: parseLaunch,
              MAX_SUBJECT: MAX_SUBJECT, MAX_BODY: MAX_BODY };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Util = api;
})(typeof self !== 'undefined' ? self : this);
