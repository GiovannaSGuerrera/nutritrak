const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const directory = path.resolve(__dirname, '../test');
const files = fs
  .readdirSync(directory)
  .filter((name) => name.endsWith('.test.js'))
  .map((name) => path.join(directory, name));
const isolatedEnv = { ...process.env };
for (const key of [
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'BACKUP_DATABASE_URL',
  'RESTORE_DATABASE_URL',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'MAIL_FROM',
  'CRON_SECRET',
  'VERCEL',
])
  delete isolatedEnv[key];
const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  env: isolatedEnv,
});
process.exitCode = result.status ?? 1;
