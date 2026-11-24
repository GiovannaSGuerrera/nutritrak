const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { Persistence } = require('../src/persistence');

async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const number = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return number;
}
test('SQLite: uniqueness, deferred references, rollback and online backup', async (t) => {
  const directory = await fs.mkdtemp(path.join(__dirname, '.runtime-db-'));
  const db = new Persistence(directory);
  t.after(async () => {
    db.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const state = {
    users: [{ id: 'user', email: 'one@example.invalid' }],
    workspaces: [{ id: 'workspace' }],
    patients: [{ id: 'patient', workspaceId: 'workspace' }],
  };
  db.begin();
  db.commit({}, state, new Map(), new Map());
  db.begin();
  assert.throws(() =>
    db.commit(
      state,
      { ...state, users: [...state.users, { id: 'duplicate', email: 'one@example.invalid' }] },
      new Map(),
      new Map(),
    ),
  );
  db.rollback();
  assert.equal(
    db.db.prepare("SELECT count(*) AS n FROM records WHERE collection='users'").get().n,
    1,
  );
  db.begin();
  assert.throws(() =>
    db.commit(
      state,
      { ...state, patients: [{ id: 'patient', workspaceId: 'missing' }] },
      new Map(),
      new Map(),
    ),
  );
  db.rollback();
  for (let n = 0; n < 10; n++) assert.equal(db.limit('synthetic-bucket', 10, 900000), 0);
  assert.ok(db.limit('synthetic-bucket', 10, 900000) > 0);
  const second = new Persistence(directory);
  try {
    assert.ok(second.limit('synthetic-bucket', 10, 900000) > 0);
  } finally {
    second.close();
  }
  db.begin();
  assert.throws(
    () =>
      db.commit(
        state,
        { ...state, patients: [{ ...state.patients[0], name: 'x'.repeat(1048577) }] },
        new Map(),
        new Map(),
      ),
    (error) => error.status === 413,
  );
  db.rollback();
  const destination = path.join(directory, 'restore.sqlite');
  await db.backup(destination);
  const { DatabaseSync } = require('node:sqlite');
  const restored = new DatabaseSync(destination);
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(restored.prepare('SELECT count(*) AS n FROM records').get().n, 3);
  restored.close();
});

test('HTTP security: concurrency, tenant isolation, atomic rejection and durable revocation', async (t) => {
  const directory = await fs.mkdtemp(path.join(__dirname, '.runtime-security-'));
  const number = await port();
  const base = `http://127.0.0.1:${number}`;
  let child;
  async function start() {
    child = spawn(process.execPath, [path.join(__dirname, '../src/server.js')], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        STORE_BACKEND: 'sqlite',
        MAIL_ENCRYPTION_KEY: '1'.repeat(64),
        DATA_DIR: directory,
        PORT: String(number),
        HOST: '127.0.0.1',
        CORS_ORIGINS: base,
        PUBLIC_ORIGIN: base,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let errors = '';
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + '/ready')).status === 200) return;
      } catch {
        /* Startup polling: server may not listen yet. */
      }
      if (child.exitCode !== null) throw new Error('Startup failed: ' + errors);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error('Startup timeout: ' + errors);
  }
  async function stop() {
    if (child?.exitCode === null) {
      const stopped = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await stopped;
    }
  }
  t.after(async () => {
    await stop();
    await fs.rm(directory, { recursive: true, force: true });
  });
  await start();
  async function call(route, method = 'GET', body, cookie, workspace, origin = base) {
    const response = await fetch(base + route, {
      method,
      headers: {
        'content-type': 'application/json',
        origin,
        ...(cookie ? { cookie } : {}),
        ...(workspace ? { 'x-workspace-id': workspace } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  }
  const credentials = {
    name: 'Synthetic',
    email: 'one@example.invalid',
    password: 'synthetic-passphrase-123',
    profileType: 'nutritionist',
  };
  const duplicates = await Promise.all([
    call('/api/register', 'POST', credentials),
    call('/api/register', 'POST', credentials),
  ]);
  assert.deepEqual(duplicates.map((r) => r.status).sort(), [201, 409]);
  const account = duplicates.find((r) => r.status === 201),
    cookie = account.cookie,
    workspace = account.body.workspace.id;
  const other = await call('/api/register', 'POST', {
    ...credentials,
    email: 'two@example.invalid',
  });
  const created = await call(
    '/api/patients',
    'POST',
    {
      name: 'Synthetic Patient',
      email: 'patient@example.invalid',
      primaryProfessionalId: account.body.user.id,
      clinicalNotes: 'SYNTHETIC_CONFIDENTIAL',
    },
    cookie,
    workspace,
  );
  assert.equal(created.status, 201);
  const id = created.body.patient.id;
  await t.test('direct API requests cannot read/update another tenant', async () => {
    assert.equal(
      (await call('/api/patients/' + id, 'GET', undefined, other.cookie, other.body.workspace.id))
        .status,
      404,
    );
    assert.equal(
      (
        await call(
          '/api/patients/' + id,
          'PATCH',
          { name: 'Wrong tenant' },
          other.cookie,
          other.body.workspace.id,
        )
      ).status,
      404,
    );
    assert.equal(
      (await call('/api/patients/' + id, 'GET', undefined, other.cookie, workspace)).status,
      403,
    );
    assert.equal((await call('/api/patients', 'GET')).status, 401);
  });
  await t.test('invalid update is atomic and origin is checked', async () => {
    assert.equal(
      (await call('/api/patients/' + id, 'PATCH', { name: '' }, cookie, workspace)).status,
      400,
    );
    assert.equal(
      (await call('/api/patients/' + id, 'GET', undefined, cookie, workspace)).body.patient.name,
      'Synthetic Patient',
    );
    assert.equal(
      (
        await call(
          '/api/patients',
          'POST',
          { name: 'Rejected' },
          cookie,
          workspace,
          'https://untrusted.invalid',
        )
      ).status,
      403,
    );
    assert.equal((await call('/api/patients', 'POST', [], cookie, workspace)).status, 400);
    assert.equal(
      (await call('/api/patients', 'POST', { name: 'x'.repeat(1000010) }, cookie, workspace))
        .status,
      413,
    );
  });
  await t.test(
    'single-use reset under concurrent HTTP and revoked cookie after restart',
    async () => {
      const invite = await call(`/api/patients/${id}/invitations`, 'POST', {}, cookie, workspace);
      const activation = await call('/api/patient/activate', 'POST', {
        token: invite.body.token,
        email: 'patient@example.invalid',
        password: 'synthetic-patient-password',
      });
      assert.equal(activation.status, 201);
      const reset = await call(
        `/api/patients/${id}/password-resets`,
        'POST',
        {},
        cookie,
        workspace,
      );
      const completed = await Promise.all(
        [1, 2].map((n) =>
          call('/api/patient/password-resets/complete', 'POST', {
            token: reset.body.token,
            password: 'synthetic-new-password-' + n,
          }),
        ),
      );
      assert.deepEqual(completed.map((r) => r.status).sort(), [200, 410]);
      await stop();
      await start();
      assert.equal((await call('/api/me', 'GET', undefined, cookie)).status, 200);
      assert.equal(
        (await call('/api/patient/me', 'GET', undefined, activation.cookie)).status,
        401,
      );
    },
  );
  await t.test('revision preconditions prevent lost updates and stale publication', async () => {
    const content = {
      patientId: id,
      name: 'Synthetic plan',
      meals: [{ name: 'Lunch', items: [{ food: 'Rice', quantity: 1, unit: 'portion' }] }],
    };
    const created = await call('/api/meal-plans', 'POST', content, cookie, workspace);
    assert.equal(created.status, 201);
    const route = '/api/meal-plans/' + created.body.mealPlan.id;
    assert.equal((await call(route + '/draft', 'PUT', content, cookie, workspace)).status, 428);
    const concurrent = await Promise.all(
      [1, 2].map((n) =>
        call(
          route + '/draft',
          'PUT',
          { ...content, name: 'Synthetic edit ' + n, expectedRevision: 0 },
          cookie,
          workspace,
        ),
      ),
    );
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (await call(route + '/publish', 'POST', { expectedRevision: 0 }, cookie, workspace)).status,
      409,
    );
    assert.equal(
      (await call(route + '/publish', 'POST', { expectedRevision: 1 }, cookie, workspace)).status,
      200,
    );
  });
  await t.test('clinical exports are isolated and contain no credential material', async () => {
    const own = await call('/api/patients/' + id + '/export', 'GET', undefined, cookie, workspace);
    assert.equal(own.status, 200);
    assert.equal(own.body.patient.clinicalNotes, 'SYNTHETIC_CONFIDENTIAL');
    assert.equal(JSON.stringify(own.body).includes('tokenHash'), false);
    assert.equal(
      (
        await call(
          '/api/patients/' + id + '/export',
          'GET',
          undefined,
          other.cookie,
          other.body.workspace.id,
        )
      ).status,
      404,
    );
    assert.equal(
      (await call('/api/patients/' + id, 'DELETE', {}, other.cookie, other.body.workspace.id))
        .status,
      404,
    );
  });
  const headersAfterMfa = { cookie };
  await t.test('personal export, reauthentication and MFA recovery codes', async () => {
    assert.equal(
      (await call('/api/account/export', 'GET', undefined, cookie)).body.user.email,
      credentials.email,
    );
    const requested = await call(
      '/api/account/deletion-request',
      'POST',
      { currentPassword: credentials.password },
      cookie,
    );
    assert.equal(requested.status, 202);
    assert.equal(
      (
        await call(
          '/api/account/password',
          'POST',
          { currentPassword: 'wrong', password: 'synthetic-replacement-password' },
          cookie,
        )
      ).status,
      403,
    );
    const setup = await call(
      '/api/account/mfa/setup',
      'POST',
      { currentPassword: credentials.password },
      cookie,
    );
    assert.equal(setup.status, 200);
    const totp = require('../src/totp');
    const confirmed = await call(
      '/api/account/mfa/confirm',
      'POST',
      {
        currentPassword: credentials.password,
        code: totp.codeAt(setup.body.secret, Math.floor(Date.now() / 30000)),
      },
      cookie,
    );
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.recoveryCodes.length, 8);
    assert.equal((await call('/api/me', 'GET', undefined, cookie)).status, 401);
    assert.equal((await call('/api/login', 'POST', credentials)).status, 401);
    const recovered = await call('/api/login', 'POST', {
      ...credentials,
      recoveryCode: confirmed.body.recoveryCodes[0],
    });
    assert.equal(recovered.status, 200);
    assert.equal(
      (
        await call('/api/login', 'POST', {
          ...credentials,
          recoveryCode: confirmed.body.recoveryCodes[0],
        })
      ).status,
      401,
    );
    // Existing clinical tests use this new, MFA-authenticated session.
    headersAfterMfa.cookie = recovered.cookie;
  });
  await t.test('appointment reactivation cannot overlap', async () => {
    const activeCookie = headersAfterMfa.cookie;
    const payload = {
      patientId: id,
      start: new Date(Date.now() + 86400000).toISOString(),
      duration: 50,
    };
    const first = await call('/api/appointments', 'POST', payload, activeCookie, workspace);
    assert.equal(first.status, 201);
    assert.equal(
      (
        await call(
          '/api/appointments/' + first.body.appointment.id,
          'PATCH',
          { status: 'cancelada' },
          activeCookie,
          workspace,
        )
      ).status,
      200,
    );
    assert.equal(
      (await call('/api/appointments', 'POST', payload, activeCookie, workspace)).status,
      201,
    );
    assert.equal(
      (
        await call(
          '/api/appointments/' + first.body.appointment.id,
          'PATCH',
          { status: 'agendada' },
          activeCookie,
          workspace,
        )
      ).status,
      409,
    );
  });
});
