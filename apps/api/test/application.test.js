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
function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
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
    await stopServer(child);
    await fs.rm(dir, { recursive: true, force: true });
  });
  let base = `http://127.0.0.1:${port}`;
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
  const noMembershipAccount = await call('/api/register', 'POST', {
    name: 'Conta sem workspace',
    email: 'sem-workspace@example.test',
    password: 'senha-segura-sem-workspace-123',
  });
  assert.equal(noMembershipAccount.status, 201);
  const noMembershipToken = noMembershipAccount.cookie.match(/nc_session=([^;]+)/)[1];
  const memberListPath = `/api/workspaces/${firstWorkspaceId}/members`;
  const roleListPath = `/api/workspaces/${firstWorkspaceId}/roles`;
  workspaceByToken.set(noMembershipToken, firstWorkspaceId);
  assert.equal((await call('/api/clinicians')).status, 401,
    'a listagem de profissionais exige autenticação');
  assert.equal((await call(roleListPath)).status, 401,
    'a consulta de papéis exige autenticação');
  assert.equal((await call(memberListPath)).status, 401,
    'a listagem da equipe exige autenticação');
  assert.equal((await call(memberListPath, 'GET', undefined, noMembershipToken)).status, 404,
    'conta sem membership não pode consultar a equipe');
  assert.equal((await call('/api/clinicians', 'GET', undefined, noMembershipToken)).status, 403,
    'conta sem membership não pode consultar profissionais');
  assert.equal((await call(roleListPath, 'GET', undefined, noMembershipToken)).status, 404,
    'conta sem membership não pode consultar papéis do workspace');
  const ownerRoles = await call(roleListPath, 'GET', undefined, token);
  assert.equal(ownerRoles.status, 200, 'proprietária consulta as permissões disponíveis');
  assert.ok(ownerRoles.body.roles.some((role) => role.key === 'clinician'));
  const ownerClinicians = await call('/api/clinicians', 'GET', undefined, token);
  assert.equal(ownerClinicians.status, 200, 'proprietária pode consultar profissionais para atribuição');
  assert.ok(ownerClinicians.body.clinicians.some((clinician) => clinician.id === register.body.user.id));
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
  assert.equal((await call(memberListPath, 'GET', undefined, clinicToken)).status, 404,
    'membership em outro workspace não permite consultar esta equipe');
  assert.equal((await call(roleListPath, 'GET', undefined, clinicToken)).status, 404,
    'membership em outro workspace não permite consultar os papéis deste workspace');
  workspaceByToken.set(clinicToken, firstWorkspaceId);
  assert.equal((await call('/api/clinicians', 'GET', undefined, clinicToken)).status, 403,
    'membership em outro workspace não permite consultar profissionais deste workspace');
  workspaceByToken.set(clinicToken, clinicSignup.body.workspace.id);
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
  assert.equal((await call('/api/patient/me')).status, 401, 'o portal exige sessão antes de devolver dados');
  const secondPatient = await call('/api/patients', 'POST', {
    name: 'Paciente Isolado',
    email: 'paciente-isolado@example.test',
    primaryProfessionalId: register.body.user.id,
  }, token);
  assert.equal(secondPatient.status, 201);
  const expiringPatient = await call('/api/patients', 'POST', {
    name: 'Paciente Convite Expirado',
    email: 'paciente-expirado@example.test',
    primaryProfessionalId: register.body.user.id,
  }, token);
  assert.equal(expiringPatient.status, 201);
  const expiringPatientInvite = await call(
    `/api/patients/${expiringPatient.body.patient.id}/invitations`, 'POST', {}, token,
  );
  assert.equal(expiringPatientInvite.status, 201);
  assert.equal(
    (await call('/api/patient/invitations/validate', 'POST', { token: 'token-inexistente' })).status,
    410,
    'token de ativação inválido é rejeitado',
  );
  assert.equal(
    (await call('/api/patient/invitations/validate', 'POST', { token: invitation.body.token })).status,
    200,
  );
  assert.equal((await call('/api/patient/activate', 'POST', {
    token: invitation.body.token,
    email: 'paciente-isolado@example.test',
    password: 'senha-paciente-123',
  })).status, 400, 'o token não pode ativar a conta de outro paciente');
  const activation = await call('/api/patient/activate', 'POST', {
    token: invitation.body.token,
    email: 'paciente@example.test',
    password: 'senha-paciente-123',
  });
  assert.equal(activation.status, 201);
  assert.equal(activation.body.portal.mealPlans.length, 1);
  assert.equal(activation.body.portal.mealPlans[0].version.number, 1);
  assert.equal(activation.body.portal.patient.name, 'Paciente Fictício');
  assert.equal(JSON.stringify(activation.body).includes('senha-paciente-123'), false,
    'resposta de ativação não expõe a senha');
  assert.equal(JSON.stringify(activation.body).includes('salt'), false,
    'resposta de ativação não expõe salt ou hash');
  const patientToken = activation.cookie.match(/nt_patient_session=([^;]+)/)[1];
  const patientPortal = await call('/api/patient/me', 'GET', undefined, patientToken, 'nt_patient_session');
  assert.equal(patientPortal.status, 200);
  assert.equal(patientPortal.body.portal.mealPlans.length, 1, 'portal omite o rascunho v2');
  const crossPatientQuery = await call(
    `/api/patient/me?patientId=${encodeURIComponent(secondPatient.body.patient.id)}&workspaceId=${encodeURIComponent(clinicSignup.body.workspace.id)}`,
    'GET', undefined, patientToken, 'nt_patient_session',
  );
  assert.equal(crossPatientQuery.body.portal.patient.name, 'Paciente Fictício',
    'ID enviado na URL não substitui o vínculo da sessão autenticada');
  assert.equal(crossPatientQuery.body.portal.mealPlans[0].name, 'Plano de demonstração');
  const secondInvitation = await call(`/api/patients/${secondPatient.body.patient.id}/invitations`, 'POST', {}, token);
  assert.equal(secondInvitation.status, 201);
  const secondActivation = await call('/api/patient/activate', 'POST', {
    token: secondInvitation.body.token,
    email: 'paciente-isolado@example.test',
    password: 'senha-paciente-isolado-456',
  });
  assert.equal(secondActivation.status, 201);
  assert.equal(secondActivation.body.portal.patient.name, 'Paciente Isolado');
  assert.equal(secondActivation.body.portal.mealPlans.length, 0);
  const secondPatientToken = secondActivation.cookie.match(/nt_patient_session=([^;]+)/)[1];
  const secondPatientPortal = await call('/api/patient/me', 'GET', undefined, secondPatientToken, 'nt_patient_session');
  assert.equal(secondPatientPortal.body.portal.patient.name, 'Paciente Isolado');
  assert.equal(secondPatientPortal.body.portal.mealPlans.length, 0,
    'a segunda conta não recebe planos publicados para o primeiro paciente');
  const secondPatientAssessment = await call('/api/assessments', 'POST', {
    patientId: secondPatient.body.patient.id,
    date: '2026-10-28',
    weight: '59',
    height: '162',
    notes: 'Avaliação sintética preservada durante a revogação.',
  }, token);
  assert.equal(secondPatientAssessment.status, 201);
  const secondPatientReset = await call(
    `/api/patients/${secondPatient.body.patient.id}/password-resets`, 'POST', {}, token,
  );
  assert.equal(secondPatientReset.status, 201);
  assert.equal((await call('/api/patient/invitations/validate', 'POST', {
    token: secondInvitation.body.token,
  })).status, 410, 'convite utilizado não pode ser validado novamente');
  assert.equal((await call('/api/patient/activate', 'POST', {
    token: secondInvitation.body.token,
    email: 'paciente-isolado@example.test',
    password: 'senha-paciente-isolado-456',
  })).status, 410, 'convite utilizado não pode ativar outra sessão');
  assert.notEqual((await call(`/api/patients/${secondPatient.body.patient.id}`, 'GET', undefined,
    patientToken, 'nt_patient_session')).status, 200,
  'cookie do portal não autoriza a rota profissional por ID');
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
  assert.equal((await call(memberListPath, 'GET', undefined, otherToken)).status, 404,
    'nutricionista sem permissão administrativa não consulta os dados da equipe');
  assert.equal((await call(roleListPath, 'GET', undefined, otherToken)).status, 404,
    'nutricionista não consulta a matriz administrativa de papéis');
  assert.equal((await call('/api/clinicians', 'GET', undefined, otherToken)).status, 404,
    'nutricionista sem permissão de atribuição não consulta a lista administrativa de profissionais');
  const ownerMemberList = await call(memberListPath, 'GET', undefined, token);
  assert.equal(ownerMemberList.status, 200, 'proprietária pode consultar os dados administrativos da equipe');
  assert.ok(ownerMemberList.body.members.some((member) => member.userId === register.body.user.id));
  const ownerMembership = ownerMemberList.body.members.find((member) => member.userId === register.body.user.id);
  assert.ok(ownerMembership, 'a listagem contém o membership da proprietária');
  const providerMembership = ownerMemberList.body.members.find((member) => member.userId === other.body.user.id);
  assert.ok(providerMembership, 'a listagem administrativa inclui o nutricionista ativo');
  assert.equal((await call(`${memberListPath}/${providerMembership.id}`, 'PATCH', {
    roles: ['assistant'],
  }, otherToken)).status, 404, 'nutricionista não pode alterar papéis');
  assert.equal((await call(`${memberListPath}/${providerMembership.id}`, 'DELETE', undefined, otherToken)).status, 404,
    'nutricionista não pode remover membros');
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
  assert.equal((await call('/api/clinicians', 'GET', undefined, otherToken)).status, 404,
    'atribuição clínica não concede acesso à lista administrativa de profissionais');
  assert.equal((await call(roleListPath, 'GET', undefined, otherToken)).status, 404,
    'atribuição clínica não concede acesso à matriz administrativa de papéis');
  const clinicianCreatedPatient = await call('/api/patients', 'POST', {
    name: 'Paciente sintético do nutricionista',
    primaryProfessionalId: other.body.user.id,
  }, otherToken);
  assert.equal(clinicianCreatedPatient.status, 201,
    'nutricionista ainda pode se designar ao criar um paciente sem consultar a equipe completa');
  assert.equal(clinicianCreatedPatient.body.patient.workspaceId, firstWorkspaceId);
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
  assert.equal((await call(memberListPath, 'GET', undefined, assistantToken)).status, 404,
    'assistente não consulta os dados administrativos da equipe');
  assert.equal((await call(roleListPath, 'GET', undefined, assistantToken)).status, 404,
    'assistente não consulta a matriz administrativa de papéis');
  assert.equal((await call('/api/clinicians', 'GET', undefined, assistantToken)).status, 404,
    'assistente sem permissão de atribuição não consulta profissionais');
  assert.equal((await call(`${memberListPath}/${providerMembership.id}`, 'PATCH', {
    roles: ['assistant'],
  }, assistantToken)).status, 404, 'assistente não pode alterar papéis');
  assert.equal((await call(`${memberListPath}/${providerMembership.id}`, 'DELETE', undefined, assistantToken)).status, 404,
    'assistente não pode remover membros');
  assert.ok((await call(memberListPath, 'GET', undefined, token)).body.members
    .some((member) => member.id === providerMembership.id),
  'tentativas sem permissão não removem nem alteram o membership');
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
  const operationsMemberList = await call(memberListPath, 'GET', undefined, operationsToken);
  assert.equal(operationsMemberList.status, 200,
    'administradora operacional pode consultar os dados administrativos da equipe');
  assert.equal((await call(roleListPath, 'GET', undefined, operationsToken)).status, 200,
    'administradora operacional consulta as permissões disponíveis');
  assert.equal((await call('/api/clinicians', 'GET', undefined, operationsToken)).status, 200,
    'administradora operacional consulta profissionais para atribuição');
  const operationsPatientView = await call(`/api/patients/${patient.body.patient.id}`, 'GET', undefined, operationsToken);
  assert.equal(operationsPatientView.body.clinicalAccess, false,
    'a permissão de gestão da equipe não concede acesso clínico');
  assert.deepEqual(operationsPatientView.body.assessments, [],
    'a permissão de gestão da equipe não expõe avaliações clínicas');
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
  assert.equal((await call(`${memberListPath}/${ownerMembership.id}`, 'DELETE', undefined, operationsToken)).status, 403,
    'administradora operacional não pode remover a única proprietária');
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

  const secondWorkspaceInvite = await call(
    `/api/workspaces/${isolatedWorkspace.body.workspace.id}/invitations`,
    'POST',
    { email: 'outro@example.test', role: 'clinician' },
    isolatedToken,
  );
  assert.equal(secondWorkspaceInvite.status, 201,
    'uma identidade pode receber membership em outro workspace independente');
  const secondWorkspaceAcceptance = await call('/api/workspace-invitations/accept', 'POST', {
    token: secondWorkspaceInvite.body.token,
  }, otherToken);
  assert.equal(secondWorkspaceAcceptance.status, 201);
  assert.equal(secondWorkspaceAcceptance.body.workspace.id, isolatedWorkspace.body.workspace.id,
    'o convite associa a identidade ao workspace correto');
  const membershipsBeforeRemoval = await call('/api/workspaces', 'GET', undefined, otherToken);
  assert.deepEqual(membershipsBeforeRemoval.body.workspaces.map((item) => item.id).sort(),
    [firstWorkspaceId, isolatedWorkspace.body.workspace.id].sort(),
    'a identidade mantém memberships independentes nos dois workspaces');

  const portalAccessPath = `/api/patients/${secondPatient.body.patient.id}/portal-access`;
  assert.equal((await call('/api/patient/me', 'GET', undefined, secondPatientToken, 'nt_patient_session')).status, 200,
    'a sessão do segundo paciente está ativa antes da suspensão');
  assert.equal((await call(portalAccessPath, 'PATCH', { status: 'suspended' }, secondPatientToken,
    'nt_patient_session')).status, 401,
  'o paciente não pode alterar o próprio estado de autorização');
  workspaceByToken.set(otherToken, firstWorkspaceId);
  assert.equal((await call(portalAccessPath, 'PATCH', { status: 'suspended' }, otherToken)).status, 404,
    'profissional sem atribuição clínica não pode suspender o portal');
  assert.equal((await call(portalAccessPath, 'PATCH', { status: 'suspended' }, assistantToken)).status, 404,
    'assistente não pode suspender o portal');
  assert.equal((await call(portalAccessPath, 'PATCH', { status: 'suspended' }, operationsToken)).status, 404,
    'administradora sem vínculo clínico não pode suspender o portal');
  workspaceByToken.set(otherToken, isolatedWorkspace.body.workspace.id);
  workspaceByToken.set(isolatedToken, isolatedWorkspace.body.workspace.id);
  assert.equal((await call(portalAccessPath, 'PATCH', { status: 'revoked' }, isolatedToken)).status, 404,
    'administrador de outro workspace não pode revogar o acesso do paciente');
  const cliniciansInSecondWorkspace = await call('/api/clinicians', 'GET', undefined, isolatedToken);
  assert.equal(cliniciansInSecondWorkspace.status, 200);
  assert.deepEqual(cliniciansInSecondWorkspace.body.clinicians.map((item) => item.id), [other.body.user.id],
    'a lista clínica do segundo workspace contém somente profissionais daquele workspace');
  assert.equal((await call('/api/patient/invitations/validate', 'POST', {
    token: secondInvitation.body.token,
  })).status, 410, 'convite consumido não pode reabrir a conta durante o ciclo de vida');
  assert.equal((await call(`/api/patients/${patient.body.patient.id}`, 'GET', undefined, otherToken)).status, 404,
    'o contexto do segundo workspace não consulta o prontuário do primeiro');
  assert.equal((await call(`/api/workspaces/${firstWorkspaceId}/roles`, 'GET', undefined, otherToken)).status, 404,
    'membership no segundo workspace não autoriza consultar papéis do primeiro');

  workspaceByToken.set(token, firstWorkspaceId);
  const activePatientView = await call(`/api/patients/${secondPatient.body.patient.id}`, 'GET', undefined, token);
  assert.equal(activePatientView.body.portal.status, 'active');
  const pendingReset = secondPatientReset;
  const suspendPortal = await call(portalAccessPath, 'PATCH', { status: 'suspended' }, token);
  assert.equal(suspendPortal.status, 200);
  assert.equal(suspendPortal.body.portal.status, 'suspended');
  assert.equal((await call('/api/patient/me', 'GET', undefined, secondPatientToken, 'nt_patient_session')).status, 401,
    'sessão criada antes da suspensão deixa de funcionar imediatamente');
  assert.equal((await call('/api/patient/login', 'POST', {
    email: 'paciente-isolado@example.test', password: 'senha-paciente-isolado-456',
  })).status, 401, 'login é negado enquanto o portal está suspenso');
  assert.equal((await call('/api/patient/password-resets/validate', 'POST', {
    token: pendingReset.body.token,
  })).status, 410, 'suspensão invalida links de redefinição pendentes');
  assert.equal((await call(`/api/patients/${secondPatient.body.patient.id}/password-resets`, 'POST', {}, token)).status, 409,
    'não é possível emitir redefinição enquanto o portal está suspenso');
  assert.equal((await call(`/api/patients/${secondPatient.body.patient.id}/invitations`, 'POST', {}, token)).status, 409,
    'suspensão não cria um novo convite para uma conta já existente');
  assert.equal((await call('/api/patient/invitations/validate', 'POST', {
    token: expiringPatientInvite.body.token,
  })).status, 200, 'convite pendente de outro paciente permanece disponível');
  const suspendedPatientView = await call(`/api/patients/${secondPatient.body.patient.id}`, 'GET', undefined, token);
  assert.equal(suspendedPatientView.body.portal.status, 'suspended');
  assert.equal(suspendedPatientView.body.assessments.length, 1,
    'suspender o portal preserva os registros clínicos do paciente');

  const firstPatientLoginDuringSuspension = await call('/api/patient/login', 'POST', {
    email: 'paciente@example.test', password: 'senha-paciente-nova-456',
  });
  assert.equal(firstPatientLoginDuringSuspension.status, 200,
    'suspender uma conta não afeta o portal de outro paciente');
  const firstPatientTokenDuringSuspension = firstPatientLoginDuringSuspension.cookie.match(/nt_patient_session=([^;]+)/)[1];
  assert.equal((await call('/api/patient/me', 'GET', undefined, firstPatientTokenDuringSuspension,
    'nt_patient_session')).status, 200);

  const reactivatePortal = await call(portalAccessPath, 'PATCH', { status: 'active' }, token);
  assert.equal(reactivatePortal.status, 200);
  assert.equal(reactivatePortal.body.portal.status, 'active');
  assert.equal((await call('/api/patient/me', 'GET', undefined, secondPatientToken, 'nt_patient_session')).status, 401,
    'reativação não restaura a sessão anterior');
  const reactivatedPatientLogin = await call('/api/patient/login', 'POST', {
    email: 'paciente-isolado@example.test', password: 'senha-paciente-isolado-456',
  });
  assert.equal(reactivatedPatientLogin.status, 200,
    'a conta suspensa pode ser reativada pelo profissional vinculado');
  const reactivatedPatientToken = reactivatedPatientLogin.cookie.match(/nt_patient_session=([^;]+)/)[1];

  const revokePortal = await call(portalAccessPath, 'PATCH', { status: 'revoked' }, token);
  assert.equal(revokePortal.status, 200);
  assert.equal(revokePortal.body.portal.status, 'revoked');
  assert.equal((await call('/api/patient/me', 'GET', undefined, reactivatedPatientToken, 'nt_patient_session')).status, 401,
    'revogação encerra também sessões criadas após a reativação');
  assert.equal((await call('/api/patient/login', 'POST', {
    email: 'paciente-isolado@example.test', password: 'senha-paciente-isolado-456',
  })).status, 401, 'login é negado após revogação');
  assert.equal((await call(portalAccessPath, 'PATCH', { status: 'active' }, token)).status, 409,
    'estado revogado é terminal');
  const revokedPatientView = await call(`/api/patients/${secondPatient.body.patient.id}`, 'GET', undefined, token);
  assert.equal(revokedPatientView.body.portal.status, 'revoked');
  assert.equal(revokedPatientView.body.assessments.length, 1,
    'revogar o portal preserva os registros clínicos');
  assert.equal((await call('/api/patient/me', 'GET', undefined, firstPatientTokenDuringSuspension,
    'nt_patient_session')).status, 200,
  'revogar uma conta não afeta a sessão de outro paciente');

  workspaceByToken.set(otherToken, firstWorkspaceId);
  assert.equal((await call(`/api/patients/${patient.body.patient.id}`, 'GET', undefined, otherToken)).status, 200,
    'a sessão existente continua acessando o workspace A antes da remoção');
  assert.equal((await call(`${memberListPath}/${providerMembership.id}`, 'DELETE', undefined, isolatedToken)).status, 404,
    'administradora de outro workspace não pode remover membership do workspace A');
  assert.equal((await call(`/api/patients/${patient.body.patient.id}`, 'GET', undefined, otherToken)).status, 200,
    'tentativa de remoção cross-workspace não alterou o acesso legítimo');

  const removal = await call(`${memberListPath}/${providerMembership.id}`, 'DELETE', undefined, token);
  assert.equal(removal.status, 200, 'proprietária remove o membership do workspace A');
  assert.equal((await call(`/api/patients/${patient.body.patient.id}`, 'GET', undefined, otherToken)).status, 403,
    'a mesma sessão perde acesso ao workspace A na requisição seguinte');
  const membershipsAfterRemoval = await call('/api/workspaces', 'GET', undefined, otherToken);
  assert.deepEqual(membershipsAfterRemoval.body.workspaces.map((item) => item.id),
    [isolatedWorkspace.body.workspace.id],
    'a remoção do membership A preserva o membership B da identidade');
  const ownerPatientAfterRemoval = await call(`/api/patients/${patient.body.patient.id}`, 'GET', undefined, token);
  assert.ok(ownerPatientAfterRemoval.body.assignments.every((assignment) =>
    assignment.professionalId !== other.body.user.id),
  'revogar membership encerra as atribuições desse profissional sem transferir o prontuário');
  workspaceByToken.set(otherToken, isolatedWorkspace.body.workspace.id);
  assert.equal((await call('/api/dashboard', 'GET', undefined, otherToken)).status, 200,
    'a mesma sessão continua acessando o workspace B após a remoção em A');
  assert.deepEqual((await call('/api/patients', 'GET', undefined, otherToken)).body.patients, [],
    'a identidade mantém acesso de leitura administrativa restrita ao workspace B');
  const cliniciansAfterRemoval = await call('/api/clinicians', 'GET', undefined, isolatedToken);
  assert.equal(cliniciansAfterRemoval.status, 200);
  assert.deepEqual(cliniciansAfterRemoval.body.clinicians.map((item) => item.id), [other.body.user.id],
    'a identidade removida de A continua nutricionista ativa em B');

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
  const expiredPatientInvitation = syntheticStore.patientInvitations.find(
    (entry) => entry.patientId === expiringPatient.body.patient.id && !entry.usedAt,
  );
  assert.ok(expiredPatientInvitation, 'convite de portal sintético deve existir para o cenário de expiração');
  expiredPatientInvitation.expiresAt = new Date(Date.now() - 1000).toISOString();
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

  await stopServer(child);
  const restartedPort = await freePort();
  child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT: String(restartedPort), DATA_DIR: dir, NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  base = `http://127.0.0.1:${restartedPort}`;
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
  assert.equal((await call('/api/patient/invitations/validate', 'POST', {
    token: expiringPatientInvite.body.token,
  })).status, 410, 'convite expirado do portal não pode ser validado');
  assert.equal((await call('/api/patient/activate', 'POST', {
    token: expiringPatientInvite.body.token,
    email: 'paciente-expirado@example.test',
    password: 'senha-paciente-expirado-123',
  })).status, 410, 'convite expirado do portal não pode ativar uma conta');
  const legacyPreview = await call('/api/workspaces/legacy-preview', 'GET', undefined, restartedToken);
  assert.equal(legacyPreview.status, 200);
  assert.equal(legacyPreview.body.hasLegacyRecords, true);
  assert.equal(legacyPreview.body.patients.length, 3);
  const migration = await call('/api/workspaces/migrate-personal', 'POST', {
    name: 'Consultório Migrado',
    clinician: true,
    primaryPatientIds: [patient.body.patient.id],
  }, restartedToken);
  assert.equal(migration.status, 201);
  assert.ok(migration.body.backup);
  await fs.access(path.join(dir, 'backups', migration.body.backup));
  workspaceByToken.set(restartedToken, migration.body.workspace.id);
  assert.equal((await call('/api/patients', 'GET', undefined, restartedToken)).body.patients.length, 3);
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
  base = `http://127.0.0.1:${expiryPort}`;
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
