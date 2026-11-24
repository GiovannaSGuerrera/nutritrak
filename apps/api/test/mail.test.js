const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Persistence } = require('../src/persistence');
const { queueMail, decrypt } = require('../src/mail');
const { deliverBatch } = require('../src/mail-worker');
test('encrypted transactional mail outbox: authentication, delivery and bounded retries', async (t) => {
  const oldKey = process.env.MAIL_ENCRYPTION_KEY;
  process.env.MAIL_ENCRYPTION_KEY = '2'.repeat(64);
  const directory = await fs.mkdtemp(path.join(__dirname, '.runtime-mail-'));
  const db = new Persistence(directory);
  t.after(async () => {
    db.close();
    if (oldKey === undefined) delete process.env.MAIL_ENCRYPTION_KEY;
    else process.env.MAIL_ENCRYPTION_KEY = oldKey;
    await fs.rm(directory, { recursive: true, force: true });
  });
  const state = { mailOutbox: [] };
  queueMail(state, {
    to: 'synthetic@example.invalid',
    subject: 'Synthetic verification',
    text: 'SYNTHETIC_TOKEN',
  });
  assert.equal(JSON.stringify(state).includes('SYNTHETIC_TOKEN'), false);
  assert.equal(decrypt(state.mailOutbox[0].encrypted).text, 'SYNTHETIC_TOKEN');
  assert.throws(() => decrypt({ ...state.mailOutbox[0].encrypted, tag: '0'.repeat(32) }));
  db.begin();
  db.commit({}, state, new Map(), new Map());
  const sent = [];
  assert.equal(
    await deliverBatch(
      db,
      {
        sendMail: async (message) => {
          sent.push(message);
        },
      },
      'test@example.invalid',
    ),
    1,
  );
  assert.equal(sent[0].text, 'SYNTHETIC_TOKEN');
  assert.equal(
    db.db.prepare("SELECT count(*) AS n FROM records WHERE collection='mailOutbox'").get().n,
    0,
  );
  state.mailOutbox = [];
  queueMail(state, {
    to: 'synthetic@example.invalid',
    subject: 'Synthetic retry',
    text: 'SYNTHETIC_RETRY',
  });
  db.begin();
  db.commit({}, state, new Map(), new Map());
  assert.equal(
    await deliverBatch(
      db,
      {
        sendMail: async () => {
          throw new Error('Synthetic relay unavailable');
        },
      },
      'test@example.invalid',
    ),
    0,
  );
  for (const row of db.db.prepare("SELECT data FROM records WHERE collection='mailOutbox'").all()) {
    const item = JSON.parse(row.data);
    assert.equal(item.attempts, 1);
    assert.ok(item.nextAt > Date.now());
  }
  // A full batch waiting for retry must not starve a newly queued message.
  const waiting = JSON.parse(
    db.db.prepare("SELECT data FROM records WHERE collection='mailOutbox'").get().data,
  );
  for (let i = 0; i < 101; i++) {
    const item = { ...waiting, id: `waiting-${i}` };
    db.db
      .prepare('INSERT INTO records(id,collection,data) VALUES(?,?,?)')
      .run(item.id, 'mailOutbox', JSON.stringify(item));
  }
  const ready = { mailOutbox: [] };
  queueMail(ready, { to: 'synthetic@example.invalid', subject: 'Ready', text: 'READY' });
  const item = ready.mailOutbox[0];
  db.db
    .prepare('INSERT INTO records(id,collection,data) VALUES(?,?,?)')
    .run(item.id, 'mailOutbox', JSON.stringify(item));
  assert.equal(await deliverBatch(db, { sendMail: async () => {} }, 'test@example.invalid'), 1);
});
