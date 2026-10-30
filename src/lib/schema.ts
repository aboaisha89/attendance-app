import {db} from './db';

/** Idempotent initial schema; preserve existing employee and attendance data. */
export async function ensureSchema(){
 const sql=db();
 const statements=[
 `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
 `CREATE TABLE IF NOT EXISTS branches(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `CREATE TABLE IF NOT EXISTS employees(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'employee' CHECK(role IN ('employee','admin')),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended')),branch_id UUID REFERENCES branches(id),must_change_password BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `CREATE TABLE IF NOT EXISTS geofences(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL,branch_id UUID NOT NULL REFERENCES branches(id),polygon JSONB NOT NULL,active BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `CREATE TABLE IF NOT EXISTS attendance_sessions(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),employee_id UUID NOT NULL REFERENCES employees(id),branch_id UUID NOT NULL REFERENCES branches(id),check_in TIMESTAMPTZ NOT NULL DEFAULT now(),check_out TIMESTAMPTZ,in_lat DOUBLE PRECISION,in_lon DOUBLE PRECISION,out_lat DOUBLE PRECISION,out_lon DOUBLE PRECISION)`,
 `CREATE UNIQUE INDEX IF NOT EXISTS one_open_session_per_employee ON attendance_sessions(employee_id) WHERE check_out IS NULL`,
 `CREATE INDEX IF NOT EXISTS attendance_by_employee_time ON attendance_sessions(employee_id,check_in DESC)`,
 `CREATE TABLE IF NOT EXISTS requests(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),employee_id UUID NOT NULL REFERENCES employees(id),kind TEXT NOT NULL,note TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `CREATE TABLE IF NOT EXISTS app_settings(id INTEGER PRIMARY KEY CHECK(id=1), site_name TEXT NOT NULL DEFAULT 'AttendPro', logo TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'en', date_format TEXT NOT NULL DEFAULT 'short', time_format TEXT NOT NULL DEFAULT '24')`,
 `ALTER TABLE employees ADD COLUMN IF NOT EXISTS avatar TEXT NOT NULL DEFAULT ''`,
 `CREATE TABLE IF NOT EXISTS shifts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL UNIQUE,start_time TIME NOT NULL,end_time TIME NOT NULL,break_minutes INTEGER NOT NULL DEFAULT 0)`,
 `ALTER TABLE employees ADD COLUMN IF NOT EXISTS required_daily_hours NUMERIC(4,2) NOT NULL DEFAULT 8`,
 `ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES shifts(id)`,
 `ALTER TABLE requests ADD COLUMN IF NOT EXISTS start_date DATE`,
 `ALTER TABLE requests ADD COLUMN IF NOT EXISTS end_date DATE`,
 `CREATE TABLE IF NOT EXISTS notifications(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),recipient_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,title TEXT NOT NULL,message TEXT NOT NULL,read_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `CREATE INDEX IF NOT EXISTS notifications_employee_time ON notifications(recipient_id,created_at DESC)`,
 `CREATE TABLE IF NOT EXISTS role_access(role TEXT PRIMARY KEY, pages JSONB NOT NULL, sidebar_enabled BOOLEAN NOT NULL DEFAULT false)`,
 `INSERT INTO role_access(role,pages,sidebar_enabled) VALUES ('employee','["dashboard","history","punch","reports","profile","requests"]'::jsonb,false),('admin','["dashboard","history","onsite","punch","reports","profile","employees","branches","geofences","requests","settings","permissions"]'::jsonb,true) ON CONFLICT (role) DO NOTHING`,
 `CREATE TABLE IF NOT EXISTS changes(id BIGSERIAL PRIMARY KEY,topic TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`
 ];
 for(const query of statements) await sql.query(query);
}

export async function bootstrapStatus(){
 const sql=db();
 const table=await sql`SELECT to_regclass('public.employees') AS name`;
 if(!table[0]?.name)return {initialized:false};
 const admins=await sql`SELECT COUNT(*)::int AS count FROM employees WHERE role='admin'`;
 return {initialized:Number(admins[0].count)>0};
}
