// Runs inside appstoreconnect.apple.com so requests are same-origin and reuse your logged-in session.
// It talks to Apple's web-app API ("iris"), which mirrors the public App Store Connect API resources.
// NOTE: iris is undocumented and can change without notice.
(() => {
  if (window.__storeAutomatorLoaded) return;
  window.__storeAutomatorLoaded = true;

  const IRIS = 'https://appstoreconnect.apple.com/iris/v1';
  const EDITABLE = new Set([
    'PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY',
  ]);

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
      if (res.status === 401 || res.status === 403) {
        throw new Error(`${res.status}: not signed in to App Store Connect (or no permission). Sign in on this tab and retry.`);
      }
      const detail = json?.errors?.map((e) => e.detail || e.title).join('; ') || text.slice(0, 300);
      throw new Error(`${method} ${path} -> ${res.status}: ${detail}`);
    }
    return json;
  }

  const stateOf = (r) => r.attributes?.appVersionState || r.attributes?.appStoreState || r.attributes?.state;
  const q = encodeURIComponent;

  function attrs(row, map) {
    const out = {};
    for (const [csv, api] of Object.entries(map)) if (row[csv]) out[api] = row[csv];
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

  async function upsertLocalizations({ list, type, parentRel, parentType, parentId, rows, mapFor, act, log, failures }) {
    const existing = new Map();
    const j = await api('GET', `${list}?limit=200`);
    for (const l of j.data ?? []) existing.set(l.attributes.locale, l);

    for (const row of rows) {
      const all = mapFor(row);
      const current = existing.get(row.locale);
      // Only send fields that actually differ from what App Store Connect already has.
      const a = current
        ? Object.fromEntries(Object.entries(all).filter(([k, v]) => (current.attributes[k] ?? '') !== v))
        : all;
      if (!Object.keys(a).length) {
        if (Object.keys(all).length) log('info', `  ${type} [${row.locale}] already up to date`);
        continue;
      }
      const id = current?.id;
      const nameNote = current && a.name ? ` (name: "${current.attributes.name}" -> "${a.name}")` : '';
      const label = `${type} [${row.locale}] ${id ? 'update' : 'create'}: ${Object.keys(a).join(', ')}${nameNote}`;
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
          await act(label, () => write(a));
        } catch (err) {
          // "What's New" cannot be set on an app's first version; retry without it.
          if (a.whatsNew && /whatsNew/i.test(err.message)) {
            const { whatsNew, ...rest } = a;
            log('warn', `  whatsNew skipped for ${row.locale} (not allowed on a first version).`);
            if (Object.keys(rest).length) await act(label + ' (retry)', () => write(rest));
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
    const act = async (desc, fn) => {
      if (dryRun) { log('plan', `  would ${desc}`); return null; }
      const r = await fn();
      log('ok', `  ${desc}`);
      return r;
    };

    log('info', `▶ ${app.bundle_id}`);
    const first = app.rows.find((r) => r.locale === app.primary_locale) || app.rows[0];

    let existing = await findApp(app.bundle_id);
    let appId = existing?.id;
    if (existing) {
      log('info', `  found existing app "${existing.attributes.name}" (${appId})`);
    } else {
      if (!app.sku || !first.name) {
        throw new Error('app does not exist yet; sku and name are required to create it');
      }
      const created = await act(`create app "${first.name}" (sku ${app.sku}, ${app.primary_locale})`, () => createApp(app, first));
      appId = created?.id;
      if (!appId) return; // dry run, nothing more to read
    }

    // --- Version-level metadata ---
    const versions = await api('GET', `/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=20`);
    let version = versions.data?.find((v) => EDITABLE.has(stateOf(v)));
    if (!version) {
      if (!app.version) throw new Error('no editable version exists; add a "version" value to create one');
      const created = await act(`create version ${app.version}`, () =>
        api('POST', '/appStoreVersions', {
          data: {
            type: 'appStoreVersions',
            attributes: { platform: 'IOS', versionString: app.version },
            relationships: { app: { data: { type: 'apps', id: appId } } },
          },
        }),
      );
      version = created?.data;
    }
    if (version) {
      if (app.copyright) {
        await act(`set copyright`, () =>
          api('PATCH', `/appStoreVersions/${version.id}`, {
            data: { type: 'appStoreVersions', id: version.id, attributes: { copyright: app.copyright } },
          }),
        );
      }
      await upsertLocalizations({
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
        act, log, failures,
      });

      // --- App Review information (contact + demo account + notes) ---
      const review = attrs(app, {
        contact_first_name: 'contactFirstName', contact_last_name: 'contactLastName',
        contact_email: 'contactEmail', contact_phone_number: 'contactPhone',
        username: 'demoAccountName', password: 'demoAccountPassword', notes: 'notes',
      });
      if (review.demoAccountName || review.demoAccountPassword) review.demoAccountRequired = true;
      if (Object.keys(review).length) {
        try {
          let cur = null;
          try {
            cur = (await api('GET', `/appStoreVersions/${version.id}/appStoreReviewDetail`)).data ?? null;
          } catch (err) {
            if (!/ 404/.test(err.message)) throw err; // 404 = no review details yet
          }
          const changed = cur
            ? Object.fromEntries(Object.entries(review).filter(([k, v]) => (cur.attributes?.[k] ?? '') !== v))
            : review;
          // Log field names only; never print the password.
          const names = Object.keys(changed).join(', ');
          if (!Object.keys(changed).length) {
            log('info', '  appStoreReviewDetails already up to date');
          } else if (cur) {
            await act(`appStoreReviewDetails update: ${names}`, () =>
              api('PATCH', `/appStoreReviewDetails/${cur.id}`, {
                data: { type: 'appStoreReviewDetails', id: cur.id, attributes: changed },
              }),
            );
          } else {
            await act(`appStoreReviewDetails create: ${names}`, () =>
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
          failures.push('review details');
          log('err', `  ✖ appStoreReviewDetails: ${err.message}`);
        }
      }
    }

    // --- App-level info (name, subtitle, privacy URL, categories) ---
    const infos = await api('GET', `/apps/${appId}/appInfos`);
    const info = infos.data?.find((i) => EDITABLE.has(stateOf(i))) ?? infos.data?.[0];
    if (!info) throw new Error('no appInfo found for this app');

    await upsertLocalizations({
      list: `/appInfos/${info.id}/appInfoLocalizations`,
      type: 'appInfoLocalizations',
      parentRel: 'appInfo',
      parentType: 'appInfos',
      parentId: info.id,
      rows: app.rows,
      mapFor: (r) => attrs(r, { name: 'name', subtitle: 'subtitle', privacy_policy_url: 'privacyPolicyUrl' }),
      act, log, failures,
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
            throw new Error(`${col} "${id}" is not a valid category ID. Valid: ${[...valid].sort().join(', ')}`);
          }
        }
        if (primary && primary === secondary) throw new Error('primary_category and secondary_category must differ');

        const relationships = {};
        if (primary) relationships.primaryCategory = { data: { type: 'appCategories', id: primary } };
        if (secondary) relationships.secondaryCategory = { data: { type: 'appCategories', id: secondary } };
        await act(`set categories (${primary || '-'} / ${secondary || '-'})`, () =>
          api('PATCH', `/appInfos/${info.id}`, { data: { type: 'appInfos', id: info.id, relationships } }),
        );
      } catch (err) {
        failures.push('categories');
        log('err', `  ✖ categories: ${err.message}`);
      }
    }

    if (failures.length) throw new Error(`${failures.length} update(s) failed (see errors above)`);
  }

  async function run({ apps, dryRun }) {
    let succeeded = 0;
    let failed = 0;
    try {
      await api('GET', '/apps?limit=1'); // auth check
    } catch (err) {
      send('err', err.message);
      return { succeeded, failed: apps.length };
    }
    for (const app of apps) {
      try {
        await processApp(app, dryRun);
        succeeded++;
      } catch (err) {
        failed++;
        send('err', `  ✖ ${app.bundle_id}: ${err.message}`);
      }
    }
    return { succeeded, failed };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'sa:run') {
      run(msg).then(sendResponse);
      return true; // async response
    }
  });
})();
