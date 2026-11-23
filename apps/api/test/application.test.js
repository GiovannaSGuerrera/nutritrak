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
  for (const [route, method, payload] of [
    [`/api/patients/${patient.body.patient.id}`, 'PATCH', { name: 'Alterado' }],
    [`/api/patients/${patient.body.patient.id}/invitations`, 'POST', {}],
    [`/api/patients/${patient.body.patient.id}/password-resets`, 'POST', {}],
    [`/api/meal-plans/${planDraft.body.mealPlan.id}/draft`, 'PUT', { name: 'Alterado', meals: [] }],
    [`/api/meal-plans/${planDraft.body.mealPlan.id}/publish`, 'POST', {}],
    ['/api/assessments', 'POST', { patientId: patient.body.patient.id }],
    ['/api/appointments', 'POST', { patientId: patient.body.patient.id }],
    ['/api/goals', 'POST', { patientId: patient.body.patient.id }],
    ['/api/meal-plans', 'POST', { patientId: patient.body.patient.id }],
  ])
    assert.equal((await call(route, method, payload, otherToken)).status, 404, route);
  assert.deepEqual((await call('/api/patients', 'GET', undefined, otherToken)).body.patients, []);
  assert.equal(
    (await call(`/api/patients/${patient.body.patient.id}`, 'GET', undefined, token)).body.patient
      .name,
    'Paciente Fictício',
  );
  const external = await fetch(base + '/api/patients', {
    method: 'POST',
    headers: {
      origin: 'https://attacker.test',
      'content-type': 'application/json',
      cookie: `nc_session=${token}`,
    },
    body: '{}',
  });
  assert.equal(external.status, 403);
  const invalid = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'null',
  });
  assert.equal(invalid.status, 400);
  const health = await fetch(base + '/api/health');
  assert.deepEqual(await health.json(), { ok: true });
  assert.equal(health.headers.get('referrer-policy'), 'no-referrer');
  const start = new Date(Date.now() + 3600000).toISOString();
  const one = await call(
    '/api/appointments',
    'POST',
    { patientId: patient.body.patient.id, start, duration: 50 },
    token,
  );
  assert.equal(one.status, 201);
  assert.equal(
    (
      await call(
        `/api/appointments/${one.body.appointment.id}`,
        'PATCH',
        { status: 'cancelada' },
        otherToken,
      )
    ).status,
    404,
  );
  const goal = await call(
    '/api/goals',
    'POST',
    { patientId: patient.body.patient.id, description: 'Meta fictícia' },
    token,
  );
  assert.equal(goal.status, 201);
  assert.equal(
    (await call(`/api/goals/${goal.body.goal.id}`, 'PATCH', { status: 'concluida' }, otherToken))
      .status,
    404,
  );
  for (const route of ['/api/appointments', '/api/assessments', '/api/meal-plans']) {
    assert.equal(
      JSON.stringify((await call(route, 'GET', undefined, otherToken)).body).includes(
        patient.body.patient.id,
      ),
      false,
      route,
    );
  }
  const conflict = await call(
    '/api/appointments',
    'POST',
    { patientId: patient.body.patient.id, start, duration: 30 },
    token,
  );
  assert.equal(conflict.status, 409);
  const patientId = patient.body.patient.id;
  await call(
    `/api/patients/${patientId}`,
    'PATCH',
    { name: 'Paciente Fictício', email: 'patient@example.test' },
    token,
  );
  const invitation = await call(`/api/patients/${patientId}/invitations`, 'POST', {}, token);
  assert.equal(invitation.status, 201);
  const activation = await call('/api/patient/activate', 'POST', {
    token: invitation.body.token,
    email: 'patient@example.test',
    password: 'patient-secure-123',
  });
  assert.equal(activation.status, 201);
  assert.equal(activation.body.portal.mealPlans.length, 1);
  assert.equal(activation.body.portal.mealPlans[0].version.number, 1);
  assert.equal(JSON.stringify(activation.body).includes('salt'), false);
  assert.equal(
    (
      await call('/api/patient/activate', 'POST', {
        token: invitation.body.token,
        email: 'patient@example.test',
        password: 'patient-secure-123',
      })
    ).status,
    410,
  );
  const patientCookie = activation.cookie.split(';')[0];
  assert.equal(
    (await fetch(base + '/api/patients', { headers: { cookie: patientCookie } })).status,
    401,
  );
  const reset = await call(`/api/patients/${patientId}/password-resets`, 'POST', {}, token);
  assert.equal(reset.status, 201);
  assert.equal(
    (
      await call('/api/patient/password-resets/complete', 'POST', {
        token: reset.body.token,
        password: 'new-patient-password-123',
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(base + '/api/patient/me', { headers: { cookie: patientCookie } })).status,
    401,
  );
  assert.equal(
    (
      await call('/api/patient/password-resets/complete', 'POST', {
        token: reset.body.token,
        password: 'another-password-123',
      })
    ).status,
    410,
  );
  assert.equal(
    (
      await call('/api/patient/login', 'POST', {
        email: 'patient@example.test',
        password: 'new-patient-password-123',
      })
    ).status,
    200,
  );
  let limited;
  for (let i = 0; i < 21; i++)
    limited = await call('/api/login', 'POST', {
      email: 'unknown@example.test',
      password: 'wrong',
    });
  assert.equal(limited.status, 429);
  assert.equal((await call('/api/patients', 'GET', undefined, token)).status, 200);
  assert.equal(childError.includes('patient@example.test'), false);
  assert.equal(childError.includes('patient-secure-123'), false);
  assert.equal(childError.includes(invitation.body.token), false);
});
