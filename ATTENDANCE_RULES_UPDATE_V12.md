# Update V12 — Weekly off days, Day Control, table tools

## Weekly off days
- Add/Edit Employee has a "Weekly Off Days" card (Saturday → Friday, any combination).
- On an off day with no check-in the employee is NOT absent; it shows as "Off day" (grey) in the calendar, week strip and the monthly report (code O). If the employee does check in, the day is a normal working day.
- Changing off days from the employee page applies from today only. Past days keep the schedule that was valid then (history in employee_off_days).

## Day Control page (Organization → Day Control, administrators / roles with permission)
- Per employee and month: every day with its sessions and status (Worked / Off Day / Leave / Sick Leave / Absent).
- Select days and set: Off Day, Leave, Sick Leave, Working Day, or Reset. Leave and Sick Leave are saved as normal leave records, so existing leave logic and reports use them.
- Weekly off days can be re-applied from a past date ("Apply from") to correct earlier days.
- Days inside a multi-day leave must be edited from Employee Leaves. Every change is written to the Activity Log.
- New tables (created automatically): employee_off_days, employee_day_overrides.

## Tables
Every table now has a search box, a column filter (column + value), a rows-per-page dropdown (10 / 25 / 50 / 100 / All, default 10) and paging.

## Follow-up
- An Off day is shown only after that day has ended without any check-in. Today and upcoming off days are not marked (calendar, week strip, monthly report).
- The calendar legend (status colours) is now a permission: Permissions → role → Attendance History → "Calendar legend (status colours)". Visible by default.

## Follow-up 2
- Admin monthly attendance calendar now always shows Off days (including today and upcoming days). Employees still see an off day only after it has ended without a check-in.
- Day Control → "Bulk update": select any number of employees (search, select all/filtered) and either
  1) set weekly off days (Saturday → Friday) from a chosen date, or
  2) set a date range as Off Day / Leave / Sick Leave / Working Day / Reset.
  Employees with a multi-day leave inside the chosen period are skipped and reported. One Activity Log entry per bulk action.
- "Apply from" for weekly off days may now also be a future date.

## Profile permissions (Permissions → role → "Profile — what the employee can edit")
- Change / remove own profile photo (on by default)
- Change own password (on by default; the forced change at first sign-in is always allowed)
- Edit own name (off by default) / Edit own email (off by default; must be unique)
Enforced on the server too (/profile, /avatar-upload, /avatar-remove, /password), not just hidden in the UI. Administrators are never restricted.
