import {NextRequest,NextResponse} from 'next/server';
import bcrypt from 'bcryptjs';
import {db} from '@/lib/db';
import {session,createToken} from '@/lib/session';
import {initializeOnce} from '@/lib/bootstrap';
export const runtime='nodejs';
const ok=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message:string,status=400)=>ok({error:message},status);
const isAdmin=(r:string)=>r==='admin';
function validPoly(p:unknown):p is number[][]{return Array.isArray(p)&&p.length>=3&&p.length<=100&&p.every(x=>Array.isArray(x)&&x.length===2&&x.every((n:unknown)=>typeof n==='number'&&Number.isFinite(n)))&&p.every(x=>Math.abs(x[0])<=180&&Math.abs(x[1])<=90)}
function inPoly(lon:number,lat:number,pts:number[][]){let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const a=pts[i],b=pts[j];if(((a[1]>lat)!==(b[1]>lat))&&(lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0]))inside=!inside}return inside}
async function handler(req:NextRequest,ctx:{params:Promise<{path?:string[]}>}){
const path=(await ctx.params).path?.join('/')||'';
try{
if ((path==='login'||path==='register') && req.method==='POST') await initializeOnce();
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
if(path==='me') {const users=await sql`SELECT id,name,email,role,status,must_change_password,avatar FROM employees WHERE id=${me.id}::uuid`;return ok({user:users[0]||null})}
if(path==='profile'&&req.method==='POST'){
 const name=String(body.name||'').trim(),avatar=String(body.avatar||'');
 if(name.length<2||name.length>120)return fail('Invalid name');
 if(avatar && (avatar.length>200000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)))return fail('Invalid image; maximum 140 KB');
 await sql`UPDATE employees SET name=${name},avatar=${avatar} WHERE id=${me.id}::uuid`;
 await sql`INSERT INTO changes(topic) VALUES('profile')`;
 return ok({user:{name,avatar}});
}
if(path==='notifications'&&req.method==='GET'){
 const rows=await sql`SELECT id,title,message,read_at,created_at FROM notifications WHERE recipient_id=${me.id}::uuid ORDER BY created_at DESC LIMIT 50`;
 return ok({notifications:rows});
}
if(path==='notifications-read'&&req.method==='POST'){
 await sql`UPDATE notifications SET read_at=now() WHERE recipient_id=${me.id}::uuid AND read_at IS NULL`;
 return ok({ok:true});
}
if(path==='password'&&req.method==='POST'){
 const password=String(body.password||'');if(password.length<12)return fail('Use at least 12 characters');
 const hash=await bcrypt.hash(password,12);await sql`UPDATE employees SET password_hash=${hash},must_change_password=false WHERE id=${me.id}::uuid`;return ok({ok:true});
}
const current=await sql`SELECT role,status,must_change_password FROM employees WHERE id=${me.id}::uuid LIMIT 1`;
if(!current[0]||current[0].status!=='active')return fail('Account inactive',403);
if(current[0].must_change_password)return fail('Change your password before continuing',403);
if(path==='snapshot'&&req.method==='GET'){
 const staff=isAdmin(String(current[0].role))?await sql`SELECT id,name,email,role,status,branch_id,avatar FROM employees ORDER BY created_at DESC LIMIT 100`:[];
 const sessions=isAdmin(String(current[0].role))?await sql`SELECT s.id,s.employee_id,e.name,s.check_in,s.check_out,s.branch_id FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id ORDER BY s.check_in DESC LIMIT 100`:await sql`SELECT s.id,s.employee_id,e.name,s.check_in,s.check_out,s.branch_id FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.employee_id=${me.id}::uuid ORDER BY s.check_in DESC LIMIT 100`;
 const fences=await sql`SELECT id,name,branch_id,polygon,active FROM geofences ORDER BY name`;
 const requests=isAdmin(String(current[0].role))?await sql`SELECT r.id,r.employee_id,e.name,r.kind,r.note,r.start_date,r.end_date,r.status,r.created_at FROM requests r JOIN employees e ON e.id=r.employee_id ORDER BY r.created_at DESC LIMIT 100`:await sql`SELECT r.id,r.employee_id,e.name,r.kind,r.note,r.start_date,r.end_date,r.status,r.created_at FROM requests r JOIN employees e ON e.id=r.employee_id WHERE employee_id=${me.id}::uuid ORDER BY r.created_at DESC LIMIT 100`;
 const branches=await sql`SELECT id,name FROM branches ORDER BY name`;
 const settings=await sql`SELECT site_name,logo,icon,language,date_format,time_format FROM app_settings WHERE id=1`;
 const version=await sql`SELECT COALESCE(MAX(id),0) as id FROM changes`;
 return ok({staff,sessions,fences,requests,branches,settings:settings[0]||null,version:Number(version[0].id)});
}
if(path==='changes'&&req.method==='GET'){
 const since=Math.max(0,Number(req.nextUrl.searchParams.get('since')||0));const rows=await sql`SELECT id,topic,created_at FROM changes WHERE id>${since} ORDER BY id ASC LIMIT 100`;return ok({events:rows});
}
if(path==='settings'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const siteName=String(body.site_name||'').trim(),logo=String(body.logo||''),icon=String(body.icon||''),language=String(body.language||'ar'),dateFormat=String(body.date_format||'short'),timeFormat=String(body.time_format||'24');
 if(!siteName||siteName.length>70||!['ar','en'].includes(language)||!['short','numeric','long'].includes(dateFormat)||!['12','24'].includes(timeFormat))return fail('Invalid settings');
 if([logo,icon].some(v=>v.length>230000|| (v && !/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v))))return fail('Upload a PNG/JPEG/WebP/SVG under 150 KB');
 await sql`INSERT INTO app_settings(id,site_name,logo,icon,language,date_format,time_format) VALUES(1,${siteName},${logo},${icon},${language},${dateFormat},${timeFormat}) ON CONFLICT(id) DO UPDATE SET site_name=EXCLUDED.site_name,logo=EXCLUDED.logo,icon=EXCLUDED.icon,language=EXCLUDED.language,date_format=EXCLUDED.date_format,time_format=EXCLUDED.time_format`;
 await sql`INSERT INTO changes(topic) VALUES('settings')`;return ok({ok:true});
}
if(path==='create-employee'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
 const role=String(body.role||'employee'),status=String(body.status||'active'),branchId=String(body.branchId||'');
 if(name.length<2||!/^\S+@\S+\.\S+$/.test(email)||password.length<12||!['admin','employee'].includes(role)||!['active','pending','suspended'].includes(status))return fail('Invalid employee details or password under 12 characters');
 if(branchId){const b=await sql`SELECT id FROM branches WHERE id=${branchId}::uuid`;if(!b.length)return fail('Branch not found')}
 const hash=await bcrypt.hash(password,12);
 await sql`INSERT INTO employees(name,email,password_hash,role,status,branch_id,must_change_password) VALUES(${name},${email},${hash},${role},${status},${branchId||null}::uuid,true)`;
 await sql`INSERT INTO changes(topic) VALUES('employees')`;return ok({ok:true},201);
}
if(path==='employee'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const id=String(body.id||''),status=String(body.status||''),branchId=String(body.branchId||'');if(!['active','pending','suspended'].includes(status))return fail('Invalid status');
 if(branchId){const allowed=await sql`SELECT id FROM branches WHERE id=${branchId}::uuid LIMIT 1`;if(!allowed.length)return fail('Unknown branch')};
 await sql`UPDATE employees SET status=${status},branch_id=CASE WHEN ${branchId}='' THEN branch_id ELSE ${branchId||null}::uuid END WHERE id=${id}::uuid`;await sql`INSERT INTO changes(topic) VALUES('employees')`;return ok({ok:true});
}
if(path==='branch'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);const name=String(body.name||'').trim();if(!name)return fail('Name required');
 await sql`INSERT INTO branches(name) VALUES (${name})`;await sql`INSERT INTO changes(topic) VALUES('branches')`;return ok({ok:true});
}
if(path==='manage'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const kind=String(body.kind||''),action=String(body.action||''),id=String(body.id||'');
 if(!['branch','geofence','employee','request','attendance'].includes(kind)||!['edit','delete'].includes(action))return fail('Invalid action');
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))return fail('Invalid ID');
 if(kind==='geofence'){
  if(action==='delete')await sql`DELETE FROM geofences WHERE id=${id}::uuid`;
  else {
   const name=String(body.name||'').trim(),branchId=String(body.branchId||'');
   if(!name||!validPoly(body.polygon)||!branchId)return fail('Name, branch and at least 3 valid points required');
   const polygon=JSON.stringify(body.polygon);
   await sql`UPDATE geofences SET name=${name},branch_id=${branchId}::uuid,polygon=${polygon}::jsonb,active=${body.active!==false} WHERE id=${id}::uuid`;
  }
 }
 if(kind==='branch'){
  if(action==='delete'){
   const refs=await sql`SELECT (SELECT COUNT(*) FROM employees WHERE branch_id=${id}::uuid)+(SELECT COUNT(*) FROM geofences WHERE branch_id=${id}::uuid)+(SELECT COUNT(*) FROM attendance_sessions WHERE branch_id=${id}::uuid) AS n`;
   if(Number(refs[0].n)>0)return fail('Cannot delete branch with linked employees, zones or attendance',409);
   await sql`DELETE FROM branches WHERE id=${id}::uuid`;
  }else {const name=String(body.name||'').trim();if(!name)return fail('Branch name required');await sql`UPDATE branches SET name=${name} WHERE id=${id}::uuid`}
 }
 if(kind==='employee'){
  if(id===me.id&&action==='delete')return fail('You cannot delete your own admin account',409);
  if(action==='delete'){
   const sessions=await sql`SELECT COUNT(*)::int AS n FROM attendance_sessions WHERE employee_id=${id}::uuid`;
   if(Number(sessions[0].n)>0)return fail('Employee has attendance records; suspend instead of deleting',409);
   await sql`DELETE FROM requests WHERE employee_id=${id}::uuid`;
   await sql`DELETE FROM employees WHERE id=${id}::uuid`;
  }else{
   const name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase(),status=String(body.status||''),role=String(body.role||'');
   if(name.length<2||!email.includes('@')||!['pending','active','suspended'].includes(status)||!['admin','employee'].includes(role))return fail('Invalid employee information');
   await sql`UPDATE employees SET name=${name},email=${email},status=${status},role=${role},branch_id=${body.branchId||null}::uuid WHERE id=${id}::uuid`; if(body.password){const pw=String(body.password);if(pw.length<12)return fail('Password must be 12+ characters');const hash=await bcrypt.hash(pw,12);await sql`UPDATE employees SET password_hash=${hash},must_change_password=true WHERE id=${id}::uuid`}
  }
 }
 if(kind==='request'){
  if(action==='delete')await sql`DELETE FROM requests WHERE id=${id}::uuid`;
  else{const note=String(body.note||''),status=String(body.status||'');if(!note||!['pending','approved','rejected'].includes(status))return fail('Invalid request');await sql`UPDATE requests SET note=${note},status=${status} WHERE id=${id}::uuid`}
 }
 if(kind==='attendance'){
  if(action==='delete')return fail('Attendance deletion disabled for audit integrity; correct the record instead',403);
  const checkIn=String(body.check_in||''),checkOut=body.check_out?String(body.check_out):null;
  if(!Number.isFinite(Date.parse(checkIn))||(checkOut&&(!Number.isFinite(Date.parse(checkOut))||Date.parse(checkOut)<=Date.parse(checkIn))))return fail('Invalid attendance times');
  await sql`UPDATE attendance_sessions SET check_in=${checkIn}::timestamptz,check_out=${checkOut}::timestamptz WHERE id=${id}::uuid`;
 }
 await sql`INSERT INTO changes(topic) VALUES(${kind})`;return ok({ok:true});
}
if(path==='geofence'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const name=String(body.name||'').trim(),branch=String(body.branchId||'');if(!name||!validPoly(body.polygon)||!branch)return fail('Name, branch and polygon (3+ valid coordinates) are required');
 const polygon=JSON.stringify(body.polygon);await sql`INSERT INTO geofences(name,branch_id,polygon) VALUES (${name},${branch}::uuid,${polygon}::jsonb)`;await sql`INSERT INTO changes(topic) VALUES('geofences')`;return ok({ok:true});
}
if(path==='attendance'&&req.method==='POST'){
 const lat=Number(body.lat),lon=Number(body.lon),accuracy=Number(body.accuracy);if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>180||!Number.isFinite(accuracy)||accuracy<0)return fail('GPS location unavailable or invalid');
 if(accuracy>150)return fail('GPS accuracy is '+Math.round(accuracy)+'m. Move outdoors or enable precise location; maximum is 150m',422);
 const user=await sql`SELECT branch_id FROM employees WHERE id=${me.id}::uuid`;const branch=user[0]?.branch_id;if(!branch)return fail('Administrator must assign your branch');
 const fences=await sql`SELECT polygon FROM geofences WHERE branch_id=${branch}::uuid AND active=true`;if(!fences.length)return fail('No active geofence is assigned to your branch',403);
 if(!fences.some(f=>inPoly(lon,lat,f.polygon as number[][])))return fail('Outside permitted boundary. GPS accuracy '+Math.round(accuracy)+'m; coordinates '+lat.toFixed(6)+', '+lon.toFixed(6)+'. Ask admin to inspect your mapped zone.',403);
 // Use an atomic update and a unique open-session index to prevent overlapping sessions.
 const closed=await sql`UPDATE attendance_sessions SET check_out=now(),out_lat=${lat},out_lon=${lon} WHERE employee_id=${me.id}::uuid AND check_out IS NULL RETURNING id`;
 if(closed.length){await sql`INSERT INTO changes(topic) VALUES('attendance')`;return ok({action:'checkout'})}
 try{await sql`INSERT INTO attendance_sessions(employee_id,branch_id,in_lat,in_lon) VALUES (${me.id}::uuid,${branch}::uuid,${lat},${lon})`}
 catch(e){if(String(e).includes('unique'))return fail('You already have an active session',409);throw e}
 await sql`INSERT INTO changes(topic) VALUES('attendance')`;return ok({action:'checkin'});
}
if(path==='request'&&req.method==='POST'){
 const kind=String(body.kind||''),note=String(body.note||'').trim(),startDate=String(body.startDate||''),endDate=String(body.endDate||'');
 if(!['leave','absence','correction','overtime'].includes(kind)||note.length<3)return fail('Choose request type and provide a reason');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||!Number.isFinite(Date.parse(startDate))||!Number.isFinite(Date.parse(endDate))||startDate>endDate)return fail('Provide a valid date range');
 const span=Math.round((Date.parse(endDate)-Date.parse(startDate))/86400000);if(span>365)return fail('Date range is too long');
 await sql`INSERT INTO requests(employee_id,kind,note,start_date,end_date) VALUES (${me.id}::uuid,${kind},${note},${startDate}::date,${endDate}::date)`;
 const admins=await sql`SELECT id FROM employees WHERE role='admin' AND status='active'`;
 for(const admin of admins)await sql`INSERT INTO notifications(recipient_id,title,message) VALUES(${admin.id}::uuid,'New employee request',${kind+' request received for '+startDate+' to '+endDate})`;
 await sql`INSERT INTO changes(topic) VALUES('requests')`;return ok({ok:true});
}
if(path==='review'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);const status=String(body.status||'');if(!['approved','rejected'].includes(status))return fail('Invalid status');
 await sql`UPDATE requests SET status=${status} WHERE id=${String(body.id)}::uuid`; const recipient=await sql`SELECT employee_id FROM requests WHERE id=${String(body.id)}::uuid`; if(recipient.length)await sql`INSERT INTO notifications(recipient_id,title,message) VALUES(${recipient[0].employee_id}::uuid,'Request updated',${'Your request was '+status})`;await sql`INSERT INTO changes(topic) VALUES('requests')`; return ok({ok:true});
}
return fail('Not found',404)
}catch(e){const message=e instanceof Error?e.message:'Server error';console.error('API error', {message, code: (e as {code?: string})?.code, path});if(message.includes('duplicate key'))return fail('Email or record already exists',409);return fail('Server operation failed; verify Neon database setup',500)}
}
export {handler as GET,handler as POST};
