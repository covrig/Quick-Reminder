// Time buttons: data and pure helpers. Loaded by the page (as window.Presets) and by Node tests.
(function (root) {
  'use strict';

  // Clock times mean "next occurrence"; hours mean "from now". 'now' is always first.
  var DEFAULTS = [
    { id: 'now',  label: 'Now',     color: '#1e8e4e' },
    { id: '0830', label: '8:30 AM', color: '#b7791f', h: 8,  m: 30 },
    { id: '0930', label: '9:30 AM', color: '#e0701b', h: 9,  m: 30 },
    { id: '1500', label: '3:00 PM', color: '#0f9d9a', h: 15, m: 0 },
    { id: '1800', label: '6:00 PM', color: '#4f5bd5', h: 18, m: 0 },
    { id: '1900', label: '7:00 PM', color: '#9b51d0', h: 19, m: 0 },
    { id: '1h',   label: '1 h',     color: '#d6459a', hours: 1 },
    { id: '3h',   label: '3 h',     color: '#8a6d3b', hours: 3 },
    { id: '6h',   label: '6 h',     color: '#5f6b7a', hours: 6 }
  ];

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
    return p.hours ? new Date(now + p.hours * 3600e3) : nextAt(p.h, p.m, now);
  }

  var api = { DEFAULTS: DEFAULTS, nextAt: nextAt, resolve: resolve };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Presets = api;
})(typeof self !== 'undefined' ? self : this);
