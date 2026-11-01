# Attendance Calendar and Admin Corrections

- Monthly Attendance Calendar now queries a Qatar-local date interval from midnight at the beginning of the selected From Date through midnight after the selected To Date. No fixed 06:00 cutoff is applied; sessions beginning at any time of day are included.
- The report supports either a month or a custom From Date / To Date interval (up to 366 days). CSV export follows the selected interval.
- Admins can edit or delete individual sessions from Session Locations. Edit accepts Qatar-local check-in/check-out date-times; leaving check-out blank keeps the session open. Both operations require a reason.
- Changes are recorded in `attendance_change_audit` with the admin ID, employee/session IDs, old/new values, action, reason and timestamp. The audit table is created automatically on the first admin correction. Deleting a session also removes its linked break-period rows.
- The dashboard snapshot refreshes after an admin correction.

## Verification

The archive does not include `node_modules`, and dependencies were not installed in this environment. A full Next.js build/typecheck therefore could not be completed here. Run `npm install`, `npm run typecheck`, and `npm run build` before deploying.
