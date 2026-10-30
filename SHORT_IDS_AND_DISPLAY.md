# Short visible IDs + TV On Site

Visible sequential identifiers: EMP-00001, BR-00001, SH-00001, GEO-00001, ATT-00001, REQ-00001, CAT-00001, NOT-00001.

The existing UUIDs remain internal database primary keys and foreign keys. Do not change them: doing so would break attendance history, sessions and permissions. New `public_id` fields are backfilled idempotently and receive a database-generated default for future records. These identifiers are for display and search, **not authentication or authorization**.

The On Site wallboard includes Working, On Break and Checked Out statuses; the `display` role is restricted to read-only `presence` and `access` routes. Create a dedicated display account from Admin, assign `display` role, then use it on the workplace screen.

Important: PostgreSQL sequences may skip numbers after rolled-back operations; IDs remain short and unique but are not guaranteed gap-free.

The build error caused by accessing `current` before its declaration in the avatar upload route was fixed by reading the uploader role directly from Neon.

Deployment: push sources to GitHub, keep existing DATABASE_URL, SESSION_SECRET and Supabase storage configuration, then Redeploy. The schema upgrade executes during the app initialization on login/register.
