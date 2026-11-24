'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
/** @param {string} kind */
async function readPolicy(kind) {
  const file = process.env[kind === 'privacy' ? 'PRIVACY_POLICY_FILE' : 'TERMS_FILE'];
  if (!file || !['.md', '.txt'].includes(path.extname(file)))
    throw Object.assign(new Error('Documento ainda não configurado.'), { status: 503 });
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 200000) throw new Error('Invalid policy document');
  const text = await fs.readFile(file, 'utf8');
  return { text, version: crypto.createHash('sha256').update(text).digest('hex') };
}
module.exports = { readPolicy };
