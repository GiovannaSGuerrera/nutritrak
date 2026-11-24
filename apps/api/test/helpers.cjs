const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs/promises');
const databaseUrl = process.env.TEST_DATABASE_URL;
if (
  databaseUrl &&
  (process.env.TEST_DATABASE_CONFIRM !== 'disposable' ||
    !new URL(databaseUrl).pathname.endsWith('_test'))
)
  throw Error('Disposable *_test database confirmation required');
async function isolated(run) {
  const admin = new Pool({ connectionString: databaseUrl });
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const url = new URL(databaseUrl);
  url.searchParams.set('options', '-c search_path=' + schema);
  const pool = new Pool({ connectionString: url.toString() });
  try {
    return await run(url.toString(), pool);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}
async function server(t, url, extra = {}) {
  const dir = await fs.mkdtemp(path.join(__dirname, '.runtime-service-'));
  const port = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  await fs.writeFile(path.join(dir, 'privacy.md'), 'Synthetic policy for isolated test');
  await fs.writeFile(path.join(dir, 'terms.md'), 'Synthetic terms for isolated test');
  const child = spawn(process.execPath, [path.join(__dirname, '../dist/server.js')], {
    env: {
      ...process.env,
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      MAIL_FROM: '',
      CRON_SECRET: '',
      DATABASE_URL: url,
      NODE_ENV: 'test',
      DATA_DIR: dir,
      PORT: String(port),
      MAIL_ENCRYPTION_KEY: '4'.repeat(64),
      PRIVACY_POLICY_FILE: path.join(dir, 'privacy.md'),
      TERMS_FILE: path.join(dir, 'terms.md'),
      ...extra,
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exit = new Promise((r) => child.once('exit', r));
      child.kill();
      await exit;
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {
      /* Wait only for this isolated server to start. */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  async function call(route, data, cookie, method = 'POST', headers = {}) {
    const response = await fetch(base + route, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
      headers: response.headers,
    };
  }
  return { call, base, child };
}
module.exports = { databaseUrl, isolated, server };
