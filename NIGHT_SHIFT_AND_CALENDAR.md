# Attendance enhancements

- Sidebar sections now open exclusively; switching pages opens its corresponding group. Desktop collapse button reduces navigation width.
- Overnight sessions are anchored to the date of the **first check-in**, with check-out and breaks shown against that session even after midnight.
- A new `attendance_break_periods` table records the start and end of every new break. Historical breaks previously stored only as totals cannot be reconstructed.
- Personal calendar is clickable; status dot: green on-time, amber early left, blue overtime, red incomplete/working; gray no attendance. It uses required-hours snapshots, net of breaks.
- Session Details remains an admin table.
- **Limitations:** Current summary groups multiple sessions by first check-in calendar day, not an explicit shift instance ID. If someone clocks out after midnight and then starts a second independent shift that same morning, separate-shift attribution requires a unique shift-instance model. The first release should be validated on a Preview database before production.
- All new schema changes are additive. Ensure migrations run on the Neon database.
