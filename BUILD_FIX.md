## Fix for Vercel build 2026-10-30

Changed `ensureAvatarBucket` argument from `ReturnType<typeof createClient>` to `ReturnType<typeof storageClient>['client']` in `src/lib/supabase-storage.ts`. This preserves the exact generic instantiation of the client returned by `storageClient` and resolves the reported SupabaseClient TypeScript mismatch.

No Neon or Supabase data is modified by this source change. Dependency installation timed out in the build environment, so full `npm run build` has not been verified. Run `npm install && npm run typecheck && npm run build` before deployment.
