const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
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
test('autenticação, cadastro, avaliação, isolamento e conflito de agenda', async (t) => {
  const dir = path.join(__dirname, '.runtime-data');
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let childError = '';
  child.stderr.on('data', (d) => (childError += d));
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
      lastError = e.message;
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
  const register = await call('/api/register', 'POST', {
    name: 'Dra. Exemplo',
    email: 'dra@example.test',
    password: 'senha-segura-123',
  });
  assert.equal(register.status, 201);
  const token = register.cookie.match(/nc_session=([^;]+)/)[1];
  const patient = await call('/api/patients', 'POST', { name: 'Paciente Fictício' }, token);
  assert.equal(patient.status, 201);
  const assessment = await call(
    '/api/assessments',
    'POST',
    {
      patientId: patient.body.patient.id,
      date: '2026-10-27',
      weight: '64',
      height: '160',
      fat: '25',
    },
    token,
  );
  assert.equal(assessment.status, 201);
  assert.equal(assessment.body.assessment.bmi, 25);
  assert.equal(assessment.body.assessment.fatMass, 16);
  const planDraft = await call(
    '/api/meal-plans',
    'POST',
    {
      patientId: patient.body.patient.id,
      name: 'Plano de demonstração',
      meals: [{ name: 'Café da manhã', items: [] }],
    },
    token,
  );
  assert.equal(planDraft.status, 201);
  const blockedPublish = await call(
    `/api/meal-plans/${planDraft.body.mealPlan.id}/publish`,
    'POST',
    {},
    token,
  );
  assert.equal(blockedPublish.status, 400);
  const firstVersion = await call(
    `/api/meal-plans/${planDraft.body.mealPlan.id}/draft`,
    'PUT',
    {
      name: 'Plano de demonstração',
      objective: 'Acompanhamento individual',
      meals: [{ name: 'Café da manhã', items: [{ food: 'Aveia', quantity: 40, unit: 'g' }] }],
    },
    token,
  );
  assert.equal(firstVersion.status, 200);
  assert.equal(firstVersion.body.mealPlan.versions[0].number, 1);
  const published = await call(
    `/api/meal-plans/${planDraft.body.mealPlan.id}/publish`,
    'POST',
    {},
    token,
  );
  assert.equal(published.status, 200);
  assert.equal(published.body.mealPlan.versions[0].status, 'published');
  const secondVersion = await call(
    `/api/meal-plans/${planDraft.body.mealPlan.id}/draft`,
    'PUT',
    {
      name: 'Plano de demonstração',
      objective: 'Revisão',
      meals: [{ name: 'Lanche', items: [{ food: 'Iogurte natural', quantity: 1, unit: 'pote' }] }],
    },
    token,
  );
  assert.equal(secondVersion.status, 200);
  assert.equal(secondVersion.body.mealPlan.versions.length, 2);
  assert.equal(secondVersion.body.mealPlan.versions[0].status, 'published');
  assert.equal(secondVersion.body.mealPlan.versions[1].number, 2);
  const other = await call('/api/register', 'POST', {
    name: 'Outro profissional',
    email: 'outro@example.test',
    password: 'senha-segura-456',
  });
  const otherToken = other.cookie.match(/nc_session=([^;]+)/)[1];
  const isolated = await call(
    `/api/patients/${patient.body.patient.id}`,
    'GET',
    undefined,
    otherToken,
  );
  assert.equal(isolated.status, 404);
  const planIsolation = await call(
    `/api/meal-plans/${planDraft.body.mealPlan.id}`,
    'GET',
    undefined,
    otherToken,
  );
  assert.equal(planIsolation.status, 404);
  const start = new Date(Date.now() + 3600000).toISOString();
  const one = await call(
    '/api/appointments',
    'POST',
    { patientId: patient.body.patient.id, start, duration: 50 },
    token,
  );
  assert.equal(one.status, 201);
  const conflict = await call(
    '/api/appointments',
    'POST',
    { patientId: patient.body.patient.id, start, duration: 30 },
    token,
  );
  assert.equal(conflict.status, 409);
});
