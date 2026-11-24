const fs = require('node:fs');
const path = require('node:path');
for (const name of ['privacy.md', 'terms.md']) {
  const source = path.resolve('legal', name),
    destination = path.resolve('apps/api/dist/legal', name);
  if (!fs.existsSync(source)) {
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
    continue;
  } // No invented legal document; production startup will refuse absence.
  const stat = fs.statSync(source);
  if (!stat.isFile() || stat.size > 200000 || !fs.readFileSync(source, 'utf8').trim())
    throw Error('Invalid operator policy document');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
