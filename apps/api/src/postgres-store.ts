import { Pool, PoolClient } from 'pg';
import {
  entities,
  schemaSql,
  StoreState,
  StoredRecord,
  EntityDefinition,
} from './relational-schema';

const schemaVersion = 1;

function rowsFor(state: StoreState, entity: EntityDefinition): StoredRecord[] {
  if (entity.key === 'versions') {
    return (state.mealPlans || []).flatMap((plan) =>
      ((plan.versions || []) as StoredRecord[]).map((version) => ({ ...version, planId: plan.id })),
    );
  }
  return state[entity.key] || [];
}

async function writeChanges(client: PoolClient, state: StoreState, previous: StoreState) {
  for (const entity of entities) {
    const oldRecords = new Map(
      rowsFor(previous, entity).map((record, position) => [
        record.id,
        JSON.stringify({ record, position }),
      ]),
    );
    for (const [position, record] of rowsFor(state, entity).entries()) {
      if (oldRecords.get(record.id) === JSON.stringify({ record, position })) continue;
      const columns = Object.keys(entity.columns);
      const extras = Object.fromEntries(
        Object.entries(record).filter(
          ([key]) =>
            key !== 'id' &&
            !columns.includes(key) &&
            !(entity.key === 'mealPlans' && key === 'versions'),
        ),
      );
      const names = ['id', 'position', 'record_keys', 'extras', ...columns];
      const values = [
        record.id,
        position,
        Object.keys(record),
        JSON.stringify(extras),
        ...columns.map((column) =>
          entity.columns[column].startsWith('jsonb')
            ? JSON.stringify(record[column] ?? null)
            : (record[column] ?? null),
        ),
      ];
      await client.query(
        `INSERT INTO ${entity.table} (${names.map((name) => `"${name}"`).join(', ')})
         VALUES (${values.map((_, index) => '$' + (index + 1)).join(', ')})
         ON CONFLICT (id) DO UPDATE SET
         ${names
           .slice(1)
           .map((name) => `"${name}" = EXCLUDED."${name}"`)
           .join(', ')}`,
        values,
      );
    }
  }
  for (const entity of [...entities].reverse()) {
    const remaining = new Set(rowsFor(state, entity).map((record) => record.id));
    const removed = rowsFor(previous, entity).filter((record) => !remaining.has(record.id));
    if (removed.length)
      await client.query(`DELETE FROM ${entity.table} WHERE id = ANY($1::text[])`, [
        removed.map((record) => record.id),
      ]);
  }
}

async function readState(client: PoolClient): Promise<StoreState> {
  const state: StoreState = {};
  const versions = new Map<string, StoredRecord[]>();
  // One round trip for the compatibility snapshot, instead of one per entity.
  // Names come exclusively from the internal schema definitions.
  const snapshot = await client.query(
    `SELECT ${entities
      .map(
        (entity) =>
          `(SELECT COALESCE(json_agg(record ORDER BY position, id), '[]'::json) FROM ${entity.table} record) AS "${entity.key}"`,
      )
      .join(', ')}`,
  );
  for (const entity of entities) {
    const rows = snapshot.rows[0][entity.key];
    const records = rows.map((row) => {
      const record = { ...row.extras, id: row.id };
      for (const column of Object.keys(entity.columns))
        if (row.record_keys.includes(column)) record[column] = row[column];
      return record as StoredRecord;
    });
    if (entity.key === 'versions') {
      for (const record of records) {
        const planId = record.planId as string;
        delete record.planId;
        const list = versions.get(planId) || [];
        list.push(record);
        versions.set(planId, list);
      }
    } else state[entity.key] = records;
  }
  for (const plan of state.mealPlans) plan.versions = versions.get(plan.id) || [];
  return state;
}

export function createPostgresStore(connectionString: string) {
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 15000 });
  pool.on('error', () => console.error('postgres_idle_connection_error'));
  let revision: string;
  let previous: StoreState = {};

  return {
    async initialize(readLegacyStore: () => Promise<StoreState>) {
      if (process.env.DB_AUTO_MIGRATE === 'false') return this.load();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(72361941)');
        await client.query(schemaSql);
        const migrated = await client.query(
          'SELECT version FROM storage_migrations WHERE version = $1',
          [schemaVersion],
        );
        if (!migrated.rowCount) {
          // The original document is retained as a recovery snapshot.
          const legacyTable = await client.query("SELECT to_regclass('nutritrack_store') AS name");
          const legacy = legacyTable.rows[0].name
            ? await client.query('SELECT payload FROM nutritrack_store WHERE singleton = true')
            : { rows: [] };
          const state = legacy.rows[0]?.payload ?? (await readLegacyStore());
          for (const entity of entities.filter((item) => item.key !== 'versions'))
            if (!Array.isArray(state[entity.key])) state[entity.key] = [];
          await writeChanges(client, state, {});
          await client.query(
            'INSERT INTO storage_migrations (version, legacy_snapshot) VALUES ($1, $2)',
            [schemaVersion, JSON.stringify(state)],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return this.load();
    },

    async load(): Promise<StoreState> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const { rows } = await client.query(
          'SELECT revision FROM storage_migrations WHERE version = $1',
          [schemaVersion],
        );
        if (!rows.length) throw new Error('Migração do banco pendente.');
        const state = await readState(client);
        await client.query('COMMIT');
        revision = rows[0].revision;
        previous = structuredClone(state);
        return state;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async save(state: StoreState) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          `UPDATE storage_migrations SET revision = revision + 1
           WHERE version = $1 AND revision = $2 RETURNING revision`,
          [schemaVersion, revision],
        );
        if (!updated.rowCount)
          throw Object.assign(new Error('Os dados foram atualizados. Tente novamente.'), {
            status: 409,
          });
        await writeChanges(client, state, previous);
        await client.query('COMMIT');
        revision = updated.rows[0].revision;
        previous = structuredClone(state);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async health() {
      await pool.query('SELECT 1');
    },

    async consumeAuthAttempt(bucketHash: string, limit: number, windowSeconds: number) {
      await pool.query('DELETE FROM auth_rate_limits WHERE expires_at <= now()');
      const { rows } = await pool.query(
        `INSERT INTO auth_rate_limits (bucket_hash, attempts, expires_at)
         VALUES ($1, 1, now() + $2 * interval '1 second')
         ON CONFLICT (bucket_hash) DO UPDATE SET
           attempts = CASE WHEN auth_rate_limits.expires_at <= now() THEN 1 ELSE auth_rate_limits.attempts + 1 END,
           expires_at = CASE WHEN auth_rate_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE auth_rate_limits.expires_at END
         RETURNING attempts`,
        [bucketHash, windowSeconds],
      );
      return rows[0].attempts <= limit;
    },

    async createSession(
      tokenHash: string,
      kind: 'professional' | 'patient',
      subjectId: string,
      credentialHash: string,
    ) {
      const column = kind === 'professional' ? 'professional_id' : 'patient_account_id';
      const table = kind === 'professional' ? 'professionals' : 'patient_accounts';
      const result = await pool.query(
        `INSERT INTO auth_sessions (token_hash, ${column}, credential_hash, expires_at)
         SELECT $1, id, hash, now() + interval '8 hours' FROM ${table}
         WHERE id = $2 AND hash = $3`,
        [tokenHash, subjectId, credentialHash],
      );
      if (!result.rowCount)
        throw Object.assign(new Error('A conta foi atualizada. Entre novamente.'), { status: 409 });
    },

    async getSession(tokenHash: string, kind: 'professional' | 'patient'): Promise<string | null> {
      const column = kind === 'professional' ? 'professional_id' : 'patient_account_id';
      const table = kind === 'professional' ? 'professionals' : 'patient_accounts';
      const { rows } = await pool.query(
        `SELECT account.id FROM auth_sessions session
         JOIN ${table} account ON account.id = session.${column}
         WHERE session.token_hash = $1 AND session.expires_at > now()
           AND session.credential_hash = account.hash`,
        [tokenHash],
      );
      return rows[0]?.id ?? null;
    },

    async deleteSession(tokenHash: string) {
      await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenHash]);
    },

    async revokePatientSessions(accountId: string) {
      await pool.query('DELETE FROM auth_sessions WHERE patient_account_id = $1', [accountId]);
    },

    async close() {
      await pool.end();
    },
  };
}
