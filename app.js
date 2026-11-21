(function () {
  'use strict';

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

  function target() { // returns {date|null, error}
    if (at.value) {
      var d = new Date(at.value);
      return isNaN(d) ? { error: 'Invalid date' } : { date: d };
    }
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

  // Picking a preset clears the calendar; picking a date deselects the presets.
  chips.addEventListener('change', function () { at.value = ''; updateHint(); });
  // Switching to Work puts the time back to Now.
  document.querySelector('input[name=t][value=work]').addEventListener('change', function () {
    at.value = ''; f.p.value = 'now'; updateHint();
  });
  function onDateChange() {
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

  var resetTimer;
  function fail(text) { btn.textContent = 'Send'; st.className = 'err'; st.textContent = text; }

  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = target();
    if (t.error) { st.className = 'err'; st.textContent = t.error; return; }
    if (!subject.value.trim() && !msg.value.trim()) {
      st.className = 'err'; st.textContent = 'Enter a subject or details'; subject.focus(); return;
    }
    // Capitalise the first letter of the subject if the user didn't (links are left alone).
    subject.value = Util.capitalizeSubject(subject.value);
    var cfg = loadCfg();
    if (!cfg) { showSetup('Enter your URL and token first.'); return; }
    clearTimeout(resetTimer);
    btn.disabled = true; st.className = ''; st.textContent = ''; btn.textContent = 'Sending…';
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 25000);
    // text/plain keeps this a "simple" cross-origin request (no preflight); the token travels in the body.
    fetch(cfg.url, {
      method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: cfg.token, subject: subject.value, body: msg.value,
                             target: f.t.value, sendAt: t.date ? t.date.toISOString() : '' })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        btn.disabled = false;
        if (!res || !res.ok) { fail(res && res.error ? res.error : 'Unexpected reply'); return; }
        btn.textContent = res.status + ' ✓';
        resetTimer = setTimeout(function () { btn.textContent = 'Send'; }, 3000);
        subject.value = ''; msg.value = ''; at.value = ''; f.p.value = 'now'; updateHint(); subject.focus();
      })
      .catch(function (err) {
        btn.disabled = false;
        fail(err && err.name === 'AbortError' ? 'Timed out. Not confirmed, check before resending.'
                                              : 'No connection. Not sent.');
      })
      .finally(function () { clearTimeout(timer); });
  });

  // ---- Settings: URL + token live only in this phone's localStorage ----
  var setup = document.getElementById('setup'), cfgUrl = document.getElementById('cfgUrl'),
      cfgToken = document.getElementById('cfgToken'), cfgMsg = document.getElementById('cfgMsg'),
      cfgPresets = document.getElementById('cfgPresets');
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
  function showSetup(note) {
    setup.hidden = false; f.hidden = true; cfgMsg.textContent = note || '';
    var c = loadCfg(); cfgUrl.value = c ? c.url : ''; cfgToken.value = '';
    cfgToken.placeholder = c ? 'Secret token (leave empty to keep)' : 'Secret token';
    cfgToken.required = !c;
    var pt = loadPresetText(); // a damaged saved value shows the defaults instead
    cfgPresets.value = pt !== null && Presets.fromText(pt).ok ? pt : Presets.DEFAULT_TEXT;
    cfgUrl.focus();
  }
  function showForm() { setup.hidden = true; f.hidden = false; subject.focus(); }
  document.getElementById('gear').addEventListener('click', function () { setup.hidden ? showSetup() : (loadCfg() ? showForm() : 0); });
  setup.addEventListener('submit', function (e) {
    e.preventDefault();
    var url = cfgUrl.value.trim(), c = loadCfg(), token = cfgToken.value.trim() || (c && c.token) || '';
    if (!validUrl(url)) { cfgMsg.textContent = 'URL must be https://script.google.com/…'; return; }
    if (token.length < 24) { cfgMsg.textContent = 'Token looks too short.'; return; }
    var pr = Presets.fromText(cfgPresets.value);
    if (!pr.ok) { cfgMsg.textContent = pr.error; return; } // nothing is saved until everything is valid
    try {
      localStorage.setItem('qr_url', url); localStorage.setItem('qr_token', token);
      if (cfgPresets.value.trim() === Presets.DEFAULT_TEXT) localStorage.removeItem('qr_presets');
      else localStorage.setItem('qr_presets', cfgPresets.value);
    } catch (err) { cfgMsg.textContent = 'Could not save on this device.'; return; }
    presets = pr.presets; renderChips(); at.value = ''; updateHint();
    showForm();
  });
  document.getElementById('cfgReset').addEventListener('click', function () {
    cfgPresets.value = Presets.DEFAULT_TEXT;
    cfgMsg.textContent = 'Defaults restored. Tap Save to keep them.';
  });
  document.getElementById('cfgClear').addEventListener('click', function () {
    try { ['qr_url', 'qr_token', 'qr_presets'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
    presets = Presets.DEFAULTS; renderChips(); at.value = ''; updateHint();
    showSetup('Settings removed.');
  });
  if (!loadCfg()) showSetup('First time here: enter your details.');

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
