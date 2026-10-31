# Month summary and Dashboard label correction

- `History` now displays a **This Month Summary** card between Attendance Calendar and Attendance History.
- Dashboard **This Month Summary** uses the same employee metrics: Present, Absent, Early Left.
- Removed the static **Half Day: 0** label from the legacy `Summary` component, replacing it with **Early Left**.
- Monthly counters are calculated from current-month check-in dates, not the previous month's day count; days before account creation and future dates are excluded. Leave dates are excluded.
- Early Left counts closed attendance days when net worked minutes (excluding break time) are below the required hours (using historical snapshot if saved).

Note: absent counting assumes the employee has required daily hours and does not yet fully honor weekly rest-day calendars. Do not use this count for payroll until schedule-aware absence rules are implemented.
