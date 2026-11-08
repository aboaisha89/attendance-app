# Attendance System — English Mobile UI

Next.js 15 + Neon PostgreSQL + Vercel. The dashboard and attendance history have been redesigned to closely match the supplied mobile screenshot. All frontend labels, prompts, dialogs and navigation are English. Admin and employee management, geofences and website settings use existing API routes.

## Deploy

1. Upload this folder's contents to the GitHub repository connected to Vercel.
2. In Vercel use **Framework Preset: Next.js** and unset any Output Directory override.
3. Connect Neon from Vercel Marketplace to add `DATABASE_URL`.
4. Set `SESSION_SECRET` (random 32+ characters), `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` (12+ characters) for the initial admin bootstrap.
5. Deploy. On the first login request the server initializes the database and initial admin if the necessary tables/admin are absent.
6. Remove `ADMIN_PASSWORD` from environment settings after the first admin changes their temporary password, then redeploy.

Do not use demo credentials in production. Database data is kept on Neon. Server-side GPS/geofence restrictions continue to apply. The new visual design does **not** create break tracking, biometric validation or real-time websockets: break cards show a dash, and the app refreshes the snapshot every 3 seconds. This is a browser/PWA-like UI, not a native mobile application. `Geofence` functionality requires branch assignment and accurate browser GPS.

## Local development

```
npm install
npm run typecheck
npm run build
npm run dev
```

Environment variables are documented in `.env.example`. Local `npm install`/`npm run build` could not be completed in the authoring container due to package-install timeout. Verify the Vercel build log before production use.

## Special working hours (Ramadan etc.)

Admin page **Special Hours** (Employees group in the sidebar, also a shortcut in Settings; permission id `work-hours`).
Create a period with a date range and required hours per day, for all employees or selected ones. Inside the period the required
hours stored on each attendance record are replaced, so early-leave, overtime, absence and points use the new hours; days outside the
period are untouched. Records already saved inside the dates are recalculated when a period is created, edited, disabled or deleted
(the original value is kept in `attendance_sessions.base_hours_snapshot` and restored automatically). A period for selected employees
wins over an "All employees" period. Tables/columns are created automatically (`work_hour_periods`, `base_hours_snapshot`).
