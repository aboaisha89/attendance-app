# Attendance Management System — Next.js + Firebase

## IMPORTANT — implementation status
This package is a **development starter**, not a certified production-ready or fully completed enterprise system. It includes real Firebase authentication, self-registration, pending approval, administrator approval, database-protected check-in/check-out, polygon geofence validation, attendance sessions, audit events, basic requests, admin screens, CSV exports, Firestore security rules and cloud functions. Several requested capabilities remain incomplete (see below). **Do not deploy to employees as a production-grade system without completing the checklist and auditing security, geofencing and calculations.**

## Setup (existing Firebase project only)

1. `npm install`
2. `cd functions && npm install && npm run build && cd ..`
3. Copy `.env.example` to `.env.local`. Enter the **existing** project's Firebase Web API key; it is absent from the attached specifications. Do not paste Firebase Admin private keys here.
4. Enable Firebase Authentication -> Email/Password. Create Cloud Firestore database in the **existing** project `attendance-app-b2082`. Ensure billing and Cloud Functions v2 are supported by your Firebase plan.
5. Configure Firebase App Check for the web application and register the production Vercel domain before enabling protected Cloud Functions calls. For local testing, use a securely managed debug token only in development; do not disable enforcement for production.
6. Install Firebase CLI (`npm install -g firebase-tools`), sign in (`firebase login`), verify correct project (`firebase use attendance-app-b2082`), deploy `firebase deploy --only firestore:rules,firestore:indexes,functions`.
7. `npm run typecheck`, `npm run build`, `npm run dev`.
8. Import repository into Vercel, choose Next.js, set the same `NEXT_PUBLIC_*` environment variables, deploy. Add Vercel domains to Firebase Authentication authorized domains and App Check.

## Initial administrator provisioning
**Do not enable public bootstrap admin endpoints.** Register your intended admin through the UI. In the Firebase console, locate `employees/{UID}` (matching Firebase Auth UID), change `status` to `active` and `role` to `super_admin` manually as project owner. This is a privileged out-of-band bootstrap. Subsequent account approvals occur via the UI. Keep permissions to the Firebase console tightly restricted.

## Geofencing
Create an active `branches/{branchId}` record with `timezone` (example `Asia/Qatar`); create active geofences with `branchId`, `polygon`: ordered `[longitude,latitude]` points (at least 3), and `maxAccuracy` in meters; assign the employee's `branchId` using admin UI or console. The map **drawing interface is not included** in this release. Web GPS position is client-provided and **can be spoofed**; this implementation cannot guarantee prevention of fraudulent attendance. A GPS accuracy threshold and server-side geometry check exist but are insufficient for strong fraud prevention.

## Known incomplete work / not yet production ready
- Rich design prototype is separate and is **not** migrated pixel-for-pixel.
- No visual polygon drawing/editor, map provider integration, area preview, or place search.
- Schedule engine does not yet calculate late arrival, early departure, breaks, overtime, split shifts, overnight shifts, rotating shifts, or policy exceptions.
- Per-day session numbering is tracked transactionally; cross-midnight reporting and attendance reconciliation still need testing.
- No approval interface for requests, no attachment upload, no manual correction workflow.
- No fully implemented hierarchical branch/department scoped RBAC; current admin functionality is limited to administrator roles. Admin interface needs UX and data validation refinement.
- No push notification service worker, messaging delivery, or realtime manager notification workflow.
- CSV exists, but Excel/PDF export and print templates are not implemented.
- Reports dashboard, historical trend charts, monthly attendance calendar and attendance analytics not complete.
- Default Firestore reads are limited to 300 docs and need cursor pagination and scoped access policies.
- No automated tests, no load testing, no CI/CD security gates, no audit retention rules, no GDPR/data protection assessment, and no actual deployment performed.
- Firestore server-side validation is required for request approval; configuration schema validation and role-changing workflows need stronger authorization and integrity constraints.
- Requires installing dependencies and running build/typecheck/tests before deployment; not verified in this offline environment.

## Security warnings
- The Firebase Web API key is normally public web configuration, **not** an admin secret; enforce Auth/App Check/Rules. Never expose service account credentials.
- If admin Cloud Functions are accessible by accounts outside organizational requirements, restrict signup and approvals.
- The ability to change employee roles via admin action must be reviewed for privilege escalation and role scope restrictions.
- Map coordinates and location logs may be sensitive personal data; minimize retention and follow local law.
