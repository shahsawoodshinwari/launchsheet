// Runs from the npm "version" lifecycle (after `npm version` bumps package.json, before it commits).
// Copies the new version into manifest.json so the extension and package never drift apart.
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const path = new URL('../manifest.json', import.meta.url);
const text = fs.readFileSync(path, 'utf8');

// Replace only the top-level "version" value, keeping the file's formatting.
const next = text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${pkg.version}$2`);
if (next === text && !text.includes(`"version": "${pkg.version}"`)) {
  console.error('Could not find "version" in manifest.json');
  process.exit(1);
}
fs.writeFileSync(path, next);
console.log(`manifest.json version -> ${pkg.version}`);
