# Attendance reports role update

- Employees: personal, mobile-first day cards; every check-in and check-out session shown in order. No print or export controls.
- Admin: monthly matrix and daily attendance table with names, first check-in, last check-out, session count, break, net hours, required hours, early departure and overtime.
- API `/api/calendar-report` remains admin-only. Ordinary `/api/snapshot` exposes the signed-in employee sessions only.
- Historical `required_hours_snapshot` determines differences, and no expected hours means neither Early Left nor Overtime.
- Session list in `/api/snapshot` currently has a 100-row cap. Reports covering high volumes should be paginated or queried by date on the server.
- Overnight sessions assigned to check-in date; more robust overnight shift reporting requires day-allocation policy.
