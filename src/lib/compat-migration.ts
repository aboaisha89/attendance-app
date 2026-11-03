import {db} from './db';

/** Additive compatibility migration for already signed-in users. No data deletion. */
let pending: Promise<void> | undefined;
export function ensureAccessAndLeaveSchema(): Promise<void> {
  if (!pending) pending = migrate().catch(error => { pending = undefined; throw error; });
  return pending;
}
async function ensureIndexes(sql: ReturnType<typeof db>) {
  const stmts = [
    `CREATE INDEX IF NOT EXISTS idx_sessions_employee_checkin ON attendance_sessions(employee_id, check_in DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_checkin ON attendance_sessions(check_in DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_requests_employee_created ON requests(employee_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role)`
  ];
  for (const q of stmts) { try { await sql.query(q); } catch { /* table may not exist yet */ } }
}
async function migrate() {
  const sql = db();
  await sql.query(`ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check`);
  await sql.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS early_grace_minutes INTEGER NOT NULL DEFAULT 0`);
  await sql.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS overtime_grace_minutes INTEGER NOT NULL DEFAULT 0`);
  await sql.query(`CREATE TABLE IF NOT EXISTS role_access (
    role TEXT PRIMARY KEY, pages JSONB NOT NULL,
    sidebar_enabled BOOLEAN NOT NULL DEFAULT false
  )`);
  await sql.query(`ALTER TABLE role_access ADD COLUMN IF NOT EXISTS ui_visibility JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await sql.query(`INSERT INTO role_access(role,pages,sidebar_enabled) VALUES
    ('employee','["dashboard","history","punch","reports","profile","requests"]'::jsonb,false),
    ('admin','["dashboard","onsite","reports","profile","employees","branches","shifts","geofences","requests","settings","permissions"]'::jsonb,true),
    ('display','["onsite"]'::jsonb,false)
    ON CONFLICT (role) DO NOTHING`);
  await sql.query(`ALTER TABLE role_access ADD COLUMN IF NOT EXISTS label TEXT`);
  await sql.query(`ALTER TABLE role_access ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'self'`);
  await sql.query(`UPDATE role_access SET scope='all' WHERE role='admin' AND scope<>'all'`);
  await sql.query(`UPDATE role_access SET label=CASE role WHEN 'admin' THEN 'Administrator' WHEN 'employee' THEN 'Employee' WHEN 'display' THEN 'Display Screen' ELSE initcap(role) END WHERE label IS NULL`);
  await sql.query(`CREATE TABLE IF NOT EXISTS attendance_failures(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,branch_id UUID,action TEXT NOT NULL,reason TEXT NOT NULL,lat DOUBLE PRECISION,lon DOUBLE PRECISION,accuracy DOUBLE PRECISION,distance_m DOUBLE PRECISION,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_failures_created ON attendance_failures(created_at DESC)`);
  await sql.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS device_lock BOOLEAN NOT NULL DEFAULT true`);
  await sql.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS allow_registration BOOLEAN NOT NULL DEFAULT true`);
  await sql.query(`CREATE TABLE IF NOT EXISTS employee_devices(employee_id UUID PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,device_hash TEXT NOT NULL,label TEXT,user_agent TEXT,ip TEXT,bound_at TIMESTAMPTZ NOT NULL DEFAULT now(),last_seen TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await sql.query(`CREATE TABLE IF NOT EXISTS device_alerts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,attempted_hash TEXT,label TEXT,user_agent TEXT,ip TEXT,context TEXT NOT NULL DEFAULT 'login',status TEXT NOT NULL DEFAULT 'open',created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_device_alerts_status ON device_alerts(status,created_at DESC)`);
  await sql.query(`CREATE TABLE IF NOT EXISTS activity_log(id BIGSERIAL PRIMARY KEY,actor_id UUID,actor_name TEXT,actor_role TEXT,action TEXT NOT NULL,target TEXT,detail TEXT,lat DOUBLE PRECISION,lon DOUBLE PRECISION,accuracy DOUBLE PRECISION,ip TEXT,device TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_log(actor_id,created_at DESC)`);
  await sql.query(`ALTER TABLE employee_devices ADD COLUMN IF NOT EXISTS info JSONB`);
  await sql.query(`ALTER TABLE device_alerts ADD COLUMN IF NOT EXISTS info JSONB`);
  await ensureIndexes(sql);
  await sql.query(`CREATE TABLE IF NOT EXISTS request_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await sql.query(`ALTER TABLE request_categories ADD COLUMN IF NOT EXISTS public_id TEXT`);
  await sql.query(`CREATE SEQUENCE IF NOT EXISTS request_categories_public_seq`);
  await sql.query(`UPDATE request_categories SET public_id = 'CAT-' || lpad(nextval('request_categories_public_seq')::text,5,'0') WHERE public_id IS NULL`);
  await sql.query(`ALTER TABLE request_categories ALTER COLUMN public_id SET DEFAULT ('CAT-' || lpad(nextval('request_categories_public_seq')::text,5,'0'))`);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS request_categories_public_id_unique ON request_categories(public_id)`);
  await sql.query(`INSERT INTO request_categories(name) VALUES ('Leave'),('Absence'),('Correction'),('Overtime') ON CONFLICT (name) DO NOTHING`);
  await sql.query(`CREATE TABLE IF NOT EXISTS employee_leaves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    start_date DATE NOT NULL, end_date DATE NOT NULL,
    leave_type TEXT NOT NULL DEFAULT 'Leave',
    notes TEXT NOT NULL DEFAULT '',
    created_by UUID NOT NULL REFERENCES employees(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
  )`);
  await sql.query(`CREATE INDEX IF NOT EXISTS employee_leaves_employee_dates ON employee_leaves(employee_id,start_date,end_date)`);
  await sql.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_view TEXT`);
  // Weekly off days (history keeps past days untouched) and per-day admin overrides
  await sql.query(`CREATE TABLE IF NOT EXISTS employee_off_days(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,effective_from DATE NOT NULL,days SMALLINT[] NOT NULL DEFAULT '{}',created_by UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(employee_id,effective_from))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS employee_day_overrides(employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,day DATE NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('off','work')),created_by UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(employee_id,day))`);
  // Per-employee attendance rules
  await sql.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS allow_outside_geofence BOOLEAN NOT NULL DEFAULT false`);
  await sql.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS allow_multiple_devices BOOLEAN NOT NULL DEFAULT false`);
  await sql.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS max_checkin_enabled BOOLEAN NOT NULL DEFAULT false`);
  await sql.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS max_checkin_hours NUMERIC(5,2)`);
  // Session-level maximum duration: snapshot taken at check-in, flag set when the session ends as Absent
  await sql.query(`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS missed_checkout BOOLEAN NOT NULL DEFAULT false`);
  await sql.query(`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS expired_absent BOOLEAN NOT NULL DEFAULT false`);
  await sql.query(`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS max_hours_snapshot NUMERIC(5,2)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_sessions_open_max ON attendance_sessions(check_in) WHERE check_out IS NULL AND max_hours_snapshot IS NOT NULL`);
  await sql.query(`CREATE TABLE IF NOT EXISTS attendance_change_audit (id BIGSERIAL PRIMARY KEY, session_id UUID NOT NULL, employee_id UUID NOT NULL, admin_id UUID NOT NULL, action TEXT NOT NULL, old_values JSONB NOT NULL, new_values JSONB, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await sql.query(`CREATE TABLE IF NOT EXISTS attendance_manual_audit(id BIGSERIAL PRIMARY KEY,employee_id UUID NOT NULL REFERENCES employees(id),admin_id UUID NOT NULL REFERENCES employees(id),check_in TIMESTAMPTZ NOT NULL,check_out TIMESTAMPTZ NOT NULL,break_minutes NUMERIC(8,2) NOT NULL DEFAULT 0,reason TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
}
