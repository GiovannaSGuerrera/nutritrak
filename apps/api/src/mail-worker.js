'use strict';
const path = require('node:path');
const { Persistence } = require('./persistence');
const { decrypt } = require('./mail');
const nodemailer = require('nodemailer');

/** @param {InstanceType<typeof import("./persistence").Persistence>} database @param {Pick<import("nodemailer").Transporter,"sendMail">} transport @param {string} from */
async function deliverBatch(database, transport, from) {
  const now = Date.now();
  if (process.env.MAIL_HEARTBEAT_FILE)
    require('node:fs').writeFileSync(process.env.MAIL_HEARTBEAT_FILE, String(now), { mode: 0o600 });
  const rows = database.db
    .prepare(
      `SELECT id,data FROM records WHERE collection='mailOutbox'
      AND (json_extract(data,'$.expiresAt')<=? OR
        (json_extract(data,'$.attempts')<8 AND json_extract(data,'$.nextAt')<=?))
      ORDER BY json_extract(data,'$.nextAt') LIMIT 100`,
    )
    .all(now, now);
  let delivered = 0;
  for (const row of rows) {
    const item = JSON.parse(String(row.data));
    if (item.expiresAt <= now) {
      database.db.prepare('DELETE FROM records WHERE id=?').run(String(row.id));
      continue;
    }
    if (item.nextAt > now || item.attempts >= 8) continue;
    database.begin();
    const current = database.db.prepare('SELECT data FROM records WHERE id=?').get(row.id);
    if (!current || JSON.parse(String(current.data)).nextAt > now) {
      database.rollback();
      continue;
    }
    item.attempts++;
    item.nextAt = now + Math.min(3600000, 30000 * 2 ** item.attempts);
    database.db
      .prepare('UPDATE records SET data=? WHERE id=?')
      .run(JSON.stringify(item), String(row.id));
    database.db.exec('COMMIT');
    try {
      await transport.sendMail({
        from,
        ...decrypt(item.encrypted),
        messageId: `<${item.id}@nutritrack.local>`,
      });
      database.db.prepare('DELETE FROM records WHERE id=?').run(String(row.id));
      delivered++;
    } catch {
      console.error(JSON.stringify({ event: 'mail_delivery_failed', attempts: item.attempts }));
    }
  }
  return delivered;
}
async function main() {
  for (const name of ['DATA_DIR', 'MAIL_ENCRYPTION_KEY', 'SMTP_HOST', 'MAIL_FROM'])
    if (!process.env[name]) throw new Error(`${name} is required`);
  const database = new Persistence(path.resolve(process.env.DATA_DIR || ''));
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === '465',
    requireTLS: true,
    ...(process.env.SMTP_USER
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }
      : {}),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  let stopped = false;
  process.on('SIGTERM', () => {
    stopped = true;
  });
  try {
    do {
      await deliverBatch(database, transport, process.env.MAIL_FROM || '');
      if (!process.argv.includes('--once'))
        await new Promise((resolve) => setTimeout(resolve, 5000));
    } while (!stopped && !process.argv.includes('--once'));
  } finally {
    database.close();
    transport.close();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error('mail_worker_failed');
    process.exitCode = 1;
  });
module.exports = { deliverBatch };
