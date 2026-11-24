const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './apps/web/e2e',
  workers: 1,
  timeout: 30000,
  use: { browserName: 'chromium', headless: true },
  reporter: [['list'], ['json', { outputFile: 'docs/audit/evidence/e2e-results.json' }]],
});
