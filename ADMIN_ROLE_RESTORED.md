# Admin / Employee role restoration

This release is based on the latest grace-period build (`attendance_grace_build_type_fix.zip`), not the older Admin dashboard release. It preserves grace-period calculations, UI visibility settings, overnight shifts, recent-activities history, and API 500 handling.

## Admin
- Dashboard: Workforce Overview and Employee Attendance Monitor for all staff.
- Reports: all employees' monthly reports and detailed sessions table.
- No Punch or personal History navigation; server endpoint also rejects admin punches with HTTP 403.
- Full admin navigation is available regardless of stale employee page-permission settings.
- Dashboard header is Workforce Dashboard instead of an employee greeting.

## Employee
- Personal dashboard, Punch, History, and personal Reports (subject to employee permissions).

## Deployment
Replace the full repository contents from this ZIP, commit/push to `main` and verify that Vercel's commit SHA corresponds to the new commit. Do not combine with older ZIPs or overwrite the new Dashboard.tsx with an old copy. Test an admin and an employee user separately.

Build not run in this environment; inspect Vercel logs before production use.
