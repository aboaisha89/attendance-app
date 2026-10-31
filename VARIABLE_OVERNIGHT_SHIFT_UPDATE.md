# Variable / Overnight Shift and incomplete checkout

- Admin > Employees > Add/Edit: checkbox **Variable / Overnight Shift (may finish next day)**.
- Added `employees.variable_overnight_shift BOOLEAN NOT NULL DEFAULT false` as a non-destructive schema migration.
- Normal employees: an open session whose check-in date is before today (Asia/Qatar) is **Absent** in the monthly summary and calendar. Today's open sessions are not declared absent before the day ends.
- Variable / overnight employees: an open session spanning midnight is not automatically **Absent**. It stays unrated until they check out; closed records remain assigned to the original check-in day.
- Leave days override attendance absence calculations; dates before account creation are excluded.
- Monthly summary shows Present, Early Left, Overtime, Absent, Leave. Present requires all sessions closed and required net hours achieved without overtime.

**Limitation:** This is a display/report status rule; it does not automatically close or delete attendance sessions. Existing open sessions remain available for employee checkout. For high-stakes payroll decisions, an admin review/expiry policy for abandoned overnight sessions and configured workdays is still needed.
