// Orchestrates a Google Play Console run from the side panel.
// Play Console is a single-page app, but each step here starts with a real navigation, which resets the
// page script. So the panel drives: navigate -> inject content/play.js -> send one command -> read the result.
import { isYes } from './csv.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** https://play.google.com/console/u/0/developers/<id>/... -> the developer-account base URL, or null. */
export function playBase(url) {
  const m = /^https:\/\/play\.google\.com\/console\/u\/(\d+)\/developers\/(\d+)/.exec(url || '');
  return m ? `https://play.google.com/console/u/${m[1]}/developers/${m[2]}` : null;
}

async function goto(tabId, url) {
  await new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(onUpdated); clearTimeout(timer); resolve(); };
    const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, 30000);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url });
  });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/play.js'] });
}

async function call(tabId, msg) {
  const res = await chrome.tabs.sendMessage(tabId, msg);
  if (!res?.ok) throw new Error(res?.error || 'No response from the Play Console page.');
  return res.data;
}

export async function runPlay({ apps, dryRun, tab, log }) {
  const base = playBase(tab.url);
  if (!base) {
    throw new Error('Open your developer account in Play Console first (the address should contain /developers/ and a number), then run again.');
  }
  const totals = { succeeded: 0, failed: 0, changed: 0, unchanged: 0 };

  await goto(tab.id, `${base}/home`);
  const listed = await call(tab.id, { type: 'pl:list' });

  for (const app of apps) {
    const stats = { changed: 0, same: 0 };
    const same = (area) => { stats.same++; log('info', `  ${area}: up to date`); };
    try {
      const first = app.rows.find((r) => r.locale === app.primary_locale) || app.rows[0];
      let found = listed.find((a) => a.pkg === app.bundle_id);
      if (!found) {
        await goto(tab.id, `${base}/home`);
        found = (await call(tab.id, { type: 'pl:list', query: app.bundle_id })).find((a) => a.pkg === app.bundle_id);
      }

      let appId = found?.appId;
      if (found) {
        log('info', `▶ ${found.title}  (${app.bundle_id})`);
        log('info', `  App found in Play Console${found.draft ? ' (draft)' : ''}`);
        if (!appId) throw new Error('The app was found but its ID could not be read from the page.');
      } else {
        log('info', `▶ ${first.name || app.bundle_id}  (${app.bundle_id})`);
        log('info', '  App not found in Play Console');
        if (!first.name) throw new Error('To create this app the CSV needs a name.');
        if (!isYes(app.accept_declarations)) {
          throw new Error('To create this app set accept_declarations to yes in the CSV. It confirms the Developer Program Policies and US export laws declarations.');
        }
        const detail = `"${first.name}" (${app.bundle_id}, ${app.primary_locale}, ${app.app_type === 'game' ? 'Game' : 'App'}, ${app.pricing === 'paid' ? 'Paid' : 'Free'})`;
        stats.changed++;
        if (dryRun) {
          log('plan', `  App: would create ${detail}`);
          log('info', '  The store listing is set once the app exists.');
          totals.succeeded++; totals.changed += stats.changed;
          log('info', `  ${stats.changed} would change, ${stats.same} already up to date`);
          continue;
        }
        await goto(tab.id, `${base}/create-new-app`);
        ({ appId } = await call(tab.id, {
          type: 'pl:create', name: first.name, pkg: app.bundle_id, language: app.primary_locale,
          appType: app.app_type, pricing: app.pricing,
        }));
        log('ok', `  App: created ${detail}`);
      }

      // Store listing, one default-language and translation entry per CSV row.
      await goto(tab.id, `${base}/app/${appId}/store-listings/default/edit`);
      const results = await call(tab.id, {
        type: 'pl:listing', dryRun,
        rows: app.rows.map((r) => ({ locale: r.locale, name: r.name, short_description: r.short_description, description: r.description })),
      });

      let failures = 0;
      for (const r of results) {
        const area = `Store listing (${r.locale})`;
        const fields = (r.fields || []).map((f) => (f === 'Name' && r.nameFrom ? `Name ("${r.nameFrom}" → "${r.nameTo}")` : f)).join(', ');
        if (r.status === 'up-to-date') same(area);
        else if (r.status === 'would-add-language') { stats.changed++; log('plan', `  ${area}: would add the language, then set ${fields}`); }
        else if (r.status === 'would-update') { stats.changed++; log('plan', `  ${area}: would update ${fields}`); }
        else if (r.status === 'updated') {
          stats.changed++;
          log('ok', `  ${area}: updated ${fields} (saved as draft)`);
          if (r.verified === false) { failures++; log('err', `  ✖ ${area}: the saved values did not match what was typed. Check this listing in Play Console.`); }
        }
      }
      if (failures) throw new Error(`${plural(failures, 'listing')} could not be verified`);

      log('info', `  ${stats.changed} ${dryRun ? 'would change' : 'changed'}, ${stats.same} already up to date`);
      totals.succeeded++;
      totals.changed += stats.changed;
      totals.unchanged += stats.same;
    } catch (err) {
      totals.failed++;
      log('err', `  ✖ ${app.bundle_id}: ${err.message}`);
    }
  }
  return totals;
}
