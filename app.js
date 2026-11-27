(function () {
  'use strict';

  var BUILD = '71a3fe5a'; // build stamp, written by tools/stamp.js

  var f = document.getElementById('f'), st = document.getElementById('status'),
      btn = document.getElementById('btn'), at = document.getElementById('at'),
      whenEl = document.getElementById('when'), msg = document.getElementById('msg'),
      subject = document.getElementById('subject'), chips = document.getElementById('chips'),
      dt = document.getElementById('dt');

  // Time buttons come from the settings text saved on this phone (falls back to the defaults).
  function loadPresetText() {
    try { return localStorage.getItem('qr_presets'); } catch (e) { return null; }
  }
  function loadPresets() {
    var t = loadPresetText(), r = t === null ? null : Presets.fromText(t);
    return r && r.ok ? r.presets : Presets.DEFAULTS;
  }
  var presets = loadPresets();

  // ---- Vibration feedback (Chrome on Android). One on/off switch in settings, default on. ----
  function loadHaptics() {
    try { return localStorage.getItem('qr_haptics') !== '0'; } catch (e) { return true; }
  }
  var haptics = loadHaptics();
  function buzz(kind) {
    if (!haptics) return;
    var p = Util.hapticPattern(kind);
    try { if (p !== null && navigator.vibrate) navigator.vibrate(p); } catch (e) { /* not supported or blocked */ }
  }

  // Time buttons. Built with the DOM API (no inline styles/HTML) so a strict CSP works.
  function renderChips() {
    chips.textContent = '';
    presets.forEach(function (p, i) {
      var label = document.createElement('label'), input = document.createElement('input'),
          span = document.createElement('span');
      label.style.setProperty('--base', p.color);
      input.type = 'radio'; input.name = 'p'; input.value = p.id; input.checked = i === 0;
      span.textContent = p.label;
      label.appendChild(input); label.appendChild(span); chips.appendChild(label);
    });
  }
  renderChips();

  // ---- Hour wheel (7 AM .. 10 PM): swipe a strip of hours, one vibration click per hour passed. ----
  // It starts dimmed at the next hour. Only a real touch / key / tap on it makes it active; when the strip stops
  // moving, the hour under the centre marker becomes the send time (like a time button, "next time it is that hour").
  var wheel = document.getElementById('wheel'), track = document.getElementById('wheelTrack');
  var wheelHour = null, userActive = false, lastIdx = -1, lastTick = 0, lastScrollAt = 0, scrollRaf = 0, settleTimer = 0, idleTimer = 0;
  var hasScrollEnd = 'onscrollend' in window;
  var reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function renderWheel() {
    track.textContent = '';
    var now = Date.now();
    Wheel.HOURS.forEach(function (h) {
      var d = document.createElement('div');
      d.className = 'wheel-item' + (Wheel.isTomorrow(h, now) ? ' tmrw' : '');
      d.setAttribute('role', 'option');
      d.textContent = Wheel.label(h);
      track.appendChild(d);
    });
  }
  // Geometry is measured, not assumed (the strip has a border and the centred item is scaled up):
  // offsetWidth ignores transforms; origin() is the scroll position at which the first hour sits under the marker.
  function itemWidth() { var first = track.firstElementChild; return first ? first.offsetWidth : 0; }
  function origin() { var first = track.firstElementChild; return first ? first.offsetLeft + first.offsetWidth / 2 - track.clientWidth / 2 : 0; }
  function posOf(i) { return origin() + Wheel.scrollFor(i, itemWidth()); }
  function centred() { return Wheel.indexAt(track.scrollLeft - origin(), itemWidth()); }
  function mark(i) { // highlight the centred hour and give the marker its colour
    for (var k = 0; k < track.children.length; k++) track.children[k].classList.toggle('on', k === i);
    wheel.style.setProperty('--c', Wheel.color(Wheel.HOURS[i]));
  }
  function goTo(i) { track.scrollTo({ left: posOf(i), behavior: reduceMotion ? 'auto' : 'smooth' }); }
  function wheelReset() { wheelHour = null; userActive = false; wheel.classList.remove('active'); }
  function commit(i) { // the user picked this hour
    wheelHour = Wheel.HOURS[i]; userActive = false; lastIdx = i; mark(i);
    at.value = ''; chips.querySelectorAll('input').forEach(function (r) { r.checked = false; });
    wheel.classList.add('active'); updateHint();
  }
  function settle() { if (userActive) commit(centred()); }
  function armIdleWatch() { // a touch that never turned into a scroll must not stay "active" forever
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (userActive && performance.now() - lastScrollAt > 450) userActive = false; else if (userActive) armIdleWatch();
    }, 500);
  }
  function touchedWheel() { userActive = true; armIdleWatch(); }
  function tick() { var t = performance.now(); if (t - lastTick < 25) return; lastTick = t; buzz('tick'); }

  renderWheel();
  var start = Wheel.startIndex(Date.now());
  track.scrollLeft = posOf(start); lastIdx = start; mark(start);
  ['pointerdown', 'touchstart', 'wheel'].forEach(function (n) { track.addEventListener(n, touchedWheel, { passive: true }); });
  track.addEventListener('scroll', function () {
    if (!userActive) return; // initial positioning and layout changes never tick or select
    lastScrollAt = performance.now();
    if (!scrollRaf) scrollRaf = requestAnimationFrame(function () {
      scrollRaf = 0; var i = centred();
      if (i !== lastIdx) { lastIdx = i; mark(i); tick(); }
    });
    if (!hasScrollEnd) { clearTimeout(settleTimer); settleTimer = setTimeout(settle, 140); }
  }, { passive: true });
  if (hasScrollEnd) track.addEventListener('scrollend', settle);
  track.addEventListener('click', function (e) { // tap an hour: slide it to the centre
    var el = e.target.closest && e.target.closest('.wheel-item');
    if (!el) return;
    var i = Array.prototype.indexOf.call(track.children, el);
    touchedWheel();
    if (Math.abs(track.scrollLeft - posOf(i)) < 2) commit(i); else goTo(i);
  });
  track.addEventListener('keydown', function (e) { // keyboard / switch access
    var i = centred(), n = Wheel.HOURS.length - 1, to = e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n : null;
    if (to === null) return;
    e.preventDefault(); to = Math.max(0, Math.min(n, to)); touchedWheel();
    if (to === i && wheelHour === null) commit(i); else if (to !== i) goTo(to);
  });

  function target() { // returns {date|null, error}
    if (at.value) {
      var d = new Date(at.value);
      return isNaN(d) ? { error: 'Invalid date' } : { date: d };
    }
    if (wheelHour !== null) return { date: Wheel.resolve(wheelHour, Date.now()) };
    return { date: Presets.resolve(presets, f.p.value) };
  }
  function fmt(d) {
    var far = d.getTime() - Date.now() > 6 * 864e5;
    return d.toLocaleString([], far
      ? { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }
      : { weekday:'short', hour:'numeric', minute:'2-digit' });
  }
  function updateHint() {
    dt.classList.toggle('filled', !!at.value);
    var t = target();
    whenEl.textContent = t.error ? t.error : (t.date ? 'Will send: ' + fmt(t.date) : 'Will send immediately');
  }

  // Only one way of choosing the time is active at a time. Picking a preset clears the calendar and the wheel;
  // picking a date deselects the presets and the wheel; the wheel clears the others (see commit()).
  chips.addEventListener('change', function () { at.value = ''; wheelReset(); updateHint(); });
  // Switching to Work puts the time back to Now.
  document.querySelector('input[name=t][value=work]').addEventListener('change', function () {
    at.value = ''; f.p.value = 'now'; wheelReset(); updateHint();
  });
  function onDateChange() {
    wheelReset();
    if (at.value) chips.querySelectorAll('input').forEach(function (r) { r.checked = false; });
    else f.p.value = 'now';
    updateHint();
  }
  at.addEventListener('input', onDateChange);
  at.addEventListener('change', onDateChange); // some Android pickers only fire change
  updateHint();

  // Launched from the icon shortcuts (?to=work&when=now) or the Android share sheet
  // (?title=&text=&url=). This only pre-fills the form; nothing is sent until you tap Send.
  (function applyLaunchParams() {
    if (!location.search) return;
    var p = Util.parseLaunch(location.search, presets.map(function (x) { return x.id; }));
    if (p.to) f.t.value = p.to;
    if (p.when) { f.p.value = p.when; at.value = ''; }
    if (p.subject) subject.value = p.subject;
    if (p.body) msg.value = p.body;
    updateHint();
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
  })();

  // Optional text put in front of every subject ("[Reminder]"), set in the settings.
  function loadPrefix() {
    try { return Util.sanitizePrefix(localStorage.getItem('qr_prefix')); } catch (e) { return ''; }
  }
  var prefix = loadPrefix();
  // Keep prefix + subject within the server's subject limit.
  function applyPrefixLimit() { subject.maxLength = Util.MAX_SUBJECT - (prefix ? prefix.length + 1 : 0); }
  applyPrefixLimit();

  var resetTimer;
  // Safe retry: every send carries a random id and the server never sends the same id twice. The id is kept for a
  // retry of the SAME form content (same text, recipient, prefix and chosen time) after a failure or a timeout, so
  // pressing Send again cannot duplicate an email that did go out. Success or any change starts a new id.
  var attempt = null;
  function attemptId() {
    var timeKey = at.value ? 'date:' + at.value : wheelHour !== null ? 'hour:' + wheelHour : 'chip:' + f.p.value;
    var key = [subject.value, msg.value, f.t.value, timeKey, prefix].join('\u0001');
    if (!attempt || attempt.key !== key) attempt = { key: key, id: Util.newRequestId() };
    return attempt.id;
  }
  function fail(text) {
    btn.classList.remove('done'); btn.textContent = 'Send'; st.className = 'err'; st.textContent = text;
    buzz('error');
  }

  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = target();
    if (t.error) { st.className = 'err'; st.textContent = t.error; buzz('error'); return; }
    if (!subject.value.trim() && !msg.value.trim()) {
      st.className = 'err'; st.textContent = 'Enter a subject or details'; buzz('error'); subject.focus(); return;
    }
    // Capitalise the first letter of the subject if the user didn't (links are left alone).
    subject.value = Util.capitalizeSubject(subject.value);
    var cfg = loadCfg();
    if (!cfg) { showSetup('Enter your URL and token first.'); return; }
    clearTimeout(resetTimer);
    btn.classList.remove('done');
    btn.disabled = true; st.className = ''; st.textContent = ''; btn.textContent = 'Sending…';
    buzz('tap'); // a tiny tick: the send has started
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 25000);
    // text/plain keeps this a "simple" cross-origin request (no preflight); the token travels in the body.
    fetch(cfg.url, {
      method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: cfg.token, id: attemptId(), subject: Util.buildSubject(prefix, subject.value, msg.value), body: msg.value,
                             target: f.t.value, sendAt: t.date ? t.date.toISOString() : '' })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        btn.disabled = false;
        if (!res || !res.ok) { fail(res && res.error ? res.error : 'Unexpected reply'); return; }
        btn.textContent = res.status + ' ✓'; btn.classList.add('done'); buzz('ok');
        resetTimer = setTimeout(function () { btn.textContent = 'Send'; btn.classList.remove('done'); }, 3000);
        attempt = null;
        subject.value = ''; msg.value = ''; at.value = ''; f.p.value = 'now'; wheelReset(); updateHint(); subject.focus();
      })
      .catch(function (err) {
        btn.disabled = false;
        var n = err && err.name;
        // A reply that is not JSON (e.g. a Google error page) means the server was reached: the mail may have been sent.
        fail(n === 'AbortError' ? 'Timed out. Not confirmed, check before resending.'
           : n === 'SyntaxError' ? 'Unexpected reply. Not confirmed, check your inbox before resending.'
           : 'No connection. Not sent.');
      })
      .finally(function () { clearTimeout(timer); });
  });

  // ---- Settings: URL + token live only in this phone's localStorage ----
  var setup = document.getElementById('setup'), cfgUrl = document.getElementById('cfgUrl'),
      cfgToken = document.getElementById('cfgToken'), cfgMsg = document.getElementById('cfgMsg'),
      cfgPresets = document.getElementById('cfgPresets'), cfgPrefix = document.getElementById('cfgPrefix'),
      cfgHaptics = document.getElementById('cfgHaptics'), gear = document.getElementById('gear'),
      cfgVersion = document.getElementById('cfgVersion'), sched = document.getElementById('sched'), schedBtn = document.getElementById('schedBtn'),
      schedList = document.getElementById('schedList'), schedState = document.getElementById('schedState'),
      schedRefresh = document.getElementById('schedRefresh');
  function loadCfg() {
    try {
      var u = localStorage.getItem('qr_url'), k = localStorage.getItem('qr_token');
      return u && k ? { url: u, token: k } : null;
    } catch (e) { return null; }
  }
  function validUrl(u) {
    try { var x = new URL(u); return x.protocol === 'https:' && x.hostname === 'script.google.com'; }
    catch (e) { return false; }
  }
  // Only one screen at a time: the form, settings (gear) or scheduled reminders (clock). The button of the open
  // screen turns into a close button (✕); the other one stays and switches screens.
  function setButtons() {
    var s = !setup.hidden, c = !sched.hidden;
    gear.textContent = s ? '✕' : '⚙';
    gear.setAttribute('aria-label', s ? 'Close settings' : 'Settings'); gear.title = s ? 'Close settings' : 'Settings';
    schedBtn.classList.toggle('open', c); // CSS shows the clock or the ✕ (SVG elements have no 'hidden' property)
    schedBtn.setAttribute('aria-label', c ? 'Close scheduled reminders' : 'Scheduled reminders'); schedBtn.title = c ? 'Close scheduled reminders' : 'Scheduled reminders';
  }
  // Which version is running? The build stamp is written into the page, the stylesheet and the script. If they
  // differ, the phone loaded a mix of old and new files (see "Service worker and caching" in the README).
  function showVersion() {
    var meta = document.querySelector('meta[name="build"]'), page = meta ? meta.content : '?',
        css = (getComputedStyle(document.documentElement).getPropertyValue('--build') || '').replace(/["'\s]/g, '') || '?';
    var same = page === BUILD && css === BUILD;
    cfgVersion.className = same ? '' : 'err';
    cfgVersion.textContent = same ? 'Version ' + BUILD : 'Files are out of sync (page ' + page + ', script ' + BUILD + ', style ' + css + '). Close and reopen the app.';
  }
  function showSetup(note) {
    sched.hidden = true; setup.hidden = false; f.hidden = true; cfgMsg.textContent = note || '';
    var c = loadCfg(); cfgUrl.value = c ? c.url : ''; cfgToken.value = '';
    cfgToken.placeholder = c ? 'Secret token (leave empty to keep)' : 'Secret token';
    cfgToken.required = !c;
    var pt = loadPresetText(); // a damaged saved value shows the defaults instead
    cfgPresets.value = pt !== null && Presets.fromText(pt).ok ? pt : Presets.DEFAULT_TEXT;
    cfgPrefix.value = prefix; cfgHaptics.checked = haptics;
    showVersion(); setButtons();
    cfgUrl.focus();
  }
  function showForm() {
    setup.hidden = true; sched.hidden = true; f.hidden = false;
    setButtons();
    subject.focus();
  }
  // Close = back to the form, throwing away unsaved edits. Works on first run too.
  function closeSettings() { if (!setup.hidden || !sched.hidden) showForm(); }
  gear.addEventListener('click', function () { setup.hidden ? showSetup() : closeSettings(); });
  document.getElementById('cfgClose').addEventListener('click', closeSettings);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSettings(); });

  // ---- Scheduled reminders: list what is still waiting on the server and cancel it ----
  var OLD_BACKEND = 'The backend is too old for this. Paste the new Code.gs into Apps Script and deploy a new version.';
  var schedGen = 0;
  // POST one request to the Apps Script web app and read its JSON reply (same way as sending).
  function apiPost(cfg, payload) {
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 25000);
    payload.token = cfg.token;
    return fetch(cfg.url, { method: 'POST', redirect: 'follow', signal: ctl.signal, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .finally(function () { clearTimeout(timer); });
  }
  function schedMsg(text, isError) { schedState.className = isError ? 'err' : ''; schedState.textContent = text; }
  function netMsg(err) {
    var n = err && err.name;
    return n === 'AbortError' ? 'Timed out. Try again.' : n === 'SyntaxError' ? 'Unexpected reply from the server.' : 'No connection.';
  }
  // An old backend treats list/cancel as a send and complains that subject and details are empty.
  function replyError(res) { return res && /both empty/i.test(res.error || '') ? OLD_BACKEND : (res && res.error) || 'Unexpected reply'; }
  function showSched() {
    if (!loadCfg()) { showSetup('Enter your URL and token first.'); return; }
    setup.hidden = true; f.hidden = true; sched.hidden = false; setButtons(); loadSched();
  }
  function loadSched() {
    var cfg = loadCfg(), gen = ++schedGen;
    if (!cfg) return;
    schedMsg('Loading…', false); schedList.textContent = ''; schedRefresh.disabled = true;
    apiPost(cfg, { action: 'list' }).then(function (res) {
      if (gen !== schedGen) return;
      if (res && res.ok && Array.isArray(res.items)) renderSched(res.items);
      else schedMsg(res && res.ok ? OLD_BACKEND : replyError(res), true);
    }).catch(function (err) {
      if (gen === schedGen) schedMsg(netMsg(err), true);
    }).finally(function () { if (gen === schedGen) schedRefresh.disabled = false; });
  }
  function renderSched(items) {
    schedList.textContent = '';
    schedMsg(items.length ? '' : 'Nothing scheduled.', false);
    items.forEach(function (it) { schedList.appendChild(schedRow(it)); });
  }
  function schedRow(it) {
    var li = document.createElement('li'), top = document.createElement('div'), time = document.createElement('span'),
        pill = document.createElement('span'), sub = document.createElement('div'), cancel = document.createElement('button');
    li.className = 'srow'; top.className = 'stop'; time.className = 'stime'; sub.className = 'ssub'; cancel.className = 'scancel'; cancel.type = 'button';
    time.textContent = fmt(new Date(it.at));
    pill.className = 'pill ' + (it.target === 'work' ? 'work' : it.target === 'personal' ? 'personal' : 'unknown');
    pill.textContent = it.target === 'work' ? 'Work' : it.target === 'personal' ? 'Personal' : '?';
    sub.textContent = it.subject; cancel.textContent = 'Cancel';
    top.appendChild(time); top.appendChild(pill); li.appendChild(top); li.appendChild(sub); li.appendChild(cancel);
    var armed = false, armTimer = 0;
    function disarm() { armed = false; clearTimeout(armTimer); cancel.textContent = 'Cancel'; cancel.classList.remove('arm'); cancel.disabled = false; }
    cancel.addEventListener('click', function () { // two taps: the first asks "Sure?", the second cancels
      if (!armed) { armed = true; cancel.textContent = 'Sure? Tap again'; cancel.classList.add('arm'); armTimer = setTimeout(disarm, 3000); return; }
      var cfg = loadCfg();
      if (!cfg) { showSetup('Enter your URL and token first.'); return; }
      clearTimeout(armTimer); cancel.disabled = true; cancel.textContent = 'Cancelling…';
      apiPost(cfg, { action: 'cancel', id: it.id }).then(function (res) {
        var gone = res && (res.ok || /^Not found/.test(res.error || '')); // already sent or gone: nothing left to cancel
        if (!gone) { schedMsg(replyError(res), true); disarm(); buzz('error'); return; }
        li.remove(); buzz('ok');
        schedMsg(res.ok ? (schedList.children.length ? 'Cancelled.' : 'Cancelled. Nothing else is scheduled.') : res.error, !res.ok);
      }).catch(function (err) { schedMsg(netMsg(err), true); disarm(); buzz('error'); });
    });
    return li;
  }
  schedBtn.addEventListener('click', function () { sched.hidden ? showSched() : closeSettings(); });
  schedRefresh.addEventListener('click', loadSched);
  document.getElementById('schedClose').addEventListener('click', closeSettings);
  setup.addEventListener('submit', function (e) {
    e.preventDefault();
    var url = cfgUrl.value.trim(), c = loadCfg(), token = cfgToken.value.trim() || (c && c.token) || '';
    if (!validUrl(url)) { cfgMsg.textContent = 'URL must be https://script.google.com/…'; return; }
    if (token.length < 24) { cfgMsg.textContent = 'Token looks too short.'; return; }
    var pr = Presets.fromText(cfgPresets.value);
    if (!pr.ok) { cfgMsg.textContent = pr.error; return; } // nothing is saved until everything is valid
    var newPrefix = Util.sanitizePrefix(cfgPrefix.value);
    try {
      localStorage.setItem('qr_url', url); localStorage.setItem('qr_token', token);
      if (cfgPresets.value.trim() === Presets.DEFAULT_TEXT) localStorage.removeItem('qr_presets');
      else localStorage.setItem('qr_presets', cfgPresets.value);
      if (newPrefix) localStorage.setItem('qr_prefix', newPrefix); else localStorage.removeItem('qr_prefix');
      if (cfgHaptics.checked) localStorage.removeItem('qr_haptics'); else localStorage.setItem('qr_haptics', '0');
    } catch (err) { cfgMsg.textContent = 'Could not save on this device.'; return; }
    presets = pr.presets; renderChips(); at.value = ''; wheelReset(); updateHint();
    prefix = newPrefix; applyPrefixLimit(); haptics = cfgHaptics.checked;
    showForm();
  });
  // "Test vibration" ignores the on/off switch: it answers "can this phone vibrate for this page at all?".
  document.getElementById('cfgBuzz').addEventListener('click', function () {
    var ok = false;
    if (!navigator.vibrate) { cfgMsg.textContent = 'This browser cannot vibrate.'; return; }
    try { ok = navigator.vibrate(Util.hapticPattern('test')); } catch (e) { ok = false; }
    cfgMsg.textContent = ok ? 'Buzz sent. If you felt nothing, check the phone\'s vibration and Do Not Disturb settings.'
                            : 'The browser blocked the vibration.';
  });
  document.getElementById('cfgReset').addEventListener('click', function () {
    cfgPresets.value = Presets.DEFAULT_TEXT;
    cfgMsg.textContent = 'Defaults restored. Tap Save to keep them.';
  });
  document.getElementById('cfgClear').addEventListener('click', function () {
    try { ['qr_url', 'qr_token', 'qr_presets', 'qr_prefix', 'qr_haptics'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
    presets = Presets.DEFAULTS; renderChips(); at.value = ''; wheelReset(); updateHint();
    prefix = ''; applyPrefixLimit(); haptics = true;
    showSetup('Settings removed.');
  });
  if (!loadCfg()) showSetup('First time here: enter your details.');

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
