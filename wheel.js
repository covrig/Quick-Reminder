// Hour wheel: pure helpers (no DOM). Loaded by the page (window.Wheel) and by Node tests.
// A strip of hours 7 AM .. 10 PM; the hour under the centre marker becomes the send time ("next time it is that hour").
(function (root) {
  'use strict';

  var FIRST = 7, LAST = 22;
  var HOURS = [];
  for (var h = FIRST; h <= LAST; h++) HOURS.push(h);

  function presets() { return (typeof module === 'object' && module.exports) ? require('./presets.js') : root.Presets; }

  // 7 -> "7 AM", 12 -> "12 PM", 22 -> "10 PM"
  function label(hour) { return (hour % 12 || 12) + ' ' + (hour < 12 ? 'AM' : 'PM'); }

  // Which item is under the centre marker. The strip has side padding so item i is centred at scrollLeft = i * width.
  function indexAt(scrollLeft, itemWidth) {
    if (!(itemWidth > 0)) return 0;
    return Math.max(0, Math.min(HOURS.length - 1, Math.round(scrollLeft / itemWidth)));
  }
  function scrollFor(index, itemWidth) { return index * itemWidth; }

  // Where the strip rests before the user touches it: the next full hour, kept inside 7 AM .. 10 PM.
  function startIndex(now) {
    var hour = new Date(now === undefined ? Date.now() : now).getHours() + 1;
    return Math.max(FIRST, Math.min(LAST, hour)) - FIRST;
  }

  // Next time the clock shows `hour`:00 (today if still ahead, otherwise tomorrow).
  function resolve(hour, now) { return presets().nextAt(hour, 0, now === undefined ? Date.now() : now); }
  function isTomorrow(hour, now) {
    now = now === undefined ? Date.now() : now;
    return resolve(hour, now).getDate() !== new Date(now).getDate();
  }

  // Colour of an hour: a hue ramp from morning amber to evening indigo, dark enough for white text.
  function color(hour) {
    var t = (hour - FIRST) / (LAST - FIRST), hue = 38 + t * 212, s = 0.62, l = 0.31;
    var a = s * Math.min(l, 1 - l);
    function ch(n) { var k = (n + hue / 30) % 12, v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))); return ('0' + Math.round(v * 255).toString(16)).slice(-2); }
    return '#' + ch(0) + ch(8) + ch(4);
  }

  var api = { FIRST: FIRST, LAST: LAST, HOURS: HOURS, label: label, indexAt: indexAt, scrollFor: scrollFor,
              startIndex: startIndex, resolve: resolve, isTomorrow: isTomorrow, color: color };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Wheel = api;
})(typeof self !== 'undefined' ? self : this);
