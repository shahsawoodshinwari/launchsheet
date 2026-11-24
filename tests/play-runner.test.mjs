import test from 'node:test';
import assert from 'node:assert/strict';

// play-runner.js touches chrome.* only inside functions, so its pure helpers can be imported in Node.
const { playBase } = await import('../panel/play-runner.js');

test('playBase extracts the developer account base URL', () => {
  assert.equal(
    playBase('https://play.google.com/console/u/0/developers/6071838798197446786/app/123/app-dashboard'),
    'https://play.google.com/console/u/0/developers/6071838798197446786',
  );
  assert.equal(
    playBase('https://play.google.com/console/u/2/developers/42/home?x=1'),
    'https://play.google.com/console/u/2/developers/42',
  );
});

test('playBase returns null away from a developer account', () => {
  assert.equal(playBase('https://play.google.com/console/developers'), null); // account chooser
  assert.equal(playBase('https://example.com/console/u/0/developers/1'), null);
  assert.equal(playBase(undefined), null);
});
