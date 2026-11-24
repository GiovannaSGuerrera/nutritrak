import type { User, Store, AccountContext } from './contracts';
import * as crypto from 'node:crypto';
import { emailEnabled, verificationRequired } from './release-mode';
function scrypt(password: string, salt: string, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, length, (error, key) => (error ? reject(error) : resolve(key))),
  );
}
import { queueMail } from './mail';
import * as totp from './totp';
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
async function verifyPassword(user: User, password: unknown) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const actual = await scrypt(password, user.salt, 64),
    expected = Buffer.from(user.hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
async function revoke(sessions: AccountContext['sessions'], userId: string) {
  await sessions.revoke(userId);
}

function issueToken(store: Store, user: User, purpose: string) {
  if (!emailEnabled()) return;
  const now = Date.now();
  store.authTokens = store.authTokens.filter(
    (token) =>
      token.expiresAt > now &&
      !(purpose !== 'verify' && token.userId === user.id && token.purpose === purpose),
  );
  const token = crypto.randomBytes(32).toString('hex');
  store.authTokens.push({
    id: crypto.randomUUID(),
    userId: user.id,
    purpose,
    tokenHash: hash(token),
    expiresAt: now + 3600000,
  });
  const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000').origin;
  const fragment = purpose === 'verify' ? 'verify-email' : 'reset-password';
  queueMail(
    store,
    {
      to: user.email,
      subject:
        purpose === 'verify'
          ? 'Confirme seu e-mail no NutriTrack'
          : 'Redefina sua senha no NutriTrack',
      text: `Abra este link em até uma hora: ${origin}/#${fragment}=${token}\nSe não solicitou, ignore esta mensagem.`,
    },
    user.id,
  );
}
async function accountRoutes(context: AccountContext) {
  const { req, res, store, sessions, user, body, json, persist, audit } = context;
  const route = new URL(req.url || '/', 'http://localhost').pathname;
  if (
    !emailEnabled() &&
    req.method === 'POST' &&
    [
      '/api/auth/password-reset/request',
      '/api/auth/password-reset/complete',
      '/api/auth/verification/request',
      '/api/auth/verification/complete',
    ].includes(route)
  ) {
    json(res, 503, {
      error:
        'Envio de e-mail indisponível. Recuperação de senha e verificação de e-mail não estão disponíveis.',
    });
    return true;
  }
  if (req.method === 'POST' && route === '/api/auth/password-reset/request') {
    const data = await body(req),
      email = String(data.email || '')
        .trim()
        .toLowerCase();
    const target = store.users.find((row) => row.email === email);
    if (target && target.emailVerified) issueToken(store, target, 'reset');
    await persist();
    json(res, 202, { message: 'Se houver uma conta elegível, enviaremos as instruções.' });
    return true;
  }
  if (
    req.method === 'POST' &&
    ['/api/auth/password-reset/complete', '/api/auth/verification/complete'].includes(route)
  ) {
    const data = await body(req),
      purpose = route.includes('verification') ? 'verify' : 'reset';
    const token = store.authTokens.find(
      (row) =>
        row.purpose === purpose &&
        row.tokenHash === hash(String(data.token || '')) &&
        row.expiresAt > Date.now(),
    );
    const target = token && store.users.find((row) => row.id === token.userId);
    if (!target) {
      json(res, 410, { error: 'Link inválido ou expirado.' });
      return true;
    }
    if (purpose === 'reset') {
      if (
        typeof data.password !== 'string' ||
        data.password.length < 12 ||
        data.password.length > 200
      ) {
        json(res, 400, { error: 'Use uma senha de 12 a 200 caracteres.' });
        return true;
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const encoded = await scrypt(data.password, salt, 64);
      target.salt = salt;
      target.hash = encoded.toString('hex');
      await revoke(sessions, target.id);
    } else {
      if (
        typeof data.password !== 'string' ||
        data.password.length < 12 ||
        data.password.length > 200
      ) {
        json(res, 400, { error: 'Defina sua senha para confirmar o endereço.' });
        return true;
      }
      target.salt = crypto.randomBytes(16).toString('hex');
      target.hash = (await scrypt(data.password, target.salt, 64)).toString('hex');
      delete target.mfaSecret;
      delete target.mfaRecoveryHashes;
      delete target.mfaLastCounter;
      delete target.mfaPending;
      target.emailVerified = true;
      await revoke(sessions, target.id);
    }
    store.authTokens = store.authTokens.filter(
      (row) => !(row.userId === target.id && row.purpose === purpose),
    );
    audit(target.id, purpose === 'verify' ? 'email_verified' : 'password_reset', 'user', target.id);
    await persist();
    json(res, 200, { ok: true });
    return true;
  }
  if (!route.startsWith('/api/account') && route !== '/api/auth/verification/request') return false;
  if (!user) {
    json(res, 401, { error: 'Autenticação necessária.' });
    return true;
  }
  if (req.method === 'POST' && route === '/api/auth/verification/request') {
    if (!user.emailVerified) issueToken(store, user, 'verify');
    await persist();
    json(res, 202, { message: 'Confira seu e-mail.' });
    return true;
  }
  if (verificationRequired() && route.startsWith('/api/account/mfa') && !user.emailVerified) {
    json(res, 403, { error: 'Confirme seu e-mail antes de configurar o segundo fator.' });
    return true;
  }
  if (req.method === 'GET' && route === '/api/account/export') {
    audit(user.id, 'personal_data_exported', 'user', user.id);
    await persist();
    json(res, 200, {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        emailVerified: !!user.emailVerified,
      },
      memberships: store.memberships.filter((row) => row.userId === user.id),
      requests: store.privacyRequests.filter((row) => row.userId === user.id),
    });
    return true;
  }
  const data = await body(req);
  if (!(await verifyPassword(user, data.currentPassword))) {
    json(res, 403, { error: 'Confirme sua senha atual.' });
    return true;
  }
  if (req.method === 'POST' && route === '/api/account/mfa/setup') {
    if (user.mfaSecret) {
      json(res, 409, { error: 'MFA já está ativo.' });
      return true;
    }
    const secret = totp.newSecret();
    user.mfaPending = { encrypted: totp.seal(secret), expiresAt: Date.now() + 600000 };
    await persist();
    json(res, 200, {
      secret,
      uri: `otpauth://totp/NutriTrack:${encodeURIComponent(user.email)}?secret=${secret}&issuer=NutriTrack&algorithm=SHA1&digits=6&period=30`,
    });
    return true;
  }
  if (req.method === 'POST' && route === '/api/account/mfa/confirm') {
    const pending = user.mfaPending,
      counter =
        pending && pending.expiresAt > Date.now()
          ? totp.matchingCounter(totp.unseal(pending.encrypted), data.code)
          : null;
    if (counter === null || !pending) {
      json(res, 400, { error: 'Código inválido ou configuração expirada.' });
      return true;
    }
    const codes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(10).toString('hex').toUpperCase(),
    );
    user.mfaSecret = pending.encrypted;
    user.mfaLastCounter = counter;
    user.mfaRecoveryHashes = codes.map(hash);
    delete user.mfaPending;
    await revoke(sessions, user.id);
    audit(user.id, 'mfa_enabled', 'user', user.id);
    await persist();
    json(res, 200, { recoveryCodes: codes });
    return true;
  }
  if (!totp.checkSecondFactor(user, data)) {
    json(res, 403, { error: 'Informe um código de segundo fator válido.' });
    return true;
  }
  if (req.method === 'POST' && route === '/api/account/mfa/disable') {
    delete user.mfaSecret;
    delete user.mfaRecoveryHashes;
    delete user.mfaLastCounter;
    await revoke(sessions, user.id);
    audit(user.id, 'mfa_disabled', 'user', user.id);
    await persist();
    json(res, 200, { ok: true });
    return true;
  }
  if (req.method === 'POST' && route === '/api/account/password') {
    if (
      typeof data.password !== 'string' ||
      data.password.length < 12 ||
      data.password.length > 200
    ) {
      json(res, 400, { error: 'Use uma senha de 12 a 200 caracteres.' });
      return true;
    }
    user.salt = crypto.randomBytes(16).toString('hex');
    user.hash = (await scrypt(data.password, user.salt, 64)).toString('hex');
    await revoke(sessions, user.id);
    audit(user.id, 'password_changed', 'user', user.id);
    await persist();
    json(res, 200, { ok: true });
    return true;
  }
  if (req.method === 'POST' && route === '/api/account/sessions/revoke') {
    await revoke(sessions, user.id);
    await persist();
    json(res, 200, { ok: true });
    return true;
  }
  if (req.method === 'POST' && route === '/api/account/deletion-request') {
    const existing = store.privacyRequests.find(
      (row) => row.userId === user.id && row.status === 'pending',
    );
    if (!existing)
      store.privacyRequests.push({
        id: crypto.randomUUID(),
        userId: user.id,
        type: 'deletion',
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    audit(user.id, 'deletion_requested', 'user', user.id);
    await persist();
    json(res, 202, {
      message: 'Solicitação registrada. A retenção de prontuários será avaliada antes da exclusão.',
    });
    return true;
  }
  if (req.method === 'DELETE' && route === '/api/account') {
    if (store.patients.some((row) => row.userId === user.id)) {
      json(res, 409, {
        error: 'Há prontuários vinculados. Registre uma solicitação para avaliação de retenção.',
      });
      return true;
    }
    store.memberships = store.memberships.filter((row) => row.userId !== user.id);
    store.authTokens = store.authTokens.filter((row) => row.userId !== user.id);
    store.mailOutbox = store.mailOutbox.filter((row) => row.userId !== user.id);
    store.privacyRequests = store.privacyRequests.filter((row) => row.userId !== user.id);
    (store as unknown as { audit: { userId: string }[] }).audit = (
      store as unknown as { audit: { userId: string }[] }
    ).audit.filter((row) => row.userId !== user.id);
    store.users = store.users.filter((row) => row.id !== user.id);
    await revoke(sessions, user.id);
    await persist();
    json(res, 200, { ok: true });
    return true;
  }
  json(res, 404, { error: 'Rota não encontrada.' });
  return true;
}
export { accountRoutes, issueToken, verifyPassword };
