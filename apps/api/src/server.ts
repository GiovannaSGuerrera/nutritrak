import { accountRoutes, issueToken } from './account-security';
import * as totp from './totp';
import { readPolicy } from './legal';
import { emailEnabled, verificationRequired, legalDocumentsRequired } from './release-mode';
import type { AccountContext, Store, User } from './contracts';
import { readBody, bufferedResponse } from './http-safety';
import { object, dateOnly, patientFields, pageList, revision } from './validation';
import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createPostgresStore } from './postgres-store';
import {
  validateMutation,
  authRoute,
  authBucket,
  consumeLocalAttempt,
  AUTH_LIMIT,
  AUTH_WINDOW_SECONDS,
  securityError,
  securityLog,
} from './security';
function scrypt(password: string, salt: string, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, length, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

const ROOT = path.resolve(__dirname, '../../..');
const PUBLIC_DIR = path.resolve(__dirname, '../../web/public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const STORE = path.join(DATA_DIR, 'store.json');
const PORT = Number(process.env.PORT || 3000);
const postgres = process.env.DATABASE_URL ? createPostgresStore(process.env.DATABASE_URL) : null;
const sessions = new Map<string, string>();
const localSessionExpiry = new Map<string, number>();
const patientSessions = new Map<string, string>();
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const emptyStore = {
  users: [],
  patients: [],
  assessments: [],
  appointments: [],
  goals: [],
  mealPlans: [],
  patientInvitations: [],
  patientPasswordResets: [],
  patientAccounts: [],
  audit: [],
  authTokens: [],
  mailOutbox: [],
  privacyRequests: [],
  memberships: [],
};
let store = structuredClone(emptyStore);
let writeQueue = Promise.resolve();
let requestQueue = Promise.resolve();

function normalizeStore(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('O armazenamento deve conter um objeto JSON.');
  for (const key of Object.keys(emptyStore)) if (!Array.isArray(data[key])) data[key] = [];
  return data;
}

async function readLegacyStore() {
  try {
    return normalizeStore(JSON.parse(await fs.readFile(STORE, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return structuredClone(emptyStore);
  }
}

async function loadStore() {
  if (process.env.NODE_ENV === 'production') {
    if (
      !process.env.APP_ORIGIN ||
      new URL(process.env.APP_ORIGIN).protocol !== 'https:' ||
      !/^[a-f\d]{64}$/i.test(process.env.MAIL_ENCRYPTION_KEY || '')
    )
      throw new Error('Configure APP_ORIGIN HTTPS e MAIL_ENCRYPTION_KEY.');
    if (process.env.DB_AUTO_MIGRATE !== 'false')
      throw new Error('Produção requer migração explícita.');
    if (emailEnabled() && (!process.env.SMTP_HOST || !process.env.MAIL_FROM))
      throw new Error('Configure SMTP ou EMAIL_ENABLED=false.');
    if (legalDocumentsRequired()) await Promise.all([readPolicy('privacy'), readPolicy('terms')]);
  }
  if (postgres) {
    store = normalizeStore(await postgres.initialize(readLegacyStore, '__anonymous__'));
    return;
  }
  if (process.env.NODE_ENV === 'production')
    throw new Error('Configure DATABASE_URL para executar em produção.');
  await fs.mkdir(DATA_DIR, { recursive: true });
  store = await readLegacyStore();
  await persist();
}

function persist() {
  if (postgres) return postgres.save(store);
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      const temp = `${STORE}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
      await fs.rename(temp, STORE);
    });
  return writeQueue;
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  const paging = (res as http.ServerResponse & { pageUrl?: URL }).pageUrl;
  if (status === 200 && paging && object(body) && Object.keys(body).length === 1) {
    const k = Object.keys(body)[0];
    if (
      ['patients', 'assessments', 'appointments', 'goals', 'mealPlans'].includes(k) &&
      Array.isArray(body[k])
    )
      body = pageList(k, body[k], paging);
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}
const body = readBody;

function cookie(req, name) {
  return (req.headers.cookie || '')
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + '='))
    ?.slice(name.length + 1);
}
async function userFor(req) {
  const token = cookie(req, 'nc_session');
  if (!postgres && token && (localSessionExpiry.get(token) || 0) <= Date.now())
    sessions.delete(token);
  const id =
    token &&
    (postgres ? await postgres.getSession(tokenHash(token), 'professional') : sessions.get(token));
  return store.users.find((u) => u.id === id) || null;
}
async function patientAccountFor(req) {
  const token = cookie(req, 'nt_patient_session');
  if (!postgres && token && (localSessionExpiry.get(token) || 0) <= Date.now())
    patientSessions.delete(token);
  const id =
    token &&
    (postgres
      ? await postgres.getSession(tokenHash(token), 'patient')
      : patientSessions.get(token));
  return store.patientAccounts.find((a) => a.id === id) || null;
}
function setSessionCookie(res, name, token, maxAge) {
  res.setHeader(
    'set-cookie',
    `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
}
function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function safePatientPortal(account) {
  const patient = store.patients.find(
    (p) => p.id === account.patientId && p.userId === account.professionalId,
  );
  if (!patient || patient.status === 'Arquivado') return null;
  const professional = store.users.find((u) => u.id === account.professionalId);
  const mealPlans = store.mealPlans
    .filter(
      (p) =>
        p.patientId === patient.id && p.userId === account.professionalId && p.publishedVersionId,
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
    mfaEnabled: !!u.mfaSecret,
    securityFeatures: true,
    verificationRequired: verificationRequired(),
    emailDeliveryEnabled: emailEnabled(),
  };
}
function validText(v: unknown, max = 5000): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}
function owned(list, id, userId) {
  return list.find((x) => x.id === id && x.userId === userId);
}
function audit(userId, action, type, recordId) {
  store.audit.unshift({
    id: crypto.randomUUID(),
    userId,
    action,
    type,
    recordId,
    at: new Date().toISOString(),
  });
  const cutoff = Date.now() - Number(process.env.AUDIT_RETENTION_DAYS || 90) * 86400000;
  store.audit = store.audit.filter((row) => Date.parse(row.at) >= cutoff);
}
function compareAssessmentsNewestFirst(a, b) {
  return (
    b.date.localeCompare(a.date) ||
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  );
}
function mealPlanVersion(input, number) {
  if (!object(input) || !dateOnly(input.startDate) || !dateOnly(input.reviewDate))
    return { error: 'Datas do plano inválidas.' };
  if (!validText(input.name, 120)) return { error: 'Informe o nome do plano.' };
  if (!Array.isArray(input.meals) || input.meals.length > 12)
    return { error: 'O plano pode conter até 12 refeições.' };
  const meals = [];
  for (const meal of input.meals) {
    if (!object(meal)) return { error: 'Refeição inválida.' };
    if (!validText(meal.name, 100)) return { error: 'Cada refeição precisa de um nome.' };
    if (!Array.isArray(meal.items) || meal.items.length > 40)
      return { error: 'Cada refeição pode conter até 40 itens.' };
    const items = [];
    for (const item of meal.items) {
      if (!object(item)) return { error: 'Alimento inválido.' };
      if (!validText(item.food, 180)) return { error: 'Informe o nome de cada alimento.' };
      if (
        item.quantity != null &&
        item.quantity !== '' &&
        !['string', 'number'].includes(typeof item.quantity)
      )
        return { error: 'Quantidade inválida.' };
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
async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    if (!['GET', 'HEAD'].includes(req.method || 'GET'))
      return json(res, 405, { error: 'Método não permitido.' });
    return serveStatic(url.pathname, res);
  }
  if (req.method === 'GET' && ['/api/legal/privacy', '/api/legal/terms'].includes(url.pathname))
    return json(res, 200, await readPolicy(url.pathname.endsWith('privacy') ? 'privacy' : 'terms'));
  if (
    await accountRoutes({
      req,
      res,
      store: store as unknown as Store,
      user: await userFor(req),
      body,
      json,
      persist,
      audit,
      sessions: {
        async revoke(userId) {
          if (postgres) await postgres.revokeProfessionalSessions(userId);
          for (const [token, id] of sessions) if (id === userId) sessions.delete(token);
        },
      },
    } as AccountContext)
  )
    return;
  if (req.method === 'GET' && url.pathname === '/api/me') {
    const u = await userFor(req);
    return u
      ? json(res, 200, { user: safeUser(u) })
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
      (p) => p.id === invite.patientId && p.userId === invite.professionalId,
    );
    const professional = store.users.find((u) => u.id === invite.professionalId);
    if (!patient || patient.status === 'Arquivado')
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
      (p) => p.id === invite.patientId && p.userId === invite.professionalId,
    );
    if (!patient || patient.status === 'Arquivado')
      return json(res, 410, { error: 'Este convite não está mais disponível.' });
    if (
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
    if (postgres)
      await postgres.createSession(tokenHash(session), 'patient', account.id, account.hash);
    else {
      patientSessions.set(session, account.id);
      localSessionExpiry.set(session, Date.now() + 28800000);
    }
    setSessionCookie(res, 'nt_patient_session', session, 28800);
    return json(res, 201, { portal: safePatientPortal(account) });
  }
  if (req.method === 'POST' && url.pathname === '/api/patient/login') {
    const b = await body(req);
    const email = String(b.email || '')
      .trim()
      .toLowerCase();
    const account = store.patientAccounts.find((a) => a.email === email);
    if (!account && typeof b.password === 'string' && b.password.length <= 200)
      await scrypt(b.password, '0'.repeat(32), 64);
    if (
      !account ||
      typeof b.password !== 'string' ||
      b.password.length > 200 ||
      !crypto.timingSafeEqual(
        await scrypt(b.password, account.salt, 64),
        Buffer.from(account.hash, 'hex'),
      )
    )
      return json(res, 401, { error: 'E-mail ou senha incorretos.' });
    const portal = safePatientPortal(account);
    if (!portal)
      return json(res, 403, {
        error: 'Acesso ao portal indisponível. Entre em contato com o profissional.',
      });
    const session = crypto.randomBytes(32).toString('hex');
    if (postgres)
      await postgres.createSession(tokenHash(session), 'patient', account.id, account.hash);
    else {
      patientSessions.set(session, account.id);
      localSessionExpiry.set(session, Date.now() + 28800000);
    }
    setSessionCookie(res, 'nt_patient_session', session, 28800);
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
    if (!account)
      return json(res, 410, {
        error: 'Este acesso não está mais disponível. Entre em contato com o profissional.',
      });
    const patient = store.patients.find(
      (p) => p.id === account.patientId && p.userId === account.professionalId,
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
    if (!account)
      return json(res, 410, {
        error: 'Este acesso não está mais disponível. Entre em contato com o profissional.',
      });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await scrypt(b.password, salt, 64);
    account.salt = salt;
    account.hash = hash.toString('hex');
    account.passwordUpdatedAt = new Date().toISOString();
    reset.usedAt = new Date().toISOString();
    for (const session of patientSessions.keys())
      if (patientSessions.get(session) === account.id) patientSessions.delete(session);
    audit(account.professionalId, 'patient_portal_password_reset', 'patient', account.patientId);
    await persist();
    if (postgres) await postgres.revokePatientSessions(account.id);
    setSessionCookie(res, 'nt_patient_session', '', 0);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/patient/logout') {
    const session = cookie(req, 'nt_patient_session');
    if (session) {
      if (postgres) await postgres.deleteSession(tokenHash(session));
      else patientSessions.delete(session);
    }
    setSessionCookie(res, 'nt_patient_session', '', 0);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/patient/export') {
    const account = await patientAccountFor(req);
    const portal = account && safePatientPortal(account);
    return portal
      ? json(res, 200, { exportedAt: new Date().toISOString(), portal })
      : json(res, 401, { error: 'Entre no portal.' });
  }
  if (req.method === 'GET' && url.pathname === '/api/patient/me') {
    const account = await patientAccountFor(req);
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
    if (
      email.length > 254 ||
      !validText(b.name, 120) ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      typeof b.password !== 'string' ||
      b.password.length < 12 ||
      b.password.length > 200
    )
      return json(res, 400, {
        error: 'Informe nome, e-mail válido e senha com pelo menos 12 caracteres.',
      });
    if (
      store.users.some((u) => u.email === email) ||
      store.patientAccounts.some((a) => a.email === email)
    ) {
      if (process.env.NODE_ENV === 'production') {
        const existing = store.users.find((row) => row.email === email);
        if (existing && !existing.emailVerified) {
          issueToken(store as unknown as Store, existing as User, 'verify');
          await persist();
        }
        return json(res, 202, {
          message: emailEnabled()
            ? 'Se elegível, você receberá as instruções por e-mail.'
            : 'Se já possui uma conta, entre com sua senha.',
        });
      }
      return json(res, 409, { error: 'Já existe uma conta com esse e-mail.' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await scrypt(b.password, salt, 64);
    const u = {
      id: crypto.randomUUID(),
      name: String(b.name).trim(),
      email,
      salt,
      hash: hash.toString('hex'),
      createdAt: new Date().toISOString(),
    };
    store.users.push(u);
    if (process.env.NODE_ENV !== 'production')
      issueToken(store as unknown as Store, u as User, 'verify');
    audit(u.id, 'account_created', 'user', u.id);
    if (verificationRequired()) {
      issueToken(store as unknown as Store, u as User, 'verify');
      await persist();
      return json(res, 202, { message: 'Se elegível, você receberá as instruções por e-mail.' });
    }
    await persist();
    if (!totp.checkSecondFactor(u as User, b))
      return json(res, 401, { error: 'E-mail, senha ou segundo fator incorretos.' });
    if ((u as User).mfaSecret) await persist();
    const token = crypto.randomBytes(32).toString('hex');
    if (postgres)
      await postgres.createSession(
        tokenHash(token),
        'professional',
        u.id,
        u.hash,
        (u as User).authVersion || 0,
      );
    else {
      sessions.set(token, u.id);
      localSessionExpiry.set(token, Date.now() + 28800000);
    }
    res.setHeader(
      'set-cookie',
      `nc_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
    );
    return json(res, 201, { user: safeUser(u) });
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const b = await body(req);
    const email = String(b.email || '')
      .trim()
      .toLowerCase();
    const u = store.users.find((x) => x.email === email);
    if (!u && typeof b.password === 'string' && b.password.length <= 200)
      await scrypt(b.password, '0'.repeat(32), 64);
    if (
      !u ||
      typeof b.password !== 'string' ||
      b.password.length > 200 ||
      !crypto.timingSafeEqual(await scrypt(b.password, u.salt, 64), Buffer.from(u.hash, 'hex'))
    )
      return json(res, 401, { error: 'E-mail ou senha incorretos.' });
    if (!totp.checkSecondFactor(u as User, b))
      return json(res, 401, {
        error: 'Informe o código do autenticador ou um código de recuperação.',
        mfaRequired: true,
      });
    if ((u as User).mfaSecret) await persist();
    const token = crypto.randomBytes(32).toString('hex');
    if (postgres)
      await postgres.createSession(
        tokenHash(token),
        'professional',
        u.id,
        u.hash,
        (u as User).authVersion || 0,
      );
    else {
      sessions.set(token, u.id);
      localSessionExpiry.set(token, Date.now() + 28800000);
    }
    res.setHeader(
      'set-cookie',
      `nc_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
    );
    return json(res, 200, { user: safeUser(u) });
  }
  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const token = cookie(req, 'nc_session');
    if (!postgres && token && (localSessionExpiry.get(token) || 0) <= Date.now())
      sessions.delete(token);
    if (token) {
      if (postgres) await postgres.deleteSession(tokenHash(token));
      else sessions.delete(token);
    }
    setSessionCookie(res, 'nc_session', '', 0);
    return json(res, 200, { ok: true });
  }

  const u = await userFor(req);
  if (!u) return json(res, 401, { error: 'Autenticação necessária' });
  if (verificationRequired() && !u.emailVerified)
    return json(res, 403, { error: 'Confirme seu e-mail para acessar os dados clínicos.' });
  const uid = u.id;
  const exportMatch = url.pathname.match(/^\/api\/patients\/([^/]+)\/export$/);
  if (req.method === 'GET' && exportMatch) {
    const patient = owned(store.patients, exportMatch[1], uid);
    if (!patient) return json(res, 404, { error: 'Paciente não encontrado.' });
    audit(uid, 'clinical_data_exported', 'patient', patient.id);
    await persist();
    return json(res, 200, {
      exportedAt: new Date().toISOString(),
      patient,
      assessments: store.assessments.filter((x) => x.userId === uid && x.patientId === patient.id),
      appointments: store.appointments.filter(
        (x) => x.userId === uid && x.patientId === patient.id,
      ),
      goals: store.goals.filter((x) => x.userId === uid && x.patientId === patient.id),
      mealPlans: store.mealPlans.filter((x) => x.userId === uid && x.patientId === patient.id),
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/dashboard') {
    const patients = store.patients.filter((x) => x.userId === uid);
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 7 * 86400000).toISOString();
    const assessments = store.assessments.filter((x) => x.userId === uid);
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
      .filter((x) => x.userId === uid && x.status === 'agendada')
      .sort((a, b) => a.start.localeCompare(b.start));
    const activePatients = patients.filter((x) => x.status === 'Ativo');
    return json(res, 200, {
      patients: patients.length,
      activePatients: activePatients.length,
      activeWithoutAssessment: activePatients.filter((x) => !assessedPatientIds.has(x.id)).length,
      totalAssessments: assessments.length,
      newThisMonth: patients.filter((x) => x.createdAt.slice(0, 7) === today.slice(0, 7)).length,
      newPatientsByMonth,
      todayAppointments: appointments.filter((x) => x.start.slice(0, 10) === today).length,
      nextWeek: appointments.filter((x) => x.start >= new Date().toISOString() && x.start <= future)
        .length,
      upcoming: appointments.slice(0, 5).map((a) => ({
        ...a,
        patientName: owned(store.patients, a.patientId, uid)?.name || 'Paciente arquivado',
      })),
      recent: store.audit.filter((x) => x.userId === uid).slice(0, 8),
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/patients')
    return json(res, 200, {
      patients: store.patients
        .filter((x) => x.userId === uid)
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  if (req.method === 'POST' && url.pathname === '/api/patients') {
    const b = await body(req);
    if (!validText(b.name, 150)) return json(res, 400, { error: 'Nome completo é obrigatório.' });
    patientFields(b);
    const p = {
      id: crypto.randomUUID(),
      userId: uid,
      name: String(b.name).trim(),
      email: String(b.email || '').slice(0, 254),
      phone: String(b.phone || '').slice(0, 40),
      birthDate: String(b.birthDate || ''),
      status: ['Ativo', 'Em pausa', 'Arquivado'].includes(String(b.status)) ? b.status : 'Ativo',
      objective: String(b.objective || '').slice(0, 500),
      clinicalNotes: String(b.clinicalNotes || '').slice(0, 5000),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.patients.push(p);
    audit(uid, 'patient_created', 'patient', p.id);
    await persist();
    return json(res, 201, { patient: p });
  }
  const patientMatch = url.pathname.match(/^\/api\/patients\/([^/]+)$/);
  if (patientMatch && req.method === 'PATCH') {
    const p = owned(store.patients, patientMatch[1], uid);
    if (!p) return json(res, 404, { error: 'Paciente não encontrado.' });
    const b = await body(req);
    patientFields(b, true);
    for (const k of ['name', 'email', 'phone', 'birthDate', 'status', 'objective', 'clinicalNotes'])
      if (b[k] !== undefined) p[k] = String(b[k]).slice(0, k === 'clinicalNotes' ? 5000 : 500);
    if (!validText(p.name, 150)) return json(res, 400, { error: 'Nome inválido.' });
    p.updatedAt = new Date().toISOString();
    audit(uid, 'patient_updated', 'patient', p.id);
    await persist();
    return json(res, 200, { patient: p });
  }
  if (patientMatch && req.method === 'GET') {
    const p = owned(store.patients, patientMatch[1], uid);
    if (!p) return json(res, 404, { error: 'Paciente não encontrado.' });
    const account = store.patientAccounts.find(
      (a) => a.patientId === p.id && a.professionalId === uid,
    );
    return json(res, 200, {
      patient: p,
      portal: { enabled: !!account, email: account?.email || null },
      assessments: store.assessments
        .filter((x) => x.patientId === p.id && x.userId === uid)
        .sort(compareAssessmentsNewestFirst),
      appointments: store.appointments
        .filter((x) => x.patientId === p.id && x.userId === uid)
        .sort((a, b) => b.start.localeCompare(a.start)),
      goals: store.goals.filter((x) => x.patientId === p.id && x.userId === uid),
    });
  }
  const inviteMatch = url.pathname.match(/^\/api\/patients\/([^/]+)\/invitations$/);
  if (inviteMatch && req.method === 'POST') {
    const patient = owned(store.patients, inviteMatch[1], uid);
    if (!patient) return json(res, 404, { error: 'Paciente não encontrado.' });
    if (patient.status === 'Arquivado')
      return json(res, 409, { error: 'Não é possível convidar um paciente arquivado.' });
    if (!/^\S+@\S+\.\S+$/.test(String(patient.email || '').trim()))
      return json(res, 400, {
        error: 'Cadastre um e-mail válido no perfil do paciente antes de convidá-lo.',
      });
    if (store.patientAccounts.some((a) => a.patientId === patient.id && a.professionalId === uid))
      return json(res, 409, { error: 'Este paciente já tem acesso ao portal.' });
    const now = Date.now();
    for (const invite of store.patientInvitations)
      if (
        invite.patientId === patient.id &&
        invite.professionalId === uid &&
        !invite.usedAt &&
        !invite.revokedAt
      )
        invite.revokedAt = new Date(now).toISOString();
    const token = crypto.randomBytes(32).toString('hex');
    const invite = {
      id: crypto.randomUUID(),
      patientId: patient.id,
      professionalId: uid,
      tokenHash: tokenHash(token),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 86400000).toISOString(),
      usedAt: null,
      revokedAt: null,
    };
    store.patientInvitations.push(invite);
    audit(uid, 'patient_portal_invite_created', 'patient', patient.id);
    await persist();
    return json(res, 201, { token, expiresAt: invite.expiresAt });
  }
  const resetMatch = url.pathname.match(/^\/api\/patients\/([^/]+)\/password-resets$/);
  if (resetMatch && req.method === 'POST') {
    const patient = owned(store.patients, resetMatch[1], uid);
    if (!patient) return json(res, 404, { error: 'Paciente não encontrado.' });
    const account = store.patientAccounts.find(
      (a) => a.patientId === patient.id && a.professionalId === uid,
    );
    if (!account) return json(res, 409, { error: 'Este paciente ainda não ativou o portal.' });
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
    audit(uid, 'patient_portal_password_reset_created', 'patient', patient.id);
    await persist();
    return json(res, 201, { token, expiresAt: reset.expiresAt });
  }
  if (req.method === 'GET' && url.pathname === '/api/assessments') {
    const assessments = store.assessments
      .filter((x) => x.userId === uid)
      .sort(compareAssessmentsNewestFirst)
      .map((a) => ({ ...a, patientName: owned(store.patients, a.patientId, uid)?.name || '' }));
    return json(res, 200, { assessments });
  }
  if (req.method === 'POST' && url.pathname === '/api/assessments') {
    const b = await body(req);
    if (!owned(store.patients, b.patientId, uid))
      return json(res, 404, { error: 'Paciente não encontrado.' });
    if (!dateOnly(b.date)) return json(res, 400, { error: 'Data inválida.' });
    const n = (k) => {
      if (b[k] === '' || b[k] == null) return null;
      if (!['string', 'number'].includes(typeof b[k])) throw securityError(400, 'Medida inválida.');
      const value = Number(b[k]);
      if (!Number.isFinite(value)) throw securityError(400, 'Medida inválida.');
      return value;
    };
    for (const key of ['waist', 'hip']) {
      const value = n(key);
      if (value !== null && (value <= 0 || value > 5000))
        throw securityError(400, 'Medida inválida.');
    }
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
      patientId: b.patientId,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date))
        ? b.date
        : new Date().toISOString().slice(0, 10),
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
    audit(uid, 'assessment_created', 'assessment', a.id);
    await persist();
    return json(res, 201, { assessment: a });
  }
  if (req.method === 'POST' && url.pathname === '/api/appointments') {
    const b = await body(req);
    if (!owned(store.patients, b.patientId, uid))
      return json(res, 404, { error: 'Paciente não encontrado.' });
    if (
      typeof b.start !== 'string' ||
      (b.duration != null && !['string', 'number'].includes(typeof b.duration))
    )
      return json(res, 400, { error: 'Data ou duração inválida.' });
    const start = Date.parse(String(b.start));
    const duration = b.duration == null ? 50 : Number(b.duration);
    if (!Number.isInteger(duration) || duration < 15 || duration > 240)
      return json(res, 400, { error: 'Duração inválida.' });
    if (!Number.isFinite(start) || start < Date.now() - 60000)
      return json(res, 400, { error: 'Informe uma data futura válida.' });
    const end = new Date(start + duration * 60000).toISOString();
    const conflict = store.appointments.some(
      (a) =>
        a.userId === uid &&
        a.status === 'agendada' &&
        Date.parse(a.start) < Date.parse(end) &&
        Date.parse(a.end) > start,
    );
    if (conflict) return json(res, 409, { error: 'Já existe uma consulta nesse horário.' });
    const a = {
      id: crypto.randomUUID(),
      userId: uid,
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
    audit(uid, 'appointment_created', 'appointment', a.id);
    await persist();
    return json(res, 201, { appointment: a });
  }
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/appointments/')) {
    const id = url.pathname.split('/').at(-1);
    const a = owned(store.appointments, id, uid);
    if (!a) return json(res, 404, { error: 'Consulta não encontrada.' });
    const b = await body(req);
    if (!['agendada', 'realizada', 'cancelada', 'falta'].includes(String(b.status)))
      return json(res, 400, { error: 'Status inválido.' });
    if (
      b.status === 'agendada' &&
      store.appointments.some(
        (other) =>
          other.id !== a.id &&
          other.userId === uid &&
          other.status === 'agendada' &&
          Date.parse(other.start) < Date.parse(a.end) &&
          Date.parse(other.end) > Date.parse(a.start),
      )
    )
      return json(res, 409, { error: 'Já existe uma consulta nesse horário.' });
    a.status = b.status;
    audit(uid, 'appointment_status_changed', 'appointment', a.id);
    await persist();
    return json(res, 200, { appointment: a });
  }
  if (req.method === 'GET' && url.pathname === '/api/goals')
    return json(res, 200, {
      goals: store.goals
        .filter((x) => x.userId === uid)
        .map((g) => ({ ...g, patientName: owned(store.patients, g.patientId, uid)?.name || '' })),
    });
  if (req.method === 'POST' && url.pathname === '/api/goals') {
    const b = await body(req);
    if (!owned(store.patients, b.patientId, uid))
      return json(res, 404, { error: 'Paciente não encontrado.' });
    if (!validText(b.description, 500))
      return json(res, 400, { error: 'Descrição da meta é obrigatória.' });
    if (!dateOnly(b.dueDate)) return json(res, 400, { error: 'Prazo inválido.' });
    const g = {
      id: crypto.randomUUID(),
      userId: uid,
      patientId: b.patientId,
      description: b.description.trim(),
      category: String(b.category || 'Hábitos').slice(0, 60),
      dueDate: String(b.dueDate || ''),
      status: 'ativa',
      progress: [],
      createdAt: new Date().toISOString(),
    };
    store.goals.push(g);
    audit(uid, 'goal_created', 'goal', g.id);
    await persist();
    return json(res, 201, { goal: g });
  }
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/goals/')) {
    const id = url.pathname.split('/').at(-1);
    const g = owned(store.goals, id, uid);
    if (!g) return json(res, 404, { error: 'Meta não encontrada.' });
    const b = await body(req);
    if (!['ativa', 'concluida', 'pausada'].includes(String(b.status)))
      return json(res, 400, { error: 'Status inválido.' });
    g.status = b.status;
    if (validText(b.note, 1000))
      g.progress.push({ note: b.note.trim(), at: new Date().toISOString() });
    audit(uid, 'goal_updated', 'goal', g.id);
    await persist();
    return json(res, 200, { goal: g });
  }
  if (req.method === 'GET' && url.pathname === '/api/meal-plans') {
    const plans = store.mealPlans
      .filter((p) => p.userId === uid)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => {
        const latest = p.versions.at(-1);
        const published = p.versions.find((v) => v.id === p.publishedVersionId);
        return {
          id: p.id,
          patientId: p.patientId,
          patientName: owned(store.patients, p.patientId, uid)?.name || '',
          name: p.name,
          revision: p.revision || 0,
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
    const b = await body(req);
    if (!owned(store.patients, b.patientId, uid))
      return json(res, 404, { error: 'Paciente não encontrado.' });
    const normalized = mealPlanVersion(b, 1);
    if (normalized.error) return json(res, 400, { error: normalized.error });
    const now = new Date().toISOString();
    const plan = {
      id: crypto.randomUUID(),
      userId: uid,
      patientId: b.patientId,
      name: String(b.name).trim(),
      revision: 0,
      versions: [normalized.version],
      publishedVersionId: null,
      createdAt: now,
      updatedAt: now,
    };
    store.mealPlans.push(plan);
    audit(uid, 'meal_plan_created', 'meal_plan', plan.id);
    await persist();
    return json(res, 201, { mealPlan: plan });
  }
  const mealPlanMatch = url.pathname.match(/^\/api\/meal-plans\/([^/]+)$/);
  const draftMatch = url.pathname.match(/^\/api\/meal-plans\/([^/]+)\/draft$/);
  const publishMatch = url.pathname.match(/^\/api\/meal-plans\/([^/]+)\/publish$/);
  if (mealPlanMatch && req.method === 'GET') {
    const plan = owned(store.mealPlans, mealPlanMatch[1], uid);
    if (!plan) return json(res, 404, { error: 'Plano alimentar não encontrado.' });
    return json(res, 200, {
      mealPlan: { ...plan, patientName: owned(store.patients, plan.patientId, uid)?.name || '' },
    });
  }
  if (draftMatch && req.method === 'PUT') {
    const plan = owned(store.mealPlans, draftMatch[1], uid);
    if (!plan) return json(res, 404, { error: 'Plano alimentar não encontrado.' });
    const b = await body(req);
    revision(plan, b.expectedRevision);
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
    );
    await persist();
    return json(res, 200, { mealPlan: plan });
  }
  if (publishMatch && req.method === 'POST') {
    const plan = owned(store.mealPlans, publishMatch[1], uid);
    if (!plan) return json(res, 404, { error: 'Plano alimentar não encontrado.' });
    revision(plan, (await body(req)).expectedRevision);
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
    audit(uid, 'meal_plan_published', 'meal_plan', plan.id);
    await persist();
    return json(res, 200, { mealPlan: plan });
  }
  if (req.method === 'GET' && url.pathname === '/api/appointments') {
    const appointments = store.appointments
      .filter((a) => a.userId === uid)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((a) => ({ ...a, patientName: owned(store.patients, a.patientId, uid)?.name || '' }));
    return json(res, 200, { appointments });
  }
  return json(res, 404, { error: 'Rota não encontrada.' });
}
async function serveStatic(pathname: string, res: http.ServerResponse) {
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
    const data = await fs.readFile(full);
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
let initialization: Promise<void> | undefined;

function ensureInitialized() {
  initialization ??= loadStore().catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

let pendingRequests = 0;
let healthInFlight = 0;
export async function requestHandler(req: http.IncomingMessage, res: http.ServerResponse) {
  const requestId = crypto.randomUUID(),
    started = Date.now();
  res.setHeader('x-request-id', requestId);
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production')
    res.setHeader('strict-transport-security', 'max-age=31536000');
  res.on('finish', () => {
    if (req.url?.startsWith('/api/'))
      securityLog('http_request', {
        status: res.statusCode,
        method: req.method,
        requestId,
        durationMs: Date.now() - started,
      });
  });
  let counted = false;
  try {
    if (!req.url?.startsWith('/api/')) {
      await handle(req, res);
      return;
    }
    validateMutation(req);
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && pathname === '/api/live') return json(res, 200, { ok: true });
    if (req.method === 'GET' && ['/api/health', '/api/ready'].includes(pathname)) {
      if (healthInFlight >= 4) return json(res, 503, { ok: false });
      healthInFlight++;
      try {
        await ensureInitialized();
        if (postgres) await postgres.health();
        return json(res, 200, { ok: true });
      } catch {
        return json(res, 503, { ok: false });
      } finally {
        healthInFlight--;
      }
    }
    if (req.method === 'GET' && pathname === '/api/jobs/mail') {
      const expected = process.env.CRON_SECRET,
        supplied = req.headers.authorization;
      if (
        !expected ||
        expected.length < 32 ||
        typeof supplied !== 'string' ||
        Buffer.byteLength(supplied) !== Buffer.byteLength('Bearer ' + expected) ||
        !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from('Bearer ' + expected))
      )
        return json(res, 401, { error: 'Autenticação necessária.' });
      await ensureInitialized();
      if (!postgres) return json(res, 503, { error: 'Banco requerido.' });
      return json(res, 200, { delivered: await postgres.dispatchMail() });
    }
    if (pendingRequests >= 64) throw securityError(503, 'Serviço ocupado. Tente novamente.');
    pendingRequests++;
    counted = true;
    // Parsing is bounded independently of the domain queue. A partial body cannot block others.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')) await body(req);
    let deliverMail = false;
    let readyResponse: ReturnType<typeof bufferedResponse> | undefined;
    const operation = requestQueue.then(async () => {
      await ensureInitialized();
      if (req.aborted || res.destroyed) return;
      const globalAllowed = postgres
        ? await postgres.consumeAuthAttempt('global:' + authBucket(req), 1000, 900)
        : consumeLocalAttempt('global:' + authBucket(req), Date.now(), 1000);
      if (!globalAllowed) throw securityError(429, 'Muitas requisições. Aguarde.');
      if (
        ['POST', 'DELETE'].includes(req.method || '') &&
        (authRoute(pathname) || pathname.startsWith('/api/account'))
      ) {
        const allowed = postgres
          ? await postgres.consumeAuthAttempt(authBucket(req), AUTH_LIMIT, AUTH_WINDOW_SECONDS)
          : consumeLocalAttempt(authBucket(req));
        if (!allowed) {
          res.setHeader('retry-after', String(AUTH_WINDOW_SECONDS));
          throw securityError(429, 'Muitas tentativas. Aguarde15minutos.');
        }
        const credentials = await body(req);
        if (typeof credentials.email === 'string') {
          const bucket =
            'account:' + pathname + ':' + tokenHash(credentials.email.trim().toLowerCase());
          const allowedAccount = postgres
            ? await postgres.consumeAuthAttempt(bucket, 10, 900)
            : consumeLocalAttempt(bucket, Date.now(), 10);
          if (!allowedAccount) throw securityError(429, 'Muitas tentativas. Aguarde15minutos.');
        }
      }
      if (postgres) {
        const data = ['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')
          ? {}
          : await body(req);
        const publicIdentity = [
          '/api/login',
          '/api/register',
          '/api/patient/login',
          '/api/patient/activate',
          '/api/patient/invitations/validate',
          '/api/patient/password-resets/validate',
          '/api/patient/password-resets/complete',
          '/api/auth/password-reset/request',
          '/api/auth/password-reset/complete',
          '/api/auth/verification/complete',
        ].includes(pathname);
        const professionalToken = publicIdentity ? undefined : cookie(req, 'nc_session'),
          patientToken = publicIdentity ? undefined : cookie(req, 'nt_patient_session');
        const owner = await postgres.ownerForRequest({
          professionalToken: professionalToken ? tokenHash(professionalToken) : undefined,
          patientToken: patientToken ? tokenHash(patientToken) : undefined,
          email:
            publicIdentity && typeof data.email === 'string'
              ? data.email.trim().toLowerCase()
              : undefined,
          token:
            publicIdentity && typeof data.token === 'string' ? tokenHash(data.token) : undefined,
        });
        store = normalizeStore(await postgres.load(owner));
      }
      const before = structuredClone(store),
        professionalBefore = new Map(sessions),
        patientBefore = new Map(patientSessions);
      const buffered = bufferedResponse();
      (buffered.response as http.ServerResponse & { pageUrl?: URL }).pageUrl = new URL(
        req.url,
        'http://localhost',
      );
      try {
        await handle(req, buffered.response);
        if (buffered.status >= 400) {
          store = before;
          sessions.clear();
          for (const [k, v] of professionalBefore) sessions.set(k, v);
          patientSessions.clear();
          for (const [k, v] of patientBefore) patientSessions.set(k, v);
        }
        deliverMail =
          buffered.status < 400 &&
          store.mailOutbox.some((item) => !before.mailOutbox.some((old) => old.id === item.id));
        readyResponse = buffered;
      } catch (error) {
        store = before;
        sessions.clear();
        for (const [k, v] of professionalBefore) sessions.set(k, v);
        patientSessions.clear();
        for (const [k, v] of patientBefore) patientSessions.set(k, v);
        throw error;
      }
    });
    requestQueue = operation.catch(() => {});
    await operation;
    // SMTP is outside the domain queue and only after committed state. Failures retain the outbox.
    if (deliverMail && postgres) {
      try {
        await postgres.dispatchMail();
      } catch {
        securityLog('mail_dispatch_failed');
      }
    }
    readyResponse?.flush(res);
  } catch (error) {
    if (
      error.code === '23505' &&
      req.method === 'POST' &&
      req.url === '/api/register' &&
      process.env.NODE_ENV === 'production'
    )
      return json(res, 202, { message: 'Se elegível, você receberá as instruções por e-mail.' });
    const status = error.status || (error.code === '23505' || error.code === '23503' ? 409 : 500);
    securityLog('request_error', { status, method: req.method, requestId });
    if (!res.headersSent && !res.destroyed)
      json(res, status, {
        error: error.status
          ? error.message
          : status === 409
            ? 'O registro já existe ou mudou. Recarregue.'
            : 'Erro interno. Tente novamente.',
      });
    else if (!res.destroyed) res.end();
  } finally {
    if (counted) pendingRequests--;
  }
}

if (require.main === module) {
  ensureInitialized()
    .then(() => {
      const server = http.createServer(requestHandler);
      server.requestTimeout = 15000;
      server.headersTimeout = 10000;
      server.keepAliveTimeout = 5000;
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
      server.listen(PORT, () => console.log(`NutriTrack disponível em http://localhost:${PORT}`));
    })
    .catch(() => {
      console.error('startup_error');
      process.exit(1);
    });
}
