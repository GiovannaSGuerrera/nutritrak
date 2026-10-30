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
  let child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let childError = '';
  child.stderr.on('data', (d) => (childError += d));
  t.after(async () => {
    child.kill();
    await fs.rm(dir, { recursive: true, force: true });
  });
  let base = `http://localhost:${port}`;
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
  const workspaceByToken = new Map();
  async function call(route, method = 'GET', payload, token, cookieName = 'nc_session') {
    const r = await fetch(base + route, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { cookie: `${cookieName}=${token}` } : {}),
        ...(token && workspaceByToken.has(token) ? { 'x-workspace-id': workspaceByToken.get(token) } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie') };
  }
  assert.equal((await call('/api/dashboard')).status, 401, 'sem sessão deve negar acesso');
  assert.equal(
    (await call('/api/dashboard', 'GET', undefined, 'token-invalido')).status,
    401,
    'sessão desconhecida deve negar acesso',
  );
  const register = await call('/api/register', 'POST', {
    name: 'Dra. Exemplo',
    email: 'dra@example.test',
    password: 'senha-segura-123',
  });
  assert.equal(register.status, 201);
  assert.equal(register.body.workspace, undefined, 'cadastro não deve criar workspace automaticamente');
  const token = register.cookie.match(/nc_session=([^;]+)/)[1];
  assert.deepEqual((await call('/api/workspaces', 'GET', undefined, token)).body.workspaces, []);
  const firstWorkspace = await call('/api/workspaces', 'POST', {
    name: 'Consultório Dra. Exemplo',
    type: 'individual',
    clinician: true,
  }, token);
  assert.equal(firstWorkspace.status, 201, 'profissional escolhe nome e papel antes de usar o painel');
  const firstWorkspaceId = firstWorkspace.body.workspace.id;
  workspaceByToken.set(token, firstWorkspaceId);
  assert.equal((await call('/api/workspaces/select', 'POST', {
    workspaceId: firstWorkspaceId, experience: 'clinical',
  }, token)).status, 200);
  assert.equal((await call('/api/workspaces/select', 'POST', {
    workspaceId: firstWorkspaceId, experience: 'administrative',
  }, token)).status, 200, 'uma conta com dois papéis pode alternar entre experiências');
  const personalSignup = await call('/api/register', 'POST', {
    name: 'Nutricionista Sintética',
    email: 'nutri-perfil@example.test',
    password: 'senha-segura-nutri-123',
    profileType: 'nutritionist',
  });
  assert.equal(personalSignup.status, 201);
  assert.equal(personalSignup.body.workspace.type, 'individual');
  const personalToken = personalSignup.cookie.match(/nc_session=([^;]+)/)[1];
  const personalContexts = await call('/api/workspaces', 'GET', undefined, personalToken);
  assert.deepEqual(personalContexts.body.workspaces[0].roles.sort(), ['clinician', 'owner_admin']);
  const personalClinical = await call('/api/workspaces/select', 'POST', {
    workspaceId: personalSignup.body.workspace.id, experience: 'clinical',
  }, personalToken);
  const personalAdmin = await call('/api/workspaces/select', 'POST', {
    workspaceId: personalSignup.body.workspace.id, experience: 'administrative',
  }, personalToken);
  assert.equal(personalClinical.status, 200);
  assert.equal(personalAdmin.status, 200, 'a nutricionista independente pode escolher a área administrativa');
  const clinicSignup = await call('/api/register', 'POST', {
    name: 'Gestora Sintética',
    email: 'gestora-perfil@example.test',
    password: 'senha-segura-clinica-123',
    profileType: 'clinic',
    workspaceName: 'Clínica Sintética',
  });
  assert.equal(clinicSignup.status, 201);
  assert.equal(clinicSignup.body.workspace.type, 'clinic');
  const clinicToken = clinicSignup.cookie.match(/nc_session=([^;]+)/)[1];
  assert.equal((await call('/api/workspaces/select', 'POST', {
    workspaceId: clinicSignup.body.workspace.id, experience: 'administrative',
  }, clinicToken)).status, 200);
  assert.equal((await call('/api/workspaces/select', 'POST', {
    workspaceId: clinicSignup.body.workspace.id, experience: 'clinical',
  }, clinicToken)).status, 403, 'administradora não ganha acesso clínico automaticamente');
  assert.equal((await call('/api/workspaces/select', 'POST', {
    workspaceId: firstWorkspaceId, experience: 'administrative',
  }, clinicToken)).status, 404, 'não pode selecionar workspace de outra conta');
  const badLogin = await call('/api/login', 'POST', {
    email: 'dra@example.test',
    password: 'senha-errada-123',
  });
  assert.equal(badLogin.status, 401);
  const patient = await call(
    '/api/patients',
    'POST',
    { name: 'Paciente Fictício', email: 'paciente@example.test', primaryProfessionalId: register.body.user.id },
    token,
  );
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

  const invitation = await call(
    `/api/patients/${patient.body.patient.id}/invitations`,
    'POST',
    {},
    token,
  );
  assert.equal(invitation.status, 201);
  assert.equal(
    (await call('/api/patient/invitations/validate', 'POST', { token: invitation.body.token })).status,
    200,
  );
  const activation = await call('/api/patient/activate', 'POST', {
    token: invitation.body.token,
    email: 'paciente@example.test',
    password: 'senha-paciente-123',
  });
  assert.equal(activation.status, 201);
  assert.equal(activation.body.portal.mealPlans.length, 1);
  assert.equal(activation.body.portal.mealPlans[0].version.number, 1);
  const patientToken = activation.cookie.match(/nt_patient_session=([^;]+)/)[1];
  const patientPortal = await call('/api/patient/me', 'GET', undefined, patientToken, 'nt_patient_session');
  assert.equal(patientPortal.status, 200);
  assert.equal(patientPortal.body.portal.mealPlans.length, 1, 'portal omite o rascunho v2');
  assert.equal((await call('/api/dashboard', 'GET', undefined, patientToken, 'nt_patient_session')).status, 401);

  const reset = await call(`/api/patients/${patient.body.patient.id}/password-resets`, 'POST', {}, token);
  assert.equal(reset.status, 201);
  assert.equal(
    (await call('/api/patient/password-resets/validate', 'POST', { token: reset.body.token })).status,
    200,
  );
  const resetComplete = await call('/api/patient/password-resets/complete', 'POST', {
    token: reset.body.token,
    password: 'senha-paciente-nova-456',
  });
  assert.equal(resetComplete.status, 200);
  assert.equal(
    (await call('/api/patient/me', 'GET', undefined, patientToken, 'nt_patient_session')).status,
    401,
    'redefinição revoga sessões do portal existentes',
  );
  assert.equal(
    (await call('/api/patient/login', 'POST', {
      email: 'paciente@example.test',
      password: 'senha-paciente-123',
    })).status,
    401,
  );
  const patientLogin = await call('/api/patient/login', 'POST', {
    email: 'paciente@example.test',
    password: 'senha-paciente-nova-456',
  });
  assert.equal(patientLogin.status, 200);
  const newPatientToken = patientLogin.cookie.match(/nt_patient_session=([^;]+)/)[1];
  assert.equal((await call('/api/patient/logout', 'POST', {}, newPatientToken, 'nt_patient_session')).status, 200);
  assert.equal(
    (await call('/api/patient/me', 'GET', undefined, newPatientToken, 'nt_patient_session')).status,
    401,
  );
  const other = await call('/api/register', 'POST', {
    name: 'Outro profissional',
    email: 'outro@example.test',
    password: 'senha-segura-456',
  });
  assert.equal(other.status, 201);
  assert.equal(other.body.workspace, undefined, 'conta de profissional convidada não ganha consultório próprio');
  const otherToken = other.cookie.match(/nc_session=([^;]+)/)[1];
  assert.deepEqual((await call('/api/workspaces', 'GET', undefined, otherToken)).body.workspaces, []);
  const providerInvite = await call(
    `/api/workspaces/${firstWorkspaceId}/invitations`,
    'POST',
    { email: 'outro@example.test', role: 'clinician' },
    token,
  );
  assert.equal(providerInvite.status, 201);
  assert.equal(
    (await call('/api/workspace-invitations/accept', 'POST', { token: providerInvite.body.token }, otherToken)).status,
    201,
  );
  assert.equal((await call('/api/workspace-invitations/accept', 'POST', {
    token: providerInvite.body.token,
  }, otherToken)).status, 404, 'convite aceito não pode ser reutilizado');
  assert.equal((await call('/api/workspace-invitations/accept', 'POST', {
    token: 'token-invalido-sintetico',
  }, otherToken)).status, 404);
  workspaceByToken.set(otherToken, firstWorkspaceId);
  const providerAccount = await call('/api/me', 'GET', undefined, otherToken);
  assert.deepEqual(providerAccount.body.workspaces[0].roles, ['clinician']);
  assert.equal((await call('/api/workspaces', 'POST', { name: 'Workspace indevido', type: 'clinic' }, otherToken)).status, 403,
    'membro nutricionista não cria workspace');
  assert.equal(
    (await call(`/api/patients/${patient.body.patient.id}`, 'GET', undefined, otherToken)).status,
    404,
    'nutricionista sem atribuição não abre o prontuário',
  );
  const assignedProvider = await call(
    `/api/patients/${patient.body.patient.id}/assignments`,
    'PUT',
    { primaryProfessionalId: register.body.user.id, supportProfessionalIds: [other.body.user.id] },
    token,
  );
  assert.equal(assignedProvider.status, 200);
  const providerProfile = await call(`/api/patients/${patient.body.patient.id}`, 'GET', undefined, otherToken);
  assert.equal(providerProfile.status, 200);
  assert.equal(providerProfile.body.clinicalAccess, true);
  assert.equal(providerProfile.body.assessments.length, 1);
  const goal = await call('/api/goals', 'POST', {
    patientId: patient.body.patient.id,
    description: 'Meta sintética de hidratação',
    category: 'Hábitos',
  }, token);
  assert.equal(goal.status, 201, 'metas clínicas continuam disponíveis no contexto profissional');

  const assistant = await call('/api/register', 'POST', {
    name: 'Assistente Exemplo',
    email: 'assistente@example.test',
    password: 'senha-segura-assistente-789',
  });
  assert.equal(assistant.status, 201);
  assert.equal(assistant.body.workspace, undefined);
  const assistantToken = assistant.cookie.match(/nc_session=([^;]+)/)[1];
  const assistantInvite = await call(
    `/api/workspaces/${firstWorkspaceId}/invitations`,
    'POST',
    { email: 'assistente@example.test', role: 'assistant' },
    token,
  );
  assert.equal(assistantInvite.status, 201);
  assert.equal(
    (await call('/api/workspace-invitations/accept', 'POST', { token: assistantInvite.body.token }, assistantToken)).status,
    201,
  );
  workspaceByToken.set(assistantToken, firstWorkspaceId);
  const assistantProfile = await call(`/api/patients/${patient.body.patient.id}`, 'GET', undefined, assistantToken);
  assert.equal(assistantProfile.status, 200);
  assert.equal(assistantProfile.body.clinicalAccess, false);
  assert.equal(assistantProfile.body.assessments.length, 0);
  assert.equal(
    (await call('/api/assessments', 'GET', undefined, assistantToken)).status,
    403,
    'assistente não acessa avaliações clínicas',
  );
  assert.equal((await call('/api/goals', 'POST', {
    patientId: patient.body.patient.id, description: 'Meta sem acesso clínico',
  }, assistantToken)).status, 403, 'assistente não cria metas clínicas');
  const operationsAccount = await call('/api/register', 'POST', {
    name: 'Administradora Operacional',
    email: 'operacoes@example.test',
    password: 'senha-segura-operacoes-123',
  });
  const operationsToken = operationsAccount.cookie.match(/nc_session=([^;]+)/)[1];
  const operationsInvite = await call(`/api/workspaces/${firstWorkspaceId}/invitations`, 'POST', {
    email: 'operacoes@example.test', role: 'operations_admin',
  }, token);
  assert.equal(operationsInvite.status, 201, 'proprietária pode convidar administradora operacional');
  assert.equal((await call('/api/workspace-invitations/accept', 'POST', {
    token: operationsInvite.body.token,
  }, operationsToken)).status, 201);
  workspaceByToken.set(operationsToken, firstWorkspaceId);
  assert.equal((await call(`/api/workspaces/${firstWorkspaceId}/invitations`, 'POST', {
    email: 'outro-admin@example.test', role: 'operations_admin',
  }, operationsToken)).status, 403, 'administradora operacional não pode conceder privilégio equivalente');
  const operationsClinicianInvite = await call(`/api/workspaces/${firstWorkspaceId}/invitations`, 'POST', {
    email: 'profissional-pela-operacao@example.test', role: 'clinician',
  }, operationsToken);
  assert.equal(operationsClinicianInvite.status, 201, 'administradora operacional pode convidar profissional');
  assert.equal((await call(`/api/workspaces/${firstWorkspaceId}/invitations`, 'POST', {
    email: 'bloqueado-assistente@example.test', role: 'assistant',
  }, assistantToken)).status, 404, 'assistente sem permissão não pode criar convites');
  const isolatedUser = await call('/api/register', 'POST', {
    name: 'Workspace Isolado',
    email: 'isolado@example.test',
    password: 'senha-segura-isolado-789',
  });
  const isolatedToken = isolatedUser.cookie.match(/nc_session=([^;]+)/)[1];
  const isolatedWorkspace = await call('/api/workspaces', 'POST', {
    name: 'Consultório isolado', type: 'individual',
  }, isolatedToken);
  workspaceByToken.set(isolatedToken, isolatedWorkspace.body.workspace.id);
  const expiringInvite = await call(`/api/workspaces/${firstWorkspaceId}/invitations`, 'POST', {
    email: 'isolado@example.test', role: 'clinician',
  }, token);
  assert.equal(expiringInvite.status, 201);
  const isolated = await call(
    `/api/patients/${patient.body.patient.id}`,
    'GET',
    undefined,
    isolatedToken,
  );
  assert.equal(isolated.status, 404);
  const planIsolation = await call(
    `/api/meal-plans/${planDraft.body.mealPlan.id}`,
    'GET',
    undefined,
    isolatedToken,
  );
  assert.equal(planIsolation.status, 404);
  const start = new Date(Date.now() + 3600000).toISOString();
  const one = await call(
    '/api/appointments',
    'POST',
    { patientId: patient.body.patient.id, start, duration: 50, notes: 'nota clínica sintética' },
    token,
  );
  assert.equal(one.status, 201);
  const assistantAppointment = await call(
    `/api/appointments/${one.body.appointment.id}`,
    'PATCH',
    { status: 'agendada' },
    assistantToken,
  );
  assert.equal(assistantAppointment.status, 200);
  assert.equal(assistantAppointment.body.appointment.notes, '', 'admin de agenda não recebe nota clínica na resposta');
  const conflict = await call(
    '/api/appointments',
    'POST',
    { patientId: patient.body.patient.id, start, duration: 30 },
    token,
  );
  assert.equal(conflict.status, 409);

  const logout = await call('/api/logout', 'POST', {}, token);
  assert.equal(logout.status, 200);
  assert.equal((await call('/api/dashboard', 'GET', undefined, token)).status, 401);
  assert.equal((await call('/api/logout', 'POST', {}, token)).status, 200, 'logout idempotente');

  // Transform only this temporary synthetic store to represent a pre-workspace account.
  const syntheticStorePath = path.join(dir, 'store.json');
  const syntheticStore = JSON.parse(await fs.readFile(syntheticStorePath, 'utf8'));
  const expiringInvitation = syntheticStore.workspaceInvitations.find(
    (entry) => entry.tokenHash && entry.email === 'isolado@example.test' && !entry.usedAt,
  );
  assert.ok(expiringInvitation, 'convite sintético pendente deve existir para o cenário de expiração');
  expiringInvitation.expiresAt = new Date(Date.now() - 1000).toISOString();
  for (const membership of syntheticStore.memberships)
    if (membership.userId === register.body.user.id) membership.status = 'revoked';
  for (const collection of ['patients', 'assessments', 'appointments', 'goals', 'mealPlans'])
    for (const record of syntheticStore[collection])
      if (record.userId === register.body.user.id) delete record.workspaceId;
  syntheticStore.patientAssignments = syntheticStore.patientAssignments.filter(
    (assignment) => assignment.patientId !== patient.body.patient.id,
  );
  for (const collection of ['patientAccounts', 'patientInvitations', 'patientPasswordResets'])
    for (const record of syntheticStore[collection])
      if (record.patientId === patient.body.patient.id) delete record.workspaceId;
  for (const event of syntheticStore.audit)
    if (event.userId === register.body.user.id) delete event.workspaceId;
  await fs.writeFile(syntheticStorePath, JSON.stringify(syntheticStore));

  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
  const restartedPort = await freePort();
  child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT: String(restartedPort), DATA_DIR: dir, NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  base = `http://localhost:${restartedPort}`;
  ready = false;
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
  assert.ok(ready, `servidor deve recuperar os dados após reinício (${lastError})`);
  assert.equal((await call('/api/patients', 'GET', undefined, token)).status, 401);
  const login = await call('/api/login', 'POST', {
    email: 'dra@example.test',
    password: 'senha-segura-123',
  });
  assert.equal(login.status, 200);
  const restartedToken = login.cookie.match(/nc_session=([^;]+)/)[1];
  const isolatedLogin = await call('/api/login', 'POST', {
    email: 'isolado@example.test', password: 'senha-segura-isolado-789',
  });
  const isolatedRestartedToken = isolatedLogin.cookie.match(/nc_session=([^;]+)/)[1];
  assert.equal((await call('/api/workspace-invitations/accept', 'POST', {
    token: expiringInvite.body.token,
  }, isolatedRestartedToken)).status, 404, 'convite expirado não pode ser aceito');
  const legacyPreview = await call('/api/workspaces/legacy-preview', 'GET', undefined, restartedToken);
  assert.equal(legacyPreview.status, 200);
  assert.equal(legacyPreview.body.hasLegacyRecords, true);
  assert.equal(legacyPreview.body.patients.length, 1);
  const migration = await call('/api/workspaces/migrate-personal', 'POST', {
    name: 'Consultório Migrado',
    clinician: true,
    primaryPatientIds: [patient.body.patient.id],
  }, restartedToken);
  assert.equal(migration.status, 201);
  assert.ok(migration.body.backup);
  await fs.access(path.join(dir, 'backups', migration.body.backup));
  workspaceByToken.set(restartedToken, migration.body.workspace.id);
  assert.equal((await call('/api/patients', 'GET', undefined, restartedToken)).body.patients.length, 1);
  assert.equal(
    (await call('/api/assessments', 'GET', undefined, restartedToken)).body.assessments.length,
    1,
  );

  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
  const expiryPort = await freePort();
  child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(expiryPort),
      DATA_DIR: dir,
      NODE_ENV: 'test',
      NUTRITRACK_SESSION_MAX_AGE_SECONDS: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  base = `http://localhost:${expiryPort}`;
  ready = false;
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
  assert.ok(ready, `servidor deve iniciar cenário de expiração (${lastError})`);
  const shortProfessionalLogin = await call('/api/login', 'POST', {
    email: 'dra@example.test',
    password: 'senha-segura-123',
  });
  const shortPatientLogin = await call('/api/patient/login', 'POST', {
    email: 'paciente@example.test',
    password: 'senha-paciente-nova-456',
  });
  assert.equal(shortProfessionalLogin.status, 200);
  assert.equal(shortPatientLogin.status, 200);
  const shortProfessionalToken = shortProfessionalLogin.cookie.match(/nc_session=([^;]+)/)[1];
  workspaceByToken.set(shortProfessionalToken, migration.body.workspace.id);
  const shortPatientToken = shortPatientLogin.cookie.match(/nt_patient_session=([^;]+)/)[1];
  assert.equal((await call('/api/me', 'GET', undefined, shortProfessionalToken)).status, 200);
  assert.equal(
    (await call('/api/patient/me', 'GET', undefined, shortPatientToken, 'nt_patient_session')).status,
    200,
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal((await call('/api/me', 'GET', undefined, shortProfessionalToken)).status, 401);
  assert.equal(
    (await call('/api/patient/me', 'GET', undefined, shortPatientToken, 'nt_patient_session')).status,
    401,
  );
});
