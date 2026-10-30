# Vercel Blob & breaks

1. In Vercel Marketplace/Storage add a Blob store and connect to this Vercel project. Ensure server-only `BLOB_READ_WRITE_TOKEN` is available in Production. Do not prefix with `NEXT_PUBLIC_`.
2. Redeploy. The existing Neon automatic migration adds `break_seconds` and `break_started_at` columns without deleting records.
3. Photos are uploaded server-side with access=public, max 2 MB, PNG/JPEG/WebP. Public means anyone with the URL can view; for sensitive photos use private storage with authenticated downloads instead.
4. Punch is still geofence validated for check-in/out. Break start/end requires an active attendance session and does not request GPS. Break durations are deducted from net hours, including unfinished breaks.
5. Dashboard Check In is the first session of the day, Check Out is the last completed checkout of the day. Reporting lists net hours per recorded session, manager sees names; employee does not.

Test deployment using npm install, npm run typecheck, npm run build; test Blob permissions and real Neon operations before production.
