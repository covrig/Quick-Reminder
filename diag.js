// Launch log for troubleshooting "the screen jumps when the app opens".
// Records, for the first 4 seconds, every change of the things that can make a page jump:
// window size, visual viewport, safe-area insets (status bar / camera cut-out), scroll, element positions,
// focus, layout shifts and paints. Shown in Settings under "Launch log". Kept in memory only, never stored or sent.
(function (root) {
  'use strict';

  var MAX_LINES = 120, WATCH_MS = 4000;
  var lines = [], last = null, t0 = performance.now();

  function ms() { return Math.round(performance.now() - t0); }
  function log(msg) { if (lines.length < MAX_LINES) lines.push('+' + ms() + ' ' + msg); }

  function displayMode() {
    var modes = ['fullscreen', 'standalone', 'minimal-ui', 'browser'];
    for (var i = 0; i < modes.length; i++) {
      try { if (matchMedia('(display-mode: ' + modes[i] + ')').matches) return modes[i]; } catch (e) {}
    }
    return '?';
  }

  function top(id) {
    var el = document.getElementById(id);
    return el ? Math.round(el.getBoundingClientRect().top) : '-';
  }

  // Safe-area insets are read through a hidden element whose padding is set with env() in style.css.
  function insets() {
    var p = document.getElementById('probe');
    if (!p) return '?';
    var c = getComputedStyle(p);
    return [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft].join(' ');
  }

  function snapshot() {
    var vv = root.visualViewport, ae = document.activeElement;
    return {
      window: innerWidth + 'x' + innerHeight,
      visualViewport: vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) + ' offsetTop=' + Math.round(vv.offsetTop) + ' scale=' + vv.scale.toFixed(2) : '-',
      'safe-area (t r b l)': insets(),
      scrollY: Math.round(root.scrollY),
      'top of header': top('gear'),
      'top of subject': top('subject'),
      'top of date field': top('at'),
      focus: ae && ae.id ? '#' + ae.id : (ae ? ae.tagName : '-'),
      'display-mode': displayMode(),
      visibility: document.visibilityState
    };
  }

  function sample() {
    var now = snapshot();
    if (!last) {
      Object.keys(now).forEach(function (k) { log(k + ' = ' + now[k]); });
    } else {
      Object.keys(now).forEach(function (k) { if (now[k] !== last[k]) log('CHANGED ' + k + ': ' + last[k] + ' -> ' + now[k]); });
    }
    last = now;
  }

  // Layout shifts and paints, with the element that moved and by how many pixels.
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        var src = (e.sources || []).map(function (s) {
          var n = s.node;
          return ((n && (n.id || n.className || n.nodeName)) || '?') + ' moved ' + Math.round(s.currentRect.y - s.previousRect.y) + 'px';
        }).join(', ');
        log('LAYOUT SHIFT ' + e.value.toFixed(4) + (src ? ' (' + src + ')' : ''));
      });
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { log('layout-shift not supported'); }
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) { log('paint ' + e.name + ' at ' + Math.round(e.startTime) + 'ms'); });
    }).observe({ type: 'paint', buffered: true });
  } catch (e) {}

  ['resize', 'orientationchange'].forEach(function (n) { root.addEventListener(n, function () { log('event ' + n); }); });
  document.addEventListener('focusin', function (e) { log('event focusin ' + (e.target.id ? '#' + e.target.id : e.target.nodeName)); });
  document.addEventListener('visibilitychange', function () { log('event visibility ' + document.visibilityState); });
  if (root.visualViewport) root.visualViewport.addEventListener('resize', function () { log('event visualViewport resize'); });

  // Sample on every animation frame for the first seconds.
  function frame() {
    sample();
    if (performance.now() - t0 < WATCH_MS) requestAnimationFrame(frame);
    else log('--- watching stopped ---');
  }
  requestAnimationFrame(frame);

  function header() {
    var nav = performance.getEntriesByType('navigation')[0], h = [];
    h.push('screen ' + screen.width + 'x' + screen.height + ', pixel ratio ' + root.devicePixelRatio);
    h.push('service worker controls page: ' + !!(navigator.serviceWorker && navigator.serviceWorker.controller));
    if (nav) h.push('DOMContentLoaded ' + Math.round(nav.domContentLoadedEventEnd) + 'ms, load ' + Math.round(nav.loadEventEnd) + 'ms');
    return h;
  }

  root.Diag = { text: function () { return header().concat(lines).join('\n'); }, lines: lines };
})(typeof self !== 'undefined' ? self : this);
