# Quick Email Reminder

Type a short subject on the phone, tap Send, and an email arrives in my Work or Personal inbox now or at a chosen time. Used as a reminder.

## How it fits together

```
Android phone (installed web app)  ──POST + secret token──▶  Google Apps Script  ──▶  Gmail  ──▶ my inbox
  hosted on GitHub Pages                                       (sends the mail)
```

| Part | Where it lives | Files |
|---|---|---|
| **Front end** (form, icon, full-screen install) | GitHub Pages: https://covrig.github.io/Quick-Reminder/ (this repo, `covrig/Quick-Reminder`, branch `main`, folder root) | files in the repo root (table below) |
| **Backend** (checks token, sends or queues mail) | script.google.com, my Google account | `backend/Code.gs`, `backend/appsscript.json` |

- The front end contains **no secrets**. The Apps Script web app URL and the token are typed into the phone once and kept in that browser's storage (⚙ button in the app).
- Scheduled reminders are stored on Google's side and sent by a trigger that runs every 5 minutes, so they arrive up to 5 minutes late and the phone does not need to be on.
- The Apps Script web app is open to **anyone with the URL**; the secret token is the only lock. Recipients are never taken from the request: it can only send to the two addresses saved in Script Properties.

## Repository layout and backup

This whole folder is one **public** git repo (`github.com/covrig/Quick-Reminder`), so it is its own backup. To restore: `git clone https://github.com/covrig/Quick-Reminder.git`.

```
/                      the website (what GitHub Pages serves)   ← see table below
backend/Code.gs        Apps Script backend: copy into script.google.com
backend/appsscript.json  Apps Script settings (access = Anyone)
backend/test.js        tests for the backend            (node backend/test.js)
test-site.js           tests for presets.js / util.js   (node test-site.js)
icon-src/              original icon artwork (icon.png, icon.svg)
README.md              this file
```

- GitHub Pages serves the whole repo, so `backend/` and this README are also readable on the web. They contain nothing secret: the security rests on the token, never on hiding the code.
- **Never commit** the token, the email addresses, or the Apps Script web app URL. They exist only in Apps Script **Script Properties** (and my password manager) and on the phone.
- Before pushing, a quick check: `git grep -nIE "[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}|macros/s/[A-Za-z0-9_-]{20,}"` should list only the fake test addresses in `backend/test.js` and `test-site.js` (`example.com`, `evil@…`) and nothing else.

## What is in the repo root (the website)

| File | Purpose |
|---|---|
| `index.html` | Page markup only (no inline scripts or styles, see CSP below) |
| `style.css` | All styling and colours |
| `app.js` | Form logic, sending, settings screen, share/shortcut handling |
| `presets.js` | Time buttons: defaults, parsing of the settings text, "next 8:30" maths |
| `util.js` | Subject capitalisation, reading `?to=…&when=…` and share parameters |
| `manifest.webmanifest` | Install info: name, icons, full screen, icon shortcuts, share target |
| `sw.js` | Service worker: caches files so the app opens offline (always loads the newest files when online) |
| `icon-192.png`, `icon-512.png` | App icons |

If you add a new file to the site, add it to `FILES` in `sw.js` and, if it is a script, to `index.html`.

**Why the scripts are in `<head>` as `<script defer blocking="render">`:** the time buttons are built by `app.js`. With the scripts at the end of `<body>`, the first paint on a slow launch showed the page without the buttons, and everything below them jumped down 160 px when the script ran (measured: layout shift 0.0247, date field moving from y=402 to y=562). `defer` runs the scripts after the page is parsed and `blocking="render"` makes Chrome wait for them before the first paint, so nothing moves afterwards. Do not move them back to the end of `<body>`. Any new script that changes the layout should be added the same way. Cost: first paint is about 30–70 ms later in a throttled test.

## Redeploy: change the front end (form, colours, buttons)

```
# edit the files, then:
node test-site.js        # if you touched presets.js or util.js
git add -A && git commit -m "describe change" && git push origin main
```

GitHub Pages rebuilds in about a minute. On the phone, close and reopen the app once. No change is needed in Apps Script.

Changes to `manifest.webmanifest` (name, icon, shortcuts, share target, colours) are picked up by Android on its own schedule, up to about a day. To force it, uninstall the app and install it again.

**Colours must match the page.** The manifest's `background_color` / `theme_color` (black) and the two `theme-color` meta tags in `index.html` (white in light mode, black in dark mode) are the colours Android paints around the page, for example in the strip that appears while the keyboard slides up. When they were blue, that blue flashed under the keyboard. The manifest can hold only one colour, so it uses the dark one. If the page background (`--bg` in `style.css`) ever changes, change all of these to match.

**Button colours:** the 8 time-button colours live in `PALETTE` in `presets.js`. `node test-site.js` fails if two of the nine buttons become too similar (in light or dark mode) or if white text on a button gets hard to read, so check the result there after changing a colour.

## Redeploy: change the backend (`backend/Code.gs`)

1. Edit `backend/Code.gs`, run `node backend/test.js`, then commit and push (backup).
2. Open the Apps Script project at script.google.com. Paste the new `Code.gs` over the old one (and `appsscript.json` if it changed: Project Settings → "Show appsscript.json in editor").
3. Deploy → **Manage deployments** → pencil icon → Version: **New version** → Deploy. The URL stays the same. (Deploy → *New deployment* creates a different URL, then the phone must be updated in ⚙.)
4. Settings of the deployment must stay: Execute as **Me**, Who has access **Anyone**.
5. Check it is locked: opening the URL in a browser must show only `Quick Reminder API`.

Saving the code is not enough: **the live app only changes when a new version is deployed.**

## Set up from scratch (new phone, lost project, new account)

1. **Apps Script:** new project, paste `backend/Code.gs` and `backend/appsscript.json`. Script Properties (Project Settings) needed:
   - `PERSONAL_EMAIL`, `WORK_EMAIL`: where mail is sent
   - `API_TOKEN`: random, 24+ characters (generate with `openssl rand -hex 24`, store in a password manager)
2. Run the function `setupTrigger` once (function dropdown → Run) and approve the permission screen. This creates the 5-minute trigger. Check: clock icon in the left sidebar lists `processQueue`.
3. Deploy as above (Web app, Me, Anyone). Copy the web app URL (`https://script.google.com/macros/s/…/exec`).
4. **New phone:** open https://covrig.github.io/Quick-Reminder/ in Chrome, enter the URL and token, then menu → **Install app**.
5. **New GitHub Pages site:** push this repo to GitHub, Settings → Pages → Deploy from branch `main`, folder `/ (root)`.

## Lost phone, leaked token, or odd emails

Change `API_TOKEN` in Script Properties. The old token stops working immediately. Enter the new one in the app (⚙). Nothing else needs redeploying.

## Limits built into the backend

| Limit | Value | Where |
|---|---|---|
| Sends or schedules per hour | 30 | `MAX_SENDS_PER_HOUR` in `Code.gs` |
| Wrong tokens before lockout | 10 in 15 min (nothing sends until the window passes) | `MAX_FAILS_PER_WINDOW` |
| Subject / details length | 200 / 1000 characters | `MAX_SUBJECT`, `MAX_LEN` |
| Delivery attempts of a scheduled mail | 5 (about 25 minutes), then it is dropped and an alert is mailed | `MAX_TRIES` |

Google also caps Gmail sending per day for the account. The script can only send mail, not read the inbox.

**Failed scheduled mail:** if Gmail cannot deliver a scheduled reminder, it is retried every 5 minutes. After 5 failures it is removed from the queue and an email "Reminder failed: <subject>" (with the original text, recipient and last error) is sent to `PERSONAL_EMAIL`. If that alert cannot be sent either, it is only logged (Apps Script → Executions). Mail that was never accepted by the app (offline, wrong token) is not queued anywhere: the app shows an error instead.

## Behaviour worth remembering

- Details are optional. If the subject is empty (and no prefix is set), the server builds one: "Reminder: " plus the first line of the details. A subject-only email is sent with a single space as the body.
- Clock buttons mean the *next* time that clock time occurs (after 8:30 AM has passed, "8:30 AM" means tomorrow). Hour/minute buttons (`+1h`) count from now. Switching to Work resets the time to Now.
- The first letter of the subject is capitalised automatically, except when it starts with a link.
- Times are worked out on the phone in its own time zone.

### Settings screen (⚙)
- Open with ⚙ in the top-right corner. While it is open that button turns into **✕** and closes it; "Close without saving" at the bottom and the Escape key do the same. Closing throws away edits that were not saved with **Save**.
- **Text before the subject** (optional, up to 30 characters, e.g. `[Reminder]` or `[Update]`): added in front of every subject when sending, so "Call dentist" goes out as "[Reminder] Call dentist". It is not added again if the subject already starts with it. If you leave the subject empty, it is added to the first line of the details instead. The subject box shows only what you typed and its length limit shrinks to leave room for the prefix. Stored only on that phone; empty means none.
- After a successful send the Send button turns **green** for 3 seconds ("Sent ✓" or "Scheduled ✓"), then returns to blue.

### Change the time buttons
⚙ → "Time buttons, one per line", then Save. Formats: `8:30`, `3:00 pm`, `18:00` (clock times) and `+1h`, `+90m` (from now). Up to 8 plus the fixed "Now". Anything it cannot read is rejected with the line number and nothing is saved. "Reset time buttons to defaults" restores the original list (8:30 AM, 9:30 AM, 3:00 PM, 6:00 PM, 7:00 PM, 1 h, 3 h, 6 h). The list is stored only on that phone.

### Share to the app and icon shortcuts (Android)
- **Share:** in any app choose Share → Quick Reminder. The title becomes the subject, the text and link go into the details. It only fills in the form; nothing is sent until you tap Send.
- **Shortcuts:** long-press the app icon for "Personal now" and "Work now". They open the form with that recipient and Now selected.
- Both come from `manifest.webmanifest` and need the app to be (re)installed after that file changes.

## Service worker and caching (why the app sometimes showed an old or half-updated version)

GitHub Pages sends `Cache-Control: max-age=600` on every file, so for 10 minutes the browser considers a file "fresh" and does not ask the server. With a plain `fetch()` in the service worker this was measured (cold launch after a deploy, simulated in headless Chromium with a persistent profile):
- the **first launch after a deploy showed the old version** (old HTML, JS and CSS);
- **pull-to-refresh then produced a mix**: new `index.html` with an old `app.js` and `style.css` (a new page whose script did nothing, which is how a new settings section stayed empty).

Two Chrome behaviours cause it: *navigation preload* (Chrome answers the page request from the HTTP cache while the worker starts) and the *in-page memory cache* (on reload it reuses scripts/CSS it still thinks are fresh). `sw.js` works around both: navigations fetch a new `Request`, every response is handed to the page with `Cache-Control: no-cache`, and the offline copy is stored with `cache: 'reload'`. After the change, HTML, JS and CSS were always the same version on cold launch, on reload, and offline (start URL `/` and `/index.html`; checked with the version-marker test described below).
- The cache is named `quick-reminder-v2`; change the name only if you want to force every phone to drop its stored copy.
- Offline the app opens from the last stored copy. Only one page is stored (share/shortcut links with `?title=…` are not kept, so shared text is not saved on the phone).
- **Rolling out a change to `sw.js` itself:** the phone first has to install the new worker (it checks on launch), so the first launch after that deploy can still show the old version. Launch the app twice.
- Method if you need to re-test: serve a copy of the site with `Cache-Control: max-age=600`, put a version marker in `index.html`, `app.js` and `style.css`, launch with a persistent Chromium profile, "deploy" a new marker, relaunch (new process, same profile), then reload twice and go offline; all three markers must always match.

## Content-Security-Policy (extra protection on the public page)

`index.html` has a `<meta http-equiv="Content-Security-Policy">` tag. It tells the browser that the page may only run its own scripts and styles, load its own images, and **send data only to `script.google.com` and `script.googleusercontent.com`**. If someone ever managed to inject code into the page, it still could not send the token to another server.

If sending suddenly stops with `No connection. Not sent.` while the phone is online and the URL is right, Google may have started answering from a host that is not in `connect-src`. Check in Chrome DevTools (chrome://inspect on the phone, or open the page on a PC) for a "violates the following Content Security Policy" message naming the host, add that exact host to `connect-src`, push, and reopen the app. To switch the protection off completely, delete the meta tag (and push).

## Troubleshooting

| Message in the app | Meaning / fix |
|---|---|
| `Unauthorized` | Token on the phone does not match `API_TOKEN`. Re-enter in ⚙. |
| `Locked, try again later` | Too many wrong tokens recently. Wait up to 15 minutes. |
| `Server not configured` | `API_TOKEN` missing or shorter than 24 characters. |
| `Missing script property …` | `PERSONAL_EMAIL` or `WORK_EMAIL` not set. |
| `Hourly limit reached` | More than 30 in an hour. Wait. |
| `No connection. Not sent.` | Phone offline, or the saved URL is wrong or not deployed to **Anyone**. If everything else is fine, see the Content-Security-Policy section. |
| Mail "Reminder failed: …" arrives | A scheduled reminder could not be delivered after 5 tries. Resend it by hand; check Gmail limits and Apps Script → Executions. |
| A time button or the settings box says `Line N: …` | The time-buttons text has an entry the app cannot read. Fix that line. |
| `Timed out. Not confirmed…` | Check the inbox before sending again. |
| `Unexpected reply. Not confirmed…` | The server answered with something that is not the app's reply (for example a Google error page). The mail may have been sent: check the inbox before sending again, then check the Apps Script deployment and Executions. |
| Scheduled mail never arrives | Triggers page (clock icon) must list `processQueue`; if missing, run `setupTrigger` again. Executions page shows errors. |
| Old layout still showing on the phone | Close and reopen the app once; Pages can take a minute. |

## Tests

- `node backend/test.js` tests the backend (`Code.gs`) with mocked Google services: token check, lockout, hourly limit, fixed recipients, sending, scheduling, retries and failure alerts. It sends no real mail. Run it after every change to `Code.gs`.
- `node test-site.js` tests the pure site logic: time-button parsing and maths, subject capitalisation, and share/shortcut parameters (including hostile input).
- Layout and clicks are not covered by these; check them in a browser at about 412 px wide.

## Icons

`icon-src/icon.png` is the original artwork and `icon-src/icon.svg` a vector copy. `icon-192.png` and `icon-512.png` in the repo root are the full-bleed sizes the installed app uses.
