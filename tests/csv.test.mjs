import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCsv, parseApps } from '../panel/csv.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('parseCsv handles quotes, escaped quotes, multi-line cells and CRLF', () => {
  const rows = parseCsv('a,b\r\n"x, y","He said ""hi""\nsecond line"\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'He said "hi"\nsecond line']]);
});

test('sample CSV parses cleanly into one app with two locales', () => {
  const r = parseApps(read('../sample/apps.csv'));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.apps.length, 1);
  const app = r.apps[0];
  assert.equal(app.bundle_id, 'com.example.todo');
  assert.deepEqual(app.rows.map((x) => x.locale), ['en-US', 'de-DE']);
  assert.equal(app.sku, 'TODO-001');
  assert.equal(app.primary_category, 'PRODUCTIVITY');
  assert.equal(app.contact_email, 'jane@example.com');
});

test('reports length, missing bundle id and duplicate locale errors', () => {
  const r = parseApps(
    'platform,bundle_id,locale,name\n' +
      `ios,a.b,en-US,${'x'.repeat(31)}\n` +
      'ios,,en-US,z\n' +
      'ios,a.b,en-US,dup\n',
  );
  assert.ok(r.errors.some((e) => /name is 31 characters/.test(e)));
  assert.ok(r.errors.some((e) => /bundle_id is required/.test(e)));
  assert.ok(r.errors.some((e) => /duplicate locale/.test(e)));
});

test('skips Android rows with a warning and rejects unknown platforms', () => {
  const r = parseApps('platform,bundle_id,locale\nandroid,a.b,en-US\nwindows,a.c,en-US\n');
  assert.equal(r.apps.length, 0);
  assert.ok(r.warnings.some((w) => /Google Play/.test(w)));
  assert.ok(r.errors.some((e) => /unknown platform/.test(e)));
});

test('detects semicolon-delimited files saved by Excel', () => {
  const r = parseApps('bundle_id;locale;name\na.b;en-US;Hello\n');
  assert.equal(r.apps[0].rows[0].name, 'Hello');
});

test('validates App Review contact fields', () => {
  const r = parseApps(
    'bundle_id,locale,contact_email,contact_phone_number,username\n' + 'a.b,en-US,not-an-email,5551234,someone\n',
  );
  assert.ok(r.errors.some((e) => /contact_email/.test(e)));
  assert.ok(r.warnings.some((w) => /country code/.test(w)));
  assert.ok(r.warnings.some((w) => /username is set but password is empty/.test(w)));
});

test('manifest and package.json versions match', () => {
  const manifest = JSON.parse(read('../manifest.json'));
  const pkg = JSON.parse(read('../package.json'));
  assert.equal(manifest.version, pkg.version);
});
