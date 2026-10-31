# October 31 — Employee report and calendar selection
- Calendar selection is in memory only; reload defaults to today's date; visiting History again also resets to today.
- History shows selected day's events and its net work time (breaks deducted).
- This Month Summary shows present, absent, early-left based on current attendance/required-hours logic.
- Employee Reports shows mobile-friendly daily cards with month dropdown; no export or print.
- Admin reporting remains tabular.
- Overnight work stays assigned to the check-in date.

IMPORTANT: Absence cannot be authoritative without a weekday/holiday/schedule calendar. Current Absent summary follows the existing calendar heuristic (past day with no session and required daily hours > 0), which can overcount weekends and holidays. Do not use for payroll. Report history is bound to the sessions returned by the existing snapshot API; if the API caps records, older data may not appear. Full npm install/build validation unavailable in this runtime.
