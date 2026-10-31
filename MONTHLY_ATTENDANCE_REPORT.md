# Monthly Attendance / historical shift reporting

This update adds the **Reports → Monthly Attendance Calendar** matrix, with per-day attendance status, a monthly employee summary, CSV export (opens in Excel), and browser Print / Save as PDF (A3 landscape).

## Work duration rules
- Each session's net duration = `(checkout - checkin) - recorded break minutes`.
- Sum all sessions beginning on the same Qatar-local date. A day is finalized only when every session has a checkout.
- If `required_daily_hours` is present for the saved session: a positive difference is **Overtime**; a negative difference is **Early Left**. Without a target, neither is calculated.
- An administrator can clear required daily hours on an employee record to make that setting optional.
- Session rows store `required_hours_snapshot` and shift name/time snapshots at check-in. Updates to employee hours or shift definitions do not replace historical snapshots.
- Old records created before this update may have no saved settings. No historical values are fabricated.
- Days without punch records display a dash rather than an assumed absence; leave, holidays, schedule working days, and midnight-spanning shift allocation need additional policy-driven work for an authoritative absence/payroll report.

## Installation
Deploy the updated Next.js app with the existing Neon `DATABASE_URL`. The existing additive schema initializer adds snapshot columns, triggers, and schedule history without dropping historical attendance. Back up the database before applying migrations to production. Validate changes in Preview against a Neon test branch first.

## Checks to complete before production
- `npm install`, `npm run typecheck`, `npm run build`.
- Multi-session day with a break; early checkout; overtime; active session.
- No-hour-target employee (no Early Left or Overtime).
- Modify assigned shift and required hours and verify older session remains unchanged.
- Reports filter, CSV encoding, and A3 print on a populated month.
- Overnight-shift allocation and absence/holiday rules before using reports as final payroll records.
