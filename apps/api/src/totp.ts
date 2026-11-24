import type { User, EncryptedMessage } from './contracts';
import * as crypto from 'node:crypto';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function encode(bytes: Buffer) {
  let bits = 0,
    value = 0,
    result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function decode(secret: string) {
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const char of secret) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid TOTP secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
function secretKey() {
  if (!/^[a-f\d]{64}$/i.test(process.env.MAIL_ENCRYPTION_KEY || ''))
    throw Object.assign(new Error('MFA requer chave de proteção configurada.'), { status: 503 });
  return crypto.hkdfSync(
    'sha256',
    Buffer.from(process.env.MAIL_ENCRYPTION_KEY || '', 'hex'),
    Buffer.alloc(0),
    'nutritrack-mfa-v1',
    32,
  );
}
function seal(secret: string): EncryptedMessage {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('hex'),
  };
}
function unseal(value: EncryptedMessage) {
  const cipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(value.iv, 'hex'));
  cipher.setAuthTag(Buffer.from(value.tag, 'hex'));
  return Buffer.concat([cipher.update(Buffer.from(value.data, 'hex')), cipher.final()]).toString();
}
function codeAt(secret: string, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', decode(secret)).update(message).digest(),
    offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
function matchingCounter(
  secret: string,
  code: unknown,
  now = Date.now(),
  last = -1,
): number | null {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const counter = Math.floor(now / 30000);
  for (const candidate of [counter - 1, counter, counter + 1])
    if (
      candidate > last &&
      crypto.timingSafeEqual(Buffer.from(codeAt(secret, candidate)), Buffer.from(code))
    )
      return candidate;
  return null;
}
function checkSecondFactor(user: User, data: Record<string, unknown>) {
  if (!user.mfaSecret) return true;
  if (typeof data.recoveryCode === 'string') {
    const hashed = crypto
      .createHash('sha256')
      .update(data.recoveryCode.trim().toUpperCase())
      .digest('hex');
    if (user.mfaRecoveryHashes?.includes(hashed)) {
      user.mfaRecoveryHashes = user.mfaRecoveryHashes.filter((value) => value !== hashed);
      return true;
    }
  }
  const counter = matchingCounter(
    unseal(user.mfaSecret),
    data.code,
    Date.now(),
    user.mfaLastCounter ?? -1,
  );
  if (counter === null) return false;
  user.mfaLastCounter = counter;
  return true;
}
export const newSecret = () => encode(crypto.randomBytes(20));
export { seal, unseal, codeAt, matchingCounter, checkSecondFactor };
