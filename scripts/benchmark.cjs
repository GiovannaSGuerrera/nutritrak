// Controlled comparison against an isolated checkout of b759e77. No production URL accepted.
const { Pool } = require('../apps/api/node_modules/pg');
const { createPostgresStore } = require('../apps/api/dist/postgres-store');
const { spawn } = require('node:child_process');
const { randomUUID, scryptSync } = require('node:crypto');
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const url = 'postgresql://audit_test@127.0.0.1:55489/nutritrack_remediation_test';
async function measure(legacy) {
  const admin = new Pool({ connectionString: url });
  const schema = 'bench_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('options', '-c search_path=' + schema);
  const db = createPostgresStore(scoped.toString());
  let child;
  try {
    const state = {
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
    };
    const salt = '1'.repeat(32),
      hash = scryptSync('Synthetic-password-123!', salt, 64).toString('hex'),
      at = new Date().toISOString();
    for (let u = 0; u < 10; u++) {
      state.users.push({
        id: 'u' + u,
        name: 'Synthetic',
        email: `u${u}@example.invalid`,
        salt,
        hash,
        createdAt: at,
      });
      for (let p = 0; p < 100; p++) {
        const id = `p${u}-${p}`;
        state.patients.push({ id, userId: 'u' + u, name: id, status: 'Ativo', createdAt: at });
        state.goals.push({
          id: 'g' + id,
          userId: 'u' + u,
          patientId: id,
          description: 'Synthetic',
          category: 'Hábitos',
          status: 'ativa',
          progress: [],
          createdAt: at,
        });
      }
    }
    await db.initialize(async () => state);
    const port = await new Promise((r) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = s.address().port;
        s.close(() => r(p));
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const cwd = legacy ? path.resolve('.tmp-pg-check/benchmark-baseline') : process.cwd();
    child = spawn(process.execPath, ['apps/api/dist/server.js'], {
      cwd,
      env: {
        ...process.env,
        DATABASE_URL: scoped.toString(),
        NODE_ENV: 'test',
        PORT: String(port),
        DB_AUTO_MIGRATE: 'false',
        MAIL_ENCRYPTION_KEY: '7'.repeat(64),
      },
      stdio: 'ignore',
    });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + '/api/health')).ok) break;
      } catch {
        /* bounded readiness */
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'u0@example.invalid', password: 'Synthetic-password-123!' }),
    });
    if (!login.ok) throw Error('Synthetic login failed');
    const cookie = login.headers.get('set-cookie').split(';')[0];
    async function get(route) {
      const r = await fetch(base + route, { headers: { cookie } });
      if (!r.ok) throw Error('Benchmark request failed');
      return r.json();
    }
    async function screen() {
      const before = performance.now();
      if (legacy) {
        const patients = (await get('/api/patients')).patients;
        for (const p of patients) await get(`/api/patients/${p.id}`);
      } else await get('/api/goals');
      return performance.now() - before;
    }
    await screen();
    const samples = [];
    for (let n = 0; n < 7; n++) samples.push(await screen());
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => screen()));
    samples.sort((a, b) => a - b);
    concurrent.sort((a, b) => a - b);
    return {
      samplesMs: samples.map((x) => Number(x.toFixed(2))),
      medianMs: Number(samples[3].toFixed(2)),
      maxMs: Number(samples.at(-1).toFixed(2)),
      requestsPerScreen: legacy ? 101 : 1,
      concurrentOpenings: 4,
      concurrentMedianMs: Number(((concurrent[1] + concurrent[2]) / 2).toFixed(2)),
      concurrentMaxMs: Number(concurrent.at(-1).toFixed(2)),
    };
  } finally {
    if (child) {
      const exited = new Promise((r) => child.once('exit', r));
      child.kill();
      await exited;
    }
    await db.close();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}
(async () => {
  const result = {
    scope:
      'Synthetic PostgreSQL local;10 professionals,100 patients+100 goals each;one logged-in user/session;not a capacity/SLO claim',
    before: await measure(true),
    after: await measure(false),
  };
  await fs.mkdir('docs/audit/evidence', { recursive: true });
  await fs.writeFile(
    'docs/audit/evidence/performance-comparison.json',
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
