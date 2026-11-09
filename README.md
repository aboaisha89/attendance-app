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

## Special working hours

Admin page **Special Hours** (Employees group in the sidebar, shortcut in Settings; permission id `work-hours`).
Each rule sets the required hours per day for everyone or for selected employees and is one of:
- **Date range** (e.g. Ramadan),
- **Repeating weekday** (e.g. every Friday; optionally only in some months),
- **Day of month** (e.g. the 15th — every month, or every year in one month),
- **Nth weekday of a month** (e.g. 2nd Tuesday of February — once, or every year).
Recurring rules have a start date and run until the end of the month / year / a date / forever. On matching days the required hours
stored on each attendance record are replaced, so early-leave, overtime, absence and points use the new hours; other days are untouched.
Records already saved on matching days are recalculated when a rule is created, edited, disabled or deleted (original value kept in
`attendance_sessions.base_hours_snapshot` and restored automatically). Precedence: selected-employees rule > all-employees rule, then
day-of-month/Nth-weekday > weekday > date range, then newest. Tables, columns and the DB function `wh_period_matches` are created automatically.

## Geofences page (updated)

- The map shows **all saved zones** at once (green = active, dashed grey = disabled). Click a zone to edit it.
- Draw a zone as a **Polygon**, **Circle** (tap the centre, drag the orange handle or type the radius in metres) or **Rectangle** (tap two opposite corners).
  Circles and rectangles are stored as polygons too (`geofences.polygon`), with the original shape kept in `geofences.shape` / `geofences.meta`, so the punch check is unchanged.
- Each zone has an **Active / Disabled** switch (`POST /api/geofence-toggle`). Disabled zones are ignored when employees punch.
  A warning is shown if a branch is left without any active zone.

## Punch Map page (new)

Admin page **Punch Map** (Employees group, shortcut in Settings; permission id `punch-map`). Choose days and employees and see on one map:
check-ins (green), check-outs (blue) and failed attempts (red) that have GPS coordinates, optionally with the geofence zones, names, and a
line joining each employee's day in time order. Click a point for details (time, reason / distance for failures, inside or outside the active zones);
click an employee chip to highlight only that employee. Manual attendance entries have no location and are not shown.
