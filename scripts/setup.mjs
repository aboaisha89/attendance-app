import {neon} from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is missing');
if(!process.env.ADMIN_PASSWORD||process.env.ADMIN_PASSWORD.length<6)throw Error('ADMIN_PASSWORD must contain at least 6 characters');
const sql=neon(process.env.DATABASE_URL);
const queries=[
`CREATE EXTENSION IF NOT EXISTS pgcrypto`,
`CREATE TABLE IF NOT EXISTS branches(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
`CREATE TABLE IF NOT EXISTS employees(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'employee' CHECK(role IN ('employee','admin')),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended')),branch_id UUID REFERENCES branches(id),must_change_password BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
`CREATE TABLE IF NOT EXISTS geofences(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL,branch_id UUID NOT NULL REFERENCES branches(id),polygon JSONB NOT NULL,active BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
`CREATE TABLE IF NOT EXISTS attendance_sessions(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),employee_id UUID NOT NULL REFERENCES employees(id),branch_id UUID NOT NULL REFERENCES branches(id),check_in TIMESTAMPTZ NOT NULL DEFAULT now(),check_out TIMESTAMPTZ,in_lat DOUBLE PRECISION,in_lon DOUBLE PRECISION,out_lat DOUBLE PRECISION,out_lon DOUBLE PRECISION)`,
`CREATE UNIQUE INDEX IF NOT EXISTS one_open_session_per_employee ON attendance_sessions(employee_id) WHERE check_out IS NULL`,
`CREATE INDEX IF NOT EXISTS attendance_by_employee_time ON attendance_sessions(employee_id,check_in DESC)`,
`CREATE TABLE IF NOT EXISTS requests(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),employee_id UUID NOT NULL REFERENCES employees(id),kind TEXT NOT NULL,note TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
`CREATE TABLE IF NOT EXISTS app_settings(id INTEGER PRIMARY KEY CHECK(id=1), site_name TEXT NOT NULL DEFAULT 'AttendPro', logo TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'en', date_format TEXT NOT NULL DEFAULT 'short', time_format TEXT NOT NULL DEFAULT '24')`,
`CREATE TABLE IF NOT EXISTS changes(id BIGSERIAL PRIMARY KEY,topic TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`
];
for(const q of queries)await sql.query(q);
const email=(process.env.ADMIN_EMAIL||'admin@attendance.local').toLowerCase().trim();
const hash=await bcrypt.hash(process.env.ADMIN_PASSWORD,12);
await sql`INSERT INTO employees(name,email,password_hash,role,status,must_change_password) VALUES ('System Administrator',${email},${hash},'admin','active',true) ON CONFLICT (email) DO NOTHING`;
console.log('Database schema ready. Admin email:',email,'(existing accounts not overwritten).');
