import { parseApps } from './csv.js';
import { renderPreview } from './preview.js';
import { runPlay } from './play-runner.js';

const $ = (s) => document.querySelector(s);
const SITES = {
  ios: { label: 'App Store Connect', open: 'appstoreconnect.apple.com', match: (u) => u.origin === 'https://appstoreconnect.apple.com' },
  android: {
    label: 'Play Console',
    open: 'play.google.com/console',
    match: (u) => u.origin === 'https://play.google.com' && u.pathname.startsWith('/console'),
  },
};

let allApps = [];
let platform = 'ios';
let hasErrors = true;
let running = false;
let confirming = false;

const visibleApps = () => allApps.filter((a) => a.platform === platform);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- Activity log ----------
const PREFIX = { ok: '✓ ', warn: '! ', plan: '→ ' };
function log(level, text) {
  const el = $('#log');
  const line = document.createElement('div');
  line.className = 'l-' + level;
  const indent = /^\s/.test(text) ? '  ' : '';
  line.textContent = indent + (PREFIX[level] ?? '') + text.trim();
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
$('#clearLog').addEventListener('click', () => $('#log').replaceChildren());
$('#copyLog').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#log').innerText);
    const b = $('#copyLog');
    b.textContent = 'Copied';
    setTimeout(() => (b.textContent = 'Copy'), 1200);
  } catch { /* clipboard unavailable */ }
});

// ---------- Run button state ----------
function refresh() {
  const dry = $('#dry').checked;
  const btn = $('#run');
  btn.disabled = running || hasErrors || visibleApps().length === 0;
  btn.classList.toggle('live', !dry);
  btn.replaceChildren();
  if (running) btn.append(Object.assign(document.createElement('span'), { className: 'spinner' }));
  btn.append(running ? 'Running…' : dry ? 'Run dry run' : 'Run and apply changes');
  btn.hidden = confirming;
  $('#confirm').hidden = !confirming;
  $('#liveNote').hidden = dry;
}
$('#dry').addEventListener('change', () => { confirming = false; refresh(); });

// ---------- Platform tabs ----------
function setPlatform(p) {
  platform = p;
  confirming = false;
  for (const [id, key] of [['#tabIos', 'ios'], ['#tabAndroid', 'android']]) {
    $(id).classList.toggle('active', key === p);
    $(id).setAttribute('aria-selected', String(key === p));
  }
  renderCurrent();
  checkConn();
  refresh();
}
$('#tabIos').addEventListener('click', () => setPlatform('ios'));
$('#tabAndroid').addEventListener('click', () => setPlatform('android'));

// ---------- File loading ----------
function fill(box, list, items) {
  list.replaceChildren(...items.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  box.hidden = items.length === 0;
}

function renderCurrent() {
  const apps = visibleApps();
  const rows = apps.reduce((n, a) => n + a.rows.length, 0);
  const other = allApps.length - apps.length;
  const otherName = platform === 'ios' ? 'Google Play' : 'App Store';
  $('#stats').hidden = allApps.length === 0;
  $('#stats').textContent =
    `${plural(apps.length, 'app')}, ${plural(rows, 'row')}` + (other ? ` (${plural(other, 'app')} for ${otherName} on the other tab)` : '');
  renderPreview($('#preview'), apps);
  $('#previewCard').hidden = apps.length === 0;
}

async function loadFile(file) {
  if (!file) return;
  const res = parseApps(await file.text());
  allApps = res.apps;
  hasErrors = res.errors.length > 0;
  confirming = false;

  $('#fileName').textContent = file.name;
  fill($('#errorsBox'), $('#errors'), res.errors);
  fill($('#warningsBox'), $('#warnings'), res.warnings);

  // Jump to the tab that has something to run.
  if (!visibleApps().length && allApps.length) platform = allApps[0].platform;
  setPlatform(platform);

  $('#log').replaceChildren();
  if (hasErrors) log('err', 'Fix the errors above, then choose the file again.');
  refresh();
}

$('#pick').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', (e) => loadFile(e.target.files[0]));

const sec = $('#importSec');
for (const ev of ['dragenter', 'dragover']) {
  sec.addEventListener(ev, (e) => { e.preventDefault(); sec.classList.add('over'); });
}
for (const ev of ['dragleave', 'drop']) {
  sec.addEventListener(ev, (e) => { e.preventDefault(); sec.classList.remove('over'); });
}
sec.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

// ---------- The one tab this panel works on ----------
// Only the active tab of this window is used, and only if it is the site for the selected platform.
async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    return tab && SITES[platform].match(new URL(tab.url)) ? tab : null;
  } catch { return null; }
}
async function checkConn() {
  const tab = await currentTab();
  const site = SITES[platform];
  $('#conn').className = 'conn ' + (tab ? 'on' : 'off');
  $('#conn').textContent = tab
    ? `Connected to this ${site.label} tab.`
    : `Switch to your ${site.label} tab to run (${site.open}).`;
}
checkConn();
for (const ev of ['onUpdated', 'onRemoved', 'onActivated']) chrome.tabs[ev].addListener(checkConn);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'sa:log') log(msg.level, msg.text);
});

// ---------- Run (live runs ask for confirmation inline, no browser dialog) ----------
$('#run').addEventListener('click', () => {
  if ($('#dry').checked) return start(true);
  $('#confirmText').textContent = `Save changes to ${plural(visibleApps().length, 'app')} in ${SITES[platform].label}?`;
  confirming = true;
  refresh();
});
$('#confirmNo').addEventListener('click', () => { confirming = false; refresh(); });
$('#confirmYes').addEventListener('click', () => { confirming = false; start(false); });

async function start(dryRun) {
  const site = SITES[platform];
  const tab = await currentTab();
  if (!tab) {
    log('err', `Open your ${site.label} tab and run Launchsheet from there.`);
    refresh();
    return;
  }

  const apps = visibleApps();
  running = true;
  refresh();
  $('#log').replaceChildren();
  log('info', dryRun ? 'Dry run: nothing will be saved.' : `Saving changes to ${site.label}…`);
  if (platform === 'android') log('info', 'This tab will move between Play Console pages while Launchsheet works. Please leave it alone until it finishes.');
  try {
    let r;
    if (platform === 'android') {
      r = await runPlay({ apps, dryRun, tab, log });
    } else {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/asc.js'] });
      r = await chrome.tabs.sendMessage(tab.id, { type: 'sa:run', apps, dryRun });
    }
    const checked = plural(r.succeeded + r.failed, 'app');
    if (r.failed) {
      log('warn', `Finished with problems: ${plural(r.failed, 'app')} failed out of ${checked}. See the lines marked ✖.`);
    } else if (dryRun) {
      log('ok', r.changed
        ? `Dry run complete: ${plural(r.changed, 'change')} would be made across ${checked}. Turn off Dry run to apply them.`
        : `Dry run complete: ${checked} checked, everything is already up to date.`);
    } else {
      log('ok', r.changed
        ? `Done: ${plural(r.changed, 'change')} saved across ${checked}.`
        : `Done: ${checked} checked, nothing needed changing.`);
      if (platform === 'android' && r.changed) log('info', 'Listing changes are saved as drafts. Review and publish them in Play Console.');
    }
  } catch (err) {
    log('err', String(err?.message || err));
  } finally {
    running = false;
    refresh();
  }
}

refresh();
