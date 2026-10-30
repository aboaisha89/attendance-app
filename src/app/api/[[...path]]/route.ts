import {NextRequest,NextResponse} from 'next/server';
import bcrypt from 'bcryptjs';
import {db} from '@/lib/db';
import {session,createToken} from '@/lib/session';
export const runtime='nodejs';
const ok=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message:string,status=400)=>ok({error:message},status);
const isAdmin=(r:string)=>r==='admin';
function validPoly(p:unknown):p is number[][]{return Array.isArray(p)&&p.length>=3&&p.length<=100&&p.every(x=>Array.isArray(x)&&x.length===2&&x.every((n:unknown)=>typeof n==='number'&&Number.isFinite(n)))&&p.every(x=>Math.abs(x[0])<=180&&Math.abs(x[1])<=90)}
function inPoly(lon:number,lat:number,pts:number[][]){let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const a=pts[i],b=pts[j];if(((a[1]>lat)!==(b[1]>lat))&&(lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0]))inside=!inside}return inside}
async function handler(req:NextRequest,ctx:{params:Promise<{path?:string[]}>}){
const path=(await ctx.params).path?.join('/')||'';
try{
const sql=db();const body=req.method==='POST'?await req.json().catch(()=>({})):{};
if(path==='login'&&req.method==='POST'){
 const email=String(body.email||'').toLowerCase().trim();const users=await sql`SELECT id,name,email,password_hash,role,status,must_change_password FROM employees WHERE email=${email} LIMIT 1`;
 const u=users[0];if(!u||u.status!=='active'||!(await bcrypt.compare(String(body.password||''),String(u.password_hash))))return fail('Incorrect email or password',401);
 const token=await createToken({id:String(u.id),role:String(u.role),name:String(u.name)});const res=ok({user:{id:u.id,name:u.name,email:u.email,role:u.role,mustChangePassword:u.must_change_password}});
 res.cookies.set('attendance_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:604800});return res;
}
if(path==='logout'&&req.method==='POST'){const res=ok({ok:true});res.cookies.delete('attendance_session');return res}
if(path==='register'&&req.method==='POST'){
 const name=String(body.name||'').trim(),email=String(body.email||'').toLowerCase().trim(),password=String(body.password||'');
 if(name.length<2||!email.includes('@')||password.length<12)return fail('Name, valid email, and password (12+ chars) required');
 const hash=await bcrypt.hash(password,12);await sql`INSERT INTO employees (name,email,password_hash,role,status) VALUES (${name},${email},${hash},'employee','pending')`;await sql`INSERT INTO changes(topic) VALUES('employees')`;return ok({ok:true},201);
}
const me=await session();if(!me)return fail('Sign in required',401);
if(path==='me') {const users=await sql`SELECT id,name,email,role,status,must_change_password FROM employees WHERE id=${me.id}::uuid`;return ok({user:users[0]||null})}
if(path==='password'&&req.method==='POST'){
 const password=String(body.password||'');if(password.length<12)return fail('Use at least 12 characters');
 const hash=await bcrypt.hash(password,12);await sql`UPDATE employees SET password_hash=${hash},must_change_password=false WHERE id=${me.id}::uuid`;return ok({ok:true});
}
const current=await sql`SELECT role,status,must_change_password FROM employees WHERE id=${me.id}::uuid LIMIT 1`;
if(!current[0]||current[0].status!=='active')return fail('Account inactive',403);
if(current[0].must_change_password)return fail('Change your password before continuing',403);
if(path==='snapshot'&&req.method==='GET'){
 const staff=isAdmin(String(current[0].role))?await sql`SELECT id,name,email,role,status,branch_id FROM employees ORDER BY created_at DESC LIMIT 100`:[];
 const sessions=isAdmin(String(current[0].role))?await sql`SELECT s.id,s.employee_id,e.name,s.check_in,s.check_out,s.branch_id FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id ORDER BY s.check_in DESC LIMIT 100`:await sql`SELECT s.id,s.employee_id,e.name,s.check_in,s.check_out,s.branch_id FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.employee_id=${me.id}::uuid ORDER BY s.check_in DESC LIMIT 100`;
 const fences=await sql`SELECT id,name,branch_id,polygon,active FROM geofences WHERE active=true ORDER BY name`;
 const requests=isAdmin(String(current[0].role))?await sql`SELECT r.id,r.employee_id,e.name,r.kind,r.note,r.status,r.created_at FROM requests r JOIN employees e ON e.id=r.employee_id ORDER BY r.created_at DESC LIMIT 100`:await sql`SELECT r.id,r.employee_id,e.name,r.kind,r.note,r.status,r.created_at FROM requests r JOIN employees e ON e.id=r.employee_id WHERE employee_id=${me.id}::uuid ORDER BY r.created_at DESC LIMIT 100`;
 const branches=await sql`SELECT id,name FROM branches ORDER BY name`;
 const version=await sql`SELECT COALESCE(MAX(id),0) as id FROM changes`;
 return ok({staff,sessions,fences,requests,branches,version:Number(version[0].id)});
}
if(path==='changes'&&req.method==='GET'){
 const since=Math.max(0,Number(req.nextUrl.searchParams.get('since')||0));const rows=await sql`SELECT id,topic,created_at FROM changes WHERE id>${since} ORDER BY id ASC LIMIT 100`;return ok({events:rows});
}
if(path==='employee'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const id=String(body.id||''),status=String(body.status||'');if(!['active','pending','suspended'].includes(status))return fail('Invalid status');
 await sql`UPDATE employees SET status=${status} WHERE id=${id}::uuid`;await sql`INSERT INTO changes(topic) VALUES('employees')`;return ok({ok:true});
}
if(path==='branch'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);const name=String(body.name||'').trim();if(!name)return fail('Name required');
 await sql`INSERT INTO branches(name) VALUES (${name})`;await sql`INSERT INTO changes(topic) VALUES('branches')`;return ok({ok:true});
}
if(path==='geofence'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const name=String(body.name||'').trim(),branch=String(body.branchId||'');if(!name||!validPoly(body.polygon)||!branch)return fail('Name, branch and polygon (3+ valid coordinates) are required');
 const polygon=JSON.stringify(body.polygon);await sql`INSERT INTO geofences(name,branch_id,polygon) VALUES (${name},${branch}::uuid,${polygon}::jsonb)`;await sql`INSERT INTO changes(topic) VALUES('geofences')`;return ok({ok:true});
}
if(path==='attendance'&&req.method==='POST'){
 const lat=Number(body.lat),lon=Number(body.lon),accuracy=Number(body.accuracy);if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(accuracy)||accuracy<0||accuracy>100)return fail('Accurate GPS location required (≤100 meters)');
 const user=await sql`SELECT branch_id FROM employees WHERE id=${me.id}::uuid`;const branch=user[0]?.branch_id;if(!branch)return fail('Administrator must assign your branch');
 const fences=await sql`SELECT polygon FROM geofences WHERE branch_id=${branch}::uuid AND active=true`;if(!fences.some(f=>inPoly(lon,lat,f.polygon as number[][])))return fail('Outside the permitted boundary',403);
 // Use an atomic update and a unique open-session index to prevent overlapping sessions.
 const closed=await sql`UPDATE attendance_sessions SET check_out=now(),out_lat=${lat},out_lon=${lon} WHERE employee_id=${me.id}::uuid AND check_out IS NULL RETURNING id`;
 if(closed.length){await sql`INSERT INTO changes(topic) VALUES('attendance')`;return ok({action:'checkout'})}
 try{await sql`INSERT INTO attendance_sessions(employee_id,branch_id,in_lat,in_lon) VALUES (${me.id}::uuid,${branch}::uuid,${lat},${lon})`}
 catch(e){if(String(e).includes('unique'))return fail('You already have an active session',409);throw e}
 await sql`INSERT INTO changes(topic) VALUES('attendance')`;return ok({action:'checkin'});
}
if(path==='request'&&req.method==='POST'){
 const kind=String(body.kind||''),note=String(body.note||'');if(!['leave','correction','overtime'].includes(kind)||note.length<3)return fail('Choose request type and provide a note');
 await sql`INSERT INTO requests(employee_id,kind,note) VALUES (${me.id}::uuid,${kind},${note})`;await sql`INSERT INTO changes(topic) VALUES('requests')`;return ok({ok:true});
}
if(path==='review'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);const status=String(body.status||'');if(!['approved','rejected'].includes(status))return fail('Invalid status');
 await sql`UPDATE requests SET status=${status} WHERE id=${String(body.id)}::uuid`;await sql`INSERT INTO changes(topic) VALUES('requests')`;return ok({ok:true});
}
return fail('Not found',404)
}catch(e){const message=e instanceof Error?e.message:'Server error';console.error('API error',message);if(message.includes('duplicate key'))return fail('Email or record already exists',409);return fail('Server operation failed; verify Neon database setup',500)}
}
export {handler as GET,handler as POST};
