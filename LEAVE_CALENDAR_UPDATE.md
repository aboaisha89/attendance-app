# Calendar and leave changes
- Employee History displays records across months; selecting a calendar day filters the list, with Show all history to clear it.
- Admin adds leave from Employees screen; stored in employee_leaves.
- Purple = leave, red = absent only after account creation and only when a daily-hours target is defined. Note: scheduled rest days still need formal day-of-week rules before absences are suitable for payroll.
- Previous entries are preserved. The migration uses CREATE TABLE IF NOT EXISTS.
