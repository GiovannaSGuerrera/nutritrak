import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT || process.env.WEB_PORT || 8080);
const apiBase = process.env.API_BASE_URL ? new URL(process.env.API_BASE_URL) : null;
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
http.createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  if (pathname.startsWith('/api/')) {
    if (!apiBase) { res.writeHead(503); return res.end('API_BASE_URL is not configured'); }
    const target = new URL(req.url, apiBase);
    const transport = target.protocol === 'https:' ? https : http;
    const headers = { ...req.headers, host: target.host };
    const proxy = transport.request(target, { method: req.method, headers }, (upstream) => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    });
    proxy.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end('API unavailable');
    });
    req.pipe(proxy);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const relative = ['/', '/paciente', '/paciente/ativar', '/paciente/redefinir'].includes(pathname) ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const content = relative === 'config.js'
      ? Buffer.from(`window.NUTRITRACK_API_BASE = "";\nwindow.NUTRITRACK_CLINIC_ADMIN_ENABLED = ${process.env.NUTRITRACK_CLINIC_ADMIN_ENABLED === 'true' || (process.env.NODE_ENV !== 'production' && process.env.NUTRITRACK_CLINIC_ADMIN_ENABLED !== 'false')};\n`)
      : await fs.readFile(file);
    res.writeHead(200, {
      'content-type': mime[path.extname(file)] || 'application/octet-stream',
      'x-content-type-options':'nosniff',
      'cache-control': path.basename(file)==='config.js' ? 'no-store' : 'no-cache',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      'referrer-policy':'strict-origin-when-cross-origin',
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, () => process.stdout.write(`NutriTrack web em http://localhost:${port}\n`));
