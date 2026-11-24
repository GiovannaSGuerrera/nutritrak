import { Pool } from 'pg';
import * as nodemailer from 'nodemailer';
import { decrypt } from './mail';
import { emailEnabled } from './release-mode';
import type { EncryptedMessage } from './contracts';

export async function deliverBatch(
  pool: Pool,
  transport: Pick<nodemailer.Transporter, 'sendMail'>,
  from: string,
  maximum = 2,
): Promise<number> {
  let delivered = 0;
  for (let i = 0; i < maximum; i++) {
    const client = await pool.connect();
    let item: { id: string; encrypted: EncryptedMessage } | undefined;
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM mail_outbox WHERE "expiresAt" <= $1', [Date.now()]);
      const selected = await client.query(
        'SELECT id,encrypted FROM mail_outbox WHERE attempts<8 AND "nextAt"<=$1 ORDER BY "nextAt" LIMIT 1 FOR UPDATE SKIP LOCKED',
        [Date.now()],
      );
      item = selected.rows[0];
      if (item)
        await client.query(
          'UPDATE mail_outbox SET attempts=attempts+1,"nextAt"=$2+LEAST(3600000,30000*power(2,attempts+1)),revision=revision+1 WHERE id=$1',
          [item.id, Date.now()],
        );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (!item) break;
    try {
      await transport.sendMail({
        from,
        ...decrypt(item.encrypted),
        messageId: `<${item.id}@nutritrack.local>`,
      });
      await pool.query('DELETE FROM mail_outbox WHERE id=$1', [item.id]);
      delivered++;
    } catch {
      console.error(JSON.stringify({ event: 'mail_delivery_failed' }));
    }
  }
  return delivered;
}
export async function sendPending(pool: Pool, maximum = 2) {
  if (!emailEnabled()) return 0;
  if (!process.env.SMTP_HOST || !process.env.MAIL_FROM) return 0;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === '465',
    requireTLS: true,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    ...(process.env.SMTP_USER
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }
      : {}),
  });
  try {
    return await deliverBatch(pool, transport, process.env.MAIL_FROM, maximum);
  } finally {
    transport.close();
  }
}
if (require.main === module) {
  if (
    !process.env.DATABASE_URL ||
    !process.env.MAIL_ENCRYPTION_KEY ||
    !process.env.SMTP_HOST ||
    !process.env.MAIL_FROM
  )
    throw Error('Configure banco, chave e relay autorizado.');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  sendPending(pool, 10)
    .catch(() => {
      console.error('mail_worker_failed');
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
