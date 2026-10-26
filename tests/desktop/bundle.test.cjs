const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { APP_URL, resolveBundlePath, isAppUrl, isExternalUrl } = require('../../electron/bundle.cjs');

const root = path.resolve('dist');
test('resolves bundled assets and index with query strings', () => {
  assert.equal(resolveBundlePath(root, APP_URL), path.join(root, 'index.html'));
  assert.equal(resolveBundlePath(root, 'wordtrail://app/assets/worker.wasm?x=1'), path.join(root, 'assets', 'worker.wasm'));
});
test('rejects traversal, Windows path tricks, foreign authorities, and malformed paths', () => {
  for (const url of [
    'wordtrail://app/%2e%2e%2fsecret', 'wordtrail://app/%5c..%5csecret',
    'wordtrail://app/C:%5csecret', 'wordtrail://app/assets/file:stream', 'wordtrail://app/%00',
    'wordtrail://other/assets/test', 'https://app/assets/test', 'wordtrail://user@app/assets/test',
    'wordtrail://app:123/assets/test'
  ]) assert.equal(resolveBundlePath(root, url), null, url);
  assert.throws(() => resolveBundlePath(root, 'wordtrail://app/%zz'), URIError);
});
test('navigation stays on the trusted origin and external URLs use web protocols only', () => {
  assert.equal(isAppUrl('wordtrail://app/?setting=1#help'), true);
  assert.equal(isAppUrl('wordtrail://evil/'), false);
  assert.equal(isAppUrl('https://app/'), false);
  assert.equal(isAppUrl('http://127.0.0.1:5173/#help', 'http://127.0.0.1:5173/'), true);
  assert.equal(isAppUrl('http://127.0.0.1:9999/', 'http://127.0.0.1:5173/'), false);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ms-settings:privacy', 'https://user:pass@example.org/', 'invalid']) assert.equal(isExternalUrl(url), false);
  assert.equal(isExternalUrl('https://github.com/designerzen/info-recorder/releases'), true);
});
