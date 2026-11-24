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

const LIMITS = {
  name: 30,
  subtitle: 30,
  keywords: 100,
  promotional_text: 170,
  description: 4000,
  whats_new: 4000,
  notes: 4000,
};

const APP_LEVEL = [
  'sku', 'primary_locale', 'version', 'copyright', 'primary_category', 'secondary_category',
  // App Review information
  'contact_first_name', 'contact_last_name', 'contact_email', 'contact_phone_number',
  'username', 'password', 'notes',
];

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

  const byBundle = new Map();
  let rowCount = 0;

  table.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    const raw = {};
    header.forEach((h, i) => { raw[h] = (cells[i] ?? '').trim(); });
    // Keep multi-line fields intact but drop surrounding whitespace.
    const platform = (raw.platform || 'ios').toLowerCase();

    if (platform === 'android' || platform === 'google' || platform === 'googleplay') {
      warnings.push(`Row ${line}: Google Play rows are skipped (coming soon).`);
      return;
    }
    if (platform !== 'ios') {
      errors.push(`Row ${line}: unknown platform "${raw.platform}" (use "ios").`);
      return;
    }
    if (!raw.bundle_id) {
      errors.push(`Row ${line}: bundle_id is required.`);
      return;
    }

    const row = { ...raw, line, platform: 'ios', locale: raw.locale || raw.primary_locale || 'en-US' };
    for (const [field, max] of Object.entries(LIMITS)) {
      const len = [...(row[field] || '')].length;
      if (len > max) errors.push(`Row ${line}: ${field} is ${len} characters (max ${max}).`);
    }

    rowCount++;
    if (!byBundle.has(row.bundle_id)) byBundle.set(row.bundle_id, []);
    byBundle.get(row.bundle_id).push(row);
  });

  const apps = [];
  for (const [bundle_id, rows] of byBundle) {
    const app = { bundle_id, platform: 'ios', rows };
    for (const f of APP_LEVEL) app[f] = rows.map((r) => r[f]).find(Boolean) || '';
    app.primary_locale ||= 'en-US';

    if (app.contact_email && !/^\S+@\S+\.\S+$/.test(app.contact_email)) {
      errors.push(`${bundle_id}: contact_email "${app.contact_email}" is not a valid email.`);
    }
    if (app.contact_phone_number && !/^\+/.test(app.contact_phone_number)) {
      warnings.push(`${bundle_id}: contact_phone_number should include the country code, e.g. +1 555 123 4567.`);
    }
    if (app.username && !app.password) warnings.push(`${bundle_id}: username is set but password is empty.`);
    if (app.password && !app.username) warnings.push(`${bundle_id}: password is set but username is empty.`);

    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.locale)) errors.push(`Row ${r.line}: duplicate locale "${r.locale}" for ${bundle_id}.`);
      seen.add(r.locale);
    }
    apps.push(app);
  }
  return { apps, rowCount, errors, warnings };
}
