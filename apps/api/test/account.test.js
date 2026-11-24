const { test } = require('node:test');
const assert = require('node:assert/strict');
const { databaseUrl, isolated, server } = require('./helpers.cjs');
const { decrypt } = require('../dist/mail');
test(
  'PostgreSQL: verificação, reset concorrente, MFA, exportação e revogação global',
  { skip: !databaseUrl },
  async (t) =>
    isolated(async (url, pool) => {
      const previous = process.env.MAIL_ENCRYPTION_KEY;
      process.env.MAIL_ENCRYPTION_KEY = '4'.repeat(64);
      t.after(() => {
        if (previous === undefined) delete process.env.MAIL_ENCRYPTION_KEY;
        else process.env.MAIL_ENCRYPTION_KEY = previous;
      });
      const { call } = await server(t, url);
      async function tokenFor(purpose) {
        for (const row of (await pool.query('SELECT encrypted FROM mail_outbox')).rows) {
          const message = decrypt(row.encrypted);
          const match = message.text.match(new RegExp('#' + purpose + '=([a-f0-9]{64})'));
          if (match) return match[1];
        }
        throw Error('Synthetic token not queued');
      }
      const initial = 'Synthetic-original-password',
        verified = 'Synthetic-verified-password',
        final = 'Synthetic-final-password';
      const a = await call('/api/register', {
        name: 'Synthetic',
        email: 'account@example.invalid',
        password: initial,
      });
      assert.equal(a.status, 201);
      const verify = await tokenFor('verify-email');
      assert.equal((await call('/api/auth/verification/complete', { token: verify })).status, 400);
      assert.equal(
        (await call('/api/auth/verification/complete', { token: verify, password: verified }))
          .status,
        200,
      );
      assert.equal((await call('/api/me', undefined, a.cookie, 'GET')).status, 401);
      const login = await call('/api/login', {
        email: 'account@example.invalid',
        password: verified,
      });
      assert.equal(login.status, 200);
      const unknown = await call('/api/auth/password-reset/request', {
          email: 'absent@example.invalid',
        }),
        known = await call('/api/auth/password-reset/request', {
          email: 'account@example.invalid',
        });
      assert.deepEqual(known.body, unknown.body);
      assert.equal(known.status, 202);
      const token = await tokenFor('reset-password');
      const results = await Promise.all(
        [1, 2].map(() => call('/api/auth/password-reset/complete', { token, password: final })),
      );
      assert.deepEqual(results.map((x) => x.status).sort(), [200, 410]);
      assert.equal((await call('/api/me', undefined, login.cookie, 'GET')).status, 401);
      const current = await call('/api/login', {
        email: 'account@example.invalid',
        password: final,
      });
      assert.equal(current.status, 200);
      const setup = await call(
        '/api/account/mfa/setup',
        { currentPassword: final },
        current.cookie,
      );
      assert.equal(setup.status, 200);
      const { codeAt } = require('../dist/totp');
      const code = codeAt(setup.body.secret, Math.floor(Date.now() / 30000));
      const confirmed = await call(
        '/api/account/mfa/confirm',
        { currentPassword: final, code },
        current.cookie,
      );
      assert.equal(confirmed.status, 200);
      assert.equal(confirmed.body.recoveryCodes.length, 8);
      assert.equal((await call('/api/me', undefined, current.cookie, 'GET')).status, 401);
      assert.equal(
        (await call('/api/login', { email: 'account@example.invalid', password: final })).status,
        401,
      );
      const recovery = confirmed.body.recoveryCodes[0];
      const mfa = await call('/api/login', {
        email: 'account@example.invalid',
        password: final,
        recoveryCode: recovery,
      });
      assert.equal(mfa.status, 200);
      assert.equal(
        (
          await call('/api/login', {
            email: 'account@example.invalid',
            password: final,
            recoveryCode: recovery,
          })
        ).status,
        401,
      );
      const exported = await call('/api/account/export', undefined, mfa.cookie, 'GET');
      assert.equal(exported.status, 200);
      assert.equal(exported.body.user.email, 'account@example.invalid');
      assert.equal(JSON.stringify(exported.body).includes('mfaSecret'), false);
      assert.equal(JSON.stringify(exported.body).includes('"hash"'), false);
      assert.equal(
        (
          await call(
            '/api/account/deletion-request',
            { currentPassword: final, recoveryCode: confirmed.body.recoveryCodes[1] },
            mfa.cookie,
          )
        ).status,
        202,
      );
      assert.equal(
        (
          await call(
            '/api/account/password',
            {
              currentPassword: final,
              password: 'Synthetic-changed-password',
              recoveryCode: confirmed.body.recoveryCodes[2],
            },
            mfa.cookie,
          )
        ).status,
        200,
      );
      assert.equal((await call('/api/me', undefined, mfa.cookie, 'GET')).status, 401);
    }),
);
test(
  'produção: startup seguro, origem, cadastro genérico e cookie Secure',
  { skip: !databaseUrl },
  async (t) =>
    isolated(async (url) => {
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
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1',
        MAIL_FROM: 'synthetic@example.invalid',
      });
      const data = {
        name: 'Synthetic',
        email: 'production@example.invalid',
        password: 'Synthetic-production-password',
      };
      assert.equal((await call('/api/register', data)).status, 403);
      assert.equal(
        (
          await call('/api/register', data, undefined, 'POST', {
            origin: 'https://untrusted.invalid',
          })
        ).status,
        403,
      );
      const signup = await call('/api/register', data, undefined, 'POST', { origin });
      assert.equal(signup.status, 202);
      assert.equal(signup.cookie, undefined);
      const duplicate = await call('/api/register', data, undefined, 'POST', { origin });
      assert.equal(duplicate.status, 202);
      assert.deepEqual(duplicate.body, signup.body);
      const login = await call('/api/login', data, undefined, 'POST', { origin });
      assert.equal(login.status, 200);
      assert.match(login.headers.get('set-cookie'), /Secure/);
      assert.match(login.headers.get('set-cookie'), /HttpOnly/);
      assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
      assert.equal((await call('/api/patients', undefined, login.cookie, 'GET')).status, 403);
    }),
);
