// Time buttons: parsing, data and pure helpers. Loaded by the page (window.Presets) and by Node tests.
(function (root) {
  'use strict';

  var MAX_ENTRIES = 8;
  // Colour of the button at each position after "Now".
  // Chosen so any two buttons stay far apart in colour in light and dark mode (checked in test-site.js).
  var PALETTE = ['#822b2b', '#c31dc3', '#171797', '#649717', '#1d81c3', '#329595', '#c31d70', '#ad811a'];
  var NOW = { id: 'now', label: 'Now', color: '#1e8e4e' };

  // What the settings box contains by default. One entry per line.
  var DEFAULT_TEXT = ['8:30 AM', '9:30 AM', '3:00 PM', '6:00 PM', '7:00 PM', '+1h', '+3h', '+6h'].join('\n');

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clockLabel(h, m) { return (h % 12 || 12) + ':' + pad(m) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function offsetLabel(min) {
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), r = min % 60;
    return r ? h + ' h ' + r + ' min' : h + ' h';
  }

  // One line -> {h, m} (clock time) or {minutes} (offset from now) or {error}.
  function parseLine(raw) {
    var s = raw.trim().toLowerCase().replace(/\s+/g, ' '), m;
    if ((m = /^\+ ?(\d{1,4}) ?(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)$/.exec(s))) {
      var minutes = parseInt(m[1], 10) * (m[2].charAt(0) === 'h' ? 60 : 1);
      if (minutes < 1 || minutes > 2880) return { error: 'an offset must be between 1 minute and 48 hours' };
      return { minutes: minutes };
    }
    if ((m = /^(\d{1,2})(?::(\d{2}))? ?(am|pm)?$/.exec(s))) {
      var h = parseInt(m[1], 10), mi = m[2] === undefined ? 0 : parseInt(m[2], 10), ap = m[3];
      if (m[2] === undefined && !ap) return { error: 'write a time like 8:30, 3 pm or 18:00' };
      if (ap) {
        if (h < 1 || h > 12) return { error: 'with am/pm the hour must be 1 to 12' };
        h = (h % 12) + (ap === 'pm' ? 12 : 0);
      } else if (h > 23) return { error: 'the hour must be 0 to 23' };
      if (mi > 59) return { error: 'the minutes must be 0 to 59' };
      return { h: h, m: mi };
    }
    return { error: 'not understood. Examples: 8:30, 3:00 pm, 18:00, +1h, +90m' };
  }

  // Settings text -> {ok:true, presets:[Now, ...]} or {ok:false, error:'Line 2: ...'}.
  function fromText(text) {
    var out = [NOW], seen = {}, lines = String(text == null ? '' : text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      if (out.length - 1 >= MAX_ENTRIES) return { ok: false, error: 'At most ' + MAX_ENTRIES + ' time buttons (plus Now)' };
      var p = parseLine(lines[i]);
      if (p.error) return { ok: false, error: 'Line ' + (i + 1) + ': ' + p.error };
      var entry = { color: PALETTE[out.length - 1] };
      if (p.minutes) {
        entry.minutes = p.minutes;
        entry.id = p.minutes % 60 === 0 ? (p.minutes / 60) + 'h' : p.minutes + 'm';
        entry.label = offsetLabel(p.minutes);
      } else {
        entry.h = p.h; entry.m = p.m;
        entry.id = pad(p.h) + pad(p.m);
        entry.label = clockLabel(p.h, p.m);
      }
      if (seen[entry.id]) return { ok: false, error: 'Line ' + (i + 1) + ': same time as an earlier line' };
      seen[entry.id] = true;
      out.push(entry);
    }
    return { ok: true, presets: out };
  }

  var DEFAULTS = fromText(DEFAULT_TEXT).presets;

  // Next time the clock shows h:m (today if still ahead, otherwise tomorrow), in the phone's time zone.
  function nextAt(h, m, now) {
    var d = new Date(now); d.setHours(h, m, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d;
  }

  // Date for a preset id, or null for "send now" / unknown id.
  function resolve(list, id, now) {
    now = now === undefined ? Date.now() : now;
    var p = list.filter(function (x) { return x.id === id; })[0];
    if (!p || p.id === 'now') return null;
    return p.minutes ? new Date(now + p.minutes * 60000) : nextAt(p.h, p.m, now);
  }

  var api = { DEFAULTS: DEFAULTS, DEFAULT_TEXT: DEFAULT_TEXT, MAX_ENTRIES: MAX_ENTRIES,
              fromText: fromText, nextAt: nextAt, resolve: resolve };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Presets = api;
})(typeof self !== 'undefined' ? self : this);
