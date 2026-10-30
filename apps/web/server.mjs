import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT || process.env.WEB_PORT || 8080);
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  const relative = ['/', '/paciente', '/paciente/ativar', '/paciente/redefinir'].includes(pathname) ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const content = relative === 'config.js'
      ? Buffer.from(`window.NUTRITRACK_API_BASE = ${JSON.stringify(process.env.API_BASE_URL || '')};\n`)
      : await fs.readFile(file);
    let apiOrigin = "'self'";
    if (process.env.API_BASE_URL) {
      try { apiOrigin = new URL(process.env.API_BASE_URL).origin; } catch { res.writeHead(500); return res.end('Invalid API_BASE_URL'); }
    }
    res.writeHead(200, {
      'content-type': mime[path.extname(file)] || 'application/octet-stream',
      'x-content-type-options':'nosniff',
      'cache-control': path.basename(file)==='config.js' ? 'no-store' : 'no-cache',
      'content-security-policy': `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${apiOrigin}; base-uri 'none'; frame-ancestors 'none'`,
      'referrer-policy':'strict-origin-when-cross-origin',
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, () => process.stdout.write(`NutriTrack web em http://localhost:${port}\n`));
