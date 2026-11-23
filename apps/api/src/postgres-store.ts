import { Pool } from 'pg';

export function createPostgresStore(connectionString: string) {
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000 });
  pool.on('error', () => console.error('postgres_idle_connection_error'));
  let revision;

  async function load() {
    const { rows } = await pool.query(
      'SELECT payload, revision FROM nutritrack_store WHERE singleton = true',
    );
    if (!rows.length) return null;
    revision = rows[0].revision;
    return rows[0].payload;
  }

  return {
    async initialize(readLegacyStore) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS nutritrack_store (
          singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
          payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
          revision bigint NOT NULL DEFAULT 0
        )
      `);
      const existing = await load();
      if (existing) return existing;

      const initial = await readLegacyStore();
      await pool.query(
        'INSERT INTO nutritrack_store (payload) VALUES ($1) ON CONFLICT (singleton) DO NOTHING',
        [JSON.stringify(initial)],
      );
      return load();
    },
    load,
    async save(payload) {
      const { rows } = await pool.query(
        `UPDATE nutritrack_store SET payload = $1, revision = revision + 1
         WHERE singleton = true AND revision = $2 RETURNING revision`,
        [JSON.stringify(payload), revision],
      );
      if (!rows.length) {
        const error = Object.assign(new Error('Os dados foram atualizados. Tente novamente.'), { status: 409 });
        throw error;
      }
      revision = rows[0].revision;
    },
  };
}


