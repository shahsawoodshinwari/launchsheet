import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseApps } from '../panel/csv.js';
import { previewModel } from '../panel/preview.js';

const sample = () => parseApps(fs.readFileSync(new URL('../sample/apps.csv', import.meta.url), 'utf8')).apps[0];

test('preview model shows app-level and per-locale details', () => {
  const m = previewModel(sample());
  const app = Object.fromEntries(m.appFields.map((f) => [f.label, f.value]));
  assert.equal(m.title, 'Example Todo');
  assert.equal(m.bundleId, 'com.example.todo');
  assert.equal(app.SKU, 'TODO-001');
  assert.equal(app.Version, '1.0');
  assert.equal(app.Categories, 'PRODUCTIVITY / UTILITIES');
  assert.equal(app['Review contact'], 'Jane Doe · jane@example.com · +1 555 123 4567');
  assert.deepEqual(m.locales.map((l) => l.locale), ['en-US', 'de-DE']);

  const en = m.locales[0];
  assert.equal(en.total, 9);
  assert.equal(en.set, 8); // everything except What's New
  assert.equal(en.fields.find((f) => f.label === 'Name').limit, 30);
});

test('preview model never exposes the demo password', () => {
  const m = previewModel(sample());
  const demo = m.appFields.find((f) => f.label === 'Demo account').value;
  assert.match(demo, /^reviewer@example\.com · •+$/);
  assert.ok(!JSON.stringify(m).includes('example-password'));
});

test('Android preview shows package, language, type, pricing, declarations and the three listing fields', () => {
  const app = parseApps(fs.readFileSync(new URL('../sample/apps.csv', import.meta.url), 'utf8')).apps[1];
  const m = previewModel(app);
  const f = Object.fromEntries(m.appFields.map((x) => [x.label, x.value]));
  assert.equal(m.platform, 'android');
  assert.equal(f['Package name'], 'com.example.todo');
  assert.equal(f['App or game'], 'App');
  assert.equal(f['Free or paid'], 'Free');
  assert.match(f.Declarations, /^Accepted/);
  const en = m.locales[0];
  assert.deepEqual(en.fields.map((x) => x.label), ['Name', 'Short description', 'Full description']);
  assert.equal(en.fields[1].limit, 80);
  assert.equal(en.set, 3);
});

test('unset fields are empty strings so the UI can say "left unchanged"', () => {
  const de = previewModel(sample()).locales[1];
  assert.equal(de.fields.find((f) => f.label === 'Promotional text').value, '');
  assert.ok(de.set < de.total);
});
