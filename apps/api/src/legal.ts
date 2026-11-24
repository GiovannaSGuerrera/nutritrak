import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
async function readPolicy(kind: string) {
  const file =
    process.env[kind === 'privacy' ? 'PRIVACY_POLICY_FILE' : 'TERMS_FILE'] ||
    path.resolve(__dirname, 'legal', kind === 'privacy' ? 'privacy.md' : 'terms.md');
  if (!file || !['.md', '.txt'].includes(path.extname(file)))
    throw Object.assign(new Error('Documento ainda não configurado.'), { status: 503 });
  const stat = await fs.stat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT')
      throw Object.assign(new Error('Documento ainda não disponibilizado.'), { status: 503 });
    throw error;
  });
  if (!stat.isFile() || stat.size > 200000) throw new Error('Invalid policy document');
  const text = await fs.readFile(file, 'utf8');
  if (!text.trim()) throw new Error('Empty policy document');
  return { text, version: crypto.createHash('sha256').update(text).digest('hex') };
}
export { readPolicy };
