# On Site display and read-only role

- Create an employee from Admin > Employees with role **Display Screen (read-only)**, a unique email and a strong temporary password.
- The database migration expands the employee role constraint and adds a `display` role-access row. Existing employee records are preserved.
- Display accounts only have server access to `me`, `access`, `presence`, and `logout` after login. No attendance changes, requests, settings, or employee management endpoints are allowed.
- The wallboard shows working and break states from **open attendance sessions**, with branch and name search, large photos, and TV mode. Checked-out employees disappear; this is not live GPS tracking.
- For best results, use a dedicated display account and a locked down browser / TV device; avoid sharing credentials or admin login on public screens.
- Requires the existing PostgreSQL migration initializer to run (or apply the changes safely to the same Neon production database).
