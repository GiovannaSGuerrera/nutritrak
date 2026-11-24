const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { databaseUrl, isolated, server } = require('./helpers.cjs');
const { createPostgresStore } = require('../dist/postgres-store');
const { deliverBatch } = require('../dist/mail-worker');
const { queueMail } = require('../dist/mail');
const { snapshot, restoreEmpty } = require('../dist/backup');
const empty = () => ({
  users: [],
  patients: [],
  assessments: [],
  appointments: [],
  goals: [],
  mealPlans: [],
  patientAccounts: [],
  patientInvitations: [],
  patientPasswordResets: [],
  audit: [],
  authTokens: [],
  mailOutbox: [],
  privacyRequests: [],
});
test(
  'PG scoped reads, independent writers, row CAS and cross-table identity uniqueness',
  { skip: !databaseUrl },
  async () =>
    isolated(async (url) => {
      const first = createPostgresStore(url),
        second = createPostgresStore(url);
      try {
        const data = empty();
        data.users = [
          { id: 'u1', name: 'A', email: 'a@example.invalid', salt: 's', hash: 'h' },
          { id: 'u2', name: 'B', email: 'b@example.invalid', salt: 's', hash: 'h' },
        ];
        data.patients = [
          { id: 'p1', userId: 'u1', name: 'A' },
          { id: 'p2', userId: 'u2', name: 'B' },
        ];
        await first.initialize(async () => data);
        const a = await first.load('u1'),
          b = await second.load('u2');
        assert.deepEqual(
          a.users.map((x) => x.id),
          ['u1'],
        );
        assert.deepEqual(
          a.patients.map((x) => x.id),
          ['p1'],
        );
        assert.deepEqual(
          b.patients.map((x) => x.id),
          ['p2'],
        );
        a.patients[0].name = 'Updated A';
        b.patients[0].name = 'Updated B';
        await Promise.all([first.save(a), second.save(b)]);
        const current = await first.load('u1'),
          stale = await second.load('u1');
        current.patients[0].name = 'New';
        await first.save(current);
        stale.patients[0].name = 'Stale';
        await assert.rejects(second.save(stale), { status: 409 });
        const invalid = await first.load('u1');
        invalid.patientAccounts.push({
          id: 'account',
          patientId: 'p1',
          professionalId: 'u1',
          email: 'b@example.invalid',
          salt: 's',
          hash: 'h',
        });
        await assert.rejects(first.save(invalid), { code: '23505' });
      } finally {
        await first.close();
        await second.close();
      }
    }),
);
test('PG migration preserves v1 records and is repeatable', { skip: !databaseUrl }, async () =>
  isolated(async (url, pool) => {
    const base = await fs.readFile(path.join(__dirname, '../migrations/0001-baseline.sql'), 'utf8'),
      upgrade = await fs.readFile(path.join(__dirname, '../migrations/0002-hardening.sql'), 'utf8');
    await pool.query(base);
    await pool.query(
      "INSERT INTO professionals(id,position,record_keys,extras,name,email,salt,hash) VALUES('u',0,ARRAY['id','name','email','salt','hash'],'{}','Original','migration@example.invalid','s','h')",
    );
    await pool.query("INSERT INTO storage_migrations(version,legacy_snapshot) VALUES(1,'{}')");
    const before = (await pool.query('SELECT name,email,salt,hash FROM professionals')).rows;
    await pool.query('BEGIN');
    await pool.query(upgrade);
    await pool.query('COMMIT');
    await pool.query(upgrade);
    assert.deepEqual(
      (await pool.query('SELECT name,email,salt,hash FROM professionals')).rows,
      before,
    );
    const db = createPostgresStore(url);
    try {
      assert.equal((await db.load('u')).users[0].name, 'Original');
    } finally {
      await db.close();
    }
    assert.equal((await pool.query('SELECT count(*) FROM login_identities')).rows[0].count, '1');
  }),
);
test(
  'PG outbox: authenticated encryption, retry eligibility and restore invalidation',
  { skip: !databaseUrl },
  async (t) =>
    isolated(async (url, pool) => {
      const previous = process.env.MAIL_ENCRYPTION_KEY;
      process.env.MAIL_ENCRYPTION_KEY = '4'.repeat(64);
      t.after(() => {
        if (previous === undefined) delete process.env.MAIL_ENCRYPTION_KEY;
        else process.env.MAIL_ENCRYPTION_KEY = previous;
      });
      const db = createPostgresStore(url);
      try {
        const data = empty();
        data.users = [{ id: 'u', name: 'A', email: 'a@example.invalid', salt: 's', hash: 'h' }];
        await db.initialize(async () => data);
        const state = await db.load('u');
        for (let i = 0; i < 101; i++) {
          queueMail(
            state,
            { to: 'synthetic@example.invalid', subject: 'Waiting', text: 'SYNTHETIC' },
            'u',
          );
          state.mailOutbox.at(-1).nextAt = Date.now() + 3600000;
        }
        queueMail(state, { to: 'synthetic@example.invalid', subject: 'Ready', text: 'READY' }, 'u');
        assert.equal(JSON.stringify(state.mailOutbox).includes('READY'), false);
        await db.save(state);
        let text;
        assert.equal(
          await deliverBatch(
            pool,
            {
              sendMail: async (m) => {
                text = m.text;
              },
            },
            'synthetic@example.invalid',
            1,
          ),
          1,
        );
        assert.equal(text, 'READY');
        const credentials = await db.load('u');
        credentials.authTokens.push({
          id: 'old',
          userId: 'u',
          purpose: 'verify',
          tokenHash: 'old',
          expiresAt: Date.now() + 3600000,
        });
        await db.save(credentials);
        const backup = await snapshot(pool);
        await isolated(async (targetUrl, target) => {
          await restoreEmpty(target, backup);
          assert.equal(
            (await target.query('SELECT count(*) FROM professional_tokens')).rows[0].count,
            '0',
          );
          assert.equal((await target.query('SELECT count(*) FROM mail_outbox')).rows[0].count, '0');
          assert.equal(
            (await target.query('SELECT count(*) FROM professionals')).rows[0].count,
            '1',
          );
        });
      } finally {
        await db.close();
      }
    }),
);
test(
  'HTTP: two professionals cannot export, alter or delete each other; pagination and aggregation',
  { skip: !databaseUrl },
  async (t) =>
    isolated(async (url) => {
      const { call } = await server(t, url);
      const a = await call('/api/register', {
          name: 'A',
          email: 'a@example.invalid',
          password: 'Synthetic-password-123!',
        }),
        b = await call('/api/register', {
          name: 'B',
          email: 'b@example.invalid',
          password: 'Synthetic-password-123!',
        });
      const patient = await call('/api/patients', { name: 'Private A' }, a.cookie);
      const id = patient.body.patient.id;
      for (const [route, method, data] of [
        [`/api/patients/${id}/export`, 'GET', undefined],
        [`/api/patients/${id}`, 'PATCH', { name: 'B' }],
        [`/api/patients/${id}`, 'DELETE', {}],
      ])
        assert.equal((await call(route, data, b.cookie, method)).status, 404);
      assert.equal(
        (await call('/api/patients', undefined, b.cookie, 'GET')).body.patients.length,
        0,
      );
      await call('/api/patients', { name: 'Second' }, a.cookie);
      const first = await call('/api/patients?limit=1', undefined, a.cookie, 'GET');
      assert.equal(first.body.patients.length, 1);
      assert.equal(first.body.page.nextOffset, 1);
      assert.equal(
        (await call('/api/patients?limit=100000', undefined, a.cookie, 'GET')).status,
        400,
      );
      await call('/api/goals', { patientId: id, description: 'Real synthetic goal' }, a.cookie);
      assert.equal((await call('/api/goals', undefined, a.cookie, 'GET')).body.goals.length, 1);
      assert.equal((await call('/api/goals', undefined, b.cookie, 'GET')).body.goals.length, 0);
    }),
);

test(
  'account deletion is self-only, refuses clinical links; mail job rejects unauthenticated calls',
  { skip: !databaseUrl },
  async (t) =>
    isolated(async (url) => {
      const { call } = await server(t, url);
      const credentials = {
        name: 'Synthetic',
        email: 'delete-a@example.invalid',
        password: 'Synthetic-password-123!',
      };
      const a = await call('/api/register', credentials),
        b = await call('/api/register', { ...credentials, email: 'delete-b@example.invalid' });
      await call('/api/patients', { name: 'Keep clinical record' }, a.cookie);
      assert.equal(
        (await call('/api/account', { currentPassword: credentials.password }, a.cookie, 'DELETE'))
          .status,
        409,
      );
      assert.equal(
        (
          await call(
            '/api/account',
            { currentPassword: credentials.password, userId: a.body.user.id },
            b.cookie,
            'DELETE',
          )
        ).status,
        200,
      );
      assert.equal((await call('/api/me', undefined, a.cookie, 'GET')).status, 200);
      assert.equal((await call('/api/me', undefined, b.cookie, 'GET')).status, 401);
      assert.equal((await call('/api/jobs/mail', undefined, undefined, 'GET')).status, 401);
    }),
);

test(
  'audit retention cannot be exhausted by another professional',
  { skip: !databaseUrl },
  async (t) =>
    isolated(async (url, pool) => {
      const { call } = await server(t, url);
      const a = await call('/api/register', {
          name: 'A',
          email: 'audit-a@example.invalid',
          password: 'Synthetic-password-123!',
        }),
        b = await call('/api/register', {
          name: 'B',
          email: 'audit-b@example.invalid',
          password: 'Synthetic-password-123!',
        });
      await pool.query(
        `INSERT INTO audit_events(id,position,record_keys,extras,"userId",action,"at") SELECT 'retained-'||n,n,ARRAY['id','userId','action','at'],'{}',$1,'synthetic',$2 FROM generate_series(1,600) n`,
        [a.body.user.id, new Date().toISOString()],
      );
      assert.equal((await call('/api/patients', { name: 'B event' }, b.cookie)).status, 201);
      assert.equal(
        (await pool.query('SELECT count(*) FROM audit_events WHERE "userId"=$1', [a.body.user.id]))
          .rows[0].count,
        '601',
      );
    }),
);

test(
  'security epoch rejects a login racing MFA/global session revocation',
  { skip: !databaseUrl },
  async () =>
    isolated(async (url) => {
      const first = createPostgresStore(url),
        second = createPostgresStore(url);
      try {
        const data = empty();
        data.users = [
          {
            id: 'u',
            name: 'Synthetic',
            email: 'epoch@example.invalid',
            salt: 's',
            hash: 'same-password-hash',
          },
        ];
        await first.initialize(async () => data);
        await second.initialize(async () => empty());
        await second.createSession(
          'old-before-commit',
          'professional',
          'u',
          'same-password-hash',
          0,
        );
        const updated = await first.load('u');
        updated.users[0].authVersion = 1;
        await first.save(updated);
        assert.equal(await second.getSession('old-before-commit', 'professional'), null);
        await assert.rejects(
          second.createSession('stale-after-commit', 'professional', 'u', 'same-password-hash', 0),
          { status: 409 },
        );
        await second.createSession('current', 'professional', 'u', 'same-password-hash', 1);
        assert.equal(await second.getSession('current', 'professional'), 'u');
      } finally {
        await first.close();
        await second.close();
      }
    }),
);

test(
  'explicit migration CLI initializes empty database and is idempotent',
  { skip: !databaseUrl },
  async () =>
    isolated(async (url) => {
      const { spawnSync } = require('node:child_process');
      const cli = path.resolve(__dirname, '../dist/migrate.js');
      for (let i = 0; i < 2; i++) {
        const result = spawnSync(process.execPath, [cli], {
          env: { ...process.env, MIGRATION_DATABASE_URL: url },
          encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);
      }
      const db = createPostgresStore(url);
      try {
        assert.equal((await db.load()).users.length, 0);
      } finally {
        await db.close();
      }
    }),
);

test(
  'appointment overlap is checked under tenant lock even without audit rows',
  { skip: !databaseUrl },
  async () =>
    isolated(async (url) => {
      const first = createPostgresStore(url),
        second = createPostgresStore(url);
      try {
        const data = empty();
        data.users = [
          { id: 'u', name: 'Synthetic', email: 'agenda@example.invalid', salt: 's', hash: 'h' },
        ];
        data.patients = [{ id: 'p', userId: 'u', name: 'Synthetic' }];
        await first.initialize(async () => data);
        const a = await first.load('u'),
          b = await second.load('u');
        const appointment = {
          userId: 'u',
          patientId: 'p',
          status: 'agendada',
          start: new Date(Date.now() + 86400000).toISOString(),
          end: new Date(Date.now() + 90000000).toISOString(),
        };
        a.appointments.push({ ...appointment, id: 'a' });
        b.appointments.push({ ...appointment, id: 'b' });
        const results = await Promise.allSettled([first.save(a), second.save(b)]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(results.find((r) => r.status === 'rejected').reason.status, 409);
      } finally {
        await first.close();
        await second.close();
      }
    }),
);
