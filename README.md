# AttendPro — Next.js + Neon (automatic first-run initialization)

No `/setup` page, no `SETUP_SECRET`, and no public administrator-creation endpoint.

## Deploy to Vercel

1. Upload project files to GitHub. In Vercel select Next.js, and leave Output Directory on Default (override off).
2. Connect Neon from Vercel Marketplace and ensure `DATABASE_URL` is available in Production.
3. Add these server-only Production environment variables:
   - `SESSION_SECRET`: unique random string, 32+ characters.
   - `ADMIN_EMAIL`: email for the initial administrator.
   - `ADMIN_NAME`: administrator display name (optional).
   - `ADMIN_PASSWORD`: strong initial administrator password, at least 12 characters.
4. Deploy. Go to the home page `/` and sign in with ADMIN_EMAIL and ADMIN_PASSWORD. On the first sign-in request the server creates tables (if absent) and inserts the initial administrator once. It marks the account for an immediate password change.
5. Create a branch, assign employees and draw the geofence. Subsequent logins do not replace the existing administrator or overwrite data.
6. After the initial administrator has successfully changed their password, remove ADMIN_PASSWORD from Vercel and redeploy. Keep the DATABASE_URL and SESSION_SECRET.

Security: no setup link is displayed, and no visitor can choose an administrator credential. Do not commit .env.local or any secrets. For an already initialized database, the existing administrator remains unchanged; the environment password does not reset it.

## Notes

Live updates currently use polling approximately every three seconds, not WebSockets. Verify location permissions, GPS accuracy and assigned active polygon before check-in. Test Next.js build and Neon schema against your environment before real-world usage. Production deployments should add rate limiting, recovery mechanisms and immutable audit logging.

## Local build

```bash
npm install
npm run typecheck
npm run build
```

## تحديث الحدود والحضور (الإصدار المعدّل)
- من شاشة الحدود: اختر «تعديل الحدود»، اسحب العلامات، ثم احفظ. خيار الحذف متاح للمدير.
- GPS: لا يسمح بالحضور إلا داخل مضلع نشط مرتبط بفرع الموظف؛ الدقة المقبولة حتى 150 متر، وتظهر إحداثيات المستخدم ودقة GPS عند رفض الخروج. لم نضف تجاوزًا غير آمن للحدود.
- إدارة: تعديل وحذف الفروع والموظفين والطلبات؛ حذف الموظف الذي له سجلات حضور ممنوع حفاظًا على التاريخ. سجلات الحضور تقبل تصحيح الوقت من المدير ولا تُحذف مباشرة.
- هام قبل الاستخدام الإنتاجي: احتفظ بنسخة احتياطية؛ صلاحية حذف طلبات الموظفين ينبغي ربطها بسجل تدقيق دائم قبل الاستخدام القانوني. التحديثات الحالية تعتمد polling وليس websocket.
