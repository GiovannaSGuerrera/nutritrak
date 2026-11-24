// Audit-only reproductions. No real store is loaded; filesystem writes are no-ops.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const project = path.resolve(__dirname, '../../..');
const sourcePath = path.join(project, 'apps/api/src/server.js');
let source = fs.readFileSync(sourcePath, 'utf8');
const boundary = source.indexOf('const server = http.createServer');
assert.ok(boundary > 0, 'Source startup boundary must exist');
source = source.slice(0, boundary) + `
module.exports = {
  handle, store: () => store,
  reset: () => {
    for (const key of Object.keys(store)) store[key] = [];
    sessions.clear(); patientSessions.clear(); rateLimits.clear();
  }
};`;
const context = {
  require(name) {
    if (name === './access-control') return require(path.join(project, 'apps/api/src/access-control.js'));
    if (name === 'node:fs/promises') return {
      ...require(name), writeFile: async () => {}, rename: async () => {},
    };
    return require(name);
  },
  module: { exports: {} }, __dirname: path.dirname(sourcePath),
  process: { env: { NODE_ENV: 'test' } }, console, Buffer, URL, setTimeout,
};
vm.runInNewContext(source, context, { filename: sourcePath });
const api = context.module.exports;
async function request(method, url, data, headers = {}) {
  const req = Readable.from(data === undefined ? [] : [JSON.stringify(data)]);
  Object.assign(req, { method, url, headers, socket: { remoteAddress: '127.0.0.1' } });
  return new Promise((resolve, reject) => {
    const res = {
      headersSent: false, headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      writeHead(status, values) { this.status = status; Object.assign(this.headers, values); this.headersSent = true; },
      end(value) {
        let body;
        try { body = JSON.parse(value); } catch { body = value; }
        resolve({ status: this.status, headers: this.headers, body });
      },
    };
    api.handle(req, res).catch(reject);
  });
}
(async () => {
  api.reset();
  const identity = { name: 'Synthetic', email: 'synthetic@example.invalid', password: 'synthetic-passphrase-123', profileType: 'nutritionist' };
  const race = await Promise.all([request('POST', '/api/register', identity), request('POST', '/api/register', identity)]);
  assert.deepEqual(race.map(r => r.status), [201, 201]);
  assert.equal(api.store().users.length, 2);
  console.log('REGISTER_RACE', JSON.stringify({ statuses: race.map(r => r.status), sameEmailAccounts: api.store().users.length }));
  api.reset();
  const registration = await request('POST', '/api/register', identity);
  const headers = { cookie: registration.headers['set-cookie'].split(';')[0], 'x-workspace-id': registration.body.workspace.id };
  const created = await request('POST', '/api/patients', { name: 'Synthetic Patient', email: 'patient@example.invalid', primaryProfessionalId: registration.body.user.id }, headers);
  const id = created.body.patient.id;
  const invalid = await request('PATCH', '/api/patients/' + id, { name: '' }, headers);
  assert.equal(invalid.status, 400);
  assert.equal(api.store().patients[0].name, '');
  console.log('INVALID_PATCH', JSON.stringify({ status: invalid.status, inMemoryName: api.store().patients[0].name }));
  const unauthorized = await request('GET', '/api/patients');
  assert.equal(unauthorized.status, 401);
  console.log('UNAUTH_PATIENTS', unauthorized.status);
  const origin = await request('POST', '/api/patients', { name: 'Synthetic', primaryProfessionalId: registration.body.user.id }, { ...headers, origin: 'https://untrusted.example.invalid' });
  assert.equal(origin.status, 201);
  console.log('ORIGIN_DEFAULT', origin.status);
  const invitation = await request('POST', '/api/patients/' + id + '/invitations', {}, headers);
  const activation = await request('POST', '/api/patient/activate', { token: invitation.body.token, email: 'patient@example.invalid', password: 'synthetic-portal-password' });
  assert.equal(activation.status, 201);
  const reset = await request('POST', '/api/patients/' + id + '/password-resets', {}, headers);
  const reuse = await Promise.all([1, 2].map(n => request('POST', '/api/patient/password-resets/complete', { token: reset.body.token, password: 'synthetic-new-password-' + n })));
  assert.deepEqual(reuse.map(r => r.status), [200, 200]);
  console.log('RESET_RACE', JSON.stringify({ statuses: reuse.map(r => r.status) }));
  console.log('AUDIT_PROBES_CONFIRMED: assertions expect current defects, not desired behavior');
})().catch(error => { console.error(error); process.exitCode = 1; });
