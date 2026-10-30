import bcrypt from 'bcryptjs';
import {db} from './db';
import {ensureSchema} from './schema';

/** Provision the first admin from Vercel-only environment variables, never from a public form. */
export async function initializeOnce(){
 await ensureSchema();
 const sql=db();
 const admin=await sql`SELECT id FROM employees WHERE role='admin' LIMIT 1`;
 if(admin.length)return;
 const email=process.env.ADMIN_EMAIL?.trim().toLowerCase();
 const password=process.env.ADMIN_PASSWORD;
 if(!email || !password || password.length<12 || !/^\S+@\S+\.\S+$/.test(email)){
  throw new Error('Configure ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) in Vercel environment variables to initialize the first admin.');
 }
 const hash=await bcrypt.hash(password,12);
 const name=(process.env.ADMIN_NAME||'System Administrator').trim();
 await sql`INSERT INTO employees(name,email,password_hash,role,status,must_change_password)
 SELECT ${name},${email},${hash},'admin','active',true
 WHERE NOT EXISTS (SELECT 1 FROM employees WHERE role='admin')
 ON CONFLICT(email) DO NOTHING`;
}
