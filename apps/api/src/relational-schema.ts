export type StoredRecord = { id: string; [key: string]: unknown };
export type StoreState = Record<string, StoredRecord[]>;

export interface EntityDefinition {
  key: string;
  table: string;
  columns: Record<string, string>;
  constraints?: string[];
  indexes?: string[][];
}

const ownership = {
  userId: 'text NOT NULL REFERENCES professionals(id)',
  patientId: 'text NOT NULL',
};
const patientConstraint = 'FOREIGN KEY ("patientId", "userId") REFERENCES patients(id, "userId")';
const portalOwnership = {
  professionalId: 'text NOT NULL REFERENCES professionals(id)',
  patientId: 'text NOT NULL',
};
const portalConstraint =
  'FOREIGN KEY ("patientId", "professionalId") REFERENCES patients(id, "userId")';

// Column definitions are internal constants. Record values always use query parameters.
export const entities: EntityDefinition[] = [
  {
    key: 'users',
    table: 'professionals',
    columns: {
      name: 'text NOT NULL',
      email: 'text NOT NULL UNIQUE',
      salt: 'text NOT NULL',
      hash: 'text NOT NULL',
      createdAt: 'text',
    },
  },
  {
    key: 'patients',
    table: 'patients',
    columns: {
      userId: 'text NOT NULL REFERENCES professionals(id)',
      name: 'text NOT NULL',
      email: 'text',
      phone: 'text',
      birthDate: 'text',
      status: 'text',
      objective: 'text',
      clinicalNotes: 'text',
      createdAt: 'text',
      updatedAt: 'text',
    },
    constraints: ['UNIQUE (id, "userId")'],
    indexes: [['userId', 'name']],
  },
  {
    key: 'assessments',
    table: 'assessments',
    columns: {
      ...ownership,
      date: 'text',
      weight: 'double precision',
      height: 'double precision',
      weightUnit: 'text',
      heightUnit: 'text',
      bmi: 'double precision',
      fat: 'double precision',
      fatMass: 'double precision',
      leanMass: 'double precision',
      waist: 'double precision',
      hip: 'double precision',
      method: 'text',
      notes: 'text',
      createdAt: 'text',
    },
    constraints: [patientConstraint],
    indexes: [
      ['patientId', 'userId'],
      ['userId', 'date'],
    ],
  },
  {
    key: 'appointments',
    table: 'appointments',
    columns: {
      ...ownership,
      start: 'text',
      end: 'text',
      duration: 'double precision',
      status: 'text',
      type: 'text',
      notes: 'text',
      createdAt: 'text',
    },
    constraints: [patientConstraint],
    indexes: [
      ['patientId', 'userId'],
      ['userId', 'start'],
    ],
  },
  {
    key: 'goals',
    table: 'goals',
    columns: {
      ...ownership,
      description: 'text',
      category: 'text',
      dueDate: 'text',
      status: 'text',
      progress: 'jsonb',
      createdAt: 'text',
    },
    constraints: [patientConstraint],
    indexes: [['patientId', 'userId'], ['userId']],
  },
  {
    key: 'mealPlans',
    table: 'meal_plans',
    columns: {
      ...ownership,
      name: 'text',
      publishedVersionId: 'text',
      createdAt: 'text',
      updatedAt: 'text',
    },
    constraints: [patientConstraint],
    indexes: [
      ['patientId', 'userId'],
      ['userId', 'updatedAt'],
    ],
  },
  {
    key: 'versions',
    table: 'meal_plan_versions',
    columns: {
      planId: 'text NOT NULL REFERENCES meal_plans(id)',
      number: 'integer NOT NULL',
      status: "text NOT NULL CHECK (status IN ('draft', 'published'))",
      objective: 'text',
      startDate: 'text',
      reviewDate: 'text',
      generalInstructions: 'text',
      meals: 'jsonb',
      createdAt: 'text',
      publishedAt: 'text',
    },
    constraints: ['UNIQUE ("planId", number)', 'UNIQUE (id, "planId")'],
  },
  {
    key: 'patientAccounts',
    table: 'patient_accounts',
    columns: {
      ...portalOwnership,
      email: 'text NOT NULL UNIQUE',
      salt: 'text NOT NULL',
      hash: 'text NOT NULL',
      createdAt: 'text',
    },
    constraints: [
      portalConstraint,
      'UNIQUE ("patientId", "professionalId")',
      'UNIQUE (id, "patientId", "professionalId")',
    ],
    indexes: [['professionalId']],
  },
  {
    key: 'patientInvitations',
    table: 'patient_invitations',
    columns: {
      ...portalOwnership,
      tokenHash: 'text NOT NULL UNIQUE',
      createdAt: 'text',
      expiresAt: 'text',
      usedAt: 'text',
      revokedAt: 'text',
    },
    constraints: [portalConstraint],
    indexes: [['patientId', 'professionalId'], ['professionalId']],
  },
  {
    key: 'patientPasswordResets',
    table: 'patient_password_resets',
    columns: {
      ...portalOwnership,
      accountId: 'text NOT NULL',
      tokenHash: 'text NOT NULL UNIQUE',
      createdAt: 'text',
      expiresAt: 'text',
      usedAt: 'text',
      revokedAt: 'text',
    },
    constraints: [
      portalConstraint,
      'FOREIGN KEY ("accountId", "patientId", "professionalId") REFERENCES patient_accounts(id, "patientId", "professionalId")',
    ],
    indexes: [
      ['accountId', 'patientId', 'professionalId'],
      ['patientId', 'professionalId'],
      ['professionalId'],
    ],
  },
  {
    key: 'audit',
    table: 'audit_events',
    columns: {
      userId: 'text NOT NULL REFERENCES professionals(id)',
      action: 'text',
      type: 'text',
      recordId: 'text',
      at: 'text',
    },
    indexes: [['userId', 'at']],
  },
];

export const schemaSql = [
  `CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket_hash text PRIMARY KEY,
    attempts integer NOT NULL,
    expires_at timestamptz NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS auth_rate_limits_expiry ON auth_rate_limits (expires_at)',
  // Sessions are shared by all serverless instances; only token hashes are stored.

  `CREATE TABLE IF NOT EXISTS storage_migrations (
    version integer PRIMARY KEY, revision bigint NOT NULL DEFAULT 0,
    migrated_at timestamptz NOT NULL DEFAULT now(),
    legacy_snapshot jsonb NOT NULL
  )`,
  ...entities.flatMap((entity) => [
    `CREATE TABLE IF NOT EXISTS ${entity.table} (
      id text PRIMARY KEY,
      position integer NOT NULL,
      record_keys text[] NOT NULL,
      extras jsonb NOT NULL DEFAULT '{}',
      ${Object.entries(entity.columns)
        .map(([name, type]) => `"${name}" ${type}`)
        .join(', ')}
      ${entity.constraints?.length ? ', ' + entity.constraints.join(', ') : ''}
    )`,
    ...(entity.indexes || []).map(
      (columns, index) =>
        `CREATE INDEX IF NOT EXISTS ${entity.table}_lookup_${index}
       ON ${entity.table} (${columns.map((column) => `"${column}"`).join(', ')})`,
    ),
  ]),
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'meal_plans'::regclass AND conname = 'published_version_belongs_to_plan') THEN
      ALTER TABLE meal_plans ADD CONSTRAINT published_version_belongs_to_plan
      FOREIGN KEY ("publishedVersionId", id) REFERENCES meal_plan_versions(id, "planId")
      DEFERRABLE INITIALLY DEFERRED;
    END IF;
  END $$`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash text PRIMARY KEY,
    professional_id text REFERENCES professionals(id),
    patient_account_id text REFERENCES patient_accounts(id),
    credential_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    CHECK ((professional_id IS NOT NULL) <> (patient_account_id IS NOT NULL))
  )`,
  'CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions (expires_at)',
  'CREATE INDEX IF NOT EXISTS auth_sessions_professional ON auth_sessions (professional_id)',
  'CREATE INDEX IF NOT EXISTS auth_sessions_patient ON auth_sessions (patient_account_id)',
].join(';\n');
