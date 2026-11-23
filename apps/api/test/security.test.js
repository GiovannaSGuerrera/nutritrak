const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validateMutation, consumeLocalAttempt, authBucket } = require('../dist/security');
const { encryptBackup, decryptBackup } = require('../dist/backup');

test('bloqueia origem externa, formulário simples e limites sem confiar em x-forwarded-for', () => {
  const req = {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
  assert.doesNotThrow(() => validateMutation(req));
  assert.throws(
    () =>
      validateMutation({ ...req, headers: { ...req.headers, origin: 'https://attacker.test' } }),
    { status: 403 },
  );
  assert.throws(
    () => validateMutation({ ...req, headers: { ...req.headers, 'content-type': 'text/plain' } }),
    { status: 415 },
  );
  assert.throws(
    () => validateMutation({ ...req, headers: { ...req.headers, 'sec-fetch-site': 'cross-site' } }),
    { status: 403 },
  );
  const key = authBucket(req);
  assert.equal(
    authBucket({ ...req, headers: { ...req.headers, 'x-forwarded-for': 'spoofed' } }),
    key,
  );
  for (let i = 0; i < 20; i++) assert.equal(consumeLocalAttempt(key, 1000), true);
  assert.equal(consumeLocalAttempt(key, 1000), false);
  assert.equal(consumeLocalAttempt(key, 901000), true);
});

test('backup criptografado exige chave correta e rejeita adulteração', () => {
  const key = crypto.randomBytes(32);
  const input = { patient: 'dados fictícios' };
  const encrypted = encryptBackup(input, key);
  assert.equal(encrypted.includes(Buffer.from(input.patient)), false);
  assert.deepEqual(decryptBackup(encrypted, key), input);
  assert.throws(() => decryptBackup(encrypted, crypto.randomBytes(32)));
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => decryptBackup(encrypted, key));
});
