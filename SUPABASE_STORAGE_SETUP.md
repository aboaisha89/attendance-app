# Supabase Storage for employee avatars

The app continues to use **Neon (`DATABASE_URL`)** for all application records. Only profile photo storage has moved from Vercel Blob to Supabase Storage.

1. In the **Vercel Marketplace**, install/connect **Supabase** to this Vercel project. Confirm the variables `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are available in Production. If Vercel creates prefixed variables such as `attendance_URL` and `attendance_SECRET_KEY`, the application accepts those names directly. For older integrations `SUPABASE_SERVICE_ROLE_KEY` is also supported as a fallback. Do not expose secret keys using `NEXT_PUBLIC_`.
2. In the Supabase dashboard, open **Storage > New bucket** and create a bucket named exactly `employee-avatars`, mark it **Public**, with an image MIME allowlist (`image/jpeg`, `image/png`, `image/webp`) and 2 MB limit. This application uses server-side secret credentials for writes; browsers only receive the uploaded public URL.
3. Redeploy the app on Vercel to load the new environment variables.
4. Sign in > Profile > tap the avatar circle > upload a JPG/PNG/WebP <=2 MB. Use `Remove photo` to clear it.
5. `BLOB_READ_WRITE_TOKEN` is no longer required by the application, and `@vercel/blob` has been removed.

**Privacy warning:** Photos in the public bucket can be accessed by anyone with their URL. For private employee pictures, move to a private bucket with server-authorized signed URL delivery. Do not enable unrestricted public insert/update/delete storage policies.

Existing Vercel Blob image links stored in Neon are not migrated automatically; they will continue to display while their old Blob store remains available. Re-upload an image to move it to Supabase. Old Vercel Blob objects are not deleted automatically.

No Neon schema changes or database resets are needed.
