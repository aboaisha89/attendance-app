# Neon schema repair (2026-10-30)

## Root cause
`src/lib/schema.ts` contained a trailing comma after the `app_settings` table definition, making the SQL invalid and breaking automatic initialisation on login or registration.

## Changes
- Removed invalid trailing comma from `app_settings` table SQL.
- Added `app_settings` creation to `scripts/setup.mjs` for consistency.
- Default language on new settings table: English.
- Added the API path and PostgreSQL error code to server-side logs without returning connection secrets to the browser.
- No DROP/TRUNCATE/DELETE/migrations of existing user data.

## Deploy
Replace the repository files with this package. Preserve environment variables `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` if the first admin is not yet provisioned. Deploy to Vercel. Sign in; the login handler calls `initializeOnce` which creates missing tables.

## If still failing
Vercel > Logs > Runtime, find `API error`. Inspect the error `message` and `code`. Also verify `DATABASE_URL` and production environment scope. Do not post connection strings or passwords.

## Validation
Source fix confirmed by inspection; full Next.js production build and database connectivity were NOT executed in this environment.
