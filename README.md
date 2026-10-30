# AttendPro — Next.js + Neon (Vercel Marketplace)

A compact attendance starter with authentication stored in Neon, cookie sessions, an admin bootstrap, employee approvals, branches, geofence drawing on OpenStreetMap, server-side polygon check, multiple attendance sessions, and staff requests.

## Vercel deployment

1. Push this folder to your GitHub repo, replacing the prior Firebase application. Do **not** push `.env` or `.env.local`.
2. On Vercel → Project → Storage / Marketplace, connect **Neon** to this project, targeting Production. The integration sets `DATABASE_URL` automatically. Do not create a separate Firebase project.
3. Add `SESSION_SECRET` in Vercel Environment Variables: a random secret at least 32 characters long.
4. Set up the database ONCE using a local terminal: `npm install`, `vercel env pull .env.local`, `ADMIN_PASSWORD='your-unique-long-temporary-password' ADMIN_EMAIL='admin@attendance.local' npm run db:setup`. On Windows PowerShell, set `$env:ADMIN_PASSWORD='your-unique-long-temporary-password'; $env:ADMIN_EMAIL='admin@attendance.local'; npm run db:setup`. Choose your own strong temporary password. Do **not** publish it or paste it in chat. `db:setup` creates tables if missing and inserts the admin only if the email does not exist.
5. Deploy to Vercel. Sign in with `admin@attendance.local` and the temporary password set at bootstrap. Change it immediately on the enforced first-login screen.
6. Add a branch in the app, draw its geofence, and assign `branch_id` to employees using Neon SQL Editor (this starter lacks an assignment form): `UPDATE employees SET branch_id = 'YOUR_BRANCH_UUID' WHERE email = 'person@example.com';`.

## Important boundaries

- **Near-real-time, not push**: the client checks `/api/changes` every 3 seconds and refreshes changed data. This avoids an always-on WebSocket server incompatible with ordinary Vercel serverless functions. For true low-latency push, use an external realtime provider (Ably/Pusher) or a dedicated long-running service.
- **GPS is not spoof-proof**. Server checks the provided coordinates against Neon-stored polygons, but an attacker can forge browser coordinates. Do not rely on this alone for payroll-critical use.
- Requires HTTPS (Vercel provides it) for geolocation.
- This is a **working starter**, not the full enterprise system requested earlier. It doesn't yet implement schedule calculations, shift assignment, advanced RBAC, audit logging for each action, rate limiting, token revocation, bulk reports, full polygon editing, or production fraud controls. Test thoroughly before organization-wide rollout.
- Never set a hardcoded publicly known admin password. The initial admin credentials are set at one-time bootstrap using `ADMIN_PASSWORD` outside source control.
