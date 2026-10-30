import {NextRequest,NextResponse} from 'next/server';
import bcrypt from 'bcryptjs';
import {storageClient,ensureAvatarBucket} from '@/lib/supabase-storage';
import {db} from '@/lib/db';
import {session,createToken} from '@/lib/session';
import {initializeOnce} from '@/lib/bootstrap';
export const runtime='nodejs';
const ok=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message:string,status=400)=>ok({error:message},status);
const isAdmin=(r:string)=>r==='admin';
function validPoly(p:unknown):p is number[][]{return Array.isArray(p)&&p.length>=3&&p.length<=100&&p.every(x=>Array.isArray(x)&&x.length===2&&x.every((n:unknown)=>typeof n==='number'&&Number.isFinite(n)))&&p.every(x=>Math.abs(x[0])<=180&&Math.abs(x[1])<=90)}
function inPoly(lon:number,lat:number,pts:number[][]){let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const a=pts[i],b=pts[j];if(((a[1]>lat)!==(b[1]>lat))&&(lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0]))inside=!inside}return inside}
function getSupabaseAvatarPath(imageUrl:string,projectUrl:string,bucket:string,userId:string):string|null{
 try{
  const image=new URL(imageUrl),project=new URL(projectUrl);
  if(image.origin!==project.origin)return null;
  const marker=`/storage/v1/object/public/${bucket}/`;
  if(!image.pathname.startsWith(marker))return null;
  const path=decodeURIComponent(image.pathname.slice(marker.length));
  return path.startsWith(`${userId}/`)&&!path.includes('..')?path:null;
 }catch{return null}
}
async function handler(req:NextRequest,ctx:{params:Promise<{path?:string[]}>}){
const path=(await ctx.params).path?.join('/')||'';
try{
if ((path==='login'||path==='register') && req.method==='POST') await initializeOnce();
const sql=db();const body=req.method==='POST' && !path.startsWith('avatar-')?await req.json().catch(()=>({})):{};
if(path==='login'&&req.method==='POST'){
 const email=String(body.email||'').toLowerCase().trim();const users=await sql`SELECT id,public_id,name,email,password_hash,role,status,must_change_password FROM employees WHERE email=${email} LIMIT 1`;
 const u=users[0];if(!u||u.status!=='active'||!(await bcrypt.compare(String(body.password||''),String(u.password_hash))))return fail('Incorrect email or password',401);
 const token=await createToken({id:String(u.id),role:String(u.role),name:String(u.name)});const res=ok({user:{id:u.id,name:u.name,email:u.email,role:u.role,mustChangePassword:u.must_change_password}});
 res.cookies.set('attendance_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:604800});return res;
}
if(path==='logout'&&req.method==='POST'){const res=ok({ok:true});res.cookies.delete('attendance_session');return res}
if(path==='register'&&req.method==='POST'){
 const name=String(body.name||'').trim(),email=String(body.email||'').toLowerCase().trim(),password=String(body.password||'');
 if(name.length<2||!email.includes('@')||password.length<6)return fail('Name, valid email, and password (6+ chars) required');
 const hash=await bcrypt.hash(password,12);await sql`INSERT INTO employees (name,email,password_hash,role,status) VALUES (${name},${email},${hash},'employee','pending')`;await sql`INSERT INTO changes(topic) VALUES('employees')`;return ok({ok:true},201);
}
const me=await session();if(!me)return fail('Sign in required',401);
if(path==='me') {const users=await sql`SELECT id,public_id,name,email,role,status,must_change_password,avatar,required_daily_hours,shift_id FROM employees WHERE id=${me.id}::uuid`;return ok({user:users[0]||null})}
if(path==='profile'&&req.method==='POST'){
 const name=String(body.name||'').trim(),avatar=String(body.avatar||'');
 if(avatar.length>200000)return fail('Image too large');
 if(avatar && (avatar.length>200000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)))return fail('Invalid image; maximum 140 KB');
 await sql`UPDATE employees SET avatar=${avatar} WHERE id=${me.id}::uuid`;
 await sql`INSERT INTO changes(topic) VALUES('profile')`;
 return ok({user:{avatar}});
}
// Supabase Storage only; the application database remains on Neon.
if(path==='avatar-upload'&&req.method==='POST'){
 const {client,url,bucket}=storageClient();
 await ensureAvatarBucket(client);
 const form=await req.formData();const file=form.get('file');const targetId=String(form.get('employeeId')||me.id);if(targetId!==me.id){const actor=await sql`SELECT role FROM employees WHERE id=${me.id}::uuid LIMIT 1`;if(!actor[0]||!isAdmin(String(actor[0].role)))return fail('Admin only',403);}if(!/^[0-9a-f-]{36}$/i.test(targetId))return fail('Invalid employee ID');
 if(!(file instanceof File))return fail('Choose an image file');
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2_000_000||file.size===0)return fail('Upload a JPG, PNG or WebP under 2 MB');
 const magic=new Uint8Array(await file.slice(0,12).arrayBuffer());
 const validJpg=magic[0]===255&&magic[1]===216&&magic[2]===255;
 const validPng=magic[0]===137&&magic[1]===80&&magic[2]===78&&magic[3]===71&&magic[4]===13&&magic[5]===10;
 const validWebp=String.fromCharCode(...magic.slice(0,4))==='RIFF'&&String.fromCharCode(...magic.slice(8,12))==='WEBP';
 if(!((file.type==='image/jpeg'&&validJpg)||(file.type==='image/png'&&validPng)||(file.type==='image/webp'&&validWebp)))return fail('Invalid image file');
 const extension=file.type==='image/jpeg'?'jpg':file.type==='image/png'?'png':'webp';
 const objectPath=`${targetId}/${crypto.randomUUID()}.${extension}`;
 const previous=await sql`SELECT avatar FROM employees WHERE id=${targetId}::uuid`;
 const {error:uploadError}=await client.storage.from(bucket).upload(objectPath,await file.arrayBuffer(),{contentType:file.type,upsert:false,cacheControl:'3600'});
 if(uploadError)return fail('Supabase upload failed: '+uploadError.message,502);
 const {data:publicData}=client.storage.from(bucket).getPublicUrl(objectPath);
 const newUrl=publicData.publicUrl;
 try{
  await sql`UPDATE employees SET avatar=${newUrl} WHERE id=${targetId}::uuid`;
  await sql`INSERT INTO changes(topic) VALUES('profile')`;
 }catch(e){await client.storage.from(bucket).remove([objectPath]).catch(()=>{});throw e}
 const oldPath=getSupabaseAvatarPath(String(previous[0]?.avatar||''),url,bucket,targetId);
 if(oldPath)await client.storage.from(bucket).remove([oldPath]).catch(()=>{});
 return ok({user:{avatar:newUrl}});
}
if(path==='avatar-remove'&&req.method==='POST'){
 const previous=await sql`SELECT avatar FROM employees WHERE id=${me.id}::uuid`;
 await sql`UPDATE employees SET avatar='' WHERE id=${me.id}::uuid`;
 await sql`INSERT INTO changes(topic) VALUES('profile')`;
 try {const {client,url,bucket}=storageClient();const oldPath=getSupabaseAvatarPath(String(previous[0]?.avatar||''),url,bucket,me.id);if(oldPath)await client.storage.from(bucket).remove([oldPath]);}catch(e){console.error('Avatar cleanup skipped:',e instanceof Error?e.message:'Unknown error')}
 return ok({user:{avatar:''}});
}
if(path==='break'&&req.method==='POST'){
 const open=await sql`SELECT id,break_started_at FROM attendance_sessions WHERE employee_id=${me.id}::uuid AND check_out IS NULL LIMIT 1`;
 if(!open.length)return fail('Check in before starting a break',409);
 const id=String(open[0].id);
 if(open[0].break_started_at){
  await sql`UPDATE attendance_sessions SET break_seconds=break_seconds+GREATEST(0,EXTRACT(EPOCH FROM (now()-break_started_at)))::integer,break_started_at=NULL WHERE id=${id}::uuid`;
  await sql`INSERT INTO changes(topic) VALUES('attendance')`;
  return ok({action:'break-end'});
 }
 await sql`UPDATE attendance_sessions SET break_started_at=now() WHERE id=${id}::uuid`;
 await sql`INSERT INTO changes(topic) VALUES('attendance')`;
 return ok({action:'break-start'});
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
 const password=String(body.password||'');if(password.length<6)return fail('Use at least 6 characters');
 const hash=await bcrypt.hash(password,12);await sql`UPDATE employees SET password_hash=${hash},must_change_password=false WHERE id=${me.id}::uuid`;return ok({ok:true});
}
const current=await sql`SELECT role,status,must_change_password FROM employees WHERE id=${me.id}::uuid LIMIT 1`;
if(!current[0]||current[0].status!=='active')return fail('Account inactive',403);
if(current[0].must_change_password)return fail('Change your password before continuing',403);
const accessRows=await sql`SELECT pages,sidebar_enabled FROM role_access WHERE role=${String(current[0].role)} LIMIT 1`;
const access=accessRows[0]||{pages:current[0].role==='admin'?['dashboard','history','onsite','punch','reports','profile','employees','branches','shifts','geofences','requests','settings','permissions']:['dashboard','history','punch','reports','profile','requests'],sidebar_enabled:current[0].role==='admin'};
const visiblePages:string[]=Array.isArray(access.pages)?access.pages:JSON.parse(String(access.pages));
if(isAdmin(String(current[0].role))){for(const id of ['shifts','request-categories'])if(!visiblePages.includes(id))visiblePages.push(id);}
if(isAdmin(String(current[0].role))&&!visiblePages.includes('request-categories'))visiblePages.push('request-categories');
if(String(current[0].role)==='display' && !((path==='access'||path==='presence')&&req.method==='GET'))return fail('Display account: read-only access to On Site only',403);
if(path==='access'&&req.method==='GET')return ok({pages:visiblePages,sidebarEnabled:!!access.sidebar_enabled,role:String(current[0].role)});
if(path==='roles'&&req.method==='GET'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const roles=await sql`SELECT role,pages,sidebar_enabled FROM role_access ORDER BY role`;
 return ok({roles});
}
if(path==='roles'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const role=String(body.role||'');const pages=body.pages;const sidebar=body.sidebarEnabled===true;
 const allowed=['dashboard','history','onsite','punch','reports','profile','employees','branches','shifts','geofences','requests','request-categories','settings','permissions'];
 if(!['employee','display'].includes(role)||!Array.isArray(pages)||pages.some((p:unknown)=>!allowed.includes(String(p))))return fail('Invalid role permissions',400);
 const safePages=role==='display'?['onsite']:Array.from(new Set([...pages,'dashboard','profile','punch']));
 await sql`UPDATE role_access SET pages=${JSON.stringify(safePages)}::jsonb,sidebar_enabled=${sidebar} WHERE role=${role}`;
 await sql`INSERT INTO changes(topic) VALUES('permissions')`;
 return ok({ok:true});
}
// Never rely on hidden navigation: enforce visibility for sensitive endpoints too.
if(path==='presence'&&!visiblePages.includes('onsite'))return fail('On-site directory not permitted',403);
if(path==='request'&&!visiblePages.includes('requests'))return fail('Requests not permitted',403);
if(path==='presence'&&req.method==='GET'){
 // A non-admin may only see colleagues in their own assigned branch.
 const admin=isAdmin(String(current[0].role))||String(current[0].role)==='display';
 const people=admin
  ? await sql`SELECT e.id,e.public_id,e.name,e.avatar,e.branch_id,b.name AS branch_name,s.check_in,s.break_started_at FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id LEFT JOIN branches b ON b.id=s.branch_id WHERE s.check_out IS NULL AND e.status='active' ORDER BY s.check_in DESC LIMIT 300`
  : await sql`SELECT e.id,e.public_id,e.name,e.avatar,e.branch_id,b.name AS branch_name,s.check_in,s.break_started_at FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id LEFT JOIN branches b ON b.id=s.branch_id WHERE s.check_out IS NULL AND e.status='active' AND e.branch_id=(SELECT branch_id FROM employees WHERE id=${me.id}::uuid) ORDER BY s.check_in DESC LIMIT 300`;
 const exited=admin
  ? await sql`SELECT DISTINCT ON (s.employee_id) e.id,e.name,e.avatar,e.branch_id,b.name AS branch_name,s.check_out FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id LEFT JOIN branches b ON b.id=s.branch_id WHERE s.check_out IS NOT NULL AND s.check_out >= date_trunc('day', now() AT TIME ZONE 'Asia/Qatar') AT TIME ZONE 'Asia/Qatar' AND NOT EXISTS (SELECT 1 FROM attendance_sessions ongoing WHERE ongoing.employee_id=s.employee_id AND ongoing.check_out IS NULL) ORDER BY s.employee_id,s.check_out DESC LIMIT 300`
  : [];
 return ok({people,exited});
}
if(path==='request-categories' &&req.method==='GET'){
 const categories=await sql`SELECT id,public_id,name,active FROM request_categories ORDER BY name`;
 return ok({categories:isAdmin(String(current[0].role))?categories:categories.filter(x=>x.active)});
}
if(path==='request-categories'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const action=String(body.action||'create'),name=String(body.name||'').trim();
 if(action==='create'){
  if(name.length<2||name.length>70)return fail('Category name must be 2–70 characters');
  await sql`INSERT INTO request_categories(name) VALUES(${name})`;
 }else if(action==='update'){
  if(name.length<2||name.length>70)return fail('Invalid category name');
  const changed=await sql`UPDATE request_categories SET name=${name},active=${body.active!==false} WHERE id=${String(body.id)}::uuid RETURNING id`;
  if(!changed.length)return fail('Category not found',404);
 }else if(action==='delete'){
  const category=await sql`SELECT name FROM request_categories WHERE id=${String(body.id)}::uuid`;
  if(!category.length)return fail('Category not found',404);
  const used=await sql`SELECT COUNT(*)::int AS count FROM requests WHERE lower(kind)=lower(${String(category[0].name)})`;
  if(Number(used[0].count)>0)return fail('Category is in use; disable it instead',409);
  await sql`DELETE FROM request_categories WHERE id=${String(body.id)}::uuid`;
 }else return fail('Unknown action');
 await sql`INSERT INTO changes(topic) VALUES('request-categories')`;
 return ok({ok:true});
}
if(path==='snapshot'&&req.method==='GET'){
 const staff=isAdmin(String(current[0].role))?await sql`SELECT id,public_id,name,email,role,status,branch_id,avatar,required_daily_hours,shift_id FROM employees ORDER BY created_at DESC LIMIT 100`:[];
 const sessions=isAdmin(String(current[0].role))?await sql`SELECT s.id,s.public_id,s.employee_id,e.name,s.check_in,s.check_out,s.branch_id,s.break_seconds,s.break_started_at FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id ORDER BY s.check_in DESC LIMIT 100`:await sql`SELECT s.id,s.public_id,s.employee_id,e.name,s.check_in,s.check_out,s.branch_id,s.break_seconds,s.break_started_at FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.employee_id=${me.id}::uuid ORDER BY s.check_in DESC LIMIT 100`;
 const fences=isAdmin(String(current[0].role))?await sql`SELECT id,public_id,name,branch_id,polygon,active FROM geofences ORDER BY name`:[];
 const requests=isAdmin(String(current[0].role))?await sql`SELECT r.id,r.public_id,r.employee_id,e.name,r.kind,r.note,r.start_date,r.end_date,r.status,r.created_at FROM requests r JOIN employees e ON e.id=r.employee_id ORDER BY r.created_at DESC LIMIT 100`:await sql`SELECT r.id,r.public_id,r.employee_id,e.name,r.kind,r.note,r.start_date,r.end_date,r.status,r.created_at FROM requests r JOIN employees e ON e.id=r.employee_id WHERE employee_id=${me.id}::uuid ORDER BY r.created_at DESC LIMIT 100`;
 const branches=await sql`SELECT id,public_id,name FROM branches ORDER BY name`;
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
if(path==='shifts'&&req.method==='GET'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const shifts=await sql`SELECT id,public_id,name,start_time,end_time,break_minutes FROM shifts ORDER BY name`;
 return ok({shifts});
}
if(path==='shifts'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const name=String(body.name||'').trim(),start=String(body.startTime||''),end=String(body.endTime||'');
 const breakMinutes=Number(body.breakMinutes??0);
 if(name.length<2||!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||!Number.isInteger(breakMinutes)||breakMinutes<0||breakMinutes>600)return fail('Invalid shift');
 await sql`INSERT INTO shifts(name,start_time,end_time,break_minutes) VALUES(${name},${start}::time,${end}::time,${breakMinutes})`;
 return ok({ok:true},201);
}
if(path==='assign-employee'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const employeeId=String(body.employeeId||''),branchId=body.branchId==null?undefined:String(body.branchId),shiftId=body.shiftId==null?undefined:String(body.shiftId);
 if(!/^[0-9a-f-]{36}$/i.test(employeeId))return fail('Invalid employee',400);
 if(branchId!==undefined){if(branchId&&!(await sql`SELECT id FROM branches WHERE id=${branchId}::uuid`).length)return fail('Unknown branch');await sql`UPDATE employees SET branch_id=${branchId||null}::uuid WHERE id=${employeeId}::uuid`}
 if(shiftId!==undefined){if(shiftId&&!(await sql`SELECT id FROM shifts WHERE id=${shiftId}::uuid`).length)return fail('Unknown shift');await sql`UPDATE employees SET shift_id=${shiftId||null}::uuid WHERE id=${employeeId}::uuid`}
 await sql`INSERT INTO changes(topic) VALUES('employees')`;return ok({ok:true});
}
if(path==='shift-manage'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const id=String(body.id||''),action=String(body.action||'');if(!/^[0-9a-f-]{36}$/i.test(id))return fail('Invalid shift ID');
 if(action==='delete'){
  const refs=await sql`SELECT COUNT(*)::int n FROM employees WHERE shift_id=${id}::uuid`;if(Number(refs[0]?.n)>0)return fail('Unassign employees before deleting this shift',409);
  await sql`DELETE FROM shifts WHERE id=${id}::uuid`;
 }else if(action==='edit'){
  const name=String(body.name||'').trim(),start=String(body.startTime||''),end=String(body.endTime||''),breakMinutes=Number(body.breakMinutes||0);
  if(name.length<2||!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||!Number.isInteger(breakMinutes)||breakMinutes<0||breakMinutes>600)return fail('Invalid shift');
  await sql`UPDATE shifts SET name=${name},start_time=${start}::time,end_time=${end}::time,break_minutes=${breakMinutes} WHERE id=${id}::uuid`;
 }else return fail('Invalid action');
 await sql`INSERT INTO changes(topic) VALUES('shifts')`;return ok({ok:true});
}
if(path==='create-employee'&&req.method==='POST'){
 if(!isAdmin(String(current[0].role)))return fail('Admin only',403);
 const name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
 const role=String(body.role||'employee'),status=String(body.status||'active'),branchId=String(body.branchId||'');
 const requiredHours=Number(body.requiredDailyHours??8),shiftId=String(body.shiftId||'');
 if(!Number.isFinite(requiredHours)||requiredHours<=0||requiredHours>24)return fail('Working hours must be between 0 and 24');
 if(shiftId && !(await sql`SELECT id FROM shifts WHERE id=${shiftId}::uuid`).length)return fail('Shift not found');
 if(name.length<2||!/^\S+@\S+\.\S+$/.test(email)||password.length<6||!['admin','employee','display'].includes(role)||!['active','pending','suspended'].includes(status))return fail('Invalid employee details or password under 6 characters');
 if(branchId){const b=await sql`SELECT id FROM branches WHERE id=${branchId}::uuid`;if(!b.length)return fail('Branch not found')}
 const hash=await bcrypt.hash(password,12);
 await sql`INSERT INTO employees(name,email,password_hash,role,status,branch_id,must_change_password,required_daily_hours,shift_id) VALUES(${name},${email},${hash},${role},${status},${branchId||null}::uuid,true,${requiredHours},${shiftId||null}::uuid)`;
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
   if(name.length<2||!email.includes('@')||!['pending','active','suspended'].includes(status)||!['admin','employee','display'].includes(role))return fail('Invalid employee information');
   const requiredHours=Number(body.requiredDailyHours??8),shiftId=String(body.shiftId||'');
   if(!Number.isFinite(requiredHours)||requiredHours<=0||requiredHours>24)return fail('Working hours must be between 0 and 24');
   if(shiftId && !(await sql`SELECT id FROM shifts WHERE id=${shiftId}::uuid`).length)return fail('Shift not found');
   await sql`UPDATE employees SET name=${name},email=${email},status=${status},role=${role},branch_id=${body.branchId||null}::uuid,required_daily_hours=${requiredHours},shift_id=${shiftId||null}::uuid WHERE id=${id}::uuid`; if(body.password){const pw=String(body.password);if(pw.length<6)return fail('Password must be 6+ characters');const hash=await bcrypt.hash(pw,12);await sql`UPDATE employees SET password_hash=${hash},must_change_password=true WHERE id=${id}::uuid`}
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
 const closed=await sql`UPDATE attendance_sessions SET check_out=now(),out_lat=${lat},out_lon=${lon},break_seconds=break_seconds+CASE WHEN break_started_at IS NOT NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (now()-break_started_at)))::integer ELSE 0 END,break_started_at=NULL WHERE employee_id=${me.id}::uuid AND check_out IS NULL RETURNING id`;
 if(closed.length){await sql`INSERT INTO changes(topic) VALUES('attendance')`;return ok({action:'checkout'})}
 try{await sql`INSERT INTO attendance_sessions(employee_id,branch_id,in_lat,in_lon) VALUES (${me.id}::uuid,${branch}::uuid,${lat},${lon})`}
 catch(e){if(String(e).includes('unique'))return fail('You already have an active session',409);throw e}
 await sql`INSERT INTO changes(topic) VALUES('attendance')`;return ok({action:'checkin'});
}
if(path==='request'&&req.method==='POST'){
 const kind=String(body.kind||''),note=String(body.note||'').trim(),startDate=String(body.startDate||''),endDate=String(body.endDate||'');
 if(note.length<3)return fail('Provide a reason (at least 3 characters)');
 const categoryExists=await sql`SELECT id FROM request_categories WHERE lower(name)=lower(${kind}) AND active=true LIMIT 1`;
 if(!categoryExists.length)return fail('Choose an active request category');
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
