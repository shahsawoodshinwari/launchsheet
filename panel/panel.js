import { parseApps } from './csv.js';

const $ = (s) => document.querySelector(s);
let apps = [];
let hasErrors = true;
let running = false;

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
  $('#liveNote').hidden = dry;
}
$('#dry').addEventListener('change', refresh);

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

  $('#fileName').textContent = file.name;
  $('#stats').hidden = false;
  $('#stats').textContent = `${apps.length} app${apps.length === 1 ? '' : 's'}, ${res.rowCount} row${res.rowCount === 1 ? '' : 's'}`;
  fill($('#errorsBox'), $('#errors'), res.errors);
  fill($('#warningsBox'), $('#warnings'), res.warnings);

  const body = $('#preview');
  body.replaceChildren();
  for (const app of apps) {
    for (const r of app.rows) {
      const tr = document.createElement('tr');
      for (const [text, cls] of [[app.bundle_id, 'mono'], [r.locale, 'mono'], [r.name || '—', '']]) {
        tr.appendChild(Object.assign(document.createElement('td'), { textContent: text, className: cls }));
      }
      body.appendChild(tr);
    }
  }
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

// ---------- App Store Connect tab status ----------
const ASC = 'https://appstoreconnect.apple.com/*';
async function findTab() {
  const tabs = await chrome.tabs.query({ url: ASC });
  return tabs.find((t) => t.active) ?? tabs[0];
}
async function checkConn() {
  const tab = await findTab();
  $('#conn').className = 'conn ' + (tab ? 'on' : 'off');
  $('#conn').textContent = tab
    ? 'App Store Connect tab found.'
    : 'No App Store Connect tab. Open appstoreconnect.apple.com and sign in.';
}
checkConn();
for (const ev of ['onUpdated', 'onRemoved', 'onActivated', 'onCreated']) chrome.tabs[ev].addListener(checkConn);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'sa:log') log(msg.level, msg.text);
});

// ---------- Run ----------
$('#run').addEventListener('click', async () => {
  const dryRun = $('#dry').checked;
  const tab = await findTab();
  if (!tab) { log('err', 'No App Store Connect tab found. Open appstoreconnect.apple.com and sign in.'); return; }
  if (!dryRun && !confirm(`Apply changes to ${apps.length} app(s) in App Store Connect?`)) return;

  running = true;
  refresh();
  $('#log').replaceChildren();
  log('info', dryRun ? 'Dry run started…' : 'Run started…');
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/asc.js'] });
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'sa:run', apps, dryRun });
    log(res.failed ? 'warn' : 'ok', `Done: ${res.succeeded} succeeded, ${res.failed} failed.`);
  } catch (err) {
    log('err', String(err?.message || err));
  } finally {
    running = false;
    refresh();
  }
});

refresh();
