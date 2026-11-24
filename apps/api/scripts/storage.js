'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Persistence } = require('../src/persistence');
const { encryptBackup, decryptBackup } = require('../src/backup-crypto');

async function main() {
  const [operation, source, destination] = process.argv.slice(2);
  if (
    !['import-json', 'backup', 'verify', 'backup-encrypted', 'restore-encrypted'].includes(
      operation,
    ) ||
    !source
  )
    throw new Error(
      'Use import-json SOURCE_JSON EMPTY_DIRECTORY | backup DATA_DIRECTORY NEW_FILE | verify BACKUP_FILE',
    );
  if (operation === 'backup-encrypted') {
    if (
      !destination ||
      fs.existsSync(destination) ||
      !fs.existsSync(path.join(source, 'nutritrack.sqlite'))
    )
      throw new Error('Use existing data and a new destination');
    const temporary = destination + '.' + require('crypto').randomUUID() + '.sqlite';
    const db = new Persistence(source);
    try {
      await db.backup(temporary);
      fs.chmodSync(temporary, 0o600);
      await encryptBackup(temporary, destination);
      console.log('Encrypted backup completed');
    } finally {
      db.close();
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return;
  }
  if (operation === 'restore-encrypted') {
    if (!destination || fs.existsSync(destination))
      throw new Error('Restore requires a new directory');
    fs.mkdirSync(destination, { mode: 0o700 });
    const file = path.join(destination, 'nutritrack.sqlite');
    try {
      await decryptBackup(source, file);
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(file);
      try {
        if (
          db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
          db.prepare('PRAGMA foreign_key_check').all().length
        )
          throw new Error('Restore validation failed');
        // A disaster restore must never reactivate sessions or links from a backup.
        // This touches only the newly restored copy, never the source/live database.
        db.exec(`BEGIN IMMEDIATE;
          DELETE FROM sessions;
          DELETE FROM records WHERE collection IN
            ('authTokens','patientInvitations','patientPasswordResets','workspaceInvitations','mailOutbox');
          COMMIT;`);
      } finally {
        db.close();
      }
      console.log('Restored and verified in new directory');
    } catch (error) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      fs.rmdirSync(destination);
      throw error;
    }
    return;
  }
  if (operation === 'verify') {
    if (!fs.existsSync(source)) throw new Error('Source missing');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(source, { readOnly: true });
    try {
      if (
        db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
        db.prepare('PRAGMA foreign_key_check').all().length
      )
        throw new Error('Backup validation failed');
      console.log('Backup integrity and references verified');
    } finally {
      db.close();
    }
    return;
  }
  if (!destination || !fs.existsSync(source)) throw new Error('Source and destination required');
  if (operation === 'backup') {
    if (fs.existsSync(destination) || !fs.existsSync(path.join(source, 'nutritrack.sqlite')))
      throw new Error('Source missing or destination already exists');
    const db = new Persistence(source);
    try {
      await db.backup(destination);
      fs.chmodSync(destination, 0o600);
      console.log('Backup completed');
    } finally {
      db.close();
    }
  } else {
    if (fs.existsSync(path.join(destination, 'nutritrack.sqlite')))
      throw new Error('Import requires a new database directory');
    const store = JSON.parse(fs.readFileSync(source, 'utf8'));
    const allowed = [
      'users',
      'patients',
      'assessments',
      'appointments',
      'goals',
      'mealPlans',
      'patientInvitations',
      'patientPasswordResets',
      'patientAccounts',
      'workspaces',
      'memberships',
      'patientAssignments',
      'workspaceInvitations',
      'audit',
      'authTokens',
      'mailOutbox',
      'privacyRequests',
    ];
    if (Object.keys(store).some((key) => !allowed.includes(key)))
      throw new Error('Unknown collection');
    const ids = new Set();
    for (const key of allowed) {
      store[key] ||= [];
      if (!Array.isArray(store[key])) throw new Error('Collection must be an array');
      for (const record of store[key]) {
        if (!record || typeof record.id !== 'string' || ids.has(record.id))
          throw new Error('Invalid or duplicate ID');
        ids.add(record.id);
      }
    }
    for (const record of Object.values(store).flat())
      for (const key of ['workspaceId', 'patientId', 'userId', 'professionalId']) {
        if (record[key] && !ids.has(record[key]))
          throw new Error('Dangling reference: reconcile source before import');
      }
    const db = new Persistence(destination);
    try {
      db.begin();
      db.commit({}, store, new Map(), new Map());
      console.log(
        JSON.stringify({
          event: 'import_completed',
          counts: Object.fromEntries(
            Object.entries(store).map(([key, rows]) => [key, rows.length]),
          ),
        }),
      );
    } catch (error) {
      db.rollback();
      throw error;
    } finally {
      db.close();
    }
  }
}
main().catch(() => {
  console.error(
    'Storage operation failed; original source was not modified. Check paths, references and uniqueness.',
  );
  process.exitCode = 1;
});
