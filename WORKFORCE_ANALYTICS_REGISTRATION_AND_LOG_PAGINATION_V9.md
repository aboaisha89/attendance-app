# V9 – Workforce reporting and access updates

- Excluded Administrator and Display accounts from employee attendance report populations and attendance session feeds. They are not treated as employees with attendance punches.
- Added an administrator/workforce dashboard analytics panel for the last 14 days, including daily attendance rate, on-time rate (only employees with a defined shift start), early departures, and overtime hours. Analytics use active non-admin, non-display employees and completed sessions for early/overtime calculations.
- Added a global `allow_registration` setting through the additive compatibility migration. The Login page checks the public registration-status endpoint and hides the Register link when disabled. The register API also enforces the setting server-side. Administrators can change it from Roles & Permissions.
- Activity Log now returns 50 rows per request (fetching one extra row to determine whether another page exists) and provides Previous/Next pagination while retaining the search and action filters.
- All database changes are additive; existing employee and attendance records are preserved.

Build validation: TypeScript/TSX transpilation syntax checks passed. A full Next.js build could not be run because dependencies were not installed in this environment; npm installation timed out.
