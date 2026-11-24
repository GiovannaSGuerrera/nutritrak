const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
test('operator tools import without changing source and restore authenticated encrypted backup', async (t) => {
  const directory = await fs.mkdtemp(path.join(__dirname, '.runtime-recovery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'synthetic.json'),
    data = path.join(directory, 'data'),
    encrypted = path.join(directory, 'backup.enc'),
    restored = path.join(directory, 'restored');
  const content = JSON.stringify({
    users: [{ id: 'synthetic-user', email: 'synthetic@example.invalid' }],
    authTokens: [{ id: 'old-token', userId: 'synthetic-user', tokenHash: 'synthetic-expired' }],
    workspaces: [{ id: 'synthetic-workspace' }],
    patients: [
      { id: 'synthetic-patient', workspaceId: 'synthetic-workspace', userId: 'synthetic-user' },
    ],
  });
  await fs.writeFile(source, content);
  const script = path.join(__dirname, '../scripts/storage.js');
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      env: { ...process.env, BACKUP_ENCRYPTION_KEY: '3'.repeat(64) },
      encoding: 'utf8',
    });
  assert.equal(run('import-json', source, data).status, 0);
  assert.equal(await fs.readFile(source, 'utf8'), content);
  assert.equal(run('import-json', source, data).status, 1, 'existing destination must be refused');
  const live = new DatabaseSync(path.join(data, 'nutritrack.sqlite'));
  live
    .prepare('INSERT INTO sessions(kind,token_hash,subject_id,expires_at) VALUES(?,?,?,?)')
    .run('professional', 'synthetic-old-session-hash', 'synthetic-user', Date.now() + 3600000);
  live.close();
  assert.equal(run('backup-encrypted', data, encrypted).status, 0);
  assert.equal(
    (await fs.readFile(encrypted)).includes(Buffer.from('synthetic@example.invalid')),
    false,
  );
  assert.equal(run('restore-encrypted', encrypted, restored).status, 0);
  const original = new DatabaseSync(path.join(data, 'nutritrack.sqlite'), { readOnly: true });
  assert.equal(
    original.prepare('SELECT count(*) AS n FROM sessions').get().n,
    1,
    'live source is untouched',
  );
  original.close();
  assert.equal(run('verify', path.join(restored, 'nutritrack.sqlite')).status, 0);
  const db = new DatabaseSync(path.join(restored, 'nutritrack.sqlite'), { readOnly: true });
  try {
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM records WHERE collection='authTokens'").get().n,
      0,
    );
    assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM records WHERE collection='patients'").get().n,
      1,
    );
  } finally {
    db.close();
  }
  const tampered = path.join(directory, 'tampered.enc'),
    bytes = await fs.readFile(encrypted);
  bytes[bytes.length - 1] ^= 1;
  await fs.writeFile(tampered, bytes);
  const rejected = path.join(directory, 'rejected');
  assert.equal(run('restore-encrypted', tampered, rejected).status, 1);
  await assert.rejects(fs.access(rejected));
});
