const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { server, databaseUrl, isolated } = require('./helpers.cjs');
const { issueToken } = require('../dist/account-security');
const { sendPending } = require('../dist/mail-worker');
const mode = require('../dist/release-mode');

test('modo sem e-mail é explícito e não altera o padrão de verificação', async (t) => {
  const before = { ...process.env };
  t.after(() => {
    for (const key of ['EMAIL_ENABLED', 'NODE_ENV', 'LEGAL_DOCUMENTS_REQUIRED']) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });
  process.env.NODE_ENV = 'production';
  delete process.env.EMAIL_ENABLED;
  delete process.env.LEGAL_DOCUMENTS_REQUIRED;
  assert.equal(mode.verificationRequired(), true);
  assert.equal(mode.legalDocumentsRequired(), true);
  process.env.EMAIL_ENABLED = 'false';
  assert.equal(mode.verificationRequired(), false);
  const store = { authTokens: [], mailOutbox: [] };
  issueToken(store, { id: 'synthetic', email: 'synthetic@example.invalid' }, 'reset');
  assert.deepEqual(store, { authTokens: [], mailOutbox: [] });
  assert.equal(await sendPending({ connect: () => assert.fail('não deve acessar a fila') }), 0);
});

test(
  'produção sem SMTP/políticas: mantém MFA, cookies seguros, origem e ausência de tokens',
  { skip: !databaseUrl },
  async (t) =>
    isolated(async (url, pool) => {
      const { createPostgresStore } = require('../dist/postgres-store');
      const db = createPostgresStore(url);
      await db.initialize(async () => ({
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
      }));
      await db.close();
      const origin = 'https://synthetic.example.invalid';
      const { call } = await server(t, url, {
        NODE_ENV: 'production',
        DB_AUTO_MIGRATE: 'false',
        APP_ORIGIN: origin,
        EMAIL_ENABLED: 'false',
        LEGAL_DOCUMENTS_REQUIRED: 'false',
        PRIVACY_POLICY_FILE: path.join(__dirname, 'missing-policy.md'),
        TERMS_FILE: path.join(__dirname, 'missing-terms.md'),
      });
      const data = {
        name: 'Synthetic',
        email: 'nomail@example.invalid',
        password: 'Synthetic-no-mail-password',
      };
      assert.equal((await call('/api/register', data)).status, 403);
      const signup = await call('/api/register', data, undefined, 'POST', { origin });
      assert.equal(signup.status, 201);
      assert.equal(signup.body.user.emailVerified, false);
      assert.equal(signup.body.user.verificationRequired, false);
      assert.match(signup.headers.get('set-cookie'), /Secure/);
      assert.match(signup.headers.get('set-cookie'), /HttpOnly/);
      assert.match(signup.headers.get('set-cookie'), /SameSite=Strict/);
      assert.equal((await call('/api/patients', undefined, signup.cookie, 'GET')).status, 200);
      assert.equal(
        (
          await call(
            '/api/account/mfa/setup',
            { currentPassword: data.password },
            signup.cookie,
            'POST',
            { origin },
          )
        ).status,
        200,
      );
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM mail_outbox')).rows[0].n, 0);
      assert.equal(
        (await pool.query('SELECT count(*)::int AS n FROM professional_tokens')).rows[0].n,
        0,
      );
      assert.equal((await call('/api/legal/terms', undefined, undefined, 'GET')).status, 503);
    }),
);

test('sem SMTP: cadastro, login e isolamento funcionam; envio é indisponível e não cria tokens', async (t) => {
  const { call } = await server(t, '', {
    EMAIL_ENABLED: 'false',
    LEGAL_DOCUMENTS_REQUIRED: 'false',
    PRIVACY_POLICY_FILE: path.join(__dirname, 'missing-policy.md'),
  });
  const a = await call('/api/register', {
    name: 'Synthetic A',
    email: 'a@example.invalid',
    password: 'Synthetic-password-A',
  });
  assert.equal(a.status, 201);
  assert.equal(a.body.user.emailVerified, false);
  assert.equal(a.body.user.emailDeliveryEnabled, false);
  const b = await call('/api/register', {
    name: 'Synthetic B',
    email: 'b@example.invalid',
    password: 'Synthetic-password-B',
  });
  assert.equal(b.status, 201);
  assert.equal(
    (await call('/api/login', { email: 'a@example.invalid', password: 'wrong' })).status,
    401,
  );
  assert.equal(
    (await call('/api/login', { email: 'a@example.invalid', password: 'Synthetic-password-A' }))
      .status,
    200,
  );
  assert.equal((await call('/api/patients', undefined, a.cookie, 'GET')).status, 200);
  assert.equal(
    (await call('/api/account/export', undefined, b.cookie, 'GET')).body.user.id,
    b.body.user.id,
  );
  for (const route of [
    'password-reset/request',
    'password-reset/complete',
    'verification/request',
    'verification/complete',
  ]) {
    const known = await call('/api/auth/' + route, { email: 'a@example.invalid' }, a.cookie);
    const unknown = await call('/api/auth/' + route, { email: 'unknown@example.invalid' });
    assert.equal(known.status, 503);
    assert.deepEqual(known.body, unknown.body);
  }
  assert.equal((await call('/api/legal/privacy', undefined, undefined, 'GET')).status, 503);
});
