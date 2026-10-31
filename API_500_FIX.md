# API 500 compatibility fix

The previous project ran schema migrations only during POST /api/login and /api/register. Existing sessions bypassed those migrations, so `/api/access`, `/api/request-categories`, and `/api/employee-leaves` could fail with HTTP 500 because of missing tables or the `role_access.ui_visibility` column.

This patch introduces `ensureAccessAndLeaveSchema()` on authenticated application requests. It is additive, preserves existing records, and runs once per server process (with retry if it fails). It does **not** require `ADMIN_PASSWORD` or reset user sessions. The underlying `DATABASE_URL` must still have DDL rights.

If any endpoint still returns 500, read the latest `API error` entry in Vercel Runtime Logs; it reports `path`, `code`, and `message`. 500 alone does not prove the database is the only cause.

For a complete migration of all historical features, run the repository's full schema migration separately under a controlled deployment. This focused fix does not alter attendance or punch calculations.
