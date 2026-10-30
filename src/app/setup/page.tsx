'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
export default function SetupPage(){
 const [state,setState]=useState<'loading'|'ready'|'done'|'error'>('loading');
 const [message,setMessage]=useState('');
 const [setupEnabled,setSetupEnabled]=useState(false);
 const [form,setForm]=useState({setupSecret:'',name:'System Administrator',email:'admin@attendance.local',password:''});
 const [busy,setBusy]=useState(false);
 useEffect(()=>{fetch('/api/setup',{cache:'no-store'}).then(async res=>{const v=await res.json();if(!res.ok)throw Error(v.error||'Connection error');setSetupEnabled(!!v.setupEnabled);setState(v.initialized?'done':'ready')}).catch(e=>{setMessage(String(e.message));setState('error')})},[]);
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');try{const r=await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});const v=await r.json();if(!r.ok)throw Error(v.error||'Setup error');setState('done');setMessage('تم إنشاء الجداول وحساب المدير بنجاح. يمكنك تسجيل الدخول الآن.')}catch(e){setMessage(e instanceof Error?e.message:'حدث خطأ')}finally{setBusy(false)}}
 return <main className="auth panel" dir="rtl"><h1>إعداد النظام لأول مرة</h1><p className="muted">Neon + Vercel — يتم التنفيذ مرة واحدة فقط. لا يتم حذف أي بيانات.</p>
 {state==='loading'&&<p>جاري فحص الاتصال...</p>}
 {state==='error'&&<p className="error">{message}</p>}
 {state==='done'&&<><p className="notice">{message||'قاعدة البيانات مهيأة مسبقًا. صفحة الإعداد مقفلة.'}</p><Link className="btn" href="/">الانتقال لتسجيل الدخول</Link></>}
 {state==='ready'&&<>{!setupEnabled&&<p className="error">قبل المتابعة: أضف SETUP_SECRET إلى Environment Variables في Vercel وأعد النشر.</p>}
 <form onSubmit={submit}>
 <label>مفتاح التهيئة السري (SETUP_SECRET)<input autoComplete="off" type="password" required minLength={24} value={form.setupSecret} onChange={e=>setForm(f=>({...f,setupSecret:e.target.value}))}/></label>
 <label>اسم المدير<input required minLength={2} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></label>
 <label>البريد الإلكتروني<input required type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/></label>
 <label>كلمة مرور المدير (12 حرفًا على الأقل)<input required minLength={12} type="password" autoComplete="new-password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))}/></label>
 {message&&<p className="error">{message}</p>}
 <button className="btn" disabled={busy||!setupEnabled}>{busy?'جارٍ إعداد قاعدة البيانات...':'إنشاء الجداول وحساب المدير'}</button>
 </form></>}
 </main>
}
