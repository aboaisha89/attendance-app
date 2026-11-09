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
  await sql.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS punch_hold_enabled BOOLEAN NOT NULL DEFAULT false`);
  await sql.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS punch_hold_seconds INTEGER NOT NULL DEFAULT 3`);
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
  // Points system: salary fields, rules (single row) and admin settlements.
  await sql.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary NUMERIC(12,2)`);
  await sql.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS basic_salary NUMERIC(12,2)`);
  await sql.query(`CREATE TABLE IF NOT EXISTS points_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled BOOLEAN NOT NULL DEFAULT false,start_date DATE,config JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await sql.query(`INSERT INTO points_settings(id) VALUES(1) ON CONFLICT (id) DO NOTHING`);
  await sql.query(`CREATE TABLE IF NOT EXISTS points_settlements(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('green_black','green_red')),count INTEGER NOT NULL CHECK(count>0),red_points INTEGER NOT NULL DEFAULT 0,note TEXT,settled_on DATE NOT NULL,created_by UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_points_settlements_emp ON points_settlements(employee_id,settled_on)`);
  await sql.query(`CREATE TABLE IF NOT EXISTS points_adjustments(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,type TEXT NOT NULL CHECK(type IN ('green','red','black')),points INTEGER NOT NULL CHECK(points<>0),reason TEXT,adjusted_on DATE NOT NULL,created_by UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_points_adjustments_emp ON points_adjustments(employee_id,adjusted_on)`);
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
  await sql.query(`ALTER TABLE employee_devices ADD COLUMN IF NOT EXISTS alt_hash TEXT`);
  await sql.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS device_match_mode TEXT NOT NULL DEFAULT 'flexible'`);
  // Announcements: type, scheduling, audience, resend tracking
  await sql.query(`ALTER TABLE admin_messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'notice'`);
  await sql.query(`ALTER TABLE admin_messages ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent'`);
  await sql.query(`ALTER TABLE admin_messages ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ`);
  await sql.query(`ALTER TABLE admin_messages ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`);
  await sql.query(`ALTER TABLE admin_messages ADD COLUMN IF NOT EXISTS audience JSONB`);
  await sql.query(`ALTER TABLE admin_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
  await sql.query(`ALTER TABLE admin_messages ADD COLUMN IF NOT EXISTS resend_count INTEGER NOT NULL DEFAULT 0`);
  await sql.query(`ALTER TABLE admin_messages ADD COLUMN IF NOT EXISTS last_resent_at TIMESTAMPTZ`);
  await sql.query(`UPDATE admin_messages SET sent_at=created_at WHERE sent_at IS NULL AND status='sent'`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_admin_messages_due ON admin_messages(scheduled_for) WHERE status='scheduled'`);
  await sql.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref_id UUID`);
  await sql.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS hours_format TEXT NOT NULL DEFAULT 'auto'`);
  await sql.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS gps_max_accuracy_m INTEGER NOT NULL DEFAULT 150`);
  await sql.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS punching_paused BOOLEAN NOT NULL DEFAULT false`);
  await sql.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS punching_paused_message TEXT NOT NULL DEFAULT ''`);
  await sql.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS default_required_hours NUMERIC(4,2)`);
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
  await sql.query(`ALTER TABLE geofences ADD COLUMN IF NOT EXISTS shape TEXT NOT NULL DEFAULT 'polygon'`);
  await sql.query(`ALTER TABLE geofences ADD COLUMN IF NOT EXISTS meta JSONB`);
  // Special working-hours periods (e.g. Ramadan): override the required hours snapshot stored on each session
  await sql.query(`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS base_hours_snapshot NUMERIC(5,2)`);
  await sql.query(`CREATE TABLE IF NOT EXISTS work_hour_periods(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL,start_date DATE NOT NULL,end_date DATE NOT NULL,hours NUMERIC(4,2) NOT NULL CHECK(hours>0 AND hours<=24),scope TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all','employees')),employee_ids UUID[] NOT NULL DEFAULT '{}',active BOOLEAN NOT NULL DEFAULT true,note TEXT NOT NULL DEFAULT '',created_by UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK(end_date>=start_date))`);
  await sql.query(`CREATE INDEX IF NOT EXISTS work_hour_periods_dates ON work_hour_periods(start_date,end_date) WHERE active`);
  await sql.query(`ALTER TABLE work_hour_periods ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'range'`);
  await sql.query(`ALTER TABLE work_hour_periods ADD COLUMN IF NOT EXISTS weekdays SMALLINT[] NOT NULL DEFAULT '{}'`);
  await sql.query(`ALTER TABLE work_hour_periods ADD COLUMN IF NOT EXISTS months SMALLINT[] NOT NULL DEFAULT '{}'`);
  await sql.query(`ALTER TABLE work_hour_periods ADD COLUMN IF NOT EXISTS day_of_month SMALLINT`);
  await sql.query(`ALTER TABLE work_hour_periods ADD COLUMN IF NOT EXISTS nth SMALLINT`);
  await sql.query(`CREATE OR REPLACE FUNCTION wh_period_matches(p_kind TEXT,p_weekdays SMALLINT[],p_months SMALLINT[],p_dom SMALLINT,p_nth SMALLINT,d DATE) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$ SELECT CASE p_kind WHEN 'range' THEN true WHEN 'weekday' THEN EXTRACT(DOW FROM d)::int=ANY(p_weekdays::int[]) AND (cardinality(p_months)=0 OR EXTRACT(MONTH FROM d)::int=ANY(p_months::int[])) WHEN 'date' THEN EXTRACT(DAY FROM d)::int=p_dom AND (cardinality(p_months)=0 OR EXTRACT(MONTH FROM d)::int=ANY(p_months::int[])) WHEN 'nth' THEN EXTRACT(DOW FROM d)::int=ANY(p_weekdays::int[]) AND (cardinality(p_months)=0 OR EXTRACT(MONTH FROM d)::int=ANY(p_months::int[])) AND (CASE WHEN p_nth=5 THEN EXTRACT(DAY FROM d)::int+7>EXTRACT(DAY FROM ((date_trunc('month',d::timestamp)+INTERVAL '1 month')-INTERVAL '1 day'))::int ELSE ((EXTRACT(DAY FROM d)::int-1)/7)+1=p_nth END) ELSE false END $$`);
  await sql.query(`CREATE OR REPLACE FUNCTION attendance_snapshot_settings() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE ph NUMERIC; BEGIN SELECT e.required_daily_hours,sh.name,sh.start_time,sh.end_time,sh.break_minutes INTO NEW.required_hours_snapshot,NEW.shift_name_snapshot,NEW.shift_start_snapshot,NEW.shift_end_snapshot,NEW.shift_break_minutes_snapshot FROM employees e LEFT JOIN shifts sh ON sh.id=e.shift_id WHERE e.id=NEW.employee_id; NEW.base_hours_snapshot:=NULL; IF NEW.required_hours_snapshot IS NOT NULL THEN SELECT p.hours INTO ph FROM work_hour_periods p WHERE p.active AND (NEW.check_in AT TIME ZONE 'Asia/Qatar')::date BETWEEN p.start_date AND p.end_date AND wh_period_matches(p.kind,p.weekdays,p.months,p.day_of_month,p.nth,(NEW.check_in AT TIME ZONE 'Asia/Qatar')::date) AND (p.scope='all' OR NEW.employee_id=ANY(p.employee_ids)) ORDER BY (p.scope<>'all') DESC,(CASE p.kind WHEN 'range' THEN 1 WHEN 'weekday' THEN 2 ELSE 3 END) DESC,p.created_at DESC LIMIT 1; IF ph IS NOT NULL THEN NEW.base_hours_snapshot:=NEW.required_hours_snapshot; NEW.required_hours_snapshot:=ph; END IF; END IF; RETURN NEW; END $$`);
}
