'use strict';
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const fs = require('node:fs');

// One transaction owns one request. Responses are released only after COMMIT.
// This deployment profile deliberately uses one application instance/local volume.
class Persistence {
  /** @param {string} directory */
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, 'nutritrack.sqlite');
    this.limiter = new DatabaseSync(path.join(directory, 'limits.sqlite'));
    fs.chmodSync(path.join(directory, 'limits.sqlite'), 0o600);
    this.limiter.exec(
      'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS rate_limits(bucket TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS rate_expiry ON rate_limits(expires_at)',
    );
    this.db = new DatabaseSync(this.file);
    fs.chmodSync(this.file, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY CHECK(version=1));
      INSERT OR IGNORE INTO schema_version VALUES(1);
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY, collection TEXT NOT NULL, workspace_id TEXT,
        patient_id TEXT, email TEXT UNIQUE,
        data TEXT NOT NULL CHECK(json_valid(data)),
        FOREIGN KEY(workspace_id) REFERENCES records(id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(patient_id) REFERENCES records(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE INDEX IF NOT EXISTS records_collection_workspace ON records(collection,workspace_id,id);
      CREATE INDEX IF NOT EXISTS records_workspace ON records(workspace_id);
      CREATE INDEX IF NOT EXISTS records_patient ON records(patient_id);
      CREATE INDEX IF NOT EXISTS records_legacy_user ON records(json_extract(data,'$.userId')) WHERE workspace_id IS NULL;
      CREATE INDEX IF NOT EXISTS records_legacy_professional ON records(json_extract(data,'$.professionalId')) WHERE workspace_id IS NULL;
      CREATE INDEX IF NOT EXISTS records_token ON records(collection,json_extract(data,'$.tokenHash'));
      CREATE TABLE IF NOT EXISTS sessions (
        kind TEXT NOT NULL, token_hash TEXT NOT NULL, subject_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL, PRIMARY KEY(kind,token_hash));
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS rate_limits (
        bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(expires_at);`);
    this.upsert = this.db
      .prepare(`INSERT INTO records(id,collection,workspace_id,patient_id,email,data)
      VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET collection=excluded.collection,
      workspace_id=excluded.workspace_id,patient_id=excluded.patient_id,email=excluded.email,data=excluded.data`);
  }
  /** @param {Record<string,import("./contracts").DataRecord[]>} empty @param {{workspaceId:string,userId:string,patientId?:string}} [scope] */
  load(empty, scope) {
    const metadata = [
      'users',
      'workspaces',
      'memberships',
      'workspaceInvitations',
      'patientAccounts',
      'authTokens',
      'mailOutbox',
      'privacyRequests',
    ];
    const rows = scope
      ? this.db
          .prepare(
            `SELECT collection,data FROM records WHERE collection IN (${metadata.map(() => '?').join(',')}) OR workspace_id=? OR (workspace_id IS NULL AND (json_extract(data,'$.userId')=? OR json_extract(data,'$.professionalId')=?)) OR id=? OR patient_id=? ORDER BY rowid`,
          )
          .all(
            ...metadata,
            scope.workspaceId,
            scope.userId,
            scope.userId,
            scope.patientId || '',
            scope.patientId || '',
          )
      : this.db.prepare('SELECT collection,data FROM records ORDER BY rowid').all();
    for (const row of rows) {
      if (!Object.hasOwn(empty, String(row.collection)))
        throw new Error('Unsupported collection in database');
      empty[String(row.collection)].push(JSON.parse(String(row.data)));
    }
    return empty;
  }
  begin() {
    this.db.exec('BEGIN IMMEDIATE');
  }
  rollback() {
    if (this.db.isTransaction) this.db.exec('ROLLBACK');
  }
  /** @param {Record<string,import("./contracts").DataRecord[]>} before @param {Record<string,import("./contracts").DataRecord[]>} store @param {Map<string,import("./contracts").Session>} professionalSessions @param {Map<string,import("./contracts").Session>} patientSessions @param {string} [sessionSnapshot] */
  commit(before, store, professionalSessions, patientSessions, sessionSnapshot) {
    const previous = new Map(
      Object.entries(before).flatMap(([c, rows]) =>
        rows.map((r) => [r.id, [c, JSON.stringify(r)]]),
      ),
    );
    const recordMap = new Map(
      Object.entries(store).flatMap(([collection, rows]) =>
        rows.map((record) => [record.id, { collection, record }]),
      ),
    );
    for (const rows of Object.values(store))
      for (const record of rows) {
        if (previous.get(record.id)?.[1] === JSON.stringify(record)) continue;
        if (record.workspaceId && recordMap.get(record.workspaceId)?.collection !== 'workspaces')
          throw new Error('Invalid workspace reference');
        if (record.patientId) {
          const patient = recordMap.get(record.patientId);
          if (
            patient?.collection !== 'patients' ||
            (record.workspaceId && patient.record.workspaceId !== record.workspaceId)
          )
            throw new Error('Invalid tenant-patient reference');
        }
      }
    const retained = new Set();
    const dirtyWorkspaces = new Set();
    let metadataChanged = false;
    for (const [collection, rows] of Object.entries(store))
      for (const record of rows) {
        retained.add(record.id);
        const data = JSON.stringify(record);
        if (Buffer.byteLength(data) > 1048576)
          throw Object.assign(
            new Error(
              'Registro excede o limite técnico de 1 MiB. Crie um novo plano para continuar o histórico.',
            ),
            { status: 413 },
          );
        if (previous.get(record.id)?.[1] === data) continue;
        if (record.workspaceId) dirtyWorkspaces.add(record.workspaceId);
        if (
          [
            'users',
            'workspaces',
            'memberships',
            'workspaceInvitations',
            'patientAccounts',
            'authTokens',
            'mailOutbox',
            'privacyRequests',
          ].includes(collection)
        )
          metadataChanged = true;
        this.upsert.run(
          record.id,
          collection,
          record.workspaceId || null,
          record.patientId || null,
          ['users', 'patientAccounts'].includes(collection)
            ? String(record.email || '')
                .trim()
                .toLowerCase()
            : null,
          data,
        );
      }
    const remove = this.db.prepare('DELETE FROM records WHERE id=?');
    for (const id of previous.keys()) if (!retained.has(id)) remove.run(id);
    const sessionInsert = this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)');
    const changedSessions =
      sessionSnapshot === undefined ||
      sessionSnapshot !== JSON.stringify([[...professionalSessions], [...patientSessions]]);
    if (changedSessions) this.db.exec('DELETE FROM sessions');
    /** @type {[string, Map<string,import('./contracts').Session>][]} */
    const groups = [
      ['professional', professionalSessions],
      ['patient', patientSessions],
    ];
    for (const [kind, sessions] of groups) {
      for (const [token, value] of sessions)
        if (changedSessions && value.expiresAt > Date.now())
          sessionInsert.run(kind, token, value.subjectId, value.expiresAt);
    }
    for (const workspace of dirtyWorkspaces) {
      const budget = this.db
        .prepare(
          'SELECT sum(length(CAST(data AS BLOB))) AS bytes FROM records WHERE workspace_id=?',
        )
        .get(workspace);
      if (Number(budget?.bytes || 0) > 33554432)
        throw Object.assign(new Error('Limite técnico de armazenamento do consultório atingido.'), {
          status: 413,
        });
    }
    if (metadataChanged) {
      const budget = this.db
        .prepare(
          "SELECT sum(length(CAST(data AS BLOB))) AS bytes FROM records WHERE collection IN ('users','workspaces','memberships','workspaceInvitations','patientAccounts','authTokens','mailOutbox','privacyRequests')",
        )
        .get();
      if (Number(budget?.bytes || 0) > 33554432)
        throw Object.assign(
          new Error('Limite técnico de identidades atingido. Solicite ampliação de capacidade.'),
          { status: 413 },
        );
    }
    this.db.exec('COMMIT');
  }
  /** @param {Map<string,import("./contracts").Session>} professional @param {Map<string,import("./contracts").Session>} patient */
  restoreSessions(professional, patient) {
    for (const row of this.db
      .prepare('SELECT * FROM sessions WHERE expires_at>?')
      .all(Date.now())) {
      Map.prototype.set.call(row.kind === 'professional' ? professional : patient, row.token_hash, {
        subjectId: String(row.subject_id),
        expiresAt: Number(row.expires_at),
      });
    }
  }
  /** @param {string} bucket @param {number} maximum @param {number} windowMs */
  limit(bucket, maximum, windowMs) {
    const now = Date.now();
    this.limiter.prepare('DELETE FROM rate_limits WHERE expires_at<=?').run(now);
    const row = this.limiter
      .prepare(
        `INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(bucket)
      DO UPDATE SET hits=hits+1 RETURNING hits,expires_at`,
      )
      .get(bucket, now + windowMs);
    return row && Number(row.hits) > maximum
      ? Math.max(1, Math.ceil((Number(row.expires_at) - now) / 1000))
      : 0;
  }
  /** @param {string} destination */
  async backup(destination) {
    return backup(this.db, destination);
  }
  close() {
    this.db.close();
    this.limiter.close();
  }
}
module.exports = { Persistence };
