const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: 'apps/web/e2e',
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:39129', headless: true },
  webServer: {
    command: 'pnpm build && node apps/api/dist/server.js',
    url: 'http://127.0.0.1:39129/api/health',
    reuseExistingServer: false,
    env: {
      PORT: '39129',
      NODE_ENV: 'test',
      DATABASE_URL: '',
      DATA_DIR: '.tmp-pg-check/e2e',
      MAIL_ENCRYPTION_KEY: '6'.repeat(64),
    },
  },
  reporter: [['list'], ['json', { outputFile: 'docs/audit/evidence/e2e-results.json' }]],
});
