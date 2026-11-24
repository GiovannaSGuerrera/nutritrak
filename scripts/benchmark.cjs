'use strict';
// Controlled synthetic comparison. It does not estimate production capacity.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const net = require('node:net');
const root = process.cwd();
async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function run(serverFile, data, backend, aggregate) {
  const port = await freePort(),
    base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverFile], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      STORE_BACKEND: backend,
      DATA_DIR: data,
      HOST: '127.0.0.1',
      PORT: String(port),
      CORS_ORIGINS: base,
      PUBLIC_ORIGIN: base,
    },
    stdio: 'ignore',
  });
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try {
        if ((await fetch(base)).status === 200) {
          ready = true;
          break;
        }
      } catch {
        /* Startup polling. */
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    if (!ready) throw new Error('Benchmark server did not start');
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({
        email: 'bench@example.invalid',
        password: 'synthetic-benchmark-password',
      }),
    });
    if (!login.ok) throw new Error('Benchmark login failed');
    const headers = {
      cookie: login.headers.get('set-cookie').split(';')[0],
      'x-workspace-id': 'bench-workspace',
    };
    async function get(route) {
      const r = await fetch(base + route, { headers });
      if (!r.ok) throw new Error('Benchmark HTTP ' + r.status);
      return r.json();
    }
    const samples = [];
    let requests = 0;
    for (let n = 0; n < 7; n++) {
      const start = performance.now();
      if (aggregate) {
        const data = await get('/api/goals');
        if (data.goals.length !== 100) throw new Error('Incomplete aggregate');
        requests++;
      } else {
        const data = await get('/api/patients');
        requests++;
        let count = 0;
        for (const p of data.patients) {
          count += (await get('/api/patients/' + p.id)).goals.length;
          requests++;
        }
        if (count !== 100) throw new Error('Incomplete legacy flow');
      }
      samples.push(performance.now() - start);
    }
    const concurrentStart=performance.now();
    const concurrent=await Promise.all(Array.from({length:8},async()=>{
      const started=performance.now();
      if(aggregate)await get('/api/goals');
      else{const response=await get('/api/patients');for(const patient of response.patients)await get('/api/patients/'+patient.id);}
      return performance.now()-started;
    }));
    concurrent.sort((a,b)=>a-b);
    const concurrentWallMs=performance.now()-concurrentStart;
    samples.sort((a, b) => a - b);
    return {
      backend,
      patients: 100,
      goals: 100,
      registeredUsers: 1,
      concurrentSessions: 1,
      samples: 7,
      concurrentScreenRequests:8,
      concurrentScreenMedianMs:Number(concurrent[4].toFixed(2)),
      concurrentScreenMaxMs:Number(concurrent[7].toFixed(2)),
      concurrentWallMs:Number(concurrentWallMs.toFixed(2)),
      requestsPerScreen: requests / 7,
      medianMs: Number(samples[3].toFixed(2)),
      maxMs: Number(samples[6].toFixed(2)),
      allSamplesMs: samples.map((x) => Number(x.toFixed(2))),
    };
  } finally {
    if (child.exitCode === null) {
      const done = new Promise((r) => child.once('exit', r));
      child.kill();
      await done;
    }
  }
}
(async () => {
  const directory = await fs.mkdtemp(path.join(root, '.hardening-benchmark-'));
  try {
    const baseline = path.join(directory, 'baseline');
    const files = [
      'README.md',
      'apps/api/src/server.js',
      'apps/api/src/access-control.js',
      'apps/web/public/app.js',
      'apps/web/public/index.html',
    ];
    for (const file of files) {
      const target = path.join(baseline, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, execFileSync('git', ['show', 'HEAD:' + file]));
    }
    const relative = path.relative(root, baseline).split(path.sep).join('/');
    execFileSync('git', [
      'apply',
      '--directory=' + relative,
      'docs/audit/evidence/pre-remediation-working-tree.patch',
    ]);
    const collections = [
      'users',
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
    ];
    const store = Object.fromEntries(collections.map((key) => [key, []]));
    const now = new Date().toISOString(),
      salt = crypto.randomBytes(16).toString('hex');
    store.users.push({
      id: 'bench-user',
      name: 'Synthetic',
      email: 'bench@example.invalid',
      salt,
      hash: crypto.scryptSync('synthetic-benchmark-password', salt, 64).toString('hex'),
      createdAt: now,
    });
    store.workspaces.push({
      id: 'bench-workspace',
      name: 'Synthetic',
      type: 'individual',
      createdBy: 'bench-user',
    });
    store.memberships.push({
      id: 'bench-membership',
      workspaceId: 'bench-workspace',
      userId: 'bench-user',
      roles: ['owner_admin', 'clinician'],
      status: 'active',
    });
    for (let n = 0; n < 100; n++) {
      const patientId = 'bench-patient-' + n;
      store.patients.push({
        id: patientId,
        workspaceId: 'bench-workspace',
        userId: 'bench-user',
        name: 'Synthetic ' + n,
        status: 'Ativo',
        createdAt: now,
      });
      store.patientAssignments.push({
        id: 'bench-assignment-' + n,
        workspaceId: 'bench-workspace',
        patientId,
        professionalId: 'bench-user',
        status: 'active',
      });
      store.goals.push({
        id: 'bench-goal-' + n,
        workspaceId: 'bench-workspace',
        patientId,
        userId: 'bench-user',
        description: 'Synthetic goal',
        category: 'Hábitos',
        status: 'ativa',
        progress: [],
      });
    }
    const legacy = path.join(directory, 'legacy');
    await fs.mkdir(legacy);
    const source = path.join(legacy, 'store.json');
    await fs.writeFile(source, JSON.stringify(store));
    const sqlite = path.join(directory, 'sqlite');
    const imported = spawnSync(
      process.execPath,
      ['apps/api/scripts/storage.js', 'import-json', source, sqlite],
      { stdio: 'ignore' },
    );
    if (imported.status !== 0) throw new Error('Synthetic import failed');
    const before = await run(path.join(baseline, 'apps/api/src/server.js'), legacy, 'json', false);
    const after = await run(path.join(root, 'apps/api/src/server.js'), sqlite, 'sqlite', true);
    const result = {
      scope: 'Synthetic goals screen; local HTTP; no production capacity claim',
      before,
      after,
    };
    await fs.writeFile(
      'docs/audit/evidence/performance-comparison.json',
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
