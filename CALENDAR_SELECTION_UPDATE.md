# Attendance calendar update

- A completed day with net minutes less than its recorded required daily hours displays an orange Early Left dot.
- Break time is subtracted before comparison, using `sessionNetMinutes`.
- The current day is highlighted only until another date is selected. Selecting a date deselects the previous one automatically.
- Attendance History only shows events for the selected date.
- Historical required hours come from the attendance session snapshot. An unset required-hour snapshot is not retroactively inferred from current employee settings.

No database migration is required for these UI changes.
