const { test } = require('node:test');
const assert = require('node:assert/strict');
const { codeAt, matchingCounter } = require('../dist/totp');
test('TOTP RFC6238 SHA1 vector and counter replay protection', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(codeAt(secret, 1), '287082');
  assert.equal(matchingCounter(secret, '287082', 59000, -1), 1);
  assert.equal(matchingCounter(secret, '287082', 59000, 1), null);
  assert.equal(matchingCounter(secret, 'not-a-code', 59000, -1), null);
  assert.equal(matchingCounter(secret, '287082', 180000, -1), null);
});
