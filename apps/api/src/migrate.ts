import { entities } from './relational-schema';
import { Pool } from 'pg';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
// This is an explicit operator command, never a production startup side effect.
if (require.main === module) {
  if (!process.env.MIGRATION_DATABASE_URL)
    throw Error('Use MIGRATION_DATABASE_URL da conta de migração; runtime não recebe DDL.');
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  (async () => {
    const client = await pool.connect();
    try {
      const sql = await fs.readFile(
        path.resolve(__dirname, '../migrations/0002-hardening.sql'),
        'utf8',
      );
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(72361941)');
      await client.query(sql);
      const baseline = await client.query('SELECT version FROM storage_migrations WHERE version=1');
      if (!baseline.rowCount) {
        const occupied = await client.query(
          `SELECT ${entities.map((entity) => `EXISTS(SELECT 1 FROM ${entity.table} LIMIT 1)`).join(' OR ')} AS occupied`,
        );
        const legacy = await client.query("SELECT to_regclass('nutritrack_store') AS name");
        if (occupied.rows[0].occupied || legacy.rows[0].name)
          throw Error('Reconcile unversioned legacy data in an isolated copy.');
        await client.query(
          "INSERT INTO storage_migrations(version,legacy_snapshot) VALUES(1,'{}')",
        );
      }
      await client.query(
        "INSERT INTO storage_migrations(version,legacy_snapshot) VALUES(2,'{}') ON CONFLICT(version) DO NOTHING",
      );
      await client.query('COMMIT');
      console.info('hardening_migration_completed');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })()
    .catch(() => {
      console.error('hardening_migration_failed');
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
