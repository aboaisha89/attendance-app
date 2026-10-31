## Vercel TypeScript fix

`MonthlyAttendanceReport` response now declares optional `settings?: Row`, matching the `calendar-report` API response and its `attendanceVariance(net,required,report?.settings)` usage. No database changes.
