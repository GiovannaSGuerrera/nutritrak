const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { Pool } = require('pg');
const { createPostgresStore } = require('../dist/postgres-store');
const { snapshot, encryptBackup, decryptBackup, restoreEmpty } = require('../dist/backup');

const databaseUrl = process.env.TEST_DATABASE_URL;
if (
  databaseUrl &&
  (process.env.TEST_DATABASE_CONFIRM !== 'disposable' ||
    !new URL(databaseUrl).pathname.endsWith('_test'))
)
  throw Error('Explicitly confirm a disposable *_test database.');

test(
  'limite compartilhado, execução sem DDL e restauração criptografada em banco vazio',
  { skip: !databaseUrl },
  async () => {
    await isolatedDatabase(async (url, pool) => {
      const first = createPostgresStore(url);
      const second = createPostgresStore(url);
      try {
        await first.initialize(async () => fixture());
        const previous = process.env.DB_AUTO_MIGRATE;
        process.env.DB_AUTO_MIGRATE = 'false';
        try {
          assert.equal(
            (
              await second.initialize(async () => {
                throw Error('Não importar');
              })
            ).patients.length,
            1,
          );
        } finally {
          if (previous === undefined) delete process.env.DB_AUTO_MIGRATE;
          else process.env.DB_AUTO_MIGRATE = previous;
        }
        assert.equal(await first.consumeAuthAttempt('hashed-test-bucket', 2, 900), true);
        assert.equal(await second.consumeAuthAttempt('hashed-test-bucket', 2, 900), true);
        assert.equal(await first.consumeAuthAttempt('hashed-test-bucket', 2, 900), false);
        await pool.query("UPDATE auth_rate_limits SET expires_at = now() - interval '1 second'");
        assert.equal(await second.consumeAuthAttempt('hashed-test-bucket', 2, 900), true);
        const key = require('node:crypto').randomBytes(32);
        const backup = decryptBackup(encryptBackup(await snapshot(pool), key), key);
        await assert.rejects(restoreEmpty(pool, backup), /vazio/);
        await isolatedDatabase(async (targetUrl, targetPool) => {
          await restoreEmpty(targetPool, backup);
          const restored = createPostgresStore(targetUrl);
          try {
            const data = await restored.load();
            assert.equal(data.patients[0].legacyField, 'preservado');
            assert.equal(data.mealPlans[0].versions.length, 2);
            assert.equal(
              (await targetPool.query('SELECT count(*) FROM auth_sessions')).rows[0].count,
              '0',
            );
          } finally {
            await restored.close();
          }
        });
      } finally {
        await first.close();
        await second.close();
      }
    });
  },
);

test(
  'papel restrito permite salvar dados e bloqueia DDL e alteração de snapshot',
  { skip: !databaseUrl },
  async () => {
    await isolatedDatabase(async (url, pool) => {
      const owner = createPostgresStore(url);
      const suffix = randomUUID().replaceAll('-', '');
      const role = `runtime_${suffix}`;
      const backupRole = `backup_${suffix}`;
      let restricted;
      try {
        await owner.initialize(async () => fixture());
        const schema = (await pool.query('SELECT current_schema() AS name')).rows[0].name;
        const sql = (
          await require('node:fs/promises').readFile(
            path.resolve(__dirname, '../../../docs/security/runtime-grants.sql'),
            'utf8',
          )
        )
          .replaceAll('nutritrack_runtime', role)
          .replaceAll('nutritrack_backup', backupRole)
          .replaceAll('SCHEMA public', `SCHEMA "${schema}"`);
        await pool.query(sql);
        const restrictedUrl = new URL(url);
        restrictedUrl.searchParams.set(
          'options',
          `${restrictedUrl.searchParams.get('options')} -c role=${role}`,
        );
        const client = new Pool({ connectionString: restrictedUrl.toString() });
        try {
          await assert.rejects(client.query('CREATE TABLE forbidden (id int)'), { code: '42501' });
          await assert.rejects(
            client.query("UPDATE storage_migrations SET legacy_snapshot = '{}'"),
            { code: '42501' },
          );
        } finally {
          await client.end();
        }
        restricted = createPostgresStore(restrictedUrl.toString());
        const previous = process.env.DB_AUTO_MIGRATE;
        process.env.DB_AUTO_MIGRATE = 'false';
        try {
          const data = await restricted.initialize(async () => fixture());
          data.patients[0].name = 'Teste com permissão restrita';
          await restricted.save(data);
          assert.equal((await owner.load()).patients[0].name, data.patients[0].name);
          assert.equal(await restricted.consumeAuthAttempt('restricted-bucket', 2, 900), true);
        } finally {
          if (previous === undefined) delete process.env.DB_AUTO_MIGRATE;
          else process.env.DB_AUTO_MIGRATE = previous;
        }
      } finally {
        if (restricted) await restricted.close();
        await owner.close();
        await pool.query(`DROP OWNED BY "${role}", "${backupRole}"`);
        await pool.query(`DROP ROLE "${role}", "${backupRole}"`);
      }
    });
  },
);

async function isolatedDatabase(run) {
  const admin = new Pool({ connectionString: databaseUrl });
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  await admin.query('CREATE SCHEMA "' + schema + '"');
  const url = new URL(databaseUrl);
  url.searchParams.set('options', '-c search_path=' + schema);
  const connectionString = url.toString();
  const pool = new Pool({ connectionString });
  try {
    await run(connectionString, pool);
  } finally {
    await pool.end();
    await admin.query('DROP SCHEMA "' + schema + '" CASCADE');
    await admin.end();
  }
}

function fixture() {
  return {
    authTokens: [],
    mailOutbox: [],
    privacyRequests: [],
    users: [
      {
        id: 'professional-1',
        name: 'Teste',
        email: 'teste@example.test',
        salt: 'salt',
        hash: 'hash',
      },
    ],
    patients: [
      {
        id: 'patient-1',
        userId: 'professional-1',
        name: 'Paciente',
        email: '',
        legacyField: 'preservado',
      },
    ],
    assessments: [
      { id: 'assessment-1', userId: 'professional-1', patientId: 'patient-1', weight: 64, bmi: 25 },
    ],
    appointments: [],
    goals: [],
    patientInvitations: [],
    patientPasswordResets: [],
    patientAccounts: [],
    mealPlans: [
      {
        id: 'plan-1',
        userId: 'professional-1',
        patientId: 'patient-1',
        name: 'Plano',
        publishedVersionId: 'version-1',
        versions: [
          {
            id: 'version-1',
            number: 1,
            status: 'published',
            meals: [{ name: 'Café', items: [{ food: 'Aveia', quantity: 40, unit: 'g' }] }],
          },
          { id: 'version-2', number: 2, status: 'draft', meals: [] },
        ],
      },
    ],
    audit: [{ id: 'event-1', userId: 'professional-1', action: 'test' }],
  };
}

test(
  'migra JSONB, preserva versões, reinicia e impede sobrescrita concorrente',
  { skip: !databaseUrl },
  async () => {
    await isolatedDatabase(async (url, pool) => {
      const initial = fixture();
      await pool.query(
        'CREATE TABLE nutritrack_store (singleton boolean PRIMARY KEY, payload jsonb)',
      );
      await pool.query('INSERT INTO nutritrack_store VALUES (true, $1)', [JSON.stringify(initial)]);
      const first = createPostgresStore(url);
      const second = createPostgresStore(url);
      try {
        assert.deepEqual(
          await first.initialize(async () => {
            throw Error('Não deve importar arquivo');
          }),
          initial,
        );
        assert.equal((await pool.query('SELECT count(*) FROM patients')).rows[0].count, '1');
        assert.equal(
          (await pool.query('SELECT count(*) FROM meal_plan_versions')).rows[0].count,
          '2',
        );
        const a = await first.load();
        const b = await second.initialize(async () => fixture());
        a.patients[0].name = 'Atualizado';
        await first.save(a);
        b.patients[0].name = 'Sobrescrita';
        await assert.rejects(second.save(b), { status: 409 });
        assert.equal((await second.load()).patients[0].name, 'Atualizado');

        const invalid = await first.load();
        invalid.patients.push({ id: 'foreign-patient', userId: 'missing-owner', name: 'Inválido' });
        await assert.rejects(first.save(invalid), { code: '23503' });
        assert.equal((await first.load()).patients.length, 1);

        const crossOwner = await first.load();
        crossOwner.users.push({
          id: 'professional-2',
          name: 'Outro',
          email: 'outro@example.test',
          salt: 's',
          hash: 'h',
        });
        crossOwner.assessments.push({
          id: 'foreign-assessment',
          userId: 'professional-2',
          patientId: 'patient-1',
        });
        await assert.rejects(first.save(crossOwner), { code: '23503' });
        assert.equal((await first.load()).users.length, 1);
        const restarted = await second.initialize(async () => {
          throw Error('Não deve reimportar');
        });
        assert.equal(restarted.patients[0].name, 'Atualizado');
        assert.deepEqual(restarted.mealPlans, initial.mealPlans);
        assert.deepEqual(
          (await pool.query('SELECT payload FROM nutritrack_store')).rows[0].payload,
          initial,
        );
      } finally {
        await first.close();
        await second.close();
      }
    });
  },
);

test('importação de arquivo e rollback de migração inválida', { skip: !databaseUrl }, async () => {
  await isolatedDatabase(async (url, pool) => {
    const storage = createPostgresStore(url);
    try {
      const invalid = fixture();
      invalid.assessments[0].userId = 'missing-owner';
      await assert.rejects(
        storage.initialize(async () => invalid),
        { code: '23503' },
      );
      const table = await pool.query("SELECT to_regclass('storage_migrations') AS name");
      assert.equal(table.rows[0].name, null);
      assert.deepEqual(await storage.initialize(async () => fixture()), fixture());
    } finally {
      await storage.close();
    }
  });
});

test(
  'fluxos originais da API executados no PostgreSQL relacional',
  { skip: !databaseUrl },
  async () => {
    await isolatedDatabase(async (url) => {
      const environment = { ...process.env, DATABASE_URL: url };
      delete environment.NODE_TEST_CONTEXT;
      const result = spawnSync(
        process.execPath,
        ['--test', path.join(__dirname, 'application.test.js')],
        {
          env: environment,
          encoding: 'utf8',
          timeout: 30000,
        },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /pass 1/);
    });
  },
);
test(
  'sessões compartilhadas, expiração, logout e revogação por troca de senha',
  { skip: !databaseUrl },
  async () => {
    await isolatedDatabase(async (url, pool) => {
      const first = createPostgresStore(url);
      const second = createPostgresStore(url);
      try {
        const data = fixture();
        data.patientAccounts.push({
          id: 'account-1',
          patientId: 'patient-1',
          professionalId: 'professional-1',
          email: 'patient@example.test',
          salt: 'salt',
          hash: 'patient-hash',
        });
        await first.initialize(async () => data);
        await second.initialize(async () => data);
        await first.createSession(
          'professional-token-hash',
          'professional',
          'professional-1',
          'hash',
        );
        assert.equal(
          await second.getSession('professional-token-hash', 'professional'),
          'professional-1',
        );
        assert.equal(await second.getSession('professional-token-hash', 'patient'), null);
        await second.deleteSession('professional-token-hash');
        assert.equal(await first.getSession('professional-token-hash', 'professional'), null);

        await first.createSession('patient-token-hash', 'patient', 'account-1', 'patient-hash');
        assert.equal(await second.getSession('patient-token-hash', 'patient'), 'account-1');
        await pool.query("UPDATE auth_sessions SET expires_at = now() - interval '1 minute'");
        assert.equal(await second.getSession('patient-token-hash', 'patient'), null);
        await first.deleteSession('patient-token-hash');
        await first.createSession('patient-token-hash', 'patient', 'account-1', 'patient-hash');
        const changed = await first.load();
        changed.patientAccounts[0].hash = 'new-hash';
        await first.save(changed);
        assert.equal(await second.getSession('patient-token-hash', 'patient'), null);
        await assert.rejects(
          first.createSession('stale-hash', 'patient', 'account-1', 'patient-hash'),
          { status: 409 },
        );
        await first.createSession('new-token-hash', 'patient', 'account-1', 'new-hash');
        await second.revokePatientSessions('account-1');
        assert.equal(await first.getSession('new-token-hash', 'patient'), null);
      } finally {
        await first.close();
        await second.close();
      }
    });
  },
);

test('fluxos da API pela entrada serverless da Vercel', { skip: !databaseUrl }, async () => {
  await isolatedDatabase(async (url) => {
    const environment = { ...process.env, DATABASE_URL: url, TEST_SERVERLESS: '1' };
    delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      ['--test', path.join(__dirname, 'application.test.js')],
      {
        env: environment,
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /pass 1/);
  });
});
