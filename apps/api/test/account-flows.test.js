const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { decrypt } = require('../src/mail');
test('professional email ownership, password recovery and global session revocation', async (t) => {
  const directory = await fs.mkdtemp(path.join(__dirname, '.runtime-accounts-'));
  const socket = net.createServer();
  await new Promise((r) => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const base = `http://127.0.0.1:${port}`,
    key = '4'.repeat(64),
    oldKey = process.env.MAIL_ENCRYPTION_KEY;
  process.env.MAIL_ENCRYPTION_KEY = key;
  const child = spawn(process.execPath, [path.join(__dirname, '../src/server.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      STORE_BACKEND: 'sqlite',
      DATA_DIR: directory,
      PORT: String(port),
      HOST: '127.0.0.1',
      PUBLIC_ORIGIN: base,
      CORS_ORIGINS: base,
      MAIL_ENCRYPTION_KEY: key,
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const done = new Promise((r) => child.once('exit', r));
      child.kill();
      await done;
    }
    if (oldKey === undefined) delete process.env.MAIL_ENCRYPTION_KEY;
    else process.env.MAIL_ENCRYPTION_KEY = oldKey;
    await fs.rm(directory, { recursive: true, force: true });
  });
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(base + '/ready')).ok) break;
    } catch {
      /* Startup polling. */
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  async function call(route, body, cookie, method = 'POST') {
    const response = await fetch(base + route, {
      method,
      headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  }
  function tokenFor(purpose) {
    const db = new DatabaseSync(path.join(directory, 'nutritrack.sqlite'), { readOnly: true });
    try {
      for (const row of db
        .prepare("SELECT data FROM records WHERE collection='mailOutbox'")
        .all()) {
        const item = JSON.parse(row.data),
          message = decrypt(item.encrypted),
          match = message.text.match(new RegExp('#' + purpose + '=([a-f0-9]{64})'));
        if (match) return match[1];
      }
    } finally {
      db.close();
    }
    throw new Error('Synthetic delivery missing');
  }
  const credentials = {
    name: 'Synthetic',
    email: 'synthetic@example.invalid',
    password: 'synthetic-original-password',
    profileType: 'nutritionist',
  };
  const registration = await call('/api/register', credentials);
  assert.equal(registration.status, 201);
  const token = tokenFor('verify-email');
  assert.equal(
    (await call('/api/auth/verification/complete', { token })).status,
    400,
    'email confirmation must choose the credential, preventing pre-account hijacking',
  );
  assert.equal(
    (
      await call('/api/auth/verification/complete', {
        token,
        password: 'synthetic-verified-password',
      })
    ).status,
    200,
  );
  assert.equal((await call('/api/me', undefined, registration.cookie, 'GET')).status, 401);
  assert.equal(
    (await call('/api/login', { email: credentials.email, password: credentials.password })).status,
    401,
  );
  const login = await call('/api/login', {
    email: credentials.email,
    password: 'synthetic-verified-password',
  });
  assert.equal(login.status, 200);
  const unknown = await call('/api/auth/password-reset/request', {
    email: 'absent@example.invalid',
  });
  const known = await call('/api/auth/password-reset/request', { email: credentials.email });
  assert.equal(known.status, 202);
  assert.deepEqual(unknown.body, known.body);
  const reset = tokenFor('reset-password');
  const completed = await Promise.all(
    [1, 2].map((n) =>
      call('/api/auth/password-reset/complete', {
        token: reset,
        password: 'synthetic-final-password-' + n,
      }),
    ),
  );
  assert.deepEqual(completed.map((r) => r.status).sort(), [200, 410]);
  assert.equal((await call('/api/me', undefined, login.cookie, 'GET')).status, 401);
});
