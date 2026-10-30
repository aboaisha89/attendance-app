# AttendPro — Next.js + Neon (first-run setup)

## Quick start in Vercel (Arabic)

1. Upload the **contents** of this project folder to the root of the existing GitHub repository.
2. In Vercel, select Framework **Next.js**, Output Directory **Default (override off)**, Root Directory `./`.
3. Link **Neon** through Vercel Marketplace to this Vercel project; the `DATABASE_URL` must be visible in **Settings → Environment Variables → Production**.
4. Add two private server environment variables in the same Production environment:
   - `SESSION_SECRET`: random secret (32 or more characters).
   - `SETUP_SECRET`: **different** random secret (24 or more characters). Save it privately and don't commit it.
5. Redeploy the project to load the environment variables.
6. Open `https://YOUR-PROJECT.vercel.app/setup`. Enter the value of `SETUP_SECRET`, your administrator's name, email, and a strong password (12+ chars). Press **إنشاء الجداول وحساب المدير**.
7. When successful, open `/` and log in using the email and password you entered in `/setup`.
8. Create a branch under **الفروع**; assign it to the employee under **الموظفون**; draw the geofence polygon in **الحدود على الخريطة**.
9. New employees can request an account under registration; an administrator must approve them before login.

The setup page cannot create another administrator after an administrator already exists. It does not clear existing data. If an administrator already exists, use that existing account; do not delete it to repeat setup.

## Security and operational limitations

- Never commit `.env.local`, DATABASE_URL, SESSION_SECRET, or SETUP_SECRET to Git.
- `SETUP_SECRET` should be removed from Vercel after initial setup and another deployment performed to deactivate the setup endpoint.
- Geofencing checks received coordinates on the server, but browser geolocation can be spoofed; do not rely on this as fraud-proof verification.
- This is a compact MVP, not a fully audited HR/payroll system. Live updates use polling every ~3 seconds, not WebSockets.
- Configure production rate limiting, password reset, robust audit logging and backups before broad rollout.
- If the setup fails, inspect Vercel Runtime Logs for `Initial setup failed` and verify Neon permissions.

## Local development

Use Node.js 20+. Create `.env.local` with `DATABASE_URL`, `SESSION_SECRET`, and `SETUP_SECRET` from your own environment. Then:

```bash
npm install
npm run dev
```

Navigate to `http://localhost:3000/setup`, complete initial setup, and log in.

Build checks:

```bash
npm run typecheck
npm run build
```
