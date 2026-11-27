// Network-first. Every file is revalidated with the server on every load; the cache is used only offline.
//
// WHY THIS IS MORE ELABORATE THAN A PLAIN fetch(): GitHub Pages sends "Cache-Control: max-age=600" on every file.
// Measured (see README, "Service worker and caching"): with a plain fetch(event.request) the app showed the OLD
// version for up to 10 minutes after a deploy, and a pull-to-refresh produced a MIX (new index.html with an old
// app.js / style.css). Two Chrome behaviours cause it, and both are handled below:
//  1. Navigation preload: Chrome sends its own navigation request, answered from the HTTP cache, while the worker
//     starts, and hands it back for fetch(event.request). So navigations fetch a NEW Request instead.
//  2. In-page memory cache: on reload Chrome reuses scripts/CSS it still considers fresh and never asks the worker.
//     So every response goes back to the page marked "Cache-Control: no-cache", which forces the page to ask again.
var CACHE = 'quick-reminder-v2'; // v2: drops the old cache (v1 stored stale and query-string pages)
var FILES = ['./', 'style.css', 'app.js', 'presets.js', 'wheel.js', 'util.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  // cache:'reload' skips the 10-minute HTTP cache, so the offline copy is really the deployed version.
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(FILES.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function noCache(res) {
  var h = new Headers(res.headers); h.set('Cache-Control', 'no-cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  // Only same-origin GETs; calls to script.google.com (sending mail) go straight to the network.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  var nav = req.mode === 'navigate';
  var net = nav ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' });
  var key = nav ? './' : req; // one stored page: share/shortcut query strings (shared text) are never kept
  e.respondWith(fetch(net).then(function (res) {
    if (res.ok && res.type === 'basic') { var copy = res.clone(); e.waitUntil(caches.open(CACHE).then(function (c) { return c.put(key, copy); })); }
    return noCache(res);
  }, function (err) {
    return caches.match(key).then(function (hit) { if (hit) return noCache(hit); throw err; });
  }));
});
