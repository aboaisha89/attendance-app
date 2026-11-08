import {db} from './db';

/** Idempotent initial schema; preserve existing employee and attendance data. */
export async function ensureSchema(){
 const sql=db();
 const statements=[
 `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
 `CREATE TABLE IF NOT EXISTS branches(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `CREATE TABLE IF NOT EXISTS employees(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'employee' CHECK(role IN ('employee','admin')),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended')),branch_id UUID REFERENCES branches(id),must_change_password BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check`,
 `CREATE TABLE IF NOT EXISTS geofences(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL,branch_id UUID NOT NULL REFERENCES branches(id),polygon JSONB NOT NULL,active BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `CREATE TABLE IF NOT EXISTS attendance_sessions(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),employee_id UUID NOT NULL REFERENCES employees(id),branch_id UUID NOT NULL REFERENCES branches(id),check_in TIMESTAMPTZ NOT NULL DEFAULT now(),check_out TIMESTAMPTZ,in_lat DOUBLE PRECISION,in_lon DOUBLE PRECISION,out_lat DOUBLE PRECISION,out_lon DOUBLE PRECISION)`,
 `CREATE UNIQUE INDEX IF NOT EXISTS one_open_session_per_employee ON attendance_sessions(employee_id) WHERE check_out IS NULL`,
 `CREATE INDEX IF NOT EXISTS attendance_by_employee_time ON attendance_sessions(employee_id,check_in DESC)`,
 `CREATE TABLE IF NOT EXISTS requests(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),employee_id UUID NOT NULL REFERENCES employees(id),kind TEXT NOT NULL,note TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `CREATE TABLE IF NOT EXISTS app_settings(id INTEGER PRIMARY KEY CHECK(id=1), site_name TEXT NOT NULL DEFAULT 'AttendPro', logo TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'en', date_format TEXT NOT NULL DEFAULT 'short', time_format TEXT NOT NULL DEFAULT '24')`,
 `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS early_grace_minutes INTEGER NOT NULL DEFAULT 0`,
 `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS overtime_grace_minutes INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS punch_hold_enabled BOOLEAN NOT NULL DEFAULT false`,
   `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS punch_hold_seconds INTEGER NOT NULL DEFAULT 3`,
 `ALTER TABLE employees ADD COLUMN IF NOT EXISTS avatar TEXT NOT NULL DEFAULT ''`,
 `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS break_started_at TIMESTAMPTZ`,
 `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS break_seconds INTEGER NOT NULL DEFAULT 0`,
 `CREATE TABLE IF NOT EXISTS shifts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL UNIQUE,start_time TIME NOT NULL,end_time TIME NOT NULL,break_minutes INTEGER NOT NULL DEFAULT 0)`,
 `ALTER TABLE employees ADD COLUMN IF NOT EXISTS required_daily_hours NUMERIC(4,2)`,
 `ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES shifts(id)`,
 `ALTER TABLE employees ADD COLUMN IF NOT EXISTS variable_overnight_shift BOOLEAN NOT NULL DEFAULT false`,
 `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS missed_checkout BOOLEAN NOT NULL DEFAULT false`,
 `ALTER TABLE employees ALTER COLUMN required_daily_hours DROP NOT NULL`,
 `ALTER TABLE employees ALTER COLUMN required_daily_hours DROP DEFAULT`,
 `ALTER TABLE requests ADD COLUMN IF NOT EXISTS start_date DATE`,
 `ALTER TABLE requests ADD COLUMN IF NOT EXISTS end_date DATE`,
 `CREATE TABLE IF NOT EXISTS notifications(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),recipient_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,title TEXT NOT NULL,message TEXT NOT NULL,read_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `CREATE INDEX IF NOT EXISTS notifications_employee_time ON notifications(recipient_id,created_at DESC)`,
 `CREATE TABLE IF NOT EXISTS role_access(role TEXT PRIMARY KEY, pages JSONB NOT NULL, sidebar_enabled BOOLEAN NOT NULL DEFAULT false)`,
 `ALTER TABLE role_access ADD COLUMN IF NOT EXISTS ui_visibility JSONB NOT NULL DEFAULT '{}'::jsonb`,
 `INSERT INTO role_access(role,pages,sidebar_enabled) VALUES ('employee','["dashboard","history","punch","reports","profile","requests"]'::jsonb,false),('admin','["dashboard","history","onsite","punch","reports","profile","employees","branches","shifts","geofences","requests","settings","permissions"]'::jsonb,true) ON CONFLICT (role) DO NOTHING`,
 `INSERT INTO role_access(role,pages,sidebar_enabled) VALUES ('display','["onsite"]'::jsonb,false) ON CONFLICT (role) DO NOTHING`,
 `CREATE TABLE IF NOT EXISTS request_categories(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL UNIQUE,active BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `INSERT INTO request_categories(name) VALUES ('Leave'),('Absence'),('Correction'),('Overtime') ON CONFLICT (name) DO NOTHING`,
 `CREATE TABLE IF NOT EXISTS attendance_manual_audit(id BIGSERIAL PRIMARY KEY,employee_id UUID NOT NULL REFERENCES employees(id),admin_id UUID NOT NULL REFERENCES employees(id),check_in TIMESTAMPTZ NOT NULL,check_out TIMESTAMPTZ NOT NULL,break_minutes NUMERIC(8,2) NOT NULL DEFAULT 0,reason TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `CREATE TABLE IF NOT EXISTS admin_messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),title TEXT NOT NULL,body TEXT NOT NULL,created_by UUID NOT NULL REFERENCES employees(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `CREATE TABLE IF NOT EXISTS admin_message_recipients(message_id UUID NOT NULL REFERENCES admin_messages(id) ON DELETE CASCADE,employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,acknowledged_at TIMESTAMPTZ,PRIMARY KEY(message_id,employee_id))`,
 `CREATE INDEX IF NOT EXISTS admin_message_recipients_pending ON admin_message_recipients(employee_id,acknowledged_at)`,
 `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS shift_name_snapshot TEXT`,
 `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS shift_start_snapshot TIME`,
 `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS shift_end_snapshot TIME`,
 `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS required_hours_snapshot NUMERIC(5,2)`,
 `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS shift_break_minutes_snapshot INTEGER`,
 `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS base_hours_snapshot NUMERIC(5,2)`,
 `CREATE TABLE IF NOT EXISTS work_hour_periods(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL,start_date DATE NOT NULL,end_date DATE NOT NULL,hours NUMERIC(4,2) NOT NULL CHECK(hours>0 AND hours<=24),scope TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all','employees')),employee_ids UUID[] NOT NULL DEFAULT '{}',active BOOLEAN NOT NULL DEFAULT true,note TEXT NOT NULL DEFAULT '',created_by UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK(end_date>=start_date))`,
 `CREATE INDEX IF NOT EXISTS work_hour_periods_dates ON work_hour_periods(start_date,end_date) WHERE active`,
 `CREATE TABLE IF NOT EXISTS employee_schedule_history(id BIGSERIAL PRIMARY KEY,employee_id UUID NOT NULL REFERENCES employees(id),effective_from TIMESTAMPTZ NOT NULL,shift_id UUID,shift_name TEXT,shift_start TIME,shift_end TIME,shift_break_minutes INTEGER NOT NULL DEFAULT 0,required_daily_hours NUMERIC(5,2),recorded_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `CREATE INDEX IF NOT EXISTS schedule_history_lookup ON employee_schedule_history(employee_id,effective_from DESC)`,
 `CREATE OR REPLACE FUNCTION attendance_snapshot_settings() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE ph NUMERIC; BEGIN SELECT e.required_daily_hours,sh.name,sh.start_time,sh.end_time,sh.break_minutes INTO NEW.required_hours_snapshot,NEW.shift_name_snapshot,NEW.shift_start_snapshot,NEW.shift_end_snapshot,NEW.shift_break_minutes_snapshot FROM employees e LEFT JOIN shifts sh ON sh.id=e.shift_id WHERE e.id=NEW.employee_id; NEW.base_hours_snapshot:=NULL; IF NEW.required_hours_snapshot IS NOT NULL THEN SELECT p.hours INTO ph FROM work_hour_periods p WHERE p.active AND (NEW.check_in AT TIME ZONE 'Asia/Qatar')::date BETWEEN p.start_date AND p.end_date AND (p.scope='all' OR NEW.employee_id=ANY(p.employee_ids)) ORDER BY (p.scope<>'all') DESC,p.created_at DESC LIMIT 1; IF ph IS NOT NULL THEN NEW.base_hours_snapshot:=NEW.required_hours_snapshot; NEW.required_hours_snapshot:=ph; END IF; END IF; RETURN NEW; END $$`,
 `DROP TRIGGER IF EXISTS attendance_snapshot_on_insert ON attendance_sessions`,
 `CREATE TRIGGER attendance_snapshot_on_insert BEFORE INSERT ON attendance_sessions FOR EACH ROW EXECUTE FUNCTION attendance_snapshot_settings()`,
 `CREATE OR REPLACE FUNCTION preserve_schedule_change() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE sh RECORD; BEGIN IF TG_OP='INSERT' OR OLD.shift_id IS DISTINCT FROM NEW.shift_id OR OLD.required_daily_hours IS DISTINCT FROM NEW.required_daily_hours THEN SELECT name,start_time,end_time,break_minutes INTO sh FROM shifts WHERE id=NEW.shift_id; INSERT INTO employee_schedule_history(employee_id,effective_from,shift_id,shift_name,shift_start,shift_end,shift_break_minutes,required_daily_hours) VALUES(NEW.id,now(),NEW.shift_id,sh.name,sh.start_time,sh.end_time,COALESCE(sh.break_minutes,0),NEW.required_daily_hours); END IF; RETURN NEW; END $$`,
 `DROP TRIGGER IF EXISTS employee_schedule_change ON employees`,
 `CREATE TRIGGER employee_schedule_change AFTER INSERT OR UPDATE OF shift_id,required_daily_hours ON employees FOR EACH ROW EXECUTE FUNCTION preserve_schedule_change()`,
 `INSERT INTO employee_schedule_history(employee_id,effective_from,shift_id,shift_name,shift_start,shift_end,shift_break_minutes,required_daily_hours) SELECT e.id,now(),e.shift_id,sh.name,sh.start_time,sh.end_time,COALESCE(sh.break_minutes,0),e.required_daily_hours FROM employees e LEFT JOIN shifts sh ON sh.id=e.shift_id WHERE NOT EXISTS (SELECT 1 FROM employee_schedule_history h WHERE h.employee_id=e.id)`,
 `CREATE TABLE IF NOT EXISTS attendance_break_periods(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,started_at TIMESTAMPTZ NOT NULL,ended_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `CREATE INDEX IF NOT EXISTS attendance_break_by_session ON attendance_break_periods(session_id,started_at)`,
 `CREATE TABLE IF NOT EXISTS employee_leaves(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),employee_id UUID NOT NULL REFERENCES employees(id),start_date DATE NOT NULL,end_date DATE NOT NULL,leave_type TEXT NOT NULL DEFAULT 'Leave',notes TEXT NOT NULL DEFAULT '',created_by UUID NOT NULL REFERENCES employees(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK(end_date>=start_date))`,
 `CREATE INDEX IF NOT EXISTS employee_leaves_employee_dates ON employee_leaves(employee_id,start_date,end_date)`,
 `CREATE TABLE IF NOT EXISTS changes(id BIGSERIAL PRIMARY KEY,topic TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`
 ];
 for(const query of statements) await sql.query(query);
 // Public-facing short sequential IDs. UUID remains the internal primary key.
 // Migrations are additive and safe on an existing Neon database.
 const idTables: Array<[string,string]> = [
  ['employees','EMP'],['branches','BR'],['shifts','SH'],
  ['geofences','GEO'],['attendance_sessions','ATT'],
  ['requests','REQ'],['request_categories','CAT'],['notifications','NOT']
 ];
 for (const [table,prefix] of idTables) {
  const sequence = `${table}_public_seq`;
  await sql.query(`CREATE SEQUENCE IF NOT EXISTS ${sequence}`);
  await sql.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS public_id TEXT`);
  await sql.query(`UPDATE ${table} SET public_id = '${prefix}-' || lpad(nextval('${sequence}')::text,5,'0') WHERE public_id IS NULL`);
  await sql.query(`ALTER TABLE ${table} ALTER COLUMN public_id SET DEFAULT ('${prefix}-' || lpad(nextval('${sequence}')::text,5,'0'))`);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_public_id_unique ON ${table}(public_id)`);
 }

}

export async function bootstrapStatus(){
 const sql=db();
 const table=await sql`SELECT to_regclass('public.employees') AS name`;
 if(!table[0]?.name)return {initialized:false};
 const admins=await sql`SELECT COUNT(*)::int AS count FROM employees WHERE role='admin'`;
 return {initialized:Number(admins[0].count)>0};
}
