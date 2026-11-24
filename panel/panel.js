import { parseApps } from './csv.js';
import { renderPreview } from './preview.js';

const $ = (s) => document.querySelector(s);
let apps = [];
let hasErrors = true;
let running = false;
let confirming = false;

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
  btn.disabled = running || hasErrors || apps.length === 0;
  btn.classList.toggle('live', !dry);
  btn.replaceChildren();
  if (running) btn.append(Object.assign(document.createElement('span'), { className: 'spinner' }));
  btn.append(running ? 'Running…' : dry ? 'Run dry run' : 'Run and apply changes');
  btn.hidden = confirming;
  $('#confirm').hidden = !confirming;
  $('#liveNote').hidden = dry;
}
$('#dry').addEventListener('change', () => { confirming = false; refresh(); });

// ---------- File loading ----------
function fill(box, list, items) {
  list.replaceChildren(...items.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  box.hidden = items.length === 0;
}

async function loadFile(file) {
  if (!file) return;
  const res = parseApps(await file.text());
  apps = res.apps;
  hasErrors = res.errors.length > 0;
  confirming = false;

  $('#fileName').textContent = file.name;
  $('#stats').hidden = false;
  $('#stats').textContent = `${apps.length} app${apps.length === 1 ? '' : 's'}, ${res.rowCount} row${res.rowCount === 1 ? '' : 's'}`;
  fill($('#errorsBox'), $('#errors'), res.errors);
  fill($('#warningsBox'), $('#warnings'), res.warnings);

  renderPreview($('#preview'), apps);
  $('#previewCard').hidden = apps.length === 0;

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
// Only the active tab of this window is used, and only if it is App Store Connect.
const ASC_ORIGIN = 'https://appstoreconnect.apple.com';
async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    return tab && new URL(tab.url).origin === ASC_ORIGIN ? tab : null;
  } catch { return null; }
}
async function checkConn() {
  const tab = await currentTab();
  $('#conn').className = 'conn ' + (tab ? 'on' : 'off');
  $('#conn').textContent = tab
    ? 'Connected to this App Store Connect tab.'
    : 'Switch to your App Store Connect tab to run.';
}
checkConn();
for (const ev of ['onUpdated', 'onRemoved', 'onActivated']) chrome.tabs[ev].addListener(checkConn);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'sa:log') log(msg.level, msg.text);
});

// ---------- Run (live runs ask for confirmation inline, no browser dialog) ----------
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

$('#run').addEventListener('click', () => {
  if ($('#dry').checked) return start(true);
  $('#confirmText').textContent = `Save changes to ${plural(apps.length, 'app')} in App Store Connect?`;
  confirming = true;
  refresh();
});
$('#confirmNo').addEventListener('click', () => { confirming = false; refresh(); });
$('#confirmYes').addEventListener('click', () => { confirming = false; start(false); });

async function start(dryRun) {
  const tab = await currentTab();
  if (!tab) {
    log('err', 'Open your App Store Connect tab and run Launchsheet from there.');
    refresh();
    return;
  }

  running = true;
  refresh();
  $('#log').replaceChildren();
  log('info', dryRun ? 'Dry run: nothing will be saved.' : 'Saving changes to App Store Connect…');
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/asc.js'] });
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'sa:run', apps, dryRun });
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
    }
  } catch (err) {
    log('err', String(err?.message || err));
  } finally {
    running = false;
    refresh();
  }
}

refresh();
