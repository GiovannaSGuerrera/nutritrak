import { sendPending } from './mail-worker';
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

async function writeChanges(
  client: PoolClient,
  state: StoreState,
  previous: StoreState,
  revisions = new Map<string, string>(),
) {
  const next = new Map(revisions);
  for (const entity of entities) {
    const oldRecords = new Map(
      rowsFor(previous, entity).map((record, position) => [
        record.id,
        JSON.stringify({ record, position: entity.key === 'audit' ? 0 : position }),
      ]),
    );
    for (const [position, record] of rowsFor(state, entity).entries()) {
      if (
        oldRecords.get(record.id) ===
        JSON.stringify({ record, position: entity.key === 'audit' ? 0 : position })
      )
        continue;
      if (entity.key === 'appointments' && record.status === 'agendada') {
        const conflict = await client.query(
          `SELECT 1 FROM appointments WHERE "userId"=$1 AND status='agendada' AND id<>$2 AND "start"<$3 AND "end">$4 LIMIT 1`,
          [record.userId, record.id, record.end, record.start],
        );
        if (conflict.rowCount)
          throw Object.assign(new Error('Já existe uma consulta nesse horário.'), { status: 409 });
      }
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
      const expected = revisions.get(entity.key + ':' + record.id);
      if (Buffer.byteLength(JSON.stringify(record)) > 1_000_000)
        throw Object.assign(new Error('Registro excede1MB.'), { status: 413 });
      const changed = await client.query(
        `INSERT INTO ${entity.table} AS target (${names.map((name) => `"${name}"`).join(', ')})
         VALUES (${values.map((_, index) => '$' + (index + 1)).join(', ')})
         ON CONFLICT (id) DO UPDATE SET
         ${names
           .slice(1)
           .map((name) => `"${name}" = EXCLUDED."${name}"`)
           .join(', ')}, revision = target.revision + 1
         WHERE target.revision = $${values.length + 1} AND $${values.length + 2}::boolean
         RETURNING revision`,
        [...values, expected || '0', expected !== undefined],
      );
      if (!changed.rowCount)
        throw Object.assign(new Error('O registro mudou. Recarregue.'), { status: 409 });
      next.set(entity.key + ':' + record.id, String(changed.rows[0].revision));
    }
  }
  for (const entity of [...entities].reverse()) {
    const remaining = new Set(rowsFor(state, entity).map((record) => record.id));
    const removed = rowsFor(previous, entity).filter((record) => !remaining.has(record.id));
    for (const record of removed) {
      const deleted = await client.query(
        `DELETE FROM ${entity.table} WHERE id=$1 AND revision=$2 RETURNING id`,
        [record.id, revisions.get(entity.key + ':' + record.id) || '0'],
      );
      if (!deleted.rowCount)
        throw Object.assign(new Error('O registro mudou. Recarregue.'), { status: 409 });
      next.delete(entity.key + ':' + record.id);
    }
  }
  return next;
}

async function readState(
  client: PoolClient,
  scope?: string,
  revisions = new Map<string, string>(),
): Promise<StoreState> {
  const state: StoreState = {};
  const versions = new Map<string, StoredRecord[]>();
  // One round trip for the compatibility snapshot, instead of one per entity.
  // Names come exclusively from the internal schema definitions.
  const snapshot = await client.query(
    `SELECT ${entities
      .map(
        (entity) =>
          `(SELECT COALESCE(json_agg(record ORDER BY ${entity.key === 'audit' ? '"at" DESC NULLS LAST, id' : 'position, id'}), '[]'::json) FROM ${entity.table} record ${scope === undefined ? '' : entity.key === 'users' ? 'WHERE id=$1' : entity.key === 'versions' ? 'WHERE "planId" IN (SELECT id FROM meal_plans WHERE "userId"=$1)' : entity.columns.userId ? 'WHERE "userId"=$1' : 'WHERE "professionalId"=$1'}) AS "${entity.key}"`,
      )
      .join(', ')}`,
    scope === undefined ? [] : [scope],
  );
  for (const entity of entities) {
    const rows = snapshot.rows[0][entity.key];
    const records = rows.map((row) => {
      revisions.set(entity.key + ':' + row.id, String(row.revision || 0));
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
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
    idle_in_transaction_session_timeout: 15000,
  });
  pool.on('error', () => console.error('postgres_idle_connection_error'));
  let previous: StoreState = {};
  let recordRevisions = new Map<string, string>();

  return {
    async initialize(readLegacyStore: () => Promise<StoreState>, scope?: string) {
      if (process.env.DB_AUTO_MIGRATE === 'false') return this.load(scope);
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
      return this.load(scope);
    },

    async load(scope?: string): Promise<StoreState> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const { rows } = await client.query(
          'SELECT revision FROM storage_migrations WHERE version = $1',
          [schemaVersion],
        );
        if (!rows.length) throw new Error('Migração do banco pendente.');
        const loadedRevisions = new Map<string, string>();
        const state = await readState(client, scope, loadedRevisions);
        await client.query('COMMIT');
        previous = structuredClone(state);
        recordRevisions = loadedRevisions;
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
        // Keep the v1 compatibility marker first in lock order during a rolling release.
        await client.query(
          'UPDATE storage_migrations SET revision=revision+1 WHERE version=$1 RETURNING revision',
          [schemaVersion],
        );

        // Per-record CAS allows independent professionals to write without a global stale-snapshot failure.
        const owners = new Set<string>();
        for (const entity of entities)
          for (const record of [...rowsFor(state, entity), ...rowsFor(previous, entity)]) {
            const owner =
              entity.key === 'users' ? record.id : record.userId || record.professionalId;
            if (typeof owner === 'string') owners.add(owner);
          }
        for (const owner of [...owners].sort())
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,42))', [
            'tenant:' + owner,
          ]);
        const nextRevisions = await writeChanges(client, state, previous, recordRevisions);
        for (const owner of owners) {
          const budget = await client.query(
            `SELECT ${entities.map((entity) => `(SELECT COALESCE(sum(pg_column_size(record)),0) FROM ${entity.table} record WHERE ${entity.key === 'users' ? 'id=$1' : entity.key === 'versions' ? '"planId" IN (SELECT id FROM meal_plans WHERE "userId"=$1)' : entity.columns.userId ? '"userId"=$1' : '"professionalId"=$1'})`).join('+')} AS total`,
            [owner],
          );
          if (Number(budget.rows[0].total) > 32 * 1024 * 1024)
            throw Object.assign(new Error('Limite técnico de armazenamento excedido.'), {
              status: 413,
            });
        }
        await client.query('COMMIT');
        recordRevisions = nextRevisions;
        previous = structuredClone(state);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async ownerForRequest(input: {
      professionalToken?: string;
      patientToken?: string;
      email?: string;
      token?: string;
    }) {
      if (input.professionalToken) {
        const id = await this.getSession(input.professionalToken, 'professional');
        if (id) return id;
      }
      if (input.patientToken) {
        const id = await this.getSession(input.patientToken, 'patient');
        if (id) {
          const r = await pool.query('SELECT "professionalId" FROM patient_accounts WHERE id=$1', [
            id,
          ]);
          if (r.rows[0]) return r.rows[0].professionalId;
        }
      }
      if (input.email) {
        const r = await pool.query(
          'SELECT id FROM professionals WHERE email=$1 UNION ALL SELECT "professionalId" AS id FROM patient_accounts WHERE email=$1 LIMIT 1',
          [input.email],
        );
        if (r.rows[0]) return r.rows[0].id;
      }
      if (input.token) {
        const r = await pool.query(
          'SELECT "professionalId" AS id FROM patient_invitations WHERE "tokenHash"=$1 UNION ALL SELECT "professionalId" AS id FROM patient_password_resets WHERE "tokenHash"=$1 UNION ALL SELECT "userId" AS id FROM professional_tokens WHERE "tokenHash"=$1 LIMIT 1',
          [input.token],
        );
        if (r.rows[0]) return r.rows[0].id;
      }
      return '__anonymous__';
    },
    async revokeProfessionalSessions(userId: string) {
      await pool.query('DELETE FROM auth_sessions WHERE professional_id=$1', [userId]);
    },
    async dispatchMail() {
      return sendPending(pool, 1);
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
      authVersion = 0,
    ) {
      await pool.query('DELETE FROM auth_sessions WHERE expires_at<=now()');
      const column = kind === 'professional' ? 'professional_id' : 'patient_account_id';
      const table = kind === 'professional' ? 'professionals' : 'patient_accounts';
      const result = await pool.query(
        `INSERT INTO auth_sessions (token_hash, ${column}, credential_hash, expires_at)
         SELECT $1, id, ${kind === 'professional' ? "hash || ':' || COALESCE(extras->>'authVersion','0')" : 'hash'}, now() + interval '8 hours' FROM ${table}
         WHERE id = $2 AND hash = $3 ${kind === 'professional' ? "AND COALESCE(extras->>'authVersion','0')=$4" : ''}`,
        kind === 'professional'
          ? [tokenHash, subjectId, credentialHash, String(authVersion)]
          : [tokenHash, subjectId, credentialHash],
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
           AND ${kind === 'professional' ? "(session.credential_hash=account.hash || ':' || COALESCE(account.extras->>'authVersion','0') OR (COALESCE(account.extras->>'authVersion','0')='0' AND session.credential_hash=account.hash))" : 'session.credential_hash=account.hash'}`,
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
