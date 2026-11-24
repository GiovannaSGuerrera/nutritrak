import type { Store, MailMessage, EncryptedMessage } from './contracts';
import * as crypto from 'node:crypto';
const developmentKey = crypto.randomBytes(32);
function key() {
  if (process.env.MAIL_ENCRYPTION_KEY) {
    if (!/^[a-f\d]{64}$/i.test(process.env.MAIL_ENCRYPTION_KEY))
      throw new Error('MAIL_ENCRYPTION_KEY must contain 32 bytes in hex');
    return Buffer.from(process.env.MAIL_ENCRYPTION_KEY, 'hex');
  }
  if (process.env.NODE_ENV === 'production') throw new Error('MAIL_ENCRYPTION_KEY is required');
  return developmentKey;
}
function encrypt(message: MailMessage): EncryptedMessage {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(message)), cipher.final()]);
  return {
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('hex'),
  };
}
function decrypt(message: EncryptedMessage): MailMessage {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(message.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(message.tag, 'hex'));
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(message.data, 'hex')), decipher.final()]).toString(),
  );
}
function queueMail(store: Pick<Store, 'mailOutbox'>, message: MailMessage, userId?: string) {
  const now = Date.now();
  store.mailOutbox = store.mailOutbox.filter((row) => row.expiresAt > now);
  if (store.mailOutbox.length >= 10000)
    throw Object.assign(new Error('Entrega temporariamente indisponível.'), { status: 503 });
  store.mailOutbox.push({
    id: crypto.randomUUID(),
    userId,
    encrypted: encrypt(message),
    expiresAt: now + 86400000,
    attempts: 0,
    nextAt: now,
  });
}
export { encrypt, decrypt, queueMail };
