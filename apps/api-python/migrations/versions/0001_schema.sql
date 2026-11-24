
CREATE TABLE rate_limit_hits (
	id UUID NOT NULL,
	bucket VARCHAR(64) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id)
)

;
CREATE INDEX ix_rate_limit_hits_bucket ON rate_limit_hits (bucket);
CREATE INDEX ix_rate_limit_hits_created_at ON rate_limit_hits (created_at);

CREATE TABLE users (
	id UUID NOT NULL,
	name VARCHAR(120) NOT NULL,
	email VARCHAR(254) NOT NULL,
	password_hash VARCHAR(255) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id)
)

;
CREATE UNIQUE INDEX ix_users_email ON users (email);

CREATE TABLE workspaces (
	id UUID NOT NULL,
	name VARCHAR(160) NOT NULL,
	kind VARCHAR(24) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id)
)

;

CREATE TABLE memberships (
	id UUID NOT NULL,
	workspace_id UUID NOT NULL,
	user_id UUID NOT NULL,
	roles JSONB NOT NULL,
	active BOOLEAN NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (workspace_id, user_id),
	FOREIGN KEY(workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)

;
CREATE INDEX ix_memberships_workspace_id ON memberships (workspace_id);
CREATE INDEX ix_memberships_user_id ON memberships (user_id);

CREATE TABLE patients (
	id UUID NOT NULL,
	workspace_id UUID NOT NULL,
	created_by UUID NOT NULL,
	name VARCHAR(150) NOT NULL,
	email VARCHAR(254) NOT NULL,
	phone VARCHAR(80) NOT NULL,
	birth_date VARCHAR(10) NOT NULL,
	status VARCHAR(32) NOT NULL,
	profile JSONB NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_patients_workspace_id UNIQUE (workspace_id, id),
	FOREIGN KEY(workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
	FOREIGN KEY(created_by) REFERENCES users (id)
)

;
CREATE INDEX ix_patients_created_by ON patients (created_by);
CREATE INDEX ix_patients_workspace_id ON patients (workspace_id);

CREATE TABLE appointments (
	id UUID NOT NULL,
	workspace_id UUID NOT NULL,
	patient_id UUID NOT NULL,
	created_by UUID NOT NULL,
	start_at TIMESTAMP WITH TIME ZONE NOT NULL,
	end_at TIMESTAMP WITH TIME ZONE NOT NULL,
	status VARCHAR(24) NOT NULL,
	data JSONB NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT fk_appointment_tenant_patient FOREIGN KEY(workspace_id, patient_id) REFERENCES patients (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY(workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
	FOREIGN KEY(patient_id) REFERENCES patients (id) ON DELETE CASCADE,
	FOREIGN KEY(created_by) REFERENCES users (id)
)

;
CREATE INDEX ix_appointments_workspace_id ON appointments (workspace_id);
CREATE INDEX ix_appointments_start_at ON appointments (start_at);
CREATE INDEX ix_appointments_workspace_start ON appointments (workspace_id, start_at);
CREATE INDEX ix_appointments_patient_id ON appointments (patient_id);

CREATE TABLE assessments (
	id UUID NOT NULL,
	workspace_id UUID NOT NULL,
	patient_id UUID NOT NULL,
	created_by UUID NOT NULL,
	date DATE NOT NULL,
	weight FLOAT,
	height FLOAT,
	bmi FLOAT,
	fat FLOAT,
	measurements JSONB NOT NULL,
	notes TEXT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT fk_assessment_tenant_patient FOREIGN KEY(workspace_id, patient_id) REFERENCES patients (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY(workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
	FOREIGN KEY(patient_id) REFERENCES patients (id) ON DELETE CASCADE,
	FOREIGN KEY(created_by) REFERENCES users (id)
)

;
CREATE INDEX ix_assessments_patient_id ON assessments (patient_id);
CREATE INDEX ix_assessments_workspace_id ON assessments (workspace_id);

CREATE TABLE goals (
	id UUID NOT NULL,
	workspace_id UUID NOT NULL,
	patient_id UUID NOT NULL,
	created_by UUID NOT NULL,
	description VARCHAR(500) NOT NULL,
	status VARCHAR(24) NOT NULL,
	progress JSONB NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT fk_goal_tenant_patient FOREIGN KEY(workspace_id, patient_id) REFERENCES patients (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY(workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
	FOREIGN KEY(patient_id) REFERENCES patients (id) ON DELETE CASCADE,
	FOREIGN KEY(created_by) REFERENCES users (id)
)

;
CREATE INDEX ix_goals_workspace_id ON goals (workspace_id);
CREATE INDEX ix_goals_patient_id ON goals (patient_id);

CREATE TABLE meal_plans (
	id UUID NOT NULL,
	workspace_id UUID NOT NULL,
	patient_id UUID NOT NULL,
	created_by UUID NOT NULL,
	name VARCHAR(120) NOT NULL,
	versions JSONB NOT NULL,
	published_version_id VARCHAR(40),
	PRIMARY KEY (id),
	CONSTRAINT fk_meal_plan_tenant_patient FOREIGN KEY(workspace_id, patient_id) REFERENCES patients (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY(workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
	FOREIGN KEY(patient_id) REFERENCES patients (id) ON DELETE CASCADE,
	FOREIGN KEY(created_by) REFERENCES users (id)
)

;
CREATE INDEX ix_meal_plans_workspace_id ON meal_plans (workspace_id);
CREATE INDEX ix_meal_plans_patient_id ON meal_plans (patient_id);

CREATE TABLE one_time_tokens (
	id UUID NOT NULL,
	patient_id UUID NOT NULL,
	purpose VARCHAR(20) NOT NULL,
	token_hash VARCHAR(64) NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	used_at TIMESTAMP WITH TIME ZONE,
	PRIMARY KEY (id),
	FOREIGN KEY(patient_id) REFERENCES patients (id) ON DELETE CASCADE,
	UNIQUE (token_hash)
)

;
CREATE INDEX ix_one_time_tokens_patient_id ON one_time_tokens (patient_id);

CREATE TABLE patient_accounts (
	id UUID NOT NULL,
	patient_id UUID NOT NULL,
	email VARCHAR(254) NOT NULL,
	password_hash VARCHAR(255) NOT NULL,
	access_state VARCHAR(20) NOT NULL,
	session_version INTEGER NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (patient_id),
	FOREIGN KEY(patient_id) REFERENCES patients (id) ON DELETE CASCADE
)

;
CREATE UNIQUE INDEX ix_patient_accounts_email ON patient_accounts (email);

CREATE TABLE patient_assignments (
	id UUID NOT NULL,
	workspace_id UUID NOT NULL,
	patient_id UUID NOT NULL,
	user_id UUID NOT NULL,
	assignment_type VARCHAR(20) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (workspace_id, patient_id, user_id),
	CONSTRAINT fk_patient_assignment_tenant_patient FOREIGN KEY(workspace_id, patient_id) REFERENCES patients (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY(workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
	FOREIGN KEY(patient_id) REFERENCES patients (id) ON DELETE CASCADE,
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)

;
CREATE INDEX ix_patient_assignments_workspace_id ON patient_assignments (workspace_id);
CREATE INDEX ix_patient_assignments_patient_id ON patient_assignments (patient_id);
CREATE INDEX ix_patient_assignments_user_id ON patient_assignments (user_id);

CREATE TABLE sessions (
	id VARCHAR(64) NOT NULL,
	user_id UUID,
	patient_account_id UUID,
	workspace_id UUID,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	revoked_at TIMESTAMP WITH TIME ZONE,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	FOREIGN KEY(patient_account_id) REFERENCES patient_accounts (id) ON DELETE CASCADE,
	FOREIGN KEY(workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
)

;
CREATE INDEX ix_sessions_user_id ON sessions (user_id);
CREATE INDEX ix_sessions_expires_at ON sessions (expires_at);
CREATE INDEX ix_sessions_patient_account_id ON sessions (patient_account_id);
