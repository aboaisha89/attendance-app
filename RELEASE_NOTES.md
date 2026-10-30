# Latest update
- Dashboard shows net working time after deducting completed and active breaks. Break tile shows aggregate break time for today.
- Monthly totals use net working minutes, not gross session duration.
- Only the Requests button adjacent to the notification bell remains as a quick header link; the extra dashboard button was removed.
- Header Sign Out icon removed; Sign Out remains in sidebar.
- Request list and reports now use responsive cards.
- Punch bottom-nav icon becomes amber during break (green before check-in; red during active working session).
- Admins can insert missed attendance in Reports, selecting employee, Qatar-local check-in/out times, break minutes, and mandatory reason. Checks session overlap and preserves a separate audit entry.
- Schema has an additive attendance_manual_audit table. Existing attendance records are not deleted.
- IMPORTANT: Manual entries require the new schema table; database schema initialization is normally performed during existing app bootstrap. Existing deployments may require applying the migration SQL using Neon SQL Editor if bootstrap is not re-run.
