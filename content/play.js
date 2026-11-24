// Runs inside play.google.com/console. Google Play has no public API for this, so the script drives the
// Console like an end-to-end test: find elements by their stable `debug-id` attributes, set values,
// click, and wait for the UI to settle. The panel handles page navigation and sends one command per page.
// NOTE: these attributes are internal and can change without notice.
(() => {
  if (window.__launchsheetPlayHandler) {
    try { chrome.runtime.onMessage.removeListener(window.__launchsheetPlayHandler); } catch { /* old context is gone */ }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, { timeout = 15000, what = 'the page to be ready' } = {}) {
    const start = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what}.`);
      await sleep(150);
    }
  }

  const byId = (id, root = document) => root.querySelector(`[debug-id="${id}"]`);
  const field = (id) => byId(id)?.querySelector('input, textarea') ?? null;
  const text = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
  const norm = (s) => (s ?? '').replace(/\r\n/g, '\n');
  const isDisabled = (host) => {
    if (!host) return true;
    const b = host.matches('button') ? host : host.querySelector('button');
    return !b || b.disabled || b.getAttribute('aria-disabled') === 'true';
  };
  const press = (el) => { el.scrollIntoView?.({ block: 'center' }); el.click(); };

  // Set a value the way the Console's Angular inputs expect: native setter plus input/change/blur events.
  function setValue(el, value) {
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  // "English (United States) – en-US" (optionally followed by "Default") -> "en-US"
  const codeOf = (label) => /[–-]\s*([A-Za-z0-9-]+)(?:\s+Default)?\s*$/.exec((label || '').trim())?.[1] ?? null;

  // ---------- App list (Console home) ----------
  async function listApps(query) {
    await waitFor(() => document.querySelector('tr[debug-id="table-row"], [debug-id="empty-state"], [debug-id="create-app-button"]'), {
      what: 'the app list',
    });
    if (query) {
      const search = document.querySelector('input[aria-label="Search"]');
      if (search) { setValue(search, query); await sleep(1200); }
    }
    await sleep(500);
    return [...document.querySelectorAll('tr[debug-id="table-row"]')].map((tr) => {
      const href = [...tr.querySelectorAll('[href]')].map((a) => a.getAttribute('href')).find((h) => /\/app\/\d+/.test(h)) || '';
      return {
        title: text(byId('app-title', tr)),
        pkg: text(byId('app-package-name', tr)),
        appId: /\/app\/(\d+)/.exec(href)?.[1] ?? null,
        draft: /\bDraft\b/.test(text(tr)),
      };
    });
  }

  // ---------- Create app ----------
  async function createApp({ name, pkg, language, appType, pricing }) {
    await waitFor(() => field('app-name-input') && field('app-package-name-input'), { what: 'the Create app form' });
    setValue(field('app-name-input'), name);
    setValue(field('app-package-name-input'), pkg);

    const check = await waitFor(() => { const b = byId('check-package-name-availability-button'); return b && !isDisabled(b) ? b : null; },
      { what: 'the package name check' });
    press(check);
    await sleep(2500);
    const verdict = text(document.querySelector('[debug-id="vertical-section-container"]'));
    if (/already (in use|exists|taken)|not available|unavailable/i.test(verdict)) {
      throw new Error(`The package name ${pkg} is not available.`);
    }

    // Default language
    const dd = byId('language-dropdown');
    if (language && codeOf(text(dd).replace(/\barrow_drop_down\b/, '')) !== language) {
      press(dd);
      const item = await waitFor(
        () => [...document.querySelectorAll('material-select-item, [role="option"]')].find((i) => codeOf(text(i)) === language),
        { what: `the language ${language} in the list` },
      );
      press(item);
      await sleep(400);
    }

    press(byId(appType === 'game' ? 'game-radio' : 'app-radio'));
    press(byId(pricing === 'paid' ? 'paid-radio' : 'free-radio'));
    for (const id of ['guidelines-checkbox', 'export-laws-checkbox']) {
      const box = byId(id);
      if (box && box.getAttribute('aria-checked') !== 'true') press(box);
    }
    await sleep(500);

    const create = await waitFor(() => { const b = byId('create-app-button'); return b && !isDisabled(b) ? b : null; },
      { what: 'the Create app button to become enabled (check the form for errors)' });
    press(create);

    const appId = await waitFor(
      () => {
        const id = /\/app\/(\d+)/.exec(location.pathname)?.[1];
        if (id) return id;
        const err = [...document.querySelectorAll('[debug-id$="-error"]')].map(text).find(Boolean);
        if (err) throw new Error(err);
        return null;
      },
      { timeout: 45000, what: 'the new app to be created' },
    );
    return { appId };
  }

  // ---------- Store listing editor ----------
  const FIELDS = [
    ['name', 'app-name-input', 'Name'],
    ['short', 'short-description-input', 'Short description'],
    ['full', 'full-description-input', 'Full description'],
  ];
  const langButton = () => document.querySelector('language-switcher-button-menu button');
  const currentCode = () => codeOf(langButton()?.getAttribute('aria-label'));

  async function openLangMenu() {
    const btn = await waitFor(langButton, { what: 'the language picker' });
    if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
    await waitFor(() => document.querySelector('material-select-item'), { what: 'the language menu' });
    await sleep(200);
    return [...document.querySelectorAll('material-select-item')];
  }

  // Lists the languages already on the listing, then closes the menu by re-selecting the current one.
  async function presentLanguages() {
    const radios = (await openLangMenu()).filter((i) => i.getAttribute('role') === 'menuitemradio');
    const codes = radios.map((i) => codeOf(text(i))).filter(Boolean);
    radios.find((i) => codeOf(text(i)) === currentCode())?.click();
    await sleep(300);
    return new Set(codes);
  }

  async function addLanguages(codes) {
    const manage = (await openLangMenu()).find((i) => /Manage languages/.test(text(i)));
    if (!manage) throw new Error('"Manage languages" was not found in the language menu.');
    manage.click();
    const apply = await waitFor(() => byId('yes-button'), { what: 'the Manage languages dialog' });
    await sleep(500);
    const boxes = [...document.querySelectorAll('material-checkbox')];
    for (const code of codes) {
      const box = boxes.find((b) => codeOf(text(b).replace(/^check_box(_outline_blank)?\s*/, '')) === code);
      if (!box) throw new Error(`Google Play does not offer the language ${code}.`);
      if (box.getAttribute('aria-checked') !== 'true') press(box);
    }
    await sleep(300);
    press(apply);
    await waitFor(() => !byId('yes-button'), { what: 'the Manage languages dialog to close' });
    await sleep(800);
  }

  async function selectLanguage(code) {
    if (currentCode() === code) return;
    const item = (await openLangMenu()).find((i) => i.getAttribute('role') === 'menuitemradio' && codeOf(text(i)) === code);
    if (!item) throw new Error(`The language ${code} is not on this listing.`);
    item.click();
    await waitFor(() => currentCode() === code, { what: `the editor to switch to ${code}` });
    await sleep(700);
  }

  const readFields = () => Object.fromEntries(FIELDS.map(([key, id]) => [key, norm(field(id)?.value)]));

  async function saveDraft() {
    const btn = await waitFor(() => { const b = byId('save-draft-button'); return b && !isDisabled(b) ? b : null; },
      { what: 'Save as draft to become enabled' });
    press(btn);
    await waitFor(() => isDisabled(byId('save-draft-button')), { timeout: 20000, what: 'the draft to finish saving' });
    await sleep(500);
  }

  async function applyListing({ rows, dryRun }) {
    await waitFor(() => field('app-name-input') && field('full-description-input'), { what: 'the store listing editor' });
    await sleep(600);

    const present = await presentLanguages();
    const missing = rows.map((r) => r.locale).filter((c) => !present.has(c));
    if (missing.length && !dryRun) {
      await addLanguages(missing);
      missing.forEach((c) => present.add(c));
    }

    const results = [];
    for (const row of rows) {
      const want = { name: norm(row.name), short: norm(row.short_description), full: norm(row.description) };
      const given = FIELDS.filter(([key]) => want[key]);
      if (!given.length) continue;

      if (!present.has(row.locale)) {
        results.push({ locale: row.locale, status: 'would-add-language', fields: given.map(([, , label]) => label) });
        continue;
      }
      await selectLanguage(row.locale);
      const cur = readFields();
      const diff = given.filter(([key]) => cur[key] !== want[key]);
      if (!diff.length) { results.push({ locale: row.locale, status: 'up-to-date' }); continue; }

      const labels = diff.map(([, , label]) => label);
      const nameFrom = diff.some(([key]) => key === 'name') && cur.name ? cur.name : null;
      if (dryRun) { results.push({ locale: row.locale, status: 'would-update', fields: labels, nameFrom, nameTo: want.name }); continue; }

      for (const [key, id] of diff) setValue(field(id), want[key]);
      await sleep(400);
      await saveDraft();
      const after = readFields();
      results.push({
        locale: row.locale, status: 'updated', fields: labels, nameFrom, nameTo: want.name,
        verified: diff.every(([key]) => after[key] === want[key]),
      });
    }
    return results;
  }

  const handler = (msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('pl:')) return;
    (async () => {
      try {
        let data;
        if (msg.type === 'pl:list') data = await listApps(msg.query);
        else if (msg.type === 'pl:create') data = await createApp(msg);
        else if (msg.type === 'pl:listing') data = await applyListing(msg);
        else throw new Error(`Unknown command ${msg.type}`);
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true; // async response
  };
  window.__launchsheetPlayHandler = handler;
  window.__lsPlay = { listApps, applyListing, presentLanguages, codeOf }; // handy for debugging in DevTools
  chrome.runtime.onMessage.addListener(handler);
})();
