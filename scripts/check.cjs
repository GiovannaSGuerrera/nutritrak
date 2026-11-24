'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : /\.(?:js|cjs|mjs)$/.test(file) ? [file] : [];
  });
}
for (const file of [
  ...walk('apps/api/src'),
  ...walk('apps/api/scripts'),
  ...walk('apps/web/public'),
  'apps/web/server.mjs',
]) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Node/web syntax build checks passed');
