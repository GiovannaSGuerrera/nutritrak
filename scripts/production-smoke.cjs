// Anonymous checks only: no accounts, patient data or persistent test fixtures.
const fs = require('node:fs');
async function main() {
  const origin = new URL(process.argv[2]).origin;
  if (!origin.startsWith('https://')) throw Error('HTTPS origin required');
  const cases = [
    ['GET', '/', 200],
    ['GET', '/app.js', 200],
    ['GET', '/account.js', 200],
    ['GET', '/api/live', 200],
    ['GET', '/api/ready', 200],
    ['GET', '/api/health', 200],
    ['GET', '/api/me', 401],
    ['GET', '/api/patients', 401],
    ['GET', '/api/account/export', 401],
    ['GET', '/api/jobs/mail', 401],
    ['GET', '/api/legal/privacy', 503],
    ['GET', '/api/legal/terms', 503],
    ['POST', '/api/auth/password-reset/request', 503],
    ['POST', '/api/auth/verification/request', 503],
    ['POST', '/api/auth/password-reset/request', 403, 'https://untrusted.invalid'],
  ];
  const results = [];
  for (const [method, route, expected, requestOrigin] of cases) {
    const response = await fetch(origin + route, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers:
        method === 'POST'
          ? { origin: requestOrigin || origin, 'content-type': 'application/json' }
          : {},
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    const headers = Object.fromEntries(
      [
        'content-security-policy',
        'x-content-type-options',
        'x-frame-options',
        'strict-transport-security',
        'cache-control',
      ].map((name) => [name, response.headers.get(name)]),
    );
    const secureHeaders =
      headers['x-content-type-options'] === 'nosniff' && headers['x-frame-options'] === 'DENY';
    results.push({
      method,
      route,
      expected,
      status: response.status,
      passed: response.status === expected && secureHeaders,
      headers,
    });
    await response.arrayBuffer();
  }
  const report = {
    at: new Date().toISOString(),
    origin,
    total: results.length,
    passed: results.filter((row) => row.passed).length,
    results,
  };
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      total: report.total,
      passed: report.passed,
      failed: results.filter((row) => !row.passed),
    }),
  );
  if (report.passed !== report.total) process.exitCode = 1;
}
main().catch(() => {
  console.error('production_smoke_failed');
  process.exitCode = 1;
});
