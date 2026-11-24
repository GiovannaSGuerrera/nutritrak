const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const {
  ROLE_DEFINITIONS,
  activeMembership,
  canAccessClinical,
  hasPermission,
  workspaceMemberships,
} = require('./access-control');
const scrypt = promisify(crypto.scrypt);
const { Persistence } = require('./persistence');
const { accountRoutes, issueToken } = require('./account-security');
const sqliteEnabled = process.env.STORE_BACKEND === 'sqlite';
let database;
if (
  process.env.NODE_ENV === 'production' &&
  (!sqliteEnabled || !process.env.CORS_ORIGINS || !process.env.PUBLIC_ORIGIN)
) {
  throw new Error('Production requires STORE_BACKEND=sqlite, CORS_ORIGINS and PUBLIC_ORIGIN');
}
if (process.env.NODE_ENV === 'production') {
  if (
    new URL(process.env.PUBLIC_ORIGIN).protocol !== 'https:' ||
    process.env.CORS_ORIGINS.split(',').some(
      (origin) => new URL(origin.trim()).protocol !== 'https:',
    )
  )
    throw new Error('Production origins must use HTTPS');
  if (!/^[a-f\d]{64}$/i.test(process.env.MAIL_ENCRYPTION_KEY || ''))
    throw new Error('Production requires MAIL_ENCRYPTION_KEY');
}
class SessionMap extends Map {
  get(token) {
    return super.get(tokenHash(token));
  }
  set(token, value) {
    return super.set(tokenHash(token), value);
  }
  delete(token) {
    return super.delete(token) || super.delete(tokenHash(token));
  }
}

const ROOT = path.resolve(__dirname, '../../..');
const PUBLIC_DIR = path.resolve(__dirname, '../../web/public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const STORE = path.join(DATA_DIR, 'store.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const RATE_WINDOW_MS = 15 * 60 * 1000;
const rateLimits = new Map();
// Clinic administration remains implemented but is disabled in the published individual experience.
const CLINIC_ADMIN_ENABLED =
  process.env.NUTRITRACK_CLINIC_ADMIN_ENABLED === 'true' ||
  (process.env.NODE_ENV !== 'production' &&
    process.env.NUTRITRACK_CLINIC_ADMIN_ENABLED !== 'false');
// Keep server validation aligned with the existing cookie lifetime. The
// override is useful for deterministic local tests; production defaults to 8h.
const SESSION_MAX_AGE_SECONDS = Math.max(
  1,
  Number(process.env.NUTRITRACK_SESSION_MAX_AGE_SECONDS) || 28800,
);
const sessions = new SessionMap();
const patientSessions = new SessionMap();
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
let store = {
  users: [],
  authTokens: [],
  mailOutbox: [],
  privacyRequests: [],
  patients: [],
  assessments: [],
  appointments: [],
  goals: [],
  mealPlans: [],
  patientInvitations: [],
  patientPasswordResets: [],
  patientAccounts: [],
  workspaces: [],
  memberships: [],
  patientAssignments: [],
  workspaceInvitations: [],
  audit: [],
};
let writeQueue = Promise.resolve();

async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  if (sqliteEnabled) {
    database = new Persistence(DATA_DIR);
    store = database.load(store, { workspaceId: '', userId: '' });
    database.restoreSessions(sessions, patientSessions);
    return;
  }
  try {
    store = JSON.parse(await fs.readFile(STORE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    await persist();
  }
  for (const key of [
    'users',
    'authTokens',
    'mailOutbox',
    'privacyRequests',
    'patients',
    'assessments',
    'appointments',
    'goals',
    'mealPlans',
    'patientInvitations',
    'patientPasswordResets',
    'patientAccounts',
    'workspaces',
    'memberships',
    'patientAssignments',
    'workspaceInvitations',
    'audit',
  ]) {
    // Older stores may omit a collection, but a present non-array value is
    // corruption: silently replacing it would discard data on the next write.
    if (store[key] === undefined) store[key] = [];
    else if (!Array.isArray(store[key]))
      throw new Error(`Invalid store format: ${key} must be an array`);
  }
}
function persist() {
  if (database) return Promise.resolve();
  // Capture a consistent point-in-time snapshot before queueing. A failed
  // write rejects its caller but must not permanently poison later writes.
  const snapshot = JSON.stringify(store, null, 2);
  const write = writeQueue.then(async () => {
    const temp = `${STORE}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, snapshot, { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, STORE);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  });
  writeQueue = write.catch(() => {});
  return write;
}
function json(res, status, body) {
  if (status === 200 && res.requestUrl) {
    const url = new URL(res.requestUrl, 'http://localhost');
    const collections = {
      '/api/patients': 'patients',
      '/api/assessments': 'assessments',
      '/api/appointments': 'appointments',
      '/api/meal-plans': 'mealPlans',
      '/api/goals': 'goals',
    };
    const collection = collections[url.pathname];
    if (collection && Array.isArray(body[collection])) {
      const limit = Number(url.searchParams.get('limit') || 200),
        offset = Number(url.searchParams.get('offset') || 0);
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 200 ||
        !Number.isInteger(offset) ||
        offset < 0
      ) {
        status = 400;
        body = { error: 'Paginação inválida.' };
      } else {
        const rows = body[collection];
        body = {
          ...body,
          [collection]: rows.slice(offset, offset + limit),
          page: {
            collection,
            total: rows.length,
            nextOffset: offset + limit < rows.length ? offset + limit : null,
          },
        };
      }
    }
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...(process.env.NODE_ENV === 'production'
      ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' }
      : {}),
  });
  res.end(JSON.stringify(body));
}
async function body(req) {
  if (req.parsedBody !== undefined) return req.parsedBody;
  let raw = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    raw += chunk;
    if (bytes > 1_000_000) throw Object.assign(new Error('Corpo muito grande'), { status: 413 });
  }
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Object required');
    return parsed;
  } catch {
    throw Object.assign(new Error('JSON inválido'), { status: 400 });
  }
}
function cookie(req, name) {
  return (req.headers.cookie || '')
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + '='))
    ?.slice(name.length + 1);
}
function userFor(req) {
  const token = cookie(req, 'nc_session');
  const id = token && sessionSubject(sessions, token);
  return store.users.find((u) => u.id === id) || null;
}
function patientAccountFor(req) {
  const token = cookie(req, 'nt_patient_session');
  const id = token && sessionSubject(patientSessions, token);
  const account = store.patientAccounts.find((a) => a.id === id) || null;
  return portalAccessStatus(account) === 'active' ? account : null;
}
function portalAccessStatus(account) {
  return account?.portalStatus || 'active';
}
function patientAccountForPatient(patient, workspaceId = patient.workspaceId) {
  return (
    store.patientAccounts.find(
      (account) =>
        account.patientId === patient.id &&
        (account.workspaceId
          ? account.workspaceId === workspaceId
          : account.professionalId === patient.userId),
    ) || null
  );
}
function sessionSubject(sessionStore, token) {
  const session = sessionStore.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessionStore.delete(token);
    return null;
  }
  return session.subjectId;
}
function setSessionCookie(res, name, token, maxAge) {
  res.setHeader(
    'set-cookie',
    `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
}
function rateLimit(req, key, maximum = 10) {
  const now = Date.now();
  let address = req.socket.remoteAddress || 'unknown';
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '')
      .split(',')
      .at(-1)
      .trim();
    if (require('node:net').isIP(forwarded)) address = forwarded;
  }
  const identity = `${key}:${address}`;
  if (database) {
    const retryAfter = database.limit(tokenHash(identity), maximum, RATE_WINDOW_MS);
    return retryAfter
      ? Object.assign(new Error('Muitas tentativas. Tente novamente mais tarde.'), {
          status: 429,
          retryAfter,
        })
      : null;
  }
  const current = rateLimits.get(identity);
  if (!current || current.resetAt <= now) {
    if (rateLimits.size > 10000)
      for (const [key, value] of rateLimits) if (value.resetAt <= now) rateLimits.delete(key);
    if (rateLimits.size >= 10000)
      return Object.assign(new Error('Tente novamente mais tarde.'), { status: 429 });
    rateLimits.set(identity, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }
  current.count += 1;
  if (current.count > maximum) {
    const error = Object.assign(new Error('Muitas tentativas. Tente novamente mais tarde.'), {
      status: 429,
      retryAfter: Math.ceil((current.resetAt - now) / 1000),
    });
    return error;
  }
  return null;
}
function enforceRequestPolicy(req) {
  const origin = req.headers.origin;
  const allowed = (process.env.CORS_ORIGINS || process.env.PUBLIC_ORIGIN || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (process.env.NODE_ENV === 'production' && mutation && (!origin || !allowed.includes(origin)))
    throw Object.assign(new Error('Origem não permitida'), { status: 403 });
  if (
    mutation &&
    req.headers['content-type'] &&
    !req.headers['content-type'].toLowerCase().startsWith('application/json')
  )
    throw Object.assign(new Error('Envie application/json.'), { status: 415 });
  if (mutation && process.env.NODE_ENV === 'production' && !req.headers['content-type'])
    throw Object.assign(new Error('Envie application/json.'), { status: 415 });
  if (new URL(req.url, 'http://localhost').pathname.startsWith('/api/')) {
    const limitError = rateLimit(req, 'api', 1000);
    if (limitError) throw limitError;
  }
  if (origin && allowed.length && !allowed.includes(origin))
    throw Object.assign(new Error('Origem não permitida'), { status: 403 });
  const sensitive =
    req.method === 'POST' &&
    [
      '/api/login',
      '/api/register',
      '/api/patient/login',
      '/api/patient/activate',
      '/api/patient/password-resets/complete',
      '/api/patient/password-resets/validate',
      '/api/patient/invitations/validate',
      '/api/auth/password-reset/request',
      '/api/auth/password-reset/complete',
      '/api/auth/verification/complete',
      '/api/auth/verification/request',
      '/api/account/password',
      '/api/account/mfa/setup',
      '/api/account/mfa/confirm',
      '/api/account/mfa/disable',
    ].includes(new URL(req.url, 'http://localhost').pathname);
  if (sensitive) {
    const error = rateLimit(req, new URL(req.url, 'http://localhost').pathname, 10);
    if (error) throw error;
  }
}
function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function safePatientPortal(account) {
  if (portalAccessStatus(account) !== 'active') return null;
  const patient = store.patients.find(
    (p) =>
      p.id === account.patientId &&
      (account.workspaceId
        ? p.workspaceId === account.workspaceId
        : p.userId === account.professionalId),
  );
  if (!patient || patient.status === 'Arquivado') return null;
  const professional = store.users.find((u) => u.id === account.professionalId);
  const mealPlans = store.mealPlans
    .filter(
      (p) =>
        p.patientId === patient.id &&
        (account.workspaceId
          ? p.workspaceId === account.workspaceId
          : p.userId === account.professionalId) &&
        p.publishedVersionId,
    )
    .map((p) => {
      const version = p.versions.find(
        (v) => v.id === p.publishedVersionId && v.status === 'published',
      );
      return version
        ? {
            id: p.id,
            name: p.name,
            version: {
              number: version.number,
              objective: version.objective,
              startDate: version.startDate,
              reviewDate: version.reviewDate,
              generalInstructions: version.generalInstructions,
              meals: version.meals.map((m) => ({
                name: m.name,
                time: m.time,
                instructions: m.instructions,
                items: m.items.map((i) => ({
                  food: i.food,
                  quantity: i.quantity,
                  unit: i.unit,
                  substitutions: i.substitutions,
                })),
              })),
              publishedAt: version.publishedAt,
            },
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.version.publishedAt || '').localeCompare(a.version.publishedAt || ''));
  return {
    patient: { name: patient.name },
    professional: { name: professional?.name || 'Sua equipe' },
    mealPlans,
  };
}
function safeUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: !!u.emailVerified,
    securityFeatures: true,
    mfaEnabled: !!u.mfaSecret,
  };
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function patientInputError(b) {
  if (
    b.email !== undefined &&
    (typeof b.email !== 'string' ||
      b.email.length > 254 ||
      (b.email && !/^\S+@\S+\.\S+$/.test(b.email)))
  )
    return 'E-mail inválido.';
  if (b.phone !== undefined && (typeof b.phone !== 'string' || b.phone.length > 40))
    return 'Telefone inválido.';
  if (b.birthDate !== undefined && b.birthDate !== '' && !validDate(b.birthDate))
    return 'Data de nascimento inválida.';
  for (const [field, limit] of [
    ['objective', 500],
    ['clinicalNotes', 5000],
  ])
    if (b[field] !== undefined && (typeof b[field] !== 'string' || b[field].length > limit))
      return 'Texto clínico inválido.';
  return null;
}
function validText(v, max = 5000) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}
function audit(userId, action, type, recordId, workspaceId = null) {
  store.audit.unshift({
    id: crypto.randomUUID(),
    userId,
    action,
    type,
    recordId,
    workspaceId,
    at: new Date().toISOString(),
  });
  const cutoff = Date.now() - Number(process.env.AUDIT_RETENTION_DAYS || 90) * 86400000;
  store.audit = store.audit.filter((event) => Date.parse(event.at) >= cutoff);
}
function createWorkspace(user, inputName, type = 'individual', roles = ['owner_admin']) {
  const workspace = {
    id: crypto.randomUUID(),
    name: String(inputName || `${user.name.split(/\s+/)[0]} — Consultório`)
      .trim()
      .slice(0, 120),
    type,
    createdAt: new Date().toISOString(),
    createdBy: user.id,
  };
  store.workspaces.push(workspace);
  store.memberships.push({
    id: crypto.randomUUID(),
    workspaceId: workspace.id,
    userId: user.id,
    roles,
    status: 'active',
    createdAt: new Date().toISOString(),
  });
  return workspace;
}
function workspaceContext(req, user) {
  const workspaceId = String(req.headers['x-workspace-id'] || '');
  const workspace = store.workspaces.find((item) => item.id === workspaceId);
  const membership = workspace && activeMembership(store, user.id, workspace.id);
  return workspace && membership ? { workspace, membership } : null;
}
function patientInWorkspace(patientId, workspaceId) {
  return store.patients.find(
    (patient) => patient.id === patientId && patient.workspaceId === workspaceId,
  );
}
function clinicianMembership(workspaceId, userId) {
  const membership = activeMembership(store, userId, workspaceId);
  return membership?.roles.includes('clinician') ? membership : null;
}
function patientAssignmentRecords(workspaceId, patientId, primaryId, supportIds = []) {
  const ids = new Set([...(primaryId ? [primaryId] : []), ...supportIds]);
  if ([...ids].some((id) => !clinicianMembership(workspaceId, id))) return null;
  const now = new Date().toISOString();
  return [
    ...(primaryId
      ? [
          {
            id: crypto.randomUUID(),
            workspaceId,
            patientId,
            professionalId: primaryId,
            kind: 'primary',
            status: 'active',
            assignedAt: now,
          },
        ]
      : []),
    ...supportIds.map((professionalId) => ({
      id: crypto.randomUUID(),
      workspaceId,
      patientId,
      professionalId,
      kind: 'support',
      status: 'active',
      assignedAt: now,
    })),
  ];
}
function hasClinicalAccess(userId, workspaceId, patientId, permission) {
  const membership = activeMembership(store, userId, workspaceId);
  return membership && canAccessClinical(store, membership, patientId, permission);
}
function canReadPatient(userId, workspaceId, patientId) {
  const membership = activeMembership(store, userId, workspaceId);
  return (
    (membership && hasPermission(store, membership, 'patients.read_admin')) ||
    !!hasClinicalAccess(userId, workspaceId, patientId, 'clinical.read')
  );
}
function patientAdminView(patient) {
  return Object.fromEntries(
    [
      'id',
      'userId',
      'workspaceId',
      'name',
      'email',
      'phone',
      'birthDate',
      'status',
      'createdAt',
      'updatedAt',
    ]
      .filter((key) => Object.hasOwn(patient, key))
      .map((key) => [key, patient[key]]),
  );
}
function patientClinicalAssignments(workspaceId, patientId) {
  return store.patientAssignments.filter(
    (assignment) =>
      assignment.workspaceId === workspaceId &&
      assignment.patientId === patientId &&
      assignment.status === 'active',
  );
}
function compareAssessmentsNewestFirst(a, b) {
  return (
    b.date.localeCompare(a.date) ||
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  );
}
function mealPlanVersion(input, number) {
  if (['startDate', 'reviewDate'].some((key) => input[key] && !validDate(input[key])))
    return { error: 'Data do plano inválida.' };
  if (!validText(input.name, 120)) return { error: 'Informe o nome do plano.' };
  if (!Array.isArray(input.meals) || input.meals.length > 12)
    return { error: 'O plano pode conter até 12 refeições.' };
  const meals = [];
  for (const meal of input.meals) {
    if (!validText(meal.name, 100)) return { error: 'Cada refeição precisa de um nome.' };
    if (!Array.isArray(meal.items) || meal.items.length > 40)
      return { error: 'Cada refeição pode conter até 40 itens.' };
    const items = [];
    for (const item of meal.items) {
      if (!validText(item.food, 180)) return { error: 'Informe o nome de cada alimento.' };
      const quantity = item.quantity === '' || item.quantity == null ? null : Number(item.quantity);
      if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000))
        return { error: 'A quantidade deve ser um número positivo.' };
      items.push({
        id: crypto.randomUUID(),
        food: item.food.trim(),
        quantity,
        unit: String(item.unit || '').slice(0, 40),
        instructions: String(item.instructions || '').slice(0, 500),
        substitutions: String(item.substitutions || '').slice(0, 500),
      });
    }
    meals.push({
      id: crypto.randomUUID(),
      name: meal.name.trim(),
      time: String(meal.time || '').slice(0, 5),
      instructions: String(meal.instructions || '').slice(0, 1000),
      items,
    });
  }
  return {
    version: {
      id: crypto.randomUUID(),
      number,
      status: 'draft',
      objective: String(input.objective || '').slice(0, 1000),
      startDate: String(input.startDate || ''),
      reviewDate: String(input.reviewDate || ''),
      generalInstructions: String(input.generalInstructions || '').slice(0, 5000),
      meals,
      createdAt: new Date().toISOString(),
    },
  };
}
function canPublish(version) {
  return (
    version.meals.length > 0 &&
    version.meals.every(
      (m) =>
        m.items.length > 0 && m.items.every((i) => i.quantity !== null && i.unit.trim().length > 0),
    )
  );
}
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && ['/api/legal/privacy', '/api/legal/terms'].includes(url.pathname))
    return json(res, 200, await require('./legal').readPolicy(url.pathname.split('/').at(-1)));
  if (req.method === 'GET' && url.pathname === '/api/me') {
    const u = userFor(req);
    return u
      ? json(res, 200, {
          user: safeUser(u),
          workspaces: workspaceMemberships(store, u.id).filter(
            (workspace) =>
              CLINIC_ADMIN_ENABLED ||
              (workspace.type !== 'clinic' && workspace.roles.includes('clinician')),
          ),
        })
      : json(res, 401, { error: 'Autenticação necessária' });
  }
  if (req.method === 'POST' && url.pathname === '/api/patient/invitations/validate') {
    const b = await body(req);
    const invite = store.patientInvitations.find(
      (i) => i.tokenHash === tokenHash(String(b.token || '')),
    );
    if (!invite || invite.usedAt || invite.revokedAt || Date.parse(invite.expiresAt) <= Date.now())
      return json(res, 410, {
        error: 'Este convite é inválido ou expirou. Peça um novo ao profissional.',
      });
    const patient = store.patients.find(
      (p) =>
        p.id === invite.patientId &&
        (invite.workspaceId
          ? p.workspaceId === invite.workspaceId
          : p.userId === invite.professionalId),
    );
    const professional = store.users.find((u) => u.id === invite.professionalId);
    if (!patient || patient.status === 'Arquivado')
      return json(res, 410, { error: 'Este convite não está mais disponível.' });
    if (patientAccountForPatient(patient, invite.workspaceId || patient.workspaceId))
      return json(res, 410, { error: 'Este convite não está mais disponível.' });
    return json(res, 200, {
      invitation: {
        patientName: patient.name,
        professionalName: professional?.name || 'NutriTrack',
      },
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/patient/activate') {
    const b = await body(req);
    const invite = store.patientInvitations.find(
      (i) => i.tokenHash === tokenHash(String(b.token || '')),
    );
    const email = String(b.email || '')
      .trim()
      .toLowerCase();
    if (!invite || invite.usedAt || invite.revokedAt || Date.parse(invite.expiresAt) <= Date.now())
      return json(res, 410, {
        error: 'Este convite é inválido ou expirou. Peça um novo ao profissional.',
      });
    const patient = store.patients.find(
      (p) =>
        p.id === invite.patientId &&
        (invite.workspaceId
          ? p.workspaceId === invite.workspaceId
          : p.userId === invite.professionalId),
    );
    if (!patient || patient.status === 'Arquivado')
      return json(res, 410, { error: 'Este convite não está mais disponível.' });
    if (
      email.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      typeof b.password !== 'string' ||
      b.password.length < 12 ||
      b.password.length > 200
    )
      return json(res, 400, {
        error: 'Informe um e-mail válido e uma senha com pelo menos 12 caracteres.',
      });
    if (!patient.email)
      return json(res, 400, {
        error: 'Peça ao profissional para cadastrar seu e-mail antes de ativar o convite.',
      });
    if (patient.email.trim().toLowerCase() !== email)
      return json(res, 400, {
        error: 'Use o e-mail informado pelo profissional para este convite.',
      });
    if (patientAccountForPatient(patient, invite.workspaceId || patient.workspaceId))
      return json(res, 409, { error: 'Este paciente já tem acesso ao portal.' });
    if (
      store.patientAccounts.some((a) => a.email === email) ||
      store.users.some((u) => u.email === email)
    )
      return json(res, 409, {
        error:
          'Já existe uma conta com esse e-mail. Entre no portal ou peça ajuda ao profissional.',
      });
    invite.usedAt = new Date().toISOString();
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await scrypt(b.password, salt, 64);
    const account = {
      id: crypto.randomUUID(),
      patientId: patient.id,
      professionalId: patient.userId,
      workspaceId: invite.workspaceId || patient.workspaceId || null,
      portalStatus: 'active',
      email,
      salt,
      hash: hash.toString('hex'),
      createdAt: new Date().toISOString(),
    };
    if (patient.status === 'Arquivado') {
      invite.usedAt = null;
      return json(res, 410, { error: 'Este convite não está mais disponível.' });
    }
    if (patient.email.trim().toLowerCase() !== email) {
      invite.usedAt = null;
      return json(res, 400, {
        error: 'Use o e-mail informado pelo profissional para este convite.',
      });
    }
    if (store.patientAccounts.some((a) => a.patientId === patient.id)) {
      invite.usedAt = null;
      return json(res, 409, { error: 'Este paciente já tem acesso ao portal.' });
    }
    store.patientAccounts.push(account);
    patient.updatedAt = new Date().toISOString();
    audit(patient.userId, 'patient_portal_activated', 'patient', patient.id);
    await persist();
    const session = crypto.randomBytes(32).toString('hex');
    patientSessions.set(session, {
      subjectId: account.id,
      expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    });
    setSessionCookie(res, 'nt_patient_session', session, SESSION_MAX_AGE_SECONDS);
    return json(res, 201, { portal: safePatientPortal(account) });
  }
  if (req.method === 'POST' && url.pathname === '/api/patient/login') {
    const b = await body(req);
    const email = String(b.email || '')
      .trim()
      .toLowerCase();
    const account = store.patientAccounts.find((a) => a.email === email);
    if (
      !account ||
      typeof b.password !== 'string' ||
      b.password.length > 200 ||
      !(await scrypt(b.password, account.salt, 64)).equals(Buffer.from(account.hash, 'hex'))
    )
      return json(res, 401, { error: 'E-mail ou senha incorretos.' });
    if (portalAccessStatus(account) !== 'active')
      return json(res, 401, { error: 'E-mail ou senha incorretos.' });
    const portal = safePatientPortal(account);
    if (!portal)
      return json(res, 403, {
        error: 'Acesso ao portal indisponível. Entre em contato com o profissional.',
      });
    const session = crypto.randomBytes(32).toString('hex');
    patientSessions.set(session, {
      subjectId: account.id,
      expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    });
    setSessionCookie(res, 'nt_patient_session', session, SESSION_MAX_AGE_SECONDS);
    return json(res, 200, { portal });
  }
  if (req.method === 'POST' && url.pathname === '/api/patient/password-resets/validate') {
    const b = await body(req);
    const reset = store.patientPasswordResets.find(
      (r) => r.tokenHash === tokenHash(String(b.token || '')),
    );
    if (!reset || reset.usedAt || reset.revokedAt || Date.parse(reset.expiresAt) <= Date.now())
      return json(res, 410, {
        error: 'Este link é inválido ou expirou. Peça um novo ao profissional.',
      });
    const account = store.patientAccounts.find(
      (a) => a.id === reset.accountId && a.patientId === reset.patientId,
    );
    if (!account || portalAccessStatus(account) !== 'active')
      return json(res, 410, {
        error: 'Este acesso não está mais disponível. Entre em contato com o profissional.',
      });
    const patient = store.patients.find(
      (p) =>
        p.id === account.patientId &&
        (account.workspaceId
          ? p.workspaceId === account.workspaceId
          : p.userId === account.professionalId),
    );
    return json(res, 200, { reset: { patientName: patient?.name || 'Paciente' } });
  }
  if (req.method === 'POST' && url.pathname === '/api/patient/password-resets/complete') {
    const b = await body(req);
    const reset = store.patientPasswordResets.find(
      (r) => r.tokenHash === tokenHash(String(b.token || '')),
    );
    if (!reset || reset.usedAt || reset.revokedAt || Date.parse(reset.expiresAt) <= Date.now())
      return json(res, 410, {
        error: 'Este link é inválido ou expirou. Peça um novo ao profissional.',
      });
    if (typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 200)
      return json(res, 400, { error: 'A nova senha precisa ter pelo menos 12 caracteres.' });
    const account = store.patientAccounts.find(
      (a) => a.id === reset.accountId && a.patientId === reset.patientId,
    );
    if (!account || portalAccessStatus(account) !== 'active')
      return json(res, 410, {
        error: 'Este acesso não está mais disponível. Entre em contato com o profissional.',
      });
    reset.usedAt = new Date().toISOString();
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await scrypt(b.password, salt, 64);
    account.salt = salt;
    account.hash = hash.toString('hex');
    account.passwordUpdatedAt = new Date().toISOString();
    for (const [session, value] of patientSessions) {
      if (value.subjectId === account.id) patientSessions.delete(session);
    }
    reset.usedAt = new Date().toISOString();
    for (const [session, value] of patientSessions)
      if (value.subjectId === account.id) patientSessions.delete(session);
    audit(account.professionalId, 'patient_portal_password_reset', 'patient', account.patientId);
    await persist();
    setSessionCookie(res, 'nt_patient_session', '', 0);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/patient/logout') {
    const session = cookie(req, 'nt_patient_session');
    if (session) patientSessions.delete(session);
    setSessionCookie(res, 'nt_patient_session', '', 0);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/patient/export') {
    const account = patientAccountFor(req),
      portal = account && safePatientPortal(account);
    if (!portal) return json(res, 401, { error: 'Entre no portal do paciente.' });
    audit(
      account.professionalId,
      'portal_data_exported',
      'patient',
      account.patientId,
      account.workspaceId,
    );
    await persist();
    return json(res, 200, {
      exportedAt: new Date().toISOString(),
      account: { email: account.email, createdAt: account.createdAt },
      portal,
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/patient/me') {
    const account = patientAccountFor(req);
    if (!account) return json(res, 401, { error: 'Entre no portal do paciente.' });
    const portal = safePatientPortal(account);
    return portal
      ? json(res, 200, { portal })
      : json(res, 403, {
          error: 'Acesso ao portal indisponível. Entre em contato com o profissional.',
        });
  }
  if (req.method === 'POST' && url.pathname === '/api/register') {
    const b = await body(req);
    const email = String(b.email || '')
      .trim()
      .toLowerCase();
    const profileType = b.profileType == null ? null : String(b.profileType);
    if (!CLINIC_ADMIN_ENABLED && profileType === 'clinic')
      return json(res, 404, { error: 'Este tipo de perfil não está disponível nesta versão.' });
    if (
      !validText(b.name, 120) ||
      email.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      typeof b.password !== 'string' ||
      b.password.length < 12 ||
      b.password.length > 200 ||
      (profileType !== null && !['nutritionist', 'clinic'].includes(profileType)) ||
      (profileType === 'clinic' && !validText(b.workspaceName, 120))
    )
      return json(res, 400, {
        error: 'Informe nome, e-mail válido e senha com pelo menos 12 caracteres.',
      });
    if (
      store.users.some((u) => u.email === email) ||
      store.patientAccounts.some((a) => a.email === email)
    ) {
      if (process.env.NODE_ENV === 'production') {
        const existing = store.users.find((u) => u.email === email);
        if (existing && !existing.emailVerified) {
          issueToken(store, existing, 'verify');
          await persist();
        }
        return json(res, 202, {
          verificationRequired: true,
          message: 'Se o endereço puder ser utilizado, enviaremos as instruções.',
        });
      }
      return json(res, 409, { error: 'Não foi possível criar a conta.' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await scrypt(b.password, salt, 64);
    if (
      store.users.some((u) => u.email === email) ||
      store.patientAccounts.some((a) => a.email === email)
    )
      return json(res, 409, { error: 'Não foi possível criar a conta.' });
    const u = {
      id: crypto.randomUUID(),
      name: b.name.trim(),
      email,
      salt,
      hash: hash.toString('hex'),
      createdAt: new Date().toISOString(),
    };
    store.users.push(u);
    issueToken(store, u, 'verify');
    let workspace = null;
    if (profileType === 'nutritionist') {
      workspace = createWorkspace(
        u,
        String(b.workspaceName || `${u.name.split(/\s+/)[0]} — Consultório`),
        'individual',
        ['owner_admin', 'clinician'],
      );
    } else if (profileType === 'clinic') {
      workspace = createWorkspace(
        u,
        b.workspaceName,
        'clinic',
        b.clinician === true ? ['owner_admin', 'clinician'] : ['owner_admin'],
      );
    }
    audit(u.id, 'account_created', 'user', u.id);
    if (workspace) audit(u.id, 'workspace_created', 'workspace', workspace.id, workspace.id);
    await persist();
    if (process.env.NODE_ENV === 'production')
      return json(res, 202, {
        verificationRequired: true,
        message: 'Se o endereço puder ser utilizado, enviaremos as instruções.',
      });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
      subjectId: u.id,
      expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    });
    setSessionCookie(res, 'nc_session', token, SESSION_MAX_AGE_SECONDS);
    return json(res, 201, { user: safeUser(u), ...(workspace ? { workspace } : {}) });
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const b = await body(req);
    const email = String(b.email || '')
      .trim()
      .toLowerCase();
    const u = store.users.find((x) => x.email === email);
    if (
      !u ||
      typeof b.password !== 'string' ||
      b.password.length > 200 ||
      !(await scrypt(b.password, u.salt, 64)).equals(Buffer.from(u.hash, 'hex'))
    )
      return json(res, 401, { error: 'E-mail ou senha incorretos.' });
    if (!require('./totp').checkSecondFactor(u, b))
      return json(res, 401, { error: 'Informe um código de segundo fator válido.' });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
      subjectId: u.id,
      expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    });
    setSessionCookie(res, 'nc_session', token, SESSION_MAX_AGE_SECONDS);
    return json(res, 200, { user: safeUser(u) });
  }
  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const token = cookie(req, 'nc_session');
    if (token) sessions.delete(token);
    res.setHeader('set-cookie', 'nc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  if (
    await accountRoutes({
      req,
      res,
      store,
      sessions,
      user: userFor(req),
      body,
      json,
      persist,
      audit,
    })
  )
    return;
  if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
  const u = userFor(req);
  if (!u) return json(res, 401, { error: 'Autenticação necessária' });
  if (process.env.NODE_ENV === 'production' && !u.emailVerified)
    return json(res, 403, { error: 'Confirme seu e-mail para continuar.' });
  const uid = u.id;
  const clinicAdminEndpoint =
    url.pathname === '/api/clinicians' ||
    url.pathname.startsWith('/api/workspace-invitations') ||
    /^\/api\/workspaces\/[^/]+\/(members|invitations|roles)(\/|$)/.test(url.pathname) ||
    (req.method === 'PATCH' && /^\/api\/workspaces\/[^/]+$/.test(url.pathname));
  if (!CLINIC_ADMIN_ENABLED && clinicAdminEndpoint)
    return json(res, 404, { error: 'Esta funcionalidade não está disponível nesta versão.' });
  if (req.method === 'GET' && url.pathname === '/api/workspaces/legacy-preview') {
    const patients = store.patients
      .filter((patient) => patient.userId === uid && !patient.workspaceId)
      .map((patient) => ({ id: patient.id, name: patient.name }));
    const legacyCollections = ['patients', 'assessments', 'appointments', 'goals', 'mealPlans'];
    const hasLegacyRecords = legacyCollections.some((collection) =>
      store[collection].some((record) => record.userId === uid && !record.workspaceId),
    );
    return json(res, 200, { patients, count: patients.length, hasLegacyRecords });
  }
  if (req.method === 'POST' && url.pathname === '/api/workspaces/migrate-personal') {
    const b = await body(req);
    const name = String(b.name || '').trim();
    const legacyPatients = store.patients.filter(
      (patient) => patient.userId === uid && !patient.workspaceId,
    );
    const primaryIds = Array.isArray(b.primaryPatientIds)
      ? [...new Set(b.primaryPatientIds.map(String))]
      : [];
    const legacyCollections = ['patients', 'assessments', 'appointments', 'goals', 'mealPlans'];
    const hasLegacyRecords = legacyCollections.some((collection) =>
      store[collection].some((record) => record.userId === uid && !record.workspaceId),
    );
    if (
      !hasLegacyRecords &&
      store.memberships.some((entry) => entry.userId === uid && entry.status === 'active')
    )
      return json(res, 409, { error: 'Não há dados antigos sem workspace para organizar.' });
    if (
      !validText(name, 120) ||
      primaryIds.some((patientId) => !legacyPatients.some((patient) => patient.id === patientId))
    )
      return json(res, 400, {
        error: 'Revise o nome do consultório e as atribuições selecionadas.',
      });
    if (primaryIds.length && b.clinician !== true)
      return json(res, 400, {
        error: 'Confirme também o papel clínico para atribuir pacientes a você.',
      });

    const backupDir = path.join(DATA_DIR, 'backups');
    const backupName = `store-before-workspace-migration-${crypto.randomUUID()}.json`;
    try {
      await fs.mkdir(backupDir, { recursive: true });
      if (database)
        await fs.writeFile(path.join(backupDir, backupName), JSON.stringify(store), {
          flag: 'wx',
          mode: 0o600,
        });
      else await fs.copyFile(STORE, path.join(backupDir, backupName), fs.constants.COPYFILE_EXCL);
      await fs.chmod(path.join(backupDir, backupName), 0o600);
    } catch (error) {
      console.error('workspace_migration_backup_failed', error.code || 'unknown');
      return json(res, 500, {
        error: 'Não foi possível criar o backup de segurança; nenhum dado foi migrado.',
      });
    }
    const previousStore = store;
    store = JSON.parse(JSON.stringify(store));
    const workspace = createWorkspace(
      u,
      name,
      'individual',
      b.clinician === true ? ['owner_admin', 'clinician'] : ['owner_admin'],
    );
    const patientIds = new Set(legacyPatients.map((patient) => patient.id));
    for (const collection of ['patients', 'assessments', 'appointments', 'goals', 'mealPlans']) {
      for (const record of store[collection]) {
        if (record.userId === uid && !record.workspaceId) record.workspaceId = workspace.id;
      }
    }
    for (const account of store.patientAccounts)
      if (patientIds.has(account.patientId)) account.workspaceId = workspace.id;
    for (const invitation of store.patientInvitations)
      if (patientIds.has(invitation.patientId)) invitation.workspaceId = workspace.id;
    for (const reset of store.patientPasswordResets)
      if (patientIds.has(reset.patientId)) reset.workspaceId = workspace.id;
    for (const event of store.audit)
      if (event.userId === uid && !event.workspaceId) event.workspaceId = workspace.id;
    for (const patientId of primaryIds) {
      store.patientAssignments.push({
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        patientId,
        professionalId: uid,
        kind: 'primary',
        status: 'active',
        assignedAt: new Date().toISOString(),
      });
    }
    audit(uid, 'legacy_data_migrated', 'workspace', workspace.id, workspace.id);
    try {
      await persist();
    } catch (error) {
      store = previousStore;
      return json(res, 500, {
        error: 'A migração não foi gravada; o store em memória foi restaurado.',
      });
    }
    return json(res, 201, { workspace, backup: backupName });
  }
  if (req.method === 'GET' && url.pathname === '/api/workspaces')
    return json(res, 200, {
      workspaces: workspaceMemberships(store, uid).filter(
        (workspace) =>
          CLINIC_ADMIN_ENABLED ||
          (workspace.type !== 'clinic' && workspace.roles.includes('clinician')),
      ),
    });
  if (req.method === 'POST' && url.pathname === '/api/workspaces/select') {
    const b = await body(req);
    if (!CLINIC_ADMIN_ENABLED && b.experience !== 'clinical')
      return json(res, 404, { error: 'Este tipo de perfil não está disponível nesta versão.' });
    const workspace = store.workspaces.find((item) => item.id === String(b.workspaceId || ''));
    if (!CLINIC_ADMIN_ENABLED && workspace?.type === 'clinic')
      return json(res, 404, { error: 'Este tipo de perfil não está disponível nesta versão.' });
    const membership = workspace && activeMembership(store, uid, workspace.id);
    if (!workspace || !membership)
      return json(res, 404, { error: 'Contexto indisponível para esta conta.' });
    const experience = String(b.experience || '');
    const allowed =
      experience === 'clinical'
        ? hasPermission(store, membership, 'clinical.read')
        : experience === 'administrative'
          ? ['workspace.manage', 'members.manage', 'patients.read_admin', 'agenda.manage'].some(
              (permission) => hasPermission(store, membership, permission),
            )
          : false;
    if (!allowed) return json(res, 403, { error: 'Perfil não disponível para este membership.' });
    return json(res, 200, {
      workspace: { id: workspace.id, name: workspace.name, type: workspace.type },
      membership: {
        id: membership.id,
        roles: membership.roles.filter((role) => ROLE_DEFINITIONS[role]),
      },
      experience,
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/workspaces') {
    const activeWorkspaces = workspaceMemberships(store, uid);
    if (
      activeWorkspaces.length &&
      (CLINIC_ADMIN_ENABLED ||
        activeWorkspaces.some(
          (workspace) => workspace.type === 'individual' && workspace.roles.includes('clinician'),
        ))
    ) {
      const currentContext = workspaceContext(req, u);
      if (!currentContext || !currentContext.membership.roles.includes('owner_admin'))
        return json(res, 403, {
          error: 'Somente a proprietária do consultório pode criar outro workspace.',
        });
    }
    const b = await body(req);
    const name = String(b.name || '').trim();
    if (!CLINIC_ADMIN_ENABLED && (b.type !== 'individual' || b.clinician !== true))
      return json(res, 404, {
        error: 'Somente espaços profissionais individuais estão disponíveis nesta versão.',
      });
    if (!validText(name, 120) || !['individual', 'clinic'].includes(b.type))
      return json(res, 400, { error: 'Informe nome e tipo de workspace válidos.' });
    const roles = b.clinician === true ? ['owner_admin', 'clinician'] : ['owner_admin'];
    const workspace = createWorkspace(u, name, b.type, roles);
    await persist();
    return json(res, 201, { workspace, membership: activeMembership(store, uid, workspace.id) });
  }
  const workspaceMembersMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/members$/);
  const memberMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/members\/([^/]+)$/);
  const invitationMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/invitations$/);
  const invitationItemMatch = url.pathname.match(
    /^\/api\/workspaces\/([^/]+)\/invitations\/([^/]+)$/,
  );
  const workspaceSettingsMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)$/);
  const workspaceRolesMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/roles$/);
  if (req.method === 'POST' && url.pathname === '/api/workspace-invitations/accept') {
    const b = await body(req);
    const tokenHashValue = tokenHash(String(b.token || ''));
    const invitation = store.workspaceInvitations.find(
      (entry) => entry.tokenHash === tokenHashValue,
    );
    if (
      !invitation ||
      invitation.usedAt ||
      invitation.revokedAt ||
      Date.parse(invitation.expiresAt) <= Date.now() ||
      invitation.email !== u.email
    )
      return json(res, 404, { error: 'Convite inválido ou indisponível para esta conta.' });
    if (activeMembership(store, uid, invitation.workspaceId))
      return json(res, 409, { error: 'Esta conta já participa do workspace.' });
    invitation.usedAt = new Date().toISOString();
    const membership = {
      id: crypto.randomUUID(),
      workspaceId: invitation.workspaceId,
      userId: uid,
      roles: invitation.roles,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    store.memberships.push(membership);
    audit(
      uid,
      'workspace_invitation_accepted',
      'workspace',
      invitation.workspaceId,
      invitation.workspaceId,
    );
    await persist();
    return json(res, 201, {
      workspace: store.workspaces.find((item) => item.id === invitation.workspaceId),
      membership,
    });
  }
  if (workspaceMembersMatch && req.method === 'GET') {
    const contextMembership = activeMembership(store, uid, workspaceMembersMatch[1]);
    if (!contextMembership || !hasPermission(store, contextMembership, 'members.manage'))
      return json(res, 404, { error: 'Workspace não encontrado.' });
    const members = store.memberships
      .filter(
        (entry) => entry.workspaceId === workspaceMembersMatch[1] && entry.status === 'active',
      )
      .map((entry) => {
        const memberUser = store.users.find((item) => item.id === entry.userId);
        return memberUser
          ? {
              id: entry.id,
              userId: memberUser.id,
              name: memberUser.name,
              email: memberUser.email,
              roles: entry.roles,
            }
          : null;
      })
      .filter(Boolean);
    return json(res, 200, { members });
  }
  if (invitationMatch && req.method === 'GET') {
    const contextMembership = activeMembership(store, uid, invitationMatch[1]);
    if (!contextMembership || !hasPermission(store, contextMembership, 'members.manage'))
      return json(res, 404, { error: 'Workspace não encontrado.' });
    const invitations = store.workspaceInvitations
      .filter((entry) => entry.workspaceId === invitationMatch[1])
      .map((entry) => ({
        id: entry.id,
        email: entry.email,
        roles: entry.roles.filter((role) => ROLE_DEFINITIONS[role]),
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        usedAt: entry.usedAt || null,
        revokedAt: entry.revokedAt || null,
        status: entry.usedAt
          ? 'accepted'
          : entry.revokedAt
            ? 'revoked'
            : Date.parse(entry.expiresAt) <= Date.now()
              ? 'expired'
              : 'pending',
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(res, 200, { invitations });
  }
  if (invitationItemMatch && req.method === 'DELETE') {
    const contextMembership = activeMembership(store, uid, invitationItemMatch[1]);
    if (!contextMembership || !hasPermission(store, contextMembership, 'members.manage'))
      return json(res, 404, { error: 'Workspace não encontrado.' });
    const invitation = store.workspaceInvitations.find(
      (entry) =>
        entry.id === invitationItemMatch[2] && entry.workspaceId === invitationItemMatch[1],
    );
    if (!invitation) return json(res, 404, { error: 'Convite não encontrado.' });
    if (invitation.usedAt || invitation.revokedAt || Date.parse(invitation.expiresAt) <= Date.now())
      return json(res, 409, { error: 'Somente convites pendentes podem ser cancelados.' });
    invitation.revokedAt = new Date().toISOString();
    audit(
      uid,
      'workspace_invitation_revoked',
      'workspace_invitation',
      invitation.id,
      invitation.workspaceId,
    );
    await persist();
    return json(res, 200, { ok: true });
  }
  if (workspaceSettingsMatch && req.method === 'PATCH') {
    const contextMembership = activeMembership(store, uid, workspaceSettingsMatch[1]);
    if (!contextMembership || !hasPermission(store, contextMembership, 'workspace.manage'))
      return json(res, 404, { error: 'Workspace não encontrado.' });
    const workspace = store.workspaces.find((entry) => entry.id === workspaceSettingsMatch[1]);
    const b = await body(req);
    if (!validText(b.name, 120))
      return json(res, 400, { error: 'Informe um nome válido para o consultório.' });
    workspace.name = b.name.trim();
    audit(uid, 'workspace_name_changed', 'workspace', workspace.id, workspace.id);
    await persist();
    return json(res, 200, {
      workspace: { id: workspace.id, name: workspace.name, type: workspace.type },
    });
  }
  if (workspaceRolesMatch && req.method === 'GET') {
    const contextMembership = activeMembership(store, uid, workspaceRolesMatch[1]);
    if (!contextMembership || !hasPermission(store, contextMembership, 'members.manage'))
      return json(res, 404, { error: 'Workspace não encontrado.' });
    const roles = Object.entries(ROLE_DEFINITIONS).map(([key, definition]) => ({
      key,
      name: definition.name,
      permissions: [...definition.permissions],
    }));
    return json(res, 200, { roles });
  }
  if (invitationMatch && req.method === 'POST') {
    const contextMembership = activeMembership(store, uid, invitationMatch[1]);
    if (!contextMembership || !hasPermission(store, contextMembership, 'members.manage'))
      return json(res, 404, { error: 'Workspace não encontrado.' });
    const b = await body(req);
    const email = String(b.email || '')
      .trim()
      .toLowerCase();
    const role = String(b.role || '');
    if (
      email.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      !['operations_admin', 'assistant', 'clinician'].includes(role)
    )
      return json(res, 400, { error: 'Informe e-mail e papel de membro válidos.' });
    if (role === 'operations_admin' && !contextMembership.roles.includes('owner_admin'))
      return json(res, 403, {
        error: 'Somente proprietários podem convidar administradores operacionais.',
      });
    const targetUser = store.users.find((item) => item.email === email);
    if (targetUser && activeMembership(store, targetUser.id, invitationMatch[1]))
      return json(res, 409, { error: 'Esta pessoa já participa do workspace.' });
    const now = Date.now();
    for (const previous of store.workspaceInvitations) {
      if (
        previous.workspaceId === invitationMatch[1] &&
        previous.email === email &&
        !previous.usedAt
      )
        previous.revokedAt = new Date(now).toISOString();
    }
    const token = crypto.randomBytes(32).toString('hex');
    const invitation = {
      id: crypto.randomUUID(),
      workspaceId: invitationMatch[1],
      email,
      roles: [role],
      tokenHash: tokenHash(token),
      createdBy: uid,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 86400000).toISOString(),
      usedAt: null,
      revokedAt: null,
    };
    store.workspaceInvitations.push(invitation);
    audit(
      uid,
      'workspace_invitation_created',
      'workspace',
      invitation.workspaceId,
      invitation.workspaceId,
    );
    await persist();
    return json(res, 201, { token, expiresAt: invitation.expiresAt });
  }
  if (memberMatch && req.method === 'PATCH') {
    const contextMembership = activeMembership(store, uid, memberMatch[1]);
    if (!contextMembership || !hasPermission(store, contextMembership, 'members.manage'))
      return json(res, 404, { error: 'Workspace não encontrado.' });
    const targetMembership = store.memberships.find(
      (entry) =>
        entry.id === memberMatch[2] &&
        entry.workspaceId === memberMatch[1] &&
        entry.status === 'active',
    );
    if (!targetMembership) return json(res, 404, { error: 'Membership não encontrado.' });
    const b = await body(req);
    const roles = Array.isArray(b.roles) ? [...new Set(b.roles)] : [];
    if (!roles.length || roles.some((role) => !ROLE_DEFINITIONS[role]))
      return json(res, 400, { error: 'Informe papéis válidos.' });
    if (
      !contextMembership.roles.includes('owner_admin') &&
      (roles.includes('owner_admin') || targetMembership.roles.includes('owner_admin'))
    )
      return json(res, 403, {
        error: 'Somente proprietários podem alterar o papel de proprietário.',
      });
    if (
      !contextMembership.roles.includes('owner_admin') &&
      roles.includes('operations_admin') &&
      !targetMembership.roles.includes('operations_admin')
    )
      return json(res, 403, {
        error: 'Somente proprietários podem conceder administração operacional.',
      });
    if (
      targetMembership.roles.includes('owner_admin') &&
      !roles.includes('owner_admin') &&
      store.memberships.filter(
        (entry) =>
          entry.workspaceId === memberMatch[1] &&
          entry.status === 'active' &&
          entry.roles.includes('owner_admin'),
      ).length === 1
    )
      return json(res, 409, { error: 'O workspace precisa manter ao menos um proprietário.' });
    targetMembership.roles = roles;
    audit(uid, 'workspace_member_roles_changed', 'membership', targetMembership.id, memberMatch[1]);
    await persist();
    return json(res, 200, { membership: targetMembership });
  }
  if (memberMatch && req.method === 'DELETE') {
    const contextMembership = activeMembership(store, uid, memberMatch[1]);
    if (!contextMembership || !hasPermission(store, contextMembership, 'members.manage'))
      return json(res, 404, { error: 'Workspace não encontrado.' });
    const targetMembership = store.memberships.find(
      (entry) =>
        entry.id === memberMatch[2] &&
        entry.workspaceId === memberMatch[1] &&
        entry.status === 'active',
    );
    if (!targetMembership) return json(res, 404, { error: 'Membership não encontrado.' });
    if (
      targetMembership.roles.includes('owner_admin') &&
      !contextMembership.roles.includes('owner_admin')
    )
      return json(res, 403, { error: 'Somente outro proprietário pode remover um proprietário.' });
    if (
      targetMembership.roles.includes('owner_admin') &&
      store.memberships.filter(
        (entry) =>
          entry.workspaceId === memberMatch[1] &&
          entry.status === 'active' &&
          entry.roles.includes('owner_admin'),
      ).length === 1
    )
      return json(res, 409, { error: 'O workspace precisa manter ao menos um proprietário.' });
    targetMembership.status = 'revoked';
    targetMembership.revokedAt = new Date().toISOString();
    for (const assignment of store.patientAssignments) {
      if (
        assignment.workspaceId === memberMatch[1] &&
        assignment.professionalId === targetMembership.userId &&
        assignment.status === 'active'
      ) {
        assignment.status = 'revoked';
        assignment.endedAt = targetMembership.revokedAt;
      }
    }
    audit(uid, 'workspace_member_removed', 'membership', targetMembership.id, memberMatch[1]);
    await persist();
    return json(res, 200, { ok: true });
  }
  const context = workspaceContext(req, u);
  if (!context)
    return json(res, 403, {
      error: 'Selecione um workspace ao qual sua conta tenha membership ativo.',
    });
  const { workspace, membership } = context;
  if (!CLINIC_ADMIN_ENABLED && workspace.type === 'clinic')
    return json(res, 404, { error: 'Este tipo de espaço não está disponível nesta versão.' });
  if (req.method === 'GET' && url.pathname === '/api/clinicians') {
    if (!hasPermission(store, membership, 'patients.assign'))
      return json(res, 404, { error: 'Workspace não encontrado.' });
    const clinicians = store.memberships
      .filter(
        (entry) =>
          entry.workspaceId === workspace.id &&
          entry.status === 'active' &&
          entry.roles.includes('clinician'),
      )
      .map((entry) => ({
        membershipId: entry.id,
        user: store.users.find((person) => person.id === entry.userId),
      }))
      .filter((item) => item.user)
      .map(({ membershipId, user }) => ({
        id: user.id,
        membershipId,
        name: user.name,
        email: user.email,
        assignedPatientCount: store.patientAssignments.filter(
          (assignment) =>
            assignment.workspaceId === workspace.id &&
            assignment.professionalId === user.id &&
            assignment.status === 'active',
        ).length,
      }));
    return json(res, 200, { clinicians });
  }
  if (req.method === 'GET' && url.pathname === '/api/dashboard') {
    const canManagePatients = hasPermission(store, membership, 'patients.read_admin');
    const patients = store.patients.filter(
      (patient) =>
        patient.workspaceId === workspace.id &&
        (canManagePatients || hasClinicalAccess(uid, workspace.id, patient.id, 'clinical.read')),
    );
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 7 * 86400000).toISOString();
    const clinicalPatientIds = new Set(
      patients
        .filter((patient) => hasClinicalAccess(uid, workspace.id, patient.id, 'clinical.read'))
        .map((patient) => patient.id),
    );
    const assessments = store.assessments.filter(
      (entry) => entry.workspaceId === workspace.id && clinicalPatientIds.has(entry.patientId),
    );
    const assessedPatientIds = new Set(assessments.map((x) => x.patientId));
    const monthKeys = Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCMonth(d.getUTCMonth() - 5 + i);
      return d.toISOString().slice(0, 7);
    });
    const newPatientsByMonth = monthKeys.map((month) => ({
      month,
      label: new Date(`${month}-01T12:00:00Z`)
        .toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' })
        .replace('.', ''),
      total: patients.filter((p) => p.createdAt.slice(0, 7) === month).length,
    }));
    const appointments = store.appointments
      .filter(
        (entry) =>
          entry.workspaceId === workspace.id &&
          entry.status === 'agendada' &&
          (hasPermission(store, membership, 'agenda.manage') ||
            clinicalPatientIds.has(entry.patientId)),
      )
      .sort((a, b) => a.start.localeCompare(b.start));
    const activePatients = patients.filter((x) => x.status === 'Ativo');
    return json(res, 200, {
      patients: patients.length,
      activePatients: activePatients.length,
      activeWithoutAssessment: activePatients.filter(
        (patient) => clinicalPatientIds.has(patient.id) && !assessedPatientIds.has(patient.id),
      ).length,
      totalAssessments: assessments.length,
      newThisMonth: patients.filter((x) => x.createdAt.slice(0, 7) === today.slice(0, 7)).length,
      newPatientsByMonth,
      todayAppointments: appointments.filter((x) => x.start.slice(0, 10) === today).length,
      nextWeek: appointments.filter((x) => x.start >= new Date().toISOString() && x.start <= future)
        .length,
      upcoming: appointments.slice(0, 5).map((a) => ({
        ...a,
        notes: clinicalPatientIds.has(a.patientId) ? a.notes : '',
        patientName: patientInWorkspace(a.patientId, workspace.id)?.name || 'Paciente arquivado',
      })),
      recent: store.audit
        .filter((x) => x.userId === uid && x.workspaceId === workspace.id)
        .slice(0, 8),
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/patients') {
    const canManagePatients = hasPermission(store, membership, 'patients.read_admin');
    if (!canManagePatients && !hasPermission(store, membership, 'clinical.read'))
      return json(res, 403, { error: 'Permissão insuficiente.' });
    const patients = store.patients
      .filter(
        (patient) =>
          patient.workspaceId === workspace.id &&
          (canManagePatients || hasClinicalAccess(uid, workspace.id, patient.id, 'clinical.read')),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(patientAdminView);
    return json(res, 200, { patients });
  }
  if (req.method === 'POST' && url.pathname === '/api/patients') {
    const canManagePatients = hasPermission(store, membership, 'patients.manage');
    const canCreateAsClinician = hasPermission(store, membership, 'patients.create');
    if (!canManagePatients && !canCreateAsClinician)
      return json(res, 403, { error: 'Permissão insuficiente para cadastrar pacientes.' });
    const b = await body(req);
    const validationError = patientInputError(b);
    if (validationError) return json(res, 400, { error: validationError });
    if (!validText(b.name, 150)) return json(res, 400, { error: 'Nome completo é obrigatório.' });
    const primaryId = String(b.primaryProfessionalId || '');
    const supportIds = Array.isArray(b.supportProfessionalIds)
      ? [...new Set(b.supportProfessionalIds.map(String).filter((id) => id && id !== primaryId))]
      : [];
    if (!canManagePatients && ((primaryId && primaryId !== uid) || supportIds.length))
      return json(res, 403, {
        error: 'Nutricionistas podem se designar como responsável principal no cadastro.',
      });
    if (
      (primaryId || supportIds.length) &&
      !canManagePatients &&
      !clinicianMembership(workspace.id, uid)
    )
      return json(res, 403, { error: 'Permissão insuficiente para atribuir o acompanhamento.' });
    const assignments = patientAssignmentRecords(workspace.id, 'pending', primaryId, supportIds);
    if (!assignments)
      return json(res, 404, {
        error: 'Um ou mais profissionais não são nutricionistas ativos deste workspace.',
      });
    const hasClinicalInput = Boolean(
      String(b.objective || '').trim() || String(b.clinicalNotes || '').trim(),
    );
    if (
      hasClinicalInput &&
      !(
        clinicianMembership(workspace.id, uid) &&
        assignments.some((assignment) => assignment.professionalId === uid)
      )
    )
      return json(res, 403, {
        error: 'Dados clínicos só podem ser registrados por um nutricionista atribuído.',
      });
    const p = {
      id: crypto.randomUUID(),
      userId: uid,
      workspaceId: workspace.id,
      name: b.name.trim(),
      email: String(b.email || '').slice(0, 254),
      phone: String(b.phone || '').slice(0, 40),
      birthDate: String(b.birthDate || ''),
      status: ['Ativo', 'Em pausa', 'Arquivado'].includes(b.status) ? b.status : 'Ativo',
      objective: String(b.objective || '').slice(0, 500),
      clinicalNotes: String(b.clinicalNotes || '').slice(0, 5000),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    for (const assignment of assignments) assignment.patientId = p.id;
    store.patients.push(p);
    store.patientAssignments.push(...assignments);
    audit(uid, 'patient_created', 'patient', p.id, workspace.id);
    await persist();
    return json(res, 201, { patient: canManagePatients ? patientAdminView(p) : p });
  }
  const exportMatch = url.pathname.match(/^\/api\/patients\/([^/]+)\/export$/);
  if (exportMatch && req.method === 'GET') {
    const patient = patientInWorkspace(exportMatch[1], workspace.id);
    if (!patient || !hasClinicalAccess(uid, workspace.id, patient.id, 'clinical.read'))
      return json(res, 404, { error: 'Paciente não encontrado.' });
    audit(uid, 'patient_data_exported', 'patient', patient.id, workspace.id);
    await persist();
    const scoped = (key) =>
      store[key].filter((row) => row.patientId === patient.id && row.workspaceId === workspace.id);
    return json(res, 200, {
      exportedAt: new Date().toISOString(),
      patient,
      assessments: scoped('assessments'),
      goals: scoped('goals'),
      appointments: scoped('appointments'),
      mealPlans: scoped('mealPlans'),
    });
  }
  const patientMatch = url.pathname.match(/^\/api\/patients\/([^/]+)$/);
  if (patientMatch && req.method === 'PATCH') {
    const p = patientInWorkspace(patientMatch[1], workspace.id);
    if (!p || !canReadPatient(uid, workspace.id, p.id))
      return json(res, 404, { error: 'Paciente não encontrado.' });
    const b = await body(req);
    const validationError = patientInputError(b);
    if (validationError) return json(res, 400, { error: validationError });
    const adminFields = ['name', 'email', 'phone', 'birthDate', 'status'];
    const clinicalFields = ['objective', 'clinicalNotes'];
    if (
      adminFields.some((key) => b[key] !== undefined) &&
      !hasPermission(store, membership, 'patients.manage')
    )
      return json(res, 403, { error: 'Permissão insuficiente para alterar dados cadastrais.' });
    if (
      clinicalFields.some((key) => b[key] !== undefined) &&
      !hasClinicalAccess(uid, workspace.id, p.id, 'clinical.write')
    )
      return json(res, 404, { error: 'Paciente não encontrado.' });
    if (b.name !== undefined && !validText(b.name, 150))
      return json(res, 400, { error: 'Nome inválido.' });
    if (b.status !== undefined && !['Ativo', 'Em pausa', 'Arquivado'].includes(b.status))
      return json(res, 400, { error: 'Status inválido.' });
    for (const k of [...adminFields, ...clinicalFields])
      if (b[k] !== undefined) p[k] = String(b[k]).slice(0, k === 'clinicalNotes' ? 5000 : 500);
    if (!validText(p.name, 150)) return json(res, 400, { error: 'Nome inválido.' });
    p.updatedAt = new Date().toISOString();
    audit(uid, 'patient_updated', 'patient', p.id, workspace.id);
    await persist();
    return json(res, 200, {
      patient: hasClinicalAccess(uid, workspace.id, p.id, 'clinical.read')
        ? p
        : patientAdminView(p),
    });
  }
  if (patientMatch && req.method === 'GET') {
    const p = patientInWorkspace(patientMatch[1], workspace.id);
    if (!p || !canReadPatient(uid, workspace.id, p.id))
      return json(res, 404, { error: 'Paciente não encontrado.' });
    const clinicalAccess = hasClinicalAccess(uid, workspace.id, p.id, 'clinical.read');
    const account = patientAccountForPatient(p, workspace.id);
    const portalStatus = account ? portalAccessStatus(account) : null;
    return json(res, 200, {
      patient: clinicalAccess ? p : patientAdminView(p),
      clinicalAccess,
      assignments: hasPermission(store, membership, 'patients.assign')
        ? patientClinicalAssignments(workspace.id, p.id)
        : [],
      portal: {
        enabled: portalStatus === 'active',
        exists: !!account,
        status: portalStatus,
        email: account?.email || null,
      },
      assessments: clinicalAccess
        ? store.assessments
            .filter((x) => x.patientId === p.id && x.workspaceId === workspace.id)
            .sort(compareAssessmentsNewestFirst)
        : [],
      appointments:
        clinicalAccess || hasPermission(store, membership, 'agenda.manage')
          ? store.appointments
              .filter((x) => x.patientId === p.id && x.workspaceId === workspace.id)
              .sort((a, b) => b.start.localeCompare(a.start))
              .map((appointment) => (clinicalAccess ? appointment : { ...appointment, notes: '' }))
          : [],
      goals: clinicalAccess
        ? store.goals.filter((x) => x.patientId === p.id && x.workspaceId === workspace.id)
        : [],
    });
  }
  const assignmentMatch = url.pathname.match(/^\/api\/patients\/([^/]+)\/assignments$/);
  if (assignmentMatch && req.method === 'PUT') {
    if (!hasPermission(store, membership, 'patients.assign'))
      return json(res, 403, {
        error: 'Somente administradores autorizados podem alterar atribuições.',
      });
    const patient = patientInWorkspace(assignmentMatch[1], workspace.id);
    if (!patient) return json(res, 404, { error: 'Paciente não encontrado.' });
    const b = await body(req);
    const primaryId = String(b.primaryProfessionalId || '');
    const supportIds = Array.isArray(b.supportProfessionalIds)
      ? [...new Set(b.supportProfessionalIds.map(String).filter((id) => id && id !== primaryId))]
      : [];
    const nextAssignments = patientAssignmentRecords(
      workspace.id,
      patient.id,
      primaryId,
      supportIds,
    );
    if (!nextAssignments)
      return json(res, 404, {
        error: 'Um ou mais profissionais não são nutricionistas ativos deste workspace.',
      });
    const now = new Date().toISOString();
    for (const old of patientClinicalAssignments(workspace.id, patient.id)) {
      old.status = 'revoked';
      old.endedAt = now;
    }
    store.patientAssignments.push(...nextAssignments);
    audit(uid, 'patient_assignments_changed', 'patient', patient.id, workspace.id);
    await persist();
    return json(res, 200, { assignments: patientClinicalAssignments(workspace.id, patient.id) });
  }
  const portalAccessMatch = url.pathname.match(/^\/api\/patients\/([^/]+)\/portal-access$/);
  if (portalAccessMatch && req.method === 'PATCH') {
    const patient = patientInWorkspace(portalAccessMatch[1], workspace.id);
    if (!patient || !hasClinicalAccess(uid, workspace.id, patient.id, 'clinical.write'))
      return json(res, 404, { error: 'Paciente não encontrado.' });
    const account = patientAccountForPatient(patient, workspace.id);
    if (!account) return json(res, 409, { error: 'Este paciente ainda não ativou o portal.' });
    const b = await body(req);
    const nextStatus = String(b.status || '');
    if (!['active', 'suspended', 'revoked'].includes(nextStatus))
      return json(res, 400, { error: 'Informe um estado válido para o acesso ao portal.' });
    const currentStatus = portalAccessStatus(account);
    if (currentStatus === 'revoked' && nextStatus !== 'revoked')
      return json(res, 409, { error: 'O acesso revogado não pode ser reativado.' });
    if (nextStatus === 'active' && currentStatus !== 'suspended')
      return json(res, 409, { error: 'Somente um acesso suspenso pode ser reativado.' });
    if (currentStatus === nextStatus) return json(res, 200, { portal: { status: currentStatus } });

    const now = new Date().toISOString();
    account.portalStatus = nextStatus;
    account.portalStatusChangedAt = now;
    account.portalStatusChangedBy = uid;
    if (nextStatus !== 'active') {
      for (const [session, value] of patientSessions)
        if (value.subjectId === account.id) patientSessions.delete(session);
      for (const invitation of store.patientInvitations)
        if (
          invitation.patientId === patient.id &&
          (invitation.workspaceId
            ? invitation.workspaceId === workspace.id
            : patient.userId === invitation.professionalId) &&
          !invitation.usedAt &&
          !invitation.revokedAt
        )
          invitation.revokedAt = now;
      for (const reset of store.patientPasswordResets)
        if (reset.accountId === account.id && !reset.usedAt && !reset.revokedAt)
          reset.revokedAt = now;
    }
    const action =
      nextStatus === 'active'
        ? 'patient_portal_reactivated'
        : nextStatus === 'suspended'
          ? 'patient_portal_suspended'
          : 'patient_portal_access_revoked';
    audit(uid, action, 'patient', patient.id, workspace.id);
    await persist();
    return json(res, 200, { portal: { status: nextStatus } });
  }
  const inviteMatch = url.pathname.match(/^\/api\/patients\/([^/]+)\/invitations$/);
  if (inviteMatch && req.method === 'POST') {
    const patient = patientInWorkspace(inviteMatch[1], workspace.id);
    if (!patient || !hasClinicalAccess(uid, workspace.id, patient.id, 'clinical.write'))
      return json(res, 404, { error: 'Paciente não encontrado.' });
    if (patient.status === 'Arquivado')
      return json(res, 409, { error: 'Não é possível convidar um paciente arquivado.' });
    if (!/^\S+@\S+\.\S+$/.test(String(patient.email || '').trim()))
      return json(res, 400, {
        error: 'Cadastre um e-mail válido no perfil do paciente antes de convidá-lo.',
      });
    if (
      store.patientAccounts.some(
        (a) => a.patientId === patient.id && a.workspaceId === workspace.id,
      )
    )
      return json(res, 409, { error: 'Este paciente já tem acesso ao portal.' });
    const now = Date.now();
    for (const invite of store.patientInvitations)
      if (
        invite.patientId === patient.id &&
        invite.workspaceId === workspace.id &&
        !invite.usedAt &&
        !invite.revokedAt
      )
        invite.revokedAt = new Date(now).toISOString();
    const token = crypto.randomBytes(32).toString('hex');
    const invite = {
      id: crypto.randomUUID(),
      patientId: patient.id,
      professionalId: uid,
      workspaceId: workspace.id,
      tokenHash: tokenHash(token),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 86400000).toISOString(),
      usedAt: null,
      revokedAt: null,
    };
    store.patientInvitations.push(invite);
    audit(uid, 'patient_portal_invite_created', 'patient', patient.id, workspace.id);
    await persist();
    return json(res, 201, { token, expiresAt: invite.expiresAt });
  }
  const resetMatch = url.pathname.match(/^\/api\/patients\/([^/]+)\/password-resets$/);
  if (resetMatch && req.method === 'POST') {
    const patient = patientInWorkspace(resetMatch[1], workspace.id);
    if (!patient || !hasClinicalAccess(uid, workspace.id, patient.id, 'clinical.write'))
      return json(res, 404, { error: 'Paciente não encontrado.' });
    const account = store.patientAccounts.find(
      (a) => a.patientId === patient.id && a.workspaceId === workspace.id,
    );
    if (!account || portalAccessStatus(account) !== 'active')
      return json(res, 409, { error: 'O portal deste paciente não está ativo.' });
    const now = Date.now();
    for (const reset of store.patientPasswordResets)
      if (reset.accountId === account.id && !reset.usedAt && !reset.revokedAt)
        reset.revokedAt = new Date(now).toISOString();
    const token = crypto.randomBytes(32).toString('hex');
    const reset = {
      id: crypto.randomUUID(),
      patientId: patient.id,
      accountId: account.id,
      professionalId: uid,
      tokenHash: tokenHash(token),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      usedAt: null,
      revokedAt: null,
    };
    store.patientPasswordResets.push(reset);
    audit(uid, 'patient_portal_password_reset_created', 'patient', patient.id, workspace.id);
    await persist();
    return json(res, 201, { token, expiresAt: reset.expiresAt });
  }
  if (req.method === 'GET' && url.pathname === '/api/assessments') {
    if (!hasPermission(store, membership, 'clinical.read'))
      return json(res, 403, { error: 'Permissão clínica necessária.' });
    const assessments = store.assessments
      .filter(
        (entry) =>
          entry.workspaceId === workspace.id &&
          hasClinicalAccess(uid, workspace.id, entry.patientId, 'clinical.read'),
      )
      .sort(compareAssessmentsNewestFirst)
      .map((a) => ({
        ...a,
        patientName: patientInWorkspace(a.patientId, workspace.id)?.name || '',
      }));
    return json(res, 200, { assessments });
  }
  if (req.method === 'POST' && url.pathname === '/api/assessments') {
    if (!hasPermission(store, membership, 'clinical.write'))
      return json(res, 403, { error: 'Permissão clínica necessária.' });
    const b = await body(req);
    if (
      !patientInWorkspace(b.patientId, workspace.id) ||
      !hasClinicalAccess(uid, workspace.id, b.patientId, 'clinical.write')
    )
      return json(res, 404, { error: 'Paciente não encontrado.' });
    const n = (k) => (b[k] === '' || b[k] == null ? null : Number(b[k]));
    if (b.date && !validDate(b.date)) return json(res, 400, { error: 'Data inválida.' });
    if (
      ['waist', 'hip'].some(
        (key) => n(key) !== null && (!Number.isFinite(n(key)) || n(key) < 0 || n(key) > 500),
      )
    )
      return json(res, 400, { error: 'Medida inválida.' });
    const weight = n('weight'),
      height = n('height'),
      fat = n('fat');
    if (
      (weight !== null && (!Number.isFinite(weight) || weight <= 0 || weight > 500)) ||
      (height !== null && (!Number.isFinite(height) || height <= 0 || height > 280)) ||
      (fat !== null && (!Number.isFinite(fat) || fat < 0 || fat > 100))
    )
      return json(res, 400, { error: 'Revise peso, altura e percentual de gordura.' });
    const a = {
      id: crypto.randomUUID(),
      userId: uid,
      workspaceId: workspace.id,
      patientId: b.patientId,
      date: /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : new Date().toISOString().slice(0, 10),
      weight,
      height,
      weightUnit: 'kg',
      heightUnit: 'cm',
      bmi: weight && height ? Number((weight / (height / 100) ** 2).toFixed(1)) : null,
      fat,
      fatMass: weight && fat !== null ? Number(((weight * fat) / 100).toFixed(2)) : null,
      leanMass: weight && fat !== null ? Number((weight * (1 - fat / 100)).toFixed(2)) : null,
      waist: n('waist'),
      hip: n('hip'),
      method: String(b.method || '').slice(0, 200),
      notes: String(b.notes || '').slice(0, 2000),
      createdAt: new Date().toISOString(),
    };
    store.assessments.push(a);
    audit(uid, 'assessment_created', 'assessment', a.id, workspace.id);
    await persist();
    return json(res, 201, { assessment: a });
  }
  if (req.method === 'POST' && url.pathname === '/api/appointments') {
    const b = await body(req);
    const patient = patientInWorkspace(b.patientId, workspace.id);
    const clinicalAccess =
      patient && hasClinicalAccess(uid, workspace.id, patient.id, 'clinical.write');
    const canManageAgenda = hasPermission(store, membership, 'agenda.manage');
    if (!patient || (!canManageAgenda && !clinicalAccess))
      return json(res, 404, { error: 'Paciente não encontrado.' });
    if (b.notes && !clinicalAccess)
      return json(res, 403, {
        error: 'Somente um profissional atribuído pode registrar observações clínicas.',
      });
    const start = Date.parse(b.start);
    const duration = b.duration === undefined || b.duration === '' ? 50 : Number(b.duration);
    if (!Number.isFinite(duration) || duration < 15 || duration > 240)
      return json(res, 400, { error: 'Duração inválida.' });
    if (!Number.isFinite(start) || start < Date.now() - 60000)
      return json(res, 400, { error: 'Informe uma data futura válida.' });
    const end = new Date(start + duration * 60000).toISOString();
    const conflict = store.appointments.some(
      (a) =>
        a.workspaceId === workspace.id &&
        a.userId === uid &&
        a.status === 'agendada' &&
        Date.parse(a.start) < Date.parse(end) &&
        Date.parse(a.end) > start,
    );
    if (conflict) return json(res, 409, { error: 'Já existe uma consulta nesse horário.' });
    const a = {
      id: crypto.randomUUID(),
      userId: uid,
      workspaceId: workspace.id,
      patientId: b.patientId,
      start: new Date(start).toISOString(),
      end,
      duration,
      status: 'agendada',
      type: String(b.type || 'Presencial').slice(0, 60),
      notes: String(b.notes || '').slice(0, 2000),
      createdAt: new Date().toISOString(),
    };
    store.appointments.push(a);
    audit(uid, 'appointment_created', 'appointment', a.id, workspace.id);
    await persist();
    return json(res, 201, { appointment: a });
  }
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/appointments/')) {
    const id = url.pathname.split('/').at(-1);
    const a = store.appointments.find(
      (entry) => entry.id === id && entry.workspaceId === workspace.id,
    );
    if (
      !a ||
      (!hasPermission(store, membership, 'agenda.manage') &&
        !hasClinicalAccess(uid, workspace.id, a.patientId, 'clinical.write'))
    )
      return json(res, 404, { error: 'Consulta não encontrada.' });
    const b = await body(req);
    if (!['agendada', 'realizada', 'cancelada', 'falta'].includes(b.status))
      return json(res, 400, { error: 'Status inválido.' });
    if (
      b.status === 'agendada' &&
      store.appointments.some(
        (other) =>
          other.id !== a.id &&
          other.workspaceId === a.workspaceId &&
          other.userId === a.userId &&
          other.status === 'agendada' &&
          Date.parse(other.start) < Date.parse(a.end) &&
          Date.parse(other.end) > Date.parse(a.start),
      )
    )
      return json(res, 409, { error: 'Já existe uma consulta nesse horário.' });
    a.status = b.status;
    audit(uid, 'appointment_status_changed', 'appointment', a.id, workspace.id);
    await persist();
    return json(res, 200, {
      appointment: hasClinicalAccess(uid, workspace.id, a.patientId, 'clinical.read')
        ? a
        : { ...a, notes: '' },
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/goals') {
    if (!hasPermission(store, membership, 'clinical.read'))
      return json(res, 403, { error: 'Permissão clínica necessária.' });
    const names = new Map(
      store.patients.filter((p) => p.workspaceId === workspace.id).map((p) => [p.id, p.name]),
    );
    return json(res, 200, {
      goals: store.goals
        .filter(
          (g) =>
            g.workspaceId === workspace.id &&
            hasClinicalAccess(uid, workspace.id, g.patientId, 'clinical.read'),
        )
        .map((g) => ({ ...g, patientName: names.get(g.patientId) || '' })),
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/goals') {
    if (!hasPermission(store, membership, 'clinical.write'))
      return json(res, 403, { error: 'Permissão clínica necessária.' });
    const b = await body(req);
    if (b.dueDate && !validDate(b.dueDate)) return json(res, 400, { error: 'Prazo inválido.' });
    if (b.category !== undefined && (typeof b.category !== 'string' || b.category.length > 60))
      return json(res, 400, { error: 'Categoria inválida.' });
    if (
      !patientInWorkspace(b.patientId, workspace.id) ||
      !hasClinicalAccess(uid, workspace.id, b.patientId, 'clinical.write')
    )
      return json(res, 404, { error: 'Paciente não encontrado.' });
    if (!validText(b.description, 500))
      return json(res, 400, { error: 'Descrição da meta é obrigatória.' });
    const g = {
      id: crypto.randomUUID(),
      userId: uid,
      workspaceId: workspace.id,
      patientId: b.patientId,
      description: b.description.trim(),
      category: String(b.category || 'Hábitos').slice(0, 60),
      dueDate: String(b.dueDate || ''),
      status: 'ativa',
      progress: [],
      createdAt: new Date().toISOString(),
    };
    store.goals.push(g);
    audit(uid, 'goal_created', 'goal', g.id, workspace.id);
    await persist();
    return json(res, 201, { goal: g });
  }
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/goals/')) {
    const id = url.pathname.split('/').at(-1);
    const g = store.goals.find((entry) => entry.id === id && entry.workspaceId === workspace.id);
    if (!g || !hasClinicalAccess(uid, workspace.id, g.patientId, 'clinical.write'))
      return json(res, 404, { error: 'Meta não encontrada.' });
    const b = await body(req);
    if (!['ativa', 'concluida', 'pausada'].includes(b.status))
      return json(res, 400, { error: 'Status inválido.' });
    g.status = b.status;
    if (validText(b.note, 1000))
      g.progress.push({ note: b.note.trim(), at: new Date().toISOString() });
    audit(uid, 'goal_updated', 'goal', g.id, workspace.id);
    await persist();
    return json(res, 200, { goal: g });
  }
  if (req.method === 'GET' && url.pathname === '/api/meal-plans') {
    if (!hasPermission(store, membership, 'clinical.read'))
      return json(res, 403, { error: 'Permissão clínica necessária.' });
    const plans = store.mealPlans
      .filter(
        (plan) =>
          plan.workspaceId === workspace.id &&
          hasClinicalAccess(uid, workspace.id, plan.patientId, 'clinical.read'),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => {
        const latest = p.versions.at(-1);
        const published = p.versions.find((v) => v.id === p.publishedVersionId);
        return {
          id: p.id,
          revision: p.revision || 0,
          patientId: p.patientId,
          patientName: patientInWorkspace(p.patientId, workspace.id)?.name || '',
          name: p.name,
          status: latest?.status || 'draft',
          versionCount: p.versions.length,
          latestVersion: latest
            ? {
                id: latest.id,
                number: latest.number,
                status: latest.status,
                startDate: latest.startDate,
                mealCount: latest.meals.length,
              }
            : null,
          publishedVersion: published ? published.number : null,
          updatedAt: p.updatedAt,
        };
      });
    return json(res, 200, { mealPlans: plans });
  }
  if (req.method === 'POST' && url.pathname === '/api/meal-plans') {
    if (!hasPermission(store, membership, 'clinical.write'))
      return json(res, 403, { error: 'Permissão clínica necessária.' });
    const b = await body(req);
    if (
      !patientInWorkspace(b.patientId, workspace.id) ||
      !hasClinicalAccess(uid, workspace.id, b.patientId, 'clinical.write')
    )
      return json(res, 404, { error: 'Paciente não encontrado.' });
    const normalized = mealPlanVersion(b, 1);
    if (normalized.error) return json(res, 400, { error: normalized.error });
    const now = new Date().toISOString();
    const plan = {
      id: crypto.randomUUID(),
      userId: uid,
      workspaceId: workspace.id,
      patientId: b.patientId,
      name: b.name.trim(),
      revision: 0,
      versions: [normalized.version],
      publishedVersionId: null,
      createdAt: now,
      updatedAt: now,
    };
    store.mealPlans.push(plan);
    audit(uid, 'meal_plan_created', 'meal_plan', plan.id, workspace.id);
    await persist();
    return json(res, 201, { mealPlan: plan });
  }
  const mealPlanMatch = url.pathname.match(/^\/api\/meal-plans\/([^/]+)$/);
  const draftMatch = url.pathname.match(/^\/api\/meal-plans\/([^/]+)\/draft$/);
  const publishMatch = url.pathname.match(/^\/api\/meal-plans\/([^/]+)\/publish$/);
  if (mealPlanMatch && req.method === 'GET') {
    const plan = store.mealPlans.find(
      (entry) => entry.id === mealPlanMatch[1] && entry.workspaceId === workspace.id,
    );
    if (!plan || !hasClinicalAccess(uid, workspace.id, plan.patientId, 'clinical.read'))
      return json(res, 404, { error: 'Plano alimentar não encontrado.' });
    return json(res, 200, {
      mealPlan: {
        ...plan,
        patientName: patientInWorkspace(plan.patientId, workspace.id)?.name || '',
      },
    });
  }
  if (draftMatch && req.method === 'PUT') {
    const plan = store.mealPlans.find(
      (entry) => entry.id === draftMatch[1] && entry.workspaceId === workspace.id,
    );
    if (!plan || !hasClinicalAccess(uid, workspace.id, plan.patientId, 'clinical.write'))
      return json(res, 404, { error: 'Plano alimentar não encontrado.' });
    const b = await body(req);
    if (!Number.isInteger(b.expectedRevision))
      return json(res, 428, { error: 'Atualize o plano antes de salvar.' });
    if (b.expectedRevision !== (plan.revision || 0))
      return json(res, 409, { error: 'O plano foi alterado. Atualize antes de editar.' });
    if (!validText(b.name, 120)) return json(res, 400, { error: 'Informe o nome do plano.' });
    const latest = plan.versions.at(-1);
    const normalized = mealPlanVersion(
      b,
      latest.status === 'draft' ? latest.number : latest.number + 1,
    );
    if (normalized.error) return json(res, 400, { error: normalized.error });
    const next = normalized.version;
    if (latest.status === 'draft') {
      next.id = latest.id;
      next.number = latest.number;
      next.createdAt = latest.createdAt;
      plan.versions[plan.versions.length - 1] = next;
    } else plan.versions.push(next);
    plan.revision = (plan.revision || 0) + 1;
    plan.name = b.name.trim();
    plan.updatedAt = new Date().toISOString();
    audit(
      uid,
      latest.status === 'draft' ? 'meal_plan_draft_updated' : 'meal_plan_version_created',
      'meal_plan',
      plan.id,
      workspace.id,
    );
    await persist();
    return json(res, 200, { mealPlan: plan });
  }
  if (publishMatch && req.method === 'POST') {
    const plan = store.mealPlans.find(
      (entry) => entry.id === publishMatch[1] && entry.workspaceId === workspace.id,
    );
    if (!plan || !hasClinicalAccess(uid, workspace.id, plan.patientId, 'clinical.write'))
      return json(res, 404, { error: 'Plano alimentar não encontrado.' });
    const b = await body(req);
    if (!Number.isInteger(b.expectedRevision))
      return json(res, 428, { error: 'Atualize o plano antes de publicar.' });
    if (b.expectedRevision !== (plan.revision || 0))
      return json(res, 409, { error: 'O plano foi alterado. Atualize antes de publicar.' });
    const latest = plan.versions.at(-1);
    if (!latest || latest.status !== 'draft')
      return json(res, 409, { error: 'Crie uma nova versão antes de publicar novamente.' });
    if (!canPublish(latest))
      return json(res, 400, {
        error:
          'Adicione pelo menos uma refeição e alimentos com quantidade e unidade antes de publicar.',
      });
    plan.revision = (plan.revision || 0) + 1;
    latest.status = 'published';
    latest.publishedAt = new Date().toISOString();
    plan.publishedVersionId = latest.id;
    plan.updatedAt = latest.publishedAt;
    audit(uid, 'meal_plan_published', 'meal_plan', plan.id, workspace.id);
    await persist();
    return json(res, 200, { mealPlan: plan });
  }
  if (req.method === 'GET' && url.pathname === '/api/appointments') {
    const canManageAgenda = hasPermission(store, membership, 'agenda.manage');
    if (!canManageAgenda && !hasPermission(store, membership, 'appointments.manage'))
      return json(res, 403, { error: 'Permissão de agenda necessária.' });
    const appointments = store.appointments
      .filter(
        (appointment) =>
          appointment.workspaceId === workspace.id &&
          (canManageAgenda ||
            hasClinicalAccess(uid, workspace.id, appointment.patientId, 'clinical.read')),
      )
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((appointment) => ({
        ...appointment,
        notes: hasClinicalAccess(uid, workspace.id, appointment.patientId, 'clinical.read')
          ? appointment.notes
          : '',
        patientName: patientInWorkspace(appointment.patientId, workspace.id)?.name || '',
      }));
    return json(res, 200, { appointments });
  }
  return json(res, 404, { error: 'Rota não encontrada.' });
}
async function serveStatic(pathname, res) {
  let file = [
    '/',
    '/privacy',
    '/terms',
    '/paciente',
    '/paciente/ativar',
    '/paciente/redefinir',
  ].includes(pathname)
    ? 'index.html'
    : decodeURIComponent(pathname).replace(/^\/+/, '');
  let full = path.resolve(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: 'Acesso negado' });
  try {
    const data =
      path.basename(full) === 'config.js'
        ? Buffer.from(
            `window.NUTRITRACK_API_BASE = '';\nwindow.NUTRITRACK_CLINIC_ADMIN_ENABLED = ${CLINIC_ADMIN_ENABLED};\nwindow.NUTRITRACK_EMAIL_VERIFICATION_REQUIRED = ${process.env.NODE_ENV === 'production'};\n`,
          )
        : await fs.readFile(full);
    res.writeHead(200, {
      'content-type': MIME[path.extname(full)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'content-security-policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}
let requestQueue = Promise.resolve();
let pendingRequests = 0;
function bufferedResponse() {
  return {
    headers: {},
    headersSent: false,
    status: 200,
    content: undefined,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    writeHead(status, headers = {}) {
      this.status = status;
      Object.assign(this.headers, headers);
      this.headersSent = true;
    },
    end(content) {
      this.content = content;
    },
  };
}
async function dispatch(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health' || url.pathname === '/ready') {
    if (database) database.db.prepare('SELECT 1').get();
    return json(res, 200, { status: 'ok' });
  }
  enforceRequestPolicy(req);
  if (Number(req.headers['content-length'] || 0) > 1000000) {
    req.resume();
    throw Object.assign(new Error('Corpo muito grande.'), { status: 413 });
  }
  if (!url.pathname.startsWith('/api/')) return handle(req, res);
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    req.parsedBody = await body(req);
    if (
      [
        '/api/login',
        '/api/patient/login',
        '/api/register',
        '/api/auth/password-reset/request',
      ].includes(url.pathname)
    ) {
      const email = String(req.parsedBody.email || '')
        .trim()
        .toLowerCase();
      const error = rateLimit(
        { socket: { remoteAddress: 'account' } },
        url.pathname + ':' + tokenHash(email),
        10,
      );
      if (error) throw error;
    }
  }
  if (pendingRequests >= 64)
    throw Object.assign(new Error('Servidor ocupado. Tente novamente.'), { status: 503 });
  pendingRequests++;
  function requestScope() {
    const session = database.db
      .prepare('SELECT subject_id FROM sessions WHERE kind=? AND token_hash=? AND expires_at>?')
      .get('professional', tokenHash(cookie(req, 'nc_session') || ''), Date.now());
    let workspaceId = String(req.headers['x-workspace-id'] || ''),
      patientId = '';
    if (url.pathname.startsWith('/api/patient/')) {
      let row;
      if (req.parsedBody?.token)
        row = database.db
          .prepare(
            "SELECT data FROM records WHERE collection IN ('patientInvitations','patientPasswordResets') AND json_extract(data,'$.tokenHash')=?",
          )
          .get(tokenHash(String(req.parsedBody.token)));
      if (!row && req.parsedBody?.email)
        row = database.db
          .prepare("SELECT data FROM records WHERE collection='patientAccounts' AND email=?")
          .get(String(req.parsedBody.email).trim().toLowerCase());
      if (!row) {
        const principal = database.db
          .prepare(
            "SELECT subject_id FROM sessions WHERE kind='patient' AND token_hash=? AND expires_at>?",
          )
          .get(tokenHash(cookie(req, 'nt_patient_session') || ''), Date.now());
        if (principal)
          row = database.db
            .prepare("SELECT data FROM records WHERE id=? AND collection='patientAccounts'")
            .get(String(principal.subject_id));
      }
      if (row) {
        const account = JSON.parse(String(row.data));
        patientId = account.patientId || '';
        workspaceId = account.workspaceId || '';
        if (!workspaceId && patientId) {
          const patient = database.db
            .prepare("SELECT workspace_id FROM records WHERE id=? AND collection='patients'")
            .get(patientId);
          workspaceId = String(patient?.workspace_id || '');
        }
      } else workspaceId = '';
    }
    return { workspaceId, userId: String(session?.subject_id || ''), patientId };
  }
  const execute = async () => {
    if (database) {
      try {
        database.begin();
        store = database.load(
          Object.fromEntries(Object.keys(store).map((key) => [key, []])),
          requestScope(),
        );
        sessions.clear();
        patientSessions.clear();
        database.restoreSessions(sessions, patientSessions);
      } catch (error) {
        database.rollback();
        throw error;
      }
    }
    const before = structuredClone(store);
    const previousSessions = [...sessions],
      previousPatientSessions = [...patientSessions];
    const response = bufferedResponse();
    response.requestUrl = req.url;
    try {
      await handle(req, response);
      if (response.status >= 400) {
        store = before;
        if (database) database.rollback();
        sessions.clear();
        patientSessions.clear();
        for (const [key, value] of previousSessions) Map.prototype.set.call(sessions, key, value);
        for (const [key, value] of previousPatientSessions)
          Map.prototype.set.call(patientSessions, key, value);
      } else if (database)
        database.commit(
          before,
          store,
          sessions,
          patientSessions,
          JSON.stringify([previousSessions, previousPatientSessions]),
        );
      if (!res.destroyed) {
        res.writeHead(response.status, response.headers);
        res.end(response.content);
      }
    } catch (error) {
      if (database) database.rollback();
      store = before;
      sessions.clear();
      patientSessions.clear();
      for (const [key, value] of previousSessions) Map.prototype.set.call(sessions, key, value);
      for (const [key, value] of previousPatientSessions)
        Map.prototype.set.call(patientSessions, key, value);
      throw error;
    }
  };
  const result = requestQueue.then(execute);
  requestQueue = result.catch(() => {});
  try {
    await result;
  } finally {
    pendingRequests--;
  }
}
const server = http.createServer((req, res) => {
  const started = Date.now();
  res.on('finish', () =>
    console.log(
      JSON.stringify({
        event: 'request_completed',
        requestId: crypto.randomUUID(),
        method: req.method,
        status: res.statusCode,
        durationMs: Date.now() - started,
      }),
    ),
  );
  dispatch(req, res).catch((error) => {
    console.error(
      JSON.stringify({
        event: 'request_error',
        status: error.status || 500,
        method: req.method,
        durationMs: Date.now() - started,
      }),
    );
    if (!res.headersSent) {
      if (error.retryAfter) res.setHeader('retry-after', String(error.retryAfter));
      json(res, error.status || 500, {
        error: error.status ? error.message : 'Erro interno. Tente novamente.',
      });
    } else res.end();
  });
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
process.on('SIGTERM', () =>
  server.close(() => {
    if (database) database.close();
    process.exit(0);
  }),
);
loadStore()
  .then(async () => {
    if (process.env.NODE_ENV === 'production') {
      await require('./legal').readPolicy('privacy');
      await require('./legal').readPolicy('terms');
    }
  })
  .then(() =>
    server.listen(PORT, HOST, () => console.log(`NutriTrack disponível em http://${HOST}:${PORT}`)),
  )
  .catch((e) => {
    console.error('startup_error', e.message);
    process.exit(1);
  });
