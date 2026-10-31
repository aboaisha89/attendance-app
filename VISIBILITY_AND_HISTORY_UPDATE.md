# Employee history and role-based content visibility

- Attendance History uses compact daily event lines matching reference screenshot, with day header, total net hours, events (Check In/Out, Break In/Out).
- Permissions > Employee lets the admin show/hide each supported card and internal field individually. Role settings are saved in `role_access.ui_visibility` JSONB.
- This only controls the employee-facing display. Admin workforce monitoring and admin reports remain unchanged. Employee data is still obtained from existing snapshot API; hiding a field is not a security boundary for sensitive data.
- Database schema is additive. Run your app's normal schema setup or execute `ALTER TABLE role_access ADD COLUMN IF NOT EXISTS ui_visibility JSONB NOT NULL DEFAULT '{}'::jsonb;` in Neon before using Permissions.
- Test with an employee account; ensure deployed Vercel schema matches.
