# History and Punch compatibility update

- Removed labels `In progress` and `Hours not set` from the attendance calendar legend.
- Removed separate Day Details block. A selected calendar date filters the sole Attendance History timeline.
- Attendance History lists Check In, Check Out, Break In and Break Out only, with timestamps.
- Reports remain per-day.
- Punch endpoint now ensures missing break columns and the break period table exist via additive SQL. This only fixes these known schema mismatches, not other causes of server errors.
- If Punch still fails, inspect latest Vercel Runtime Logs `API error` for the `attendance` path and run the correct migration.

## Verify
Run `npm ci && npm run build`, then test Punch In/Out on Vercel Preview with a test employee and an assigned active geofence.
