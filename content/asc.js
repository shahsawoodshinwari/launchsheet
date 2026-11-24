// Runs inside appstoreconnect.apple.com so requests are same-origin and reuse your logged-in session.
// It talks to Apple's web-app API ("iris"), which mirrors the public App Store Connect API resources.
// NOTE: iris is undocumented and can change without notice.
(() => {
  // Re-injection replaces the previous message handler so the newest code always runs.
  if (window.__launchsheetHandler) {
    try { chrome.runtime.onMessage.removeListener(window.__launchsheetHandler); } catch { /* old context is gone */ }
  }

  const IRIS = 'https://appstoreconnect.apple.com/iris/v1';
  const EDITABLE = new Set([
    'PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY',
  ]);

  // Human-readable names for API fields, used in the activity log.
  const FIELD = {
    name: 'Name', subtitle: 'Subtitle', privacyPolicyUrl: 'Privacy policy URL',
    description: 'Description', keywords: 'Keywords', promotionalText: 'Promotional text',
    whatsNew: "What's New", supportUrl: 'Support URL', marketingUrl: 'Marketing URL', copyright: 'Copyright',
    contactFirstName: 'Contact first name', contactLastName: 'Contact last name',
    contactEmail: 'Contact email', contactPhone: 'Contact phone',
    demoAccountName: 'Demo username', demoAccountPassword: 'Demo password',
    demoAccountRequired: 'Sign-in required', notes: 'Review notes',
  };
  const PAST = { update: 'updated', create: 'created', add: 'added', set: 'set' };
  const prettyCategory = (id) => id.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

  const send = (level, text) =>
    chrome.runtime.sendMessage({ type: 'sa:log', level, text }).catch(() => {});

  async function api(method, path, body) {
    const res = await fetch(IRIS + path, {
      method,
      credentials: 'include',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      const detail = json?.errors?.map((e) => e.detail || e.title).join('; ') || text.slice(0, 300) || res.statusText;
      const auth = res.status === 401 || res.status === 403;
      const err = new Error(
        auth ? 'Not signed in to App Store Connect, or your role lacks permission. Sign in on that tab and try again.' : detail,
      );
      err.status = res.status;
      err.request = `${method} ${path}`;
      console.warn('[Launchsheet]', err.request, res.status, detail); // technical detail stays in the page console
      throw err;
    }
    return json;
  }

  const stateOf = (r) => r.attributes?.appVersionState || r.attributes?.appStoreState || r.attributes?.state;
  const q = encodeURIComponent;

  function attrs(row, map) {
    const out = {};
    for (const [csv, apiName] of Object.entries(map)) if (row[csv]) out[apiName] = row[csv];
    return out;
  }

  async function findApp(bundleId) {
    // The filter can match by prefix (e.g. "x.connect" also returns "x.connect-sandbox"),
    // so fetch several and require an exact bundleId match.
    const j = await api('GET', `/apps?filter[bundleId]=${q(bundleId)}&limit=200`);
    return j.data?.find((a) => a.attributes?.bundleId === bundleId) ?? null;
  }

  async function createApp(app, first) {
    const platform = 'IOS';
    const body = {
      data: {
        type: 'apps',
        attributes: { sku: app.sku, primaryLocale: app.primary_locale, bundleId: app.bundle_id },
        relationships: {
          appStoreVersions: { data: [{ type: 'appStoreVersions', id: '${new-appStoreVersion-id}' }] },
          appInfos: { data: [{ type: 'appInfos', id: '${new-appInfo-id}' }] },
        },
      },
      included: [
        {
          type: 'appStoreVersions',
          id: '${new-appStoreVersion-id}',
          attributes: { platform, versionString: app.version || '1.0' },
          relationships: {
            appStoreVersionLocalizations: {
              data: [{ type: 'appStoreVersionLocalizations', id: '${new-appStoreVersionLocalization-id}' }],
            },
          },
        },
        {
          type: 'appStoreVersionLocalizations',
          id: '${new-appStoreVersionLocalization-id}',
          attributes: { locale: app.primary_locale },
        },
        {
          type: 'appInfos',
          id: '${new-appInfo-id}',
          relationships: {
            appInfoLocalizations: { data: [{ type: 'appInfoLocalizations', id: '${new-appInfoLocalization-id}' }] },
          },
        },
        {
          type: 'appInfoLocalizations',
          id: '${new-appInfoLocalization-id}',
          attributes: { locale: app.primary_locale, name: first.name },
        },
      ],
    };
    return (await api('POST', '/apps', body)).data;
  }

  async function upsertLocalizations({ area, list, type, parentRel, parentType, parentId, rows, mapFor, ctx }) {
    const { act, same, log, failures } = ctx;
    const existing = new Map();
    const j = await api('GET', `${list}?limit=200`);
    for (const l of j.data ?? []) existing.set(l.attributes.locale, l);

    for (const row of rows) {
      const all = mapFor(row);
      if (!Object.keys(all).length) continue;
      const current = existing.get(row.locale);
      const label = `${area} (${row.locale})`;

      // Only send fields that actually differ from what App Store Connect already has.
      const a = current
        ? Object.fromEntries(Object.entries(all).filter(([k, v]) => (current.attributes[k] ?? '') !== v))
        : all;
      if (!Object.keys(a).length) { same(label); continue; }

      const id = current?.id;
      const verb = id ? 'update' : 'add';
      const describe = (x) =>
        Object.keys(x)
          .map((k) => (k === 'name' && current ? `Name ("${current.attributes.name}" → "${x.name}")` : FIELD[k] || k))
          .join(', ');
      const write = (attributes) =>
        id
          ? api('PATCH', `/${type}/${id}`, { data: { type, id, attributes } })
          : api('POST', `/${type}`, {
              data: {
                type,
                attributes: { locale: row.locale, ...attributes },
                relationships: { [parentRel]: { data: { type: parentType, id: parentId } } },
              },
            });
      try {
        try {
          await act(label, verb, describe(a), () => write(a));
        } catch (err) {
          // "What's New" cannot be set on an app's first version; retry without it.
          if (a.whatsNew && /whatsNew|what's new/i.test(err.message)) {
            const { whatsNew, ...rest } = a;
            log('warn', `  ${label}: "What's New" skipped (not allowed on an app's first version)`);
            if (Object.keys(rest).length) await act(label, verb, describe(rest), () => write(rest));
          } else throw err;
        }
      } catch (err) {
        // Keep going so one rejected field doesn't block the rest of the app.
        failures.push(label);
        log('err', `  ✖ ${label}: ${err.message}`);
      }
    }
  }

  async function processApp(app, dryRun) {
    const log = send;
    const failures = [];
    const stats = { changed: 0, same: 0 };

    const same = (area) => { stats.same++; log('info', `  ${area}: up to date`); };
    const act = async (area, verb, detail, fn) => {
      if (dryRun) {
        stats.changed++;
        log('plan', `  ${area}: would ${verb} ${detail}`);
        return null;
      }
      const r = await fn();
      stats.changed++;
      log('ok', `  ${area}: ${PAST[verb] || verb} ${detail}`);
      return r;
    };
    const ctx = { act, same, log, failures };

    const first = app.rows.find((r) => r.locale === app.primary_locale) || app.rows[0];
    const existing = await findApp(app.bundle_id);
    let appId = existing?.id;

    if (existing) {
      log('info', `▶ ${existing.attributes.name}  (${app.bundle_id})`);
      log('info', '  App found in App Store Connect');
    } else {
      log('info', `▶ ${first.name || app.bundle_id}  (${app.bundle_id})`);
      log('info', '  App not found in App Store Connect');
      if (!app.sku || !first.name) {
        throw new Error('To create this app the CSV needs a sku and a name.');
      }
      const created = await act('App', 'create', `"${first.name}" (SKU ${app.sku}, ${app.primary_locale})`, () => createApp(app, first));
      appId = created?.id;
      if (!appId) {
        log('info', '  The remaining steps run once the app exists.');
        return stats;
      }
    }

    // --- Version-level metadata ---
    const versions = await api('GET', `/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=20`);
    let version = versions.data?.find((v) => EDITABLE.has(stateOf(v)));
    if (!version) {
      if (!app.version) {
        throw new Error('No editable version exists. Add a "version" value to the CSV to create one.');
      }
      const created = await act('Version', 'create', app.version, () =>
        api('POST', '/appStoreVersions', {
          data: {
            type: 'appStoreVersions',
            attributes: { platform: 'IOS', versionString: app.version },
            relationships: { app: { data: { type: 'apps', id: appId } } },
          },
        }),
      );
      version = created?.data;
    } else {
      log('info', `  Editing version ${version.attributes.versionString} (${stateOf(version)})`);
    }

    if (version) {
      if (app.copyright) {
        if ((version.attributes?.copyright ?? '') === app.copyright) same('Copyright');
        else {
          try {
            await act('Copyright', 'set', `"${app.copyright}"`, () =>
              api('PATCH', `/appStoreVersions/${version.id}`, {
                data: { type: 'appStoreVersions', id: version.id, attributes: { copyright: app.copyright } },
              }),
            );
          } catch (err) {
            failures.push('Copyright');
            log('err', `  ✖ Copyright: ${err.message}`);
          }
        }
      }

      await upsertLocalizations({
        area: 'Store listing',
        list: `/appStoreVersions/${version.id}/appStoreVersionLocalizations`,
        type: 'appStoreVersionLocalizations',
        parentRel: 'appStoreVersion',
        parentType: 'appStoreVersions',
        parentId: version.id,
        rows: app.rows,
        mapFor: (r) => attrs(r, {
          description: 'description', keywords: 'keywords', promotional_text: 'promotionalText',
          whats_new: 'whatsNew', support_url: 'supportUrl', marketing_url: 'marketingUrl',
        }),
        ctx,
      });

      // --- App Review information (contact + demo account + notes) ---
      const review = attrs(app, {
        contact_first_name: 'contactFirstName', contact_last_name: 'contactLastName',
        contact_email: 'contactEmail', contact_phone_number: 'contactPhone',
        username: 'demoAccountName', password: 'demoAccountPassword', notes: 'notes',
      });
      if (review.demoAccountName || review.demoAccountPassword) review.demoAccountRequired = true;
      if (Object.keys(review).length) {
        const area = 'App Review info';
        try {
          let cur = null;
          try {
            cur = (await api('GET', `/appStoreVersions/${version.id}/appStoreReviewDetail`)).data ?? null;
          } catch (err) {
            if (err.status !== 404) throw err; // 404 = no review details yet
          }
          const changed = cur
            ? Object.fromEntries(Object.entries(review).filter(([k, v]) => (cur.attributes?.[k] ?? '') !== v))
            : review;
          // Field names only; values (like the password) are never logged.
          const detail = Object.keys(changed).map((k) => FIELD[k] || k).join(', ');
          if (!Object.keys(changed).length) {
            same(area);
          } else if (cur) {
            await act(area, 'update', detail, () =>
              api('PATCH', `/appStoreReviewDetails/${cur.id}`, {
                data: { type: 'appStoreReviewDetails', id: cur.id, attributes: changed },
              }),
            );
          } else {
            await act(area, 'add', detail, () =>
              api('POST', '/appStoreReviewDetails', {
                data: {
                  type: 'appStoreReviewDetails',
                  attributes: changed,
                  relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } },
                },
              }),
            );
          }
        } catch (err) {
          failures.push(area);
          log('err', `  ✖ ${area}: ${err.message}`);
        }
      }
    }

    // --- App-level info (name, subtitle, privacy URL, categories) ---
    const infos = await api('GET', `/apps/${appId}/appInfos`);
    const info = infos.data?.find((i) => EDITABLE.has(stateOf(i))) ?? infos.data?.[0];
    if (!info) throw new Error('No app info record was found for this app.');

    await upsertLocalizations({
      area: 'App info',
      list: `/appInfos/${info.id}/appInfoLocalizations`,
      type: 'appInfoLocalizations',
      parentRel: 'appInfo',
      parentType: 'appInfos',
      parentId: info.id,
      rows: app.rows,
      mapFor: (r) => attrs(r, { name: 'name', subtitle: 'subtitle', privacy_policy_url: 'privacyPolicyUrl' }),
      ctx,
    });

    // Accept "Health & Fitness", "health and fitness" or HEALTH_AND_FITNESS.
    const catId = (v) => v.trim().toUpperCase().replace(/&/g, 'AND').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    const primary = app.primary_category ? catId(app.primary_category) : '';
    const secondary = app.secondary_category ? catId(app.secondary_category) : '';
    if (primary || secondary) {
      try {
        let valid = null;
        try {
          valid = new Set((await api('GET', '/appCategories?limit=200')).data.map((c) => c.id));
        } catch { /* can't list categories; let Apple validate */ }
        for (const [col, id] of [['primary_category', primary], ['secondary_category', secondary]]) {
          if (id && valid && !valid.has(id)) {
            throw new Error(`${col} "${id}" is not a valid category. Valid IDs: ${[...valid].sort().join(', ')}`);
          }
        }
        if (primary && primary === secondary) throw new Error('primary_category and secondary_category must be different.');

        // Skip the write when the app already has these categories.
        let curPrimary = null;
        let curSecondary = null;
        try {
          const rel = (await api('GET', `/appInfos/${info.id}?include=primaryCategory,secondaryCategory`)).data?.relationships;
          curPrimary = rel?.primaryCategory?.data?.id ?? null;
          curSecondary = rel?.secondaryCategory?.data?.id ?? null;
        } catch { /* unknown; fall through and write */ }

        const wanted = [primary && prettyCategory(primary), secondary && prettyCategory(secondary)].filter(Boolean).join(' / ');
        const upToDate = (!primary || primary === curPrimary) && (!secondary || secondary === curSecondary);
        if (upToDate && (curPrimary || curSecondary)) {
          same('Categories');
        } else {
          const relationships = {};
          if (primary) relationships.primaryCategory = { data: { type: 'appCategories', id: primary } };
          if (secondary) relationships.secondaryCategory = { data: { type: 'appCategories', id: secondary } };
          await act('Categories', 'set', wanted, () =>
            api('PATCH', `/appInfos/${info.id}`, { data: { type: 'appInfos', id: info.id, relationships } }),
          );
        }
      } catch (err) {
        failures.push('Categories');
        log('err', `  ✖ Categories: ${err.message}`);
      }
    }

    const verb = dryRun ? 'would change' : 'changed';
    log('info', `  ${stats.changed} ${verb}, ${stats.same} already up to date`);
    if (failures.length) {
      throw new Error(`${failures.length} step${failures.length === 1 ? '' : 's'} failed: ${failures.join(', ')}`);
    }
    return stats;
  }

  async function run({ apps, dryRun }) {
    const totals = { succeeded: 0, failed: 0, changed: 0, unchanged: 0 };
    try {
      await api('GET', '/apps?limit=1'); // auth check
    } catch (err) {
      send('err', err.message);
      return { ...totals, failed: apps.length };
    }
    for (const app of apps) {
      try {
        const s = await processApp(app, dryRun);
        totals.succeeded++;
        totals.changed += s.changed;
        totals.unchanged += s.same;
      } catch (err) {
        totals.failed++;
        send('err', `  ✖ ${app.bundle_id}: ${err.message}`);
      }
    }
    return totals;
  }

  const handler = (msg, _sender, sendResponse) => {
    if (msg?.type === 'sa:run') {
      run(msg).then(sendResponse);
      return true; // async response
    }
  };
  window.__launchsheetHandler = handler;
  chrome.runtime.onMessage.addListener(handler);
})();
