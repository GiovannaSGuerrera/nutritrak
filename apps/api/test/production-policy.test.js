const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
test('production rejects unsafe startup and enforces origin, verification, cookies and generic signup', async (t) => {
  const source = path.join(__dirname, '../src/server.js');
  const unsafe = spawnSync(process.execPath, [source], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      STORE_BACKEND: 'json',
      CORS_ORIGINS: '',
      PUBLIC_ORIGIN: '',
    },
    stdio: 'ignore',
  });
  assert.equal(unsafe.status, 1);
  const directory = await fs.mkdtemp(path.join(__dirname, '.runtime-production-'));
  const socket = net.createServer();
  await new Promise((r) => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  await fs.writeFile(path.join(directory, 'privacy.md'), 'Synthetic policy');
  await fs.writeFile(path.join(directory, 'terms.md'), 'Synthetic terms');
  const origin = 'https://synthetic.example.invalid',
    base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [source], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PRIVACY_POLICY_FILE: path.join(directory, 'privacy.md'),
      TERMS_FILE: path.join(directory, 'terms.md'),
      STORE_BACKEND: 'sqlite',
      MAIL_ENCRYPTION_KEY: '5'.repeat(64),
      DATA_DIR: directory,
      PORT: String(port),
      HOST: '127.0.0.1',
      PUBLIC_ORIGIN: origin,
      CORS_ORIGINS: origin,
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const done = new Promise((r) => child.once('exit', r));
      child.kill();
      await done;
    }
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
  const payload = {
    name: 'Synthetic',
    email: 'synthetic@example.invalid',
    password: 'synthetic-production-password',
    profileType: 'nutritionist',
  };
  const post = (route, headers = {}) =>
    fetch(base + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
  assert.equal((await post('/api/register')).status, 403);
  assert.equal((await post('/api/register', { origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal((await post('/api/register', { origin, 'content-type': 'text/plain' })).status, 415);
  const signup = await post('/api/register', { origin });
  assert.equal(signup.status, 202);
  assert.equal(signup.headers.get('set-cookie'), null);
  const result = await signup.json();
  const duplicate = await post('/api/register', { origin });
  assert.equal(duplicate.status, 202);
  assert.deepEqual(await duplicate.json(), result);
  const login = await post('/api/login', { origin });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.equal(
    (await fetch(base + '/api/patients', { headers: { cookie: cookie.split(';')[0] } })).status,
    403,
  );
  assert.equal(login.headers.get('cache-control'), 'no-store');
  assert.equal(login.headers.get('x-content-type-options'), 'nosniff');
  assert.match(login.headers.get('strict-transport-security'), /max-age/);
});
