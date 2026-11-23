import * as crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const AUTH_WINDOW_SECONDS = 900;
export const AUTH_LIMIT = 20;
const buckets = new Map<string, { count: number; expires: number }>();

export function securityError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

export function validateMutation(req: IncomingMessage) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')) return;
  if (req.headers['sec-fetch-site'] === 'cross-site')
    throw securityError(403, 'Origem da requisição não permitida.');
  const origin = req.headers.origin;
  if (origin) {
    const configured = process.env.APP_ORIGIN;
    const expected =
      configured ||
      `${process.env.NODE_ENV === 'production' ? 'https' : 'http'}://${req.headers.host}`;
    if (origin !== expected) throw securityError(403, 'Origem da requisição não permitida.');
  }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
    throw securityError(415, 'Envie os dados em JSON.');
}

export function authRoute(pathname: string) {
  return [
    '/api/login',
    '/api/register',
    '/api/patient/login',
    '/api/patient/activate',
    '/api/patient/invitations/validate',
    '/api/patient/password-resets/validate',
    '/api/patient/password-resets/complete',
  ].includes(pathname);
}

export function authBucket(req: IncomingMessage) {
  // Vercel overwrites x-vercel-forwarded-for. Never trust client x-forwarded-for.
  const address =
    process.env.VERCEL === '1'
      ? String(req.headers['x-vercel-forwarded-for'] || 'unknown')
          .split(',')[0]
          .trim()
      : req.socket.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(`auth:${address}`).digest('hex');
}

export function consumeLocalAttempt(key: string, now = Date.now()) {
  for (const [id, value] of buckets) if (value.expires <= now) buckets.delete(id);
  const bucket = buckets.get(key) || { count: 0, expires: now + AUTH_WINDOW_SECONDS * 1000 };
  bucket.count++;
  buckets.set(key, bucket);
  return bucket.count <= AUTH_LIMIT;
}

export function securityLog(
  event: string,
  fields: { status?: number; method?: string; requestId?: string; durationMs?: number } = {},
) {
  console.info(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
}
