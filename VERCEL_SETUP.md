# First deployment — Vercel + Neon + Supabase Storage

1. Link **Neon** and **Supabase** integrations to the SAME Vercel project and Production environment.
2. In Vercel Settings > Environment Variables, confirm `DATABASE_URL` and a Supabase URL/server-secret pair. Prefix can be `attendance_`, `SUPABASE_`, or another matching integration prefix (e.g. `FOO_URL` + `FOO_SECRET_KEY`). The application discovers matching pairs automatically.
3. Set `SESSION_SECRET` (32+ random characters), `ADMIN_EMAIL` and `ADMIN_PASSWORD` for first-run Neon initialization. Use a strong initial password; remove ADMIN_PASSWORD after the admin is created.
4. Redeploy. Storage bucket `employee-avatars` is created automatically on the first avatar upload if the server key permits storage administration. The bucket is **public**: profile pictures have public URLs. Do not upload sensitive photos.
5. The app never fabricates Supabase credentials and cannot create Vercel environment variables by itself. If the integration did not issue a server secret, add one from the Supabase dashboard as a server-only Vercel environment variable.
6. Existing Neon records and storage objects are preserved. Never expose Supabase server secrets in client code.

If upload fails: open Vercel Runtime Logs; you will see a specific message (wrong key, permissions, missing integration, or bucket creation). Do not share secrets in logs or screenshots.
