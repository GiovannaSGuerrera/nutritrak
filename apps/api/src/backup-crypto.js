'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
function backupKey() {
  if (!/^[a-f\d]{64}$/i.test(process.env.BACKUP_ENCRYPTION_KEY || ''))
    throw new Error('BACKUP_ENCRYPTION_KEY must contain 32 bytes in hex');
  return Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || '', 'hex');
}
/** @param {string} source @param {string} destination */
async function encryptBackup(source, destination) {
  if (fs.existsSync(destination)) throw new Error('Destination exists');
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv('aes-256-gcm', backupKey(), iv);
  const descriptor = fs.openSync(destination, 'wx', 0o600);
  fs.writeSync(descriptor, Buffer.concat([Buffer.from('NTBK1'), iv, Buffer.alloc(16)]));
  fs.closeSync(descriptor);
  try {
    await pipeline(
      fs.createReadStream(source),
      cipher,
      fs.createWriteStream(destination, { flags: 'r+', start: 33 }),
    );
    const file = fs.openSync(destination, 'r+');
    try {
      fs.writeSync(file, cipher.getAuthTag(), 0, 16, 17);
      fs.fsyncSync(file);
    } finally {
      fs.closeSync(file);
    }
  } catch (error) {
    fs.unlinkSync(destination);
    throw error;
  }
}
/** @param {string} source @param {string} destination */
async function decryptBackup(source, destination) {
  if (fs.existsSync(destination)) throw new Error('Destination exists');
  const descriptor = fs.openSync(source, 'r'),
    header = Buffer.alloc(33);
  try {
    if (
      fs.readSync(descriptor, header, 0, 33, 0) !== 33 ||
      header.subarray(0, 5).toString() !== 'NTBK1'
    )
      throw new Error('Invalid encrypted backup');
  } finally {
    fs.closeSync(descriptor);
  }
  const cipher = crypto.createDecipheriv('aes-256-gcm', backupKey(), header.subarray(5, 17));
  cipher.setAuthTag(header.subarray(17));
  try {
    await pipeline(
      fs.createReadStream(source, { start: 33 }),
      cipher,
      fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    );
  } catch (error) {
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
    throw error;
  }
}
module.exports = { encryptBackup, decryptBackup };
