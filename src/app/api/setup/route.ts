import {NextRequest,NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {db} from '@/lib/db';
import {bootstrapStatus,ensureSchema} from '@/lib/schema';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
export async function GET(){
 try{
  if(!process.env.DATABASE_URL)return NextResponse.json({ready:false,error:'DATABASE_URL غير موجود. اربط Neon بمشروع Vercel.'},{status:503});
  const status=await bootstrapStatus();
  return NextResponse.json({ready:true,initialized:status.initialized,setupEnabled:!!process.env.SETUP_SECRET&&process.env.SETUP_SECRET.length>=24},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Setup status check failed',e);return NextResponse.json({ready:false,error:'فشل الاتصال بقاعدة البيانات. راجع DATABASE_URL و Vercel Logs.'},{status:503})}
}
export async function POST(request:NextRequest){
 try{
  if(!process.env.DATABASE_URL)return NextResponse.json({error:'DATABASE_URL غير موجود'},{status:503});
  const secret=process.env.SETUP_SECRET||'';
  if(secret.length<24)return NextResponse.json({error:'أضف SETUP_SECRET (24 حرفًا على الأقل) إلى Vercel Environment Variables'},{status:503});
  const body=await request.json().catch(()=>({}));
  if(!equal(String(body.setupSecret||''),secret))return NextResponse.json({error:'مفتاح إعداد النظام غير صحيح'},{status:403});
  const status=await bootstrapStatus();
  if(status.initialized)return NextResponse.json({error:'تمت تهيئة النظام مسبقًا؛ لا يمكن إنشاء مدير آخر من صفحة الإعداد'},{status:409});
  const name=String(body.name||'').trim();
  const email=String(body.email||'').toLowerCase().trim();
  const password=String(body.password||'');
  if(name.length<2||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||password.length<12||password.length>128)return NextResponse.json({error:'أدخل الاسم والبريد الصحيح وكلمة مرور من 12 إلى 128 حرفًا'},{status:400});
  await ensureSchema();
  // No administrator can be replaced by this workflow. Concurrent setup may return a unique constraint error.
  const check=await bootstrapStatus();
  if(check.initialized)return NextResponse.json({error:'تم إنشاء المدير بالفعل'},{status:409});
  const sql=db();const hash=await bcrypt.hash(password,12);
  const created=await sql`INSERT INTO employees(name,email,password_hash,role,status,must_change_password)
      SELECT ${name},${email},${hash},'admin','active',false
      WHERE NOT EXISTS (SELECT 1 FROM employees WHERE role='admin')
      RETURNING id,email`;
  if(!created.length)return NextResponse.json({error:'تم إعداد حساب المدير بالفعل'},{status:409});
  return NextResponse.json({ok:true,email:created[0].email});
 }catch(e){console.error('Initial setup failed',e);return NextResponse.json({error:'فشل التهيئة. تحقق من صلاحيات Neon وسجل Vercel. لم يتم حذف أي بيانات.'},{status:500})}
}
