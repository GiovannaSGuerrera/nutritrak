CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket_hash text PRIMARY KEY,
    attempts integer NOT NULL,
    expires_at timestamptz NOT NULL
  );
CREATE INDEX IF NOT EXISTS auth_rate_limits_expiry ON auth_rate_limits (expires_at);
CREATE TABLE IF NOT EXISTS storage_migrations (
    version integer PRIMARY KEY, revision bigint NOT NULL DEFAULT 0,
    migrated_at timestamptz NOT NULL DEFAULT now(),
    legacy_snapshot jsonb NOT NULL
  );
CREATE TABLE IF NOT EXISTS professionals (
      id text PRIMARY KEY,
      position integer NOT NULL,
      record_keys text[] NOT NULL,
      extras jsonb NOT NULL DEFAULT '{}',
      "name" text NOT NULL, "email" text NOT NULL UNIQUE, "salt" text NOT NULL, "hash" text NOT NULL, "createdAt" text

    );
CREATE TABLE IF NOT EXISTS patients (
      id text PRIMARY KEY,
      position integer NOT NULL,
      record_keys text[] NOT NULL,
      extras jsonb NOT NULL DEFAULT '{}',
      "userId" text NOT NULL REFERENCES professionals(id), "name" text NOT NULL, "email" text, "phone" text, "birthDate" text, "status" text, "objective" text, "clinicalNotes" text, "createdAt" text, "updatedAt" text
      , UNIQUE (id, "userId")
    );
CREATE INDEX IF NOT EXISTS patients_lookup_0
       ON patients ("userId", "name");
CREATE TABLE IF NOT EXISTS assessments (
      id text PRIMARY KEY,
      position integer NOT NULL,
      record_keys text[] NOT NULL,
      extras jsonb NOT NULL DEFAULT '{}',
      "userId" text NOT NULL REFERENCES professionals(id), "patientId" text NOT NULL, "date" text, "weight" double precision, "height" double precision, "weightUnit" text, "heightUnit" text, "bmi" double precision, "fat" double precision, "fatMass" double precision, "leanMass" double precision, "waist" double precision, "hip" double precision, "method" text, "notes" text, "createdAt" text
      , FOREIGN KEY ("patientId", "userId") REFERENCES patients(id, "userId")
    );
CREATE INDEX IF NOT EXISTS assessments_lookup_0
       ON assessments ("patientId", "userId");
CREATE INDEX IF NOT EXISTS assessments_lookup_1
       ON assessments ("userId", "date");
CREATE TABLE IF NOT EXISTS appointments (
      id text PRIMARY KEY,
      position integer NOT NULL,
      record_keys text[] NOT NULL,
      extras jsonb NOT NULL DEFAULT '{}',
      "userId" text NOT NULL REFERENCES professionals(id), "patientId" text NOT NULL, "start" text, "end" text, "duration" double precision, "status" text, "type" text, "notes" text, "createdAt" text
      , FOREIGN KEY ("patientId", "userId") REFERENCES patients(id, "userId")
    );
CREATE INDEX IF NOT EXISTS appointments_lookup_0
       ON appointments ("patientId", "userId");
CREATE INDEX IF NOT EXISTS appointments_lookup_1
       ON appointments ("userId", "start");
CREATE TABLE IF NOT EXISTS goals (
      id text PRIMARY KEY,
      position integer NOT NULL,
      record_keys text[] NOT NULL,
      extras jsonb NOT NULL DEFAULT '{}',
      "userId" text NOT NULL REFERENCES professionals(id), "patientId" text NOT NULL, "description" text, "category" text, "dueDate" text, "status" text, "progress" jsonb, "createdAt" text
      , FOREIGN KEY ("patientId", "userId") REFERENCES patients(id, "userId")
    );
CREATE INDEX IF NOT EXISTS goals_lookup_0
       ON goals ("patientId", "userId");
CREATE INDEX IF NOT EXISTS goals_lookup_1
       ON goals ("userId");
CREATE TABLE IF NOT EXISTS meal_plans (
      id text PRIMARY KEY,
      position integer NOT NULL,
      record_keys text[] NOT NULL,
      extras jsonb NOT NULL DEFAULT '{}',
      "userId" text NOT NULL REFERENCES professionals(id), "patientId" text NOT NULL, "name" text, "publishedVersionId" text, "createdAt" text, "updatedAt" text
      , FOREIGN KEY ("patientId", "userId") REFERENCES patients(id, "userId")
    );
CREATE INDEX IF NOT EXISTS meal_plans_lookup_0
       ON meal_plans ("patientId", "userId");
CREATE INDEX IF NOT EXISTS meal_plans_lookup_1
       ON meal_plans ("userId", "updatedAt");
CREATE TABLE IF NOT EXISTS meal_plan_versions (
      id text PRIMARY KEY,
      position integer NOT NULL,
      record_keys text[] NOT NULL,
      extras jsonb NOT NULL DEFAULT '{}',
      "planId" text NOT NULL REFERENCES meal_plans(id), "number" integer NOT NULL, "status" text NOT NULL CHECK (status IN ('draft', 'published')), "objective" text, "startDate" text, "reviewDate" text, "generalInstructions" text, "meals" jsonb, "createdAt" text, "publishedAt" text
      , UNIQUE ("planId", number), UNIQUE (id, "planId")
    );
CREATE TABLE IF NOT EXISTS patient_accounts (
      id text PRIMARY KEY,
      position integer NOT NULL,
      record_keys text[] NOT NULL,
      extras jsonb NOT NULL DEFAULT '{}',
      "professionalId" text NOT NULL REFERENCES professionals(id), "patientId" text NOT NULL, "email" text NOT NULL UNIQUE, "salt" text NOT NULL, "hash" text NOT NULL, "createdAt" text
      , FOREIGN KEY ("patientId", "professionalId") REFERENCES patients(id, "userId"), UNIQUE ("patientId", "professionalId"), UNIQUE (id, "patientId", "professionalId")
    );
CREATE INDEX IF NOT EXISTS patient_accounts_lookup_0
       ON patient_accounts ("professionalId");
CREATE TABLE IF NOT EXISTS patient_invitations (
      id text PRIMARY KEY,
      position integer NOT NULL,
      record_keys text[] NOT NULL,
      extras jsonb NOT NULL DEFAULT '{}',
      "professionalId" text NOT NULL REFERENCES professionals(id), "patientId" text NOT NULL, "tokenHash" text NOT NULL UNIQUE, "createdAt" text, "expiresAt" text, "usedAt" text, "revokedAt" text
      , FOREIGN KEY ("patientId", "professionalId") REFERENCES patients(id, "userId")
    );
CREATE INDEX IF NOT EXISTS patient_invitations_lookup_0
       ON patient_invitations ("patientId", "professionalId");
CREATE INDEX IF NOT EXISTS patient_invitations_lookup_1
       ON patient_invitations ("professionalId");
CREATE TABLE IF NOT EXISTS patient_password_resets (
      id text PRIMARY KEY,
      position integer NOT NULL,
      record_keys text[] NOT NULL,
      extras jsonb NOT NULL DEFAULT '{}',
      "professionalId" text NOT NULL REFERENCES professionals(id), "patientId" text NOT NULL, "accountId" text NOT NULL, "tokenHash" text NOT NULL UNIQUE, "createdAt" text, "expiresAt" text, "usedAt" text, "revokedAt" text
      , FOREIGN KEY ("patientId", "professionalId") REFERENCES patients(id, "userId"), FOREIGN KEY ("accountId", "patientId", "professionalId") REFERENCES patient_accounts(id, "patientId", "professionalId")
    );
CREATE INDEX IF NOT EXISTS patient_password_resets_lookup_0
       ON patient_password_resets ("accountId", "patientId", "professionalId");
CREATE INDEX IF NOT EXISTS patient_password_resets_lookup_1
       ON patient_password_resets ("patientId", "professionalId");
CREATE INDEX IF NOT EXISTS patient_password_resets_lookup_2
       ON patient_password_resets ("professionalId");
CREATE TABLE IF NOT EXISTS audit_events (
      id text PRIMARY KEY,
      position integer NOT NULL,
      record_keys text[] NOT NULL,
      extras jsonb NOT NULL DEFAULT '{}',
      "userId" text NOT NULL REFERENCES professionals(id), "action" text, "type" text, "recordId" text, "at" text

    );
CREATE INDEX IF NOT EXISTS audit_events_lookup_0
       ON audit_events ("userId", "at");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'meal_plans'::regclass AND conname = 'published_version_belongs_to_plan') THEN
      ALTER TABLE meal_plans ADD CONSTRAINT published_version_belongs_to_plan
      FOREIGN KEY ("publishedVersionId", id) REFERENCES meal_plan_versions(id, "planId")
      DEFERRABLE INITIALLY DEFERRED;
    END IF;
  END $$;
CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash text PRIMARY KEY,
    professional_id text REFERENCES professionals(id),
    patient_account_id text REFERENCES patient_accounts(id),
    credential_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    CHECK ((professional_id IS NOT NULL) <> (patient_account_id IS NOT NULL))
  );
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions (expires_at);
CREATE INDEX IF NOT EXISTS auth_sessions_professional ON auth_sessions (professional_id);
CREATE INDEX IF NOT EXISTS auth_sessions_patient ON auth_sessions (patient_account_id);
