import type { IncomingMessage, ServerResponse } from 'node:http';
import { securityError } from './security';
const parsed = new WeakMap<IncomingMessage, Record<string, unknown>>();
export const BODY_LIMIT = 1_000_000;
export async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const cached = parsed.get(req);
  if (cached) return cached;
  const prepared = (req as IncomingMessage & { body?: unknown }).body;
  let raw: string;
  if (prepared !== undefined) {
    raw =
      typeof prepared === 'string' || Buffer.isBuffer(prepared)
        ? String(prepared)
        : JSON.stringify(prepared);
  } else {
    if (Number(req.headers['content-length']) > BODY_LIMIT) {
      req.resume();
      throw securityError(413, 'Corpo muito grande.');
    }
    raw = await new Promise<string>((resolve, reject) => {
      let length = 0;
      const chunks: Buffer[] = [];
      const finish = (error?: Error) => {
        clearTimeout(timer);
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('aborted', onAbort);
        req.off('error', onError);
        if (error) {
          req.resume();
          reject(error);
        } else resolve(Buffer.concat(chunks).toString('utf8'));
      };
      const onData = (chunk: Buffer) => {
        length += chunk.length;
        if (length > BODY_LIMIT) finish(securityError(413, 'Corpo muito grande.'));
        else chunks.push(chunk);
      };
      const onEnd = () => finish();
      const onAbort = () => finish(securityError(400, 'Requisição interrompida.'));
      const onError = () => finish(securityError(400, 'Não foi possível ler a requisição.'));
      const timer = setTimeout(
        () => finish(securityError(408, 'Tempo para envio da requisição excedido.')),
        5000,
      );
      timer.unref();
      req.on('data', onData);
      req.once('end', onEnd);
      req.once('aborted', onAbort);
      req.once('error', onError);
    });
  }
  if (Buffer.byteLength(raw) > BODY_LIMIT) throw securityError(413, 'Corpo muito grande.');
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : {};
  } catch {
    throw securityError(400, 'JSON inválido.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw securityError(400, 'Envie um objeto JSON.');
  parsed.set(req, value as Record<string, unknown>);
  return value as Record<string, unknown>;
}
export function bufferedResponse() {
  const headers = new Map<string, string | number | readonly string[]>();
  let status = 200,
    content = '';
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    writeHead(code: number, values: Record<string, string>) {
      status = code;
      for (const [k, v] of Object.entries(values)) headers.set(k.toLowerCase(), v);
      return this;
    },
    end(value = '') {
      content = String(value);
      return this;
    },
  } as unknown as ServerResponse;
  return {
    response,
    get status() {
      return status;
    },
    flush(target: ServerResponse) {
      for (const [k, v] of headers) target.setHeader(k, v);
      target.writeHead(status);
      target.end(content);
    },
  };
}
