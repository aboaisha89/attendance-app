import {db} from './db';

/** Additive compatibility migration for already signed-in users. No data deletion. */
let pending: Promise<void> | undefined;
export function ensureAccessAndLeaveSchema(): Promise<void> {
  if (!pending) pending = migrate().catch(error => { pending = undefined; throw error; });
  return pending;
}
async function migrate() {
  const sql = db();
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
}
