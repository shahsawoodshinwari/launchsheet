// Preview of what a CSV will do. previewModel() is pure (and tested); renderPreview() builds the DOM.

// [csv column, label, character limit, long text?]
const IOS_FIELDS = [
  ['name', 'Name', 30, false],
  ['subtitle', 'Subtitle', 30, false],
  ['keywords', 'Keywords', 100, false],
  ['promotional_text', 'Promotional text', 170, true],
  ['description', 'Description', 4000, true],
  ['whats_new', "What's New", 4000, true],
  ['support_url', 'Support URL', 0, false],
  ['marketing_url', 'Marketing URL', 0, false],
  ['privacy_policy_url', 'Privacy policy URL', 0, false],
];

const ANDROID_FIELDS = [
  ['name', 'Name', 30, false],
  ['short_description', 'Short description', 80, false],
  ['description', 'Full description', 4000, true],
];

const MASK = '••••••••'; // never show the real password, or its length

export function previewModel(app) {
  const first = app.rows.find((r) => r.locale === app.primary_locale) || app.rows[0];
  const android = app.platform === 'android';

  let appFields;
  if (android) {
    appFields = [
      { label: 'Package name', value: app.bundle_id },
      { label: 'Default language', value: app.primary_locale },
      { label: 'App or game', value: app.app_type === 'game' ? 'Game' : 'App' },
      { label: 'Free or paid', value: app.pricing === 'paid' ? 'Paid' : 'Free' },
      { label: 'Declarations', value: /^(y|yes|true|1|x)$/i.test(app.accept_declarations || '') ? 'Accepted (policies, US export laws)' : '' },
    ];
  } else {
    const contact = [[app.contact_first_name, app.contact_last_name].filter(Boolean).join(' '), app.contact_email, app.contact_phone_number]
      .filter(Boolean)
      .join(' · ');
    const demo = app.username ? `${app.username} · ${MASK}` : app.password ? MASK : '';
    appFields = [
      { label: 'SKU', value: app.sku },
      { label: 'Version', value: app.version },
      { label: 'Primary language', value: app.primary_locale },
      { label: 'Copyright', value: app.copyright },
      { label: 'Categories', value: [app.primary_category, app.secondary_category].filter(Boolean).join(' / ') },
      { label: 'Review contact', value: contact },
      { label: 'Demo account', value: demo },
      { label: 'Review notes', value: app.notes, limit: 4000, long: true },
    ];
  }

  const localeFields = android ? ANDROID_FIELDS : IOS_FIELDS;
  return {
    platform: android ? 'android' : 'ios',
    title: first?.name || app.bundle_id,
    bundleId: app.bundle_id,
    appFields,
    locales: app.rows.map((r) => {
      const fields = localeFields.map(([key, label, limit, long]) => ({ label, value: r[key] || '', limit, long }));
      return { locale: r.locale, fields, set: fields.filter((f) => f.value).length, total: fields.length };
    }),
  };
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function valueNode(f) {
  if (!f.value) return el('span', { className: 'muted', textContent: 'Not set (left unchanged)' });
  const flat = f.value.replace(/\s*\n\s*/g, ' ↵ ');
  const text = f.long && flat.length > 140 ? flat.slice(0, 140).trimEnd() + '…' : flat;
  const nodes = [el('span', { textContent: text, title: f.long ? f.value : '' })];
  if (f.limit) {
    const n = [...f.value].length;
    nodes.push(el('span', { className: 'count' + (n > f.limit ? ' bad' : ''), textContent: ` ${n}/${f.limit}` }));
  }
  return el('span', {}, ...nodes);
}

function list(fields) {
  const dl = el('dl', { className: 'kv' });
  for (const f of fields) dl.append(el('dt', { textContent: f.label }), el('dd', {}, valueNode(f)));
  return dl;
}

function appNode(m, open) {
  const n = m.locales.length;
  const details = el(
    'details',
    { className: 'app', open },
    el(
      'summary',
      {},
      el('span', { className: 'title', textContent: m.title }),
      el('span', { className: 'mono muted', textContent: m.bundleId }),
      el('span', { className: 'muted', textContent: `${n} locale${n === 1 ? '' : 's'}` }),
    ),
    list(m.appFields),
  );
  for (const loc of m.locales) {
    details.append(
      el(
        'details',
        { className: 'loc' },
        el('summary', {}, el('span', { className: 'mono', textContent: loc.locale }), el('span', { className: 'muted', textContent: `${loc.set} of ${loc.total} fields set` })),
        list(loc.fields),
      ),
    );
  }
  return details;
}

export function renderPreview(container, apps) {
  container.replaceChildren(...apps.map((app, i) => appNode(previewModel(app), i === 0)));
}
