-- Executar com o proprietário, após aplicar as migrações.
-- Os grupos não fazem login e não contêm senhas.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nutritrack_runtime') THEN
    CREATE ROLE nutritrack_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nutritrack_backup') THEN
    CREATE ROLE nutritrack_backup NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO nutritrack_runtime, nutritrack_backup;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  professionals, patients, assessments, appointments, goals, meal_plans,
  meal_plan_versions, patient_accounts, patient_invitations,
  patient_password_resets, audit_events, auth_sessions, auth_rate_limits
TO nutritrack_runtime;
GRANT SELECT ON storage_migrations TO nutritrack_runtime;
GRANT UPDATE (revision) ON storage_migrations TO nutritrack_runtime;
GRANT SELECT ON
  storage_migrations, professionals, patients, assessments, appointments,
  goals, meal_plans, meal_plan_versions, patient_accounts,
  patient_invitations, patient_password_resets, audit_events
TO nutritrack_backup;
-- Vincular os grupos a logins dedicados criados pelo titular, sem neon_superuser,
-- sem propriedade de banco e sem CREATE no schema. Conferir privilégios herdados.
-- A aplicação deve usar DB_AUTO_MIGRATE=false; migrações usam o proprietário.
