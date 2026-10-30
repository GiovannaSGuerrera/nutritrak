'use strict';

const ROLE_DEFINITIONS = Object.freeze({
  owner_admin: Object.freeze({
    name: 'Proprietário administrativo',
    permissions: Object.freeze([
      'workspace.manage',
      'members.manage',
      'patients.manage',
      'patients.assign',
      'patients.read_admin',
      'agenda.manage',
    ]),
  }),
  operations_admin: Object.freeze({
    name: 'Administrador operacional',
    permissions: Object.freeze([
      'members.manage',
      'patients.manage',
      'patients.assign',
      'patients.read_admin',
      'agenda.manage',
    ]),
  }),
  assistant: Object.freeze({
    name: 'Assistente',
    permissions: Object.freeze(['patients.manage', 'patients.read_admin', 'agenda.manage']),
  }),
  clinician: Object.freeze({
    name: 'Nutricionista',
    permissions: Object.freeze([
      'patients.create',
      'clinical.read',
      'clinical.write',
      'appointments.manage',
    ]),
  }),
});

function activeMembership(store, userId, workspaceId) {
  return (
    store.memberships?.find(
      (membership) =>
        membership.userId === userId &&
        membership.workspaceId === workspaceId &&
        membership.status === 'active',
    ) || null
  );
}

function hasPermission(store, membership, permission) {
  if (!membership || membership.status !== 'active') return false;
  return (membership.roles || []).some((roleKey) =>
    ROLE_DEFINITIONS[roleKey]?.permissions.includes(permission),
  );
}

function assignmentFor(store, patientId, userId, workspaceId) {
  return (
    store.patientAssignments?.find(
      (assignment) =>
        assignment.patientId === patientId &&
        assignment.professionalId === userId &&
        assignment.workspaceId === workspaceId &&
        assignment.status === 'active',
    ) || null
  );
}

function canAccessClinical(store, membership, patientId, permission) {
  return (
    hasPermission(store, membership, permission) &&
    !!assignmentFor(store, patientId, membership.userId, membership.workspaceId)
  );
}

function workspaceMemberships(store, userId) {
  return (store.memberships || [])
    .filter((membership) => membership.userId === userId && membership.status === 'active')
    .map((membership) => {
      const workspace = store.workspaces.find((item) => item.id === membership.workspaceId);
      return workspace
        ? {
            id: workspace.id,
            name: workspace.name,
            type: workspace.type,
            roles: membership.roles.filter((role) => ROLE_DEFINITIONS[role]),
          }
        : null;
    })
    .filter(Boolean);
}

module.exports = {
  ROLE_DEFINITIONS,
  activeMembership,
  assignmentFor,
  canAccessClinical,
  hasPermission,
  workspaceMemberships,
};
