import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { Pool } from 'pg';
import { entities, schemaSql } from './relational-schema';

const tables = ['storage_migrations', ...entities.map((e) => e.table)];
// Sessions and access tokens are deliberately not restored. Users sign in again.
export async function snapshot(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const data: Record<string, unknown[]> = {};
    for (const table of tables) data[table] = (await client.query(`SELECT * FROM ${table}`)).rows;
    await client.query('COMMIT');
    return { version: 1, createdAt: new Date().toISOString(), data };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function encryptBackup(value: unknown, key: Buffer) {
  if (key.length !== 32) throw new Error('A chave deve ter 32 bytes.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([Buffer.from('NTB1'), iv, cipher.getAuthTag(), payload]);
}

export function decryptBackup(bytes: Buffer, key: Buffer) {
  if (bytes.subarray(0, 4).toString() !== 'NTB1') throw new Error('Formato inválido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(4, 16));
  decipher.setAuthTag(bytes.subarray(16, 32));
  return JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()]).toString(),
  );
}

export async function restoreEmpty(pool: Pool, backup: ReturnType<typeof decryptBackup>) {
  if (backup.version !== 1 || !backup.data || tables.some((t) => !Array.isArray(backup.data[t])))
    throw new Error('Conteúdo de backup inválido.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(schemaSql);
    // Lock all target tables so another instance cannot initialize during restore.
    await client.query(`LOCK TABLE ${tables.join(', ')} IN ACCESS EXCLUSIVE MODE`);
    for (const table of tables) {
      if ((await client.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount)
        throw new Error('A restauração exige um banco vazio e isolado.');
    }
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    for (const table of tables) {
      if (backup.data[table].length)
        await client.query(
          `INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1::json)`,
          [JSON.stringify(backup.data[table])],
        );
    }
    // Invalidate invitation and reset links captured by the backup.
    for (const table of ['patient_invitations', 'patient_password_resets'])
      await client.query(
        `UPDATE ${table} SET "revokedAt" = $1,
        record_keys = CASE WHEN 'revokedAt' = ANY(record_keys) THEN record_keys ELSE array_append(record_keys, 'revokedAt') END`,
        [new Date().toISOString()],
      );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  (async () => {
    const [operation, file] = process.argv.slice(2);
    if (!file || !['create', 'restore'].includes(operation))
      throw new Error('Use create|restore arquivo.ntbackup');
    const restore = operation === 'restore';
    if (restore && process.env.CONFIRM_EMPTY_RESTORE !== 'yes')
      throw new Error('Confirme o destino isolado com CONFIRM_EMPTY_RESTORE=yes.');
    const connectionString = restore
      ? process.env.RESTORE_DATABASE_URL
      : process.env.BACKUP_DATABASE_URL;
    if (!connectionString)
      throw new Error('Configure a conexão dedicada de backup ou restauração.');
    const key = Buffer.from(process.env.BACKUP_KEY || '', 'base64');
    if (key.length !== 32) throw new Error('Configure BACKUP_KEY com 32 bytes em base64.');
    const pool = new Pool({ connectionString, max: 1 });
    try {
      if (restore) await restoreEmpty(pool, decryptBackup(await fs.readFile(file), key));
      else
        await fs.writeFile(file, encryptBackup(await snapshot(pool), key), {
          mode: 0o600,
          flag: 'wx',
        });
      console.info(JSON.stringify({ event: restore ? 'restore_completed' : 'backup_completed' }));
    } finally {
      await pool.end();
    }
  })().catch(() => {
    console.error('backup_operation_failed');
    process.exitCode = 1;
  });
}
