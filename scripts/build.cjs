const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'apps/api/node_modules/typescript/bin/tsc'),
    '-p',
    path.join(root, 'apps/api/tsconfig.json'),
  ],
  { stdio: 'inherit', cwd: root },
);
if (result.status !== 0) process.exit(result.status ?? 1);
require('./build-policies.cjs');
