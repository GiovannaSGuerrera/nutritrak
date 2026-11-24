const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}
test('hardening: HTTP, atomicidade, integridade e isolamento', async (t) => {
  const dir = path.join(__dirname, '.runtime-hardening-' + require('crypto').randomUUID());
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const port = await freePort();
  const serverArguments =
    process.env.TEST_SERVERLESS === '1'
      ? [
          '-e',
          `require('node:http').createServer(require(${JSON.stringify(path.resolve(__dirname, '../../../api/index.js'))})).listen(Number(process.env.PORT))`,
        ]
      : [path.join(__dirname, '..', 'dist', 'server.js')];
  const child = spawn(process.execPath, serverArguments, {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childError = '';
  child.stderr.on('data', (d) => (childError += d));
  child.stdout.on('data', (d) => (childError += d));
  t.after(async () => {
    child.kill();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const base = `http://localhost:${port}`;
  let ready = false,
    lastError = '';
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(base);
      ready = true;
      break;
    } catch (e) {
      lastError = `${e.message}: ${e.cause?.code || ''}`;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(ready, `servidor deve iniciar (${childError}; ${lastError})`);
  const homepage = await fetch(base);
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /NutriTrack/);
  const script = await fetch(`${base}/app.js`);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /async function api/);
  async function call(route, method = 'GET', payload, token) {
    const r = await fetch(base + route, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { cookie: `nc_session=${token}` } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie') };
  }
  const reg = await call('/api/register', 'POST', {
    name: 'Synthetic',
    email: 'hardening@example.invalid',
    password: 'Synthetic-password-123!',
  });
  assert.equal(reg.status, 201);
  const token = reg.cookie.match(/nc_session=([^;]+)/)[1];
  const p = await call('/api/patients', 'POST', { name: 'Original' }, token);
  const id = p.body.patient.id;
  await t.test('corpo incompleto não bloqueia health', async () => {
    const slow = require('http').request(base + '/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': 100 },
    });
    slow.on('error', () => {});
    slow.write('{');
    await new Promise((r) => setTimeout(r, 50));
    let completed = false;
    const health = fetch(base + '/api/health').then((r) => {
      completed = true;
      return r.status;
    });
    await new Promise((r) => setTimeout(r, 200));
    const responsive = completed;
    slow.destroy();
    await health;
    assert.equal(responsive, true);
  });
  await t.test('PATCH recusado não altera estado', async () => {
    assert.equal((await call(`/api/patients/${id}`, 'PATCH', { name: '' }, token)).status, 400);
    assert.equal(
      (await call(`/api/patients/${id}`, 'GET', undefined, token)).body.patient.name,
      'Original',
    );
  });
  await t.test('contratos rejeitam datas, medidas, status e null', async () => {
    assert.equal(
      (
        await call(
          '/api/assessments',
          'POST',
          { patientId: id, waist: 'NaN', date: '2026-99-99' },
          token,
        )
      ).status,
      400,
    );
    assert.equal(
      (await call(`/api/patients/${id}`, 'PATCH', { status: 'INVALID' }, token)).status,
      400,
    );
    assert.equal(
      (
        await call(
          '/api/meal-plans',
          'POST',
          { patientId: id, name: 'Invalid', meals: [null] },
          token,
        )
      ).status,
      400,
    );
  });
  await t.test('edição/publicação exigem revisão atual', async () => {
    const data = {
      patientId: id,
      name: 'Plan',
      meals: [{ name: 'Meal', items: [{ food: 'Food', quantity: 100, unit: 'g' }] }],
    };
    const created = await call('/api/meal-plans', 'POST', data, token),
      planId = created.body.mealPlan.id;
    assert.equal((await call(`/api/meal-plans/${planId}/draft`, 'PUT', data, token)).status, 428);
    const updates = await Promise.all(
      [1, 2].map(() =>
        call(`/api/meal-plans/${planId}/draft`, 'PUT', { ...data, expectedRevision: 0 }, token),
      ),
    );
    assert.deepEqual(updates.map((x) => x.status).sort(), [200, 409]);
    assert.equal(
      (await call(`/api/meal-plans/${planId}/publish`, 'POST', { expectedRevision: 0 }, token))
        .status,
      409,
    );
    assert.equal(
      (await call(`/api/meal-plans/${planId}/publish`, 'POST', { expectedRevision: 1 }, token))
        .status,
      200,
    );
  });
  await t.test('reativação de consulta revalida conflito', async () => {
    const data = {
      patientId: id,
      start: new Date(Date.now() + 86400000).toISOString(),
      duration: 50,
    };
    const a = await call('/api/appointments', 'POST', data, token);
    assert.equal(a.status, 201);
    await call(
      `/api/appointments/${a.body.appointment.id}`,
      'PATCH',
      { status: 'cancelada' },
      token,
    );
    assert.equal((await call('/api/appointments', 'POST', data, token)).status, 201);
    assert.equal(
      (
        await call(
          `/api/appointments/${a.body.appointment.id}`,
          'PATCH',
          { status: 'agendada' },
          token,
        )
      ).status,
      409,
    );
  });
});
