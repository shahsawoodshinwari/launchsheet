import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCsv, parseApps } from '../panel/csv.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('parseCsv handles quotes, escaped quotes, multi-line cells and CRLF', () => {
  const rows = parseCsv('a,b\r\n"x, y","He said ""hi""\nsecond line"\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'He said "hi"\nsecond line']]);
});

test('sample CSV parses cleanly into an iOS app and an Android app, two locales each', () => {
  const r = parseApps(read('../sample/apps.csv'));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.apps.length, 2);
  assert.deepEqual(r.apps.map((a) => a.platform), ['ios', 'android']);
  assert.equal(r.apps[1].rows.length, 2);
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

test('rejects unknown platforms and accepts Android aliases', () => {
  const r = parseApps('platform,bundle_id,locale\nwindows,a.c,en-US\nGoogle Play,com.x.y,en-US\n');
  assert.ok(r.errors.some((e) => /unknown platform/.test(e)));
  assert.equal(r.apps.length, 1);
  assert.equal(r.apps[0].platform, 'android');
});

test('the same ID on iOS and Android makes two separate apps', () => {
  const r = parseApps('platform,bundle_id,locale,name\nios,com.x.y,en-US,A\nandroid,com.x.y,en-US,B\n');
  assert.equal(r.apps.length, 2);
  assert.deepEqual(r.apps.map((a) => a.rows[0].name), ['A', 'B']);
});

test('Android: validates package name, locale, limits and single-line short description', () => {
  const r = parseApps(
    'platform,bundle_id,locale,name,short_description,description\n' +
      `android,notapackage,en-US,ok,ok,ok\n` +
      `android,com.x.y,english,ok,ok,ok\n` +
      `android,com.x.z,en-US,${'n'.repeat(31)},${'s'.repeat(81)},ok\n` +
      'android,com.x.w,en-US,ok,"two\nlines",ok\n',
  );
  assert.ok(r.errors.some((e) => /not a valid Android package name/.test(e)));
  assert.ok(r.errors.some((e) => /locale "english"/.test(e)));
  assert.ok(r.errors.some((e) => /name is 31 characters/.test(e)));
  assert.ok(r.errors.some((e) => /short_description is 81 characters \(max 80\)/.test(e)));
  assert.ok(r.errors.some((e) => /short_description must be a single line/.test(e)));
});

test('Android: defaults, app_type/pricing checks and the declarations warning', () => {
  const ok = parseApps('platform,bundle_id,locale,name\nandroid,com.x.y,en-US,A\n');
  assert.equal(ok.apps[0].app_type, 'app');
  assert.equal(ok.apps[0].pricing, 'free');
  assert.ok(ok.warnings.some((w) => /accept_declarations/.test(w)));

  const accepted = parseApps('platform,bundle_id,locale,name,accept_declarations\nandroid,com.x.y,en-US,A,Yes\n');
  assert.deepEqual(accepted.warnings, []);

  const bad = parseApps('platform,bundle_id,locale,name,app_type,pricing\nandroid,com.x.y,en-US,A,tool,gratis\n');
  assert.ok(bad.errors.some((e) => /app_type/.test(e)));
  assert.ok(bad.errors.some((e) => /pricing/.test(e)));
});

test('iOS-only checks do not apply to Android rows', () => {
  const r = parseApps('platform,bundle_id,locale,name,contact_email\nandroid,com.x.y,en-US,A,not-an-email\n');
  assert.ok(!r.errors.some((e) => /contact_email/.test(e)));
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
