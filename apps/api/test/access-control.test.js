const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  activeMembership,
  canAccessClinical,
  hasPermission,
  workspaceMemberships,
} = require('../src/access-control');

test('papéis não concedem acesso clínico sem capacidade e atribuição explícita', () => {
  const store = {
    workspaces: [{ id: 'w1', name: 'Clínica fictícia', type: 'clinic' }],
    memberships: [
      { id: 'm1', userId: 'owner', workspaceId: 'w1', status: 'active', roles: ['owner_admin'] },
      { id: 'm2', userId: 'assistant', workspaceId: 'w1', status: 'active', roles: ['assistant'] },
      { id: 'm3', userId: 'dietitian', workspaceId: 'w1', status: 'active', roles: ['clinician'] },
    ],
    patientAssignments: [
      {
        patientId: 'p1',
        professionalId: 'dietitian',
        workspaceId: 'w1',
        status: 'active',
        kind: 'primary',
      },
    ],
  };
  const owner = activeMembership(store, 'owner', 'w1');
  const assistant = activeMembership(store, 'assistant', 'w1');
  const clinician = activeMembership(store, 'dietitian', 'w1');

  assert.equal(hasPermission(store, owner, 'patients.manage'), true);
  assert.equal(hasPermission(store, owner, 'clinical.read'), false);
  assert.equal(hasPermission(store, assistant, 'patients.read_admin'), true);
  assert.equal(hasPermission(store, assistant, 'clinical.read'), false);
  assert.equal(canAccessClinical(store, clinician, 'p1', 'clinical.read'), true);
  assert.equal(canAccessClinical(store, clinician, 'p2', 'clinical.read'), false);
  assert.deepEqual(workspaceMemberships(store, 'dietitian'), [
    { id: 'w1', name: 'Clínica fictícia', type: 'clinic', roles: ['clinician'] },
  ]);
});

test('membership encerrado ou workspace adulterado não autoriza operação', () => {
  const store = {
    workspaces: [{ id: 'w1', name: 'Clínica fictícia', type: 'clinic' }],
    memberships: [
      { userId: 'dietitian', workspaceId: 'w1', status: 'revoked', roles: ['clinician'] },
    ],
    patientAssignments: [
      { patientId: 'p1', professionalId: 'dietitian', workspaceId: 'w1', status: 'active' },
    ],
  };
  assert.equal(activeMembership(store, 'dietitian', 'w1'), null);
  assert.deepEqual(workspaceMemberships(store, 'dietitian'), []);
});
