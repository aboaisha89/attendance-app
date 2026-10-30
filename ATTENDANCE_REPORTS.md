# Attendance Calendar and Historical Shift Reporting

## New module
Admin and employee Reports now show a scrollable monthly attendance matrix, with a separate day column and totals for days present, net working hours, break time and calculated overtime. Admin can filter by employee and branch. Employee sees their own report without other names. Use CSV / Excel to download a UTF-8 CSV workbook-compatible file, or Print / PDF to use the browser's print/PDF function (A3 landscape). These are not native XLSX/PDF server exports.

## Historical schedule preservation
The migration adds immutable-at-insert schedule snapshots to new attendance sessions and an effective-time history of employee shift assignments and required hours. Changes made after this version is deployed do not rewrite the shift or required-hours settings for earlier attendance sessions. When a shift's time is edited, a new history row records the new settings for employees assigned to it. Historic attendance sessions created before this migration lack trustworthy snapshot information, and their exact historical shift settings cannot be reconstructed automatically. Past missed days cannot reliably be classified as absent without holiday, leave, workweek and schedule calendars.

## Calculation and limitations
Each attendance session is counted against its check-in date in Qatar, including overnight sessions. Net work time = elapsed session duration less recorded breaks. Overtime is the excess above the required daily hours when historical schedule information is available and all sessions for that day are closed. The matrix marks open sessions with ◐ and days without a punch with –. Approved leave, weekends, public holidays, tardiness and other status codes are **not** yet accounted for; this report should not be used as a final payroll or compliance report before those rules are implemented and verified. The CSV export is comma-separated UTF-8 and can be opened in Excel. The print layout uses A3 landscape.

## Deployment
Keep existing `DATABASE_URL` and `SESSION_SECRET`. The schema migration in `src/lib/schema.ts` is additive and runs on next initialization (`/api/login` or `/api/register` in the present application). Existing records are not deleted. Before production changes, back up Neon and test in a Preview environment. This environment could not complete `npm install`, so `npm run build` and live Neon tests remain unverified.
