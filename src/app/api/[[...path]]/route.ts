import {NextRequest,NextResponse} from 'next/server';
import bcrypt from 'bcryptjs';
import {createHash,randomUUID} from 'crypto';
import {storageClient,ensureAvatarBucket} from '@/lib/supabase-storage';
import {db} from '@/lib/db';
import {session,createToken} from '@/lib/session';
import {initializeOnce} from '@/lib/bootstrap';
import {ensureAccessAndLeaveSchema} from '@/lib/compat-migration';
import {sealPassword,openPassword} from '@/lib/password-vault';
export const runtime='nodejs';
const ok=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message:string,status=400)=>ok({error:message},status);
const isAdmin=(r:string)=>r==='admin';
function validPoly(p:unknown):p is number[][]{return Array.isArray(p)&&p.length>=3&&p.length<=100&&p.every(x=>Array.isArray(x)&&x.length===2&&x.every((n:unknown)=>typeof n==='number'&&Number.isFinite(n)))&&p.every(x=>Math.abs(x[0])<=180&&Math.abs(x[1])<=90)}
function inPoly(lon:number,lat:number,pts:number[][]){let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const a=pts[i],b=pts[j];if(((a[1]>lat)!==(b[1]>lat))&&(lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0]))inside=!inside}return inside}
function distToPolygonM(lon:number,lat:number,poly:number[][]){
 const kx=111320*Math.cos(lat*Math.PI/180),ky=110540;let best=Infinity;
 for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];
  const ax=(p[0]-lon)*kx,ay=(p[1]-lat)*ky,bx=(q[0]-lon)*kx,by=(q[1]-lat)*ky;
  const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;let t=l2?-(ax*dx+ay*dy)/l2:0;t=Math.max(0,Math.min(1,t));
  best=Math.min(best,Math.hypot(ax+t*dx,ay+t*dy))}
 return best;
}
function fmtDistance(m:number){return m>=1000?(m/1000).toFixed(2)+' km':Math.round(m)+' m'}
const DEVICE_COOKIE='attendance_device';
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
function parseDeviceInfo(req:NextRequest){
 const ua=(req.headers.get('user-agent')||'').slice(0,300);
 let c:Record<string,unknown>={};
 try{c=JSON.parse(decodeURIComponent(req.headers.get('x-device-info')||'{}'))||{}}catch{c={}}
 const str=(v:unknown,n=60)=>typeof v==='string'?v.replace(/[\u0000-\u001f]/g,'').trim().slice(0,n):'';
 const osName=/Android/i.test(ua)?'Android':/iPhone|iPad|iPod/i.test(ua)?'iOS':/CrOS/i.test(ua)?'ChromeOS':/Windows/i.test(ua)?'Windows':/Mac OS X|Macintosh/i.test(ua)?'macOS':/Linux/i.test(ua)?'Linux':str(c.platform)||'Unknown OS';
 const pv=str(c.platformVersion,20).split('.')[0];
 let osVersion='';
 if(osName==='Android')osVersion=pv||(ua.match(/Android\s+([\d.]+)/i)?.[1]||'').split('.')[0];
 else if(osName==='iOS')osVersion=(ua.match(/OS (\d+)[_.](\d+)/i)||[]).slice(1,3).join('.');
 else if(osName==='Windows')osVersion=Number(pv)>=13?'11':'10';
 else if(osName==='macOS')osVersion=(ua.match(/Mac OS X (\d+)[_.](\d+)/i)||[]).slice(1,3).join('.');
 let model=str(c.model);
 if(!model&&osName==='Android'){const m=ua.match(/Android\s+[\d.]+;\s*([^;)]+)/i);const v=(m?.[1]||'').trim();if(v&&v!=='K'&&!/^Mobile$/i.test(v))model=v}
 if(!model)model=/iPhone/i.test(ua)?'iPhone':/iPad/i.test(ua)?'iPad':osName==='macOS'?'Mac':osName==='Windows'?'Windows PC':osName==='Linux'?'Linux PC':osName==='ChromeOS'?'Chromebook':'';
 const type=/iPad|Tablet/i.test(ua)||(osName==='Android'&&!/Mobile/i.test(ua))?'Tablet':(c.mobile===true||/iPhone|Mobi/i.test(ua))?'Mobile':'Desktop';
 const br=ua.match(/Edg\/(\d+)/)?['Edge',ua.match(/Edg\/(\d+)/)![1]]:ua.match(/OPR\/(\d+)/)?['Opera',ua.match(/OPR\/(\d+)/)![1]]:ua.match(/Firefox\/(\d+)/)?['Firefox',ua.match(/Firefox\/(\d+)/)![1]]:ua.match(/(?:Chrome|CriOS)\/(\d+)/)?['Chrome',ua.match(/(?:Chrome|CriOS)\/(\d+)/)![1]]:ua.match(/Version\/(\d+).*Safari/)?['Safari',ua.match(/Version\/(\d+)/)![1]]:['Browser',''];
 const info={type,model,os:osName,osVersion,browser:br[0],browserVersion:br[1],screen:str(c.screen,20),tz:str(c.tz,40),lang:str(c.lang,20),touch:Number(c.touch)||0,cores:Number(c.cores)||0,mem:Number(c.mem)||0};
 const label=[model||type,(osName+' '+osVersion).trim(),(br[0]+' '+br[1]).trim()].filter(Boolean).join(' · ');
 return {ua,label,info};
}
// Same phone check used when the device cookie was lost: model, OS, browser, screen and hardware must all match.
function fpMatch(a:unknown,b:unknown){
 const x=(a&&typeof a==='object'?a:{}) as Record<string,unknown>,y=(b&&typeof b==='object'?b:{}) as Record<string,unknown>;
 if(!String(x.model||'')||!String(x.screen||''))return false;
 return ['model','os','browser','screen','tz','cores','mem','touch','type'].every(k=>String(x[k]??'').toLowerCase()===String(y[k]??'').toLowerCase());
}
function setDeviceCookie(res:NextResponse,token:string){res.cookies.set(DEVICE_COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:60*60*24*400});return res}
const endedSession=(why?:string)=>{const r=fail(why||'Your session ended because this device is not registered for your account. Sign in again or ask your administrator.',401);r.cookies.delete('attendance_session');return r};
function deviceAllowed(row:{role?:unknown;scope?:unknown;device_hash?:unknown;device_lock?:unknown;allow_multiple_devices?:unknown},cookie:string|undefined){
 if(row.role==='admin'||row.role==='display'||row.scope==='all'||row.device_lock===false||row.allow_multiple_devices===true)return true;
 return !!cookie&&!!row.device_hash&&sha(cookie)===row.device_hash;
}
async function deviceSessionOk(sql:ReturnType<typeof db>,req:NextRequest,empId:string){
 await ensureAccessAndLeaveSchema();
 const r=await sql`SELECT e.role,e.allow_multiple_devices,r.scope,d.device_hash,(SELECT device_lock FROM app_settings WHERE id=1) AS device_lock FROM employees e LEFT JOIN role_access r ON r.role=e.role LEFT JOIN employee_devices d ON d.employee_id=e.id WHERE e.id=${empId}::uuid`;
 if(!r.length)return false;
 return deviceAllowed(r[0],req.cookies.get(DEVICE_COOKIE)?.value);
}
type DeviceResult={ok:true;token:string|null}|{ok:false;token:string|null;relogin?:boolean};
async function deviceGate(sql:ReturnType<typeof db>,req:NextRequest,emp:{id:string;role:string;name:string},context:'login'|'punch'):Promise<DeviceResult>{
 await ensureAccessAndLeaveSchema();
 if(emp.role==='admin'||emp.role==='display')return {ok:true,token:null};
 const cfg=await sql`SELECT device_lock FROM app_settings WHERE id=1`;
 if(cfg[0]&&cfg[0].device_lock===false)return {ok:true,token:null};
 if(await roleIsAllScope(sql,emp.role))return {ok:true,token:null};
 const multi=await sql`SELECT allow_multiple_devices FROM employees WHERE id=${emp.id}::uuid`;
 if(multi[0]?.allow_multiple_devices===true)return {ok:true,token:null};
 const cookieToken=req.cookies.get(DEVICE_COOKIE)?.value||'';
 const altRaw=req.headers.get('x-device-id')||'';const altHash=/^[0-9a-f-]{36}$/i.test(altRaw)?sha(altRaw):'';
 const {ua,label,info}=parseDeviceInfo(req);const infoJson=JSON.stringify(info);const ip=(req.headers.get('x-forwarded-for')||'').split(',')[0].trim().slice(0,64);
 let bound=await sql`SELECT device_hash FROM employee_devices WHERE employee_id=${emp.id}::uuid`;
 if(!bound.length){
  if(context==='punch')return {ok:false,token:null,relogin:true};
  const token=cookieToken||randomUUID();
  await sql`INSERT INTO employee_devices(employee_id,device_hash,alt_hash,label,user_agent,ip,info) VALUES(${emp.id}::uuid,${sha(token)},${altHash||null},${label},${ua},${ip},${infoJson}::jsonb) ON CONFLICT (employee_id) DO NOTHING`;
  await sql`INSERT INTO changes(topic) VALUES('devices')`;
  bound=await sql`SELECT device_hash FROM employee_devices WHERE employee_id=${emp.id}::uuid`;
  if(bound[0]?.device_hash===sha(token))return {ok:true,token:cookieToken?null:token};
 }
 const token=cookieToken||randomUUID(),hash=sha(token);
 if(bound[0]?.device_hash===hash){await sql`UPDATE employee_devices SET last_seen=now(),ip=${ip},label=${label},info=${infoJson}::jsonb,alt_hash=COALESCE(alt_hash,${altHash||null}) WHERE employee_id=${emp.id}::uuid`;return {ok:true,token:null}}
 // The device cookie is missing or different: recognise the same phone by its backup id or (flexible mode) its hardware profile.
 {
  const reg=await sql`SELECT alt_hash,info FROM employee_devices WHERE employee_id=${emp.id}::uuid`;
  const modeRow=await sql`SELECT device_match_mode FROM app_settings WHERE id=1`;
  const flexible=(modeRow[0]?.device_match_mode||'flexible')!=='strict';
  const sameBackup=!!altHash&&reg[0]?.alt_hash===altHash;
  if(sameBackup||(flexible&&fpMatch(reg[0]?.info,info))){
   await sql`UPDATE employee_devices SET device_hash=${hash},alt_hash=COALESCE(${altHash||null},alt_hash),last_seen=now(),ip=${ip},label=${label},info=${infoJson}::jsonb WHERE employee_id=${emp.id}::uuid`;
   await sql`INSERT INTO changes(topic) VALUES('devices')`;
   return {ok:true,token:cookieToken?null:token};
  }
 }
 const dup=await sql`SELECT id FROM device_alerts WHERE employee_id=${emp.id}::uuid AND attempted_hash=${hash} AND status='open' AND created_at > now() - INTERVAL '10 minutes' LIMIT 1`;
 if(!dup.length){
  await sql`INSERT INTO device_alerts(employee_id,attempted_hash,label,user_agent,ip,context,info) VALUES(${emp.id}::uuid,${hash},${label},${ua},${ip},${context},${infoJson}::jsonb)`;
  const admins=await sql`SELECT id FROM employees WHERE role='admin' AND status='active'`;
  for(const ad of admins)await sql`INSERT INTO notifications(recipient_id,title,message) VALUES(${ad.id}::uuid,'Device alert',${emp.name+' tried to '+(context==='login'?'sign in':'punch')+' from a different device ('+label+')'})`;
  await sql`INSERT INTO changes(topic) VALUES('devices')`;
 }
 return {ok:false,token:cookieToken?null:token};
}
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
// A missed checkout is not a real checkout: keep an explicit audit flag.
// Close stale sessions only for employees without overnight permission, using Doha's date.
let missedCheckoutSchemaReady:Promise<unknown>|undefined;
let lastExpireSweep=0;
async function roleIsAllScope(sql:ReturnType<typeof db>,role:string){
 await ensureAccessAndLeaveSchema();
 const r=await sql`SELECT scope FROM role_access WHERE role=${role} LIMIT 1`;
 return r[0]?.scope==='all';
}
async function expireStaleDaySessions(sql:ReturnType<typeof db>,force=true){
 if(!force&&Date.now()-lastExpireSweep<60000)return;
 lastExpireSweep=Date.now();
 if(!missedCheckoutSchemaReady)missedCheckoutSchemaReady=sql.query('ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS missed_checkout BOOLEAN NOT NULL DEFAULT false').catch(e=>{missedCheckoutSchemaReady=undefined;throw e});
 await missedCheckoutSchemaReady;
 await ensureAccessAndLeaveSchema();
 // Maximum Check-in Duration: an open session older than its own limit is closed as Absent.
 // Only that session is affected; other sessions of the same day keep their hours.
 await sql`UPDATE attendance_break_periods p SET ended_at=now() FROM attendance_sessions s WHERE p.session_id=s.id AND p.ended_at IS NULL AND s.check_out IS NULL AND s.max_hours_snapshot IS NOT NULL AND now()>=s.check_in+make_interval(secs=>(s.max_hours_snapshot*3600)::float8)`;
 const expired=await sql`UPDATE attendance_sessions s SET check_out=s.check_in, missed_checkout=true, expired_absent=true, break_started_at=NULL WHERE s.check_out IS NULL AND s.max_hours_snapshot IS NOT NULL AND now()>=s.check_in+make_interval(secs=>(s.max_hours_snapshot*3600)::float8) RETURNING s.employee_id,s.max_hours_snapshot`;
 if(expired.length){
  for(const x of expired)await sql`INSERT INTO notifications(recipient_id,title,message) VALUES(${String(x.employee_id)}::uuid,'Session marked Absent',${'A check-in exceeded the maximum duration of '+Number(x.max_hours_snapshot)+' hours without a check-out. That session was recorded as Absent and no hours were counted.'})`;
  await sql`INSERT INTO changes(topic) VALUES('attendance')`;
 }
 await sql`UPDATE attendance_sessions s
  SET check_out=s.check_in, missed_checkout=true, break_started_at=NULL
  FROM employees e
  WHERE s.employee_id=e.id AND s.check_out IS NULL
    AND e.variable_overnight_shift=false
    AND s.check_in < (date_trunc('day', now() AT TIME ZONE 'Asia/Qatar') AT TIME ZONE 'Asia/Qatar')`;
}
async function core(req:NextRequest,ctx:{params:Promise<{path?:string[]}>}){
const path=(await ctx.params).path?.join('/')||'';
try{
if ((path==='login'||path==='register'||path==='registration-status') && (req.method==='POST'||req.method==='GET')) { await initializeOnce(); await ensureAccessAndLeaveSchema(); }
const sql=db();
if(path==='registration-status'&&req.method==='GET'){const cfg=await sql`SELECT allow_registration FROM app_settings WHERE id=1`;return ok({enabled:cfg[0]?.allow_registration!==false});}const body=req.method==='POST' && !path.startsWith('avatar-')?await req.json().catch(()=>({})):{};
if(path==='login'&&req.method==='POST'){
 const email=String(body.email||'').toLowerCase().trim();const users=await sql`SELECT id,public_id,name,email,password_hash,role,status,must_change_password,avatar,required_daily_hours,shift_id,variable_overnight_shift,created_at FROM employees WHERE email=${email} LIMIT 1`;
 const u=users[0];if(!u||!(await bcrypt.compare(String(body.password||''),String(u.password_hash))))return fail('Incorrect email or password',401);if(u.status==='pending')return fail('ACCOUNT_PENDING',403);if(u.status!=='active')return fail('This account has been suspended. Contact your administrator.',403);
 try{await sql`UPDATE employees SET password_view=${sealPassword(String(body.password||''))} WHERE id=${String(u.id)}::uuid AND password_view IS NULL`}catch(e){console.error('password view backfill skipped',e instanceof Error?e.message:e)}
 const gate=await deviceGate(sql,req,{id:String(u.id),role:String(u.role),name:String(u.name)},'login');
 if(!gate.ok){const r=fail('This account is linked to another device. Your administrator has been notified. Ask them to reset your device to sign in here.',403);return gate.token?setDeviceCookie(r,gate.token):r}
 const token=await createToken({id:String(u.id),role:String(u.role),name:String(u.name)});const res=ok({user:{id:u.id,public_id:u.public_id,name:u.name,email:u.email,role:u.role,status:u.status,mustChangePassword:u.must_change_password,must_change_password:u.must_change_password,avatar:u.avatar,required_daily_hours:u.required_daily_hours,shift_id:u.shift_id,variable_overnight_shift:u.variable_overnight_shift,created_at:u.created_at}});
 res.cookies.set('attendance_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:604800});
 if(gate.token)setDeviceCookie(res,gate.token);
 return res;
}
if(path==='logout'&&req.method==='POST'){const res=ok({ok:true});res.cookies.delete('attendance_session');return res}
if(path==='register'&&req.method==='POST'){
 const registration=await sql`SELECT allow_registration FROM app_settings WHERE id=1`;if(registration[0]?.allow_registration===false)return fail('Registration is currently disabled. Please contact your administrator.',403);
 const name=String(body.name||'').trim(),email=String(body.email||'').toLowerCase().trim(),password=String(body.password||'');
 if(name.length<2||!email.includes('@')||password.length<6)return fail('Name, valid email, and password (6+ chars) required');
 const hash=await bcrypt.hash(password,12);await sql`INSERT INTO employees (name,email,password_hash,password_view,role,status) VALUES (${name},${email},${hash},${sealPassword(password)},'employee','pending')`;await sql`INSERT INTO changes(topic) VALUES('employees')`;return ok({ok:true},201);
}
const me=await session();if(!me)return fail('Sign in required',401);
if(path==='me') {if(!(await deviceSessionOk(sql,req,me.id)))return endedSession();const users=await sql`SELECT id,public_id,name,email,role,status,must_change_password,avatar,required_daily_hours,shift_id,variable_overnight_shift,created_at FROM employees WHERE id=${me.id}::uuid`;return ok({user:users[0]||null})}
if(path==='profile'&&req.method==='POST'){
 const out:Record<string,string>={};
 if('avatar' in body){
  const avatar=String(body.avatar||'');
  if(!(await profilePerm(sql,String(me.role),'profile.editPhoto')))return fail('Changing the profile photo is not allowed for your role',403);
  if(avatar.length>200000)return fail('Image too large');
  if(avatar && (avatar.length>200000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)))return fail('Invalid image; maximum 140 KB');
  await sql`UPDATE employees SET avatar=${avatar} WHERE id=${me.id}::uuid`;out.avatar=avatar;
 }
 if('name' in body){
  const name=String(body.name||'').trim();
  if(!(await profilePerm(sql,String(me.role),'profile.editName')))return fail('Changing your name is not allowed for your role',403);
  if(name.length<2||name.length>80)return fail('Enter your full name');
  await sql`UPDATE employees SET name=${name} WHERE id=${me.id}::uuid`;out.name=name;
 }
 if('email' in body){
  const email=String(body.email||'').trim().toLowerCase();
  if(!(await profilePerm(sql,String(me.role),'profile.editEmail')))return fail('Changing your email is not allowed for your role',403);
  if(!/^\S+@\S+\.\S+$/.test(email)||email.length>120)return fail('Enter a valid email address');
  const dup=await sql`SELECT 1 FROM employees WHERE lower(email)=${email} AND id<>${me.id}::uuid`;
  if(dup.length)return fail('This email is already used by another account',409);
  await sql`UPDATE employees SET email=${email} WHERE id=${me.id}::uuid`;out.email=email;
 }
 await sql`INSERT INTO changes(topic) VALUES('profile')`;
 return ok({user:out});
}
// Supabase Storage only; the application database remains on Neon.
if(path==='avatar-upload'&&req.method==='POST'){
 const {client,url,bucket}=storageClient();
 await ensureAvatarBucket(client);
 const form=await req.formData();const file=form.get('file');const targetId=String(form.get('employeeId')||me.id);if(targetId!==me.id){const actor=await sql`SELECT role FROM employees WHERE id=${me.id}::uuid LIMIT 1`;if(!actor[0]||!isAdmin(String(actor[0].role)))return fail('Admin only',403);}if(!/^[0-9a-f-]{36}$/i.test(targetId))return fail('Invalid employee ID');
 if(targetId===me.id&&!(await profilePerm(sql,String(me.role),'profile.editPhoto')))return fail('Changing the profile photo is not allowed for your role',403);
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
 const targetId=String(body.employeeId||me.id);
 if(!/^[0-9a-f-]{36}$/i.test(targetId))return fail('Invalid employee ID');
 if(targetId===me.id&&!(await profilePerm(sql,String(me.role),'profile.editPhoto')))return fail('Changing the profile photo is not allowed for your role',403);
 if(targetId!==me.id){const actor=await sql`SELECT role FROM employees WHERE id=${me.id}::uuid LIMIT 1`;if(!actor[0]||!isAdmin(String(actor[0].role)))return fail('Admin only',403);}
 const previous=await sql`SELECT avatar FROM employees WHERE id=${targetId}::uuid`;
 await sql`UPDATE employees SET avatar='' WHERE id=${targetId}::uuid`;
 await sql`INSERT INTO changes(topic) VALUES('profile')`;
 try {const {client,url,bucket}=storageClient();const oldPath=getSupabaseAvatarPath(String(previous[0]?.avatar||''),url,bucket,targetId);if(oldPath)await client.storage.from(bucket).remove([oldPath]);}catch(e){console.error('Avatar cleanup skipped:',e instanceof Error?e.message:'Unknown error')}
 return ok({user:{avatar:''}});
}
if(path==='break'&&req.method==='POST'){
 await expireStaleDaySessions(sql);
 if(me.role==='admin'||me.role==='display'||await roleIsAllScope(sql,me.role))return fail('Break actions are available to employees only',403);
 const dgate=await deviceGate(sql,req,{id:me.id,role:me.role,name:me.name},'punch');
 if(!dgate.ok){const r=endedSession(dgate.relogin?'Your session ended. Sign in again to register this device.':'This device is not registered for your account. Your administrator has been notified.');return dgate.token?setDeviceCookie(r,dgate.token):r}
 const open=await sql`SELECT id,break_started_at FROM attendance_sessions WHERE employee_id=${me.id}::uuid AND check_out IS NULL LIMIT 1`;
 if(!open.length)return fail('Check in before starting a break',409);
 const id=String(open[0].id);
 if(open[0].break_started_at){
  await sql`UPDATE attendance_break_periods SET ended_at=now() WHERE session_id=${id}::uuid AND ended_at IS NULL`;
  await sql`UPDATE attendance_sessions SET break_seconds=break_seconds+GREATEST(0,EXTRACT(EPOCH FROM (now()-break_started_at)))::integer,break_started_at=NULL WHERE id=${id}::uuid`;
  await sql`INSERT INTO changes(topic) VALUES('attendance')`;
  return ok({action:'break-end'});
 }
 const vis=await sql`SELECT ui_visibility FROM role_access WHERE role=${me.role} LIMIT 1`;
 if((vis[0]?.ui_visibility as Record<string,boolean>|null)?.['punch.break']===false)return fail('Breaks are not enabled for your role',403);
 await sql`INSERT INTO attendance_break_periods(session_id,started_at) VALUES(${id}::uuid,now())`;
 await sql`UPDATE attendance_sessions SET break_started_at=now() WHERE id=${id}::uuid`;
 await sql`INSERT INTO changes(topic) VALUES('attendance')`;
 return ok({action:'break-start'});
}
if(path==='notifications'&&req.method==='GET'){
 const rows=await sql`SELECT id,title,message,read_at,created_at FROM notifications WHERE recipient_id=${me.id}::uuid AND read_at IS NULL ORDER BY created_at DESC LIMIT 50`;
 return ok({notifications:rows});
}
if(path==='notifications-read'&&req.method==='POST'){
 const nid=String(body.id||'');
 if(nid){if(!/^[0-9a-f-]{36}$/i.test(nid))return fail('Invalid notification');await sql`UPDATE notifications SET read_at=now() WHERE id=${nid}::uuid AND recipient_id=${me.id}::uuid AND read_at IS NULL`;return ok({ok:true})}
 await sql`UPDATE notifications SET read_at=now() WHERE recipient_id=${me.id}::uuid AND read_at IS NULL`;
 return ok({ok:true});
}
// Pending messages are checked separately so they appear while the app is open.
if(path==='admin-messages-pending'&&req.method==='GET'){
 await dispatchDueMessages(sql);
 const rows=await sql`SELECT m.id,m.title,m.body,m.kind,m.created_at FROM admin_messages m JOIN admin_message_recipients r ON r.message_id=m.id WHERE r.employee_id=${me.id}::uuid AND r.acknowledged_at IS NULL AND m.status='sent' ORDER BY CASE m.kind WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,m.created_at ASC LIMIT 10`;
 return ok({messages:rows});
}
if(path==='admin-messages-ack'&&req.method==='POST'){
 const id=String(body.id||'');if(!/^[0-9a-f-]{36}$/i.test(id))return fail('Invalid message',400);
 const result=await sql`UPDATE admin_message_recipients SET acknowledged_at=now() WHERE message_id=${id}::uuid AND employee_id=${me.id}::uuid AND acknowledged_at IS NULL RETURNING message_id`;
 return ok({acknowledged:result.length>0});
}
if(path==='password'&&req.method==='POST'){
 const password=String(body.password||'');if(password.length<6)return fail('Use at least 6 characters');
 {const forced=await sql`SELECT must_change_password FROM employees WHERE id=${me.id}::uuid`;if(forced[0]?.must_change_password!==true&&!(await profilePerm(sql,String(me.role),'profile.changePassword')))return fail('Changing your password is not allowed for your role',403);}
 const hash=await bcrypt.hash(password,12);await sql`UPDATE employees SET password_hash=${hash},password_view=${sealPassword(password)},must_change_password=false WHERE id=${me.id}::uuid`;return ok({ok:true});
}
if(path==='version'&&req.method==='GET'){if(!(await deviceSessionOk(sql,req,me.id)))return endedSession();const v=await sql`SELECT COALESCE(MAX(id),0)::int AS id FROM changes`;return ok({version:Number(v[0].id)})}
await ensureAccessAndLeaveSchema();
const current=await sql`SELECT e.role,e.status,e.must_change_password,e.allow_multiple_devices,r.pages,r.sidebar_enabled,r.ui_visibility,r.scope,r.label,d.device_hash,(SELECT device_lock FROM app_settings WHERE id=1) AS device_lock FROM employees e LEFT JOIN role_access r ON r.role=e.role LEFT JOIN employee_devices d ON d.employee_id=e.id WHERE e.id=${me.id}::uuid LIMIT 1`;
if(!current[0]||current[0].status!=='active')return fail('Account inactive',403);
if(!deviceAllowed(current[0],req.cookies.get(DEVICE_COOKIE)?.value))return endedSession();
if(current[0].must_change_password)return fail('Change your password before continuing',403);
const roleName=String(current[0].role);
const isFull=roleName==='admin';
const isAll=isFull||String(current[0].scope||'self')==='all';
const accessRows=current[0].pages?[current[0]]:[];
const access=accessRows[0]||{pages:current[0].role==='admin'?['dashboard','history','onsite','punch','reports','profile','employees','branches','shifts','geofences','requests','settings','permissions']:['dashboard','history','punch','reports','profile','requests'],sidebar_enabled:current[0].role==='admin',ui_visibility:{}};
const visiblePages:string[]=Array.isArray(access.pages)?access.pages:JSON.parse(String(access.pages));
if(isFull){for(const id of ['shifts','request-categories','day-control'])if(!visiblePages.includes(id))visiblePages.push(id);}
if(isFull&&!visiblePages.includes('request-categories'))visiblePages.push('request-categories');
const need=(page:string)=>isFull||(isAll&&visiblePages.includes(page));
if(String(current[0].role)==='display' && !((path==='access'||path==='presence')&&req.method==='GET'))return fail('Display account: read-only access to On Site only',403);
if(path==='access'&&req.method==='GET')return ok({pages:visiblePages,sidebarEnabled:!!access.sidebar_enabled,uiVisibility:access.ui_visibility||{},role:String(current[0].role),scope:isAll?'all':'self',label:String(current[0].label||roleName)});
if(path==='employee-leaves'&&req.method==='GET'){
 const rows=isAll?await sql`SELECT l.id,l.employee_id,e.name,l.start_date,l.end_date,l.leave_type,l.notes FROM employee_leaves l JOIN employees e ON e.id=l.employee_id ORDER BY l.start_date DESC LIMIT 500`:await sql`SELECT id,employee_id,start_date,end_date,leave_type,notes FROM employee_leaves WHERE employee_id=${me.id}::uuid ORDER BY start_date DESC LIMIT 500`;
 return ok({leaves:rows});
}
if(path==='employee-leaves'&&req.method==='POST'){
 if(!need('employees'))return fail('Permission required',403);
 const employeeId=String(body.employeeId||''),start=String(body.startDate||''),end=String(body.endDate||''),type=String(body.leaveType||'Leave').trim(),notes=String(body.notes||'').trim();
 if(!/^[0-9a-f-]{36}$/i.test(employeeId)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(start)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(end)||end<start||!type||type.length>50)return fail('Invalid leave details',400);
 const target=await sql`SELECT id FROM employees WHERE id=${employeeId}::uuid LIMIT 1`;if(!target.length)return fail('Employee not found',404);
 const overlap=await sql`SELECT id FROM employee_leaves WHERE employee_id=${employeeId}::uuid AND start_date<=${end}::date AND end_date>=${start}::date LIMIT 1`;
 if(overlap.length)return fail('A leave already exists for these dates',409);
 await sql`INSERT INTO employee_leaves(employee_id,start_date,end_date,leave_type,notes,created_by) VALUES(${employeeId}::uuid,${start}::date,${end}::date,${type},${notes},${me.id}::uuid)`;
 await sql`INSERT INTO notifications(recipient_id,title,message) VALUES(${employeeId}::uuid,'Leave added',${type+' from '+start+' to '+end})`;
 await sql`INSERT INTO changes(topic) VALUES('employee-leaves')`;return ok({ok:true});
}
if(path==='admin-messages'&&req.method==='GET'){
 if(!need('admin-messages'))return fail('Permission required',403);
 await dispatchDueMessages(sql);
 const messages=await sql`SELECT m.id,m.title,m.body,m.kind,m.status,m.scheduled_for,m.sent_at,m.created_at,m.updated_at,m.audience,m.resend_count,m.last_resent_at,e.name AS created_by_name,COUNT(r.employee_id)::int AS recipients,COUNT(r.acknowledged_at)::int AS acknowledged FROM admin_messages m LEFT JOIN admin_message_recipients r ON r.message_id=m.id LEFT JOIN employees e ON e.id=m.created_by GROUP BY m.id,e.name ORDER BY COALESCE(m.scheduled_for,m.sent_at,m.created_at) DESC LIMIT 300`;
 const people=await sql`SELECT id,name,email FROM employees WHERE status='active' AND role <> 'display' ORDER BY name`;
 return ok({messages,people});
}
if(path==='admin-messages'&&req.method==='POST'){
 if(!need('admin-messages'))return fail('Permission required',403);
 await ensureAccessAndLeaveSchema();
 const action=String(body.action||'create');const uuidRe=/^[0-9a-f-]{36}$/i;
 const readMsg=async()=>{const id=String(body.id||'');if(!uuidRe.test(id))return null;const r=await sql`SELECT id,title,body,kind,status,scheduled_for,audience FROM admin_messages WHERE id=${id}::uuid`;return r[0]||null};
 if(action==='detail'){
  const m=await readMsg();if(!m)return fail('Message not found',404);
  const recipients=await sql`SELECT e.id,e.name,e.email,e.public_id,r.acknowledged_at FROM admin_message_recipients r JOIN employees e ON e.id=r.employee_id WHERE r.message_id=${String(m.id)}::uuid ORDER BY (r.acknowledged_at IS NULL) DESC,e.name`;
  return ok({message:m,recipients});
 }
 if(action==='delete'){
  const m=await readMsg();if(!m)return fail('Message not found',404);
  await sql.transaction([sql`DELETE FROM notifications WHERE ref_id=${String(m.id)}::uuid`,sql`DELETE FROM admin_messages WHERE id=${String(m.id)}::uuid`]);
  await sql`INSERT INTO changes(topic) VALUES('admin-messages')`;return ok({ok:true});
 }
 if(action==='send-now'){
  const m=await readMsg();if(!m)return fail('Message not found',404);
  if(m.status!=='scheduled')return fail('Only scheduled messages can be sent now',409);
  const claimed=await sql`UPDATE admin_messages SET status='sent',sent_at=now(),scheduled_for=NULL WHERE id=${String(m.id)}::uuid AND status='scheduled' RETURNING id`;
  if(!claimed.length)return fail('Message was already sent',409);
  const n=await deliverMessage(sql,{id:String(m.id),title:String(m.title),body:String(m.body),audience:m.audience});
  await sql`INSERT INTO changes(topic) VALUES('admin-messages')`;return ok({ok:true,recipients:n});
 }
 if(action==='resend'){
  const m=await readMsg();if(!m)return fail('Message not found',404);
  if(m.status!=='sent')return fail('Send the message first',409);
  const mode=body.mode==='unread'?'unread':'all';let n=0;
  if(mode==='unread'){
   const un=(await sql`SELECT employee_id FROM admin_message_recipients WHERE message_id=${String(m.id)}::uuid AND acknowledged_at IS NULL`).map(r=>String(r.employee_id));
   if(un.length){await sql`INSERT INTO notifications(recipient_id,title,message,ref_id) SELECT x,${String(m.title)},${String(m.body)},${String(m.id)}::uuid FROM unnest(${un}::uuid[]) AS x`;n=un.length}
  }else n=await deliverMessage(sql,{id:String(m.id),title:String(m.title),body:String(m.body),audience:m.audience},{resetRead:true});
  await sql`UPDATE admin_messages SET resend_count=resend_count+1,last_resent_at=now() WHERE id=${String(m.id)}::uuid`;
  await sql`INSERT INTO changes(topic) VALUES('admin-messages')`;return ok({ok:true,recipients:n});
 }
 // create / update share validation
 const title=String(body.title||'').trim(),message=String(body.message||'').trim();
 if(title.length<3||title.length>120||message.length<3||message.length>3000)return fail('Title 3–120 and message 3–3000 characters required');
 const kind=MSG_KINDS.includes(String(body.kind))?String(body.kind):'notice';
 const everyone=body.everyone===true;
 const ids=Array.isArray(body.employeeIds)?(body.employeeIds as unknown[]).map(String):[];
 let sendAt:Date|null=null;
 if(body.sendAt){sendAt=new Date(String(body.sendAt));if(Number.isNaN(sendAt.getTime()))return fail('Choose a valid send time');if(sendAt.getTime()<Date.now()+15000)return fail('Choose a future time to schedule, or send now');}
 if(action==='update'){
  const m=await readMsg();if(!m)return fail('Message not found',404);
  if(m.status==='scheduled'){
   if(!everyone&&(ids.length===0||ids.length>500||ids.some(id=>!uuidRe.test(id))))return fail('Choose recipients');
   if(!sendAt)return fail('Choose the send time');
   await sql`UPDATE admin_messages SET title=${title},body=${message},kind=${kind},audience=${JSON.stringify({everyone,employeeIds:everyone?[]:ids})}::jsonb,scheduled_for=${sendAt.toISOString()}::timestamptz,updated_at=now() WHERE id=${String(m.id)}::uuid AND status='scheduled'`;
  }else{
   // Already sent: wording and type can be corrected (unread recipients see the corrected text); recipients stay the same.
   await sql`UPDATE admin_messages SET title=${title},body=${message},kind=${kind},updated_at=now() WHERE id=${String(m.id)}::uuid`;
  }
  await sql`INSERT INTO changes(topic) VALUES('admin-messages')`;return ok({ok:true});
 }
 if(!everyone&&(ids.length===0||ids.length>500||ids.some(id=>!uuidRe.test(id))))return fail('Choose recipients');
 const audience=JSON.stringify({everyone,employeeIds:everyone?[]:ids});
 if(sendAt){
  await sql`INSERT INTO admin_messages(title,body,created_by,kind,status,scheduled_for,audience) VALUES(${title},${message},${me.id}::uuid,${kind},'scheduled',${sendAt.toISOString()}::timestamptz,${audience}::jsonb)`;
  await sql`INSERT INTO changes(topic) VALUES('admin-messages')`;return ok({ok:true,scheduled:true});
 }
 const eligible=await sql`SELECT id FROM employees WHERE status='active' AND role <> 'display' AND (${everyone} OR id=ANY(${ids}::uuid[]))`;
 if(!eligible.length)return fail('No eligible recipients');
 const created=await sql`INSERT INTO admin_messages(title,body,created_by,kind,status,sent_at,audience) VALUES(${title},${message},${me.id}::uuid,${kind},'sent',now(),${audience}::jsonb) RETURNING id`;
 const n=await deliverMessage(sql,{id:String(created[0].id),title,body:message,audience:{everyone,employeeIds:everyone?[]:ids}});
 await sql`INSERT INTO changes(topic) VALUES('admin-messages')`;
 return ok({ok:true,recipients:n});
}
if(path==='role-options'&&req.method==='GET'){
 if(!isAll)return fail('Permission required',403);
 const rows=await sql`SELECT role,COALESCE(label,role) AS label,scope FROM role_access ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'employee' THEN 1 WHEN 'display' THEN 2 ELSE 3 END,role`;
 return ok({roles:isFull?rows:rows.filter(r=>r.role!=='admin'&&r.role!=='display')});
}
if(path==='roles'&&req.method==='GET'){
 if(!isFull)return fail('Admin only',403);
 const roles=await sql`SELECT role,COALESCE(label,role) AS label,scope,pages,sidebar_enabled,ui_visibility FROM role_access ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'employee' THEN 1 WHEN 'display' THEN 2 ELSE 3 END,role`;
 const cfg=await sql`SELECT allow_registration FROM app_settings WHERE id=1`;
 return ok({roles,allowRegistration:cfg[0]?.allow_registration!==false});
}
if(path==='roles'&&req.method==='POST'){
 if(!isFull)return fail('Admin only',403);
 const action=String(body.action||'save');
 if(action==='toggle-registration'){await sql`INSERT INTO app_settings(id,allow_registration) VALUES(1,${body.enabled===true}) ON CONFLICT(id) DO UPDATE SET allow_registration=EXCLUDED.allow_registration`;await sql`INSERT INTO changes(topic) VALUES('permissions')`;return ok({ok:true,allowRegistration:body.enabled===true})}
 const slug=(v:string)=>v.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30);
 const allowedSelf=['dashboard','history','onsite','punch','reports','profile','requests'];
 const allowedAll=['dashboard','onsite','reports','profile','employees','branches','shifts','geofences','requests','request-categories','admin-messages','settings','failed-attempts','devices','activity-log','day-control'];
 const reserved=['admin','employee','display'];
 if(action==='create'){
  const label=String(body.label||'').trim();const scope=body.scope==='all'?'all':'self';
  const newRole=slug(String(body.role||label));
  if(label.length<2||label.length>40||newRole.length<2)return fail('Role name must be 2-40 characters (use English letters or numbers for the system key)');
  if(reserved.includes(newRole))return fail('This role name is reserved');
  if((await sql`SELECT 1 FROM role_access WHERE role=${newRole}`).length)return fail('A role with this name already exists',409);
  const startPages=scope==='all'?['dashboard','reports','profile']:['dashboard','history','punch','reports','profile','requests'];
  await sql`INSERT INTO role_access(role,label,scope,pages,sidebar_enabled) VALUES(${newRole},${label},${scope},${JSON.stringify(startPages)}::jsonb,${scope==='all'})`;
  await sql`INSERT INTO changes(topic) VALUES('permissions')`;
  return ok({ok:true,role:newRole},201);
 }
 const role=String(body.role||'');
 const target=await sql`SELECT role,scope FROM role_access WHERE role=${role}`;
 if(!target.length)return fail('Role not found',404);
 if(role==='admin')return fail('The administrator role cannot be edited',400);
 if(action==='delete'){
  if(reserved.includes(role))return fail('Built-in roles cannot be deleted',400);
  const used=await sql`SELECT COUNT(*)::int AS n FROM employees WHERE role=${role}`;
  if(Number(used[0].n)>0)return fail('Reassign the employees using this role before deleting it',409);
  await sql`DELETE FROM role_access WHERE role=${role}`;
  await sql`INSERT INTO changes(topic) VALUES('permissions')`;
  return ok({ok:true});
 }
 const pages=body.pages;const sidebar=body.sidebarEnabled===true;
 const ui=body.uiVisibility;
 if(ui!==undefined&&(typeof ui!=='object'||ui===null||Array.isArray(ui)||Object.keys(ui).length>80||Object.entries(ui).some(([k,v])=>k.length>100||typeof v!=='boolean')))return fail('Invalid visibility permissions',400);
 const scope=role==='display'?'self':String(target[0].scope||'self');
 const allowed=role==='display'?['onsite']:scope==='all'?allowedAll:allowedSelf;
 if(!Array.isArray(pages)||pages.some((p:unknown)=>!allowed.includes(String(p))))return fail('Invalid role permissions',400);
 const base=role==='display'?['onsite']:scope==='all'?['dashboard','profile']:['dashboard','profile','punch'];
 const safePages=Array.from(new Set([...pages.map((p:unknown)=>String(p)),...base]));
 const newLabel=String(body.label||'').trim().slice(0,40);
 await sql`UPDATE role_access SET pages=${JSON.stringify(safePages)}::jsonb,sidebar_enabled=${sidebar},ui_visibility=${JSON.stringify(ui||{})}::jsonb,label=COALESCE(NULLIF(${newLabel},''),label) WHERE role=${role}`;
 await sql`INSERT INTO changes(topic) VALUES('permissions')`;
 return ok({ok:true});
}
// Never rely on hidden navigation: enforce visibility for sensitive endpoints too.
if(path==='presence'&&!visiblePages.includes('onsite'))return fail('On-site directory not permitted',403);
if(path==='request'&&!visiblePages.includes('requests'))return fail('Requests not permitted',403);
if(path==='presence'&&req.method==='GET'){
 // A non-admin may only see colleagues in their own assigned branch.
 const admin=isAll||String(current[0].role)==='display';
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
 return ok({categories:isAll?categories:categories.filter(x=>x.active)});
}
if(path==='request-categories'&&req.method==='POST'){
 if(!need('request-categories'))return fail('Permission required',403);
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

if(path==='calendar-report'&&req.method==='GET'){
 if(!visiblePages.includes('reports'))return fail('Reports permission required',403);
 if(!isAll)return fail('Admin report only',403);
 const month=String(req.nextUrl.searchParams.get('month')||'');
 const from=String(req.nextUrl.searchParams.get('from')||'');const to=String(req.nextUrl.searchParams.get('to')||'');
 const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T12:00:00Z'));
 if(!validDate(from)||!validDate(to)||from>to)return fail('Provide a valid From Date and To Date');
 const span=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000;
 if(span>365)return fail('Date range cannot exceed 366 days');
 const start=from,endExclusive=to;
 const employeeFilter=String(req.nextUrl.searchParams.get('employee')||'');
 const branchFilter=String(req.nextUrl.searchParams.get('branch')||'');
 if(employeeFilter&&!/^[0-9a-f-]{36}$/i.test(employeeFilter))return fail('Invalid employee filter');
 if(branchFilter&&!/^[0-9a-f-]{36}$/i.test(branchFilter))return fail('Invalid branch filter');
 const admin=isAll;
 const people=admin ? await sql`SELECT e.id,e.public_id,e.name,e.branch_id,e.required_daily_hours,e.created_at,b.name AS branch_name FROM employees e LEFT JOIN branches b ON b.id=e.branch_id WHERE e.role NOT IN ('admin','display') AND (${employeeFilter}='' OR e.id::text=${employeeFilter}) AND (${branchFilter}='' OR e.branch_id::text=${branchFilter}) ORDER BY e.name LIMIT 500` : await sql`SELECT e.id,e.public_id,e.name,e.branch_id,e.required_daily_hours,e.created_at,b.name AS branch_name FROM employees e LEFT JOIN branches b ON b.id=e.branch_id WHERE e.id=${me.id}::uuid`;
 const events=admin ? await sql`SELECT s.id,s.employee_id,s.branch_id,s.check_in,s.check_out,s.break_seconds,s.break_started_at,s.missed_checkout,s.expired_absent,s.shift_name_snapshot,s.shift_start_snapshot,s.shift_end_snapshot,s.required_hours_snapshot,s.shift_break_minutes_snapshot FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id WHERE e.role NOT IN ('admin','display') AND s.check_in >= (${start}::date::timestamp AT TIME ZONE 'Asia/Qatar') AND s.check_in < ((${endExclusive}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Qatar') AND (${employeeFilter}='' OR s.employee_id::text=${employeeFilter}) AND (${branchFilter}='' OR s.branch_id::text=${branchFilter}) ORDER BY s.check_in LIMIT 10000` : await sql`SELECT s.id,s.employee_id,s.branch_id,s.check_in,s.check_out,s.break_seconds,s.break_started_at,s.missed_checkout,s.expired_absent,s.shift_name_snapshot,s.shift_start_snapshot,s.shift_end_snapshot,s.required_hours_snapshot,s.shift_break_minutes_snapshot FROM attendance_sessions s WHERE s.employee_id=${me.id}::uuid AND s.check_in >= (${start}::date::timestamp AT TIME ZONE 'Asia/Qatar') AND s.check_in < ((${endExclusive}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Qatar') ORDER BY s.check_in LIMIT 10000`;
 const hist=await sql`SELECT employee_id,effective_from,shift_name,shift_start,shift_end,required_daily_hours FROM employee_schedule_history WHERE employee_id = ANY(${people.map(x=>String(x.id))}::uuid[]) ORDER BY effective_from`;
 const graceSettings=await sql`SELECT early_grace_minutes,overtime_grace_minutes FROM app_settings WHERE id=1`;
 const ids=people.map(x=>String(x.id));
 const leaves=await sql`SELECT employee_id,start_date::text AS start_date,end_date::text AS end_date FROM employee_leaves WHERE employee_id = ANY(${ids}::uuid[]) AND start_date <= ${endExclusive}::date AND end_date >= ${start}::date UNION ALL SELECT employee_id,start_date::text AS start_date,end_date::text AS end_date FROM requests WHERE status='approved' AND start_date IS NOT NULL AND end_date IS NOT NULL AND employee_id = ANY(${ids}::uuid[]) AND start_date <= ${endExclusive}::date AND end_date >= ${start}::date`;
 const pIds=people.map(p=>String(p.id));
 const offRowsR=pIds.length?await sql`SELECT employee_id,effective_from::text AS effective_from,days FROM employee_off_days WHERE employee_id=ANY(${pIds}::uuid[])`:[];
 const overRowsR=pIds.length?await sql`SELECT employee_id,day::text AS day,kind FROM employee_day_overrides WHERE employee_id=ANY(${pIds}::uuid[]) AND day>=${from}::date AND day<=${to}::date`:[];
 return ok({people,events,offDays:offRowsR,dayOverrides:overRowsR,history:hist,leaves,settings:graceSettings[0]||{},from,to,timeZone:'Asia/Qatar',notes:'Historical schedule data before this update may be unavailable. Blank days are not automatically marked absent without workday and leave rules. Overtime is calculated against preserved scheduled hours when available.'});
}

if(path==='break-periods'&&req.method==='GET'){
 const admin=isAll;
 const periods=admin
  ? await sql`SELECT bp.session_id,bp.started_at,bp.ended_at FROM attendance_break_periods bp JOIN attendance_sessions s ON s.id=bp.session_id ORDER BY bp.started_at DESC LIMIT 2000`
  : await sql`SELECT bp.session_id,bp.started_at,bp.ended_at FROM attendance_break_periods bp JOIN attendance_sessions s ON s.id=bp.session_id WHERE s.employee_id=${me.id}::uuid ORDER BY bp.started_at DESC LIMIT 500`;
 return ok({periods});
}
if(path==='workforce-analytics'&&req.method==='GET'){
 if(!isAll)return fail('Workforce access required',403);
 const days=Math.max(7,Math.min(90,Number(req.nextUrl.searchParams.get('days')||30)||30));
 const rows=await sql`SELECT s.id,s.employee_id,e.name,e.required_daily_hours,s.check_in,s.check_out,s.break_seconds,s.break_started_at,s.required_hours_snapshot,s.shift_start_snapshot,s.missed_checkout,s.expired_absent FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id WHERE e.status='active' AND e.role NOT IN ('admin','display') AND s.check_in >= (((now() AT TIME ZONE 'Asia/Qatar')::date - (${days}::int-1))::timestamp AT TIME ZONE 'Asia/Qatar') AND s.check_in < (((now() AT TIME ZONE 'Asia/Qatar')::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Qatar') ORDER BY s.check_in ASC LIMIT 15000`;
 const headcount=await sql`SELECT COUNT(*)::int AS count FROM employees WHERE status='active' AND role NOT IN ('admin','display')`;
 return ok({rows,headcount:Number(headcount[0]?.count||0),days});
}
if(path==='snapshot'&&req.method==='GET'){
 await ensureAccessAndLeaveSchema();
 await expireStaleDaySessions(sql,false);
 const kitchenVisible=isFull||(access.ui_visibility as Record<string,boolean>|null)?.['dashboard.kitchen']!==false;
 const [staff,sessions,kitchen,fences,requests,branches,settings,version,devAlerts,empStats,offRows,overRows]=await Promise.all([
  isAll?sql`SELECT id,public_id,name,email,role,status,branch_id,avatar,created_at,required_daily_hours,shift_id,variable_overnight_shift,allow_outside_geofence,allow_multiple_devices,max_checkin_enabled,max_checkin_hours FROM employees ORDER BY created_at DESC LIMIT 500`:Promise.resolve([]),
  isAll?sql`SELECT s.id,s.public_id,s.employee_id,e.name,s.check_in,s.check_out,s.branch_id,s.in_lat,s.in_lon,s.out_lat,s.out_lon,s.break_seconds,s.break_started_at,s.required_hours_snapshot,s.missed_checkout,s.expired_absent FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id WHERE e.role NOT IN ('admin','display') ORDER BY s.check_in DESC LIMIT 100`:sql`SELECT s.id,s.public_id,s.employee_id,e.name,s.check_in,s.check_out,s.branch_id,s.in_lat,s.in_lon,s.out_lat,s.out_lon,s.break_seconds,s.break_started_at,s.required_hours_snapshot,s.missed_checkout,s.expired_absent FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.employee_id=${me.id}::uuid ORDER BY s.check_in DESC LIMIT 100`,
  !kitchenVisible?Promise.resolve([]):isAll?sql`SELECT e.id,e.name,e.avatar,e.status,e.branch_id,b.name AS branch_name,s.check_in,s.break_started_at FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id LEFT JOIN branches b ON b.id=e.branch_id WHERE s.check_out IS NULL AND e.status='active' ORDER BY s.check_in DESC LIMIT 300`:sql`SELECT e.id,e.name,e.avatar,e.status,e.branch_id,b.name AS branch_name,s.check_in,s.break_started_at FROM attendance_sessions s JOIN employees e ON e.id=s.employee_id LEFT JOIN branches b ON b.id=e.branch_id WHERE s.check_out IS NULL AND e.status='active' AND e.branch_id=(SELECT branch_id FROM employees WHERE id=${me.id}::uuid) AND EXISTS (SELECT 1 FROM attendance_sessions mine WHERE mine.employee_id=${me.id}::uuid AND mine.check_out IS NULL) ORDER BY s.check_in DESC LIMIT 300`,
  isAll?sql`SELECT id,public_id,name,branch_id,polygon,active FROM geofences ORDER BY name`:Promise.resolve([]),
  isAll?sql`SELECT r.id,r.public_id,r.employee_id,e.name,r.kind,r.note,r.start_date,r.end_date,r.status,r.created_at FROM requests r JOIN employees e ON e.id=r.employee_id ORDER BY r.created_at DESC LIMIT 100`:sql`SELECT r.id,r.public_id,r.employee_id,e.name,r.kind,r.note,r.start_date,r.end_date,r.status,r.created_at FROM requests r JOIN employees e ON e.id=r.employee_id WHERE employee_id=${me.id}::uuid ORDER BY r.created_at DESC LIMIT 100`,
  sql`SELECT id,public_id,name FROM branches ORDER BY name`,
  sql`SELECT site_name,logo,icon,language,date_format,time_format,early_grace_minutes,overtime_grace_minutes FROM app_settings WHERE id=1`,
  sql`SELECT COALESCE(MAX(id),0) as id FROM changes`,
  isAll?sql`SELECT COUNT(*)::int AS n FROM device_alerts WHERE status='open'`:Promise.resolve([{n:0}]),
  isAll?sql`SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE status='active')::int AS active,COUNT(*) FILTER (WHERE status='pending')::int AS pending FROM employees WHERE role NOT IN ('admin','display')`:Promise.resolve([{total:0,active:0,pending:0}]),
  isAll?sql`SELECT employee_id,effective_from::text AS effective_from,days FROM employee_off_days`:sql`SELECT employee_id,effective_from::text AS effective_from,days FROM employee_off_days WHERE employee_id=${me.id}::uuid`,
  isAll?sql`SELECT employee_id,day::text AS day,kind FROM employee_day_overrides WHERE day>=(now() AT TIME ZONE 'Asia/Qatar')::date-400`:sql`SELECT employee_id,day::text AS day,kind FROM employee_day_overrides WHERE employee_id=${me.id}::uuid AND day>=(now() AT TIME ZONE 'Asia/Qatar')::date-400`
 ]);
 const kitchenVisibility=(access.ui_visibility as Record<string,boolean>|null)||{};
 const kitchenRows=(kitchen as Record<string,unknown>[]).map(person=>({
  id:person.id,
  ...(kitchenVisibility['dashboard.kitchen.name']===false?{}:{name:person.name}),
  ...(kitchenVisibility['dashboard.kitchen.photo']===false?{}:{avatar:person.avatar}),
  ...(kitchenVisibility['dashboard.kitchen.branch']===false?{}:{branch_name:person.branch_name}),
  ...(kitchenVisibility['dashboard.kitchen.status']===false?{}:{break_started_at:person.break_started_at}),
  ...(kitchenVisibility['dashboard.kitchen.checkInTime']===false?{}:{check_in:person.check_in})
 }));
 return ok({staff,sessions,kitchen:kitchenRows,fences,requests,branches,settings:settings[0]||null,version:Number(version[0].id),deviceAlerts:Number(devAlerts[0]?.n||0),offDays:offRows,dayOverrides:overRows,employeeStats:{total:Number(empStats[0]?.total||0),active:Number(empStats[0]?.active||0),pending:Number(empStats[0]?.pending||0)}});
}
if(path==='changes'&&req.method==='GET'){
 const since=Math.max(0,Number(req.nextUrl.searchParams.get('since')||0));const rows=await sql`SELECT id,topic,created_at FROM changes WHERE id>${since} ORDER BY id ASC LIMIT 100`;return ok({events:rows});
}
if(path==='settings'&&req.method==='POST'){
 if(!need('settings'))return fail('Permission required',403);
 const siteName=String(body.site_name||'').trim(),logo=String(body.logo||''),icon=String(body.icon||''),language=String(body.language||'ar'),dateFormat=String(body.date_format||'short'),timeFormat=String(body.time_format||'24');
 if(!siteName||siteName.length>70||!['ar','en'].includes(language)||!['short','numeric','long'].includes(dateFormat)||!['12','24'].includes(timeFormat))return fail('Invalid settings');
 const earlyGrace=Number(body.early_grace_minutes??0),overtimeGrace=Number(body.overtime_grace_minutes??0);
 if(![earlyGrace,overtimeGrace].every(n=>Number.isInteger(n)&&n>=0&&n<=240))return fail('Grace period must be between 0 and 240 minutes');
 if([logo,icon].some(v=>v.length>230000|| (v && !/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v))))return fail('Upload a PNG/JPEG/WebP/SVG under 150 KB');
 await sql`INSERT INTO app_settings(id,site_name,logo,icon,language,date_format,time_format,early_grace_minutes,overtime_grace_minutes) VALUES(1,${siteName},${logo},${icon},${language},${dateFormat},${timeFormat},${earlyGrace},${overtimeGrace}) ON CONFLICT(id) DO UPDATE SET site_name=EXCLUDED.site_name,logo=EXCLUDED.logo,icon=EXCLUDED.icon,language=EXCLUDED.language,date_format=EXCLUDED.date_format,time_format=EXCLUDED.time_format,early_grace_minutes=EXCLUDED.early_grace_minutes,overtime_grace_minutes=EXCLUDED.overtime_grace_minutes`;
 await sql`INSERT INTO changes(topic) VALUES('settings')`;return ok({ok:true});
}
if(path==='shifts'&&req.method==='GET'){
 if(!need('shifts'))return fail('Permission required',403);
 const shifts=await sql`SELECT id,public_id,name,start_time,end_time,break_minutes FROM shifts ORDER BY name`;
 return ok({shifts});
}
if(path==='shifts'&&req.method==='POST'){
 if(!need('shifts'))return fail('Permission required',403);
 const name=String(body.name||'').trim(),start=String(body.startTime||''),end=String(body.endTime||'');
 const breakMinutes=Number(body.breakMinutes??0);
 if(name.length<2||!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||!Number.isInteger(breakMinutes)||breakMinutes<0||breakMinutes>600)return fail('Invalid shift');
 await sql`INSERT INTO shifts(name,start_time,end_time,break_minutes) VALUES(${name},${start}::time,${end}::time,${breakMinutes})`;
 return ok({ok:true},201);
}
if(path==='assign-employee'&&req.method==='POST'){
 if(!need('employees'))return fail('Permission required',403);
 const employeeId=String(body.employeeId||''),branchId=body.branchId==null?undefined:String(body.branchId),shiftId=body.shiftId==null?undefined:String(body.shiftId);
 if(!/^[0-9a-f-]{36}$/i.test(employeeId))return fail('Invalid employee',400);
 if(branchId!==undefined){if(branchId&&!(await sql`SELECT id FROM branches WHERE id=${branchId}::uuid`).length)return fail('Unknown branch');await sql`UPDATE employees SET branch_id=${branchId||null}::uuid WHERE id=${employeeId}::uuid`}
 if(shiftId!==undefined){if(shiftId&&!(await sql`SELECT id FROM shifts WHERE id=${shiftId}::uuid`).length)return fail('Unknown shift');await sql`UPDATE employees SET shift_id=${shiftId||null}::uuid WHERE id=${employeeId}::uuid`}
 await sql`INSERT INTO changes(topic) VALUES('employees')`;return ok({ok:true});
}
if(path==='shift-manage'&&req.method==='POST'){
 if(!need('shifts'))return fail('Permission required',403);
 const id=String(body.id||''),action=String(body.action||'');if(!/^[0-9a-f-]{36}$/i.test(id))return fail('Invalid shift ID');
 if(action==='delete'){
  const refs=await sql`SELECT COUNT(*)::int n FROM employees WHERE shift_id=${id}::uuid`;if(Number(refs[0]?.n)>0)return fail('Unassign employees before deleting this shift',409);
  await sql`DELETE FROM shifts WHERE id=${id}::uuid`;
 }else if(action==='edit'){
  const name=String(body.name||'').trim(),start=String(body.startTime||''),end=String(body.endTime||''),breakMinutes=Number(body.breakMinutes||0);
  if(name.length<2||!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||!Number.isInteger(breakMinutes)||breakMinutes<0||breakMinutes>600)return fail('Invalid shift');
  await sql`UPDATE shifts SET name=${name},start_time=${start}::time,end_time=${end}::time,break_minutes=${breakMinutes} WHERE id=${id}::uuid`;
  await sql`INSERT INTO employee_schedule_history(employee_id,effective_from,shift_id,shift_name,shift_start,shift_end,shift_break_minutes,required_daily_hours) SELECT id,now(),shift_id,${name},${start}::time,${end}::time,${breakMinutes},required_daily_hours FROM employees WHERE shift_id=${id}::uuid`;
 }else return fail('Invalid action');
 await sql`INSERT INTO changes(topic) VALUES('shifts')`;return ok({ok:true});
}
if(path==='create-employee'&&req.method==='POST'){
 if(!need('employees'))return fail('Permission required',403);
 const name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
 const role=String(body.role||'employee'),status=String(body.status||'active'),branchId=String(body.branchId||'');
 const requiredHours=body.requiredDailyHours===null||String(body.requiredDailyHours??'').trim()===''?null:Number(body.requiredDailyHours),shiftId=String(body.shiftId||'');
 const variableOvernightShift=body.variableOvernightShift===true||body.variableOvernightShift==='true';
 const flag=(v:unknown)=>v===true||v==='true';
 const allowOutside=flag(body.allowOutsideGeofence),allowMulti=flag(body.allowMultipleDevices),maxEnabled=flag(body.maxCheckinEnabled);
 const maxHoursRaw=String(body.maxCheckinHours??'').trim(),maxHoursVal=maxHoursRaw===''?null:Number(maxHoursRaw);
 if(maxEnabled&&(maxHoursVal===null||!Number.isFinite(maxHoursVal)||maxHoursVal<=0||maxHoursVal>72))return fail('Maximum Check-in Duration must be between 0.5 and 72 hours when enabled');
 if(requiredHours!==null&&(!Number.isFinite(requiredHours)||requiredHours<=0||requiredHours>24))return fail('Working hours must be greater than 0 and at most 24');
 if(shiftId && !(await sql`SELECT id FROM shifts WHERE id=${shiftId}::uuid`).length)return fail('Shift not found');
 if(name.length<2||!/^\S+@\S+\.\S+$/.test(email)||password.length<6||!role||!['active','pending','suspended'].includes(status))return fail('Invalid employee details or password under 6 characters');
 if(branchId){const b=await sql`SELECT id FROM branches WHERE id=${branchId}::uuid`;if(!b.length)return fail('Branch not found')}
 if(!(await sql`SELECT 1 FROM role_access WHERE role=${role}`).length)return fail('Unknown role');
 if(role==='admin'&&!isFull)return fail('Only administrators can assign the administrator role',403);
 const hash=await bcrypt.hash(password,12);
 await sql`INSERT INTO employees(name,email,password_hash,password_view,role,status,branch_id,must_change_password,required_daily_hours,shift_id,variable_overnight_shift,allow_outside_geofence,allow_multiple_devices,max_checkin_enabled,max_checkin_hours) VALUES(${name},${email},${hash},${sealPassword(password)},${role},${status},${branchId||null}::uuid,true,${requiredHours},${shiftId||null}::uuid,${variableOvernightShift},${allowOutside},${allowMulti},${maxEnabled},${maxEnabled?maxHoursVal:(maxHoursVal&&maxHoursVal>0&&maxHoursVal<=72?maxHoursVal:null)})`;
 {const offNew=parseOffDays(body.offDays);if(offNew.length){const created=await sql`SELECT id FROM employees WHERE email=${email}`;if(created.length)await sql`INSERT INTO employee_off_days(employee_id,effective_from,days,created_by) VALUES(${String(created[0].id)}::uuid,'2000-01-01',${offNew},${me.id}::uuid) ON CONFLICT(employee_id,effective_from) DO UPDATE SET days=EXCLUDED.days`}}
 await sql`INSERT INTO changes(topic) VALUES('employees')`;return ok({ok:true},201);
}
if(path==='employee'&&req.method==='POST'){
 if(!need('employees'))return fail('Permission required',403);
 const id=String(body.id||''),status=String(body.status||''),branchId=String(body.branchId||'');if(!['active','pending','suspended'].includes(status))return fail('Invalid status');
 if(branchId){const allowed=await sql`SELECT id FROM branches WHERE id=${branchId}::uuid LIMIT 1`;if(!allowed.length)return fail('Unknown branch')};
 await sql`UPDATE employees SET status=${status},branch_id=CASE WHEN ${branchId}='' THEN branch_id ELSE ${branchId||null}::uuid END WHERE id=${id}::uuid`;await sql`INSERT INTO changes(topic) VALUES('employees')`;return ok({ok:true});
}
if(path==='branch'&&req.method==='POST'){
 if(!need('branches'))return fail('Permission required',403);const name=String(body.name||'').trim();if(!name)return fail('Name required');
 await sql`INSERT INTO branches(name) VALUES (${name})`;await sql`INSERT INTO changes(topic) VALUES('branches')`;return ok({ok:true});
}
if(path==='manage'&&req.method==='POST'){
 if(!isAll)return fail('Permission required',403);
 const kind=String(body.kind||''),action=String(body.action||''),id=String(body.id||'');
 if(!['branch','geofence','employee','request','attendance'].includes(kind)||!['edit','delete'].includes(action))return fail('Invalid action');
 const kindPage:Record<string,string>={branch:'branches',geofence:'geofences',employee:'employees',request:'requests',attendance:'employees'};
 if(!need(kindPage[kind]))return fail('Permission required',403);
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))return fail('Invalid ID');
 if(kind==='employee'&&!isFull){const t=await sql`SELECT role FROM employees WHERE id=${id}::uuid`;if(t[0]?.role==='admin')return fail('Only administrators can change administrator accounts',403)}
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
   // Permanent delete: removes the employee and every associated record, even when history exists.
   const target=await sql`SELECT id,public_id,name,email,role,avatar FROM employees WHERE id=${id}::uuid`;
   if(!target.length)return fail('Employee not found',404);
   if(String(target[0].role)==='admin'){
    const admins=await sql`SELECT COUNT(*)::int AS n FROM employees WHERE role='admin' AND id<>${id}::uuid`;
    if(Number(admins[0].n)<1)return fail('You cannot delete the last administrator account',409);
   }
   await sql.transaction([
    sql`DELETE FROM attendance_break_periods WHERE session_id IN (SELECT id FROM attendance_sessions WHERE employee_id=${id}::uuid)`,
    sql`DELETE FROM attendance_sessions WHERE employee_id=${id}::uuid`,
    sql`DELETE FROM attendance_failures WHERE employee_id=${id}::uuid`,
    sql`DELETE FROM attendance_manual_audit WHERE employee_id=${id}::uuid`,
    sql`UPDATE attendance_manual_audit SET admin_id=${me.id}::uuid WHERE admin_id=${id}::uuid`,
    sql`DELETE FROM attendance_change_audit WHERE employee_id=${id}::uuid`,
    sql`UPDATE attendance_change_audit SET admin_id=${me.id}::uuid WHERE admin_id=${id}::uuid`,
    sql`DELETE FROM requests WHERE employee_id=${id}::uuid`,
    sql`DELETE FROM employee_leaves WHERE employee_id=${id}::uuid`,
    sql`UPDATE employee_leaves SET created_by=${me.id}::uuid WHERE created_by=${id}::uuid`,
    sql`DELETE FROM device_alerts WHERE employee_id=${id}::uuid`,
    sql`DELETE FROM employee_devices WHERE employee_id=${id}::uuid`,
    sql`DELETE FROM notifications WHERE recipient_id=${id}::uuid`,
    sql`DELETE FROM admin_message_recipients WHERE employee_id=${id}::uuid`,
    sql`UPDATE admin_messages SET created_by=${me.id}::uuid WHERE created_by=${id}::uuid`,
    sql`DELETE FROM employee_schedule_history WHERE employee_id=${id}::uuid`,
    sql`DELETE FROM employees WHERE id=${id}::uuid`
   ]);
   try{const {client,url,bucket}=storageClient();const oldPath=getSupabaseAvatarPath(String(target[0].avatar||''),url,bucket,id);if(oldPath)await client.storage.from(bucket).remove([oldPath])}catch{/* avatar cleanup is best-effort */}
   await sql`INSERT INTO changes(topic) VALUES('employees')`;await sql`INSERT INTO changes(topic) VALUES('attendance')`;await sql`INSERT INTO changes(topic) VALUES('requests')`;
   return ok({ok:true,deleted:{name:String(target[0].name),email:String(target[0].email),public_id:String(target[0].public_id||'')}});
  }else{
   const name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase(),status=String(body.status||''),role=String(body.role||'');
   if(name.length<2||!email.includes('@')||!['pending','active','suspended'].includes(status)||!role)return fail('Invalid employee information');
   const requiredHours=body.requiredDailyHours===null||String(body.requiredDailyHours??'').trim()===''?null:Number(body.requiredDailyHours),shiftId=String(body.shiftId||'');
 const variableOvernightShift=body.variableOvernightShift===true||body.variableOvernightShift==='true';
   if(requiredHours!==null&&(!Number.isFinite(requiredHours)||requiredHours<=0||requiredHours>24))return fail('Working hours must be greater than 0 and at most 24');
   if(shiftId && !(await sql`SELECT id FROM shifts WHERE id=${shiftId}::uuid`).length)return fail('Shift not found');
   const flagOf=(k:string)=>k in body?(body[k]===true||body[k]==='true'):null;
   const hasHours='maxCheckinHours' in body,hoursRaw=String(body.maxCheckinHours??'').trim(),hoursVal=hoursRaw===''?null:Number(hoursRaw);
   const maxEnabledNew=flagOf('maxCheckinEnabled');
   if(hasHours&&hoursVal!==null&&(!Number.isFinite(hoursVal)||hoursVal<=0||hoursVal>72))return fail('Maximum Check-in Duration must be between 0.5 and 72 hours');
   if(maxEnabledNew===true&&(!hasHours||hoursVal===null))return fail('Enter the Maximum Check-in Duration (hours) to enable it');
   if(!(await sql`SELECT 1 FROM role_access WHERE role=${role}`).length)return fail('Unknown role');
   const targetRow=await sql`SELECT role FROM employees WHERE id=${id}::uuid`;
   if(!targetRow.length)return fail('Employee not found',404);
   if(!isFull&&(role==='admin'||targetRow[0].role==='admin'))return fail('Only administrators can change administrator accounts',403);
   await sql`UPDATE employees SET name=${name},email=${email},status=${status},role=${role},branch_id=${body.branchId||null}::uuid,required_daily_hours=${requiredHours},shift_id=${shiftId||null}::uuid,variable_overnight_shift=${variableOvernightShift},allow_outside_geofence=COALESCE(${flagOf('allowOutsideGeofence')}::boolean,allow_outside_geofence),allow_multiple_devices=COALESCE(${flagOf('allowMultipleDevices')}::boolean,allow_multiple_devices),max_checkin_enabled=COALESCE(${maxEnabledNew}::boolean,max_checkin_enabled),max_checkin_hours=CASE WHEN ${hasHours} THEN ${hoursVal}::numeric ELSE max_checkin_hours END WHERE id=${id}::uuid`;
   if('offDays' in body){
    const offNew=parseOffDays(body.offDays);
    const cur=await sql`SELECT days FROM employee_off_days WHERE employee_id=${id}::uuid AND effective_from<=(now() AT TIME ZONE 'Asia/Qatar')::date ORDER BY effective_from DESC LIMIT 1`;
    const curDays=(cur[0]?.days as number[]|undefined)||[];
    if(JSON.stringify(curDays)!==JSON.stringify(offNew))await sql`INSERT INTO employee_off_days(employee_id,effective_from,days,created_by) VALUES(${id}::uuid,(now() AT TIME ZONE 'Asia/Qatar')::date,${offNew},${me.id}::uuid) ON CONFLICT(employee_id,effective_from) DO UPDATE SET days=EXCLUDED.days`;
   }
   if(body.password){const pw=String(body.password);if(pw.length<6)return fail('Password must be 6+ characters');const hash=await bcrypt.hash(pw,12);await sql`UPDATE employees SET password_hash=${hash},password_view=${sealPassword(pw)},must_change_password=true WHERE id=${id}::uuid`}
  }
 }
 if(kind==='request'){
  if(action==='delete')await sql`DELETE FROM requests WHERE id=${id}::uuid`;
  else{const note=String(body.note||'').trim(),status=String(body.status||''),sd=String(body.startDate||''),ed=String(body.endDate||'');
   if(!note||!['pending','approved','rejected','cancelled'].includes(status))return fail('Invalid request');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(sd)||!/^\d{4}-\d{2}-\d{2}$/.test(ed)||!Number.isFinite(Date.parse(sd))||!Number.isFinite(Date.parse(ed))||sd>ed)return fail('Provide a valid date range');
   if(Math.round((Date.parse(ed)-Date.parse(sd))/86400000)>365)return fail('Date range is too long');
   const before=await sql`SELECT employee_id,status,start_date::text AS start_date,end_date::text AS end_date FROM requests WHERE id=${id}::uuid`;
   if(!before.length)return fail('Request not found',404);
   await sql`UPDATE requests SET note=${note},status=${status},start_date=${sd}::date,end_date=${ed}::date WHERE id=${id}::uuid`;
   const changed=String(before[0].start_date)!==sd||String(before[0].end_date)!==ed||String(before[0].status)!==status;
   if(changed)await sql`INSERT INTO notifications(recipient_id,title,message) VALUES(${before[0].employee_id}::uuid,'Request updated',${'Your request is now '+status+' for '+sd+' to '+ed})`}
 }
 if(kind==='attendance'){
  const reason=String(body.reason||'').trim();if(reason.length<5||reason.length>500)return fail('Provide a reason (5–500 characters)');
  await sql`CREATE TABLE IF NOT EXISTS attendance_change_audit (id BIGSERIAL PRIMARY KEY, session_id UUID NOT NULL, employee_id UUID NOT NULL, admin_id UUID NOT NULL, action TEXT NOT NULL, old_values JSONB NOT NULL, new_values JSONB, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  const before=await sql`SELECT id,employee_id,check_in,check_out,break_seconds,missed_checkout FROM attendance_sessions WHERE id=${id}::uuid LIMIT 1`;
  if(!before.length)return fail('Attendance session not found',404);
  if(action==='delete'){
   await sql`INSERT INTO attendance_change_audit(session_id,employee_id,admin_id,action,old_values,reason) VALUES(${id}::uuid,${before[0].employee_id}::uuid,${me.id}::uuid,'delete',${JSON.stringify(before[0])}::jsonb,${reason})`;
   await sql`DELETE FROM attendance_break_periods WHERE session_id=${id}::uuid`;
   await sql`DELETE FROM attendance_sessions WHERE id=${id}::uuid`;
  }else{
   const parseLocal=(v:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)?new Date(v+':00+03:00'):new Date(v);
   const checkInRaw=String(body.check_in||''),checkOutRaw=String(body.check_out||'');const ci=parseLocal(checkInRaw),co=checkOutRaw?parseLocal(checkOutRaw):null;
   if(!Number.isFinite(ci.getTime())||(co&&(!Number.isFinite(co.getTime())||co.getTime()<=ci.getTime())))return fail('Invalid attendance times');
   const newValues={check_in:ci.toISOString(),check_out:co?.toISOString()||null};
   await sql`INSERT INTO attendance_change_audit(session_id,employee_id,admin_id,action,old_values,new_values,reason) VALUES(${id}::uuid,${before[0].employee_id}::uuid,${me.id}::uuid,'edit',${JSON.stringify(before[0])}::jsonb,${JSON.stringify(newValues)}::jsonb,${reason})`;
   await sql`UPDATE attendance_sessions SET check_in=${newValues.check_in}::timestamptz,check_out=${newValues.check_out}::timestamptz,missed_checkout=false,expired_absent=false,break_started_at=NULL WHERE id=${id}::uuid`;
  }
 }
 await sql`INSERT INTO changes(topic) VALUES(${kind})`;return ok({ok:true});
}
if(path==='geofence'&&req.method==='POST'){
 if(!need('geofences'))return fail('Permission required',403);
 const name=String(body.name||'').trim(),branch=String(body.branchId||'');if(!name||!validPoly(body.polygon)||!branch)return fail('Name, branch and polygon (3+ valid coordinates) are required');
 const polygon=JSON.stringify(body.polygon);await sql`INSERT INTO geofences(name,branch_id,polygon) VALUES (${name},${branch}::uuid,${polygon}::jsonb)`;await sql`INSERT INTO changes(topic) VALUES('geofences')`;return ok({ok:true});
}
if(path==='manual-attendance'&&req.method==='POST'){
 if(!need('employees'))return fail('Permission required',403);
 const employeeId=String(body.employeeId||'');const reason=String(body.reason||'').trim();
 const start=String(body.checkIn||'');const end=String(body.checkOut||'');
 const breakMinutes=Number(body.breakMinutes||0);
 if(!/^[0-9a-f-]{36}$/i.test(employeeId))return fail('Select an employee');
 if(reason.length<5||reason.length>500)return fail('Provide a reason (5–500 characters)');
 // datetime-local values are interpreted in the company's Qatar time zone (UTC+03:00).
 const parseQatar=(v:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)?new Date(v+':00+03:00'):new Date(NaN);
 const startDate=parseQatar(start),endDate=parseQatar(end);
 const elapsed=(endDate.getTime()-startDate.getTime())/60000;
 if(!Number.isFinite(elapsed)||elapsed<=0||elapsed>24*60||startDate.getTime()>Date.now()+60000)return fail('Valid shift times required (maximum 24 hours)');
 if(!Number.isFinite(breakMinutes)||breakMinutes<0||breakMinutes>=elapsed)return fail('Break must be shorter than the shift');
 const employees=await sql`SELECT branch_id,status FROM employees WHERE id=${employeeId}::uuid`;
 if(!employees.length||!employees[0].branch_id)return fail('Employee must be assigned to a branch');
 const overlaps=await sql`SELECT id FROM attendance_sessions WHERE employee_id=${employeeId}::uuid AND check_in<${endDate.toISOString()}::timestamptz AND (check_out IS NULL OR check_out>${startDate.toISOString()}::timestamptz) LIMIT 1`;
 if(overlaps.length)return fail('Attendance overlaps an existing session',409);
 await sql`INSERT INTO attendance_sessions(employee_id,branch_id,check_in,check_out,break_seconds) VALUES(${employeeId}::uuid,${String(employees[0].branch_id)}::uuid,${startDate.toISOString()}::timestamptz,${endDate.toISOString()}::timestamptz,${Math.round(breakMinutes*60)})`;
 await sql`INSERT INTO attendance_manual_audit(employee_id,admin_id,check_in,check_out,break_minutes,reason) VALUES(${employeeId}::uuid,${me.id}::uuid,${startDate.toISOString()}::timestamptz,${endDate.toISOString()}::timestamptz,${breakMinutes},${reason})`;
 await sql`INSERT INTO changes(topic) VALUES('attendance')`;
 return ok({ok:true});
}
if(path==='attendance'&&req.method==='POST'){
 await expireStaleDaySessions(sql);
 if(me.role==='admin'||me.role==='display'||await roleIsAllScope(sql,me.role))return fail('Attendance punches are available to employees only',403);
 const dgate=await deviceGate(sql,req,{id:me.id,role:me.role,name:me.name},'punch');
 if(!dgate.ok){const r=endedSession(dgate.relogin?'Your session ended. Sign in again to register this device.':'This device is not registered for your account. Your administrator has been notified.');return dgate.token?setDeviceCookie(r,dgate.token):r}
 // Keep a deployed database compatible when an intermediate release was skipped.
 // These are additive, idempotent changes; existing attendance records are preserved.
 await sql.query('ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS break_seconds INTEGER NOT NULL DEFAULT 0');
 await sql.query('ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS break_started_at TIMESTAMPTZ');
 await sql.query('CREATE TABLE IF NOT EXISTS attendance_break_periods(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,started_at TIMESTAMPTZ NOT NULL,ended_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now())');

 const onBreak=await sql`SELECT 1 FROM attendance_sessions WHERE employee_id=${me.id}::uuid AND check_out IS NULL AND break_started_at IS NOT NULL LIMIT 1`;
 if(onBreak.length)return fail('You are on break. End your break before checking out.',409);
 const lat=Number(body.lat),lon=Number(body.lon),accuracy=Number(body.accuracy);if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>180||!Number.isFinite(accuracy)||accuracy<0)return fail('GPS location unavailable or invalid');
 const user=await sql`SELECT branch_id,allow_outside_geofence,max_checkin_enabled,max_checkin_hours FROM employees WHERE id=${me.id}::uuid`;const branch=user[0]?.branch_id||null;
 const outsideAllowed=user[0]?.allow_outside_geofence===true;
 const maxHours=user[0]?.max_checkin_enabled===true&&Number(user[0]?.max_checkin_hours)>0?Number(user[0].max_checkin_hours):null;
 const openNow=await sql`SELECT 1 FROM attendance_sessions WHERE employee_id=${me.id}::uuid AND check_out IS NULL LIMIT 1`;
 const attemptAction=openNow.length?'check-out':'check-in';
 const logFail=async(reason:string,distance:number|null)=>{try{await sql`INSERT INTO attendance_failures(employee_id,branch_id,action,reason,lat,lon,accuracy,distance_m) VALUES(${me.id}::uuid,${branch}::uuid,${attemptAction},${reason},${lat},${lon},${accuracy},${distance})`;await sql`INSERT INTO changes(topic) VALUES('attendance-failure')`}catch{}};
 if(accuracy>150){await logFail('Low GPS accuracy ('+Math.round(accuracy)+' m)',null);return fail('GPS accuracy is '+Math.round(accuracy)+'m. Move outdoors or enable precise location; maximum is 150m',422)}
 if(!branch){await logFail('No branch assigned',null);return fail('Administrator must assign your branch')}
 const fences=await sql`SELECT polygon FROM geofences WHERE branch_id=${branch}::uuid AND active=true`;
 let outside=false;
 if(outsideAllowed){
  // Per-employee permission: punches are accepted anywhere, but we remember when it happened outside the zone.
  outside=!fences.some(f=>inPoly(lon,lat,f.polygon as number[][]));
 }else{
  if(!fences.length){await logFail('No active geofence for branch',null);return fail('No active geofence is assigned to your branch',403)}
  if(!fences.some(f=>inPoly(lon,lat,f.polygon as number[][]))){
   const dist=Math.min(...fences.map(f=>distToPolygonM(lon,lat,f.polygon as number[][])));
   await logFail('Outside allowed area',Number.isFinite(dist)?dist:null);
   return fail('You are outside the allowed areas. You are '+fmtDistance(dist)+' away from the nearest allowed location.',403);
  }
 }
 // Use an atomic update and a unique open-session index to prevent overlapping sessions.
 await sql`UPDATE attendance_break_periods SET ended_at=now() WHERE session_id IN (SELECT id FROM attendance_sessions WHERE employee_id=${me.id}::uuid AND check_out IS NULL) AND ended_at IS NULL`;
 const closed=await sql`UPDATE attendance_sessions SET check_out=now(),out_lat=${lat},out_lon=${lon},break_seconds=break_seconds+CASE WHEN break_started_at IS NOT NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (now()-break_started_at)))::integer ELSE 0 END,break_started_at=NULL WHERE employee_id=${me.id}::uuid AND check_out IS NULL RETURNING id`;
 if(closed.length){await sql`INSERT INTO changes(topic) VALUES('attendance')`;return ok({action:'checkout',outside})}
 try{await sql`INSERT INTO attendance_sessions(employee_id,branch_id,in_lat,in_lon,max_hours_snapshot) VALUES (${me.id}::uuid,${branch}::uuid,${lat},${lon},${maxHours})`}
 catch(e){if(String(e).includes('unique'))return fail('You already have an active session',409);throw e}
 await sql`INSERT INTO changes(topic) VALUES('attendance')`;return ok({action:'checkin',outside});
}
if(path==='request'&&req.method==='POST'){
 const isAdministrator=String(current[0].role)==='admin';
 const targetEmployeeId=isAdministrator?String(body.employeeId||''):String(me.id);
 if(!/^[0-9a-f-]{36}$/i.test(targetEmployeeId))return fail('Select a valid employee for this request');
 const targetEmployee=await sql`SELECT id,role,status FROM employees WHERE id=${targetEmployeeId}::uuid LIMIT 1`;
 if(!targetEmployee.length||['admin','display'].includes(String(targetEmployee[0].role)))return fail('Requests can only be created for employees');
 if(!isAdministrator&&targetEmployeeId!==String(me.id))return fail('You can only submit your own request',403);
 const kind=String(body.kind||''),note=String(body.note||'').trim(),startDate=String(body.startDate||''),endDate=String(body.endDate||'');
 if(note.length<3)return fail('Provide a reason (at least 3 characters)');
 const categoryExists=await sql`SELECT id FROM request_categories WHERE lower(name)=lower(${kind}) AND active=true LIMIT 1`;
 if(!categoryExists.length)return fail('Choose an active request category');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||!Number.isFinite(Date.parse(startDate))||!Number.isFinite(Date.parse(endDate))||startDate>endDate)return fail('Provide a valid date range');
 const span=Math.round((Date.parse(endDate)-Date.parse(startDate))/86400000);if(span>365)return fail('Date range is too long');
 await sql`INSERT INTO requests(employee_id,kind,note,start_date,end_date) VALUES (${targetEmployeeId}::uuid,${kind},${note},${startDate}::date,${endDate}::date)`;
 const admins=await sql`SELECT id FROM employees WHERE role='admin' AND status='active'`;
 for(const admin of admins)await sql`INSERT INTO notifications(recipient_id,title,message) VALUES(${admin.id}::uuid,'New employee request',${kind+' request received for '+startDate+' to '+endDate})`;
 if(isAdministrator)await sql`INSERT INTO notifications(recipient_id,title,message) VALUES(${targetEmployeeId}::uuid,'Request created for you',${'Your administrator created a '+kind+' request for '+startDate+' to '+endDate})`;
 await sql`INSERT INTO changes(topic) VALUES('requests')`;return ok({ok:true});
}
if(path==='activity-log'&&req.method==='GET'){
 if(!need('activity-log'))return fail('Permission required',403);
 const url=new URL(req.url);
 const q=(url.searchParams.get('q')||'').trim().slice(0,60),action=(url.searchParams.get('action')||'').slice(0,60),before=Number(url.searchParams.get('before')||0)||0;
 const like='%'+q.replace(/[\\%_]/g,m=>'\\'+m)+'%';
 const rows=await sql`SELECT id,actor_id,actor_name,actor_role,action,target,detail,lat,lon,accuracy,ip,device,created_at FROM activity_log WHERE (${before}::bigint=0 OR id<${before}::bigint) AND (${action}='' OR action=${action}) AND (${q}='' OR actor_name ILIKE ${like} OR detail ILIKE ${like} OR target ILIKE ${like}) ORDER BY id DESC LIMIT 51`;
 const actions=await sql`SELECT DISTINCT action FROM activity_log ORDER BY action LIMIT 100`;
 return ok({rows:rows.slice(0,50),hasMore:rows.length>50,actions:actions.map(r=>String(r.action))});
}
if(path==='devices'&&req.method==='GET'){
 if(!need('devices'))return fail('Permission required',403);
 const cfg=await sql`SELECT device_lock FROM app_settings WHERE id=1`;
 const devices=await sql`SELECT d.employee_id,e.name,e.email,d.label,d.info,d.ip,d.bound_at,d.last_seen FROM employee_devices d JOIN employees e ON e.id=d.employee_id ORDER BY e.name LIMIT 500`;
 const alerts=await sql`SELECT a.id,a.employee_id,e.name,a.label,a.info,a.ip,a.context,a.status,a.created_at,rd.label AS registered_label,rd.info AS registered_info FROM device_alerts a JOIN employees e ON e.id=a.employee_id LEFT JOIN employee_devices rd ON rd.employee_id=a.employee_id ORDER BY CASE a.status WHEN 'open' THEN 0 ELSE 1 END,a.created_at DESC LIMIT 100`;
 const mm=await sql`SELECT device_match_mode FROM app_settings WHERE id=1`;
 return ok({enabled:cfg[0]?.device_lock!==false,matchMode:mm[0]?.device_match_mode||'flexible',devices,alerts});
}
if(path==='devices'&&req.method==='POST'){
 if(!need('devices'))return fail('Permission required',403);
 const action=String(body.action||'');const uuid=/^[0-9a-f-]{36}$/i;
 if(action==='toggle'){if(!isFull)return fail('Admin only',403);await sql`UPDATE app_settings SET device_lock=${body.enabled===true} WHERE id=1`;await sql`INSERT INTO changes(topic) VALUES('devices')`;return ok({ok:true})}
 if(action==='match-mode'){if(!isFull)return fail('Admin only',403);const m=body.mode==='strict'?'strict':'flexible';await sql`UPDATE app_settings SET device_match_mode=${m} WHERE id=1`;await sql`INSERT INTO changes(topic) VALUES('devices')`;return ok({ok:true})}
 if(action==='reset'){const id=String(body.employeeId||'');if(!uuid.test(id))return fail('Invalid employee');await sql`DELETE FROM employee_devices WHERE employee_id=${id}::uuid`;await sql`UPDATE device_alerts SET status='dismissed' WHERE employee_id=${id}::uuid AND status='open'`;await sql`INSERT INTO changes(topic) VALUES('devices')`;return ok({ok:true})}
 if(action==='approve'||action==='dismiss'){
  const id=String(body.alertId||'');if(!uuid.test(id))return fail('Invalid alert');
  const al=await sql`SELECT employee_id,attempted_hash,label,user_agent,ip,info FROM device_alerts WHERE id=${id}::uuid`;if(!al.length)return fail('Alert not found',404);
  if(action==='approve'){
   await sql`INSERT INTO employee_devices(employee_id,device_hash,label,user_agent,ip,info) VALUES(${al[0].employee_id}::uuid,${al[0].attempted_hash},${al[0].label},${al[0].user_agent},${al[0].ip},${JSON.stringify(al[0].info||{})}::jsonb) ON CONFLICT (employee_id) DO UPDATE SET device_hash=EXCLUDED.device_hash,label=EXCLUDED.label,user_agent=EXCLUDED.user_agent,ip=EXCLUDED.ip,info=EXCLUDED.info,bound_at=now(),last_seen=now()`;
   await sql`UPDATE device_alerts SET status=CASE WHEN id=${id}::uuid THEN 'approved' ELSE 'dismissed' END WHERE employee_id=${al[0].employee_id}::uuid AND status='open'`;
  }else await sql`UPDATE device_alerts SET status='dismissed' WHERE id=${id}::uuid`;
  await sql`INSERT INTO changes(topic) VALUES('devices')`;return ok({ok:true});
 }
 return fail('Invalid action');
}
if(path==='attendance-failures'&&req.method==='GET'){
 if(!need('failed-attempts'))return fail('Permission required',403);
 const failures=await sql`SELECT f.id,f.employee_id,e.name,b.name AS branch_name,f.action,f.reason,f.lat,f.lon,f.accuracy,f.distance_m,f.created_at FROM attendance_failures f JOIN employees e ON e.id=f.employee_id LEFT JOIN branches b ON b.id=f.branch_id ORDER BY f.created_at DESC LIMIT 300`;
 return ok({failures});
}
if(path==='attendance-failures'&&req.method==='POST'){
 if(!isFull)return fail('Admin only',403);
 if(body.all===true){await sql`DELETE FROM attendance_failures`;return ok({ok:true})}
 const fid=String(body.id||'');if(!/^[0-9a-f-]{36}$/i.test(fid))return fail('Invalid ID');
 await sql`DELETE FROM attendance_failures WHERE id=${fid}::uuid`;return ok({ok:true});
}
if(path==='employee-password'&&req.method==='POST'){
 if(!isFull)return fail('Only administrators can view passwords',403);
 const id=String(body.id||'');if(!/^[0-9a-f-]{36}$/i.test(id))return fail('Invalid employee');
 const r=await sql`SELECT password_view FROM employees WHERE id=${id}::uuid`;if(!r.length)return fail('Employee not found',404);
 return ok({password:openPassword(r[0].password_view as string|null)});
}
if(path==='day-control'&&req.method==='POST'){
 if(!need('day-control'))return fail('Permission required',403);
 const action=String(body.action||'');const empId=String(body.employeeId||'');
 if(action==='set-offdays-bulk'||action==='set-days-bulk'){
  const okDate=(v:unknown)=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))&&!Number.isNaN(Date.parse(String(v)+'T00:00:00Z'));
  const ids=Array.from(new Set((Array.isArray(body.employeeIds)?(body.employeeIds as unknown[]):[]).map(x=>String(x)))).filter(x=>/^[0-9a-f-]{36}$/i.test(x));
  if(!ids.length||ids.length>300)return fail('Select between 1 and 300 employees');
  const found=await sql`SELECT id FROM employees WHERE id=ANY(${ids}::uuid[]) AND role NOT IN ('admin','display')`;
  let targets=found.map(f=>String(f.id));
  if(!targets.length)return fail('No valid employees selected');
  if(action==='set-offdays-bulk'){
   const eff=String(body.effectiveFrom||'');if(!okDate(eff)||eff<'2000-01-01'||eff>'2100-12-31')return fail('Choose a valid date');
   const offNew=parseOffDays(body.days);
   await sql.transaction([
    sql`DELETE FROM employee_off_days WHERE employee_id=ANY(${targets}::uuid[]) AND effective_from>${eff}::date`,
    sql`INSERT INTO employee_off_days(employee_id,effective_from,days,created_by) SELECT x,${eff}::date,${offNew}::smallint[],${me.id}::uuid FROM unnest(${targets}::uuid[]) AS x ON CONFLICT(employee_id,effective_from) DO UPDATE SET days=EXCLUDED.days`
   ]);
   await sql`INSERT INTO changes(topic) VALUES('attendance')`;return ok({ok:true,count:targets.length,skipped:0});
  }
  const dates:string[]=Array.from(new Set((Array.isArray(body.dates)?(body.dates as unknown[]):[]).map(x=>String(x)))).sort();
  if(!dates.length||dates.length>62||!dates.every(okDate))return fail('Select between 1 and 62 valid days');
  const status=String(body.status||'');if(!['off','work','leave','sick','clear'].includes(status))return fail('Invalid status');
  const blocked=await sql`SELECT DISTINCT employee_id FROM employee_leaves WHERE employee_id=ANY(${targets}::uuid[]) AND start_date<end_date AND start_date<=${dates[dates.length-1]}::date AND end_date>=${dates[0]}::date`;
  const blockedSet=new Set(blocked.map(b=>String(b.employee_id)));
  const total=targets.length;targets=targets.filter(t=>!blockedSet.has(t));
  if(!targets.length)return fail('All selected employees have a multi-day leave in this period. Edit those leaves from Employee Leaves first.',409);
  const q:any[]=[
   sql`DELETE FROM employee_day_overrides WHERE employee_id=ANY(${targets}::uuid[]) AND day=ANY(${dates}::date[])`,
   sql`DELETE FROM employee_leaves WHERE employee_id=ANY(${targets}::uuid[]) AND start_date=end_date AND start_date=ANY(${dates}::date[])`
  ];
  if(status==='off'||status==='work')q.push(sql`INSERT INTO employee_day_overrides(employee_id,day,kind,created_by) SELECT e,d,${status},${me.id}::uuid FROM unnest(${targets}::uuid[]) AS e CROSS JOIN unnest(${dates}::date[]) AS d`);
  if(status==='leave'||status==='sick')q.push(sql`INSERT INTO employee_leaves(employee_id,start_date,end_date,leave_type,notes,created_by) SELECT e,d,d,${status==='sick'?'Sick Leave':'Leave'},'Set by administrator from Day Control (bulk)',${me.id}::uuid FROM unnest(${targets}::uuid[]) AS e CROSS JOIN unnest(${dates}::date[]) AS d`);
  await sql.transaction(q);
  await sql`INSERT INTO changes(topic) VALUES('attendance')`;return ok({ok:true,count:targets.length,skipped:total-targets.length});
 }
 if(!/^[0-9a-f-]{36}$/i.test(empId))return fail('Select an employee');
 const emp=await sql`SELECT id,name,public_id,role FROM employees WHERE id=${empId}::uuid`;
 if(!emp.length)return fail('Employee not found',404);
 if(['admin','display'].includes(String(emp[0].role)))return fail('Day control applies to employees only');
 const dateOk=(v:unknown)=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))&&!Number.isNaN(Date.parse(String(v)+'T00:00:00Z'));
 if(action==='load'){
  const month=String(body.month||'');if(!/^\d{4}-\d{2}$/.test(month))return fail('Invalid month');
  const first=month+'-01';
  const [history,overrides,leaves,days,today]=await Promise.all([
   sql`SELECT effective_from::text AS effective_from,days FROM employee_off_days WHERE employee_id=${empId}::uuid ORDER BY effective_from`,
   sql`SELECT day::text AS day,kind FROM employee_day_overrides WHERE employee_id=${empId}::uuid AND day>=${first}::date AND day<(${first}::date+INTERVAL '1 month')`,
   sql`SELECT id,start_date::text AS start_date,end_date::text AS end_date,leave_type FROM employee_leaves WHERE employee_id=${empId}::uuid AND start_date<(${first}::date+INTERVAL '1 month') AND end_date>=${first}::date`,
   sql`SELECT (check_in AT TIME ZONE 'Asia/Qatar')::date::text AS day,COUNT(*)::int AS n,COUNT(*) FILTER (WHERE expired_absent)::int AS absent FROM attendance_sessions WHERE employee_id=${empId}::uuid AND check_in>=(${first}::date::timestamp AT TIME ZONE 'Asia/Qatar') AND check_in<((${first}::date+INTERVAL '1 month')::timestamp AT TIME ZONE 'Asia/Qatar') GROUP BY 1`,
   sql`SELECT ((now() AT TIME ZONE 'Asia/Qatar')::date)::text AS d`
  ]);
  return ok({employee:{id:emp[0].id,name:emp[0].name,public_id:emp[0].public_id},history,overrides,leaves,days,today:today[0].d});
 }
 if(action==='set-offdays'){
  const eff=String(body.effectiveFrom||'');if(!dateOk(eff))return fail('Choose a valid date');
  if(eff<'2000-01-01'||eff>'2100-12-31')return fail('Choose a valid date');
  const offNew=parseOffDays(body.days);
  // From the chosen date the schedule is the new one: later schedule changes are replaced.
  await sql.transaction([
   sql`DELETE FROM employee_off_days WHERE employee_id=${empId}::uuid AND effective_from>${eff}::date`,
   sql`INSERT INTO employee_off_days(employee_id,effective_from,days,created_by) VALUES(${empId}::uuid,${eff}::date,${offNew},${me.id}::uuid) ON CONFLICT(employee_id,effective_from) DO UPDATE SET days=EXCLUDED.days`
  ]);
  await sql`INSERT INTO changes(topic) VALUES('attendance')`;return ok({ok:true});
 }
 if(action==='set-days'){
  const dates:string[]=Array.isArray(body.dates)?Array.from(new Set((body.dates as unknown[]).map(x=>String(x)))):[];
  if(!dates.length||dates.length>62||!dates.every(dateOk))return fail('Select between 1 and 62 valid days');
  const status=String(body.status||'');if(!['off','work','leave','sick','clear'].includes(status))return fail('Invalid status');
  const covered=await sql`SELECT start_date::text AS s,end_date::text AS e FROM employee_leaves WHERE employee_id=${empId}::uuid AND start_date<end_date AND start_date<=${dates[dates.length-1]}::date AND end_date>=${dates[0]}::date`;
  for(const dt of dates){if(covered.some(c=>String(c.s)<=dt&&dt<=String(c.e)))return fail(dt+' is inside a multi-day leave. Edit that leave from Employee Leaves first.',409)}
  const q:any[]=[];
  for(const dt of dates){
   q.push(sql`DELETE FROM employee_day_overrides WHERE employee_id=${empId}::uuid AND day=${dt}::date`);
   q.push(sql`DELETE FROM employee_leaves WHERE employee_id=${empId}::uuid AND start_date=${dt}::date AND end_date=${dt}::date`);
   if(status==='off'||status==='work')q.push(sql`INSERT INTO employee_day_overrides(employee_id,day,kind,created_by) VALUES(${empId}::uuid,${dt}::date,${status},${me.id}::uuid)`);
   if(status==='leave'||status==='sick')q.push(sql`INSERT INTO employee_leaves(employee_id,start_date,end_date,leave_type,notes,created_by) VALUES(${empId}::uuid,${dt}::date,${dt}::date,${status==='sick'?'Sick Leave':'Leave'},'Set by administrator from Day Control',${me.id}::uuid)`);
  }
  await sql.transaction(q);
  await sql`INSERT INTO changes(topic) VALUES('attendance')`;return ok({ok:true,count:dates.length});
 }
 return fail('Unknown action');
}
if(path==='request-cancel'&&req.method==='POST'){
 const id=String(body.id||'');if(!/^[0-9a-f-]{36}$/i.test(id))return fail('Invalid request');
 const row=await sql`SELECT r.employee_id,r.kind,r.status,e.name FROM requests r JOIN employees e ON e.id=r.employee_id WHERE r.id=${id}::uuid`;
 if(!row.length)return fail('Request not found',404);
 const own=String(row[0].employee_id)===String(me.id);
 if(!own&&!need('requests'))return fail('You can only cancel your own requests',403);
 if(String(row[0].status)!=='pending')return fail('Only pending requests can be cancelled',409);
 await sql`UPDATE requests SET status='cancelled' WHERE id=${id}::uuid`;
 if(own){const admins=await sql`SELECT id FROM employees WHERE role='admin' AND status='active'`;for(const ad of admins)await sql`INSERT INTO notifications(recipient_id,title,message) VALUES(${ad.id}::uuid,'Request cancelled',${String(row[0].name)+' cancelled a '+String(row[0].kind)+' request'})`}
 else await sql`INSERT INTO notifications(recipient_id,title,message) VALUES(${String(row[0].employee_id)}::uuid,'Request cancelled','Your request was cancelled by an administrator')`;
 await sql`INSERT INTO changes(topic) VALUES('requests')`;return ok({ok:true});
}
if(path==='review'&&req.method==='POST'){
 if(!need('requests'))return fail('Permission required',403);const status=String(body.status||'');if(!['approved','rejected'].includes(status))return fail('Invalid status');
 const reqRow=await sql`SELECT status FROM requests WHERE id=${String(body.id)}::uuid`;if(!reqRow.length)return fail('Request not found',404);if(String(reqRow[0].status)==='cancelled')return fail('A cancelled request cannot be approved or rejected',409);
 await sql`UPDATE requests SET status=${status} WHERE id=${String(body.id)}::uuid`; const recipient=await sql`SELECT employee_id FROM requests WHERE id=${String(body.id)}::uuid`; if(recipient.length)await sql`INSERT INTO notifications(recipient_id,title,message) VALUES(${recipient[0].employee_id}::uuid,'Request updated',${'Your request was '+status})`;await sql`INSERT INTO changes(topic) VALUES('requests')`; return ok({ok:true});
}
return fail('Not found',404)
}catch(e){const message=e instanceof Error?e.message:'Server error';console.error('API error', {message, code: (e as {code?: string})?.code, path});if(message.includes('duplicate key'))return fail('Email or record already exists',409);return fail('Server operation failed; verify Neon database setup',500)}
}

const UUID_RE=/^[0-9a-f-]{36}$/i;
type ActEntry={action:string;detail?:string;target?:string;lat?:number|null;lon?:number|null;accuracy?:number|null;actorId?:string|null;actorName?:string|null;actorRole?:string|null};
const LOGGED_PATHS=new Set(['login','logout','attendance','break','request','request-cancel','day-control','employee-password','review','manage','create-employee','employee','branch','geofence','shift-manage','shifts','assign-employee','settings','roles','devices','employee-leaves','manual-attendance','request-categories','admin-messages','password','profile','avatar-upload','avatar-remove','attendance-failures']);
// Per-role profile permissions (administrators always allowed). Name/email edits are off unless enabled.
async function profilePerm(sql:ReturnType<typeof db>,role:string,key:string){
 if(role==='admin')return true;
 const r=await sql`SELECT ui_visibility FROM role_access WHERE role=${role} LIMIT 1`;
 const v=(r[0]?.ui_visibility as Record<string,boolean>|null)||{};
 return key==='profile.editName'||key==='profile.editEmail'?v[key]===true:v[key]!==false;
}
const MSG_KINDS=['notice','warning','urgent','emergency'];
async function deliverMessage(sql:ReturnType<typeof db>,m:{id:string;title:string;body:string;audience:unknown},opts?:{resetRead?:boolean}){
 const aud=(m.audience&&typeof m.audience==='object'?m.audience:{}) as {everyone?:boolean;employeeIds?:string[]};
 const everyone=aud.everyone===true;const ids=(Array.isArray(aud.employeeIds)?aud.employeeIds:[]).map(String).filter(x=>/^[0-9a-f-]{36}$/i.test(x));
 let tid:string[];
 if(!m.audience){tid=(await sql`SELECT employee_id FROM admin_message_recipients WHERE message_id=${m.id}::uuid`).map(r=>String(r.employee_id))}
 else tid=(await sql`SELECT id FROM employees WHERE status='active' AND role<>'display' AND (${everyone} OR id=ANY(${ids}::uuid[]))`).map(r=>String(r.id));
 if(!tid.length)return 0;
 if(opts?.resetRead)await sql`INSERT INTO admin_message_recipients(message_id,employee_id) SELECT ${m.id}::uuid,x FROM unnest(${tid}::uuid[]) AS x ON CONFLICT(message_id,employee_id) DO UPDATE SET acknowledged_at=NULL`;
 else await sql`INSERT INTO admin_message_recipients(message_id,employee_id) SELECT ${m.id}::uuid,x FROM unnest(${tid}::uuid[]) AS x ON CONFLICT(message_id,employee_id) DO NOTHING`;
 await sql`INSERT INTO notifications(recipient_id,title,message,ref_id) SELECT x,${m.title},${m.body},${m.id}::uuid FROM unnest(${tid}::uuid[]) AS x`;
 return tid.length;
}
// Scheduled announcements are delivered by whichever request arrives first after their time (atomic claim, no duplicates).
async function dispatchDueMessages(sql:ReturnType<typeof db>){
 await ensureAccessAndLeaveSchema();
 const due=await sql`UPDATE admin_messages SET status='sent',sent_at=now() WHERE status='scheduled' AND scheduled_for<=now() RETURNING id,title,body,audience`;
 for(const m of due)await deliverMessage(sql,{id:String(m.id),title:String(m.title),body:String(m.body),audience:m.audience});
 if(due.length)await sql`INSERT INTO changes(topic) VALUES('admin-messages')`;
}
const parseOffDays=(v:unknown):number[]=>{const raw=Array.isArray(v)?v:String(v??'').split(',');return Array.from(new Set(raw.map(x=>Number(String(x).trim())).filter(n=>Number.isInteger(n)&&n>=0&&n<=6))).sort((a,b)=>a-b)};
async function nameOf(sql:ReturnType<typeof db>,id:unknown){const v=String(id||'');if(!UUID_RE.test(v))return '';try{const r=await sql`SELECT name FROM employees WHERE id=${v}::uuid`;return String(r[0]?.name||'')}catch{return ''}}
async function describeActivity(sql:ReturnType<typeof db>,path:string,body:Record<string,any>,result:Record<string,any>,status:number):Promise<ActEntry|null>{
 const okRes=status>=200&&status<300;
 const num=(v:unknown)=>{const n=Number(v);return v==null||v===''||!Number.isFinite(n)?null:n};
 const coords={lat:num(body.lat),lon:num(body.lon),accuracy:num(body.accuracy)};
 if(path==='login'){
  if(okRes){const u=result.user||{};return {action:'Signed in',detail:body.locationStatus&&body.locationStatus!=='ok'?'Location '+String(body.locationStatus):'',...coords,actorId:u.id,actorName:u.name,actorRole:u.role}}
  const email=String(body.email||'').toLowerCase().trim();const r=await sql`SELECT id,name,role FROM employees WHERE email=${email} LIMIT 1`;if(!r.length)return null;
  return {action:status===403?'Sign-in blocked':'Sign-in failed',detail:String(result.error||'').slice(0,200),...coords,actorId:String(r[0].id),actorName:String(r[0].name),actorRole:String(r[0].role)};
 }
 if(path==='attendance'){
  if(okRes)return {action:result.action==='checkin'?'Check in':'Check out',detail:result.outside?'Outside geofence (permitted for this employee)':'',...coords};
  if(status===401)return null;
  return {action:'Punch rejected',detail:String(result.error||'').slice(0,250),...coords};
 }
 if(!okRes)return null;
 const name=String(body.name||body.title||body.label||'').slice(0,80);
 switch(path){
  case 'logout':return {action:'Signed out'};
  case 'break':return {action:result.action==='break-start'?'Break started':'Break ended'};
  case 'request':return {action:'Request submitted',detail:[body.kind,body.startDate&&(body.startDate+' → '+body.endDate)].filter(Boolean).join(' · ')};
  case 'review':{const id=String(body.id||'');let who='',kind='';if(UUID_RE.test(id)){const r=await sql`SELECT e.name,r.kind FROM requests r JOIN employees e ON e.id=r.employee_id WHERE r.id=${id}::uuid`;who=String(r[0]?.name||'');kind=String(r[0]?.kind||'')}return {action:'Request '+String(body.status||'reviewed'),target:who,detail:kind}}
  case 'manage':{
   if(body.kind==='employee'&&body.action==='delete'&&result.deleted)return {action:'Permanently deleted employee',target:String(result.deleted.name||''),detail:[result.deleted.email,result.deleted.public_id,'all associated data removed'].filter(Boolean).join(' · ')};
   return {action:(body.action==='delete'?'Deleted ':'Edited ')+String(body.kind||'record'),target:name,detail:name?'':String(body.id||'').slice(0,8)};
  }
  case 'request-cancel':return {action:'Request cancelled'};
  case 'day-control':{
   const bulk=String(body.action||'').endsWith('-bulk');
   const who=bulk?(Array.isArray(body.employeeIds)?body.employeeIds.length:0)+' employees (bulk)':await nameOf(sql,body.employeeId);
   if(body.action==='set-offdays'||body.action==='set-offdays-bulk')return {action:'Weekly off days changed',target:who,detail:'Effective from '+String(body.effectiveFrom||'')+' · days '+String(body.days||'')};
   if(body.action==='set-days'||body.action==='set-days-bulk')return {action:'Day status changed ('+String(body.status||'')+')',target:who,detail:(Array.isArray(body.dates)?(body.dates as unknown[]).slice(0,5).join(', ')+(body.dates.length>5?' …':''):'')};
   return {action:'Day control opened',target:who};
  }
  case 'employee-password':return {action:'Viewed employee password',target:await nameOf(sql,body.id)};
  case 'create-employee':return {action:'Created employee',target:String(body.name||''),detail:String(body.role||'')};
  case 'employee':return {action:'Updated employee status',target:await nameOf(sql,body.id),detail:'→ '+String(body.status||'')};
  case 'branch':return {action:'Saved branch',target:name};
  case 'geofence':return {action:'Saved geofence',target:name};
  case 'shift-manage':case 'shifts':return {action:'Saved shift',target:name};
  case 'assign-employee':return {action:'Assigned shift',target:await nameOf(sql,body.employeeId||body.id)};
  case 'settings':return {action:'Updated settings'};
  case 'roles':return {action:body.action==='create'?'Created role':body.action==='delete'?'Deleted role':'Updated role permissions',target:String(body.label||body.role||'')};
  case 'devices':return {action:body.action==='reset'?'Reset device':body.action==='approve'?'Allowed new device':body.action==='dismiss'?'Dismissed device alert':'Device lock '+(body.enabled?'on':'off'),target:await nameOf(sql,body.employeeId)};
  case 'employee-leaves':return {action:'Leave record changed',target:await nameOf(sql,body.employeeId)};
  case 'manual-attendance':return {action:'Manual attendance entry',target:await nameOf(sql,body.employeeId),detail:String(body.reason||'').slice(0,120)};
  case 'request-categories':return {action:'Request categories updated'};
  case 'admin-messages':{
   const a=String(body.action||'create');
   const t=String(body.title||'');
   if(a==='delete')return {action:'Announcement deleted',target:String(body.id||'').slice(0,8)};
   if(a==='update')return {action:'Announcement edited',target:t};
   if(a==='resend')return {action:'Announcement resent ('+String(body.mode==='unread'?'unread only':'everyone')+')',target:String(body.id||'').slice(0,8)};
   if(a==='send-now')return {action:'Scheduled announcement sent now',target:String(body.id||'').slice(0,8)};
   if(a==='detail')return {action:'Announcement log viewed',target:String(body.id||'').slice(0,8)};
   return {action:body.sendAt?'Announcement scheduled':'Announcement sent',target:t,detail:String(body.kind||'notice')+(body.sendAt?' · '+String(body.sendAt):'')};
  }
  case 'password':return {action:'Changed password'};
  case 'profile':return {action:'Updated profile'};
  case 'avatar-upload':return {action:'Uploaded profile photo'};
  case 'avatar-remove':return {action:'Removed profile photo'};
  case 'attendance-failures':return {action:body.all===true?'Cleared failed attempts':'Deleted failed attempt record'};
 }
 return null;
}
async function logActivity(sql:ReturnType<typeof db>,req:NextRequest,e:ActEntry,actor:{id?:string|null;name?:string|null;role?:string|null}){
 try{
  await ensureAccessAndLeaveSchema();
  const dev=parseDeviceInfo(req);const ip=(req.headers.get('x-forwarded-for')||'').split(',')[0].trim().slice(0,64);
  if(e.action==='Sign-in failed'&&actor.id){const c=await sql`SELECT COUNT(*)::int AS n FROM activity_log WHERE actor_id=${actor.id}::uuid AND action='Sign-in failed' AND created_at > now() - INTERVAL '10 minutes'`;if(Number(c[0].n)>=5)return}
  await sql`INSERT INTO activity_log(actor_id,actor_name,actor_role,action,target,detail,lat,lon,accuracy,ip,device) VALUES(${actor.id||null}::uuid,${actor.name||null},${actor.role||null},${e.action},${e.target||null},${(e.detail||'').slice(0,300)||null},${e.lat??null},${e.lon??null},${e.accuracy??null},${ip||null},${dev.label||null})`;
  if(Math.random()<0.01)await sql`DELETE FROM activity_log WHERE created_at < now() - INTERVAL '180 days'`;
 }catch(err){console.error('activity log failed',err instanceof Error?err.message:err)}
}
async function handler(req:NextRequest,ctx:{params:Promise<{path?:string[]}>}){
 const path=(await ctx.params).path?.join('/')||'';
 if(req.method!=='POST'||!LOGGED_PATHS.has(path))return core(req,ctx);
 const body:Record<string,any>=path.startsWith('avatar-')?{}:((await req.clone().json().catch(()=>({})))||{});
 const res=await core(req,ctx);
 try{
  const sql=db();
  const result=await res.clone().json().catch(()=>({}));
  const entry=await describeActivity(sql,path,body,result||{},res.status);
  if(entry){
   let actor:{id?:string|null;name?:string|null;role?:string|null}|null=entry.actorId?{id:entry.actorId,name:entry.actorName,role:entry.actorRole}:null;
   if(!actor){const s=await session().catch(()=>null);if(s)actor={id:s.id,name:s.name,role:s.role}}
   if(actor)await logActivity(sql,req,entry,actor);
  }
 }catch{/* logging must never break the request */}
 return res;
}
export {handler as GET,handler as POST};
