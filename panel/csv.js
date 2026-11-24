// CSV parsing, validation and grouping. Pure functions, no browser APIs.

export function parseCsv(text, delimiter = ',') {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

// Excel in some locales saves CSV with ';' — detect from the header line.
function detectDelimiter(text) {
  const header = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] || '';
  return header.includes(',') ? ',' : header.includes(';') ? ';' : ',';
}


// Field limits per platform (in characters).
const LIMITS = {
  ios: { name: 30, subtitle: 30, keywords: 100, promotional_text: 170, description: 4000, whats_new: 4000, notes: 4000 },
  android: { name: 30, short_description: 80, description: 4000 },
};

const APP_LEVEL = [
  'sku', 'primary_locale', 'version', 'copyright', 'primary_category', 'secondary_category',
  // App Review information (iOS)
  'contact_first_name', 'contact_last_name', 'contact_email', 'contact_phone_number',
  'username', 'password', 'notes',
  // Google Play app creation
  'app_type', 'pricing', 'accept_declarations',
];

const PLATFORMS = {
  ios: 'ios', android: 'android', google: 'android', googleplay: 'android', google_play: 'android', play: 'android',
};
const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i;
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/;

export const isYes = (v) => /^(y|yes|true|1|x)$/i.test((v || '').trim());

export function parseApps(text) {
  const errors = [];
  const warnings = [];
  const table = parseCsv(text, detectDelimiter(text));
  if (table.length < 2) {
    return { apps: [], rowCount: 0, errors: ['The file has no data rows.'], warnings };
  }

  const header = table[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  if (!header.includes('bundle_id')) {
    return { apps: [], rowCount: 0, errors: ['Missing required column: bundle_id'], warnings };
  }

  const groups = new Map(); // "platform:bundle_id" -> rows
  let rowCount = 0;

  table.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    const raw = {};
    header.forEach((h, i) => { raw[h] = (cells[i] ?? '').trim(); });

    const platform = PLATFORMS[(raw.platform || 'ios').toLowerCase().replace(/\s+/g, '_')];
    if (!platform) {
      errors.push(`Row ${line}: unknown platform "${raw.platform}" (use "ios" or "android").`);
      return;
    }
    if (!raw.bundle_id) {
      errors.push(`Row ${line}: bundle_id is required (for Android this is the package name).`);
      return;
    }

    const row = { ...raw, line, platform, locale: raw.locale || raw.primary_locale || 'en-US' };
    for (const [field, max] of Object.entries(LIMITS[platform])) {
      const len = [...(row[field] || '')].length;
      if (len > max) errors.push(`Row ${line}: ${field} is ${len} characters (max ${max}).`);
    }
    if (platform === 'android') {
      if (!PACKAGE_RE.test(row.bundle_id)) {
        errors.push(`Row ${line}: "${row.bundle_id}" is not a valid Android package name (for example com.example.app).`);
      }
      if (!LOCALE_RE.test(row.locale)) {
        errors.push(`Row ${line}: locale "${row.locale}" should look like en-US or de-DE.`);
      }
      if (/[\r\n]/.test(row.short_description || '')) {
        errors.push(`Row ${line}: short_description must be a single line.`);
      }
    }

    rowCount++;
    const key = `${platform}:${row.bundle_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const apps = [];
  for (const rows of groups.values()) {
    const { bundle_id, platform } = rows[0];
    const app = { bundle_id, platform, rows };
    for (const f of APP_LEVEL) app[f] = rows.map((r) => r[f]).find(Boolean) || '';
    app.primary_locale ||= 'en-US';
    const tag = platform === 'android' ? `${bundle_id} (Android)` : bundle_id;

    if (platform === 'ios') {
      if (app.contact_email && !/^\S+@\S+\.\S+$/.test(app.contact_email)) {
        errors.push(`${tag}: contact_email "${app.contact_email}" is not a valid email.`);
      }
      if (app.contact_phone_number && !/^\+/.test(app.contact_phone_number)) {
        warnings.push(`${tag}: contact_phone_number should include the country code, e.g. +1 555 123 4567.`);
      }
      if (app.username && !app.password) warnings.push(`${tag}: username is set but password is empty.`);
      if (app.password && !app.username) warnings.push(`${tag}: password is set but username is empty.`);
    } else {
      app.app_type = (app.app_type || 'app').toLowerCase();
      app.pricing = (app.pricing || 'free').toLowerCase();
      if (!['app', 'game'].includes(app.app_type)) errors.push(`${tag}: app_type must be "app" or "game".`);
      if (!['free', 'paid'].includes(app.pricing)) errors.push(`${tag}: pricing must be "free" or "paid".`);
      if (!isYes(app.accept_declarations)) {
        warnings.push(
          `${tag}: accept_declarations is not "yes", so this app can be updated but not created. Setting it to yes confirms the Developer Program Policies and US export laws declarations.`,
        );
      }
    }

    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.locale)) errors.push(`Row ${r.line}: duplicate locale "${r.locale}" for ${tag}.`);
      seen.add(r.locale);
    }
    apps.push(app);
  }
  return { apps, rowCount, errors, warnings };
}
